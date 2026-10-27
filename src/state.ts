import { GAME, isLang, type Lang, type RivenClass, statOf, weaponById } from "./engine/data";
import {
  DEFAULT_DISPOSITION,
  DISPOSITION_MAX,
  DISPOSITION_MIN,
  displayNumber,
  formatDisplay,
  LAYOUTS,
  type Layout,
  layoutKey,
  minimumQualityForDisplay,
  type QualityReading,
  qualityFromDisplay,
  rawValue,
  signedDisplayInput,
  tidyDisposition,
  W_MAX,
  W_MIN,
} from "./engine/formula";
import { type Card, cycleCost, type Objective, type Target } from "./engine/solver";

export interface TraitDraft {
  tag: string;
  shown: number | null;
  /** the number was filled in as the lowest roll (0.90) when the stat was picked, and follows the layout until typed over */
  auto?: boolean;
}

export interface CardDraft {
  pos: TraitDraft[];
  neg: TraitDraft | null;
  cycles: number;
}

/** any / mid / hi are presets; "w" is a typed roll bar, "value" a typed shown value */
export type Tier = "any" | "mid" | "hi" | "w" | "value";

export interface GroupDraft {
  tags: string[];
  tier: Tier;
  /** with tier "w": the roll bar typed by the player */
  w?: number;
  /**
   * with tier "value": the number as shown in game, e.g. 110 for "+110%", 1.5 for "x1.50". Its size is what
   * counts: each stat of the row reads it in its own direction (recoil shows "−"), see signedValue.
   */
  value?: number;
}

export interface TargetDraft {
  tiers: { mid: number; hi: number };
  /** alternative targets, each a list of wanted stats; the riven is done when any one is met */
  sets: GroupDraft[][];
  /** "其中至少 k 条达到 tier": a count rule across the wanted traits */
  atLeast: { on: boolean; k: number; tier: "hi" | "mid" };
  wantNeg: boolean;
  allowedNeg: string[];
  layouts: string[];
  layoutsAuto: boolean;
  objective: Objective;
}

export interface LogEntry {
  at: number;
  text: string;
}

export interface Session {
  lang: Lang;
  weaponId: string | null;
  card: CardDraft;
  target: TargetDraft;
  kuva: number | null;
  chosen: string | null;
  /** what the step being followed has cost so far, and the route it belongs to (a new route starts a new step) */
  step: { cycles: number; kuva: number; route?: string };
  total: { cycles: number; kuva: number };
  log: LogEntry[];
  /** the weapon's disposition (倾向) the values are worked out with: 1.2 for every weapon unless the player sets another */
  disposition: number;
  /**
   * Names of the old/new comparisons already counted as a cycle of this riven (see compareIds), newest last. Saved
   * with the session, so a reload does not count one twice; a new session or another weapon starts empty.
   */
  counted: string[];
}

export const emptyCard = (): CardDraft => ({ pos: [], neg: null, cycles: 0 });

export const defaultTarget = (): TargetDraft => ({
  tiers: { mid: 1.0, hi: 1.07 },
  sets: [[]],
  atLeast: { on: false, k: 2, tier: "hi" },
  wantNeg: true,
  allowedNeg: [],
  layouts: ["31"],
  layoutsAuto: true,
  objective: "cycles",
});

export const defaultSession = (): Session => ({
  lang: "zh",
  weaponId: null,
  card: emptyCard(),
  target: defaultTarget(),
  kuva: null,
  chosen: null,
  step: { cycles: 0, kuva: 0 },
  total: { cycles: 0, kuva: 0 },
  log: [],
  disposition: DEFAULT_DISPOSITION,
  counted: [],
});

/** The example: a 圣装葬铭 riven and a target for it. */
export const demoSession = (lang: Lang): Session => ({
  ...defaultSession(),
  lang,
  weaponId: "/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon",
  card: {
    pos: [
      { tag: "WeaponFireIterationsMod", shown: 144.5 },
      { tag: "WeaponFactionDamageGrineer", shown: 1.49 },
      { tag: "WeaponToxinDamageMod", shown: 102.6 },
    ],
    neg: { tag: "WeaponClipMaxMod", shown: -47.1 },
    cycles: 160,
  },
  target: {
    ...defaultTarget(),
    sets: [
      [
        { tags: ["WeaponFireIterationsMod"], tier: "hi" },
        { tags: ["WeaponDamageAmountMod"], tier: "mid" },
        { tags: ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"], tier: "any" },
      ],
    ],
    allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod", "WeaponClipMaxMod", "WeaponRecoilReductionMod"],
  },
  kuva: 25167812,
});

const KEY = "riven-roll:session:v1";
/**
 * 2: the default objective became fewest cycles. Sessions saved before that stored least Kuva only because
 * it was the old default, so they move to fewest cycles once; a choice saved since then is kept.
 */
const SESSION_VERSION = 2;

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return repairSession(JSON.parse(raw));
  } catch {
    // private mode or unreadable storage: start fresh
  }
  return defaultSession();
}

