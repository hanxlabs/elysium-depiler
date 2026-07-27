import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "muxuege",
  label: "慕雪阁",
  hosts: ["pt.muxuege.org"],
  defaultUrl: "https://pt.muxuege.org/",
  challenge: true,
  twoFactorField: "two_step_code",
};
export const muxuegeLoginAdapter = createSiteLoginAdapter(definition);
