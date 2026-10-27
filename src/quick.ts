// Typed targets: "基多射负任意" → damage, multishot, fire rate, any negative.
// Understands every official stat name (简中, 国服, 繁中, English), common short forms, "或" / "/" for either stat,
// ";" or a new line for another target, 高 / 中 / numbers for bars, negatives and layouts. Whatever it
// cannot read is handed back so the page can show it; everything it can read is used.

import { CLASSES, GAME, LANGS, type RivenClass, type StatDef, statOf } from "./engine/data";
import { displayNumber, rawValue } from "./engine/formula";
import type { Pool } from "./engine/pool";
import { toSimplified } from "./hant";
import type { GroupDraft } from "./state";

const DMG = ["WeaponDamageAmountMod", "WeaponMeleeDamageMod"];
const G = ["WeaponFactionDamageGrineer", "WeaponMeleeFactionDamageGrineer"];
const C = ["WeaponFactionDamageCorpus", "WeaponMeleeFactionDamageCorpus"];
const I = ["WeaponFactionDamageInfested", "WeaponMeleeFactionDamageInfested"];

/** Short forms players type, on top of the official names. */
const SHORT: [string[], string[]][] = [
  [["基", "基伤", "基础伤害", "伤害", "近伤", "dmg", "base", "base damage"], DMG],
  [["多", "多重", "ms", "multi"], ["WeaponFireIterationsMod"]],
  [["暴", "暴击", "暴率", "暴击率", "爆率", "爆击", "爆击率", "cc", "crit", "crit chance"], ["WeaponCritChanceMod"]],
  [["暴伤", "爆伤", "爆击伤害", "cd", "crit damage", "critdmg"], ["WeaponCritDamageMod"]],
  [["射", "射速", "攻", "攻速", "fr", "as", "attack speed"], ["WeaponFireRateMod"]],
  [["触", "触发", "触发率", "异常几率", "异常率", "sc", "status", "status chance"], ["WeaponStunChanceMod"]],
  [["触发时间", "异常时间", "持续", "duration", "status duration"], ["WeaponProcTimeMod"]],
  [["毒", "毒素", "tox"], ["WeaponToxinDamageMod"]],
  [["冰", "冰冻", "ice"], ["WeaponFreezeDamageMod"]],
  [["火", "火焰", "热", "fire"], ["WeaponFireDamageMod"]],
  [["电", "电击", "elec", "electric"], ["WeaponElectricityDamageMod"]],
  [["冲", "冲击", "imp"], ["WeaponImpactDamageMod"]],
  [["刺", "穿刺", "punc"], ["WeaponArmorPiercingDamageMod"]],
  [["切", "切割"], ["WeaponSlashDamageMod"]],
  [["备弹", "弹药", "弹药上限", "ammo"], ["WeaponAmmoMaxMod"]],
  [["弹匣", "弹夹", "弹容", "mag", "clip", "magazine"], ["WeaponClipMaxMod"]],
  [["弹速", "投射", "飞行速度", "ps", "proj", "projectile speed"], ["WeaponProjectileSpeedMod"]],
  [["穿", "穿透", "pt", "punch"], ["WeaponPunctureDepthMod"]],
  [["后坐", "后座", "后坐力", "后座力", "recoil"], ["WeaponRecoilReductionMod"]],
  [["装填", "换弹", "装弹", "reload"], ["WeaponReloadSpeedMod"]],
  [["镜", "变焦", "倍镜", "zoom"], ["WeaponZoomFovMod"]],
  [["g", "g系", "打g", "对g", "克隆尼"], G],
  [["c", "c系", "打c", "对c", "科普斯"], C],
  [["i", "i系", "打i", "对i", "感染", "感染体"], I],
  [["弱点", "爆头", "weak point", "weakpoint"], ["WeaponWeakpointDamage"]],
  [["弱点暴击", "爆头暴击"], ["WeaponWeakpointCriticalChance"]],
  [["省弹", "弹药效率", "ammo efficiency"], ["WeaponAmmoEfficiency"]],
  [["自动装填", "收枪装填", "收起装填"], ["WeaponMagazineReloadHolstered"]],
  [["异常伤害", "状态伤害", "status damage"], ["WeaponStatusDamage"]],
  [["气", "毒气"], ["WeaponGasDamageMod"]],
  [["腐", "腐蚀", "corr"], ["WeaponCorrosiveDamageMod"]],
  [["病", "病毒"], ["WeaponViralDamageMod"]],
  [["辐", "辐射", "rad"], ["WeaponRadiationDamageMod"]],
  [["爆", "爆炸"], ["WeaponBlastDamageMod"]],
  [["磁", "磁力", "magnetic"], ["WeaponMagneticDamageMod"]],
  [["奥罗金", "o系"], ["WeaponFactionDamageOrokin"]],
  [["科腐者"], ["WeaponFactionDamageTechrot"]],
  [["炽蛇军"], ["WeaponFactionDamageScaldra"]],
  [["连击", "连击时间", "连击持续", "combo", "combo duration"], ["ComboDurationMod"]],
  [["滑砍", "滑暴", "滑行暴击", "slide"], ["SlideAttackCritChanceMod"]],
  [["范围", "攻击范围", "range"], ["WeaponMeleeRangeIncMod"]],
  [["处决", "finisher"], ["WeaponMeleeFinisherDamageMod"]],
  [["额外连击"], ["WeaponMeleeComboBonusOnHitMod"]],
  [["获得连击", "连击几率"], ["WeaponMeleeComboPointsOnHitMod"]],
  [["重击伤害"], ["WeaponMeleeHeavyAttackDamageMod"]],
  [["重击准备", "蓄力"], ["WeaponMeleeHeavyAttackChargeMod"]],
  [["招架", "parry"], ["WeaponMeleeParryAngleMod"]],
  [["震地", "震波", "slam"], ["WeaponMeleeSlamDamageMod"]],
];

