import { sendMessage } from "@/messages.ts";
import { generateTotp } from "@/shared/totp.ts";
import { hasNexusAlreadyLoggedInMarker, type SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";

interface PterLoginMessage {
  type: "elysiumPterLogin";
  action: "inspect" | "prepare" | "submit";
  username?: string;
  password?: string;
  twoFactorSecret?: string;
}

interface PterPageState {
  state: "success" | "login" | "turnstile_error" | "credential_error" | "two_factor_error" | "unknown";
  title: string;
  url: string;
}

const PTER_HOST = "pterclub.net";
const FORM_SELECTOR = 'form[action$="takelogin.php"][method="post"]';
const TURNSTILE_RESPONSE_SELECTOR = '[name="cf-turnstile-response"], input[name^="cf_chl_"]';

chrome.runtime.onMessage.addListener(
  (message: PterLoginMessage, _sender, sendResponse: (response: Record<string, unknown>) => void) => {
    if (message?.type !== "elysiumPterLogin") {
      return false;
    }
    if (location.protocol !== "https:" || location.hostname !== PTER_HOST) {
      sendResponse({ success: false, message: "猫站登录消息拒绝非本站页面" });
      return false;
    }
    void handlePterLoginMessage(message)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  },
);

async function handlePterLoginMessage(message: PterLoginMessage): Promise<Record<string, unknown>> {
  if (message.action === "inspect") {
    return { ...inspectPterPage() };
  }
  if (message.action === "prepare") {
    const username = message.username?.trim();
    const password = message.password;
    if (!username || !password) {
      throw new Error("猫站自动登录缺少用户名或密码");
    }
    const state = inspectPterPage();
    if (state.state === "success") {
      return { ready: true, alreadyLoggedIn: true };
    }
    const form = document.querySelector<HTMLFormElement>(FORM_SELECTOR);
    if (!form) {
      throw new Error("猫站登录页未找到登录表单");
    }
    setFieldValue(form.querySelector<HTMLInputElement>('input[name="username"]'), username);
    setFieldValue(form.querySelector<HTMLInputElement>('input[name="password"]'), password);
    await waitForTurnstileToken(120_000);

    const twoFactorSecret = message.twoFactorSecret?.trim();
    const twoFactorInput = form.querySelector<HTMLInputElement>('input[name="2fa_secret"]');
    if (twoFactorSecret) {
      const code = await generateTotp(twoFactorSecret, 5);
      setFieldValue(twoFactorInput, code);
    } else if (twoFactorInput) {
      setFieldValue(twoFactorInput, "");
    }
    return { ready: true, hasTwoFactorCode: !!twoFactorSecret };
  }
  if (message.action === "submit") {
    const form = document.querySelector<HTMLFormElement>(FORM_SELECTOR);
    const submit = form?.querySelector<HTMLInputElement>('input[type="submit"][value="登录"]');
    if (!form || !submit) {
      throw new Error("猫站登录页未找到提交按钮");
    }
    setTimeout(() => form.requestSubmit(submit), 0);
    return { submitted: true };
  }
  throw new Error("不支持的猫站登录操作");
}

function inspectPterPage(): PterPageState {
  const text = document.body?.innerText || "";
  const hasLoginForm = !!document.querySelector(FORM_SELECTOR);
  const hasAuthenticatedMarker =
    !!document.querySelector('a[href*="logout.php"], [data-url*="logout.php"]') ||
    (text.includes("欢迎回来") && !!document.querySelector('a[href*="userdetails.php"]'));
  const explicitlyAlreadyLoggedIn = !hasLoginForm && hasNexusAlreadyLoggedInMarker(text);
  let state: PterPageState["state"] = "unknown";
  if (hasAuthenticatedMarker || explicitlyAlreadyLoggedIn) {
    state = "success";
  } else if (/Verify not success|验证未通过|Are you a bot\?/i.test(text)) {
    state = "turnstile_error";
  } else if (/用户名或密码不正确|还没有通过验证/.test(text)) {
    state = "credential_error";
  } else if (
    /(?:2FA|二步验证|两步验证|动态口令).{0,20}(?:错误|无效|失败)|(?:错误|无效|失败).{0,20}(?:2FA|二步验证|两步验证|动态口令)/i.test(
      text,
    )
  ) {
    state = "two_factor_error";
  } else if (hasLoginForm) {
    state = "login";
  }
  return { state, title: document.title, url: location.href };
}

function setFieldValue(field: HTMLInputElement | null, value: string): void {
  if (!field) {
    throw new Error("猫站登录页缺少必要输入框");
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitForTurnstileToken(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(TURNSTILE_RESPONSE_SELECTOR);
    if (field?.value.trim()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("猫站Cloudflare Turnstile验证等待超时");
}

interface MultiSiteLoginMessage {
  type: "elysiumMultiSiteLogin";
  siteKey: string;
  definition: SiteLoginDefinition;
  action: "inspect" | "prepare" | "submit";
  username?: string;
  password?: string;
  twoFactorSecret?: string;
}

chrome.runtime.onMessage.addListener(
  (message: MultiSiteLoginMessage, _sender, sendResponse: (response: Record<string, unknown>) => void) => {
    if (message?.type !== "elysiumMultiSiteLogin") {
      return false;
    }
    const definition = message.definition;
    if (
      !definition ||
      definition.key !== message.siteKey?.trim().toLowerCase() ||
      location.protocol !== "https:" ||
      !definition.hosts.includes(location.hostname.toLowerCase())
    ) {
      sendResponse({ success: false, message: "站点登录消息拒绝非配置页面" });
      return false;
    }
    void handleMultiSiteLoginMessage(message)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  },
);

async function handleMultiSiteLoginMessage(message: MultiSiteLoginMessage): Promise<Record<string, unknown>> {
  const definition = message.definition;
  if (!definition || definition.key !== message.siteKey.trim().toLowerCase()) {
    throw new Error(`站点 ${message.siteKey} 暂未配置自动登录`);
  }
  if (message.action === "inspect") {
    return inspectMultiSitePage(definition);
  }
  const formSelector = definition.formSelector || 'form[action$="takelogin.php"][method="post"]';
  if (message.action === "prepare") {
    const username = message.username?.trim();
    const password = message.password;
    if (!username || !password) {
      throw new Error(`${definition.label}自动登录缺少用户名或密码`);
    }
    if (inspectMultiSitePage(definition).state === "success") {
      return { ready: true, alreadyLoggedIn: true };
    }
    if (definition.revealSelector) {
      document.querySelector<HTMLElement>(definition.revealSelector)?.click();
    }
    const form = await waitForElement<HTMLFormElement>(formSelector, 10_000);
    setMultiSiteField(form.querySelector<HTMLInputElement>('input[name="username"]'), username, definition.label);
    setMultiSiteField(form.querySelector<HTMLInputElement>('input[type="password"]'), password, definition.label);
    if (definition.turnstile) {
      await waitForMultiSiteTurnstileToken(120_000, definition.label);
    }
    if (definition.imageCaptcha) {
      const captchaCode = await recognizeMultiSiteCaptcha(form, definition);
      setMultiSiteField(
        form.querySelector<HTMLInputElement>('input[name="imagestring"]'),
        captchaCode,
        definition.label,
      );
    }
    const twoFactorSecret = message.twoFactorSecret?.trim();
    if (definition.twoFactorField && twoFactorSecret) {
      const code = await generateTotp(twoFactorSecret, 5);
      setMultiSiteField(
        form.querySelector<HTMLInputElement>(`input[name="${definition.twoFactorField}"]`),
        code,
        definition.label,
      );
    } else if (definition.twoFactorField) {
      const field = form.querySelector<HTMLInputElement>(`input[name="${definition.twoFactorField}"]`);
      if (field) {
        setMultiSiteField(field, "", definition.label);
      }
    }
    return { ready: true, usedTwoFactor: !!(definition.twoFactorField && twoFactorSecret) };
  }
  if (message.action === "submit") {
    const form = document.querySelector<HTMLFormElement>(formSelector);
    const submit = form?.querySelector<HTMLElement>(definition.submitSelector || "#submit-btn");
    if (!form || !submit) {
      throw new Error(`${definition.label}登录页未找到提交按钮`);
    }
    setTimeout(() => submit.click(), 0);
    return { submitted: true };
  }
  throw new Error("不支持的站点登录操作");
}

function inspectMultiSitePage(definition: SiteLoginDefinition): Record<string, unknown> {
  const text = document.body?.innerText || "";
  const lowerHtml = document.documentElement?.innerHTML.toLowerCase() || "";
  const formSelector = definition.formSelector || 'form[action$="takelogin.php"][method="post"]';
  const hasLoginForm = !!document.querySelector(formSelector);
  const authenticated = definition.unit3d
    ? !!document.querySelector('form[action$="/logout"]')
    : !!document.querySelector('a[href*="logout.php"], [data-url*="logout.php"]') ||
      ((text.includes("欢迎回来") || text.includes("歡迎回來")) &&
        !!document.querySelector('a[href*="userdetails.php"]'));
  const explicitlyAlreadyLoggedIn =
    !definition.unit3d && !hasLoginForm && hasNexusAlreadyLoggedInMarker(text, definition.alreadyLoggedInMarkers);
  let state = "unknown";
  if (authenticated || explicitlyAlreadyLoggedIn) {
    state = "success";
  } else if (/图片代码无效|圖片代碼無效|图片代码已被清除|圖片代碼已被清除/i.test(text)) {
    state = "captcha_error";
  } else if (
    /两步验证码错误|兩步驗證碼錯誤|两步验证码未输入|兩步驗證碼未輸入|两步验证\s*code\s*无效|兩步驗證\s*code\s*無效|(?:2FA|二步验证|二步驗證|两步验证|兩步驗證|动态口令).{0,24}(?:错误|錯誤|无效|無效|失败|失敗)/i.test(
      text,
    )
  ) {
    state = "two_factor_error";
  } else if (
    /Verify not success|Turnstile.{0,24}(?:error|failed|invalid)|Are you a bot|(?:Cloudflare|安全|人机|人機).{0,24}(?:验证|驗證).{0,16}(?:失败|失敗|无效|無效)/i.test(
      text,
    )
  ) {
    state = "turnstile_error";
  } else if (
    /用户名或密码不正确|用戶名或密碼不正確|还没有通过验证|還沒有通過驗證|身份凭据与站点记录不符合|账号或密码错误|帳號或密碼錯誤/i.test(
      text,
    )
  ) {
    state = "credential_error";
  } else if (
    ["cf-chl", "challenge-platform", "just a moment", "checking your browser", "cloudflare ray id"].some((marker) =>
      lowerHtml.includes(marker),
    )
  ) {
    state = "cloudflare";
  } else if (hasLoginForm) {
    state = "login";
  }
  return {
    state,
    title: document.title,
    url: location.href,
    bodyPreview: text.slice(0, 12_000),
    cloudflareMarkers: [
      "cf-chl",
      "challenge-platform",
      "cf-turnstile",
      "just a moment",
      "checking your browser",
      "cloudflare ray id",
    ].filter((marker) => lowerHtml.includes(marker)),
  };
}

function setMultiSiteField(field: HTMLInputElement | null, value: string, label: string): void {
  if (!field) {
    throw new Error(`${label}登录页缺少必要输入框`);
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

async function recognizeMultiSiteCaptcha(form: HTMLFormElement, definition: SiteLoginDefinition): Promise<string> {
  const image = form.querySelector<HTMLImageElement>('img[alt="CAPTCHA"], img[src*="action=regimage"]');
  const imageSource = image?.getAttribute("src");
  if (!imageSource) {
    throw new Error(`${definition.label}登录页未找到验证码图片`);
  }
  const imageUrl = new URL(imageSource, location.href);
  if (imageUrl.origin !== location.origin || !definition.hosts.includes(imageUrl.hostname.toLowerCase())) {
    throw new Error(`${definition.label}验证码图片地址无效`);
  }
  const response = await fetch(imageUrl.toString(), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
  });
  if (!response.ok) {
    throw new Error(`${definition.label}验证码图片请求失败: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) {
    throw new Error(`${definition.label}验证码图片大小无效`);
  }
  const result = await sendMessage("recognizeSiteLoginCaptcha", {
    base64: bytesToBase64(bytes),
    contentType: response.headers.get("content-type") || "image/png",
  });
  const code = result.code?.trim() || "";
  if (!/^[A-Za-z0-9]{3,8}$/.test(code)) {
    throw new Error(`${definition.label}验证码识别结果格式无效`);
  }
  return code;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function waitForMultiSiteTurnstileToken(timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(TURNSTILE_RESPONSE_SELECTOR);
    if (field?.value.trim()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label}Cloudflare Turnstile验证等待超时`);
}

async function waitForElement<T extends Element>(selector: string, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = document.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("登录页未找到登录表单");
}
