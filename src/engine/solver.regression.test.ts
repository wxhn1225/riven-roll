import { describe, expect, it } from "vitest";
import { defaultTarget, toEngineTarget } from "../state";
import { GAME } from "./data";
import { LAYOUTS, W_MAX } from "./formula";
import { type Pool, poolFor } from "./pool";
import { type Card, cycleCostTotal, Solver, type Target } from "./solver";

const pool: Pool = { cls: "Rifle", pos: ["a", "b", "c", "d"], neg: ["a", "b", "c", "d"], keptPos: [], keptNeg: [], spliced: [], splices: [] };
const card: Card = {
  layout: { pos: 2, neg: 0 },
  pos: [
    { tag: "b", w: 1 },
    { tag: "c", w: 1 },
  ],
  neg: null,
  spliced: null,
};
const target: Target = { groups: [{ tags: ["a"], minW: 0.9 }], layouts: LAYOUTS, allowedNeg: pool.neg };

function value(p: Pool, t: Target, c: Card) {
  const solver = new Solver(p, t);
  const start = solver.solve(c);
  return solver.value[start.id];
}

/** Independent expectation for a geometric wait, paying each introductory price only if reached. */
function geometricKuva(p: number, done = 0, locked = false) {
  const prices = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150];
  let expected = 0;
  let survival = 1;
  for (let i = done; i < prices.length; i++) {
    expected += survival * prices[i];
    survival *= 1 - p;
  }
  return (expected + (survival * 3500) / p) * (locked ? 2 : 1);
}

