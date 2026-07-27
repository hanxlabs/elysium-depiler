import type { SiteLoginDefinition } from "@/shared/siteLoginDefinition.ts";
import { createSiteLoginAdapter } from "./shared.ts";

const definition: SiteLoginDefinition = {
  key: "daxiangjiao",
  label: "大香蕉",
  hosts: ["pt.daxiangjiao.org"],
  defaultUrl: "https://pt.daxiangjiao.org/",
  imageCaptcha: true,
  challenge: true,
  twoFactorField: "two_step_code",
};
export const daxiangjiaoLoginAdapter = createSiteLoginAdapter(definition);
