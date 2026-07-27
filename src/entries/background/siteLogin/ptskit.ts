import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "ptskit",
  label: "拾刻",
  hosts: ["www.ptskit.org"],
  defaultUrl: "https://www.ptskit.org/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const ptskitLoginAdapter = createSiteLoginAdapter(definition);
