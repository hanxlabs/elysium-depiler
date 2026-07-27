import { onMessage } from "@/messages.ts";
import {
  hasNexusAlreadyLoggedInMarker,
  resolveSiteLoginOrigin,
  type SiteLoginDefinition,
} from "@/shared/siteLoginDefinition.ts";
import { generateTotp } from "@/shared/totp.ts";

import { recognizeCaptchaOffline } from "./captchaOcr.ts";

interface NexusCaptchaLoginRequest {
  siteUrl?: string;
  username?: string;
  password?: string;
}

interface NexusCaptchaSite {
  label: string;
  host: string;
  defaultUrl: string;
}

interface ParsedLoginForm {
  actionUrl: string;
  imageUrl: string;
  params: URLSearchParams;
}

export interface BtschoolPageDiagnostic {
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

interface BtschoolOffscreenResult {
  success: boolean;
  message: string;
  raw?: Record<string, unknown>;
  diagnostic?: BtschoolPageDiagnostic;
}

class NexusCaptchaLoginError extends Error {
  constructor(
    message: string,
    readonly diagnostic?: BtschoolPageDiagnostic,
  ) {
    super(message);
    this.name = "NexusCaptchaLoginError";
  }
}

const BTSCHOOL_SITE: NexusCaptchaSite = {
  label: "BTSCHOOL",
  host: "pt.btschool.club",
  defaultUrl: "https://pt.btschool.club/",
};
const CRABPT_SITE: NexusCaptchaSite = {
  label: "蟹黄堡",
  host: "crabpt.vip",
  defaultUrl: "https://crabpt.vip/",
};
const PTCAFE_SITE: NexusCaptchaSite = {
  label: "咖啡",
  host: "ptcafe.club",
  defaultUrl: "https://ptcafe.club/",
};
const CAPTCHA_CODE_PATTERN = /^[A-Za-z0-9]{3,8}$/;
const CAPTCHA_ERROR_PATTERN = /图片代码无效|图片代码已被清除/;
const CREDENTIAL_ERROR_PATTERN = /用户名或密码不正确|还没有通过验证/;
const MAX_ATTEMPTS = 2;

async function loginNexusCaptcha(request: NexusCaptchaLoginRequest, site: NexusCaptchaSite) {
  const username = request.username?.trim();
  const password = request.password;
  if (!username || !password) {
    throw new Error(`${site.label} 自动登录缺少用户名或密码`);
  }

  const origin = resolveNexusCaptchaOrigin(request.siteUrl, site);
  const loginUrl = `${origin}/login.php`;
  const fail = (message: string, stage: string, response: Response, html: string): never =>
    failWithPage(site.label, message, stage, response, html, username, password);
  let lastMessage = `${site.label} 验证码识别失败`;
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
      fail(`${site.label} 登录页请求失败: HTTP ${loginResponse.status}`, "login-page-http", loginResponse, loginHtml);
    }
    if (isLoginSuccess(loginResponse.url, loginHtml, origin)) {
      return { message: `${site.label} 当前浏览器会话已登录`, raw: { attempts: attempt } };
    }

    const form = parseLoginForm(loginHtml, loginUrl, origin, site.label);
    if (!form) {
      return fail(`${site.label} 登录页未找到验证码登录表单`, "login-form-missing", loginResponse, loginHtml);
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
      lastMessage = `${site.label} 验证码图片请求失败: HTTP ${imageResponse.status}`;
      if (attempt + 1 >= MAX_ATTEMPTS) {
        fail(`${lastMessage}，imageUrl=${imageResponse.url}`, "captcha-image-http", loginResponse, loginHtml);
      }
      continue;
    }

