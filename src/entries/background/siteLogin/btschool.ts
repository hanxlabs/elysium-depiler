import { sendMessage } from "@/messages.ts";

import { setupOffscreenDocument } from "../utils/offscreen.ts";
import type { SiteLoginAdapter, SiteLoginResult, SiteLoginTarget } from "./types.ts";

interface BtschoolPageDiagnostic {
  stage: string;
  status: number;
  finalUrl: string;
  redirected: boolean;
  headers: Record<string, string>;
  title: string;
  htmlLength: number;
  cloudflare: {
    detected: boolean;
    mitigated: string;
    ray: string;
    server: string;
    challengeMarkers: string[];
  };
  html: string;
}

export const btschoolLoginAdapter: SiteLoginAdapter = {
  supports(site) {
    return site.siteKey.trim().toLowerCase() === "btschool";
  },

  async login(site): Promise<SiteLoginResult> {
    const username = site.credentials?.username?.trim();
    const password = site.credentials?.password;
    if (!username || !password) {
      throw new Error("BTSCHOOL 自动登录缺少用户名或密码");
    }
    const origin = resolveBtschoolOrigin(site.siteUrl);
    await setupOffscreenDocument();
    const result = (await sendMessage("loginBtschool", {
      siteUrl: origin,
      username,
      password,
    })) as {
      success: boolean;
      message?: string;
      raw?: Record<string, unknown>;
      diagnostic?: BtschoolPageDiagnostic;
    };
    if (!result.success) {
      console.error(
        "[BTSCHOOL登录诊断] Offscreen返回的失败页面",
        result.diagnostic ?? {
          message: result.message,
          diagnostic: "未获取到页面诊断信息，失败可能发生在请求页面之前",
        },
      );
      if (result.diagnostic?.html) {
        console.error(`[BTSCHOOL登录诊断] 脱敏后的完整HTML\n${result.diagnostic.html}`);
      }
      throw new Error(result.message || "BTSCHOOL 自动登录失败");
    }

    const cookies = await chrome.cookies.getAll({ url: `${origin}/` });
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    if (!cookie) {
      throw new Error("BTSCHOOL 登录成功但未获取到 Cookie");
    }
    const language = navigator.language || "zh-CN";
    return {
      message: result.message || "BTSCHOOL 自动登录成功",
      credential: {
        cookie,
        headers: {
          "User-Agent": navigator.userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9," + "image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": `${language},zh-CN;q=0.9,zh;q=0.8,en;q=0.7`,
          Referer: `${origin}/`,
          "Upgrade-Insecure-Requests": "1",
        },
      },
      raw: result.raw,
    };
  },
};

function resolveBtschoolOrigin(siteUrl?: string): string {
  let url: URL;
  try {
    url = new URL(siteUrl?.trim() || "https://pt.btschool.club/");
  } catch {
    throw new Error("BTSCHOOL 站点地址无效");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "pt.btschool.club" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new Error("BTSCHOOL 自动登录拒绝非 BTSCHOOL HTTPS 地址");
  }
  return url.origin;
}
