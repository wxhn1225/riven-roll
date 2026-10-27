// 繁中 written as 简中, one character for one, so text in either script compares equal: "雙暴" reads as "双暴",
// "暴擊傷害" as "暴击伤害". Both sides of a comparison go through it, so a pair only has to be the same on both.
import { GAME, LANGS, type Text } from "./engine/data";

// the short forms players type, checked by hand; the game's dictionaries give the rest (GAME.hant)
const TYPED =
  "傷伤礎础擊击觸触發发異异幾几機机時时間间續续凍冻熱热電电衝冲沖冲備备彈弹藥药夾夹飛飞後后裝装換换鏡镜變变" +
  "對对體体點点頭头動动槍枪狀状態态氣气蝕蚀輻辐奧奥羅罗熾炽軍军連连範范圍围處处決决額额獲获準准雙双負负隨随無无" +
  "謂谓帶带沒没係系數数檔档達达條条組组種种選选設设際际總总這这個个與与為为從从會会還还實实現现計计戰战屬属擇择" +
  "隊队環环鎖锁餘余適适於于級级類类項项樣样標标區区邊边壓压擴扩張张護护響响錄录劍剑鐮镰殘残歸归驗验說说開开關关";

// what the screenshot reader writes for 繁中 characters it has no glyph for (it reads 擊 as 撃, 擘, 业, 学 or 墅,
// 槍 as 檐), seen on a 繁中 cycle screen and every 繁中 stat and weapon name; for screenshots only
const MISREAD = "撃击擘击业击学击墅击擎击衡冲街冲载战戴战載战隧队鲍范顏额檐枪壤坏絶绝递锤魏锤卸钉巽异薈苍菅苍萱苍";

const table = (pairs: string, into = new Map<string, string>()) => {
  for (let i = 0; i + 1 < pairs.length; i += 2) into.set(pairs[i], pairs[i + 1]);
  return into;
};
const MAP = table(TYPED, table(GAME.hant));
const OCR_MAP = table(MISREAD, new Map(MAP));

const fold = (map: Map<string, string>, s: string) => {
  let out = "";
  for (const ch of s) out += map.get(ch) ?? ch;
  return out;
};

/** The same text with its 繁中 characters in their 简中 form; its length never changes. */
export const toSimplified = (s: string): string => fold(MAP, s);

/** toSimplified, and the characters the screenshot reader writes for 繁中 ones it cannot read put right. */
export const foldOcr = (s: string): string => fold(OCR_MAP, s);

/** The search form of a text: lower case, 繁中 written as 简中. */
export const searchForm = (s: string): string => toSimplified(s.trim().toLowerCase());

/** Does a search box's text (`query`, already in searchForm) find this name, in any of its languages and either script? */
export const nameMatches = (name: Text, query: string): boolean => LANGS.some((l) => searchForm(name[l]).includes(query));
