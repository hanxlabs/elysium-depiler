import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "ubits",
  label: "UBits",
  hosts: ["ubits.club"],
  defaultUrl: "https://ubits.club/",
  imageCaptcha: true,
  cloudflarePreflight: true,
  twoFactorField: "two_step_code",
  submitSelector: 'input[type="submit"]',
};
export const ubitsLoginAdapter = createSiteLoginAdapter(definition);
