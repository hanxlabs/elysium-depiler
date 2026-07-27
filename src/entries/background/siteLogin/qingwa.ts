import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "qingwa",
  label: "青蛙",
  hosts: ["www.qingwapt.com", "www.qingwapt.org", "www.qingwa.pro", "qingwapt.com"],
  defaultUrl: "https://www.qingwapt.com/",
  turnstile: true,
  twoFactorField: "two_step_code",
  submitSelector: "#submit_login",
  revealSelector: "#login",
};
export const qingwaLoginAdapter = createSiteLoginAdapter(definition);
