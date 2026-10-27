import { describe, expect, it } from "vitest";
import { GAME, weaponById } from "./data";
import { LAYOUTS } from "./formula";
import { poolFor } from "./pool";
import { type Card, Solver, type Target } from "./solver";

const epitaphPrime = weaponById("/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon");
if (!epitaphPrime) throw new Error("missing weapon");
const pool = poolFor(epitaphPrime);

describe("pool", () => {
  it("applies the physical damage and projectile rules", () => {
    // Epitaph Prime rolls all three physical stats; it is a projectile weapon
    for (const tag of ["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod", "WeaponProjectileSpeedMod"]) expect(pool.pos).toContain(tag);
    expect(pool.pos).toHaveLength(24);
    expect(pool.neg).not.toContain("WeaponToxinDamageMod");
  });

  it("allows a stat the game was seen rolling", () => {
    // Lex does not roll impact
    const lex = weaponById("/Lotus/Weapons/Tenno/Pistol/HeavyPistol");
    if (!lex) throw new Error("missing Lex");
    expect(poolFor(lex).pos).not.toContain("WeaponImpactDamageMod");
    expect(poolFor(lex, { pos: ["WeaponImpactDamageMod"] }).pos).toContain("WeaponImpactDamageMod");
  });
});

describe("solver", () => {
  it("matches the closed form for a single wanted stat", () => {
    // Want multishot, any value, any layout and negative. From a card without it, an unlocked cycle shows
    // multishot with chance 1/2·2/24 + 1/2·3/24 = 5/48; locking the negative (3+1) gives 3/23 at double cost.
    // No two of its traits splice, so no spliced trait can hold the layout for free.
    const target: Target = { groups: [{ tags: ["WeaponFireIterationsMod"], minW: 0.9 }], layouts: LAYOUTS, allowedNeg: pool.neg };
    const card: Card = {
      layout: { pos: 3, neg: 1 },
      pos: [
        { tag: "WeaponCritChanceMod", w: 1 },
        { tag: "WeaponFireRateMod", w: 1 },
        { tag: "WeaponProjectileSpeedMod", w: 1 },
      ],
      neg: { tag: "WeaponClipMaxMod", w: 1 },
      spliced: null,
    };
    const solver = new Solver(pool, target, "kuva");
    const s0 = solver.solve(card);
    expect(solver.value[s0.id]).toBeCloseTo(3500 / (5 / 48), 0);
    const routes = solver.routes(card);
    const lockNeg = routes.find((r) => r.action.kind === "cycle" && r.action.lock === "neg");
    expect(lockNeg?.stepChance).toBeCloseTo(3 / 23, 6);
    expect(lockNeg?.expected).toBeCloseTo(7000 / (3 / 23), 0);
    expect(routes[0].optimal).toBe(true);
  });

  it("is zero on a finished card", () => {
    const target: Target = { groups: [{ tags: ["WeaponFireIterationsMod"], minW: 1.05 }], layouts: [{ pos: 3, neg: 1 }], allowedNeg: ["WeaponClipMaxMod"] };
    const card: Card = {
      layout: { pos: 3, neg: 1 },
      pos: [
        { tag: "WeaponFireIterationsMod", w: 1.073 },
        { tag: "WeaponToxinDamageMod", w: 1 },
        { tag: "WeaponFactionDamageGrineer", w: 1 },
      ],
      neg: { tag: "WeaponClipMaxMod", w: 1.047 },
      spliced: null,
    };
    const solver = new Solver(pool, target);
    const s0 = solver.solve(card);
    expect(solver.value[s0.id]).toBe(0);
  });

  it("solves the video-1 card and beats the hand-written policy", () => {
    const target: Target = {
      groups: [
        { tags: ["WeaponFireIterationsMod"], minW: 1.07 },
        { tags: ["WeaponDamageAmountMod"], minW: 1.0 },
        { tags: ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"], minW: 0.9 },
      ],
      layouts: [{ pos: 3, neg: 1 }],
      allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponClipMaxMod", "WeaponRecoilReductionMod"],
    };
    const card: Card = {
      layout: { pos: 3, neg: 1 },
      pos: [
        { tag: "WeaponFireIterationsMod", w: 1.073 },
        { tag: "WeaponFactionDamageGrineer", w: 0.968 },
        { tag: "WeaponToxinDamageMod", w: 1.013 },
      ],
      neg: { tag: "WeaponClipMaxMod", w: 1.047 },
      spliced: null,
    };
    const solver = new Solver(pool, target, "kuva");
    const t0 = performance.now();
    const s0 = solver.solve(card);
    const ms = performance.now() - t0;
    const routes = solver.routes(card);
    const v = solver.value[s0.id];
    console.log(`states ${solver.stateCount}, solve ${ms.toFixed(0)} ms, V = ${(v / 1e4).toFixed(1)}万`);
    for (const r of routes) console.log(JSON.stringify(r.action), `${(r.stepChance * 100).toFixed(2)}%`, `${(r.expected / 1e4).toFixed(1)}万`, r.optimal ? "★" : "");
    expect(v).toBeLessThan(1.5e6);
    expect(v).toBeGreaterThan(1.3e6);
    const sim = solver.simulate(card, routes[0], 160, 2000);
    const mean = sim.kuva.reduce((a, b) => a + b, 0) / sim.kuva.length;
    console.log(`simulated mean ${(mean / 1e4).toFixed(1)}万`);
    expect(Math.abs(mean - v) / v).toBeLessThan(0.08);
  });
});

it("data has every class", () => {
  expect(Object.keys(GAME.classes)).toHaveLength(7);
});

describe("at-least-k rule", () => {
  const card: Card = {
    layout: { pos: 3, neg: 1 },
    pos: [
      { tag: "WeaponFireIterationsMod", w: 1.073 },
      { tag: "WeaponFactionDamageGrineer", w: 0.968 },
      { tag: "WeaponToxinDamageMod", w: 1.013 },
    ],
    neg: { tag: "WeaponClipMaxMod", w: 1.047 },
    spliced: null,
  };
  const base = {
    layouts: [{ pos: 3 as const, neg: 1 as const }],
    allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod", "WeaponClipMaxMod", "WeaponRecoilReductionMod"],
  };
  const valueFor = (t: Target) => {
    const solver = new Solver(pool, t, "kuva");
    const s0 = solver.solve(card);
    return solver.value[s0.id];
  };
  const ms = "WeaponFireIterationsMod";
  const dmg = "WeaponDamageAmountMod";
  const spliced = ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"];

  it("one group, at least 1 of 1 at 1.08, equals that group at 1.08", () => {
    const a = valueFor({ ...base, groups: [{ tags: [ms], minW: 0.9 }], atLeast: { k: 1, w: 1.08 } });
    const b = valueFor({ ...base, groups: [{ tags: [ms], minW: 1.08 }] });
    expect(a).toBeCloseTo(b, 6);
  });

  it("all of them at a bar equals every group at that bar", () => {
    const groups = [
      { tags: [ms], minW: 0.9 },
      { tags: [dmg], minW: 0.9 },
      { tags: spliced, minW: 0.9 },
    ];
    const a = valueFor({ ...base, groups, atLeast: { k: 3, w: 1.05 } });
    const b = valueFor({ ...base, groups: groups.map((g) => ({ ...g, minW: 1.05 })) });
    // not bit-identical: with the rule on, a below-bar multishot keeps its identity and is excluded from the
    // splice refill draw; as plain junk it cannot be (see spliceDist), a 0.002% difference
    expect(Math.abs(a - b) / b).toBeLessThan(1e-4);
  });

  it("any 2 of 3 sits between no rule and all 3", () => {
    const groups = [
      { tags: [ms], minW: 0.9 },
      { tags: [dmg], minW: 0.9 },
      { tags: spliced, minW: 0.9 },
    ];
    const none = valueFor({ ...base, groups });
    const two = valueFor({ ...base, groups, atLeast: { k: 2, w: 1.08 } });
    const all = valueFor({ ...base, groups: groups.map((g) => ({ ...g, minW: 1.08 })) });
    console.log(`no rule ${(none / 1e4).toFixed(1)}万, any 2 ≥ 1.08 ${(two / 1e4).toFixed(1)}万, all 3 ≥ 1.08 ${(all / 1e4).toFixed(1)}万`);
    expect(two).toBeGreaterThan(none);
    expect(two).toBeLessThan(all);
  });
});

describe("shown-value targets", () => {
  const card: Card = {
    layout: { pos: 3, neg: 1 },
    pos: [
      { tag: "WeaponCritChanceMod", w: 1 },
      { tag: "WeaponFireRateMod", w: 1 },
      { tag: "WeaponZoomFovMod", w: 1 },
    ],
    neg: { tag: "WeaponClipMaxMod", w: 1 },
    spliced: null,
  };
  const ms = "WeaponFireIterationsMod";
  const valueFor = (t: Target) => {
    const solver = new Solver(pool, t, "kuva");
    const s0 = solver.solve(card);
    return solver.value[s0.id];
  };
  const both = [
    { pos: 2 as const, neg: 1 as const },
    { pos: 3 as const, neg: 1 as const },
  ];

  it("a per-layout bar on one layout equals the plain roll bar", () => {
    const a = valueFor({ layouts: [both[1]], allowedNeg: pool.neg, groups: [{ tags: [ms], minW: 0.9, minWBy: { [ms]: { "31": 1.04 } } }] });
    const b = valueFor({ layouts: [both[1]], allowedNeg: pool.neg, groups: [{ tags: [ms], minW: 1.04 }] });
    expect(a).toBeCloseTo(b, 6);
  });

  it("multishot ≥ 140% is easier when 2+1 also counts", () => {
    // pistol multishot 140%: roll 1.04 at 3+1 (max 148.1%), but any roll at 2+1 (min 160.0%)
    const byValue = valueFor({ layouts: both, allowedNeg: pool.neg, groups: [{ tags: [ms], minW: 0.9, minWBy: { [ms]: { "21": 0.9, "31": 1.04 } } }] });
    const byRoll = valueFor({ layouts: both, allowedNeg: pool.neg, groups: [{ tags: [ms], minW: 1.04 }] });
    expect(byValue).toBeLessThan(byRoll);
  });
});

describe("alternative targets", () => {
  const card: Card = {
    layout: { pos: 3, neg: 1 },
    pos: [
      { tag: "WeaponFireIterationsMod", w: 1.073 },
      { tag: "WeaponFactionDamageGrineer", w: 0.968 },
      { tag: "WeaponToxinDamageMod", w: 1.013 },
    ],
    neg: { tag: "WeaponClipMaxMod", w: 1.047 },
    spliced: null,
  };
  const base = { layouts: [{ pos: 3 as const, neg: 1 as const }], allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod", "WeaponClipMaxMod", "WeaponRecoilReductionMod"] };
  const ms = { tags: ["WeaponFireIterationsMod"], minW: 1.07 };
  // damage + multishot + viral or corrosive, or multishot + critical damage + status damage
  const a = [ms, { tags: ["WeaponDamageAmountMod"], minW: 0.9 }, { tags: ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"], minW: 0.9 }];
  // ammo efficiency and status damage are spliced stats
  const b = [ms, { tags: ["WeaponCritDamageMod"], minW: 0.9 }, { tags: ["WeaponAmmoEfficiency", "WeaponStatusDamage"], minW: 0.9 }];
  const valueFor = (t: Target, c = card) => {
    const solver = new Solver(pool, t, "kuva");
    const s0 = solver.solve(c);
    return solver.value[s0.id];
  };

  it("either of two targets is cheaper than each one alone", () => {
    const va = valueFor({ ...base, groups: a });
    const vb = valueFor({ ...base, groups: b });
    const either = valueFor({
      ...base,
      groups: [...a, ...b],
      sets: [
        [0, 1, 2],
        [3, 4, 5],
      ],
    });
    console.log(`A ${(va / 1e4).toFixed(1)}万, B ${(vb / 1e4).toFixed(1)}万, A or B ${(either / 1e4).toFixed(1)}万`);
    expect(either).toBeLessThan(Math.min(va, vb));
  });

  it("does not count equally useful cards as progress for alternative targets", () => {
    const solver = new Solver(pool, {
      ...base,
      groups: [...a, ...b],
      sets: [
        [0, 1, 2],
        [3, 4, 5],
      ],
    });
    const start = solver.solve(card);
    const routes = solver.routes(card);
    const lockedMultishot = routes.find((r) => r.action.kind === "cycle" && typeof r.action.lock === "object" && r.action.lock.tag === "WeaponFireIterationsMod");
    if (!lockedMultishot) throw new Error("missing multishot route");
    // An earlier rounding regression accepted equivalent cards and inflated this chance above 60%.
    expect(lockedMultishot.stepChance).toBeGreaterThan(0.02);
    expect(lockedMultishot.stepChance).toBeLessThan(0.1);
    for (const route of routes) expect(route.expected).toBeGreaterThanOrEqual(solver.value[start.id] * (1 - 1e-9));
    expect(routes.find((r) => r.optimal)?.expected).toBeCloseTo(solver.value[start.id], 5);
  });

  it("the same target twice equals it once", () => {
    const once = valueFor({ ...base, groups: a });
    const twice = valueFor({
      ...base,
      groups: [...a, ...a],
      sets: [
        [0, 1, 2],
        [3, 4, 5],
      ],
    });
    expect(twice).toBeCloseTo(once, 4);
  });

  it("a target that contains another adds nothing", () => {
    const small = valueFor({ ...base, groups: [ms] });
    const withBigger = valueFor({ ...base, groups: [ms, ...a], sets: [[0], [1, 2, 3]] });
    expect(withBigger).toBeCloseTo(small, 4);
  });

  it("a card that meets only the second target is done", () => {
    const done: Card = {
      ...card,
      pos: [
        { tag: "WeaponFireIterationsMod", w: 1.08 },
        { tag: "WeaponCritDamageMod", w: 1 },
      ],
      spliced: { tag: "WeaponStatusDamage", w: 1 },
    };
    expect(
      valueFor(
        {
          ...base,
          groups: [...a, ...b],
          sets: [
            [0, 1, 2],
            [3, 4, 5],
          ],
        },
        done,
      ),
    ).toBe(0);
  });
});

describe("equal routes", () => {
  it("recommends locking the higher roll when two locks cost the same", () => {
    // Verglas Prime: fire 1.053 and multishot 1.067 both meet a bar-free target, the status damage splice stays
    // locked, only the Grineer negative is unwanted. Either lock costs exactly the same: keep the better roll.
    const verglas = weaponById("/Lotus/Types/Sentinels/SentinelWeapons/SentinelFreezeRayPrimeRifle");
    if (!verglas) throw new Error("missing weapon");
    const p = poolFor(verglas);
    const target: Target = {
      groups: ["WeaponFireDamageMod", "WeaponStatusDamage", "WeaponFireIterationsMod"].map((t) => ({ tags: [t], minW: 0.9 })),
      layouts: LAYOUTS,
      allowedNeg: p.neg.filter((t) => t !== "WeaponFactionDamageGrineer"),
    };
    const card: Card = {
      layout: { pos: 3, neg: 1 },
      pos: [
        { tag: "WeaponFireDamageMod", w: 1.053 },
        { tag: "WeaponFireIterationsMod", w: 1.067 },
      ],
      spliced: { tag: "WeaponStatusDamage", w: 1.097 },
      neg: { tag: "WeaponFactionDamageGrineer", w: 0.988 },
    };
    for (const objective of ["kuva", "cycles"] as const) {
      const solver = new Solver(p, target, objective);
      solver.solve(card);
      const [first, second] = solver.routes(card);
      expect(first.expected).toBeCloseTo(second.expected, 9);
      expect([first.action, first.optimal, second.optimal]).toEqual([
        { kind: "cycle", lock: { tag: "WeaponFireIterationsMod", stats: ["WeaponFireIterationsMod"], w: 1.067 } },
        true,
        false,
      ]);
    }
  });
});
