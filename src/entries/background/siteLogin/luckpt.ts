import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "luckpt",
  label: "LuckPT",
  hosts: ["pt.luckpt.de"],
  defaultUrl: "https://pt.luckpt.de/",
  turnstile: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const luckptLoginAdapter = createSiteLoginAdapter(definition);
