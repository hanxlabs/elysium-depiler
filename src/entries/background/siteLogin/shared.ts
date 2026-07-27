import { sendMessage } from "@/messages.ts";
import { resolveSiteLoginOrigin, type SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";

import { setupOffscreenDocument } from "../utils/offscreen.ts";
import type { SiteLoginAdapter, SiteLoginResult, SiteLoginTarget } from "./types.ts";

interface MultiSitePageState {
  success: boolean;
  state?: string;
  title?: string;
  url?: string;
  bodyPreview?: string;
  cloudflareMarkers?: string[];
  message?: string;
}

interface MultiSiteOffscreenResult {
  success: boolean;
  message?: string;
  raw?: Record<string, unknown>;
  diagnostic?: {
    stage?: string;
    html?: string;
    cloudflare?: { detected?: boolean };
    [key: string]: unknown;
  };
}

const LOGIN_TIMEOUT_MS = 130_000;
const RESULT_TIMEOUT_MS = 30_000;
const MAX_TURNSTILE_ATTEMPTS = 2;

export function createSiteLoginAdapter(definition: SiteLoginDefinition): SiteLoginAdapter {
  return {
    supports(site) {
      return site.siteKey.trim().toLowerCase() === definition.key;
    },

    async login(site): Promise<SiteLoginResult> {
      const username = site.credentials?.username?.trim();
      const password = site.credentials?.password;
      if (!username || !password) {
        throw new Error(`${definition.label}自动登录缺少用户名或密码`);
      }
      const origin = resolveSiteLoginOrigin(definition, site.siteUrl);

      if (definition.turnstile || definition.cloudflarePreflight) {
        return loginMultiSiteViaTab(site, definition, origin);
      }

      const result = await requestMultiSiteOffscreenLogin(site, definition, origin);
      if (!result.success) {
        logMultiSiteOffscreenFailure(definition, result);
        if (result.diagnostic?.cloudflare?.detected) {
          console.warn(`[${definition.label}登录诊断] 检测到Cloudflare页面，切换真实标签页执行`);
          return loginMultiSiteViaTab(site, definition, origin);
        }
        throw new Error(result.message || `${definition.label}自动登录失败`);
      }
      return buildMultiSiteSuccess(site, definition, origin, result.message, result.raw);
    },
  };
}

async function loginMultiSiteViaTab(
  site: SiteLoginTarget,
  definition: SiteLoginDefinition,
  origin: string,
): Promise<SiteLoginResult> {
  const username = site.credentials?.username?.trim();
  const password = site.credentials?.password;
  if (!username || !password) {
    throw new Error(`${definition.label}自动登录缺少用户名或密码`);
  }
  const loginUrl = new URL(definition.loginPath || "/login.php", origin).toString();
  if (definition.imageCaptcha) {
    await setupOffscreenDocument();
  }
  const tab = await chrome.tabs.create({ url: loginUrl, active: true });
  if (typeof tab.id !== "number") {
    throw new Error(`${definition.label}自动登录无法创建浏览器标签页`);
  }
  const attempts = definition.turnstile || definition.imageCaptcha ? MAX_TURNSTILE_ATTEMPTS : 1;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) {
        await chrome.tabs.update(tab.id, { url: loginUrl });
      }
      const initial = await waitForMultiSiteState(tab.id, definition, new Set(["login", "success"]), LOGIN_TIMEOUT_MS);
      if (initial.state === "success") {
        return buildMultiSiteSuccess(site, definition, origin, `${definition.label}当前浏览器会话已登录`, {
          attempts: attempt - 1,
          alreadyLoggedIn: true,
        });
      }
      if (definition.imageCaptcha) {
        console.info(`[${definition.label}登录诊断] Cloudflare已通过，在真实标签页读取并识别图片验证码`);
      }
      const prepared = await withMultiSiteTimeout(
        sendMultiSiteTabMessage(tab.id, {
          type: "elysiumMultiSiteLogin",
          siteKey: definition.key,
          definition,
          action: "prepare",
          username,
          password,
          twoFactorSecret: site.credentials?.twoFactorSecret,
        }),
        LOGIN_TIMEOUT_MS,
        `${definition.label}${definition.turnstile ? "Cloudflare Turnstile验证" : "登录页面"}等待超时`,
      );
      if (!prepared.success) {
        throw new Error(prepared.message || `${definition.label}登录表单准备失败`);
      }
      const submitted = await sendMultiSiteTabMessage(tab.id, {
        type: "elysiumMultiSiteLogin",
        siteKey: definition.key,
        definition,
        action: "submit",
      });
      if (!submitted.success) {
        throw new Error(submitted.message || `${definition.label}登录表单提交失败`);
      }
      await delayMultiSite(750);
      const result = await waitForMultiSiteState(
        tab.id,
        definition,
        new Set(["success", "turnstile_error", "credential_error", "two_factor_error", "captcha_error"]),
        RESULT_TIMEOUT_MS,
      );
      if (result.state === "success") {
        return buildMultiSiteSuccess(site, definition, origin, `${definition.label}自动登录成功`, {
          attempts: attempt,
          usedTwoFactor: !!site.credentials?.twoFactorSecret,
          realTab: true,
        });
      }
      if ((result.state === "turnstile_error" || result.state === "captcha_error") && attempt < attempts) {
        continue;
      }
      console.error(`[${definition.label}登录诊断] 真实标签页失败状态`, result);
      const messages: Record<string, string> = {
        turnstile_error: `${definition.label}Cloudflare Turnstile验证未通过`,
        credential_error: `${definition.label}用户名或密码不正确`,
        two_factor_error: `${definition.label}2FA验证码错误，请检查2FA密钥和系统时间`,
        captcha_error: `${definition.label}图片验证码错误`,
      };
      throw new Error(messages[result.state || ""] || `${definition.label}登录结果无法确认`);
    }
    throw new Error(`${definition.label}Cloudflare Turnstile验证未通过`);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function requestMultiSiteOffscreenLogin(
  site: SiteLoginTarget,
  definition: SiteLoginDefinition,
  origin: string,
): Promise<MultiSiteOffscreenResult> {
  const username = site.credentials?.username?.trim();
  const password = site.credentials?.password;
  if (!username || !password) {
    throw new Error(`${definition.label}自动登录缺少用户名或密码`);
  }
  await setupOffscreenDocument();
  return (await sendMessage("loginMultiSite", {
    siteKey: definition.key,
    definition,
    siteUrl: origin,
    username,
    password,
    twoFactorSecret: site.credentials?.twoFactorSecret,
  })) as MultiSiteOffscreenResult;
}

