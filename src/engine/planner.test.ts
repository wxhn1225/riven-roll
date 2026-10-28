import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME, statOf } from "./data";
import { LAYOUTS, qualityFromDisplay } from "./formula";
import { Planner, type PlanRequest, type PlanResponse, WORK_BUDGET } from "./planner";
import { poolFor } from "./pool";
import { type Card, Solver, type Target, TOO_COMPLEX, TooComplexError, WorkAccount } from "./solver";

const weapon = GAME.weapons.find((w) => w.name.en === "Braton");
if (!weapon) throw new Error("missing Braton");
const request: PlanRequest = {
  id: 1,
  weaponId: weapon.id,
  card: {
    layout: { pos: 2, neg: 0 },
    pos: [
      { tag: "WeaponFireDamageMod", w: 1 },
      { tag: "WeaponFreezeDamageMod", w: 1 },
    ],
    neg: null,
    spliced: null,
  },
  target: { groups: [{ tags: ["WeaponCritChanceMod"], minW: 0.9 }], layouts: LAYOUTS, allowedNeg: poolFor(weapon).neg },
  objective: "cycles",
  cyclesDone: 0,
  budget: null,
  runs: 20,
};

afterEach(() => vi.restoreAllMocks());

it("changes budget without rerunning the graph or resampling its distributions", () => {
  const solve = vi.spyOn(Solver.prototype, "solve");
  const simulate = vi.spyOn(Solver.prototype, "simulate");
  const planner = new Planner(() => 0.5);
  const first = planner.plan(request);
  expect(first.ok).toBe(true);
  const solves = solve.mock.calls.length;
  const simulations = simulate.mock.calls.length;
  expect(simulations).toBeGreaterThan(0);
  const zero = planner.plan({ ...request, id: 2, budget: 0 });
  const rich = planner.plan({ ...request, id: 3, budget: 1e12 });
  if (!first.ok || !zero.ok || !rich.ok) throw new Error("plan failed");
  expect(zero.routes.every((r) => r.withinBudget === 0)).toBe(true);
  expect(rich.routes.every((r) => r.withinBudget === 1)).toBe(true);
  expect(first.routes.every((r) => r.withinBudget === null)).toBe(true);
  expect(rich.routes.map((r) => r.kuva)).toEqual(first.routes.map((r) => r.kuva));
  expect(rich.id).toBe(3);
  expect(solve).toHaveBeenCalledTimes(solves);
  expect(simulate).toHaveBeenCalledTimes(simulations);
  planner.plan({ ...request, cyclesDone: 9 });
  expect(solve).toHaveBeenCalledTimes(solves);
  expect(simulate.mock.calls.length).toBeGreaterThan(simulations);
});

it("keeps exact cycle expectations and Kuva amounts in their own units", () => {
  const result = new Planner(() => 0.5).plan({ ...request, compare: [request.card, request.card] });
  if (!result.ok) throw new Error(result.error);
  for (const stats of result.routes) {
    expect(stats.cycles.mean).toBe(stats.route.expected);
    expect(stats.kuva.mean).toBeGreaterThan(stats.cycles.mean * 800);
  }
  expect(result.compareValues[0]).toBe(result.compareValues[1]);
  expect(result.compareValues[0]).toBeLessThan(100);
});

it("names the negative that alone keeps a compared card from the target", () => {
  const traits = (third: string) => ["WeaponCritChanceMod", "WeaponFireDamageMod", third].map((tag) => ({ tag, w: 1 }));
  const old: Card = { layout: { pos: 3, neg: 1 }, pos: traits("WeaponFreezeDamageMod"), neg: { tag: "WeaponRecoilReductionMod", w: 1 }, spliced: null };
  const fresh: Card = { ...old, pos: traits("WeaponToxinDamageMod"), neg: { tag: "WeaponReloadSpeedMod", w: 1 } };
  const target: Target = {
    groups: ["WeaponCritChanceMod", "WeaponFireDamageMod", "WeaponToxinDamageMod"].map((tag) => ({ tags: [tag], minW: 0.9 })),
    layouts: [{ pos: 3, neg: 1 }],
    allowedNeg: ["WeaponRecoilReductionMod"],
  };
  const result = new Planner(() => 0.5).plan({ ...request, card: old, target, compare: [old, fresh] });
  if (!result.ok) throw new Error(result.error);
  expect(result.compareNeg).toEqual([null, "WeaponReloadSpeedMod"]);
  // accepted, the new card is done
  const accepted = new Planner(() => 0.5).plan({ ...request, card: old, target: { ...target, allowedNeg: [...target.allowedNeg, "WeaponReloadSpeedMod"] }, compare: [old, fresh] });
  if (!accepted.ok) throw new Error(accepted.error);
  expect(accepted.compareNeg).toEqual([null, null]);
  expect(accepted.compareValues[1]).toBe(0);
});

