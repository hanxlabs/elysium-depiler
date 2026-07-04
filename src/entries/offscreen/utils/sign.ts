import { onMessage } from "@/messages.ts";
import { logger } from "./logger.ts";

interface SignRequest {
  siteKey: string;
  signUrl: string;
}

interface SignResult {
  success: boolean;
  wafBlocked: boolean;
  statusCode: number;
  bodyPreview: string;
  message: string;
}

/**
 * 检测 HTML 是否为 WAF（Safeline/雷池）拦截页面
 */
function isWafBlockPage(html: string): boolean {
  return /safeline/i.test(html) || /slg-title/i.test(html) || /slg-bg/i.test(html) || /\.safeline\/static/i.test(html);
}

/**
 * 通过 fetch 执行签到（无 WAF 场景）
 */
async function signWithFetch(siteKey: string, signUrl: string): Promise<SignResult> {
  try {
    const isPter = siteKey.toLowerCase() === "pter";
    const response = await fetch(signUrl, {
      method: "GET",
      credentials: "include",
      headers: {
        "User-Agent": navigator.userAgent,
        Accept: isPter
          ? "application/json, text/javascript, */*; q=0.01"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": navigator.language || "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: isPter ? new URL("/index.php", signUrl).toString() : signUrl,
        ...(isPter ? { "X-Requested-With": "XMLHttpRequest" } : { "Upgrade-Insecure-Requests": "1" }),
      },
    });
    const text = await response.text();

    if (isWafBlockPage(text)) {
      logger({ msg: `[sign] fetch hit WAF block page: ${signUrl}` });
      return {
        success: false,
        wafBlocked: true,
        statusCode: response.status,
        bodyPreview: text.slice(0, 500),
        message: `签到被WAF拦截（雷池），HTTP ${response.status}`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        wafBlocked: false,
        statusCode: response.status,
        bodyPreview: text.slice(0, 500),
        message: `签到请求失败: HTTP ${response.status}`,
      };
    }

    const signResult = parseSignResult(text, siteKey);
    return {
      success: signResult.success,
      wafBlocked: false,
      statusCode: response.status,
      bodyPreview: text.slice(0, 500),
      message: signResult.message,
    };
  } catch (error: any) {
    return {
      success: false,
      wafBlocked: false,
      statusCode: 0,
      bodyPreview: "",
      message: `签到请求异常: ${error?.message ?? String(error)}`,
    };
  }
}

async function signLuckpt(signUrl: string): Promise<SignResult> {
  const firstResponse = await fetchLuckptPage(signUrl, "GET", signUrl);
  if (!firstResponse.success || firstResponse.wafBlocked) {
    return firstResponse;
  }

  const firstResult = parseSignResult(firstResponse.bodyPreview, "luckpt");
  if (firstResult.success) {
    return {
      ...firstResponse,
      bodyPreview: firstResponse.bodyPreview.slice(0, 500),
      message: firstResult.message,
    };
  }

  const form = parseLuckptAttendanceForm(firstResponse.bodyPreview, signUrl);
  if (!form) {
    return {
      ...firstResponse,
      bodyPreview: firstResponse.bodyPreview.slice(0, 500),
      success: false,
      message: "LuckPT签到未完成：未找到立即签到表单",
    };
  }

  const postResponse = await fetchLuckptPage(form.actionUrl, "POST", signUrl, form.params);
  if (!postResponse.success || postResponse.wafBlocked) {
    return postResponse;
  }

  const postResult = parseSignResult(postResponse.bodyPreview, "luckpt");
  return {
    ...postResponse,
    bodyPreview: postResponse.bodyPreview.slice(0, 500),
    success: postResult.success,
    message: postResult.message,
  };
}

