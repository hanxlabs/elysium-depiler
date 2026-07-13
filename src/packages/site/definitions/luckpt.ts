import type { ISiteMetadata } from "../types";
import { SchemaMetadata } from "../schemas/NexusPHP";
import { parseSizeString } from "../utils";

const transferInfoSelector = ["td.rowhead:contains('传输') + td", "#info_block"];
const bonusTableHeadSelector = "td.colhead:contains('奖励类型')";

const parseLuckptSize =
  (pattern: RegExp) =>
  (query: string): number => {
    const match = query.replace(/,/g, "").match(pattern);
    return match ? parseSizeString(match[1]) : 0;
  };

const parseLuckptNumber =
  (pattern: RegExp) =>
  (query: string): number => {
    const match = query.replace(/,/g, "").match(pattern);
    return match ? parseFloat(match[1]) : 0;
  };

const getLuckptCurrentSeeding = (element: Element): string | number => {
  const basicBonusCells = getLuckptBasicBonusCells(element);
  if (basicBonusCells.length >= 3) {
    return basicBonusCells[1].textContent?.trim() ?? 0;
  }

  const match = element.textContent?.replace(/\s+/g, " ").match(/当前活动[：:] *(\d+)/);
  return match?.[1] ?? 0;
};

const getLuckptCurrentSeedingSize = (element: Element): string | number => {
  const basicBonusCells = getLuckptBasicBonusCells(element);
  return basicBonusCells.length >= 3 ? (basicBonusCells[2].textContent?.trim() ?? 0) : 0;
};

const getLuckptBonusPerHour = (element: Element): string | number => {
  const totalCell = element.closest("table")?.querySelector("td[rowspan]");
  if (totalCell?.textContent) {
    return totalCell.textContent.trim();
  }

  const match = element.textContent?.replace(/,/g, "").match(/每小时能获取\s*([\d.]+)/);
  return match?.[1] ?? 0;
};

const getLuckptBasicBonusCells = (element: Element): Element[] => {
  const rows = Array.from(element.closest("table")?.querySelectorAll("tr") ?? []);
  const basicBonusRow = rows.find((row) => row.querySelector("td")?.textContent?.trim() === "基本奖励");
  return Array.from(basicBonusRow?.querySelectorAll("td") ?? []);
};

