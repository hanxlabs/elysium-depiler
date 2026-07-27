import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "hddolby",
  label: "HDDolby",
  hosts: ["www.hddolby.com"],
  defaultUrl: "https://www.hddolby.com/",
  imageCaptcha: true,
  twoFactorField: "2fa",
  submitSelector: 'input[type="submit"]',
};
export const hddolbyLoginAdapter = createSiteLoginAdapter(definition);
