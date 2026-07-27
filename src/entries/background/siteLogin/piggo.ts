import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "piggo",
  label: "猪猪",
  hosts: ["piggo.me"],
  defaultUrl: "https://piggo.me/",
  challenge: true,
  twoFactorField: "two_step_code",
};
export const piggoLoginAdapter = createSiteLoginAdapter(definition);
