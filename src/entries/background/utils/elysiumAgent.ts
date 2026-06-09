import { EResultParseStatus } from "@ptd/site/types/base.ts";
import type { ISearchResult } from "@ptd/site/types/search.ts";
import type { ITorrent } from "@ptd/site/types/torrent.ts";
import type { IUserInfo } from "@ptd/site/types/userinfo.ts";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types.ts";

import { setupOffscreenDocument } from "./offscreen.ts";

type AgentState = "disabled" | "idle" | "authenticating" | "connecting" | "connected" | "retrying" | "error";

interface ElysiumAgentConfig {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
}

interface AgentCommand {
  type: "refreshSiteData" | "searchTorrent" | "ptSign" | "ping";
  requestId?: string;
  body?: {
    // refreshSiteData / ptSign / searchTorrent 共用
    siteKeys?: string[]; // server 端指定要操作的站点 key 列表
    sites?: AgentSite[];
    message?: string;

    // searchTorrent 用
    keyword?: string;
    concurrency?: number; // 并发数，默认 2
    siteCookies?: Record<string, string>; // server 端传来的站点 Cookie（备用，浏览器无 Cookie 时使用）
  };
}

interface AgentSite {
  siteKey: string;
  siteName?: string;
  siteUrl?: string;
  signUrl?: string;
  twoFactorSecret?: string;
}

interface LoginResult {
  token: string;
  httpBase: string;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let state: AgentState = "idle";
let lastError: string | undefined;
let connectedAt: number | undefined;
let lastSeenAt: number | undefined;
let activeConfig: ElysiumAgentConfig | null = null;

async function getConfig(): Promise<ElysiumAgentConfig> {
  const config = ((await sendMessage("getExtStorage", "config")) ?? {}) as IConfigPiniaStorageSchema;
  return {
    enabled: config.elysiumAgent?.enabled ?? false,
    serverUrl: config.elysiumAgent?.serverUrl ?? "",
    username: config.elysiumAgent?.username ?? "",
    password: config.elysiumAgent?.password ?? "",
  };
}

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function disconnect() {
  clearTimers();
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  }
  connectedAt = undefined;
}

async function login(config: ElysiumAgentConfig): Promise<LoginResult> {
  const errors: string[] = [];
  for (const base of getHttpBaseCandidates(config.serverUrl)) {
    const loginUrl = `${base}/auth/login`;
    try {
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: config.username, password: config.password, rememberLogin: true }),
      });
      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        errors.push(`${loginUrl} 返回的不是JSON`);
        continue;
      }
      if (!response.ok || data?.code !== 200 || !data?.data?.token) {
        errors.push(data?.msg || `${loginUrl} 登录失败: HTTP ${response.status}`);
        continue;
      }
      return { token: data.data.token, httpBase: base };
    } catch (error: any) {
      errors.push(`${loginUrl} 请求失败: ${error?.message ?? String(error)}`);
    }
  }
  throw new Error(`Elysium登录失败，请检查后端服务地址。已尝试: ${errors.join("；")}`);
}

