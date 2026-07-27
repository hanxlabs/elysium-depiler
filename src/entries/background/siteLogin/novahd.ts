import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "novahd",
  label: "NovaHD",
  hosts: ["pt.novahd.top"],
  defaultUrl: "https://pt.novahd.top/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const novahdLoginAdapter = createSiteLoginAdapter(definition);
