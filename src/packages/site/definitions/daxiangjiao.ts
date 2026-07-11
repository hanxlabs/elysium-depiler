import type { ISiteMetadata } from "../types";
import { CategoryInclbookmarked, CategoryIncldead, CategorySpstate, SchemaMetadata } from "../schemas/NexusPHP";

export const siteMetadata: ISiteMetadata = {
  ...SchemaMetadata,

  version: 1,
  id: "daxiangjiao",
  name: "DaXiangJiao",
  aka: ["大象蕉"],
  description: "DaXiangJiao 私有资源分享站",
  tags: ["影视", "综合", "成人"],
  timezoneOffset: "+0800",

  type: "private",
  schema: "NexusPHP",

  urls: ["https://pt.daxiangjiao.org/"],
  favicon: "https://pt.daxiangjiao.org/favicon.ico",

  category: [
    {
      name: "搜索入口",
      key: "#url",
      options: [
        { name: "普通区", value: "/torrents.php" },
        { name: "特色区", value: "/special.php" },
      ],
    },
    {
      name: "分类（普通区）",
      key: "cat_normal",
      notes: "请先选择普通区入口。",
      options: [
        { value: 401, name: "电影" },
        { value: 402, name: "电视剧" },
        { value: 403, name: "综艺" },
        { value: 404, name: "纪录片" },
        { value: 405, name: "动漫" },
        { value: 406, name: "MV" },
        { value: 407, name: "体育" },
        { value: 408, name: "音乐" },
        { value: 409, name: "其他" },
      ],
      cross: { mode: "append", key: "cat" },
    },
    {
      name: "分类（特色区）",
      key: "cat_special",
      notes: "请先选择特色区入口。",
      options: [
        { value: 410, name: "日韩" },
        { value: 411, name: "国产" },
        { value: 412, name: "欧美" },
      ],
      cross: { mode: "append", key: "cat" },
    },
    CategoryIncldead,
    CategorySpstate,
    CategoryInclbookmarked,
  ],

  searchEntry: {
    area_normal: { name: "普通区", requestConfig: { url: "/torrents.php" } },
    area_special: { name: "特色区", requestConfig: { url: "/special.php" } },
  },

  userInfo: {
    ...SchemaMetadata.userInfo!,
    selectors: {
      ...SchemaMetadata.userInfo!.selectors!,
      levelName: {
        selector: [
          "td.rowhead:contains('等级') + td > img[title]",
          "td.rowhead:contains('等級') + td > img[title]",
          "td.rowhead:contains('Class') + td > img[title]",
        ],
        attr: "title",
      },
      bonusPerHour: {
        selector: ["table:has(td:contains('奖励类型')):has(td:contains('合计')) td[rowspan]"],
        filters: [{ name: "parseNumber" }],
      },
    },
    donorConfig: {
      ...SchemaMetadata.userInfo!.donorConfig,
      bonusPerHourMultiplier: 1,
    },
  },

  levelRequirements: [
    { id: 1, name: "Peasant", privilege: "分享率过低时的降级用户。" },
    { id: 2, name: "User", privilege: "新用户的默认级别。" },
    {
      id: 3,
      name: "Power User",
      interval: "P4W",
      downloaded: "50GB",
      ratio: 1.05,
      privilege: "得到一个邀请名额；可以直接发布种子；可以查看用户列表、排行榜和种子历史。",
    },
    {
      id: 4,
      name: "Elite User",
      interval: "P8W",
      downloaded: "120GB",
      ratio: 1.55,
      privilege: "Elite User及以上用户封存账号后不会被删除。",
    },
    {
      id: 5,
      name: "Crazy User",
      interval: "P15W",
      downloaded: "300GB",
      ratio: 2.05,
      privilege: "得到两个邀请名额；可以匿名做种、下载和发布。",
    },
    {
      id: 6,
      name: "Insane User",
      interval: "P25W",
      downloaded: "500GB",
      ratio: 2.55,
      privilege: "可以查看普通日志。",
    },
    {
      id: 7,
      name: "Veteran User",
      interval: "P40W",
      downloaded: "750GB",
      ratio: 3.05,
      isKept: true,
      privilege: "得到三个邀请名额；可以查看其他用户的评论、帖子历史；账号永久保留。",
    },
    {
      id: 8,
      name: "Extreme User",
      interval: "P60W",
      downloaded: "1TB",
      ratio: 3.55,
      isKept: true,
      privilege: "可以更新过期的外部信息；可以查看Extreme User论坛。",
    },
    {
      id: 9,
      name: "Ultimate User",
      interval: "P80W",
      downloaded: "1.5TB",
      ratio: 4.05,
      isKept: true,
      privilege: "得到五个邀请名额。",
    },
    {
      id: 10,
      name: "Nexus Master",
      interval: "P100W",
      downloaded: "3TB",
      ratio: 4.55,
      isKept: true,
      privilege: "得到十个邀请名额。",
    },
  ],
};
