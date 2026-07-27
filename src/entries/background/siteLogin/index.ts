import { audiencesLoginAdapter } from "./audiences.ts";
import { btschoolLoginAdapter } from "./btschool.ts";
import { crabptLoginAdapter } from "./crabpt.ts";
import { csptLoginAdapter } from "./cspt.ts";
import { cyanbugLoginAdapter } from "./cyanbug.ts";
import { daxiangjiaoLoginAdapter } from "./daxiangjiao.ts";
import { discfanLoginAdapter } from "./discfan.ts";
import { hddolbyLoginAdapter } from "./hddolby.ts";
import { hdfansLoginAdapter } from "./hdfans.ts";
import { hdhomeLoginAdapter } from "./hdhome.ts";
import { hitptLoginAdapter } from "./hitpt.ts";
import { hxptLoginAdapter } from "./hxpt.ts";
import { itzmxLoginAdapter } from "./itzmx.ts";
import { luckptLoginAdapter } from "./luckpt.ts";
import { monikadesignLoginAdapter } from "./monikadesign.ts";
import { movie52LoginAdapter } from "./movie52.ts";
import { muxuegeLoginAdapter } from "./muxuege.ts";
import { niceptLoginAdapter } from "./nicept.ts";
import { novahdLoginAdapter } from "./novahd.ts";
import { piggoLoginAdapter } from "./piggo.ts";
import { ptCafeLoginAdapter } from "./ptcafe.ts";
import { pterLoginAdapter } from "./pter.ts";
import { ptsbaoLoginAdapter } from "./ptsbao.ts";
import { ptskitLoginAdapter } from "./ptskit.ts";
import { pttimeLoginAdapter } from "./pttime.ts";
import { qingwaLoginAdapter } from "./qingwa.ts";
import { sunnyPtLoginAdapter } from "./sunnypt.ts";
import { tangptLoginAdapter } from "./tangpt.ts";
import type { SiteLoginAdapter, SiteLoginResult, SiteLoginTarget } from "./types.ts";
import { ubitsLoginAdapter } from "./ubits.ts";
import { zmptLoginAdapter } from "./zmpt.ts";

const adapters: SiteLoginAdapter[] = [
  sunnyPtLoginAdapter,
  btschoolLoginAdapter,
  crabptLoginAdapter,
  ptCafeLoginAdapter,
  pterLoginAdapter,
  movie52LoginAdapter,
  audiencesLoginAdapter,
  csptLoginAdapter,
  cyanbugLoginAdapter,
  daxiangjiaoLoginAdapter,
  discfanLoginAdapter,
  hddolbyLoginAdapter,
  hdfansLoginAdapter,
  hdhomeLoginAdapter,
  hitptLoginAdapter,
  hxptLoginAdapter,
  itzmxLoginAdapter,
  luckptLoginAdapter,
  monikadesignLoginAdapter,
  muxuegeLoginAdapter,
  niceptLoginAdapter,
  novahdLoginAdapter,
  piggoLoginAdapter,
  ptsbaoLoginAdapter,
  ptskitLoginAdapter,
  pttimeLoginAdapter,
  qingwaLoginAdapter,
  tangptLoginAdapter,
  ubitsLoginAdapter,
  zmptLoginAdapter,
];

export async function loginSite(site: SiteLoginTarget): Promise<SiteLoginResult> {
  const adapter = adapters.find((candidate) => candidate.supports(site));
  if (!adapter) {
    throw new Error(`站点 ${site.siteKey} 暂未配置 Depiler 登录适配器`);
  }
  return adapter.login(site);
}

export type { SiteLoginCredentials, SiteLoginTarget } from "./types.ts";
