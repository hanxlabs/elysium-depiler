import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "discfan",
  label: "DiscFan",
  hosts: ["discfan.net"],
  defaultUrl: "https://discfan.net/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const discfanLoginAdapter = createSiteLoginAdapter(definition);
