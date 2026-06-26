// This file is the entry point for the content script

import { getHostFromUrl } from "@ptd/site";
import { socialPageParserMatchesMap } from "@ptd/social";

import { sendMessage } from "@/messages.ts";
import type { IMetadataPiniaStorageSchema } from "@/shared/types/storages/metadata.ts";
import type { IConfigPiniaStorageSchema } from "@/shared/types/storages/config.ts";

import { mountApp } from "./app/init.ts";

async function initContentScript() {
  const configStore = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema | undefined;

  if (configStore?.contentScript?.enabled ?? true) {
    if (configStore?.contentScript?.enabledAtSocialSite ?? true) {
      for (const [socialSite, patternMatches] of Object.entries(socialPageParserMatchesMap)) {
        for (const [pattern, _] of patternMatches) {
          if (new RegExp(pattern, "i").test(window.location.href)) {
            console.debug(`[PTD] Social site detected: ${socialSite}, loading app...`);
            mountApp(document, { socialSite });
            return; // 找到匹配的 social site 后，直接加载应用并退出
          }
        }
      }
    }

    const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema | undefined;
    const host = getHostFromUrl(window.location.href); // 获取当前页面的 host
    const siteId = metadataStore?.siteHostMap?.[host];

    if (siteId) {
      // 如果当前页面的 host 在 metadataStore 中有对应的 siteId，加载 app
      if (
        configStore?.contentScript?.allowExceptionSites === true &&
        metadataStore?.sites?.[siteId]?.allowContentScript === false
      ) {
        console.debug(`[PTD] Content script is disabled for site: ${siteId}`);
        return; // 如果允许排除站点，且站点配置中禁用了 contentScript，则不加载应用
      }

      console.debug(`[PTD] host found for site: ${siteId}, loading app...`);
      mountApp(document, { siteId });
    }
  }
}

initContentScript().catch((error) => {
  console.warn("[PTD] Content script initialization skipped:", error);
});
