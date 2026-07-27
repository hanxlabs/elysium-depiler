import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "cspt",
  label: "财神",
  hosts: ["cspt.top", "cspt.cc", "cspt.date"],
  defaultUrl: "https://cspt.top/",
  twoFactorField: "two_step_code",
  submitSelector: 'input[type="submit"]',
};
export const csptLoginAdapter = createSiteLoginAdapter(definition);
