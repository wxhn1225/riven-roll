import { type RivenClass, type Splice, type StatDef, splicesOf, statsOf, type Weapon } from "./data";

/** Which normal stats can be on a weapon's riven, which of them new cycles draw, and which splices exist for its class. */
export interface Pool {
  cls: RivenClass;
  /** stats the riven can show as a positive / a negative (new draws, and old ones seen on the card) */
  pos: string[];
  neg: string[];
  /** seen on the card but no longer drawn by a cycle (e.g. a stat the game stopped rolling): kept, never drawn again */
  keptPos: string[];
  keptNeg: string[];
  spliced: string[];
  splices: Splice[];
}

const PHYSICAL = ["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"];

function passes(stat: StatDef, weapon: Weapon, restrictions: string[]): boolean {
  if (!stat.compat.every((t) => weapon.tags.includes(t))) return false;
  for (const r of restrictions) {
    if (r === "NotSentinel" && weapon.sentinel) return false;
    if (r === "NotGrimoire" && weapon.grimoire) return false;
    if (r === "DamageTypes" && PHYSICAL.includes(stat.tag) && !weapon.physical.includes(stat.tag)) return false;
  }
  return true;
}

/**
 * `seen` lists stats observed on the player's riven. An old riven can keep a stat the game no longer rolls (the
 * Grimoire's magazine capacity), so a seen stat can be on the card, kept, locked and spliced, but it does not make
 * new cycles draw it.
 */
export function poolFor(weapon: Weapon, seen: { pos?: string[]; neg?: string[] } = {}): Pool {
  const stats = statsOf(weapon.cls);
  const normal = stats.filter((s) => !s.spliced);
  const drawPos = normal.filter((s) => s.buff && passes(s, weapon, s.buffRestr)).map((s) => s.tag);
  const drawNeg = normal.filter((s) => s.curse && passes(s, weapon, s.curseRestr)).map((s) => s.tag);
  const keptPos = normal.filter((s) => s.buff && !drawPos.includes(s.tag) && seen.pos?.includes(s.tag)).map((s) => s.tag);
  const keptNeg = normal.filter((s) => s.curse && !drawNeg.includes(s.tag) && seen.neg?.includes(s.tag)).map((s) => s.tag);
  const pos = normal.filter((s) => drawPos.includes(s.tag) || keptPos.includes(s.tag)).map((s) => s.tag);
  const neg = normal.filter((s) => drawNeg.includes(s.tag) || keptNeg.includes(s.tag)).map((s) => s.tag);
  const can = new Set([...pos, ...neg]);
  const splices = splicesOf(weapon.cls).filter((r) => can.has(r.a) && can.has(r.b));
  // a spliced trait already on the riven stays what it is, though its ingredients may be gone (an old stat it used
  // up can never come back): it counts for the target, while new splices still need ingredients that can be there
  const held = stats.filter((s) => s.spliced && seen.pos?.includes(s.tag)).map((s) => s.tag);
  const spliced = [...new Set([...splices.map((r) => r.result), ...held])];
  return { cls: weapon.cls, pos, neg, keptPos, keptNeg, spliced, splices };
}
