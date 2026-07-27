import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "cyanbug",
  label: "大青虫",
  hosts: ["cyanbug.net"],
  defaultUrl: "https://cyanbug.net/",
  challenge: true,
  twoFactorField: "two_step_code",
};
export const cyanbugLoginAdapter = createSiteLoginAdapter(definition);