it.each([{ runs: 0 }, { runs: Number.NaN }, { cyclesDone: -1 }, { cyclesDone: 1.5 }, { budget: Number.POSITIVE_INFINITY }, { budget: -1 }])(
  "rejects invalid sampling and cost inputs %o",
  (bad) => expect(new Planner().plan({ ...request, ...bad }).ok).toBe(false),
);

it("answers a card that already meets the target without solving", () => {
  const solve = vi.spyOn(Solver.prototype, "solve");
  const done = new Planner(() => 0.5).plan({
    ...request,
    card: { ...request.card, pos: [{ tag: "WeaponCritChanceMod", w: 1 }, request.card.pos[1]] },
  });
  expect(done.ok && done.done).toBe(true);
  expect(solve).not.toHaveBeenCalled();
});

it("plans once for every count past the discounted cycles", () => {
  const simulate = vi.spyOn(Solver.prototype, "simulate");
  const planner = new Planner(() => 0.5);
  const a = planner.plan({ ...request, cyclesDone: 160 });
  const calls = simulate.mock.calls.length;
  const b = planner.plan({ ...request, id: 2, cyclesDone: 161 });
  expect(simulate.mock.calls.length).toBe(calls);
  if (!a.ok || !b.ok) throw new Error("plan failed");
  expect(b.routes.map((r) => r.kuva)).toEqual(a.routes.map((r) => r.kuva));
  // a count that is still discounted is its own plan
  planner.plan({ ...request, id: 3, cyclesDone: 3 });
  expect(simulate.mock.calls.length).toBeGreaterThan(calls);
});