async function connect() {
  clearTimers();
  const config = await getConfig();
  activeConfig = config;
  if (!config.enabled) {
    state = "disabled";
    disconnect();
    return;
  }
  if (!config.serverUrl || !config.username || !config.password) {
    state = "idle";
    lastError = "请先填写Elysium连接配置";
    return;
  }

  try {
    state = "authenticating";
    lastError = undefined;
    const loginResult = await login(config);
    state = "connecting";
    const wsUrl = buildWebSocketUrl(loginResult.httpBase, loginResult.token);
    const currentSocket = new WebSocket(wsUrl);
    socket = currentSocket;

    currentSocket.onopen = () => {
      if (socket !== currentSocket) return;
      state = "connected";
      reconnectAttempt = 0;
      connectedAt = Date.now();
      lastSeenAt = Date.now();
      sendToServer({ type: "hello", body: { message: "Elysium Depiler Agent ready" } });
      heartbeatTimer = setInterval(() => sendToServer({ type: "heartbeat", body: { time: Date.now() } }), 25000);
    };

    currentSocket.onmessage = async (event) => {
      lastSeenAt = Date.now();
      try {
        const command = JSON.parse(event.data) as AgentCommand;
        await handleCommand(command);
      } catch (error: any) {
        sendToServer({ type: "error", body: { message: error?.message ?? String(error) } });
      }
    };

    currentSocket.onerror = () => {
      if (socket !== currentSocket) return;
      lastError = "WebSocket连接异常";
    };

    currentSocket.onclose = () => {
      if (socket !== currentSocket) return;
      socket = null;
      connectedAt = undefined;
      scheduleReconnect();
    };
  } catch (error: any) {
    state = "error";
    lastError = error?.message ?? String(error);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearTimers();
  if (!activeConfig?.enabled) {
    state = "disabled";
    return;
  }
  reconnectAttempt += 1;
  state = "retrying";
  const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
  reconnectTimer = setTimeout(connect, delay);
}

async function handleCommand(command: AgentCommand) {
  if (command.type === "ping") {
    sendToServer({ type: "pong", requestId: command.requestId, body: { time: Date.now() } });
    return;
  }
  if (!command.requestId) {
    return;
  }
  if (command.type === "refreshSiteData") {
    await runPerSiteCommand(command, refreshSiteData);
    return;
  }
  if (command.type === "searchTorrent") {
    // 改造：使用 depiler 自带搜索，而非 server 端传搜索入口配置
    await triggerDepilerSearch(command);
    return;
  }
  if (command.type === "ptSign") {
    await runPerSiteCommand(command, signSite);
  }
}

async function runPerSiteCommand(
  command: AgentCommand,
  runner: (site: AgentSite, command: AgentCommand) => Promise<Record<string, any>>,
) {
  const requestId = command.requestId!;
  const sites: AgentSite[] = command.body?.sites?.length
    ? command.body.sites
    : (command.body?.siteKeys ?? []).map((siteKey) => ({ siteKey }));
  console.log("[elysiumAgent] runPerSiteCommand start:", {
    type: command.type,
    requestId,
    siteCount: sites.length,
    sites: sites.map((s) => s.siteKey),
  });
  for (const site of sites) {
    try {
      const result = await runner(site, command);
      console.log("[elysiumAgent] runPerSiteCommand siteResult:", {
        siteKey: site.siteKey,
        requestId,
        itemsLen: result.items?.length,
      });
      sendToServer({
        type: "siteResult",
        requestId,
        body: { siteKey: site.siteKey, siteName: site.siteName, success: true, ...result },
      });
    } catch (error: any) {
      console.error("[elysiumAgent] runPerSiteCommand siteError:", {
        siteKey: site.siteKey,
        requestId,
        error: error?.message,
      });
      sendToServer({
        type: "siteResult",
        requestId,
        body: {
          siteKey: site.siteKey,
          siteName: site.siteName,
          success: false,
          message: error?.message ?? String(error),
          error: error?.message ?? String(error),
        },
      });
    }
  }
  console.log("[elysiumAgent] runPerSiteCommand complete:", { requestId, type: command.type });
  sendToServer({ type: "complete", requestId, body: { message: "done" } });
}

async function refreshSiteData(site: AgentSite) {
  await setupOffscreenDocument();
  // hddolby: 先过 2FA，确保后续请求能拿到业务数据而非 2FA 页面
  // 注意：必须用 /index.php 触发 2FA 检测，因为 hddolby 首页 / 可能不检查登录/2FA 状态
  if (isHddolby(site) && site.siteUrl) {
    const checkUrl = new URL("/index.php", site.siteUrl).toString();
    await tryAutoVerifyTwoFactor(site, checkUrl);
  }
  const userInfo = (await sendMessage("getSiteUserInfoResult", site.siteKey as any)) as IUserInfo;
  if (userInfo.status !== EResultParseStatus.success) {
    throw new Error(`站点数据解析失败: ${userInfo.status}`);
  }
  // 用 levelId 从站点 levelRequirements 中查找规范等级名称，覆盖原始 levelName
  // await normalizeLevelName(userInfo);
  return {
    message: "刷新成功",
    normalized: userInfo,
    raw: userInfo,
    credential: await buildCredential(site),
  };
}

async function normalizeLevelName(userInfo: IUserInfo) {
  if (userInfo.levelId == null || !userInfo.site) return;
  try {
    const levelRequirements = (await sendMessage("getSiteLevelRequirements", userInfo.site as any)) as Array<{
      id: number;
      name: string;
      nameAka?: string[];
    }>;
    if (!levelRequirements?.length) return;
    const matched = levelRequirements.find((lr) => lr.id === userInfo.levelId);
    if (matched) {
      userInfo.levelName = matched.name;
    }
  } catch {
    // 获取 levelRequirements 失败时保持原始 levelName
  }
}

/**
 * 触发 depiler 搜索：先处理 Cookie，然后通知 options 页面用 depiler 原有搜索流程执行。
 * 结果由 options 页面通过 forwardToServer 发回 background → server。
 */
async function triggerDepilerSearch(command: AgentCommand) {
  const requestId = command.requestId!;
  const keyword = (command.body?.keyword ?? "").trim();
  const siteKeys: string[] = command.body?.siteKeys ?? [];
  const siteCookiesFromServer: Record<string, string> = command.body?.siteCookies ?? {};

  if (!keyword) {
    sendToServer({ type: "error", requestId, body: { message: "搜索关键词为空" } });
    return;
  }
  if (siteKeys.length === 0) {
    sendToServer({ type: "error", requestId, body: { message: "未指定搜索站点" } });
    return;
  }

  // 1. 处理 Cookie：确保浏览器中有 Cookie，没有则用 server 传来的
  const metadata = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const sites = metadata?.sites ?? {};

  for (const siteKey of siteKeys) {
    const siteConfig = (sites as Record<string, any>)[siteKey];
    const siteUrl = (siteConfig?.url ?? "").trim();
    if (siteUrl) {
      await checkAndEnsureCookie(siteUrl, siteKey, siteCookiesFromServer[siteKey]);
      // hddolby: 先过 2FA
      if (/hddolby/i.test(siteKey)) {
        await tryAutoVerifyTwoFactor({ siteKey, siteUrl } as any, new URL("/index.php", siteUrl).toString()).catch(
          () => {},
        );
      }
    }
  }

  // 2. 通知 options 页面触发 depiler 原有搜索（结果自动渲染 UI + 发回 server）
  console.log("[elysiumAgent] triggerDepilerSearch: delegating to options", { requestId, keyword, siteKeys });
  sendMessage("triggerAgentSearch", { requestId, siteKeys, keyword } as any).catch((err) => {
    sendToServer({ type: "error", requestId, body: { message: `无法触发 Depiler 搜索: ${err?.message ?? err}` } });
  });
}

/**
 * 检查并确保站点 Cookie 可用。
 * 优先使用浏览器中已保存的 Cookie；
 * 如果浏览器中没有 Cookie，且 server 端传来了该站点的 Cookie，则尝试设置到浏览器中。
 */
async function checkAndEnsureCookie(siteUrl: string, siteKey: string, serverCookie?: string): Promise<boolean> {
  const existingCookies = await chrome.cookies.getAll({ url: siteUrl });
  const hasValidCookie = existingCookies.some(
    (c) => c.value && c.value.length > 0 && !["__cf_bm", "cf_clearance"].includes(c.name),
  );
  if (hasValidCookie) {
    console.log(`[elysiumAgent] checkAndEnsureCookie: ${siteKey} 浏览器 Cookie 可用`);
    return true;
  }

  // 浏览器中无 Cookie，尝试用 server 端传来的
  if (serverCookie && serverCookie.trim()) {
    console.log(`[elysiumAgent] checkAndEnsureCookie: ${siteKey} 浏览器无 Cookie，尝试设置 server 端传来的 Cookie`);
    await setCookiesFromString(siteUrl, serverCookie);
    const retryCookies = await chrome.cookies.getAll({ url: siteUrl });
    const hasCookieAfterSet = retryCookies.some(
      (c) => c.value && c.value.length > 0 && !["__cf_bm", "cf_clearance"].includes(c.name),
    );
    if (hasCookieAfterSet) {
      console.log(`[elysiumAgent] checkAndEnsureCookie: ${siteKey} 成功设置 server 端 Cookie`);
      return true;
    }
  }

  console.warn(`[elysiumAgent] checkAndEnsureCookie: ${siteKey} 无可用 Cookie`);
  return false;
}

/**
 * 将 Cookie 字符串设置到浏览器中（用于 server 端 Cookie fallback）
 */
async function setCookiesFromString(siteUrl: string, cookieString: string): Promise<void> {
  const url = new URL(siteUrl);
  const domain = url.hostname;
  const isSecure = url.protocol === "https:";

  const cookies = cookieString
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean);
  for (const cookie of cookies) {
    const eqIndex = cookie.indexOf("=");
    if (eqIndex < 0) continue;
    const name = cookie.substring(0, eqIndex).trim();
    const value = cookie.substring(eqIndex + 1).trim();
    if (!name) continue;

    try {
      await chrome.cookies.set({
        url: siteUrl,
        name,
        value,
        domain,
        path: "/",
        secure: isSecure,
        httpOnly: false,
        sameSite: "no_restriction",
      });
    } catch (error: any) {
      console.warn(`[elysiumAgent] setCookiesFromString: 设置 Cookie ${name} 失败:`, error?.message);
    }
  }
}