// ---------- reading a saved session ----------

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown, fallback: number) => (isNum(v) && Number.isSafeInteger(v) && v >= 0 ? v : fallback);
const tally = (v: unknown) =>
  isObj(v) ? { cycles: count(v.cycles, 0), kuva: isNum(v.kuva) && v.kuva >= 0 ? v.kuva : 0, ...(typeof v.route === "string" ? { route: v.route } : {}) } : { cycles: 0, kuva: 0 };

/**
 * One more cycle on the step of `route`: counted on to its tally, or a new tally when the step is another route's
 * (a tally kept before steps had routes belongs to none, and is only kept in the total).
 */
export function stepAfter(step: Session["step"], price: number, route?: string): Session["step"] {
  const next = step.route === route ? { cycles: step.cycles + 1, kuva: step.kuva + price } : { cycles: 1, kuva: price };
  return route == null ? next : { ...next, route };
}
const trait = (v: unknown): TraitDraft | null =>
  isObj(v) && typeof v.tag === "string" ? { tag: v.tag, shown: isNum(v.shown) ? v.shown : null, ...(v.auto === true ? { auto: true } : {}) } : null;
const TIERS: Tier[] = ["any", "mid", "hi", "w", "value"];
function group(v: unknown): GroupDraft | null {
  if (!isObj(v) || !Array.isArray(v.tags)) return null;
  // a row with no stat yet is a draft the player is still filling in: keep it (it is not planned until filled)
  const tags = v.tags.filter((t): t is string => typeof t === "string");
  const tier = TIERS.includes(v.tier as Tier) ? (v.tier as Tier) : "any";
  const g: GroupDraft = { tags, tier };
  if (tier === "w") {
    if (!isNum(v.w)) return { tags, tier: "any" };
    g.w = v.w;
  }
  if (tier === "value") {
    if (!isNum(v.value)) return { tags, tier: "any" };
    g.value = v.value;
  }
  return g;
}

/**
 * A saved session as the page can use it: whatever is missing or malformed (an older version, a hand-edited or
 * damaged save) falls back to the default for that part alone, so a bad save never blanks the page.
 */