export const siteMetadata: ISiteMetadata = {
  ...SchemaMetadata,
  version: 1,

  id: "luckpt",
  name: "LuckPT",
  description: "汇聚多元精彩，启程旋律之旅。",
  tags: ["影视", "综合", "音乐"],
  timezoneOffset: "+0800",

  type: "private",
  schema: "NexusPHP",

  urls: ["https://pt.luckpt.de/"],

  userInfo: {
    ...SchemaMetadata.userInfo!,
    selectors: {
      ...SchemaMetadata.userInfo!.selectors!,
      id: {
        selector: [
          "td.rowhead:contains('用户ID/UID') + td",
          ...(SchemaMetadata.userInfo!.selectors!.id?.selector ?? []),
        ],
        elementProcess: (element: Element) => {
          const href = element.getAttribute("href");
          return href ? new URL(href, "https://pt.luckpt.de/").searchParams.get("id") : element.textContent?.trim();
        },
        filters: [{ name: "parseNumber" }],
      },
      name: {
        selector: [
          "#outer h1 .nowrap > b:first",
          "#outer h1 b:first",
          "#info_block a[href*='userdetails.php'] b:first",
        ],
      },
      messageCount: {
        text: 0,
        selector: "#info_block a[href*='messages.php']:has(img.inbox)",
        elementProcess: (element: Element) => element.parentElement?.textContent?.match(/(\d+)\s*\(/)?.[1] ?? 0,
        filters: [{ name: "parseNumber" }],
      },
      uploaded: {
        text: 0,
        selector: transferInfoSelector,
        filters: [parseLuckptSize(/(?:^|[^实际真实])上传量[：:]?\s*([\d.]+ ?[ZEPTGMK]?i?B)/)],
      },
      trueUploaded: {
        text: 0,
        selector: transferInfoSelector,
        filters: [parseLuckptSize(/(?:实际|真实)上传量[：:]?\s*([\d.]+ ?[ZEPTGMK]?i?B)/)],
      },
      downloaded: {
        text: 0,
        selector: transferInfoSelector,
        filters: [parseLuckptSize(/(?:^|[^实际真实])下载量[：:]?\s*([\d.]+ ?[ZEPTGMK]?i?B)/)],
      },
      trueDownloaded: {
        text: 0,
        selector: transferInfoSelector,
        filters: [parseLuckptSize(/(?:实际|真实)下载量[：:]?\s*([\d.]+ ?[ZEPTGMK]?i?B)/)],
      },
      ratio: {
        selector: transferInfoSelector,
        filters: [parseLuckptNumber(/(?:^|[^实际真实])分享率[：:]?\s*([\d.]+)/)],
      },
      levelName: {
        selector: [
          "td.rowhead:contains('等级') + td > img[title]",
          "td.rowhead:contains('等級') + td > img[title]",
          "td.rowhead:contains('Class') + td > img[title]",
        ],
        attr: "title",
      },
      bonus: {
        selector: ["td.rowhead:contains('魔力值') + td", "#info_block"],
        filters: [
          (query: string) => {
            const match = query.replace(/,/g, "").match(/(?:魔力值|幸运星)[^：:]*[：:]\s*([\d.]+)/);
            return match ? parseFloat(match[1]) : 0;
          },
        ],
      },
      seedingBonus: {
        selector: "td.rowhead:contains('做种积分') + td",
        filters: [{ name: "parseNumber" }],
      },
      seeding: {
        selector: [bonusTableHeadSelector, "#info_block"],
        elementProcess: getLuckptCurrentSeeding,
        filters: [{ name: "parseNumber" }],
      },
      seedingSize: {
        selector: bonusTableHeadSelector,
        elementProcess: getLuckptCurrentSeedingSize,
        filters: [{ name: "parseSize" }],
      },
      bonusPerHour: {
        selector: [bonusTableHeadSelector, "div:contains('你当前每小时能获取'):last"],
        elementProcess: getLuckptBonusPerHour,
        filters: [{ name: "parseNumber" }],
      },
    },
    process: SchemaMetadata.userInfo!.process!.map((process) => {
      if (process.requestConfig.url === "/userdetails.php") {
        return {
          ...process,
          fields: process.fields?.filter((field) => field !== "seeding" && field !== "seedingSize"),
        };
      }
      if (process.requestConfig.url === "/mybonus.php") {
        return {
          ...process,
          fields: ["bonusPerHour", "seeding", "seedingSize"],
        };
      }
      return process;
    }),
    donorConfig: {
      ...SchemaMetadata.userInfo!.donorConfig,
      bonusPerHourMultiplier: 1,
    },
  },

  levelRequirements: [
    {
      id: 0,
      name: "User",
      privilege: "新用户的默认级别。只能在每周六中午12点至每周日晚上11点59分发布种子。",
    },
    {
      id: 1,
      name: "Power User",
      interval: "P4W",
      downloaded: "100GB",
      seedingBonus: 120000,
      ratio: 1.05,
      privilege:
        "得到一个邀请名额；可以直接发布种子；可以查看NFO文档；可以查看用户列表；可以请求续种； 可以发送邀请； " +
        '可以查看排行榜；可以查看其它用户的种子历史(如果用户隐私等级未设置为"强")； 可以删除自己上传的字幕。',
    },
    {
      id: 2,
      name: "Elite User",
      interval: "P8W",
      downloaded: "200GB",
      seedingBonus: 320000,
      ratio: 1.55,
      privilege: "Elite User及以上用户封存账号后不会被删除。",
    },
    {
      id: 3,
      name: "Crazy User",
      interval: "P15W",
      downloaded: "500GB",
      seedingBonus: 600000,
      ratio: 2.05,
      privilege: "得到两个邀请名额；可以在做种/下载/发布的时候选择匿名模式。",
    },
    {
      id: 4,
      name: "Insane User",
      interval: "P25W",
      downloaded: "1000GB",
      seedingBonus: 1000000,
      ratio: 2.55,
      privilege: "可以查看普通日志。",
    },
    {
      id: 5,
      name: "Veteran User",
      interval: "P40W",
      downloaded: "1.6TB",
      seedingBonus: 1800000,
      ratio: 3.05,
      isKept: true,
      privilege: "得到三个邀请名额；可以查看其它用户的评论、帖子历史。Veteran User及以上用户会永远保留账号。",
    },
    {
      id: 6,
      name: "Extreme User",
      interval: "P60W",
      downloaded: "2.4TB",
      seedingBonus: 2600000,
      ratio: 3.55,
      isKept: true,
      privilege: "可以更新过期的外部信息；可以查看Extreme User论坛。",
    },
    {
      id: 7,
      name: "Ultimate User",
      interval: "P80W",
      downloaded: "3.0TB",
      seedingBonus: 3800000,
      ratio: 4.05,
      isKept: true,
      privilege: "得到五个邀请名额。",
    },
    {
      id: 8,
      name: "Nexus Master",
      interval: "P100W",
      downloaded: "4.9TB",
      seedingBonus: 5000000,
      ratio: 4.55,
      isKept: true,
      privilege: "得到十个邀请名额。",
    },
  ],
};