async function signSite(site: AgentSite) {
  if (!site.signUrl) {
    throw new Error("站点签到URL为空");
  }

  // piggo: 直接跳转新标签页，不经过 fetch
  if (isPiggo(site)) {
    console.log(`[elysiumAgent] piggo detected, opening new tab directly: ${site.signUrl}`);
    openTabAndAutoClose(site.signUrl);
    return {
      message: `已在新标签页打开签到页面: ${site.siteName || site.siteKey}`,
      raw: { openedInNewTab: true },
      credential: await buildCredential(site),
    };
  }

  // hddolby: 签到前先过 2FA（对应服务端 sign 请求中检测到 2FA 后自动重试）
  if (isHddolby(site) && site.siteUrl) {
    const checkUrl = new URL("/index.php", site.siteUrl).toString();
    await tryAutoVerifyTwoFactor(site, checkUrl);
  }
  // 通过 offscreen document 执行签到，利用浏览器环境处理 WAF JS 挑战
  await setupOffscreenDocument();
  const signResult = (await sendMessage("doSiteSign", {
    siteKey: site.siteKey,
    signUrl: site.signUrl,
  })) as {
    success: boolean;
    wafBlocked: boolean;
    statusCode: number;
    bodyPreview: string;
    message: string;
  };

  // 遇到 WAF 拦截：打开新标签页让浏览器完成 WAF JS 挑战，直接标记成功
  if (signResult.wafBlocked) {
    console.log(`[elysiumAgent] WAF detected for ${site.siteKey}, opening new tab: ${site.signUrl}`);
    openTabAndAutoClose(site.signUrl);
    return {
      message: `WAF拦截，已在新标签页打开签到页面: ${site.siteName || site.siteKey}`,
      raw: {
        status: signResult.statusCode,
        bodyPreview: signResult.bodyPreview,
        wafBlocked: true,
        openedInNewTab: true,
      },
      credential: await buildCredential(site),
    };
  }

  if (!signResult.success) {
    throw new Error(signResult.message);
  }
  return {
    message: signResult.message,
    raw: { status: signResult.statusCode, bodyPreview: signResult.bodyPreview, wafBlocked: signResult.wafBlocked },
    credential: await buildCredential(site),
  };
}