    let code: string;
    try {
      code = await recognizeCaptchaOffline(await imageResponse.blob());
    } catch {
      lastMessage = `${site.label} 本地OCR识别失败`;
      if (attempt + 1 >= MAX_ATTEMPTS) {
        fail(lastMessage, "captcha-ocr", loginResponse, loginHtml);
      }
      continue;
    }
    if (!CAPTCHA_CODE_PATTERN.test(code)) {
      lastMessage = `${site.label} 本地OCR结果格式无效`;
      if (attempt + 1 >= MAX_ATTEMPTS) {
        fail(lastMessage, "captcha-format", loginResponse, loginHtml);
      }
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
      fail(
        `${site.label} 登录提交失败: HTTP ${submitResponse.status}`,
        "login-submit-http",
        submitResponse,
        resultHtml,
      );
    }
    const resultText = new DOMParser().parseFromString(resultHtml, "text/html").body?.textContent || resultHtml;
    if (isLoginSuccess(submitResponse.url, resultHtml, origin)) {
      return { message: `${site.label} 自动登录成功`, raw: { attempts: attempt + 1 } };
    }
    if (CREDENTIAL_ERROR_PATTERN.test(resultText)) {
      fail(`${site.label} 用户名或密码不正确，或者账号尚未通过验证`, "credential-error", submitResponse, resultHtml);
    }
    if (CAPTCHA_ERROR_PATTERN.test(resultText)) {
      lastMessage = `${site.label} 图片验证码错误`;
      if (attempt + 1 >= MAX_ATTEMPTS) {
        fail(lastMessage, "captcha-error", submitResponse, resultHtml);
      }
      continue;
    }
    fail(`${site.label} 登录结果无法确认`, "login-result-unknown", submitResponse, resultHtml);
  }
  throw new Error(lastMessage);
}

function failWithPage(
  label: string,
  message: string,
  stage: string,
  response: Response,
  html: string,
  username: string,
  password: string,
): never {
  const diagnostic = buildPageDiagnostic(stage, response, html, username, password);
  console.error(`[${label}登录诊断] 页面内容`, diagnostic);
  throw new NexusCaptchaLoginError(message, diagnostic);
}

function buildPageDiagnostic(
  stage: string,
  response: Response,
  html: string,
  username: string,
  password: string,
): BtschoolPageDiagnostic {
  const sanitizedHtml = redactSecrets(html, username, password);
  const lower = sanitizedHtml.toLowerCase();
  const challengeMarkers = [
    "cf-chl",
    "challenge-platform",
    "cf-turnstile",
    "just a moment",
    "attention required",
    "checking your browser",
    "cloudflare ray id",
  ].filter((marker) => lower.includes(marker));
  const headers = Object.fromEntries(response.headers.entries());
  const server = headers.server || "";
  const ray = headers["cf-ray"] || "";
  const mitigated = headers["cf-mitigated"] || "";
  const title = new DOMParser().parseFromString(sanitizedHtml, "text/html").title.trim();
  return {
    stage,
    status: response.status,
    finalUrl: response.url,
    redirected: response.redirected,
    headers,
    title,
    htmlLength: sanitizedHtml.length,
    cloudflare: {
      detected: !!(ray || mitigated || /cloudflare/i.test(server) || challengeMarkers.length),
      mitigated,
      ray,
      server,
      challengeMarkers,
    },
    html: sanitizedHtml,
  };
}

