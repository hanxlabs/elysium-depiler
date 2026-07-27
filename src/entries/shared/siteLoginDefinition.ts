export interface SiteLoginDefinition {
  key: string;
  label: string;
  hosts: string[];
  defaultUrl: string;
  imageCaptcha?: boolean;
  turnstile?: boolean;
  challenge?: boolean;
  twoFactorField?: string;
  loginPath?: string;
  formSelector?: string;
  submitSelector?: string;
  revealSelector?: string;
  unit3d?: boolean;
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