/**
 * 打开新标签页跳转到签到 URL，页面加载完成后等待 60 秒自动关闭。
 */
function openTabAndAutoClose(url: string) {
  chrome.tabs.create({ url, active: true }, (tab) => {
    if (!tab.id) return;

    const tabId = tab.id;
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      // 页面加载完成，移除监听器
      chrome.tabs.onUpdated.removeListener(listener);
      // 等待 60 秒后关闭标签页
      setTimeout(async () => {
        try {
          await chrome.tabs.remove(tabId);
          console.log(`[elysiumAgent] auto-closed WAF tab: ${tabId}`);
        } catch (e: any) {
          console.warn(`[elysiumAgent] failed to close WAF tab ${tabId}:`, e?.message);
        }
      }, 60000);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function isHddolby(site: AgentSite): boolean {
  return /hddolby/i.test(site.siteKey);
}

function isPiggo(site: AgentSite): boolean {
  return /piggo/i.test(site.siteKey);
}

/**
 * hddolby 2FA 自动验证。
 * 完整复刻服务端 tryAutoVerifyTwoFactor 流程：
 * 1. 请求原始 URL，检测是否被重定向到 2FA 页面
 * 2. 如果是 2FA 页面，解析表单、生成验证码、提交
 * 3. 验证成功后，重新请求原始 URL 确认 session 生效
 * 4. 返回最终的业务页面 HTML（供调用方使用），如果不需要 2FA 则返回 null
 */
async function tryAutoVerifyTwoFactor(site: AgentSite, originalUrl: string): Promise<string | null> {
  if (!isHddolby(site) || !site.twoFactorSecret) {
    return null;
  }

  // Step 1: 请求原始 URL，获取响应（fetch 默认 follow 重定向）
  const response = await fetch(originalUrl, {
    method: "GET",
    credentials: "include",
    headers: buildBrowserHeaders(originalUrl),
  });
  const html = await response.text();

  // Step 2: 检测是否为 2FA 页面
  if (!/take2fa\.php/i.test(html)) {
    // 不是 2FA 页面，返回 null 表示不需要处理
    return null;
  }

  // Step 3: 从 2FA 页面解析表单（hddolby 的 2FA 表单在 take2fa.php 中）
  const form = parseHddolbyTwoFactorForm(originalUrl, html);
  if (!form) {
    return null;
  }

  // Step 4: 生成 TOTP 验证码并填入表单
  const code = await generateTotp(site.twoFactorSecret);
  form.params.set(form.codeField, code);

  // Step 5: 提交 2FA 验证码（对应服务端 HttpRequest.post/form.execute）
  // 使用 follow 模式让浏览器自动跟随 302 重定向并合并 Set-Cookie
  // Referer 必须指向 take2fa.php 页面本身（模拟真实浏览器行为），Origin 也必须匹配
  const verifyResponse = await fetch(form.actionUrl, {
    method: form.method,
    credentials: "include",
    redirect: "follow",
    headers: {
      ...buildBrowserHeaders(form.actionUrl),
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: form.actionUrl,
      Origin: new URL(form.actionUrl).origin,
    },
    body: form.method === "GET" ? undefined : new URLSearchParams(form.params).toString(),
  });

  if (!verifyResponse.ok) {
    return null;
  }

  // Step 6: 验证响应不是 2FA 页面（说明验证成功）
  const verifyHtml = await verifyResponse.text();
  if (/take2fa\.php/i.test(verifyHtml)) {
    // 验证码错误或过期，仍然在 2FA 页面
    return null;
  }

  // Step 7: 重新请求原始 URL 获取业务数据（对应服务端的 retryResponse）
  // 此时浏览器已通过 credentials: "include" 自动保存了 2FA 验证后的 Cookie
  const retryResponse = await fetch(originalUrl, {
    method: "GET",
    credentials: "include",
    headers: buildBrowserHeaders(originalUrl),
  });

  if (!retryResponse.ok) {
    return null;
  }

  const retryHtml = await retryResponse.text();
  if (/take2fa\.php/i.test(retryHtml)) {
    return null;
  }

  return retryHtml;
}

/**
 * 解析 hddolby 的 take2fa.php 2FA 表单。
 * hddolby 使用 NexusPHP 的 2FA 机制，表单结构固定：
 * - action: take2fa.php（可能带 returnto 参数）
 * - method: POST
 * - 验证码字段名: otp（或其他 2FA 相关名称）
 * - 其他隐藏字段: returnto, type 等
 */
function parseHddolbyTwoFactorForm(
  originalUrl: string,
  html: string,
): { actionUrl: string; method: "GET" | "POST"; codeField: string; params: URLSearchParams } | null {
  // 提取 <form> 标签内容
  const formMatch = html.match(/<form\b[\s\S]*?<\/form>/i);
  const formHtml = formMatch?.[0] ?? html;

  // 提取 action URL，解码 HTML 实体
  let rawAction = (() => {
    const m = formHtml.match(/\baction\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    return m?.[1] || m?.[2] || m?.[3] || "take2fa.php";
  })();
  rawAction = rawAction
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/["']+$/, "");

  // 确保 action 指向 take2fa.php
  if (!/take2fa\.php/i.test(rawAction)) {
    const qIdx = originalUrl.indexOf("?");
    rawAction = qIdx >= 0 ? `take2fa.php${originalUrl.slice(qIdx)}` : "take2fa.php";
  }

  const actionUrl = new URL(rawAction, originalUrl).toString();
  const method = /\bmethod\s*=\s*(?:"get"|'get'|get\b)/i.test(formHtml) ? "GET" : "POST";

  // 提取所有 input 的 name=value 参数
  // 使用 [\s\S] 替代 [^>] 来匹配跨行的 input 标签
  const params = new URLSearchParams();
  const inputRegex = /<input\b([\s\S]*?)(?:\/?>|>)/gi;
  for (const m of formHtml.matchAll(inputRegex)) {
    const attrStr = m[1];
    const nm = attrStr.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    if (!nm) continue;
    const name = nm[1] || nm[2] || nm[3];
    if (!name) continue;
    const vm = attrStr.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i);
    let value = vm ? (vm[1] ?? vm[2] ?? vm[3]) : "";
    value = value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    params.set(name, value);
  }

  // 从 params 的 key 中找 2FA 验证码字段
  const TWO_FA_PATTERN =
    /^(otp|2fa|totp|authcode|auth_code|verifycode|verification_code|passcode|googlecode|google_code)$/i;
  let codeField: string | undefined;
  for (const key of params.keys()) {
    if (TWO_FA_PATTERN.test(key)) {
      codeField = key;
      break;
    }
  }
  if (!codeField) {
    codeField = "2fa";
  }

  // hddolby 固定参数：确保 type 和 returnto 存在
  if (!params.has("type")) {
    params.set("type", "save");
  }
  // 从 originalUrl 的 query string 或表单中提取 returnto
  if (!params.has("returnto")) {
    const returntoFromUrl = new URL(originalUrl).searchParams.get("returnto");
    params.set("returnto", returntoFromUrl || "index.php");
  }

  console.log("[elysiumAgent] 2FA form parsed:", { actionUrl, method, codeField, params: params.toString() });

  return { actionUrl, method, codeField, params };
}

async function buildCredential(site: AgentSite) {
  const cookie = site.siteUrl ? await getCookieString(site.siteUrl) : "";
  return {
    cookie,
    headers: buildBrowserHeaders(site.siteUrl ?? ""),
  };
}

async function getCookieString(url: string) {
  const cookies = await chrome.cookies.getAll({ url });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function normalizeTorrent(site: AgentSite, item: ITorrent) {
  const sizeText = typeof item.size === "number" ? formatBytes(item.size) : "";
  return {
    id: `${site.siteKey}:${item.id ?? item.url ?? item.title}`,
    siteKey: site.siteKey,
    siteName: site.siteName,
    siteFavicon: "",
    title: item.title,
    subTitle: item.subTitle,
    freeStatus: item.tags?.map((tag) => tag.name).join(" / ") ?? "",
    downloadState: item.status,
    publishTimeText: item.time ? new Date(item.time).toLocaleString() : "",
    sizeText,
    seeders: item.seeders,
    leechers: item.leechers,
    completed: item.completed,
    detailUrl: item.url,
    downloadUrl: item.link,
  };
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(2)} ${units[unit]}`;
}

function buildBrowserHeaders(referer: string): Record<string, string> {
  return {
    "User-Agent": navigator.userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": navigator.language
      ? `${navigator.language},zh-CN;q=0.9,zh;q=0.8,en;q=0.7`
      : "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: referer,
    "Upgrade-Insecure-Requests": "1",
  };
}

async function generateTotp(secret: string) {
  const normalized = normalizeSecret(secret);
  const key = await crypto.subtle.importKey("raw", base32Decode(normalized), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = hash[hash.length - 1] & 0xf;
  const binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(binary % 1000000).padStart(6, "0");
}

function normalizeSecret(secret: string) {
  let value = secret.trim();
  if (/^otpauth:\/\//i.test(value)) {
    const parsed = new URL(value);
    value = parsed.searchParams.get("secret") ?? value;
  }
  return value.replace(/[\s-]/g, "").toUpperCase();
}

function base32Decode(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let bitBuffer = 0;
  for (const char of value.replace(/=+$/, "")) {
    const index = alphabet.indexOf(char.toUpperCase());
    if (index < 0) continue;
    bitBuffer = (bitBuffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((bitBuffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function parseServerUrl(raw: string) {
  const value = raw.trim();
  return new URL(/^(https?|wss?):\/\//i.test(value) ? value : `http://${value}`);
}

function normalizeHttpBase(raw: string) {
  const url = parseServerUrl(raw);
  url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/ws\/pt\/depiler$/i, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function getHttpBaseCandidates(raw: string) {
  const base = normalizeHttpBase(raw);
  const url = new URL(base);
  const candidates = [base];
  if (/\/api$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/api$/i, "") || "/";
    candidates.push(url.toString().replace(/\/$/, ""));
  } else {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api`;
    candidates.push(url.toString().replace(/\/$/, ""));
  }
  return Array.from(new Set(candidates));
}

function buildWebSocketUrl(serverUrl: string, token: string) {
  const url = parseServerUrl(serverUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/ws\/pt\/depiler$/i.test(pathname) ? pathname : `${pathname}/ws/pt/depiler`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", token);
  return url.toString();
}

function sendToServer(payload: Record<string, any>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("[elysiumAgent] sendToServer failed: socket not open", {
      type: payload.type,
      requestId: payload.requestId,
      readyState: socket?.readyState,
    });
    return;
  }
  console.log("[elysiumAgent] sendToServer:", { type: payload.type, requestId: payload.requestId });
  socket.send(JSON.stringify(payload));
}

onMessage("elysiumAgentGetStatus", async () => ({
  enabled: activeConfig?.enabled ?? false,
  connected: socket?.readyState === WebSocket.OPEN && state === "connected",
  state,
  lastError,
  connectedAt,
  lastSeenAt,
}));

onMessage("elysiumAgentReconnect", async () => {
  disconnect();
  reconnectAttempt = 0;
  await connect();
});

// options 页面通过此消息将搜索结果转发到 server WebSocket
onMessage("forwardToServer", async ({ data: payload }) => {
  sendToServer(payload);
});

chrome.runtime.onStartup.addListener(() => connect().catch());
chrome.runtime.onInstalled.addListener(() => connect().catch());
connect().catch();
