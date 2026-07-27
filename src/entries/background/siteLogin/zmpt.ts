import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "zmpt",
  label: "织梦",
  hosts: ["zmpt.cc"],
  defaultUrl: "https://zmpt.cc/",
  challenge: true,
  twoFactorField: "two_step_code",
};
export const zmptLoginAdapter = createSiteLoginAdapter(definition);
