import { describe, expect, it } from "vitest";
import { cyclesAfterCompare, defaultTarget, type GroupDraft, toEngineCard, toEngineTarget } from "../state";
import { displayBar, type KeepPart, keepWhen } from "../ui/routeText";
import { GAME, statOf } from "./data";
import { displayNumber, qualityFromDisplay, rawValue } from "./formula";
import { poolFor } from "./pool";
import { type Card, type CardTrait, Solver, type Target } from "./solver";

const braton = GAME.weapons.find((w) => w.name.en === "Braton");
if (!braton) throw new Error("missing Braton");
const pool = poolFor(braton);
const L30 = { pos: 3 as const, neg: 0 as const };
const L31 = { pos: 3 as const, neg: 1 as const };
const solve = (t: Target, c: Card, objective: "kuva" | "cycles" = "cycles") => {
  const s = new Solver(pool, t, objective);
  const id = s.solve(c).id;
  return { s, v: s.value[id], routes: s.routes(c) };
};

describe("locks that only hold the layout", () => {
  // fire, cold, toxin at 3+0; only multishot at 3+0 is wanted
  const card: Card = {
    layout: L30,
    pos: ["WeaponFireDamageMod", "WeaponFreezeDamageMod", "WeaponToxinDamageMod"].map((tag) => ({ tag, w: 1 })),
    neg: null,
    spliced: null,
  };
  const target: Target = { groups: [{ tags: ["WeaponFireIterationsMod"], minW: 0.9 }], layouts: [L30], allowedNeg: [] };

  it("locking a trait the target does not want keeps 3+0: two of the other 22 stats, 1 in 11", () => {
    expect(pool.pos).toHaveLength(23);
    const lock = (routes: ReturnType<typeof solve>["routes"]) => routes.find((r) => r.action.kind === "cycle" && typeof r.action.lock === "object");
    expect(lock(solve(target, card, "cycles").routes)?.expected).toBeCloseTo(11, 9);
    // at the steady price the same lock costs 11 doubled cycles
    expect(lock(solve(target, card, "kuva").routes)?.expected).toBeCloseTo(11 * 7000, 6);
  });

  it("never spends a splicer on a stat the target does not want, even to hold the layout", () => {
    // splicing two elements would hold 3+0 with a free lock, but it uses up a splicer: the paid lock is the plan
    for (const objective of ["kuva", "cycles"] as const) {
      const { v, routes } = solve(target, card, objective);
      expect(routes.some((r) => r.action.kind === "splice")).toBe(false);
      expect(v).toBeCloseTo(objective === "kuva" ? 11 * 7000 : 11, 6);
    }
  });

  it("uses at most one splicer, and never unlocks a spliced trait that still counts", () => {
    // viral (toxin + cold) at 1.05 or more, plus multishot; the ingredients on the card roll too low for now
    const target: Target = {
      groups: [
        { tags: ["WeaponViralDamageMod"], minW: 1.05 },
        { tags: ["WeaponFireIterationsMod"], minW: 0.9 },
      ],
      layouts: [L31],
      allowedNeg: pool.neg,
    };
    const card: Card = {
      layout: L31,
      pos: [
        { tag: "WeaponToxinDamageMod", w: 0.95 },
        { tag: "WeaponFreezeDamageMod", w: 0.93 },
        { tag: "WeaponDamageAmountMod", w: 1 },
      ],
      neg: { tag: "WeaponZoomFovMod", w: 1 },
      spliced: null,
    };
    let seed = 7;
    const rng = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (const objective of ["kuva", "cycles"] as const) {
      const { s, routes } = solve(target, card, objective);
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) expect(Math.max(...s.simulate(card, r, 9, 300, rng).splicers), JSON.stringify(r.action)).toBeLessThanOrEqual(1);
      // and over the whole plan, not just sampled runs: every splice leads to states marked as spliced by the plan,
      // and no such state offers an unlock or another splice
      const graph = s as unknown as { states: { spl: string }[]; actions: { kind: string; drop: boolean; dist: { to: Map<number, number> } }[][] };
      let marked = 0;
      graph.states.forEach((st, id) => {
        for (const act of graph.actions[id] ?? []) if (act.kind === "splice") for (const to of act.dist.to.keys()) expect(graph.states[to].spl.startsWith("!")).toBe(true);
        if (!st.spl.startsWith("!")) return;
        marked++;
        expect((graph.actions[id] ?? []).some((act) => act.kind === "splice" || act.drop)).toBe(false);
      });
      expect(marked).toBeGreaterThan(0);
    }
    // once a wanted viral that meets its bar is on the card, its lock stays and no second splice is offered
    const spliced: Card = { ...card, pos: card.pos.slice(1), spliced: { tag: "WeaponViralDamageMod", w: 1.08 } };
    const { routes } = solve(target, spliced, "kuva");
    expect(routes.some((r) => r.action.kind === "splice" || (r.action.kind === "cycle" && r.action.drop))).toBe(false);
  });

  it("does not splice a wanted stat whose roll can never meet its bar (it would only hold the layout)", () => {
    // toxin, cold and fire at 0.95: viral from them stays 0.95, under the 1.05 viral bar, so only multishot can finish
    const card: Card = { layout: L30, pos: ["WeaponToxinDamageMod", "WeaponFreezeDamageMod", "WeaponFireDamageMod"].map((tag) => ({ tag, w: 0.95 })), neg: null, spliced: null };
    const either: Target = {
      groups: [
        { tags: ["WeaponFireIterationsMod"], minW: 0.9 },
        { tags: ["WeaponViralDamageMod"], minW: 1.05 },
      ],
      sets: [[0], [1]],
      layouts: [L30],
      allowedNeg: [],
    };
    const oneRow: Target = { groups: [{ tags: ["WeaponFireIterationsMod", "WeaponViralDamageMod"], minW: 1.05 }], layouts: [L30], allowedNeg: [] };
    for (const target of [either, oneRow])
      for (const objective of ["kuva", "cycles"] as const) expect(solve(target, card, objective).routes.some((r) => r.action.kind === "splice")).toBe(false);
  });

  it("counts the at-least rule when deciding whether a spliced trait still counts", () => {
    // viral 1.00 is spliced; "viral and multishot at 1.05" and "both, with 2 of them at 1.05" are the same target
    const card: Card = {
      layout: L31,
      pos: [
        { tag: "WeaponFireIterationsMod", w: 1.08 },
        { tag: "WeaponCritDamageMod", w: 1 },
      ],
      neg: { tag: "WeaponZoomFovMod", w: 1 },
      spliced: { tag: "WeaponViralDamageMod", w: 1 },
    };
    const groups = (minW: number) => ["WeaponViralDamageMod", "WeaponFireIterationsMod"].map((t) => ({ tags: [t], minW }));
    const bars: Target = { groups: groups(1.05), layouts: [L31], allowedNeg: pool.neg };
    const count: Target = { groups: groups(0.9), layouts: [L31], allowedNeg: pool.neg, atLeast: { k: 2, w: 1.05 } };
    for (const objective of ["kuva", "cycles"] as const) {
      const a = solve(bars, card, objective).v;
      expect(Number.isFinite(a)).toBe(true);
      expect(solve(count, card, objective).v).toBeCloseTo(a, 6);
    }
  });

  it("reads a spliced trait so that rounding does not drop it under the bar it met when spliced", () => {
    // damage +262.2% (roll just over 1.07) spliced with zoom into weak point damage, which shows +357.5% at 2+1;
    // read back from that rounded value its middle roll is just under 1.07, but the target is met
    const L21 = { pos: 2 as const, neg: 1 as const };
    const weak = statOf("Rifle", "WeaponWeakpointDamage");
    expect(qualityFromDisplay(weak, L21, false, 357.5).w).toBeLessThan(1.07);
    const card = toEngineCard("Rifle", {
      pos: [
        { tag: "WeaponWeakpointDamage", shown: 357.5 },
        { tag: "WeaponZoomFovMod", shown: 89.1 },
      ],
      neg: { tag: "WeaponClipMaxMod", shown: -29.7 },
      cycles: 20,
    });
    if (!card) throw new Error("card did not read");
    expect(card.spliced?.w).toBeGreaterThanOrEqual(1.07);
    const target: Target = { groups: [{ tags: ["WeaponWeakpointDamage"], minW: 1.07 }], layouts: [L21], allowedNeg: ["WeaponClipMaxMod"] };
    const s = new Solver(pool, target, "kuva");
    expect(s.isGoal(s.solve(card))).toBe(true);
  });

  it("a spliced trait only counts where the target's other stats can reach their bars", () => {
    // multishot at 105% shown cannot roll at 3+0 (its 3+0 top is 89.1%), only at 3+1
    const viral: GroupDraft = { tags: ["WeaponViralDamageMod"], tier: "any" };
    const multishot: GroupDraft = { tags: ["WeaponFireIterationsMod"], tier: "value", value: 105 };
    const draft = (sets: GroupDraft[][], layouts: string[]) => ({ ...defaultTarget(), sets, layouts, layoutsAuto: false, allowedNeg: pool.neg });
    const engine = (t: ReturnType<typeof draft>) => {
      const target = toEngineTarget(t, "Rifle");
      if (!target) throw new Error("target did not read");
      return target;
    };
    // a spliced viral at 3+0 cannot finish "viral + multishot ≥ 105%": its lock may go, so the 3+1 the target also
    // takes stays reachable
    const card = toEngineCard("Rifle", {
      pos: [
        { tag: "WeaponViralDamageMod", shown: 81 },
        { tag: "WeaponFireDamageMod", shown: 81 },
        { tag: "WeaponCritDamageMod", shown: 108 },
      ],
      neg: null,
      cycles: 20,
    });
    if (!card) throw new Error("card did not read");
    for (const objective of ["kuva", "cycles"] as const) expect(Number.isFinite(solve(engine(draft([[viral, multishot]], ["30", "31"])), card, objective).v), objective).toBe(true);
    // and no splicer is spent on a viral that can only hold 3+0 while the other target (crit damage) is cycled for
    const plain: Card = { layout: L30, pos: ["WeaponToxinDamageMod", "WeaponFreezeDamageMod", "WeaponFireDamageMod"].map((tag) => ({ tag, w: 0.95 })), neg: null, spliced: null };
    const either = engine(draft([[viral, multishot], [{ tags: ["WeaponCritDamageMod"], tier: "any" }]], ["30"]));
    for (const objective of ["kuva", "cycles"] as const)
      expect(
        solve(either, plain, objective).routes.some((r) => r.action.kind === "splice"),
        objective,
      ).toBe(false);
  });

  it("matches a chosen splice route by both ingredients", () => {
    // damage + zoom and damage + multishot both make weak point damage
    const target: Target = { groups: [{ tags: ["WeaponWeakpointDamage"], minW: 0.9 }], layouts: [L30], allowedNeg: [] };
    const card: Card = { layout: L30, pos: ["WeaponDamageAmountMod", "WeaponZoomFovMod", "WeaponFireIterationsMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };
    const { s, routes } = solve(target, card);
    for (const r of routes.filter((x) => x.action.kind === "splice")) expect(() => s.expectedKuva(card, r, 0)).not.toThrow();
    const splices = routes.flatMap((r) => (r.action.kind === "splice" ? [`${r.action.a}+${r.action.b}`] : []));
    expect(splices).toContain("WeaponDamageAmountMod+WeaponZoomFovMod");
    expect(splices).toContain("WeaponDamageAmountMod+WeaponFireIterationsMod");
    const inner = s as unknown as { stateOf(c: Card): { id: number }; actions: { kind: string; recipe: number }[][]; sameAction(a: unknown, r: unknown, c: Card): boolean };
    const acts = inner.actions[inner.stateOf(card).id];
    for (const r of routes.filter((x) => x.action.kind === "splice")) expect(acts.filter((a) => inner.sameAction(a, r, card))).toHaveLength(1);
  });
});

describe("splicing with the negative as either ingredient", () => {
  // weak point damage = damage + zoom
  const target: Target = { groups: [{ tags: ["WeaponWeakpointDamage"], minW: 0.9 }], layouts: [L31], allowedNeg: pool.neg.filter((t) => t !== "WeaponWeakpointDamage") };
  const withNeg = (pos: string, neg: string): Card => ({
    layout: L31,
    pos: [pos, "WeaponFireDamageMod", "WeaponFreezeDamageMod"].map((tag) => ({ tag, w: 1 })),
    neg: { tag: neg, w: 1 },
    spliced: null,
  });
  it.each([
    ["+damage, -zoom", "WeaponDamageAmountMod", "WeaponZoomFovMod"],
    ["+zoom, -damage", "WeaponZoomFovMod", "WeaponDamageAmountMod"],
  ])("%s offers the weak point damage splice", (_, pos, neg) => {
    const { routes } = solve(target, withNeg(pos, neg));
    expect(routes.some((r) => r.action.kind === "splice" && r.action.result === "WeaponWeakpointDamage")).toBe(true);
  });

  // the spliced trait keeps the higher roll, the negative ingredient's included
  const high: Target = { ...target, groups: [{ tags: ["WeaponWeakpointDamage"], minW: 1.05 }] };
  const rolls = (pos: number, neg: number): Card => ({
    layout: L31,
    pos: [
      { tag: "WeaponDamageAmountMod", w: pos },
      { tag: "WeaponFireDamageMod", w: 1 },
      { tag: "WeaponFreezeDamageMod", w: 1 },
    ],
    neg: { tag: "WeaponZoomFovMod", w: neg },
    spliced: null,
  });
  it("counts a high negative roll in the splice", () => {
    // every refill negative is accepted, so splicing finishes the riven
    expect(solve(high, rolls(0.95, 1.08)).v).toBe(0);
    expect(solve(high, rolls(1.08, 0.95)).v).toBe(0);
    expect(solve(high, rolls(0.95, 0.95)).v).toBeGreaterThan(0);
  });

  it("asks for a high negative roll when that is what a cycle has to show", () => {
    const card: Card = { ...rolls(0.95, 1), neg: { tag: "WeaponClipMaxMod", w: 1 } };
    const { routes } = solve(high, card);
    const lockDamage = routes.find((r) => r.action.kind === "cycle" && typeof r.action.lock === "object" && r.action.lock.tag === "WeaponDamageAmountMod");
    if (!lockDamage) throw new Error("missing the damage lock");
    // -zoom rolled high enough splices with the locked damage (other recipes may ask for their own negatives)
    const need = lockDamage.outcomes.flatMap((o) => o.needs).find((n) => n.neg && n.stats.includes("WeaponZoomFovMod"));
    expect(need?.stats).toEqual(["WeaponZoomFovMod"]);
    expect(need?.minW).toBeCloseTo(1.05, 9);
    const k = keepWhen(lockDamage, "Rifle", true);
    // the hint names the negative and its size, as the game shows it without the sign
    const stat = k?.chips.flatMap((c) => c.parts.flatMap((p) => p.stats)).find((x) => x.neg);
    expect(stat?.bar).toMatch(/^ ≥ \d+(\.\d)?%$/);
    const def = statOf("Rifle", "WeaponZoomFovMod");
    const size = Number(displayBar("Rifle", "WeaponZoomFovMod", L31, 1.05, true).replace(/[^\d.]/g, ""));
    expect(qualityFromDisplay(def, L31, true, -size).w).toBeGreaterThanOrEqual(1.05);
    expect(qualityFromDisplay(def, L31, true, -Number((size - def.roundTo).toFixed(6))).w).toBeLessThan(1.05);
  });
});

describe("the splice refill", () => {
  it("can bring back the ingredients it consumed", () => {
    const target: Target = { groups: [{ tags: ["WeaponViralDamageMod"], minW: 0.9 }], layouts: [L30], allowedNeg: [] };
    const card: Card = { layout: L30, pos: ["WeaponToxinDamageMod", "WeaponFreezeDamageMod", "WeaponFireIterationsMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };
    const { s } = solve(target, card);
    const inner = s as unknown as {
      stateOf(c: Card): { id: number };
      actions: { kind: string; dist: { to: Map<number, number> } }[][];
      states: { types: number[] }[];
      roles: { stats: string[] }[];
      typeRole(t: number): number;
    };
    const splice = inner.actions[inner.stateOf(card).id].find((a) => a.kind === "splice");
    if (!splice) throw new Error("missing splice");
    const refills = new Set<string>();
    for (const to of splice.dist.to.keys()) for (const t of inner.states[to].types) for (const tag of inner.roles[inner.typeRole(t)].stats) refills.add(tag);
    expect(refills.has("WeaponToxinDamageMod")).toBe(true);
    expect(refills.has("WeaponFreezeDamageMod")).toBe(true);
  });
});

describe("the keep-new hint", () => {
  // critical chance + critical damage, at 2+1 or 3+1, only -zoom accepted; the card is 3+1 fire/cold/toxin, -damage
  const target: Target = {
    groups: [
      { tags: ["WeaponCritChanceMod"], minW: 0.9 },
      { tags: ["WeaponCritDamageMod"], minW: 0.9 },
    ],
    layouts: [{ pos: 2, neg: 1 }, L31],
    allowedNeg: ["WeaponZoomFovMod"],
  };
  const card: Card = {
    layout: L31,
    pos: ["WeaponFireDamageMod", "WeaponFreezeDamageMod", "WeaponToxinDamageMod"].map((tag) => ({ tag, w: 1 })),
    neg: { tag: "WeaponDamageAmountMod", w: 1 },
    spliced: null,
  };

  it("names the layout whenever results differ in it, and keeps gains that only change the negative", () => {
    const { routes } = solve(target, card);
    let negativeOnly = false;
    for (const r of routes) {
      const unlocked = r.action.kind === "cycle" && r.action.lock === "none";
      const k = keepWhen(r, "Rifle", !unlocked);
      if (!k) continue;
      const layouts = new Set(r.outcomes.map((o) => `${o.layout.pos}${o.layout.neg}`));
      for (const chip of k.chips) {
        if (layouts.size > 1) expect(chip.layout).not.toBeNull();
        if (chip.parts.length === 0) negativeOnly = true;
      }
      if (layouts.size === 1 && unlocked) expect(k.layout).not.toBeNull();
    }
    // three positives unchanged, -damage becomes -zoom: better, and the hint must say so
    expect(negativeOnly).toBe(true);
  });

  it("states the bar as the number the planner reads as reaching it (1.075)", () => {
    const def = statOf("Rifle", "WeaponCritDamageMod");
    const text = displayBar("Rifle", "WeaponCritDamageMod", L31, 1.075);
    const shown = Number(text.replace(/[^\d.]/g, ""));
    expect(qualityFromDisplay(def, L31, false, shown).w).toBeGreaterThanOrEqual(1.075);
    expect(qualityFromDisplay(def, L31, false, Number((shown - def.roundTo).toFixed(6))).w).toBeLessThan(1.075);
    expect(text.startsWith(" ≥ +")).toBe(true);
    // sanity: the bar is at or just above the value shown at exactly 1.075
    expect(shown).toBeGreaterThanOrEqual(displayNumber(def, rawValue(def, L31, false, 1.075)));
  });
});

describe("cycle count after an old/new comparison", () => {
  it("counts one cycle whichever card is kept", () => {
    expect(cyclesAfterCompare(160, [160, 161])).toBe(161);
    expect(cyclesAfterCompare(160, [160, null])).toBe(161);
    expect(cyclesAfterCompare(5, [null, null])).toBe(6);
    expect(cyclesAfterCompare(160, [null, 161])).toBe(161);
  });
});

describe("keep hints from the 2026-10-25 review", () => {
  it("still asks for the other stat of a locked OR row (one locked trait, not every trait of its kind)", () => {
    // 暴率/暴伤 + 射速/暴率/暴伤 + 毒 at 3+0, holding critical chance, fire and toxin
    const target: Target = {
      groups: [
        { tags: ["WeaponCritChanceMod", "WeaponCritDamageMod"], minW: 0.9 },
        { tags: ["WeaponFireRateMod", "WeaponCritChanceMod", "WeaponCritDamageMod"], minW: 0.9 },
        { tags: ["WeaponToxinDamageMod"], minW: 0.9 },
      ],
      layouts: [L30],
      allowedNeg: [],
    };
    const card: Card = { layout: L30, pos: ["WeaponCritChanceMod", "WeaponFireDamageMod", "WeaponToxinDamageMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };
    const { routes } = solve(target, card);
    const lockCrit = routes.find((r) => r.action.kind === "cycle" && typeof r.action.lock === "object" && r.action.lock.tag === "WeaponCritChanceMod");
    if (!lockCrit) throw new Error("missing the critical chance lock");
    const k = keepWhen(lockCrit, "Rifle", true);
    const chips = k?.chips.map((c) => c.parts.map((p) => p.stats.map((x) => x.tag).join("/")).sort()) ?? [];
    // every rule names two stats besides the lock, and none offers the locked critical chance again
    for (const c of chips) {
      expect(c).toHaveLength(2);
      expect(c.join(" ")).not.toContain("WeaponCritChanceMod");
    }
    expect(chips).toContainEqual(["WeaponCritDamageMod", "WeaponToxinDamageMod"]);
  });

  it("names a negative ingredient even when any roll of it will do", () => {
    // weak point damage at any roll, -zoom or -magazine accepted; fire/cold/toxin with -magazine
    const target: Target = { groups: [{ tags: ["WeaponWeakpointDamage"], minW: 0.9 }], layouts: [L31], allowedNeg: ["WeaponZoomFovMod", "WeaponClipMaxMod"] };
    const card: Card = {
      layout: L31,
      pos: ["WeaponFireDamageMod", "WeaponFreezeDamageMod", "WeaponToxinDamageMod"].map((tag) => ({ tag, w: 1 })),
      neg: { tag: "WeaponClipMaxMod", w: 1 },
      spliced: null,
    };
    const { routes } = solve(target, card);
    const unlocked = routes.find((r) => r.action.kind === "cycle" && r.action.lock === "none");
    if (!unlocked) throw new Error("missing the unlocked cycle");
    const k = keepWhen(unlocked, "Rifle", false);
    const negs = k?.chips.flatMap((c) => c.parts.flatMap((p) => p.stats.filter((x) => x.neg).map((x) => x.tag))) ?? [];
    expect(negs).toContain("WeaponDamageAmountMod");
    // no rule is left without a stat to look for
    expect(k?.chips.every((c) => c.parts.length > 0)).toBe(true);
  });
});

describe("keep hints match exactly the better cards (2026-10-25 r3)", () => {
  // 暴率/暴伤/射速 + 毒/暴率/暴伤/射速 at 3+0, holding toxin, fire and cold
  const OR3 = ["WeaponCritChanceMod", "WeaponCritDamageMod", "WeaponFireRateMod"];
  const card: Card = { layout: L30, pos: ["WeaponToxinDamageMod", "WeaponFireDamageMod", "WeaponFreezeDamageMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };
  const traitMeets = (tag: string, w: number, bar: string) => {
    if (!bar) return true;
    const def = statOf("Rifle", tag);
    const shown = displayNumber(def, rawValue(def, L30, false, w));
    const n = Number(bar.replace(/[^\d.-]/g, ""));
    return bar.includes("≤") ? shown <= n : shown >= n;
  };
  // every part asks for `count` different traits, and no trait serves two parts
  const satisfies = (parts: KeepPart[], traits: CardTrait[]) => {
    const slots = parts.flatMap((p) => Array.from({ length: p.count }, () => p));
    const match = (i: number, used: Set<number>): boolean =>
      i === slots.length ||
      traits.some((t, j) => !used.has(j) && slots[i].stats.some((x) => !x.neg && x.tag === t.tag && traitMeets(t.tag, t.w, x.bar)) && match(i + 1, new Set([...used, j])));
    return match(0, new Set());
  };
  const pairs = <T>(xs: T[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as [T, T]));

  it.each([
    ["any roll", 0.9],
    ["a high first row", 1.07],
  ])("with %s", (_, firstBar) => {
    const target: Target = {
      groups: [
        { tags: OR3, minW: firstBar },
        { tags: ["WeaponToxinDamageMod", ...OR3], minW: 0.9 },
      ],
      layouts: [L30],
      allowedNeg: [],
    };
    const { s, v, routes } = solve(target, card);
    const inner = s as unknown as { stateOf(c: Card): { id: number } };
    const rolls = firstBar > 0.9 ? [1, 1.09] : [1];
    let checked = 0;
    for (const r of routes) {
      if (r.action.kind !== "cycle" || typeof r.action.lock !== "object") continue;
      const lock = r.action.lock.tag;
      const k = keepWhen(r, "Rifle", true);
      if (!k) continue;
      const others = pool.pos.filter((t) => t !== lock);
      for (const [a, b] of pairs(others))
        for (const wa of rolls)
          for (const wb of rolls) {
            const traits = [
              { tag: a, w: wa },
              { tag: b, w: wb },
            ];
            const next: Card = { layout: L30, pos: [{ tag: lock, w: 1 }, ...traits], neg: null, spliced: null };
            const value = s.value[inner.stateOf(next).id];
            expect(value).toBeDefined();
            const better = value < v - 1e-7 * Math.max(1, v);
            const hinted = k.chips.some((c) => satisfies(c.parts, traits));
            if (hinted !== better) throw new Error(`${lock} + ${a}@${wa} + ${b}@${wb}: hinted ${hinted}, better ${better} (${value} vs ${v})`);
            checked++;
          }
    }
    // the unlocked cycle, for every 3+0 card it can roll
    const unlocked = routes.find((r) => r.action.kind === "cycle" && r.action.lock === "none" && !r.action.drop);
    const k = unlocked && keepWhen(unlocked, "Rifle", false);
    if (k) {
      const fits = (layout: string | null) => layout == null || layout === "3+0";
      for (const [a, b] of pairs(pool.pos))
        for (const c of pool.pos.filter((t) => t > b && t !== a))
          for (const w of rolls) {
            const traits = [a, b, c].map((tag) => ({ tag, w }));
            const value = s.value[inner.stateOf({ layout: L30, pos: traits, neg: null, spliced: null }).id];
            expect(value).toBeDefined();
            const better = value < v - 1e-7 * Math.max(1, v);
            const hinted = fits(k.layout) && k.chips.some((ch) => fits(ch.layout) && satisfies(ch.parts, traits));
            if (hinted !== better) throw new Error(`unlocked ${a} + ${b} + ${c} @${w}: hinted ${hinted}, better ${better}`);
            checked++;
          }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("says how many of a row it needs", () => {
    const target: Target = {
      groups: [
        { tags: OR3, minW: 0.9 },
        { tags: ["WeaponToxinDamageMod", ...OR3], minW: 0.9 },
      ],
      layouts: [L30],
      allowedNeg: [],
    };
    const { routes } = solve(target, card);
    const lockFire = routes.find((r) => r.action.kind === "cycle" && typeof r.action.lock === "object" && r.action.lock.tag === "WeaponFireDamageMod");
    if (!lockFire) throw new Error("missing the fire lock");
    const parts = keepWhen(lockFire, "Rifle", true)?.chips.flatMap((c) => c.parts) ?? [];
    expect(parts.some((p) => p.count === 2 && p.stats.length === 3)).toBe(true);
  });
});

describe("keep hints never take a worse card (2026-10-25 global review)", () => {
  // weak point damage + critical chance at 3+1, only -magazine accepted; the riven's -damage is locked
  const target: Target = {
    groups: [
      { tags: ["WeaponWeakpointDamage"], minW: 0.9 },
      { tags: ["WeaponCritChanceMod"], minW: 0.9 },
    ],
    layouts: [L31],
    allowedNeg: ["WeaponClipMaxMod"],
  };
  const satisfies = (parts: KeepPart[], traits: CardTrait[]) => {
    const slots = parts.flatMap((p) => Array.from({ length: p.count }, () => p));
    const match = (i: number, used: Set<number>): boolean =>
      i === slots.length || traits.some((t, j) => !used.has(j) && slots[i].stats.some((x) => !x.neg && x.tag === t.tag) && match(i + 1, new Set([...used, j])));
    return match(0, new Set());
  };
  it.each([
    [["WeaponFireDamageMod", "WeaponFreezeDamageMod", "WeaponToxinDamageMod"]],
    [["WeaponZoomFovMod", "WeaponFireDamageMod", "WeaponFreezeDamageMod"]],
    [["WeaponFireIterationsMod", "WeaponZoomFovMod", "WeaponToxinDamageMod"]],
  ])("holding %j", (pos) => {
    const card: Card = { layout: L31, pos: pos.map((tag) => ({ tag, w: 1 })), neg: { tag: "WeaponDamageAmountMod", w: 1 }, spliced: null };
    const { s, v, routes } = solve(target, card);
    const lockNeg = routes.find((r) => r.action.kind === "cycle" && r.action.lock === "neg");
    if (!lockNeg) throw new Error("missing the negative lock");
    const k = keepWhen(lockNeg, "Rifle", true);
    if (!k) return;
    const inner = s as unknown as { stateOf(c: Card): { id: number } };
    const tol = 1e-7 * Math.max(1, v);
    const others = pool.pos.filter((t) => t !== "WeaponDamageAmountMod");
    let hintedCount = 0;
    for (let a = 0; a < others.length; a++)
      for (let b = a + 1; b < others.length; b++)
        for (let c = b + 1; c < others.length; c++) {
          const traits = [others[a], others[b], others[c]].map((tag) => ({ tag, w: 1 }));
          const value = s.value[inner.stateOf({ layout: L31, pos: traits, neg: { tag: "WeaponDamageAmountMod", w: 1 }, spliced: null }).id];
          if (value === undefined) continue;
          const hinted = k.chips.some((ch) => satisfies(ch.parts, traits));
          if (hinted) hintedCount++;
          if (hinted && value > v + tol) throw new Error(`hint keeps a worse card: ${traits.map((t) => t.tag).join(" ")} (${value} > ${v})`);
          if (!k.partial && value < v - tol && !hinted) throw new Error(`a better card is not in the hint: ${traits.map((t) => t.tag).join(" ")}`);
        }
    // the hint still says something useful, or hands the rest to the comparison
    expect(hintedCount > 0 || k.partial).toBe(true);
  });
});
