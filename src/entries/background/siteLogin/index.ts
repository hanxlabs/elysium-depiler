import { sunnyPtLoginAdapter } from "./sunnypt.ts";
import type { SiteLoginAdapter, SiteLoginResult, SiteLoginTarget } from "./types.ts";

const adapters: SiteLoginAdapter[] = [sunnyPtLoginAdapter];

export async function loginSite(site: SiteLoginTarget): Promise<SiteLoginResult> {
  const adapter = adapters.find((candidate) => candidate.supports(site));
  if (!adapter) {
    throw new Error(`站点 ${site.siteKey} 暂未配置 Depiler 登录适配器`);
  }
  return adapter.login(site);
}

export type { SiteLoginCredentials, SiteLoginTarget } from "./types.ts";
