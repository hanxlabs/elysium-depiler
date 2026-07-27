import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "monikadesign",
  label: "MonikaDesign",
  hosts: ["monikadesign.uk"],
  defaultUrl: "https://monikadesign.uk/",
  loginPath: "/login",
  formSelector: 'form[action$="/login"]',
  submitSelector: "#login-button",
  unit3d: true,
};
export const monikadesignLoginAdapter = createSiteLoginAdapter(definition);