type Word =
  | { k: "stat"; tags: string[] }
  /** one word for several slots: 双暴 = critical chance and critical damage */
  | { k: "stats"; list: string[][] }
  | { k: "or" }
  | { k: "set" }
  | { k: "neg" }
  | { k: "negAny" }
  | { k: "noNeg" }
  | { k: "tier"; tier: "hi" | "mid" | "any" };

const KEYWORDS: [string[], Word][] = [
  [["双暴", "双爆", "双暴击", "双爆击"], { k: "stats", list: [["WeaponCritChanceMod"], ["WeaponCritDamageMod"]] }],
  [["或", "或者", "/", "or"], { k: "or" }],
  [["负", "负面", "-", "neg", "negative"], { k: "neg" }],
  [
    [
      "负任意",
      "负随意",
      "负随便",
      "负都行",
      "负全部",
      "负都可以",
      "负皆可",
      "负不限",
      "负无所谓",
      "负面任意",
      "负面随意",
      "负面都行",
      "任意负",
      "any neg",
      "any negative",
      "neg any",
    ],
    { k: "negAny" },
  ],
  [["不要负", "不要负面", "无负", "无负面", "零负", "0负", "不带负", "没有负", "no neg", "no negative", "no negatives"], { k: "noNeg" }],
  [["高", "high", "hi"], { k: "tier", tier: "hi" }],
  [["中", "mid"], { k: "tier", tier: "mid" }],
  [["任意", "不限", "随意", "any"], { k: "tier", tier: "any" }],
];

const latin = (ch: string | undefined) => ch != null && /[a-z]/.test(ch);

/**
 * The form both typed text and known names are compared in: full-width brackets and letters made plain, lower case,
 * 繁中 written as 简中 (雙暴 = 双暴).
 */
const norm = (s: string) =>
  toSimplified(s.normalize("NFKC"))
    .toLowerCase()
    .replace(/[≥>＞]=?/g, " ")
    .replace(/[−–—]/g, "-");

