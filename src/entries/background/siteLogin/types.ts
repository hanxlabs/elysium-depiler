export interface SiteLoginCredentials {
  username?: string;
  password?: string;
  code?: string;
}

export interface SiteLoginTarget {
  siteKey: string;
  siteName?: string;
  siteUrl?: string;
  credentials?: SiteLoginCredentials;
}

export interface SiteLoginResult {
  message: string;
  credential: Record<string, string>;
  raw?: Record<string, unknown>;
}

export interface SiteLoginAdapter {
  supports(site: SiteLoginTarget): boolean;
  login(site: SiteLoginTarget): Promise<SiteLoginResult>;
}
