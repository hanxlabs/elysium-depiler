import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "hdfans",
  label: "HDFans",
  hosts: ["hdfans.org"],
  defaultUrl: "https://hdfans.org/",
  imageCaptcha: true,
  twoFactorField: "two_step_code",
  submitSelector: 'input[type="submit"]',
};
export const hdfansLoginAdapter = createSiteLoginAdapter(definition);
