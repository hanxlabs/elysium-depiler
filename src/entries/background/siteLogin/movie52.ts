import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "52movie",
  label: "52MOVIE",
  hosts: ["www.52movie.top"],
  defaultUrl: "https://www.52movie.top/",
  imageCaptcha: true,
  cloudflarePreflight: true,
  twoFactorField: "two_step_code",
  submitSelector: 'input[type="submit"]',
};
export const movie52LoginAdapter = createSiteLoginAdapter(definition);
