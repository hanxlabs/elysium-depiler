export interface SiteLoginDefinition {
  key: string;
  label: string;
  hosts: string[];
  defaultUrl: string;
  imageCaptcha?: boolean;
  cloudflarePreflight?: boolean;
  turnstile?: boolean;
  challenge?: boolean;
  twoFactorField?: string;
  loginPath?: string;
  formSelector?: string;
  submitSelector?: string;
  revealSelector?: string;
  alreadyLoggedInMarkers?: string[];
  unit3d?: boolean;
}

const NEXUS_ALREADY_LOGGED_IN_MARKERS = [
  "你已经登录",
  "你已登录",
  "您已经登录",
  "您已登录",
  "你已经登陆",
  "你已登陆",
  "您已经登陆",
  "您已登陆",
  "你已經登入",
  "你已登入",
  "您已經登入",
  "您已登入",
  "you are already logged in",
  "you have already logged in",
];

export function hasNexusAlreadyLoggedInMarker(text: string, additionalMarkers: string[] = []): boolean {
  const normalizedText = text.toLowerCase();
  return [...NEXUS_ALREADY_LOGGED_IN_MARKERS, ...additionalMarkers].some((marker) =>
    normalizedText.includes(marker.toLowerCase()),
  );
}

export function resolveSiteLoginOrigin(definition: SiteLoginDefinition, siteUrl?: string): string {
  let url: URL;
  try {
    url = new URL(siteUrl?.trim() || definition.defaultUrl);
  } catch {
    throw new Error(`${definition.label}站点地址无效`);
  }
  if (
    url.protocol !== "https:" ||
    !definition.hosts.includes(url.hostname.toLowerCase()) ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  ) {
    throw new Error(`${definition.label}自动登录拒绝非本站 HTTPS 地址`);
  }
  return url.origin;
}
