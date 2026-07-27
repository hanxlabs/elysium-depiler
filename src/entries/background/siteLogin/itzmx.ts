import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "itzmx",
  label: "PT分享站",
  hosts: ["pt.itzmx.com"],
  defaultUrl: "https://pt.itzmx.com/",
  imageCaptcha: true,
  submitSelector: 'input[type="submit"]',
};
export const itzmxLoginAdapter = createSiteLoginAdapter(definition);
