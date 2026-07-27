import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "hitpt",
  label: "百川PT",
  hosts: ["www.hitpt.com"],
  defaultUrl: "https://www.hitpt.com/",
  turnstile: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const hitptLoginAdapter = createSiteLoginAdapter(definition);
