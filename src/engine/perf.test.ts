import { expect, it } from "vitest";
import { weaponById } from "./data";
import { LAYOUTS } from "./formula";
import { poolFor } from "./pool";
import { Solver } from "./solver";

it("worst-case size", () => {
  const w = weaponById("/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon");
  if (!w) throw new Error();
  const pool = poolFor(w);
  for (const [name, target] of [
    [
      "3 high + spliced",
      {
        groups: [
          { tags: ["WeaponFireIterationsMod"], minW: 1.07 },
          { tags: ["WeaponDamageAmountMod", "WeaponCritDamageMod"], minW: 1.07 },
          { tags: ["WeaponViralDamageMod", "WeaponCorrosiveDamageMod"], minW: 1.07 },
        ],
        layouts: [{ pos: 3, neg: 1 }],
        allowedNeg: ["WeaponZoomFovMod", "WeaponImpactDamageMod", "WeaponClipMaxMod"],
      },
    ],
    [
      "any layout, 2 groups",
      {
        groups: [
          { tags: ["WeaponCritChanceMod"], minW: 1.0 },
          { tags: ["WeaponCritDamageMod"], minW: 1.0 },
        ],
        layouts: LAYOUTS,
        allowedNeg: pool.neg,
      },
    ],
  ] as const) {
    for (const objective of ["kuva", "cycles"] as const) {
      const solver = new Solver(pool, target as never, objective);
      const card = {
        layout: { pos: 2, neg: 0 } as const,
        pos: [
          { tag: "WeaponZoomFovMod", w: 1 },
          { tag: "WeaponReloadSpeedMod", w: 1 },
        ],
        neg: null,
        spliced: null,
      };
      const t0 = performance.now();
      const s0 = solver.solve(card);
      const routes = solver.routes(card);
      for (const route of routes) expect(Number.isFinite(solver.expectedKuva(card, route, 0))).toBe(true);
      const t1 = performance.now();
      const sims = routes.map((r) => solver.simulate(card, r, 0, 3000));
      const t2 = performance.now();
      console.log(
        `${name} [${objective}] states ${solver.stateCount} solve+routes ${(t1 - t0).toFixed(0)}ms sim ${(t2 - t1).toFixed(0)}ms V=${solver.value[s0.id].toFixed(0)} routes ${routes.length}`,
        sims.map((s) => `${(s.kuva.reduce((a, b) => a + b, 0) / s.kuva.length / 1e4).toFixed(1)}万`).join(" "),
      );
    }
  }
});
