// The real-number shorthand is b × 10 × (rank + 1) × D × L × W.
// Card values use the ordered binary32 operations below; solver probabilities do not.
import { GAME, type StatDef } from "./data";

export const W_MIN = 0.9;
export const W_MAX = 1.1;

export interface Layout {
  pos: 2 | 3;
  neg: 0 | 1;
}

export const LAYOUTS: Layout[] = [
  { pos: 2, neg: 0 },
  { pos: 2, neg: 1 },
  { pos: 3, neg: 0 },
  { pos: 3, neg: 1 },
];

export const layoutKey = (l: Layout) => `${l.pos}${l.neg}`;

/** Signed layout multiplier L: positive for buffs, negative for curses. */
export function layoutMultiplier(layout: Layout, curse: boolean): number {
  const { numBuffsAtten, numBuffsCurseAtten, curseAtten, specificFit } = GAME.layout;
  if (curse) return -numBuffsCurseAtten[layout.pos] * specificFit;
  return numBuffsAtten[layout.pos] * specificFit * (layout.neg ? curseAtten : 1);
}

/** Disposition (倾向): every weapon has had 1.2 since 22 October 2026, the game data's value. */
export const DEFAULT_DISPOSITION = GAME.layout.disposition;
/** the span dispositions had before they were made the same for every weapon */
export const DISPOSITION_MIN = 0.5;
export const DISPOSITION_MAX = 1.55;
let disposition = DEFAULT_DISPOSITION;

/**
 * A disposition as it is kept and shown: four decimals at most, so the number on screen is the number computed with
 * (1.234 shows as 1.234, never as 1.23 while 1.234 is used).
 */
export const tidyDisposition = (d: number) => Math.round(d * 1e4) / 1e4;
export const formatDisposition = (d: number) => (Math.abs(d * 100 - Math.round(d * 100)) < 1e-9 ? d.toFixed(2) : String(tidyDisposition(d)));

/** The disposition every value is worked out with; the page sets the player's own before it computes anything. */
export function setDisposition(d: number) {
  disposition = Number.isFinite(d) ? tidyDisposition(Math.min(DISPOSITION_MAX, Math.max(DISPOSITION_MIN, d))) : DEFAULT_DISPOSITION;
}

/** The disposition values are worked out with now. */
export const currentDisposition = () => disposition;

/** Raw modifier v for a roll quality W. */
export function rawValue(stat: StatDef, layout: Layout, curse: boolean, w: number, rank = GAME.layout.maxRank): number {
  if (!Number.isFinite(w) || !Number.isFinite(stat.base) || !Number.isInteger(rank) || rank < 0 || rank > GAME.layout.maxRank) return Number.NaN;
  if ((layout.pos !== 2 && layout.pos !== 3) || (layout.neg !== 0 && layout.neg !== 1) || (curse && !layout.neg)) return Number.NaN;
  const f = Math.fround;
  const cfg = GAME.layout;
  const shared = f(f(10) * f(f(1) * f(f(disposition) * f(cfg.specificFit))));
  const base = f(stat.base);
  const quality = f(w);
  const value0 = curse
    ? -f(f(quality * f(cfg.numBuffsCurseAtten[layout.pos])) * f(f(shared * f(cfg.numBuffsAtten[layout.neg])) * base))
    : f(f(quality * f(cfg.numBuffsAtten[layout.pos])) * f(f(f(layout.neg ? cfg.curseAtten : 1) * shared) * base));
  const t = f(f(GAME.layout.maxRank) * f(f(rank) / f(GAME.layout.maxRank)));
  return f(f(t * value0) + value0);
}

/** Display direction is independent of whether the underlying modifier is beneficial. */
const displaySign = (stat: StatDef) => (stat.reverse || stat.tag === "WeaponAmmoEfficiency" ? -1 : 1);

/** Accept an unsigned magnitude in a positive/negative trait editor. Multipliers retain their value. */
export function signedDisplayInput(stat: StatDef | undefined, curse: boolean, value: number | null): number | null {
  if (value == null || !stat || stat.fmt === "mult" || value === 0) return value;
  return Math.abs(value) * Math.sign(stat.base) * displaySign(stat) * (curse ? -1 : 1);
}

/** The number the game shows: 144.5 for "+144.5%", 1.49 for "x1.49", 3.3 for "+3.3". */
export function displayNumber(stat: StatDef, v: number): number {
  if (!Number.isFinite(v)) return Number.NaN;
  const f = Math.fround;
  // Ammo efficiency supplies a positive percentage through its description
  // formatter. ReverseValueSymbol, in contrast, changes the sign after rounding.
  const value = stat.tag === "WeaponAmmoEfficiency" ? -v : v;
  let rounded: number;
  switch (stat.fmt) {
    case "pct":
      rounded = roundTo(f(f(value) * f(100)), stat);
      break;
    case "mult":
      rounded = roundTo(f(f(1) + f(value)), stat);
      break;
    default:
      rounded = roundTo(f(value), stat);
  }
  return stat.reverse ? -rounded : rounded;
}

