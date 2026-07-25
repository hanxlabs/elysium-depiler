import type { SiteLoginAdapter, SiteLoginResult, SiteLoginTarget } from "./types.ts";

interface SunnyPtResponse {
  code?: number;
  data?: any;
  msg?: string;
  message?: string;
}

const SUNNY_API_ORIGIN = "https://api.sunnypt.top";

export const sunnyPtLoginAdapter: SiteLoginAdapter = {
  supports(site) {
    return site.siteKey.trim().toLowerCase() === "sunnypt";
  },

  async login(site): Promise<SiteLoginResult> {
    const username = site.credentials?.username?.trim();
    const password = site.credentials?.password;
    if (!username || !password) {
      throw new Error("SunnyPT 自动登录缺少用户名或密码");
    }

    const siteOrigin = resolveSunnyPtOrigin(site.siteUrl);
    await fetch(`${siteOrigin}/auth/sign-in`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    const login = await requestJson(
      `${SUNNY_API_ORIGIN}/login`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: siteOrigin,
          Referer: `${siteOrigin}/`,
        },
        body: JSON.stringify({
          username,
          password,
          code: site.credentials?.code ?? "",
        }),
      },
      "账号登录",
    );
    const accessToken = normalizeToken(login.data?.token);
    if (!accessToken) {
      throw new Error("SunnyPT 账号登录未返回 Bearer Token");
    }

    const sessionUrl = `${siteOrigin}/api/auth/session`;
    const sessionWrite = await requestJson(
      sessionUrl,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: siteOrigin,
          Referer: `${siteOrigin}/auth/sign-in`,
        },
        body: JSON.stringify({ accessToken, rememberMe: true }),
      },
      "会话写入",
      false,
    );
    if (sessionWrite.data !== true) {
      throw new Error("SunnyPT 会话写入失败");
    }

    const session = await requestJson(
      sessionUrl,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Referer: `${siteOrigin}/auth/sign-in`,
        },
      },
      "会话读取",
      false,
    );
    const bearerToken = normalizeToken(session.data?.accessToken);
    if (!bearerToken) {
      throw new Error("SunnyPT 会话未返回 Bearer Token");
    }

    return {
      message: "SunnyPT 登录成功",
      credential: { bearerToken },
      raw: { sessionEstablished: true },
    };
  },
};

async function requestJson(
  url: string,
  init: RequestInit,
  stage: string,
  requireCodeZero = true,
): Promise<SunnyPtResponse> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error: any) {
    throw new Error(`SunnyPT ${stage}请求失败: ${error?.message ?? String(error)}`);
  }
  let body: SunnyPtResponse;
  try {
    body = (await response.json()) as SunnyPtResponse;
  } catch {
    throw new Error(`SunnyPT ${stage}返回的不是 JSON`);
  }
  if (!response.ok || (requireCodeZero && body.code !== 0)) {
    throw new Error(body.msg || body.message || `SunnyPT ${stage}失败: HTTP ${response.status}`);
  }
  return body;
}

function resolveSunnyPtOrigin(siteUrl?: string): string {
  let url: URL;
  try {
    url = new URL(siteUrl?.trim() || "https://sunnypt.top");
  } catch {
    throw new Error("SunnyPT 站点地址无效");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (hostname !== "sunnypt.top" && !hostname.endsWith(".sunnypt.top"))) {
    throw new Error("SunnyPT 自动登录拒绝非 SunnyPT HTTPS 地址");
  }
  return url.origin;
}

function normalizeToken(value: unknown): string {
  const token = String(value ?? "").trim();
  return /^Bearer\s+/i.test(token) ? token.replace(/^Bearer\s+/i, "").trim() : token;
}
