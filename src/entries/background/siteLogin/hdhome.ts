import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "hdhome",
  label: "HDHome",
  hosts: ["hdhome.org"],
  defaultUrl: "https://hdhome.org/",
  twoFactorField: "scode",
  submitSelector: 'input[type="submit"]',
};
export const hdhomeLoginAdapter = createSiteLoginAdapter(definition);
