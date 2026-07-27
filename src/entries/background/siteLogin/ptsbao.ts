import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "ptsbao",
  label: "烧包",
  hosts: ["ptsbao.club"],
  defaultUrl: "https://ptsbao.club/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const ptsbaoLoginAdapter = createSiteLoginAdapter(definition);
