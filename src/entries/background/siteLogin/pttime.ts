import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "pttime",
  label: "PTTime",
  hosts: ["www.pttime.org"],
  defaultUrl: "https://www.pttime.org/",
  submitSelector: 'button[type="submit"]',
};
export const pttimeLoginAdapter = createSiteLoginAdapter(definition);
