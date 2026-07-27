import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "nicept",
  label: "NicePT",
  hosts: ["www.nicept.net"],
  defaultUrl: "https://www.nicept.net/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const niceptLoginAdapter = createSiteLoginAdapter(definition);
