import type { SiteLoginAdapter, SiteLoginResult, SiteLoginTarget } from "./types.ts";

interface PterPageState {
  success: boolean;
  state?: string;
  title?: string;
  url?: string;
  message?: string;
}

const PTER_ORIGIN = "https://pterclub.net";
const LOGIN_TIMEOUT_MS = 130_000;
const RESULT_TIMEOUT_MS = 30_000;
const MAX_TURNSTILE_ATTEMPTS = 2;

export const pterLoginAdapter: SiteLoginAdapter = {
  supports(site) {
    return site.siteKey.trim().toLowerCase() === "pter";
  },

  async login(site): Promise<SiteLoginResult> {
    const username = site.credentials?.username?.trim();
    const password = site.credentials?.password;
    if (!username || !password) {
      throw new Error("猫站自动登录缺少用户名或密码");
    }
    const origin = resolvePterOrigin(site.siteUrl);
    const tab = await chrome.tabs.create({
      url: `${origin}/login.php`,
      active: true,
    });
    if (typeof tab.id !== "number") {
      throw new Error("猫站自动登录无法创建浏览器标签页");
    }

    try {
      for (let attempt = 0; attempt < MAX_TURNSTILE_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await chrome.tabs.update(tab.id, { url: `${origin}/login.php` });
        }
        const initial = await waitForPterState(tab.id, new Set(["login", "success"]), LOGIN_TIMEOUT_MS);
        if (initial.state === "success") {
          return buildSuccessResult(site, origin, attempt);
        }

        const prepared = await withTimeout(
          sendPterMessage(tab.id, {
            type: "elysiumPterLogin",
            action: "prepare",
            username,
            password,
            twoFactorSecret: site.credentials?.twoFactorSecret,
          }),
          LOGIN_TIMEOUT_MS,
          "猫站Cloudflare Turnstile验证等待超时",
        );
        if (!prepared.success) {
          throw new Error(prepared.message || "猫站登录表单准备失败");
        }
        await sendPterMessage(tab.id, {
          type: "elysiumPterLogin",
          action: "submit",
        });
        await delay(750);

        const result = await waitForPterState(
          tab.id,
          new Set(["success", "turnstile_error", "credential_error", "two_factor_error"]),
          RESULT_TIMEOUT_MS,
        );
        if (result.state === "success") {
          return buildSuccessResult(site, origin, attempt + 1);
        }
        if (result.state === "turnstile_error" && attempt + 1 < MAX_TURNSTILE_ATTEMPTS) {
          continue;
        }
        const messages: Record<string, string> = {
          turnstile_error: "猫站Cloudflare Turnstile验证未通过",
          credential_error: "猫站用户名或密码不正确，或者账号尚未通过验证",
          two_factor_error: "猫站2FA验证码错误，请检查2FA密钥和系统时间",
        };
        throw new Error(messages[result.state || ""] || "猫站登录结果无法确认");
      }
      throw new Error("猫站Cloudflare Turnstile验证未通过");
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  },
};

async function buildSuccessResult(site: SiteLoginTarget, origin: string, attempts: number): Promise<SiteLoginResult> {
  const cookies = await chrome.cookies.getAll({ url: `${origin}/` });
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  if (!cookie) {
    throw new Error("猫站登录成功但未获取到 Cookie");
  }
  const language = navigator.language || "zh-CN";
  return {
    message: "猫站自动登录成功",
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
    raw: { attempts, usedTwoFactor: !!site.credentials?.twoFactorSecret },
  };
}

async function waitForPterState(tabId: number, acceptedStates: Set<string>, timeoutMs: number): Promise<PterPageState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: PterPageState | undefined;
  while (Date.now() < deadline) {
    try {
      const state = await sendPterMessage(tabId, {
        type: "elysiumPterLogin",
        action: "inspect",
      });
      if (state.success) {
        lastState = state;
        if (state.state && acceptedStates.has(state.state)) {
          return state;
        }
      }
    } catch {
      // 页面正在导航或内容脚本尚未加载时继续轮询。
    }
    await delay(500);
  }
  throw new Error(`猫站登录页面等待超时${lastState?.state ? `，当前状态：${lastState.state}` : ""}`);
}

async function sendPterMessage(tabId: number, message: Record<string, unknown>): Promise<PterPageState> {
  return (await chrome.tabs.sendMessage(tabId, message)) as PterPageState;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolvePterOrigin(siteUrl?: string): string {
  let url: URL;
  try {
    url = new URL(siteUrl?.trim() || `${PTER_ORIGIN}/`);
  } catch {
    throw new Error("猫站站点地址无效");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "pterclub.net" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new Error("猫站自动登录拒绝非本站 HTTPS 地址");
  }
  return url.origin;
}
