import { onMessage } from "@/messages.ts";

import { recognizeCaptchaOffline } from "./captchaOcr.ts";

interface BtschoolLoginRequest {
  siteUrl?: string;
  username?: string;
  password?: string;
}

interface ParsedLoginForm {
  actionUrl: string;
  imageUrl: string;
  params: URLSearchParams;
}

const BTSCHOOL_HOST = "pt.btschool.club";
const CAPTCHA_CODE_PATTERN = /^[A-Za-z0-9]{3,8}$/;
const CAPTCHA_ERROR_PATTERN = /图片代码无效|图片代码已被清除/;
const CREDENTIAL_ERROR_PATTERN = /用户名或密码不正确|还没有通过验证/;
const MAX_ATTEMPTS = 2;

async function loginBtschool(request: BtschoolLoginRequest) {
  const username = request.username?.trim();
  const password = request.password;
  if (!username || !password) {
    throw new Error("BTSCHOOL 自动登录缺少用户名或密码");
  }

  const origin = resolveBtschoolOrigin(request.siteUrl);
  const loginUrl = `${origin}/login.php`;
  let lastMessage = "BTSCHOOL 验证码识别失败";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const loginResponse = await fetch(loginUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const loginHtml = await loginResponse.text();
    if (!loginResponse.ok) {
      throw new Error(`BTSCHOOL 登录页请求失败: HTTP ${loginResponse.status}`);
    }
    if (isLoginSuccess(loginResponse.url, loginHtml, origin)) {
      return { message: "BTSCHOOL 当前浏览器会话已登录", raw: { attempts: attempt } };
    }

    const form = parseLoginForm(loginHtml, loginUrl, origin);
    if (!form) {
      throw new Error("BTSCHOOL 登录页未找到验证码登录表单");
    }
    const imageResponse = await fetch(form.imageUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!imageResponse.ok) {
      lastMessage = `BTSCHOOL 验证码图片请求失败: HTTP ${imageResponse.status}`;
      continue;
    }

    let code: string;
    try {
      code = await recognizeCaptchaOffline(await imageResponse.blob());
    } catch {
      lastMessage = "BTSCHOOL 本地OCR识别失败";
      continue;
    }
    if (!CAPTCHA_CODE_PATTERN.test(code)) {
      lastMessage = "BTSCHOOL 本地OCR结果格式无效";
      continue;
    }
    form.params.set("username", username);
    form.params.set("password", password);
    form.params.set("imagestring", code);

    const submitResponse = await fetch(form.actionUrl, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: loginUrl,
      },
      body: form.params,
    });
    const resultHtml = await submitResponse.text();
    if (!submitResponse.ok) {
      throw new Error(`BTSCHOOL 登录提交失败: HTTP ${submitResponse.status}`);
    }
    const resultText = new DOMParser().parseFromString(resultHtml, "text/html").body?.textContent || resultHtml;
    if (isLoginSuccess(submitResponse.url, resultHtml, origin)) {
      return { message: "BTSCHOOL 自动登录成功", raw: { attempts: attempt + 1 } };
    }
    if (CREDENTIAL_ERROR_PATTERN.test(resultText)) {
      throw new Error("BTSCHOOL 用户名或密码不正确，或者账号尚未通过验证");
    }
    if (CAPTCHA_ERROR_PATTERN.test(resultText)) {
      lastMessage = "BTSCHOOL 图片验证码错误";
      continue;
    }
    throw new Error("BTSCHOOL 登录结果无法确认");
  }
  throw new Error(lastMessage);
}

function parseLoginForm(html: string, pageUrl: string, expectedOrigin: string): ParsedLoginForm | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const form = doc.querySelector('form[action$="takelogin.php"][method="post"]') as HTMLFormElement | null;
  if (!form) {
    return null;
  }
  const actionUrl = new URL(form.getAttribute("action") || pageUrl, pageUrl);
  if (actionUrl.origin !== expectedOrigin) {
    throw new Error("BTSCHOOL 登录表单提交地址无效");
  }
  const image = form.querySelector('img[alt="CAPTCHA"], img[src*="action=regimage"]') as HTMLImageElement | null;
  const rawImageUrl = image?.getAttribute("src");
  if (!rawImageUrl) {
    return null;
  }
  const imageUrl = new URL(rawImageUrl, pageUrl);
  if (imageUrl.origin !== expectedOrigin) {
    throw new Error("BTSCHOOL 验证码图片地址无效");
  }

  const params = new URLSearchParams();
  for (const input of Array.from(form.querySelectorAll("input[name]")) as HTMLInputElement[]) {
    if (input.disabled) {
      continue;
    }
    const type = (input.type || "text").toLowerCase();
    if (["button", "image", "file", "reset"].includes(type)) {
      continue;
    }
    if ((type === "checkbox" || type === "radio") && !input.checked) {
      continue;
    }
    params.set(input.name, input.value || "");
  }
  return { actionUrl: actionUrl.toString(), imageUrl: imageUrl.toString(), params };
}

function isLoginSuccess(finalUrl: string, html: string, expectedOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch {
    return false;
  }
  if (url.origin !== expectedOrigin || !["/", "/index.php"].includes(url.pathname)) {
    return false;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return !!doc.querySelector('a[href="logout.php"], a[href$="/logout.php"]');
}

function resolveBtschoolOrigin(siteUrl?: string): string {
  let url: URL;
  try {
    url = new URL(siteUrl?.trim() || "https://pt.btschool.club/");
  } catch {
    throw new Error("BTSCHOOL 站点地址无效");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== BTSCHOOL_HOST ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new Error("BTSCHOOL 自动登录拒绝非 BTSCHOOL HTTPS 地址");
  }
  return url.origin;
}

onMessage("loginBtschool", async ({ data }: { data: BtschoolLoginRequest }) => {
  return await loginBtschool(data);
});
