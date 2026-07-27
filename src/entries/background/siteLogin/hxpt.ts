import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "hxpt",
  label: "好学",
  hosts: ["www.hxpt.org"],
  defaultUrl: "https://www.hxpt.org/",
  challenge: true,
  twoFactorField: "two_step_code",
};
export const hxptLoginAdapter = createSiteLoginAdapter(definition);