function roundTo(x: number, stat: StatDef): number {
  const step = stat.roundTo;
  if (!Number.isFinite(step) || step <= 0) return Number.NaN;
  const f = Math.fround;
  const units = f(x / f(step));
  const n = stat.roundingMode === "RM_FLOOR" ? Math.floor(units) : stat.roundingMode === "RM_CEIL" ? Math.ceil(units) : Math.floor(f(units + f(0.5)));
  const r = f(n * f(step));
  return Number(r.toFixed(Math.max(0, Math.ceil(-Math.log10(step)))));
}

/** Inverse of displayNumber: the interval of v that rounds to the shown number. */
function rawInterval(stat: StatDef, shown: number): [number, number] {
  const s = displaySign(stat);
  const step = stat.roundTo;
  const [low, high] = stat.roundingMode === "RM_FLOOR" ? [shown, shown + step] : stat.roundingMode === "RM_CEIL" ? [shown - step, shown] : [shown - step / 2, shown + step / 2];
  const toRaw = (d: number) => {
    switch (stat.fmt) {
      case "pct":
        return (s * d) / 100;
      case "mult":
        return s * (d - 1);
      default:
        return s * d;
    }
  };
  const a = toRaw(low);
  const b = toRaw(high);
  return a < b ? [a, b] : [b, a];
}

export interface QualityReading {
  /** Best estimate of W (midpoint of the rounding interval). */
  w: number;
  lo: number;
  hi: number;
  /** False when the shown value is impossible for this stat, layout and rank. */
  valid: boolean;
}

/** Roll quality W (the 0.9–1.1 "浮动系数") from the value shown in game. */
export function qualityFromDisplay(stat: StatDef, layout: Layout, curse: boolean, shown: number, rank = GAME.layout.maxRank): QualityReading {
  const invalid = { w: Number.NaN, lo: Number.NaN, hi: Number.NaN, valid: false };
  if (!Number.isFinite(shown) || !Number.isFinite(stat.roundTo) || stat.roundTo <= 0) return invalid;
  const unit = rawValue(stat, layout, curse, 1, rank);
  if (!Number.isFinite(unit) || unit === 0) return invalid;
  const [a, b] = rawInterval(stat, shown);
  const w1 = a / unit;
  const w2 = b / unit;
  const approximateLo = Math.min(w1, w2);
  const approximateHi = Math.max(w1, w2);
  const direction = Math.sign(displaySign(stat) * unit);
  const target = direction * shown;
  const at = (w: number) => direction * displayNumber(stat, rawValue(stat, layout, curse, w, rank));
  if (target < at(W_MIN) || target > at(W_MAX)) {
    return { w: Math.min(W_MAX, Math.max(W_MIN, (approximateLo + approximateHi) / 2)), lo: approximateLo, hi: approximateHi, valid: false };
  }
  // Invert the actual monotone f32/display pipeline. A real-number half-step
  // interval can exclude a valid endpoint or misclassify a rounding boundary.
  const boundary = (strict: boolean) => {
    const reached = (w: number) => (strict ? at(w) > target : at(w) >= target);
    if (reached(W_MIN)) return W_MIN;
    if (!reached(W_MAX)) return W_MAX;
    let lo = W_MIN;
    let hi = W_MAX;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (reached(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const lo = boundary(false);
  const hi = boundary(true);
  const w = (lo + hi) / 2;
  return { w, lo, hi, valid: at(w) === target };
}

/**
 * Minimum W meeting a displayed-value target, in the direction improved by W.
 * Unlike reading an existing card, targets may lie between displayed increments:
 * ">=110.05%" is satisfied by 110.1%. Infinity means the target is unreachable.
 */
export function minimumQualityForDisplay(stat: StatDef, layout: Layout, curse: boolean, shown: number, rank = GAME.layout.maxRank): number {
  if (!Number.isFinite(shown) || !Number.isFinite(stat.roundTo) || stat.roundTo <= 0) return Number.POSITIVE_INFINITY;
  const unit = rawValue(stat, layout, curse, 1, rank);
  if (!Number.isFinite(unit) || unit === 0) return Number.POSITIVE_INFINITY;
  const direction = Math.sign(displaySign(stat) * unit);
  const target = direction * shown;
  const reaches = (w: number) => direction * displayNumber(stat, rawValue(stat, layout, curse, w, rank)) >= target;
  if (reaches(W_MIN)) return W_MIN;
  if (!reaches(W_MAX)) return Number.POSITIVE_INFINITY;
  let lo = W_MIN;
  let hi = W_MAX;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Text for a value as the game prints it, e.g. "+144.5%", "x1.49", "-47.1%". */
export function formatDisplay(stat: StatDef, shown: number): string {
  if (stat.fmt === "mult") return `x${shown.toFixed(2)}`;
  const sign = shown > 0 ? "+" : shown < 0 ? "-" : "";
  const n = Math.abs(shown);
  const body = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${sign}${body}${stat.fmt === "pct" ? "%" : ""}`;
}
