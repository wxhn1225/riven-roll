import { describe, expect, it } from "vitest";
import { toEngineCard } from "../state";
import { weaponById } from "./data";
import { whyUnreachable } from "./diagnose";
import { poolFor } from "./pool";
import { type Card, Solver, type Target } from "./solver";

// 葬铭 riven with a spliced viral trait: +94.7% ammo, +109.7% viral, +141.1% multishot, −87.8% critical damage
const epitaph = weaponById("/Lotus/Weapons/Tenno/Pistols/TnWraitheSidearm/TnWraitheSidearmWeapon");
if (!epitaph) throw new Error("missing weapon");
const pool = poolFor(epitaph, { pos: ["WeaponAmmoMaxMod", "WeaponFireIterationsMod"], neg: ["WeaponCritDamageMod"] });
const spliced = toEngineCard("Pistol", {
  pos: [
    { tag: "WeaponAmmoMaxMod", shown: 94.7 },
    { tag: "WeaponViralDamageMod", shown: 109.7 },
    { tag: "WeaponFireIterationsMod", shown: 141.1 },
  ],
  neg: { tag: "WeaponCritDamageMod", shown: -87.8 },
  cycles: 31,
}) as Card;
const L31 = { pos: 3 as const, neg: 1 as const };
const crit = [
  { tags: ["WeaponCritChanceMod"], minW: 0.9 },
  { tags: ["WeaponCritDamageMod"], minW: 0.9 },
];
const allowed = pool.neg.filter((t) => !["WeaponCritChanceMod", "WeaponCritDamageMod", "WeaponDamageAmountMod"].includes(t));
const solve = (t: Target, c: Card) => {
  const s = new Solver(pool, t, "kuva");
  const id = s.solve(c).id;
  return { v: s.value[id], routes: s.routes(c) };
};

describe("spliced traits can be removed", () => {
  it("three other stats on a spliced 3+1 are reachable by removing the spliced trait", () => {
    const t: Target = { groups: [...crit, { tags: ["WeaponDamageAmountMod"], minW: 0.9 }], layouts: [L31], allowedNeg: allowed };
    const { v, routes } = solve(t, spliced);
    expect(Number.isFinite(v)).toBe(true);
    // removing it is one of the moves offered (keeping it a while to fish for a wanted stat can be better)
    expect(routes.some((r) => r.action.kind === "cycle" && r.action.drop)).toBe(true);
  });

  it("keeps the spliced trait when the target wants it", () => {
    const t: Target = { groups: [...crit, { tags: ["WeaponViralDamageMod"], minW: 0.9 }], layouts: [L31], allowedNeg: allowed };
    const { v, routes } = solve(t, spliced);
    expect(Number.isFinite(v)).toBe(true);
    const best = routes.find((r) => r.optimal);
    expect(best?.action.kind === "cycle" && !best.action.drop).toBe(true);
  });

  it("a spliced roll below the bar is replaced rather than a dead end", () => {
    const t: Target = { groups: [...crit, { tags: ["WeaponViralDamageMod"], minW: 1.09 }], layouts: [L31], allowedNeg: allowed };
    expect(Number.isFinite(solve(t, spliced).v)).toBe(true);
  });
});

describe("why a target is out of reach", () => {
  it("a layout with a negative needs an accepted negative", () => {
    const t: Target = { groups: crit, layouts: [L31], allowedNeg: [] };
    expect(solve(t, spliced).v).toBe(Number.POSITIVE_INFINITY);
    expect(whyUnreachable(spliced, t)).toEqual({ kind: "noNegative" });
  });

  it("bars above 1.10 and too many stats for the layout", () => {
    const high: Target = { groups: [{ tags: ["WeaponCritChanceMod"], minW: 1.12 }], layouts: [L31], allowedNeg: allowed };
    expect(solve(high, spliced).v).toBe(Number.POSITIVE_INFINITY);
    expect(whyUnreachable(spliced, high)).toEqual({ kind: "barTooHigh", tags: ["WeaponCritChanceMod"] });
    const three = [...crit, { tags: ["WeaponDamageAmountMod"], minW: 0.9 }];
    expect(whyUnreachable(spliced, { groups: three, layouts: [{ pos: 2, neg: 1 }], allowedNeg: allowed })).toEqual({ kind: "tooMany", need: 3, max: 2 });
  });
});

describe("a stat this weapon no longer rolls", () => {
  it("says so instead of a general reason", () => {
    // the Grimoire stopped rolling magazine capacity; a riven that has it keeps it, here under the bar
    const grimoire = weaponById("/Lotus/Weapons/Tenno/Grimoire/TnGrimoire");
    if (!grimoire) throw new Error("missing Grimoire");
    const CLIP = "WeaponClipMaxMod";
    const p = poolFor(grimoire, { pos: [CLIP] });
    const card: Card = { layout: { pos: 2, neg: 0 }, pos: [CLIP, "WeaponDamageAmountMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };
    const t: Target = { groups: [{ tags: [CLIP], minW: 1.07 }], layouts: [{ pos: 2, neg: 0 }], allowedNeg: [] };
    const s = new Solver(p, t, "kuva");
    const id = s.solve(card).id;
    expect(s.value[id]).toBe(Number.POSITIVE_INFINITY);
    expect(whyUnreachable(card, t, p)).toEqual({ kind: "cannotRoll", tags: [CLIP], onCard: "bar", layout: "20" });
    // enough roll, but the target only takes 3+0: keeping it means keeping 2+0
    const other: Target = { ...t, groups: [{ tags: [CLIP], minW: 0.9 }], layouts: [{ pos: 3, neg: 0 }] };
    expect(whyUnreachable(card, other, p)).toEqual({ kind: "cannotRoll", tags: [CLIP], onCard: "layout", layout: "20" });
  });
});
