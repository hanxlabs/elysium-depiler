import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "tangpt",
  label: "不可躺",
  hosts: ["www.tangpt.top"],
  defaultUrl: "https://www.tangpt.top/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const tangptLoginAdapter = createSiteLoginAdapter(definition);