describe("probability support and state identities", () => {
  it.each([110, 130])("an impossible Braton layout cannot change the cost of multishot >= %s", (shown) => {
    const weapon = GAME.weapons.find((w) => w.name.en === "Braton");
    if (!weapon) throw new Error("missing Braton");
    const p = poolFor(weapon);
    const wanted = toEngineTarget(
      {
        ...defaultTarget(),
        sets: [[{ tags: ["WeaponFireIterationsMod"], tier: "value", value: shown }]],
        layouts: ["20", "21", "30", "31"],
        layoutsAuto: false,
        allowedNeg: p.neg,
      },
      weapon.cls,
    );
    if (!wanted) throw new Error("missing target");
    const possibleOnly = {
      ...wanted,
      layouts: wanted.layouts.filter((layout) => (wanted.groups[0].minWBy?.WeaponFireIterationsMod[`${layout.pos}${layout.neg}`] ?? 0) <= W_MAX),
    };
    expect(possibleOnly.layouts.length).toBeLessThan(wanted.layouts.length);
    const start: Card = {
      ...card,
      pos: [
        { tag: "WeaponFireDamageMod", w: 1 },
        { tag: "WeaponFreezeDamageMod", w: 1 },
      ],
    };
    const actual = value(p, wanted, start);
    expect(Number.isFinite(actual)).toBe(true);
    expect(actual).toBeCloseTo(value(p, possibleOnly, start), 5);
  });

  it("an unreachable alternative does not spoil a reachable target", () => {
    const either: Target = { ...target, groups: [...target.groups, { tags: ["a"], minW: 2 }], sets: [[0], [1]] };
    expect(value(pool, either, card)).toBeCloseTo(value(pool, target, card), 7);
    expect(value(pool, { ...target, groups: [{ tags: ["a"], minW: 2 }] }, card)).toBe(Number.POSITIVE_INFINITY);
  });

  it("eight or more quality thresholds cannot alias another stat", () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({ tags: ["a"], minW: 0.91 + i * 0.01 }));
    const alternatives: Target = { ...target, groups, sets: groups.map((_, i) => [i]) };
    const done: Card = {
      ...card,
      pos: [
        { tag: "a", w: 1.05 },
        { tag: "b", w: 1 },
      ],
    };
    const solver = new Solver(pool, alternatives);
    expect(solver.isGoal(solver.stateOf(done))).toBe(true);
    expect(value(pool, alternatives, card)).toBeCloseTo(value(pool, { ...target, groups: [groups[0]] }, card), 6);
  });

  it("overlapping target groups require separate traits", () => {
    const wanted: Target = {
      ...target,
      groups: [
        { tags: ["a", "b"], minW: 0.9 },
        { tags: ["a"], minW: 0.9 },
      ],
    };
    const solver = new Solver(pool, wanted);
    expect(
      solver.isGoal(
        solver.stateOf({
          ...card,
          pos: [
            { tag: "a", w: 1 },
            { tag: "c", w: 1 },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      solver.isGoal(
        solver.stateOf({
          ...card,
          pos: [
            { tag: "a", w: 1 },
            { tag: "b", w: 1 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("the at-least rule counts matched high traits, not repeated uses of one trait", () => {
    const wanted: Target = {
      ...target,
      groups: [
        { tags: ["a", "b"], minW: 0.9 },
        { tags: ["a", "c"], minW: 0.9 },
      ],
      atLeast: { k: 2, w: 1.07 },
    };
    const solver = new Solver(pool, wanted);
    expect(
      solver.isGoal(
        solver.stateOf({
          ...card,
          pos: [
            { tag: "a", w: 1.08 },
            { tag: "b", w: 1 },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      solver.isGoal(
        solver.stateOf({
          ...card,
          pos: [
            { tag: "a", w: 1.08 },
            { tag: "b", w: 1.08 },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("actual price expectations and rare waits", () => {
  it.each(["kuva", "cycles"] as const)("evaluates introductory prices for the %s policy", (objective) => {
    const wanted: Target = { ...target, layouts: LAYOUTS.filter((l) => l.neg === 0), allowedNeg: [] };
    const solver = new Solver(pool, wanted, objective);
    solver.solve(card);
    const route = solver.routes(card).find((r) => r.optimal);
    if (!route) throw new Error("missing optimal route");
    // Unlocked from A (2+0 b,c): the goal needs a negative-free layout with a, (1/4)(2/4) + (1/4)(3/4) = 5/16.
    // A 3+0 card without a (1/16) is worth keeping: locking any of its traits holds 3+0 and draws two of
    // the other three stats, so a comes with 2/3 per (doubled) cycle. Everything else leaves A as good as it was.
    // Both objectives choose this policy.
    const chain = (done: number) => {
      let a = (3500 + (1 / 16) * 10500) / (6 / 16);
      let c = 7000 / (2 / 3);
      for (let d = 8; d >= done; d--) [a, c] = [cycleCostTotal(d, 1, false) + (10 / 16) * a + (1 / 16) * c, cycleCostTotal(d, 1, true) + (1 / 3) * c];
      return a;
    };
    expect(solver.expectedKuva(card, route, 0)).toBeCloseTo(chain(0), 7);
    expect(solver.expectedKuva(card, route, 8)).toBeCloseTo(chain(8), 7);
    expect(solver.expectedKuva(card, route, 9)).toBeCloseTo(chain(9), 7);
  });

  it("evaluates the doubled prices of a negative-lock route under either objective", () => {
    const p: Pool = { ...pool, pos: [...pool.pos, "e"], neg: [...pool.neg, "e"] };
    const start: Card = { layout: { pos: 3, neg: 1 }, pos: ["c", "d", "e"].map((tag) => ({ tag, w: 1 })), neg: { tag: "b", w: 1 }, spliced: null };
    for (const objective of ["kuva", "cycles"] as const) {
      const solver = new Solver(p, { ...target, allowedNeg: p.neg }, objective);
      solver.solve(start);
      const route = solver.routes(start).find((r) => r.action.kind === "cycle" && r.action.lock === "neg");
      if (!route) throw new Error("missing negative-lock route");
      expect(solver.expectedKuva(start, route, 0)).toBeCloseTo(geometricKuva(3 / 4, 0, true), 7);
    }
  });

  it("follows a cycle-saving policy that changes to a paid lock after the first step", () => {
    const solver = new Solver(pool, target, "cycles");
    solver.solve(card);
    const route = solver.routes(card).find((r) => r.optimal);
    if (!route) throw new Error("missing optimal route");
    // Independent chain: A (2+0 b,c) cycles unlocked: goal 5/8. Three results, 1/16 each, are worth keeping,
    // and each finishes with 2/3 per locked cycle: 2+1 with a junk negative (lock it, draw two of a,b,c),
    // 3+0 without a (lock any trait, draw two of the other three), and 3+1 whose negative is a (lock a
    // positive, draw two of the rest). The other 3/16 leave A as good as it was.
    // They save cycles but pay twice the price, so the first action's price is not a global multiplier.
    let b = 7000 / (2 / 3);
    let a = (3500 + (3 / 16) * b) / (13 / 16);
    expect(solver.expectedKuva(card, route, 9)).toBeCloseTo(a, 5);
    for (const price of [3150, 2750, 2350, 2000, 1700, 1400, 1200, 1000, 900]) {
      [a, b] = [price + (3 / 16) * a + (3 / 16) * b, 2 * price + b / 3];
    }
    expect(solver.expectedKuva(card, route, 0)).toBeCloseTo(a, 5);
  });

  it("a free splice preserves the current price counter for its continuation", () => {
    // Both recipes keep the retained d identifiable rather than aggregating it as an irrelevant stat.
    const p: Pool = {
      ...pool,
      spliced: ["ab"],
      splices: [
        { result: "ab", a: "a", b: "b" },
        { result: "ab", a: "a", b: "d" },
      ],
    };
    const wanted: Target = {
      groups: [
        { tags: ["ab"], minW: 0.9 },
        { tags: ["c"], minW: 0.9 },
      ],
      layouts: [{ pos: 3, neg: 0 }],
      allowedNeg: [],
    };
    const start: Card = { ...card, layout: { pos: 3, neg: 0 }, pos: ["a", "b", "d"].map((tag) => ({ tag, w: 1 })) };
    const solver = new Solver(p, wanted, "kuva");
    solver.solve(start);
    const route = solver.routes(start).find((r) => r.action.kind === "splice");
    if (!route) throw new Error("missing splice route");
    // The refill picks c in 1/3 of cases; otherwise each unlocked cycle with the splice kept draws c in 2/4.
    expect(solver.expectedKuva(start, route, 0)).toBeCloseTo((2 / 3) * geometricKuva(1 / 2), 6);
    expect(solver.expectedKuva(start, route, 8)).toBeCloseTo((2 / 3) * geometricKuva(1 / 2, 8), 6);
  });

  it.each(["kuva", "cycles"] as const)("retains a free terminal splice as a valid action for the %s policy", (objective) => {
    const p: Pool = { ...pool, spliced: ["ab"], splices: [{ result: "ab", a: "a", b: "b" }] };
    const wanted: Target = { ...target, groups: [{ tags: ["ab"], minW: 0.9 }] };
    const start: Card = { ...card, pos: ["a", "b"].map((tag) => ({ tag, w: 1 })) };
    const solver = new Solver(p, wanted, objective);
    solver.solve(start);
    const route = solver.routes(start).find((r) => r.optimal);
    if (!route) throw new Error("missing free terminal splice");
    expect(route.action.kind).toBe("splice");
    expect(solver.expectedKuva(start, route, 0)).toBe(0);
    const sim = solver.simulate(start, route, 0, 1, () => 0.5);
    expect(sim.cycles[0]).toBe(0);
    expect(sim.kuva[0]).toBe(0);
    expect(sim.splicers[0]).toBe(1);
  });

  it("sums a trillion flat-price cycles without iterating through them", () => {
    expect(cycleCostTotal(9, 1e12, false)).toBe(3500e12);
    expect(cycleCostTotal(8, 1e12, true)).toBe(2 * (3150 + (1e12 - 1) * 3500));
  });

  it("samples a very rare geometric wait without subtractive cancellation or a per-cycle loop", () => {
    const tags = Array.from({ length: 23 }, (_, i) => String(i));
    const p: Pool = { ...pool, pos: tags, neg: tags };
    const wanted: Target = { ...target, groups: [{ tags: ["0"], minW: W_MAX - Number.EPSILON }], allowedNeg: tags };
    const start: Card = {
      ...card,
      pos: [
        { tag: "1", w: 1 },
        { tag: "2", w: 1 },
      ],
    };
    const solver = new Solver(p, wanted);
    solver.solve(start);
    const route = solver.routes(start)[0];
    const q = (2.5 / 23) * (Number.EPSILON / 0.2);
    const expected = Math.ceil(Math.log(0.5) / Math.log1p(-route.stepChance));
    expect(route.stepChance).toBeCloseTo(q, 28);
    const sim = solver.simulate(start, route, 9, 1, () => 0.5);
    expect(sim.cycles[0]).toBe(expected);
    expect(sim.kuva[0]).toBe(expected * 3500);
  });
});