/** Name variants players write for an official name: without "伤害", brackets, "对 … 的伤害", "Damage to". */
function variants(name: string): string[] {
  const n = norm(name).trim();
  const out = new Set([n]);
  const bare = n.replace(/[（(].*?[）)]/g, "").trim();
  out.add(bare);
  const faction = /^对\s*(.+?)\s*的?伤害$/.exec(bare) ?? /^damage to (.+)$/.exec(bare);
  if (faction) out.add(faction[1]);
  if (bare.endsWith("伤害") && bare.length > 3) out.add(bare.slice(0, -2));
  return [...out].filter(Boolean);
}

let table: { text: string; word: Word }[] | null = null;
/** Every phrase the reader knows, longest first so "暴伤" wins over "暴" and "触发时间" over "触发". */
function phrases() {
  if (table) return table;
  const map = new Map<string, Word>();
  const addStat = (text: string, tags: string[]) => {
    const prev = map.get(text);
    map.set(text, { k: "stat", tags: [...new Set([...(prev?.k === "stat" ? prev.tags : []), ...tags])] });
  };
  for (const c of CLASSES) for (const d of GAME.classes[c].stats) for (const l of LANGS) for (const v of variants(d.name[l])) addStat(v, [d.tag]);
  // short forms decide what a bare short word means, even when an official name could also start that way
  for (const [texts, tags] of SHORT) for (const t of texts) map.set(norm(t), { k: "stat", tags });
  for (const [texts, word] of KEYWORDS) for (const t of texts) map.set(norm(t), word);
  table = [...map].map(([text, word]) => ({ text, word })).sort((a, b) => b.text.length - a.text.length);
  return table;
}

/** x: written as a multiplier (x1.05); pct: written with "%"; text: as typed, to hand back when it fits nothing */
type TokenBody = Word | { k: "num"; n: number; x: boolean; pct: boolean; text: string } | { k: "layout"; key: string } | { k: "unknown"; text: string };
type Token = TokenBody & {
  /** where the word starts and ends in the text: whether a tier is written onto the stat before or after it */
  at: number;
  end: number;
};

const NUMBER = /^(-\s*)?(x)?(\d+(?:\.\d+)?)(%)?/;
// "110,5" is 110.5 where the game writes decimals with a comma; a comma before anything else still separates words
const COMMA_NUMBER = /^(-\s*)?(x)?(\d+(?:\.\d+|,\d{1,2}(?![\d.]))?)(%)?/;
const LAYOUT = /^([23])\s*\+\s*([01])/;

/** A number at the start of the text. After a comma, a layout ("110,3+1") or "0负" stays a word of its own. */
function readNumber(rest: string) {
  const m = COMMA_NUMBER.exec(rest);
  const comma = m?.[0].indexOf(",") ?? -1;
  if (comma < 0) return m;
  const after = rest.slice(comma + 1);
  const word = LAYOUT.test(after) || phrases().some(({ text }) => /^\d/.test(text) && after.startsWith(text));
  return word ? NUMBER.exec(rest) : m;
}

function lex(input: string): Token[] {
  const s = norm(input);
  const out: Token[] = [];
  let unknown = "";
  let unknownAt = 0;
  const flush = () => {
    if (unknown.trim()) out.push({ k: "unknown", text: unknown.trim(), at: unknownAt, end: unknownAt + unknown.length });
    unknown = "";
  };
  let i = 0;
  const add = (t: TokenBody, length: number) => out.push({ ...t, at: i, end: i + length });
  while (i < s.length) {
    const rest = s.slice(i);
    const layout = LAYOUT.exec(rest);
    if (layout) {
      flush();
      add({ k: "layout", key: `${layout[1]}${layout[2]}` }, layout[0].length);
      i += layout[0].length;
      continue;
    }
    // "-" right before a number is its sign ("后坐力-110"), not "negative:" ("-变焦")
    const signed = s[i] === "-" ? readNumber(rest) : null;
    if (signed?.[1]) {
      flush();
      add({ k: "num", n: Number(signed[3].replace(",", ".")), x: !!signed[2], pct: !!signed[4], text: signed[0] }, signed[0].length);
      i += signed[0].length;
      continue;
    }
    // phrases before separators: "不要负" must not split at "要"
    const hit = phrases().find(({ text }) => rest.startsWith(text) && !(latin(text[0]) && latin(s[i - 1])) && !(latin(text.at(-1)) && latin(s[i + text.length])));
    if (hit) {
      flush();
      // 双暴 is one word for two stats: both carry its place in the text
      if (hit.word.k === "stats") for (const tags of hit.word.list) add({ k: "stat", tags }, hit.text.length);
      else add(hit.word, hit.text.length);
      i += hit.text.length;
      continue;
    }
    if (/[;\n|]/.test(s[i])) {
      flush();
      add({ k: "set" }, 1);
      i++;
      continue;
    }
    if (/[\s,、+&和跟带要]/.test(s[i])) {
      flush();
      i++;
      continue;
    }
    const num = readNumber(rest);
    if (num && (num[2] || /\d/.test(s[i]))) {
      flush();
      add({ k: "num", n: Number(num[3].replace(",", ".")), x: !!num[2], pct: !!num[4], text: num[0] }, num[0].length);
      i += num[0].length;
      continue;
    }
    if (!unknown) unknownAt = i;
    unknown += s[i];
    i++;
  }
  flush();
  return out;
}