export function repairSession(saved: unknown): Session {
  const base = defaultSession();
  if (!isObj(saved)) return base;
  const t = isObj(saved.target) ? saved.target : {};
  const target: TargetDraft = { ...base.target };
  if (isObj(t.tiers) && isNum(t.tiers.mid) && isNum(t.tiers.hi)) target.tiers = { mid: t.tiers.mid, hi: t.tiers.hi };
  // sessions saved before alternative targets kept one list of groups
  const sets = Array.isArray(t.sets) ? t.sets : Array.isArray(t.groups) ? [t.groups] : [];
  target.sets = sets.filter(Array.isArray).map((gs) => gs.map(group).filter((g): g is GroupDraft => g != null));
  if (!target.sets.length) target.sets = [[]];
  if (isObj(t.atLeast) && typeof t.atLeast.on === "boolean" && [1, 2, 3].includes(t.atLeast.k as number) && (t.atLeast.tier === "hi" || t.atLeast.tier === "mid"))
    target.atLeast = { on: t.atLeast.on, k: t.atLeast.k as number, tier: t.atLeast.tier };
  if (typeof t.wantNeg === "boolean") target.wantNeg = t.wantNeg;
  if (Array.isArray(t.allowedNeg)) target.allowedNeg = t.allowedNeg.filter((x): x is string => typeof x === "string");
  if (Array.isArray(t.layouts)) target.layouts = t.layouts.filter((x): x is string => typeof x === "string" && /^[23][01]$/.test(x));
  if (typeof t.layoutsAuto === "boolean") target.layoutsAuto = t.layoutsAuto;
  // 2: the default objective became fewest cycles (see SESSION_VERSION)
  if ((t.objective === "cycles" || t.objective === "kuva") && count(saved.version, 1) >= 2) target.objective = t.objective;
  const c = isObj(saved.card) ? saved.card : {};
  const card: CardDraft = {
    pos: Array.isArray(c.pos)
      ? c.pos
          .map(trait)
          .filter((x): x is TraitDraft => x != null)
          .slice(0, 3)
      : [],
    neg: trait(c.neg),
    cycles: count(c.cycles, 0),
  };
  return {
    lang: isLang(saved.lang) ? saved.lang : base.lang,
    // a weapon that was listed twice under one name now has one id
    weaponId: typeof saved.weaponId === "string" ? (weaponById(saved.weaponId)?.id ?? null) : null,
    card,
    target,
    kuva: isNum(saved.kuva) && saved.kuva >= 0 ? saved.kuva : null,
    chosen: typeof saved.chosen === "string" ? saved.chosen : null,
    step: tally(saved.step),
    total: tally(saved.total),
    log: Array.isArray(saved.log) ? saved.log.filter((e): e is LogEntry => isObj(e) && isNum(e.at) && typeof e.text === "string") : [],
    disposition:
      isNum(saved.disposition) && saved.disposition >= DISPOSITION_MIN && saved.disposition <= DISPOSITION_MAX ? tidyDisposition(saved.disposition) : DEFAULT_DISPOSITION,
    counted: Array.isArray(saved.counted) ? saved.counted.filter((k): k is string => typeof k === "string").map(upgradeCounted) : [],
  };
}

export function saveSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, version: SESSION_VERSION }));
  } catch {
    // storage full or blocked; the page still works without it
  }
}

export function weaponClass(weaponId: string | null): RivenClass | null {
  return weaponId ? (weaponById(weaponId)?.cls ?? null) : null;
}

export function cardLayout(card: CardDraft): Layout | null {
  const p = card.pos.length;
  if (p !== 2 && p !== 3) return null;
  return { pos: p, neg: card.neg ? 1 : 0 };
}

/** The layout a card being filled in is read with: its own, or 2 positives until it has 3. */
export const fillLayout = (card: CardDraft): Layout => cardLayout(card) ?? { pos: card.pos.length >= 3 ? 3 : 2, neg: card.neg ? 1 : 0 };