describe("work budget", () => {
  // A Magistar riven, 3+1, 120 cycles:
  // +109.9% toxin, +108% critical damage, +221.3% critical chance (x2 for heavy attacks), and a status chance negative
  const magistar = GAME.weapons.find((w) => w.name.en === "Magistar");
  if (!magistar) throw new Error("missing Magistar");
  const L31 = { pos: 3, neg: 1 } as const;
  const roll = (tag: string, shown: number) => qualityFromDisplay(statOf("Melee", tag), L31, false, shown).w;
  const card = {
    layout: L31,
    pos: [
      { tag: "WeaponToxinDamageMod", w: roll("WeaponToxinDamageMod", 109.9) },
      { tag: "WeaponCritDamageMod", w: roll("WeaponCritDamageMod", 108) },
      { tag: "WeaponCritChanceMod", w: roll("WeaponCritChanceMod", 221.3) },
    ],
    neg: { tag: "WeaponStunChanceMod", w: 1 },
    spliced: null,
  };
  const ask = (target: Omit<PlanRequest["target"], "layouts" | "allowedNeg">, objective: PlanRequest["objective"]): PlanRequest => ({
    ...request,
    weaponId: magistar.id,
    card,
    target: { ...target, layouts: LAYOUTS, allowedNeg: poolFor(magistar).neg },
    objective,
    cyclesDone: 120,
    runs: 64,
  });
  // the heaviest shape the page allows without shown values: six rows of two or three stats, each at 1.05 and at 1.00
  // (groups 0-11), four alternative targets of three rows, and "at least 2 reach 1.07". It fits in WORK_BUDGET, so the
  // tests that need it stopped give the planner a smaller budget.
  const tight = 1_000_000;
  const rows = [
    ["WeaponCritChanceMod", "WeaponCritDamageMod"],
    ["WeaponToxinDamageMod", "WeaponFireDamageMod", "WeaponElectricityDamageMod"],
    ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"],
    ["WeaponMeleeDamageMod", "WeaponFireRateMod"],
    ["WeaponStunChanceMod", "WeaponProcTimeMod"],
    ["WeaponFreezeDamageMod", "WeaponStatusDamage"],
  ];
  const heavy = {
    groups: rows.flatMap((tags) => [1.05, 1.0].map((minW) => ({ tags, minW }))),
    sets: [
      [0, 2, 4],
      [6, 8, 10],
      [1, 3, 5],
      [7, 9, 11],
    ],
    atLeast: { k: 2, w: 1.07 },
  };
  // three rows of several stats each: a large target that is still ordinary
  const ordinary = {
    groups: [
      { tags: ["WeaponCritChanceMod", "WeaponCritDamageMod", "WeaponMeleeDamageMod"], minW: 1.05 },
      { tags: ["WeaponToxinDamageMod", "WeaponFireDamageMod", "WeaponElectricityDamageMod", "WeaponFreezeDamageMod"], minW: 1.05 },
      { tags: ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod", "WeaponStatusDamage"], minW: 1.05 },
    ],
  };
  const held = (p: Planner) => [...(p as unknown as { solved: Map<string, { solver: Solver }> }).solved.values()].map((e) => e.solver);

  it("stops a target too large to work out, with its own error, instead of running out of memory", () => {
    for (const objective of ["kuva", "cycles"] as const) {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const planner = new Planner(() => 0.5, tight);
      expect(planner.plan(ask(heavy, objective))).toEqual({ id: 1, ok: false, error: TOO_COMPLEX });
      expect(held(planner)).toHaveLength(0);
      // the next, ordinary target is worked out as usual
      const next = planner.plan(ask(ordinary, objective));
      expect(next.ok && next.routes.length > 0).toBe(true);
    }
  });

  it("leaves ordinary targets far inside the budget", () => {
    for (const objective of ["kuva", "cycles"] as const) {
      const planner = new Planner(() => 0.5);
      expect(planner.plan(ask(ordinary, objective)).ok).toBe(true);
      const work = held(planner).reduce((sum, s) => sum + s.workUsed, 0);
      expect(work).toBeGreaterThan(0);
      expect(work).toBeLessThan(WORK_BUDGET / 10);
    }
  });

  it("reuses the graph of a card in the same state, with the same plan as working it out anew", () => {
    // a roll moved but still under the same bars
    const nudged = { ...card, pos: card.pos.map((t, i) => (i === 0 ? { ...t, w: t.w + 0.0001 } : t)) };
    const strip = (r: PlanResponse) => ({ ...r, ms: 0 });
    const planner = new Planner(() => 0.5);
    planner.plan(ask(ordinary, "kuva"));
    const [solver] = held(planner);
    const reused = planner.plan({ ...ask(ordinary, "kuva"), card: nudged });
    expect(held(planner)).toEqual([solver]);
    expect(strip(reused)).toEqual(strip(new Planner(() => 0.5).plan({ ...ask(ordinary, "kuva"), card: nudged })));
  });

  it("keeps at most two solved graphs, the current card and a comparison", () => {
    const planner = new Planner(() => 0.5);
    const other = { ...card, pos: card.pos.map((t) => ({ ...t, w: 0.95 })) };
    const third = { ...card, pos: card.pos.map((t) => ({ ...t, w: 1.02 })) };
    const r = planner.plan({ ...ask(ordinary, "kuva"), compare: [other, third] });
    expect(r.ok && r.compareValues.length).toBe(2);
    expect(held(planner).length).toBeLessThanOrEqual(2);
  });

  it("throws once a solver passes its limit, while it grows", () => {
    const account = new WorkAccount(50);
    const solver = new Solver(poolFor(magistar), { ...ordinary, layouts: LAYOUTS, allowedNeg: poolFor(magistar).neg }, "kuva", account);
    expect(() => solver.solve(card)).toThrow(TooComplexError);
    // it stops right past the limit, not after building much more
    expect(account.used).toBeLessThan(60);
  });

  it("charges graphs kept side by side to one account, so together they cannot pass it", () => {
    const pool = poolFor(magistar);
    const target = { ...ordinary, layouts: LAYOUTS, allowedNeg: pool.neg };
    const alone = new WorkAccount(Number.POSITIVE_INFINITY);
    new Solver(pool, target, "kuva", alone).solve(card);
    // room for one graph and a half: the second one stops
    const shared = new WorkAccount(alone.used * 1.5);
    new Solver(pool, target, "kuva", shared).solve(card);
    expect(() => new Solver(pool, target, "kuva", shared).solve(card)).toThrow(TooComplexError);
  });

  it("keeps the account equal to the work of the graphs it holds", () => {
    const planner = new Planner(() => 0.5);
    const account = (planner as unknown as { account: WorkAccount }).account;
    const other = { ...card, pos: card.pos.map((t) => ({ ...t, w: 0.95 })) };
    for (const r of [ask(ordinary, "kuva"), { ...ask(ordinary, "kuva"), compare: [other, card] }, { ...ask(ordinary, "kuva"), card: other }]) {
      expect(planner.plan(r).ok).toBe(true);
      expect(account.used).toBe(held(planner).reduce((sum, s) => sum + s.workUsed, 0));
    }
  });

  it("tries again with the whole budget when graphs kept from before took the room", () => {
    // same target, so the graph kept from the first card stays (a different target would clear it anyway)
    const target = {
      groups: [
        { tags: ["WeaponWeakpointDamage", "WeaponWeakpointCriticalChance"], minW: 1.03 },
        { tags: ["WeaponFireIterationsMod"], minW: 1.07 },
        { tags: ["WeaponCritDamageMod"], minW: 1 },
      ],
      layouts: [{ pos: 3, neg: 1 }] as PlanRequest["target"]["layouts"],
      allowedNeg: poolFor(weapon).neg,
    };
    const braton = (spliced: number) => ({
      layout: { pos: 3, neg: 1 } as const,
      pos: [
        { tag: "WeaponFireIterationsMod", w: 0.95 },
        { tag: "WeaponCritDamageMod", w: 0.95 },
      ],
      neg: { tag: "WeaponZoomFovMod", w: 1 },
      spliced: { tag: "WeaponWeakpointDamage", w: spliced },
    });
    const ask = (card: PlanRequest["card"]): PlanRequest => ({ ...request, card, target, objective: "cycles", cyclesDone: 160, runs: 8 });
    const measure = (r: PlanRequest) => {
      const p = new Planner(() => 0.5);
      p.plan(r);
      return held(p).reduce((sum, s) => sum + s.workUsed, 0);
    };
    const small = ask(braton(1.08));
    const big = ask(braton(0.95));
    const [a, b] = [measure(small), measure(big)];
    expect(a).toBeLessThan(b / 2);
    // the small graph stays kept (under half the budget); with it the big one does not fit, alone it does
    const planner = new Planner(() => 0.5, b + a / 2);
    expect(planner.plan(small).ok).toBe(true);
    expect(held(planner)).toHaveLength(1);
    expect(planner.plan(big).ok).toBe(true);
  });

  it("keeps only the value of the other riven in a comparison, so the current one has the room", () => {
    // Braton, two rivens that differ only in their spliced weak point damage
    const target = {
      groups: [
        { tags: ["WeaponWeakpointDamage", "WeaponWeakpointCriticalChance"], minW: 1.03 },
        { tags: ["WeaponFireIterationsMod"], minW: 1.07 },
        { tags: ["WeaponCritDamageMod"], minW: 1 },
      ],
      layouts: [{ pos: 3, neg: 1 }] as PlanRequest["target"]["layouts"],
      allowedNeg: poolFor(weapon).neg,
    };
    const braton = (spliced: number) => ({
      layout: { pos: 3, neg: 1 } as const,
      pos: [
        { tag: "WeaponFireIterationsMod", w: 0.95 },
        { tag: "WeaponCritDamageMod", w: 0.95 },
      ],
      neg: { tag: "WeaponZoomFovMod", w: 1 },
      spliced: { tag: "WeaponWeakpointDamage", w: spliced },
    });
    const [A, B] = [braton(1.08), braton(0.95)];
    const base = { ...request, target, objective: "cycles" as const, cyclesDone: 160, runs: 8 };
    // what one riven needs on its own: its value only, or its whole plan
    const valueWork = (card: PlanRequest["card"]) => {
      const account = new WorkAccount(Number.POSITIVE_INFINITY);
      new Solver(poolFor(weapon, { pos: ["WeaponFireIterationsMod", "WeaponCritDamageMod", "WeaponWeakpointDamage"], neg: ["WeaponZoomFovMod"] }), target, "cycles", account).solve(
        card,
      );
      return account.used;
    };
    const planWork = (card: PlanRequest["card"]) => {
      const p = new Planner(() => 0.5);
      p.plan({ ...base, card });
      return held(p).reduce((sum, x) => sum + x.workUsed, 0);
    };
    for (const [current, other] of [
      [A, B],
      [B, A],
    ]) {
      // room for the current riven's whole plan or the other one's value, one after the other; not both at once
      const budget = Math.max(planWork(current), valueWork(other)) + 1000;
      for (const order of [
        [current, other],
        [other, current],
      ]) {
        const ask: PlanRequest = { ...base, card: current, compare: order };
        const full = new Planner(() => 0.5).plan(ask);
        if (!full.ok) throw new Error("the comparison should plan with the whole budget");
        const what = `current ${current === A ? "A" : "B"}, compare ${order.map((c) => (c === A ? "A" : "B")).join("")}`;
        const cold = new Planner(() => 0.5, budget);
        for (const attempt of [1, 2]) {
          const r = cold.plan({ ...ask, id: attempt });
          // the values stay in the order asked, left and right
          expect(r.ok && r.compareValues, `${what}, attempt ${attempt}`).toEqual(full.compareValues);
          expect(r.ok && r.routes.map((x) => x.route.expected), what).toEqual(full.routes.map((x) => x.route.expected));
        }
        // warm: the current riven planned alone first
        const warm = new Planner(() => 0.5, budget);
        expect(warm.plan({ ...ask, compare: undefined }).ok, what).toBe(true);
        const r = warm.plan(ask);
        expect(r.ok && r.compareValues, `${what}, warm`).toEqual(full.compareValues);
      }
    }
  });
});

describe("introductory Kuva prices", () => {
  // A wide target: four alternative sets of three rows, a count rule and one accepted negative.
  const vulklok: PlanRequest = {
    id: 1,
    weaponId: "/Lotus/Types/Sentinels/SentinelWeapons/SentElecRailgun",
    card: {
      layout: { pos: 2, neg: 0 },
      pos: [
        { tag: "WeaponCritDamageMod", w: 1.0921990275382996 },
        { tag: "WeaponStunChanceMod", w: 1.0531238317489628 },
      ],
      neg: null,
      spliced: null,
    },
    target: {
      groups: [
        { tags: ["WeaponProjectileSpeedMod", "WeaponFireDamageMod"], minW: 1.07 },
        { tags: ["WeaponReloadSpeedMod", "WeaponFactionDamageGrineer"], minW: 1.07 },
        { tags: ["WeaponCritDamageMod", "WeaponFireRateMod"], minW: 1.07 },
        { tags: ["WeaponReloadSpeedMod", "WeaponFactionDamageGrineer"], minW: 1.07 },
        { tags: ["WeaponCritDamageMod", "WeaponFireRateMod"], minW: 1.07 },
        { tags: ["WeaponFactionDamageCorpus", "WeaponClipMaxMod"], minW: 1.07 },
        { tags: ["WeaponCritDamageMod", "WeaponFireRateMod"], minW: 1.07 },
        { tags: ["WeaponFactionDamageCorpus", "WeaponClipMaxMod"], minW: 1.07 },
        { tags: ["WeaponDamageAmountMod", "WeaponFreezeDamageMod"], minW: 1.07 },
        { tags: ["WeaponFactionDamageCorpus", "WeaponClipMaxMod"], minW: 1.07 },
        { tags: ["WeaponDamageAmountMod", "WeaponFreezeDamageMod"], minW: 1.07 },
        { tags: ["WeaponCritChanceMod", "WeaponElectricityDamageMod"], minW: 1.07 },
      ],
      sets: [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [9, 10, 11],
      ],
      layouts: [{ pos: 3, neg: 1 }],
      allowedNeg: ["WeaponFireIterationsMod"],
      atLeast: { k: 3, w: 1.09 },
    },
    objective: "cycles",
    cyclesDone: 0,
    budget: null,
    runs: 300,
  };

  it("plans a wide target from a fresh riven, discounted Kuva included", () => {
    const res = new Planner(() => 0.5).plan(vulklok);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.routes.length).toBeGreaterThan(0);
    for (const r of res.routes) expect(Number.isFinite(r.kuva.mean) && r.kuva.mean > 0).toBe(true);
  });

  it.each(["kuva", "cycles"] as const)("works out every route together exactly as one route at a time (%s)", (objective) => {
    // the route-by-route recursion it replaces: price at this step, then the riven kept at the next
    type Inner = {
      states: { id: number }[];
      actions: { kind: string; locked: boolean; dist: { to: Map<number, number> } }[][];
      best: Int32Array;
      value: Float64Array;
      isGoal(s: unknown): boolean;
      stateOf(c: unknown): { id: number };
      sameAction(a: unknown, r: unknown, c: unknown): boolean;
      keepSet(a: unknown, v0: number): { q: number; keep: { to: number; p: number }[] };
      policyKuva(): Float64Array;
      fullPriceAction(id: number, a: unknown, values: Float64Array): number;
    };
    const prices = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150];
    const oneRoute = (s: Inner, card: unknown, route: unknown, done0: number) => {
      const start = s.stateOf(card);
      const terminal = s.policyKuva();
      const memo = new Map<string, number>();
      const evaluate = (id: number, done: number, ai: number): number => {
        if (s.isGoal(s.states[id])) return 0;
        const a = s.actions[id][ai];
        if (done >= prices.length) return ai === s.best[id] ? terminal[id] : s.fullPriceAction(id, a, terminal);
        const key = `${id}|${done}|${ai}`;
        const known = memo.get(key);
        if (known != null) return known;
        let result = 0;
        if (a.kind === "splice") for (const [to, p] of a.dist.to) result += p * evaluate(to, done, s.best[to]);
        else {
          const { q, keep } = s.keepSet(a, s.value[id]);
          result = prices[done] * (a.locked ? 2 : 1) + (q < 1 ? (1 - q) * evaluate(id, done + 1, ai) : 0);
          for (const { to, p } of keep) result += p * evaluate(to, done + 1, s.best[to]);
        }
        memo.set(key, result);
        return result;
      };
      return evaluate(
        start.id,
        done0,
        s.actions[start.id].findIndex((a) => s.sameAction(a, route, card)),
      );
    };
    const epitaph = GAME.weapons.find((w) => w.id === "/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon");
    if (!epitaph) throw new Error("no Epitaph Prime");
    const solver = new Solver(
      poolFor(epitaph),
      {
        groups: [
          { tags: ["WeaponFireIterationsMod"], minW: 1.07 },
          { tags: ["WeaponDamageAmountMod", "WeaponCritDamageMod"], minW: 1.07 },
          { tags: ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"], minW: 1.07 },
        ],
        layouts: [{ pos: 3, neg: 1 }],
        allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod", "WeaponClipMaxMod"],
      },
      objective,
    );
    const card = {
      layout: { pos: 3, neg: 1 } as const,
      pos: [
        { tag: "WeaponToxinDamageMod", w: 1.09 },
        { tag: "WeaponFreezeDamageMod", w: 1.02 },
        { tag: "WeaponFireIterationsMod", w: 1.08 },
      ],
      neg: { tag: "WeaponZoomFovMod", w: 1 },
      spliced: null,
    };
    solver.solve(card);
    const routes = solver.routes(card);
    expect(routes.some((r) => r.action.kind === "splice")).toBe(true);
    for (const done of [0, 3, 8, 9]) {
      const together = solver.expectedKuvas(card, routes, done);
      routes.forEach((route, i) => {
        const alone = oneRoute(solver as unknown as Inner, card, route, done);
        expect(Math.abs(together[i] - alone) / alone, `${route.action.kind} at ${done}`).toBeLessThan(1e-12);
      });
    }
  });
});
