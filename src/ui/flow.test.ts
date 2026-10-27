import { describe, expect, it } from "vitest";
import { weaponById } from "../engine/data";
import type { RouteStats } from "../engine/planner";
import { poolFor } from "../engine/pool";
import type { Route } from "../engine/solver";
import { readTarget } from "../quick";
import { afterMissed, defaultTarget, demoSession, effectiveLayouts, stepAfter } from "../state";
import { patchFrom } from "./QuickTarget";
import { routeView } from "./RouteList";
import { routeKey } from "./routeText";
import { countRule } from "./Target";

const route = (lock: string, optimal: boolean): Route => ({
  action: { kind: "cycle", lock: lock === "none" ? "none" : { tag: lock, stats: [lock], w: 1 } },
  stepChance: 0.1,
  stepCycles: 10,
  stepCyclesP90: 22,
  expected: 0,
  outcomes: [],
  worse: [],
  optimal,
});
const q = (mean: number) => ({ mean, p10: mean, p25: mean, p50: mean, p75: mean, p90: mean });
const stats = (r: Route, kuva: number, within: number | null): RouteStats => ({ route: r, kuva: q(kuva), cycles: q(1), splicers: 0, withinBudget: within });

describe("which route the page opens", () => {
  const lock = stats(route("WeaponFireDamageMod", true), 80_000, 0);
  const free = stats(route("none", false), 110_000, 0.03);

  it("opens the solver's pick, or the route the player opened", () => {
    const v = routeView([free, lock], "kuva", 3500, null);
    expect(v.rec).toBe(lock.route);
    expect(v.open).toBe(routeKey(lock.route));
    expect(routeView([free, lock], "kuva", 3500, routeKey(free.route)).open).toBe(routeKey(free.route));
  });
});

describe("the step tally", () => {
  it("adds up on one route and starts again on another", () => {
    let step = stepAfter({ cycles: 0, kuva: 0 }, 7000, "a");
    step = stepAfter(step, 7000, "a");
    expect(step).toEqual({ cycles: 2, kuva: 14000, route: "a" });
    expect(stepAfter(step, 3500, "b")).toEqual({ cycles: 1, kuva: 3500, route: "b" });
    const x = afterMissed(demoSession("zh"), 7000, "a");
    expect(x.step.route).toBe("a");
    // a tally from before steps had routes belongs to no route: a counted cycle starts a new one
    expect(stepAfter({ cycles: 3, kuva: 21000 }, 3500, "b")).toEqual({ cycles: 1, kuva: 3500, route: "b" });
  });
});

describe("a typed target", () => {
  const epitaph = weaponById("/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon");
  if (!epitaph) throw new Error("missing weapon");
  const pool = poolFor(epitaph);
  it("that only sets the negative keeps the layouts picked by hand", () => {
    const target = { ...defaultTarget(), sets: [[{ tags: ["WeaponFireIterationsMod"], tier: "any" as const }]], layouts: ["31"], layoutsAuto: false };
    const patch = patchFrom(readTarget("负变焦", "Pistol", pool), pool);
    expect(patch.layoutsAuto).toBeUndefined();
    expect(effectiveLayouts({ ...target, ...patch })).toEqual(["31"]);
    // wanting no negative leaves no picked layout that fits: the automatic choice takes over
    expect(effectiveLayouts({ ...target, ...patchFrom(readTarget("不要负", "Pistol", pool), pool) })).toEqual(["20", "30"]);
  });

  it("with new stats lets the layouts follow them", () => {
    expect(patchFrom(readTarget("多重 暴击 暴伤", "Pistol", pool), pool).layoutsAuto).toBe(true);
  });
});

describe("the count rule note", () => {
  const groups = (n: number) => Array.from({ length: n }, () => ({ tags: ["WeaponFireIterationsMod"], tier: "any" as const }));
  it("gives the count that applies: a target with fewer rows needs all of them", () => {
    const base = { ...defaultTarget(), atLeast: { on: true, k: 2, tier: "hi" as const } };
    expect(countRule({ ...base, sets: [groups(3)] })).toEqual([["", 2]]);
    expect(countRule({ ...base, sets: [groups(1)] })).toEqual([["", 1]]);
    expect(countRule({ ...base, sets: [groups(3), groups(1)] })).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
    // a target still being filled in (a row without a stat) is left out, as the plan leaves it out
    expect(countRule({ ...base, sets: [[...groups(1), { tags: [], tier: "any" as const }], groups(1)] })).toEqual([["", 1]]);
  });
});