function redactSecrets(html: string, username: string, password: string): string {
  let result = html;
  for (const [secret, replacement] of [
    [password, "[REDACTED_PASSWORD]"],
    [username, "[REDACTED_USERNAME]"],
  ] as const) {
    if (secret) {
      result = result.split(secret).join(replacement);
    }
  }
  return result
    .replace(/(<input\b[^>]*\bname=["']password["'][^>]*\bvalue=["'])[^"']*/gi, "$1[REDACTED_PASSWORD]")
    .replace(/(<input\b[^>]*\bvalue=["'])[^"']*(["'][^>]*\bname=["']password["'])/gi, "$1[REDACTED_PASSWORD]$2");
}

function parseLoginForm(html: string, pageUrl: string, expectedOrigin: string, label: string): ParsedLoginForm | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const form = doc.querySelector('form[action$="takelogin.php"][method="post"]') as HTMLFormElement | null;
  if (!form) {
    return null;
  }
  const actionUrl = new URL(form.getAttribute("action") || pageUrl, pageUrl);
  if (actionUrl.origin !== expectedOrigin) {
    throw new Error(`${label} 登录表单提交地址无效`);
  }
  const image = form.querySelector('img[alt="CAPTCHA"], img[src*="action=regimage"]') as HTMLImageElement | null;
  const rawImageUrl = image?.getAttribute("src");
  if (!rawImageUrl) {
    return null;
  }
  const imageUrl = new URL(rawImageUrl, pageUrl);
  if (imageUrl.origin !== expectedOrigin) {
    throw new Error(`${label} 验证码图片地址无效`);
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
  if (url.origin !== expectedOrigin) {
    return false;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const pageText = doc.body?.textContent || "";
  const hasLoginForm = !!doc.querySelector('form[action$="takelogin.php"][method="post"]');
  const hasAuthenticatedMarker =
    !!doc.querySelector('a[href*="logout.php"]') ||
    (pageText.includes("欢迎回来") && !!doc.querySelector('a[href*="userdetails.php"]'));
  const explicitlyAlreadyLoggedIn = !hasLoginForm && hasNexusAlreadyLoggedInMarker(pageText);
  return hasAuthenticatedMarker || explicitlyAlreadyLoggedIn;
}

function resolveNexusCaptchaOrigin(siteUrl: string | undefined, site: NexusCaptchaSite): string {
  let url: URL;
  try {
    url = new URL(siteUrl?.trim() || site.defaultUrl);
  } catch {
    throw new Error(`${site.label} 站点地址无效`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== site.host ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new Error(`${site.label} 自动登录拒绝非本站 HTTPS 地址`);
  }
  return url.origin;
}

async function handleNexusCaptchaLogin(
  data: NexusCaptchaLoginRequest,
  site: NexusCaptchaSite,
): Promise<BtschoolOffscreenResult> {
  try {
    const result = await loginNexusCaptcha(data, site);
    return { success: true, ...result };
  } catch (error) {
    const loginError = error instanceof NexusCaptchaLoginError ? error : null;
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      diagnostic: loginError?.diagnostic,
    };
  }
}

onMessage("loginBtschool", async ({ data }: { data: NexusCaptchaLoginRequest }): Promise<BtschoolOffscreenResult> => {
  return handleNexusCaptchaLogin(data, BTSCHOOL_SITE);
});

onMessage("loginCrabpt", async ({ data }: { data: NexusCaptchaLoginRequest }): Promise<BtschoolOffscreenResult> => {
  return handleNexusCaptchaLogin(data, CRABPT_SITE);
});

onMessage("loginPtCafe", async ({ data }: { data: NexusCaptchaLoginRequest }): Promise<BtschoolOffscreenResult> => {
  return handleNexusCaptchaLogin(data, PTCAFE_SITE);
});

interface MultiSiteLoginRequest extends NexusCaptchaLoginRequest {
  siteKey: string;
  definition: SiteLoginDefinition;
  twoFactorSecret?: string;
}

const MULTI_CAPTCHA_ERROR = /图片代码无效|圖片代碼無效|图片代码已被清除|圖片代碼已被清除/i;
const MULTI_CREDENTIAL_ERROR =
  /用户名或密码不正确|用戶名或密碼不正確|还没有通过验证|還沒有通過驗證|身份凭据与站点记录不符合|账号或密码错误|帳號或密碼錯誤/i;
const MULTI_TWO_FACTOR_ERROR =
  /两步验证码错误|兩步驗證碼錯誤|两步验证码未输入|兩步驗證碼未輸入|两步验证\s*code\s*无效|兩步驗證\s*code\s*無效|(?:2FA|二步验证|二步驗證|两步验证|兩步驗證|动态口令).{0,24}(?:错误|錯誤|无效|無效|失败|失敗)/i;
const MULTI_TURNSTILE_ERROR =
  /Verify not success|Turnstile.{0,24}(?:error|failed|invalid)|Are you a bot|(?:Cloudflare|安全|人机|人機).{0,24}(?:验证|驗證).{0,16}(?:失败|失敗|无效|無效)/i;

async function loginMultiSite(request: MultiSiteLoginRequest): Promise<{
  message: string;
  raw?: Record<string, unknown>;
}> {
  const definition = request.definition;
  if (!definition || definition.key !== request.siteKey.trim().toLowerCase()) {
    throw new Error(`站点 ${request.siteKey} 暂未配置 Depiler 登录适配器`);
  }
  const username = request.username?.trim();
  const password = request.password;
  const twoFactorSecret = request.twoFactorSecret?.trim();
  if (!username || !password) {
    throw new Error(`${definition.label}自动登录缺少用户名或密码`);
  }

  const origin = resolveSiteLoginOrigin(definition, request.siteUrl);
  const loginUrl = new URL(definition.loginPath || "/login.php", origin).toString();
  const maximumAttempts = definition.imageCaptcha ? 2 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const loginResponse = await fetch(loginUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    const loginHtml = await loginResponse.text();
    if (!loginResponse.ok) {
      return failMultiSite(
        definition.label,
        `${definition.label}登录页请求失败: HTTP ${loginResponse.status}`,
        "login-page-http",
        loginResponse,
        loginHtml,
        [username, password, twoFactorSecret || ""],
      );
    }
    if (isMultiSiteLoginSuccess(loginResponse.url, loginHtml, definition)) {
      return {
        message: `${definition.label}当前浏览器会话已登录`,
        raw: { attempts: attempt - 1, alreadyLoggedIn: true },
      };
    }

    const doc = new DOMParser().parseFromString(loginHtml, "text/html");
    const form = doc.querySelector<HTMLFormElement>(
      definition.formSelector || 'form[action$="takelogin.php"][method="post"]',
    );
    if (!form) {
      return failMultiSite(
        definition.label,
        `${definition.label}登录页未找到登录表单`,
        detectCloudflare(loginHtml) ? "cloudflare-login-form-missing" : "login-form-missing",
        loginResponse,
        loginHtml,
        [username, password, twoFactorSecret || ""],
      );
    }
    const actionUrl = new URL(form.getAttribute("action") || loginUrl, loginUrl);
    if (actionUrl.origin !== origin) {
      throw new Error(`${definition.label}登录表单提交地址无效`);
    }
    const params = collectFormParams(form);
    params.set("username", username);
    if (!definition.challenge || form.querySelector('input[name="password"]')) {
      params.set("password", password);
    }

    let captchaCode = "";
    if (definition.imageCaptcha) {
      const image = form.querySelector<HTMLImageElement>('img[alt="CAPTCHA"], img[src*="action=regimage"]');
      const imageSource = image?.getAttribute("src");
      if (!imageSource) {
        return failMultiSite(
          definition.label,
          `${definition.label}登录页未找到验证码图片`,
          "captcha-image-missing",
          loginResponse,
          loginHtml,
          [username, password, twoFactorSecret || ""],
        );
      }
      const imageUrl = new URL(imageSource, loginUrl);
      if (imageUrl.origin !== origin) {
        throw new Error(`${definition.label}验证码图片地址无效`);
      }
      const imageResponse = await fetch(imageUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      });
      if (!imageResponse.ok) {
        if (attempt < maximumAttempts) {
          continue;
        }
        return failMultiSite(
          definition.label,
          `${definition.label}验证码图片请求失败: HTTP ${imageResponse.status}`,
          "captcha-image-http",
          loginResponse,
          loginHtml,
          [username, password, twoFactorSecret || ""],
        );
      }
      try {
        captchaCode = await recognizeCaptchaOffline(await imageResponse.blob());
      } catch {
        if (attempt < maximumAttempts) {
          continue;
        }
        return failMultiSite(
          definition.label,
          `${definition.label}本地OCR识别失败`,
          "captcha-ocr",
          loginResponse,
          loginHtml,
          [username, password, twoFactorSecret || ""],
        );
      }
      if (!CAPTCHA_CODE_PATTERN.test(captchaCode)) {
        if (attempt < maximumAttempts) {
          continue;
        }
        return failMultiSite(
          definition.label,
          `${definition.label}本地OCR结果格式无效`,
          "captcha-format",
          loginResponse,
          loginHtml,
          [username, password, twoFactorSecret || ""],
        );
      }
      params.set("imagestring", captchaCode);
    }

    if (definition.challenge) {
      const challengeResponse = await fetch(new URL("/api/challenge", origin), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Referer: loginUrl,
        },
        body: JSON.stringify({ username }),
      });
      const challengeText = await challengeResponse.text();
      let challengeData: {
        ret?: number;
        msg?: string;
        data?: { secret?: string; challenge?: string };
      };
      try {
        challengeData = JSON.parse(challengeText) as typeof challengeData;
      } catch {
        return failMultiSite(
          definition.label,
          `${definition.label}登录挑战接口返回无效内容`,
          "challenge-response-invalid",
          challengeResponse,
          challengeText,
          [username, password, twoFactorSecret || ""],
        );
      }
      const serverSecret = challengeData.data?.secret;
      const challenge = challengeData.data?.challenge;
      if (!challengeResponse.ok || challengeData.ret !== 0 || !serverSecret || !challenge) {
        throw new Error(challengeData.msg || `${definition.label}登录挑战获取失败`);
      }
      const clientHashedPassword = await sha256Hex(password);
      const serverSideHash = await sha256Hex(serverSecret + clientHashedPassword);
      params.set("response", await hmacSha256Hex(challenge, serverSideHash));
    }

    let twoFactorCode = "";
    if (definition.twoFactorField && twoFactorSecret) {
      twoFactorCode = await generateTotp(twoFactorSecret, 5);
      params.set(definition.twoFactorField, twoFactorCode);
    }

    const submitResponse = await fetch(actionUrl, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: loginUrl,
      },
      body: params,
    });
    const resultHtml = await submitResponse.text();
    const secrets = [
      username,
      password,
      twoFactorSecret || "",
      twoFactorCode,
      captchaCode,
      params.get("response") || "",
    ];
    if (!submitResponse.ok) {
      return failMultiSite(
        definition.label,
        `${definition.label}登录提交失败: HTTP ${submitResponse.status}`,
        "login-submit-http",
        submitResponse,
        resultHtml,
        secrets,
      );
    }
    if (isMultiSiteLoginSuccess(submitResponse.url, resultHtml, definition)) {
      return {
        message: `${definition.label}自动登录成功`,
        raw: { attempts: attempt, usedTwoFactor: !!twoFactorSecret, challenge: !!definition.challenge },
      };
    }
    const resultText = new DOMParser().parseFromString(resultHtml, "text/html").body?.textContent || resultHtml;
    if (MULTI_CAPTCHA_ERROR.test(resultText) && attempt < maximumAttempts) {
      continue;
    }
    const outcome = classifyMultiSiteFailure(resultText);
    const messages: Record<string, string> = {
      "captcha-error": `${definition.label}图片验证码错误`,
      "credential-error": `${definition.label}用户名或密码不正确`,
      "two-factor-error": `${definition.label}2FA验证码错误，请检查2FA密钥和系统时间`,
      "turnstile-error": `${definition.label}Cloudflare Turnstile验证未通过`,
      "login-result-unknown": `${definition.label}登录结果无法确认`,
    };
    return failMultiSite(definition.label, messages[outcome], outcome, submitResponse, resultHtml, secrets);
  }
  throw new Error(`${definition.label}自动登录失败`);
}

function collectFormParams(form: HTMLFormElement): URLSearchParams {
  const params = new URLSearchParams();
  for (const input of Array.from(form.querySelectorAll<HTMLInputElement>("input[name]"))) {
    if (input.disabled || ["button", "image", "file", "reset", "submit"].includes(input.type.toLowerCase())) {
      continue;
    }
    if (["checkbox", "radio"].includes(input.type.toLowerCase()) && !input.checked) {
      continue;
    }
    params.set(input.name, input.value || "");
  }
  return params;
}

function classifyMultiSiteFailure(text: string): string {
  if (MULTI_CAPTCHA_ERROR.test(text)) {
    return "captcha-error";
  }
  if (MULTI_TWO_FACTOR_ERROR.test(text)) {
    return "two-factor-error";
  }
  if (MULTI_TURNSTILE_ERROR.test(text)) {
    return "turnstile-error";
  }
  if (MULTI_CREDENTIAL_ERROR.test(text)) {
    return "credential-error";
  }
  return "login-result-unknown";
}

function isMultiSiteLoginSuccess(finalUrl: string, html: string, definition: SiteLoginDefinition): boolean {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch {
    return false;
  }
  if (!definition.hosts.includes(url.hostname.toLowerCase())) {
    return false;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (definition.unit3d) {
    return !!doc.querySelector('form[action$="/logout"]');
  }
  const text = doc.body?.textContent || "";
  const formSelector = definition.formSelector || 'form[action$="takelogin.php"][method="post"]';
  const authenticated =
    !!doc.querySelector('a[href*="logout.php"], [data-url*="logout.php"]') ||
    ((text.includes("欢迎回来") || text.includes("歡迎回來")) && !!doc.querySelector('a[href*="userdetails.php"]'));
  const explicitlyAlreadyLoggedIn =
    !doc.querySelector(formSelector) && hasNexusAlreadyLoggedInMarker(text, definition.alreadyLoggedInMarkers);
  return authenticated || explicitlyAlreadyLoggedIn;
}

function detectCloudflare(html: string): boolean {
  const lower = html.toLowerCase();
  return ["cf-chl", "challenge-platform", "cf-turnstile", "just a moment", "checking your browser"].some((marker) =>
    lower.includes(marker),
  );
}

function failMultiSite(
  label: string,
  message: string,
  stage: string,
  response: Response,
  html: string,
  secrets: string[],
): never {
  let sanitized = html;
  for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  sanitized = sanitized
    .replace(
      /(<input\b[^>]*\bname=["'](?:password|imagestring|two_step_code|scode|2fa|response|_token|cf-turnstile-response)["'][^>]*\bvalue=["'])[^"']*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(<input\b[^>]*\bvalue=["'])[^"']*(["'][^>]*\bname=["'](?:password|imagestring|two_step_code|scode|2fa|response|_token|cf-turnstile-response)["'])/gi,
      "$1[REDACTED]$2",
    );
  const headers = Object.fromEntries(
    [...response.headers.entries()].filter(
      ([name]) => !["set-cookie", "cookie", "authorization"].includes(name.toLowerCase()),
    ),
  );
  const diagnostic = {
    stage,
    status: response.status,
    finalUrl: response.url,
    redirected: response.redirected,
    headers,
    title: new DOMParser().parseFromString(sanitized, "text/html").title.trim(),
    htmlLength: sanitized.length,
    cloudflare: {
      detected: detectCloudflare(sanitized) || !!headers["cf-ray"] || /cloudflare/i.test(headers.server || ""),
      mitigated: headers["cf-mitigated"] || "",
      ray: headers["cf-ray"] || "",
      server: headers.server || "",
      challengeMarkers: [
        "cf-chl",
        "challenge-platform",
        "cf-turnstile",
        "just a moment",
        "attention required",
        "checking your browser",
        "cloudflare ray id",
      ].filter((marker) => sanitized.toLowerCase().includes(marker)),
    },
    html: sanitized,
  };
  console.error(`[${label}登录诊断] 页面内容`, diagnostic);
  throw new NexusCaptchaLoginError(message, diagnostic);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(message: string, keyValue: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

onMessage("loginMultiSite", async ({ data }): Promise<BtschoolOffscreenResult> => {
  try {
    const result = await loginMultiSite(data);
    return { success: true, ...result };
  } catch (error) {
    const loginError = error instanceof NexusCaptchaLoginError ? error : null;
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      diagnostic: loginError?.diagnostic,
    };
  }
});

onMessage("recognizeSiteLoginCaptcha", async ({ data }): Promise<{ code: string }> => {
  if (!data.base64 || data.base64.length > 3_000_000) {
    throw new Error("验证码图片数据无效");
  }
  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const contentType = data.contentType?.startsWith("image/") ? data.contentType : "image/png";
  const code = await recognizeCaptchaOffline(new Blob([bytes], { type: contentType }));
  return { code };
});
