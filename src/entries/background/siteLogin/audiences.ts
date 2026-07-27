import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "audiences",
  label: "Audiences",
  hosts: ["audiences.me"],
  defaultUrl: "https://audiences.me/",
  imageCaptcha: true,
  twoFactorField: "scode",
  submitSelector: 'input[type="submit"]',
};
export const audiencesLoginAdapter = createSiteLoginAdapter(definition);