function logMultiSiteOffscreenFailure(definition: SiteLoginDefinition, result: MultiSiteOffscreenResult): void {
  console.error(
    `[${definition.label}登录诊断] Offscreen返回的失败页面`,
    result.diagnostic ?? {
      message: result.message,
      diagnostic: "未获取到页面诊断信息，失败可能发生在请求页面之前",
    },
  );
  if (result.diagnostic?.html) {
    console.error(`[${definition.label}登录诊断] 脱敏后的完整HTML\n${result.diagnostic.html}`);
  }
}

async function buildMultiSiteSuccess(
  site: SiteLoginTarget,
  definition: SiteLoginDefinition,
  origin: string,
  message?: string,
  raw?: Record<string, unknown>,
): Promise<SiteLoginResult> {
  const cookies = await chrome.cookies.getAll({ url: `${origin}/` });
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  if (!cookie) {
    throw new Error(`${definition.label}登录成功但未获取到 Cookie`);
  }
  const language = navigator.language || "zh-CN";
  return {
    message: message || `${definition.label}自动登录成功`,
    credential: {
      cookie,
      headers: {
        "User-Agent": navigator.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9," + "image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": `${language},zh-CN;q=0.9,zh;q=0.8,en;q=0.7`,
        Referer: `${origin}/`,
        "Upgrade-Insecure-Requests": "1",
      },
    },
    raw: {
      ...raw,
      siteKey: site.siteKey,
    },
  };
}

async function waitForMultiSiteState(
  tabId: number,
  definition: SiteLoginDefinition,
  acceptedStates: Set<string>,
  timeoutMs: number,
): Promise<MultiSitePageState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: MultiSitePageState | undefined;
  while (Date.now() < deadline) {
    try {
      const state = await sendMultiSiteTabMessage(tabId, {
        type: "elysiumMultiSiteLogin",
        siteKey: definition.key,
        definition,
        action: "inspect",
      });
      if (state.success) {
        lastState = state;
        if (state.state && acceptedStates.has(state.state)) {
          return state;
        }
      }
    } catch {
      // 顶层CF校验、页面导航或内容脚本尚未加载时继续轮询。
    }
    await delayMultiSite(500);
  }
  console.error(
    `[${definition.label}登录诊断] 真实标签页等待超时`,
    lastState ?? { state: "unavailable", message: "内容脚本未返回页面状态" },
  );
  throw new Error(`${definition.label}登录页面等待超时${lastState?.state ? `，当前状态：${lastState.state}` : ""}`);
}

async function sendMultiSiteTabMessage(tabId: number, message: Record<string, unknown>): Promise<MultiSitePageState> {
  return (await chrome.tabs.sendMessage(tabId, message)) as MultiSitePageState;
}

async function withMultiSiteTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function delayMultiSite(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