async function fetchLuckptPage(
  url: string,
  method: "GET" | "POST",
  referer: string,
  params?: URLSearchParams,
): Promise<SignResult> {
  try {
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        "User-Agent": navigator.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": navigator.language || "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: referer,
        ...(method === "GET" ? { "Upgrade-Insecure-Requests": "1" } : { Origin: new URL(url).origin }),
      },
      body: method === "POST" ? (params ?? new URLSearchParams()) : undefined,
    });
    const text = await response.text();

    if (isWafBlockPage(text)) {
      logger({ msg: `[sign] LuckPT fetch hit WAF block page: ${url}` });
      return {
        success: false,
        wafBlocked: true,
        statusCode: response.status,
        bodyPreview: text,
        message: `签到被WAF拦截（雷池），HTTP ${response.status}`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        wafBlocked: false,
        statusCode: response.status,
        bodyPreview: text,
        message: `签到请求失败: HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      wafBlocked: false,
      statusCode: response.status,
      bodyPreview: text,
      message: "LuckPT签到页面请求完成",
    };
  } catch (error: any) {
    return {
      success: false,
      wafBlocked: false,
      statusCode: 0,
      bodyPreview: "",
      message: `签到请求异常: ${error?.message ?? String(error)}`,
    };
  }
}

function parseLuckptAttendanceForm(
  html: string,
  signUrl: string,
): { actionUrl: string; params: URLSearchParams } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const forms = Array.from(doc.querySelectorAll("form"));
  const form = forms.find((candidate) => {
    const method = (candidate.getAttribute("method") || "get").toLowerCase();
    const action = candidate.getAttribute("action") || "";
    const hasSubmit = Array.from(candidate.querySelectorAll("input")).some(
      (input) => input.getAttribute("value") === "立即签到",
    );
    return method === "post" && (!action || action.includes("attendance.php")) && hasSubmit;
  });
  if (!form) {
    return null;
  }

  const params = new URLSearchParams();
  for (const input of Array.from(form.querySelectorAll("input[name]")) as HTMLInputElement[]) {
    const type = (input.getAttribute("type") || "text").toLowerCase();
    if (["submit", "button", "image", "file"].includes(type)) {
      continue;
    }
    if ((type === "checkbox" || type === "radio") && !input.checked) {
      continue;
    }
    params.set(input.name, input.value || "");
  }
  for (const textarea of Array.from(form.querySelectorAll("textarea[name]")) as HTMLTextAreaElement[]) {
    params.set(textarea.name, textarea.value || "");
  }
  for (const select of Array.from(form.querySelectorAll("select[name]")) as HTMLSelectElement[]) {
    params.set(select.name, select.value || "");
  }

  return {
    actionUrl: new URL(form.getAttribute("action") || signUrl, signUrl).toString(),
    params,
  };
}

/**
 * 解析签到结果 HTML，判断签到成功/失败/已签到
 */
function parseSignResult(html: string, siteKey?: string): { success: boolean; message: string } {
  const jsonResult = parseJsonSignResult(html);
  if (jsonResult) {
    return jsonResult;
  }

  const text = html.toLowerCase();
  const normalizedSiteKey = siteKey?.toLowerCase();
  if (normalizedSiteKey === "luckpt" && isLuckptAttendanceSubmitPage(html)) {
    return { success: false, message: "LuckPT签到未完成：仍停留在立即签到入口页" };
  }

  // 签到成功关键字
  const successPatterns = [
    /签到成功/,
    /已签到/,
    /今日已签到/,
    /已经签到/,
    /您已签到/,
    /签到完成/,
    /签到获得/,
    /签到奖励/,
    /连续签到/,
    /获得.*魔力/,
    /获得.*幸运星/,
    /获得.*积分/,
    /获得.*金币/,
    /获得.*bonus/,
    /sign\s*in\s*success/i,
    /signed\s*successfully/i,
    /already\s*signed/i,
    /you\s*have\s*signed/i,
    /checkin\s*success/i,
    /check\s*in\s*success/i,
    /签到.*成功/,
  ];

  // 签到失败关键字
  const failPatterns = [
    /签到失败/,
    /签到未成功/,
    /不能签到/,
    /无法签到/,
    /请先登录/,
    /需要登录/,
    /not\s*logged\s*in/i,
    /please\s*login/i,
    /未登录/,
    /登录.*过期/,
    /session.*expired/i,
    /sign\s*failed/i,
    /checkin\s*failed/i,
    /无权/,
    /权限不足/,
    /forbidden/i,
    /unauthorized/i,
  ];

  for (const pattern of failPatterns) {
    if (pattern.test(text)) {
      return { success: false, message: `签到失败: ${pattern.toString().slice(1, -1)}` };
    }
  }

  for (const pattern of successPatterns) {
    if (pattern.test(text)) {
      return { success: true, message: "签到成功" };
    }
  }

  if (normalizedSiteKey === "luckpt") {
    return { success: false, message: "LuckPT签到未完成：未识别到签到成功结果" };
  }

  return { success: true, message: "签到请求已完成（未能识别具体结果）" };
}

function isLuckptAttendanceSubmitPage(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("form")).some((form) => {
    const method = (form.getAttribute("method") || "get").toLowerCase();
    const action = form.getAttribute("action") || "";
    const hasSubmit = Array.from(form.querySelectorAll("input")).some(
      (input) => input.getAttribute("value") === "立即签到",
    );
    return method === "post" && (!action || action.includes("attendance.php")) && hasSubmit;
  });
}

function parseJsonSignResult(text: string): { success: boolean; message: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const json = JSON.parse(trimmed);
    const message = [json.data, json.message].filter(Boolean).join(" ");
    return {
      success: json.status === "1" || /今日已签到|已签到|签到成功|连续签到|获得.*猫粮/.test(message),
      message: message || "签到请求已完成",
    };
  } catch {
    return null;
  }
}

function resolveSignUrl(siteKey: string, signUrl: string): string {
  if (siteKey.toLowerCase() !== "pter") {
    return signUrl;
  }
  return new URL("/attendance-ajax.php", signUrl).toString();
}

/**
 * 执行站点签到
 * 策略：通过 fetch 快速尝试，遇到 WAF 拦截时直接返回 wafBlocked 标志，
 * 由 background 层负责打开新标签页处理 WAF。
 */
async function doSiteSign(siteKey: string, signUrl: string): Promise<SignResult> {
  const resolvedSignUrl = resolveSignUrl(siteKey, signUrl);
  logger({ msg: `[sign] doSiteSign: ${siteKey}, url: ${resolvedSignUrl}` });
  if (siteKey.toLowerCase() === "luckpt") {
    return await signLuckpt(resolvedSignUrl);
  }
  return await signWithFetch(siteKey, resolvedSignUrl);
}

onMessage("doSiteSign", async ({ data }: { data: SignRequest }) => {
  return await doSiteSign(data.siteKey, data.signUrl);
});