export type NegChoice = { kind: "keep" } | { kind: "none" } | { kind: "any" } | { kind: "list"; tags: string[] };

export interface Skipped {
  /** stat tags (for naming) */
  tags: string[];
  why: "class" | "weapon" | "full" | "spliced" | "sets";
}

export interface QuickResult {
  sets: GroupDraft[][];
  neg: NegChoice;
  layouts: string[];
  unknown: string[];
  skipped: Skipped[];
}

/** +1 or −1: the sign the game prints for a positive trait of this stat (recoil shows "−"). */
const shownSign = (def: StatDef) => Math.sign(displayNumber(def, rawValue(def, { pos: 3, neg: 1 }, false, 1))) || 1;

const MAX_SETS = 4;
const MAX_GROUPS = 3;

/** Read a typed target for a weapon of class `cls` with stat pool `pool`. */
export function readTarget(input: string, cls: RivenClass, pool: Pool): QuickResult {
  const classTags = new Set(GAME.classes[cls].stats.map((d) => d.tag));
  const wantable = new Set([...pool.pos, ...pool.spliced]);
  const sets: GroupDraft[][] = [[]];
  const negs: string[] = [];
  const layouts: string[] = [];
  const unknown: string[] = [];
  const skipped: Skipped[] = [];
  let neg: NegChoice = { kind: "keep" };
  let negMode = false;
  const valueText = new Map<GroupDraft, string>();
  let overflow = false;
  let or = false;
  const cur = () => sets[sets.length - 1];
  // the row the last stat went to: a bar typed next applies to it (none when that stat was left out)
  let focus: GroupDraft | undefined;
  // the rows of the last stat word: 双暴高 makes both high
  let lastWord: { at: number; groups: GroupDraft[] } = { at: -1, groups: [] };
  // a tier written before a stat (高多重, 高双暴): waits for the stat word that starts at `at`
  let pending: { tier: "hi" | "mid" | "any"; at: number } | null = null;
  const setTier = (g: GroupDraft, tier: "hi" | "mid" | "any") => {
    g.tier = tier;
    delete g.value;
    delete g.w;
  };
  const spliced = (tags: string[]) => tags.some((t) => statOf(cls, t).spliced);

  const tokens = lex(input);
  for (const [i, t] of tokens.entries()) {
    switch (t.k) {
      case "stat": {
        if (overflow && !negMode) {
          skipped.push({ tags: t.tags, why: "sets" });
          focus = undefined;
          break;
        }
        const own = t.tags.filter((x) => classTags.has(x));
        if (!own.length) {
          skipped.push({ tags: t.tags, why: "class" });
          focus = undefined;
          break;
        }
        if (negMode) {
          const ok = own.filter((x) => pool.neg.includes(x));
          if (ok.length) negs.push(...ok.filter((x) => !negs.includes(x)));
          else skipped.push({ tags: own, why: "weapon" });
          break;
        }
        const ok = own.filter((x) => wantable.has(x));
        if (!ok.length) {
          skipped.push({ tags: own, why: "weapon" });
          focus = undefined;
          or = false;
          break;
        }
        const wanted = cur().find((x) => ok.some((y) => x.tags.includes(y)));
        if (or && focus) {
          for (const x of ok) if (!focus.tags.includes(x)) focus.tags.push(x);
        } else if (wanted) {
          // already wanted in this target: a bar typed next is for that row
          focus = wanted;
        } else if (cur().length >= MAX_GROUPS) {
          skipped.push({ tags: ok, why: "full" });
          focus = undefined;
        } else if (spliced(ok) && cur().some((x) => spliced(x.tags))) {
          skipped.push({ tags: ok, why: "spliced" });
          focus = undefined;
        } else {
          focus = { tags: ok, tier: "any" };
          cur().push(focus);
        }
        or = false;
        if (focus) {
          if (lastWord.at !== t.at) lastWord = { at: t.at, groups: [] };
          if (!lastWord.groups.includes(focus)) lastWord.groups.push(focus);
          if (pending?.at === t.at) setTier(focus, pending.tier);
        }
        break;
      }
      case "or":
        or = true;
        break;
      case "set":
        if (cur().length) {
          if (sets.length < MAX_SETS) sets.push([]);
          // past the last target there is nowhere to put another: its stats are left out, not added to the last one
          else overflow = true;
        }
        focus = undefined;
        negMode = false;
        or = false;
        break;
      case "neg":
        negMode = true;
        break;
      case "negAny":
        neg = { kind: "any" };
        negMode = false;
        break;
      case "noNeg":
        neg = { kind: "none" };
        negMode = false;
        break;
      case "tier": {
        if (negMode && t.tier === "any" && !negs.length) {
          neg = { kind: "any" };
          negMode = false;
          break;
        }
        if (negMode) break;
        // players write the tier first (高双暴, 高多重): it belongs to the stat right after it, or the next stat when
        // the one before is not written onto it. 多重高 (then a space, a comma or the end) still means the one before.
        const next = tokens[i + 1];
        const prev = tokens[i - 1];
        const ontoPrev = prev?.k === "stat" && prev.end === t.at;
        if (next?.k === "stat" && (next.at === t.end || !ontoPrev)) {
          pending = { tier: t.tier, at: next.at };
          break;
        }
        for (const g of focus && lastWord.groups.includes(focus) ? lastWord.groups : focus ? [focus] : []) setTier(g, t.tier);
        break;
      }
      case "num": {
        const g = focus;
        // a number with no wanted stat before it (or after 负) bars nothing: hand it back instead of dropping it
        if (!g || negMode) {
          unknown.push(t.text);
          break;
        }
        const def = statOf(cls, g.tags[0]);
        // a bare 0.9–1.1 is a roll; with "%" or as a multiplier (x1.05) it is a shown value
        if (!t.x && !t.pct && t.n >= 0.9 && t.n <= 1.1) {
          g.tier = "w";
          g.w = t.n;
          delete g.value;
        } else if (t.pct && def.fmt === "mult") {
          // multiplier stats show "x1.49", never a percentage
          unknown.push(t.text);
        } else {
          // the size of the value: each stat applies it in its own direction (recoil shows "−")
          g.tier = "value";
          g.value = def.fmt === "mult" ? t.n : shownSign(def) * t.n;
          delete g.w;
          valueText.set(g, t.text);
        }
        break;
      }
      case "layout":
        if (!layouts.includes(t.key)) layouts.push(t.key);
        break;
      case "unknown":
        unknown.push(t.text);
        break;
    }
  }
  if (negs.length) neg = { kind: "list", tags: negs };
  // one number cannot be both a multiplier (x1.49) and a percentage: hand it back rather than guess
  for (const g of sets.flat())
    if (g.tier === "value" && new Set(g.tags.map((x) => statOf(cls, x).fmt === "mult")).size > 1) {
      unknown.push(valueText.get(g) ?? String(g.value));
      g.tier = "any";
      delete g.value;
    }
  return { sets: sets.filter((gs) => gs.length), neg, layouts, unknown, skipped };
}