/** The numbers the game can show for `tag` in `layout`: those of the lowest and the highest roll. */
export function shownRange(cls: RivenClass, tag: string, layout: Layout, curse: boolean): [number, number] | null {
  const def = statOf(cls, tag);
  const [lo, hi] = [W_MIN, W_MAX].map((w) => displayNumber(def, rawValue(def, layout, curse, w)));
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/**
 * Numbers filled in for picked stats (`auto`): each shows the lowest roll (0.90) in the card's layout, worked out
 * again when the layout changes (a card being filled in counts as 2 positives until it has 3).
 */
export function withAutoValues(cls: RivenClass, card: CardDraft): CardDraft {
  const layout = fillLayout(card);
  const fill = (t: TraitDraft, curse: boolean): TraitDraft => {
    if (!t.auto || !t.tag) return t;
    const range = shownRange(cls, t.tag, layout, curse);
    return range ? { ...t, shown: range[0] } : t;
  };
  return { ...card, pos: card.pos.map((t) => fill(t, false)), neg: card.neg ? fill(card.neg, true) : null };
}

/**
 * The roll the plan works with for a trait read from its shown value: the middle of its rounding range, but the top
 * for a spliced trait (read back from the rounded value, a roll that met its bar when spliced must not drop under it,
 * which would ask for another splicer). The card shows the same roll.
 */
export function plannedRoll(cls: RivenClass, tag: string, q: QualityReading): number {
  return statOf(cls, tag).spliced ? Math.min(W_MAX, Math.max(q.w, q.hi - 1e-9)) : q.w;
}

export function readQuality(cls: RivenClass, layout: Layout, t: TraitDraft, curse: boolean): QualityReading | null {
  if (t.shown == null || !Number.isFinite(t.shown) || !t.tag) return null;
  const stat = GAME.classes[cls].stats.find((s) => s.tag === t.tag);
  if (!stat) return null;
  return qualityFromDisplay(stat, layout, curse, t.shown);
}

/** Engine card from the editor, or null while something is missing. */
export type CardProblem =
  | { kind: "incomplete" }
  | { kind: "cycles" }
  | { kind: "duplicate"; tag: string }
  | { kind: "notPositive"; tag: string }
  | { kind: "notNegative"; tag: string }
  | { kind: "twoSpliced" }
  | { kind: "impossible"; tag: string; shown: number; layout: Layout };

/**
 * The riven's cycle count after a cycle whose old/new comparison was read from a screenshot. A cycle counts
 * once whichever card is kept; the old card on that screen still shows the count from before the cycle.
 */
export function cyclesAfterCompare(current: number, shown: [number | null, number | null]): number {
  return Math.max(current + 1, comparedCycle(shown) ?? 0);
}

/**
 * What keeping a card after a comparison does to the count: `before` is the cycles done before the compared one
 * (its price is read from it), `after` the count the riven then has. Counts the screenshot shows win over the page's
 * when they can be trusted. A comparison already counted is not charged again, but what it shows can still raise
 * the count; nothing makes the count go back.
 */
export function compareCount(current: number, shown: [number | null, number | null], again: boolean): { before: number; after: number } {
  const n = comparedCycle(shown);
  if (again) return { before: current, after: Math.max(current, n ?? 0) };
  return { before: n != null ? Math.max(0, n - 1) : current, after: cyclesAfterCompare(current, shown) };
}

/**
 * The count the riven reaches with the cycle a comparison shows: the new card's count, or the old card's plus one,
 * so a screenshot that read only one of them names the same cycle. Null when neither was read, or when both were
 * read and disagree (new must be old + 1): then the counts cannot be trusted.
 */
export function comparedCycle([old, next]: [number | null, number | null]): number | null {
  if (old != null && next != null) return next === old + 1 ? next : null;
  return next ?? (old != null ? old + 1 : null);
}

/** What compareIds reads from each card of a comparison screenshot. */
interface ComparedCard {
  cycles: number | null;
  traits: { tag: string; shown: number | null }[];
}

/**
 * Every name one comparison goes by: the cycle it shows and the screenshot file. A comparison is already counted
 * when any of its names is, so the same cycle in another file, or the same file read with or without its counts,
 * counts once; a real next cycle has a higher count, even when it rolls the same stats. The file name is the bare
 * hash, as sessions saved it before cycles had names.
 */
export function compareIds(pair: [ComparedCard, ComparedCard], shotKey: string | null): string[] {
  const ids: string[] = [];
  const n = comparedCycle([pair[0].cycles, pair[1].cycles]);
  if (n != null) ids.push(`cycle:${n}`);
  if (shotKey) ids.push(shotKey);
  // neither: what was read is all there is to go by
  if (!ids.length) ids.push(JSON.stringify(pair.map((k) => [k.traits.map((t) => [t.tag, t.shown]), k.cycles])));
  return ids;
}

/** A name saved by the version that keyed cycles as ["cycle", [old, new], tags], in today's form. */
function upgradeCounted(name: string): string {
  if (!name.startsWith('["cycle"')) return name;
  try {
    const [, shown] = JSON.parse(name) as [string, [number | null, number | null]];
    const n = comparedCycle(shown);
    return n == null ? name : `cycle:${n}`;
  } catch {
    return name;
  }
}

/**
 * A cycle counted by hand ("没出 · 保留旧的"): one more cycle at this price. It takes the name a comparison screenshot
 * of the same cycle would have, so pasting that screenshot afterwards (or while it is still being read) counts nothing.
 */
export function afterMissed(x: Session, price: number, route?: string): Session {
  const cycles = x.card.cycles + 1;
  return {
    ...x,
    card: { ...x.card, cycles },
    counted: withCounted(x.counted, [`cycle:${cycles}`]),
    kuva: x.kuva == null ? null : Math.max(0, x.kuva - price),
    step: stepAfter(x.step, price, route),
    total: { cycles: x.total.cycles + 1, kuva: x.total.kuva + price },
  };
}

/**
 * The session after keeping one riven of an old/new comparison. `card` gives the kept riven as a draft with its
 * cycle count; `kuvaShown` says the screenshot showed the Kuva left, which already has this cycle's price taken off.
 */
export function afterKeep(
  x: Session,
  c: { ids: string[]; cycles: [number | null, number | null]; locked: boolean; kuvaShown: boolean },
  which: 0 | 1,
  card: (cycles: number) => CardDraft,
  route?: string,
): Session {
  // pasting the same comparison again must not count its cycle twice; all its names are remembered either way,
  // so a later copy known by only one of them is recognized too
  const again = c.ids.some((id) => x.counted.includes(id));
  const counted = withCounted(x.counted, c.ids);
  // the counts on the screenshot set both the price of this cycle and the count after it
  const { before, after: cycles } = compareCount(x.card.cycles, c.cycles, again);
  const price = cycleCost(before, c.locked);
  const kept = { ...card(cycles), cycles };
  const chosen = which === 1 ? null : x.chosen;
  if (again) return { ...x, card: kept, counted, chosen };
  return {
    ...x,
    card: kept,
    chosen,
    counted,
    kuva: x.kuva == null || c.kuvaShown ? x.kuva : Math.max(0, x.kuva - price),
    step: which === 1 ? { cycles: 0, kuva: 0 } : stepAfter(x.step, price, route),
    total: { cycles: x.total.cycles + 1, kuva: x.total.kuva + price },
  };
}

/** Remember the names of a counted comparison; the list keeps the last 40. */
export const withCounted = (counted: string[], ids: string[]) => [...counted.filter((k) => !ids.includes(k)), ...ids].slice(-40);

/** The first thing that keeps the card from being planned, in the order a player would fix it; null when none. */
export function cardProblem(cls: RivenClass, card: CardDraft): CardProblem | null {
  const layout = cardLayout(card);
  const traits = [...card.pos.map((t) => ({ t, curse: false })), ...(card.neg ? [{ t: card.neg, curse: true }] : [])];
  const known = (tag: string) => GAME.classes[cls].stats.some((s) => s.tag === tag);
  if (!layout || traits.some(({ t }) => !t.tag || !known(t.tag) || t.shown == null || !Number.isFinite(t.shown))) return { kind: "incomplete" };
  if (!Number.isSafeInteger(card.cycles) || card.cycles < 0) return { kind: "cycles" };
  const seen = new Set<string>();
  for (const { t } of traits) {
    if (seen.has(t.tag)) return { kind: "duplicate", tag: t.tag };
    seen.add(t.tag);
  }
  for (const { t, curse } of traits) {
    const def = statOf(cls, t.tag);
    if (!curse && !def.buff) return { kind: "notPositive", tag: t.tag };
    if (curse && (!def.curse || def.spliced)) return { kind: "notNegative", tag: t.tag };
  }
  if (card.pos.filter((t) => statOf(cls, t.tag).spliced).length > 1) return { kind: "twoSpliced" };
  for (const { t, curse } of traits) {
    const q = readQuality(cls, layout, t, curse);
    if (!q?.valid || !Number.isFinite(q.w)) return { kind: "impossible", tag: t.tag, shown: t.shown as number, layout };
  }
  return null;
}

export function toEngineCard(cls: RivenClass, card: CardDraft): Card | null {
  const layout = cardLayout(card);
  if (!layout) return null;
  if (!Number.isSafeInteger(card.cycles) || card.cycles < 0) return null;
  const traits = [...card.pos, ...(card.neg ? [card.neg] : [])];
  if (new Set(traits.map((t) => t.tag)).size !== traits.length) return null;
  const pos = [];
  let spliced = null;
  for (const t of card.pos) {
    const q = readQuality(cls, layout, t, false);
    if (!q?.valid || !Number.isFinite(q.w) || !statOf(cls, t.tag).buff) return null;
    const trait = { tag: t.tag, w: plannedRoll(cls, t.tag, q) };
    if (statOf(cls, t.tag).spliced) {
      if (spliced) return null;
      spliced = trait;
    } else pos.push(trait);
  }
  let neg = null;
  if (card.neg) {
    const q = readQuality(cls, layout, card.neg, true);
    if (!q?.valid || !Number.isFinite(q.w) || !statOf(cls, card.neg.tag).curse || statOf(cls, card.neg.tag).spliced) return null;
    neg = { tag: card.neg.tag, w: q.w };
  }
  return { layout, pos, neg, spliced };
}

export function minW(t: TargetDraft, tier: Tier, g?: GroupDraft) {
  if (tier === "w") return g?.w ?? 0.9;
  return tier === "hi" ? t.tiers.hi : tier === "mid" ? t.tiers.mid : 0.9;
}

/** The roll bar of a wanted row in a layout (a typed value converts per stat and layout). */
export function groupBar(cls: RivenClass, t: TargetDraft, g: GroupDraft, tag: string, layout: Layout): number {
  if (g.tier === "value" && g.value != null) return valueToW(cls, tag, layout, signedValue(cls, tag, g.value));
  return minW(t, g.tier, g);
}

/** Does this stat show a higher number for a better roll (recoil does not)? */
export const showsUp = (cls: RivenClass, tag: string) => {
  const def = statOf(cls, tag);
  const at = (w: number) => displayNumber(def, rawValue(def, { pos: 3, neg: 1 }, false, w));
  return at(W_MAX) >= at(W_MIN);
};

/**
 * The first number the game can show that meets a typed value, in the stat's direction: the card shows tenths, so
 * 110.05 is met by 110.1 and up, never by 110.0.
 */
export function firstShown(cls: RivenClass, tag: string, value: number): number {
  const def = statOf(cls, tag);
  const k = signedValue(cls, tag, value) / def.roundTo;
  const n = showsUp(cls, tag) ? Math.ceil(k - 1e-9) : Math.floor(k + 1e-9);
  return Number((n * def.roundTo).toFixed(6));
}

/** " ≤ -110%" for recoil, " ≥ +90%" for reload: a typed value as a bar on the number the game shows for this stat. */
export function valueBar(cls: RivenClass, tag: string, value: number): string {
  return ` ${showsUp(cls, tag) ? "≥" : "≤"} ${formatDisplay(statOf(cls, tag), firstShown(cls, tag, value))}`;
}

/** A roll bar as typed: two decimals when that is exact (1.07), otherwise up to four (1.075, 1.0394). */
export function fmtRoll(w: number): string {
  return Math.abs(w * 100 - Math.round(w * 100)) < 1e-9 ? w.toFixed(2) : String(Number(w.toFixed(4)));
}

/** A typed value as this stat shows it: "后坐力/装填 90" means -90% recoil or +90% reload, whatever sign was typed. */
export function signedValue(cls: RivenClass, tag: string, value: number): number {
  return signedDisplayInput(statOf(cls, tag), false, value) ?? value;
}

export type StatCategory = "core" | "element" | "physical" | "faction" | "utility" | "spliced";
const CORE = new Set([
  "WeaponDamageAmountMod",
  "WeaponMeleeDamageMod",
  "WeaponFireIterationsMod",
  "WeaponCritChanceMod",
  "WeaponCritDamageMod",
  "WeaponFireRateMod",
  "WeaponStunChanceMod",
  "WeaponProcTimeMod",
]);
const ELEMENT = new Set(["WeaponFireDamageMod", "WeaponFreezeDamageMod", "WeaponElectricityDamageMod", "WeaponToxinDamageMod"]);
const PHYSICAL = new Set(["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"]);

/** Grouping used by the stat picker and the ranges page. */
export function statCategory(cls: RivenClass, tag: string): StatCategory {
  if (statOf(cls, tag).spliced) return "spliced";
  if (CORE.has(tag)) return "core";
  if (ELEMENT.has(tag)) return "element";
  if (PHYSICAL.has(tag)) return "physical";
  if (/FactionDamage/.test(tag)) return "faction";
  return "utility";
}
export const CATEGORY_ORDER: StatCategory[] = ["core", "element", "physical", "faction", "utility", "spliced"];

/** Lowest roll W whose shown value reaches `shown` for this stat and layout (can exceed 1.1: impossible). */
export function valueToW(cls: RivenClass, tag: string, layout: Layout, shown: number): number {
  return minimumQualityForDisplay(statOf(cls, tag), layout, false, shown);
}

/** The value a stat shows at roll W in a layout, formatted like the game ("+144.1%"). */
export function shownAt(cls: RivenClass, tag: string, layout: Layout, w: number): string {
  const stat = statOf(cls, tag);
  return formatDisplay(stat, displayNumber(stat, rawValue(stat, layout, false, w)));
}

/**
 * Roll range and shown-value range a wanted stat must land in, for one layout: "1.07–1.10" and
 * "+144.1% ~ +148.1%". `wLo` above 1.1 means the bar cannot be reached; null is returned then.
 */
export function barRange(cls: RivenClass, tag: string, layout: Layout, wLo: number): { w: string; shown: string } | null {
  if (wLo > 1.1 + 1e-9) return null;
  const lo = Math.max(0.9, wLo);
  // tier bars are round (1.07); bars converted from a shown value keep a third decimal (1.039)
  const loText = Math.abs(lo * 100 - Math.round(lo * 100)) < 1e-6 ? lo.toFixed(2) : lo.toFixed(3);
  return { w: `${loText}–1.10`, shown: `${shownAt(cls, tag, layout, lo)} ~ ${shownAt(cls, tag, layout, 1.1)}` };
}

/** Every wanted stat group across all alternative targets. */
export const allGroups = (t: TargetDraft) => t.sets.flat();

/** A target row filled in enough to plan for. */
export const complete = (g: GroupDraft) =>
  g.tags.length > 0 && (g.tier !== "value" || (g.value != null && Number.isFinite(g.value))) && (g.tier !== "w" || (g.w != null && Number.isFinite(g.w)));
/** Alternative targets that are filled in enough to plan for. */
const usableSets = (t: TargetDraft) => t.sets.filter((gs) => gs.length > 0 && gs.every(complete));

export function autoLayouts(t: TargetDraft): string[] {
  const n = t.wantNeg ? 1 : 0;
  const sizes = t.sets.map((gs) => gs.length).filter((x) => x > 0);
  return sizes.length && Math.min(...sizes) >= 3 ? [`3${n}`] : [`2${n}`, `3${n}`];
}

/** The layouts the target accepts: the picked ones that fit the negative setting, or the automatic choice when none do. */
export function effectiveLayouts(t: TargetDraft): string[] {
  const picked = t.layouts.filter((k) => t.wantNeg || k.endsWith("0"));
  return picked.length ? picked : autoLayouts(t);
}

export function toEngineTarget(t: TargetDraft, cls: RivenClass): Target | null {
  const sets = usableSets(t);
  if (!sets.length) return null;
  const tags = new Set(GAME.classes[cls].stats.map((s) => s.tag));
  if (sets.some((groups) => groups.some((g) => g.tags.some((tag) => !tags.has(tag))))) return null;
  if (!Number.isFinite(t.tiers.mid) || !Number.isFinite(t.tiers.hi)) return null;
  const keys = effectiveLayouts(t);
  const layouts = LAYOUTS.filter((l) => keys.includes(layoutKey(l)) && l.pos >= Math.min(...sets.map((gs) => gs.length)));
  if (!layouts.length) return null;
  const atLeast = t.atLeast?.on ? { k: t.atLeast.k, w: t.tiers[t.atLeast.tier] } : undefined;
  const flat = sets.flat();
  let next = 0;
  const index = sets.map((gs) => gs.map(() => next++));
  const groups = flat.map((g) => {
    if (g.tier !== "value" || g.value == null) return { tags: g.tags, minW: minW(t, g.tier, g) };
    const minWBy: Record<string, Record<string, number>> = {};
    for (const tag of g.tags) {
      minWBy[tag] = {};
      for (const l of layouts) minWBy[tag][layoutKey(l)] = Math.max(0.9, groupBar(cls, t, g, tag, l));
    }
    const all = Object.values(minWBy).flatMap((m) => Object.values(m));
    return { tags: g.tags, minW: Math.min(...all), minWBy };
  });
  return { groups, sets: index, layouts, allowedNeg: t.wantNeg ? t.allowedNeg : [], atLeast };
}

export function statName(cls: RivenClass, tag: string, lang: Lang): string {
  return statOf(cls, tag).name[lang];
}

/**
 * OCR matches names across all riven classes; map a tag to the same-named stat of this weapon's class
 * (melee faction damage and gun faction damage share a name but not a tag).
 */
export function remapTag(cls: RivenClass, tag: string): string | null {
  const own = GAME.classes[cls].stats;
  if (own.some((s) => s.tag === tag)) return tag;
  const any = Object.values(GAME.classes)
    .flatMap((c) => c.stats)
    .find((s) => s.tag === tag);
  if (!any) return null;
  const hit = own.find((s) => s.name.en === any.name.en || s.name.zh === any.name.zh);
  return hit?.tag ?? null;
}

export function weaponName(weaponId: string | null, lang: Lang) {
  return weaponId ? (weaponById(weaponId)?.name[lang] ?? "") : "";
}

export const dataVersion = (lang: Lang) => (lang === "cn" ? GAME.version.cn : GAME.version.intl);
