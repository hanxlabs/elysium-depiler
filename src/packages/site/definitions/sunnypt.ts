import type { AxiosRequestConfig, AxiosResponse } from "axios";
import PrivateSite from "../schemas/AbstractPrivateSite.ts";
import type { ISiteMetadata, ITorrent } from "../types";

interface ISunnyPtResponse<T> {
  code: number;
  data: T;
  msg?: string;
}

const toEpochMilliseconds = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const siteMetadata: ISiteMetadata = {
  version: 3,
  id: "sunnypt",
  name: "Sunny",
  aka: ["SunnyPT", "阳光"],
  description: "The Ultimate File Sharing Experience",
  tags: ["影视", "综合"],
  timezoneOffset: "+0800",
  favicon: "./sunnypt.ico",
  collaborator: ["yanleichang"],
  type: "private",
  schema: "SunnyPT",
  urls: ["uggcf://fhaalcg.gbc/"],

  search: {
    keywordPath: "params.keyword",
    requestConfig: {
      method: "GET",
      url: "/torrents",
      responseType: "json",
      params: { page: 1, page_size: 100, sort: "created_at", order: "desc" },
    },
    selectors: {
      rows: { selector: "data.items" },
      id: { selector: "id", filters: [{ name: "parseNumber" }] },
      title: { selector: "title" },
      subTitle: { selector: "subtitle" },
      url: { selector: "details_url" },
      time: { selector: "created_at", filters: [toEpochMilliseconds] },
      size: { selector: "size", filters: [{ name: "parseSize" }] },
      seeders: { selector: "seeders", filters: [{ name: "parseNumber" }] },
      leechers: { selector: "leechers", filters: [{ name: "parseNumber" }] },
      completed: { selector: "completed", filters: [{ name: "parseNumber" }] },
    },
  },

  userInfo: {
    pickLast: ["id", "name", "joinTime"],
    process: [
      {
        requestConfig: { method: "GET", url: "/profile", responseType: "json" },
        selectors: {
          id: { selector: "data.id", filters: [{ name: "parseNumber" }] },
          name: { selector: "data.username" },
          joinTime: { selector: "data.registered_at", filters: [toEpochMilliseconds] },
          uploaded: { selector: "data.uploaded", filters: [{ name: "parseSize" }] },
          downloaded: { selector: "data.downloaded", filters: [{ name: "parseSize" }] },
          ratio: { selector: "data.ratio", filters: [{ name: "parseNumber" }] },
          bonus: { selector: "data.bonus", filters: [{ name: "parseNumber" }] },
          seeding: { selector: "data.seeding_count", filters: [{ name: "parseNumber" }] },
          seedingSize: { selector: "data.seeding_size", filters: [{ name: "parseSize" }] },
          leeching: { selector: "data.leeching_count", filters: [{ name: "parseNumber" }] },
          messageCount: { selector: "data.unread_messages", filters: [{ name: "parseNumber" }] },
          levelName: { selector: "data.level" },
        },
      },
    ],
  },
};

/** SunnyPT 的公开集成 API 走 /api/v1/mp 并使用 X-API-Key。 */
export default class SunnyPT extends PrivateSite {
  get apiBaseUrl(): string {
    return "https://api.sunnypt.top/api/v1/mp/";
  }

  public override async request<T>(
    axiosConfig: AxiosRequestConfig,
    checkLogin: boolean = true,
  ): Promise<AxiosResponse<T>> {
    axiosConfig.baseURL = this.apiBaseUrl;
    axiosConfig.responseType ??= "json";
    axiosConfig.headers = {
      ...(axiosConfig.headers ?? {}),
      "X-API-Key": this.userConfig.inputSetting?.apiKey ?? "",
    };
    return super.request<T>(axiosConfig, checkLogin);
  }

  protected override loggedCheck(raw: AxiosResponse<ISunnyPtResponse<unknown>>): boolean {
    return raw.status >= 200 && raw.status < 300 && raw.data?.code === 0;
  }

  protected override fixLink(uri: string, requestConfig: AxiosRequestConfig): string {
    return super.fixLink(uri, { ...requestConfig, baseURL: this.url });
  }

  public override async getTorrentDownloadLink(torrent: ITorrent): Promise<string> {
    const response = await this.request<ISunnyPtResponse<{ download_url?: string }>>(
      {
        method: "POST",
        url: `/torrents/${encodeURIComponent(String(torrent.id))}/download-token`,
        responseType: "json",
      },
      false,
    );
    return response.data?.data?.download_url ?? "";
  }
}
