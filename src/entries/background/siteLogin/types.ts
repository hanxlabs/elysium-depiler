export interface SiteLoginCredentials {
  username?: string;
  password?: string;
  code?: string;
  twoFactorSecret?: string;
}

export interface SiteLoginTarget {
  siteKey: string;
  siteName?: string;
  siteUrl?: string;
  credentials?: SiteLoginCredentials;
}

export interface SiteLoginResult {
  message: string;
  credential: {
    bearerToken?: string;
    cookie?: string;
    headers?: Record<string, string>;
  };
  raw?: Record<string, unknown>;
}

export interface SiteLoginAdapter {
  supports(site: SiteLoginTarget): boolean;
  login(site: SiteLoginTarget): Promise<SiteLoginResult>;
}
