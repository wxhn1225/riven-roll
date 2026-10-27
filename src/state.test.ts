import { afterEach, describe, expect, it, vi } from "vitest";
import { cycleCost } from "./engine/solver";
import {
  afterKeep,
  afterMissed,
  barRange,
  cardProblem,
  compareCount,
  compareIds,
  cyclesAfterCompare,
  defaultSession,
  defaultTarget,
  demoSession,
  firstShown,
  fmtRoll,
  loadSession,
  plannedRoll,
  readQuality,
  repairSession,
  saveSession,
  showsUp,
  signedValue,
  toEngineCard,
  toEngineTarget,
  valueBar,
  valueToW,
  withAutoValues,
  withCounted,
} from "./state";

afterEach(() => vi.unstubAllGlobals());

const L31 = { pos: 3, neg: 1 } as const;

it("turns a roll bar into the value range shown in game", () => {
  expect(barRange("Pistol", "WeaponFireIterationsMod", L31, 1.07)).toEqual({ w: "1.07–1.10", shown: "+144.1% ~ +148.1%" });
  expect(barRange("Pistol", "WeaponFireIterationsMod", L31, 0.9)).toEqual({ w: "0.90–1.10", shown: "+121.2% ~ +148.1%" });
  expect(barRange("Pistol", "WeaponFireIterationsMod", L31, 1.2)).toBeNull();
});

it("turns a shown value back into the roll it needs", () => {
  expect(valueToW("Pistol", "WeaponFireIterationsMod", L31, 140)).toBeCloseTo(1.0393, 3);
});

it("keeps a third decimal for bars converted from a value", () => {
  const w = valueToW("Pistol", "WeaponFireIterationsMod", L31, 140);
  expect(barRange("Pistol", "WeaponFireIterationsMod", L31, w)).toEqual({ w: "1.039–1.10", shown: "+140% ~ +148.1%" });
});

it("starts new sessions and demos with the fewest-cycles objective", () => {
  expect(defaultTarget().objective).toBe("cycles");
  expect(defaultSession().target.objective).toBe("cycles");
  expect(demoSession("zh").target.objective).toBe("cycles");
});

it("moves sessions saved under the old least-Kuva default to fewest cycles once, then keeps the choice", () => {
  const getItem = vi.fn();
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem, setItem });
  // saved before the change: least Kuva was only the old default
  getItem.mockReturnValue(JSON.stringify({ target: { objective: "kuva" } }));
  expect(loadSession().target.objective).toBe("cycles");
  getItem.mockReturnValue(JSON.stringify({ target: {} }));
  expect(loadSession().target.objective).toBe("cycles");
  // chosen since then: kept
  const chosen = { ...defaultSession(), target: { ...defaultTarget(), objective: "kuva" as const } };
  saveSession(chosen);
  const written = setItem.mock.calls[0][1] as string;
  expect(JSON.parse(written).version).toBe(2);
  getItem.mockReturnValue(written);
  const loaded = loadSession();
  expect(loaded.target.objective).toBe("kuva");
  expect("version" in loaded).toBe(false);
});

it("names what is wrong with a card that cannot be planned", () => {
  const card = demoSession("zh").card;
  expect(cardProblem("Pistol", card)).toBeNull();
  const first = (t: (typeof card.pos)[number]) => ({ ...card, pos: [t, ...card.pos.slice(1)] });
  expect(cardProblem("Pistol", first({ ...card.pos[0], shown: null }))).toEqual({ kind: "incomplete" });
  expect(cardProblem("Pistol", first({ ...card.pos[0], shown: 999 }))).toEqual({ kind: "impossible", tag: "WeaponFireIterationsMod", shown: 999, layout: L31 });
  expect(cardProblem("Pistol", { ...card, pos: [card.pos[0], card.pos[0], card.pos[2]] })).toEqual({ kind: "duplicate", tag: "WeaponFireIterationsMod" });
  expect(cardProblem("Pistol", { ...card, neg: { tag: "WeaponViralDamageMod", shown: -50 } })).toEqual({ kind: "notNegative", tag: "WeaponViralDamageMod" });
  expect(cardProblem("Pistol", { ...card, cycles: -1 })).toEqual({ kind: "cycles" });
  const twoSpliced = { ...card, pos: [card.pos[0], { tag: "WeaponViralDamageMod", shown: 100 }, { tag: "WeaponCorrosiveDamageMod", shown: 100 }] };
  expect(cardProblem("Pistol", twoSpliced)).toEqual({ kind: "twoSpliced" });
  // every card the planner refuses has a named reason, and every card it accepts has none
  for (const c of [card, first({ ...card.pos[0], shown: 999 }), twoSpliced]) expect(cardProblem("Pistol", c) == null).toBe(toEngineCard("Pistol", c) != null);
});

it("accepts arbitrary target thresholds without treating them as existing card displays", () => {
  expect(valueToW("Pistol", "WeaponFireIterationsMod", L31, 140.05)).toBe(valueToW("Pistol", "WeaponFireIterationsMod", L31, 140.1));
  expect(valueToW("Pistol", "WeaponFireIterationsMod", L31, 999)).toBe(Number.POSITIVE_INFINITY);
});

it("rejects impossible, non-finite and repeated card traits before planning", () => {
  const original = demoSession("zh").card;
  expect(toEngineCard("Pistol", original)).not.toBeNull();
  for (const shown of [999, Number.NaN, Number.POSITIVE_INFINITY]) {
    const card = { ...original, pos: original.pos.map((t, i) => (i === 0 ? { ...t, shown } : t)) };
    expect(toEngineCard("Pistol", card)).toBeNull();
  }
  expect(toEngineCard("Pistol", { ...original, pos: [original.pos[0], original.pos[0], original.pos[2]] })).toBeNull();
  expect(toEngineCard("Pistol", { ...original, neg: { ...original.pos[0], shown: -100 } })).toBeNull();
  expect(toEngineCard("Pistol", { ...original, pos: [{ tag: "unknown", shown: 1 }, ...original.pos.slice(1)] })).toBeNull();
  expect(toEngineCard("Pistol", { ...original, cycles: -1 })).toBeNull();
});

describe("counted comparisons", () => {
  it("keeps the last 40 names, newest last, without repeats", () => {
    let list: string[] = [];
    for (let i = 0; i < 25; i++) list = withCounted(list, [`cycle:${i}`, `file${i}`]);
    expect(list).toHaveLength(40);
    expect(list.at(-1)).toBe("file24");
    expect(withCounted(["a", "b"], ["a"])).toEqual(["b", "a"]);
  });

  it("starts empty in a new session", () => {
    expect(defaultSession().counted).toEqual([]);
    expect(demoSession("zh").counted).toEqual([]);
  });

  it("survives a reload, and older saves without it start empty", () => {
    const getItem = vi.fn();
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });
    saveSession({ ...defaultSession(), counted: ["abc"] });
    getItem.mockReturnValue(setItem.mock.calls[0][1]);
    expect(loadSession().counted).toEqual(["abc"]);
    getItem.mockReturnValue(JSON.stringify({ version: 2, target: {} }));
    expect(loadSession().counted).toEqual([]);
    getItem.mockReturnValue(JSON.stringify({ version: 2, counted: "oops" }));
    expect(loadSession().counted).toEqual([]);
  });
});

describe("which cycle a comparison shows", () => {
  const card = (cycles: number | null, shown = 100) => ({ cycles, traits: ["a", "b", "c"].map((tag) => ({ tag, shown })) });
  type Paste = [number | null, number | null, string | null];
  /** How many cycles a run of pasted comparisons counts, starting from what a session saved. */
  const count = (pastes: Paste[], saved: string[] = []) => {
    let counted = saved;
    let n = 0;
    for (const [old, next, file] of pastes) {
      const ids = compareIds([card(old), card(next)], file);
      if (!ids.some((id) => counted.includes(id))) n++;
      counted = withCounted(counted, ids);
    }
    return n;
  };
  it("counts one cycle however it was read or saved", () => {
    expect(
      count([
        [160, 161, "A"],
        [null, 161, "B"],
      ]),
    ).toBe(1); // full, then only the new side
    expect(
      count([
        [null, 161, "B"],
        [160, 161, "A"],
      ]),
    ).toBe(1);
    expect(
      count([
        [160, 161, "A"],
        [160, null, "B"],
      ]),
    ).toBe(1); // full, then only the old side
    expect(
      count([
        [160, null, "B"],
        [160, 161, "A"],
      ]),
    ).toBe(1);
    expect(
      count([
        [null, 161, "A"],
        [160, null, "B"],
      ]),
    ).toBe(1); // one side each
    expect(
      count([
        [160, 161, "A"],
        [null, null, "A"],
      ]),
    ).toBe(1); // the same file, with and without its counts
    expect(
      count([
        [null, null, "A"],
        [160, 161, "A"],
      ]),
    ).toBe(1);
    expect(
      count([
        [160, 161, "A"],
        [160, 161, "B"],
        [160, 161, "A"],
      ]),
    ).toBe(1);
  });
  it("counts a real next cycle, even with the same stats", () => {
    expect(
      count([
        [160, 161, "A"],
        [161, 162, "B"],
      ]),
    ).toBe(2);
    expect(
      count([
        [null, 161, "A"],
        [161, null, "B"],
      ]),
    ).toBe(2);
    expect(
      count([
        [null, null, "A"],
        [null, null, "B"],
      ]),
    ).toBe(2);
  });
  it("does not trust counts that disagree", () => {
    // 160 then 171 cannot be one cycle: only the file names it
    expect(compareIds([card(160), card(171)], "A")).toEqual(["A"]);
    expect(cyclesAfterCompare(160, [160, 171])).toBe(161);
    expect(cyclesAfterCompare(160, [null, 165])).toBe(165);
    expect(cyclesAfterCompare(160, [170, null])).toBe(171);
  });
  it("recognizes what sessions saved before", () => {
    const getItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });
    // a file hash saved by the first version, and a cycle saved as ["cycle", [old, new], tags] by the next one
    getItem.mockReturnValue(JSON.stringify({ version: 2, counted: ["A", JSON.stringify(["cycle", [170, 171], [["x"], ["y"]]])] }));
    const saved = loadSession().counted;
    expect(saved).toEqual(["A", "cycle:171"]);
    expect(count([[160, 161, "A"]], saved)).toBe(0);
    expect(count([[null, 171, "C"]], saved)).toBe(0);
    expect(count([[171, 172, "D"]], saved)).toBe(1);
  });
});

describe("a saved session", () => {
  it("survives damaged parts, keeping the rest", () => {
    const good = { ...demoSession("en"), version: 2 };
    const s = repairSession({ ...good, card: null, target: { ...good.target, sets: "x", tiers: { mid: "a" } }, step: 5, log: [1, { at: 1, text: "ok" }] });
    expect(s.card).toEqual({ pos: [], neg: null, cycles: 0 });
    expect(s.target.sets).toEqual([[]]);
    expect(s.target.tiers).toEqual(defaultTarget().tiers);
    expect(s.step).toEqual({ cycles: 0, kuva: 0 });
    expect(s.log).toEqual([{ at: 1, text: "ok" }]);
    // the parts that were fine are kept
    expect(s.lang).toBe("en");
    expect(s.weaponId).toBe(good.weaponId);
    expect(s.kuva).toBe(good.kuva);
  });

  it("keeps a target row that is still being filled in, so a reload does not loosen the target", () => {
    const good = { ...demoSession("zh"), version: 2 };
    const draft = {
      ...good,
      target: {
        ...good.target,
        sets: [
          [
            { tags: ["WeaponFireIterationsMod"], tier: "any" },
            { tags: [], tier: "any" },
          ],
        ],
      },
    };
    const s = repairSession(draft);
    expect(s.target.sets[0]).toHaveLength(2);
    // and an unfinished row still keeps the target from being planned
    expect(toEngineTarget(s.target, "Pistol")).toBeNull();
  });

  it("keeps a good save as it was", () => {
    const good = { ...demoSession("zh"), version: 2 };
    const { version: _, ...session } = good;
    expect(repairSession(good)).toEqual(session);
  });

  it("shows a spliced trait with the roll the plan uses, so card and plan agree on a bar", () => {
    // weak point damage +357.5% at 2+1 reads 1.06996 in the middle of its range, but the plan counts it at 1.07
    const L21 = { pos: 2, neg: 1 } as const;
    const q = readQuality("Rifle", L21, { tag: "WeaponWeakpointDamage", shown: 357.5 }, false);
    if (!q) throw new Error("no reading");
    expect(q.w).toBeLessThan(1.07);
    expect(plannedRoll("Rifle", "WeaponWeakpointDamage", q)).toBeGreaterThanOrEqual(1.07);
    const plain = readQuality("Rifle", L21, { tag: "WeaponZoomFovMod", shown: 89.1 }, false);
    if (!plain) throw new Error("no reading");
    expect(plannedRoll("Rifle", "WeaponZoomFovMod", plain)).toBe(plain.w);
  });

  it("does not take a cycle's price twice off the Kuva a screenshot already shows", () => {
    // a 7,000 locked cycle from 20 to 21; the screenshot shows 993,000 left (1,000,000 before the cycle)
    const base = { ...demoSession("zh"), card: { ...demoSession("zh").card, cycles: 20 }, counted: [] };
    const compare = { ids: ["cycle:21", "shot"], cycles: [20, 21] as [number, number], locked: true, kuvaShown: true };
    const draft = (cycles: number) => ({ ...base.card, cycles });
    // pasted straight away: the reader set 993,000, keeping the old riven leaves it there
    const pasted = afterKeep({ ...base, kuva: 993_000 }, compare, 0, draft);
    expect(pasted.kuva).toBe(993_000);
    expect(pasted.total).toEqual({ cycles: base.total.cycles + 1, kuva: base.total.kuva + 7000 });
    // "no luck" first, then the same screenshot: the cycle is counted once, and the Kuva is the same either way
    const missed = afterMissed({ ...base, kuva: 1_000_000 }, 7000);
    const after = afterKeep({ ...missed, kuva: 993_000 }, compare, 0, draft);
    expect([after.kuva, after.total]).toEqual([pasted.kuva, pasted.total]);
    // without a Kuva count on the screenshot the price is still taken off the one typed in
    expect(afterKeep({ ...base, kuva: 1_000_000 }, { ...compare, kuvaShown: false }, 0, draft).kuva).toBe(993_000);
  });

  it("fills a picked stat with the lowest roll, following the layout until typed over", () => {
    const crit = { tag: "WeaponCritChanceMod", shown: null, auto: true };
    const two = withAutoValues("Pistol", { pos: [crit, { tag: "WeaponFireIterationsMod", shown: 100 }], neg: null, cycles: 0 });
    const q2 = readQuality("Pistol", { pos: 2, neg: 0 }, two.pos[0], false);
    expect(q2?.valid).toBe(true);
    expect(q2?.lo).toBe(0.9);
    // a third positive changes the layout: the filled-in number moves with it, the typed one stays
    const three = withAutoValues("Pistol", { ...two, pos: [...two.pos, { tag: "WeaponDamageAmountMod", shown: null, auto: true }] });
    expect(three.pos[0].shown).not.toBe(two.pos[0].shown);
    expect(readQuality("Pistol", { pos: 3, neg: 0 }, three.pos[0], false)?.lo).toBe(0.9);
    expect(three.pos[1].shown).toBe(100);
    // a negative gets the lowest roll too
    const neg = withAutoValues("Pistol", { ...three, neg: { tag: "WeaponZoomFovMod", shown: null, auto: true } });
    expect(readQuality("Pistol", { pos: 3, neg: 1 }, neg.neg ?? { tag: "", shown: null }, true)?.valid).toBe(true);
  });

  it("moves a save to the one id of a weapon that used to be listed twice", () => {
    const shell = "/Lotus/Weapons/Tenno/Melee/Hammer/DaxDuviriHammer/DaxDuviriHammerPlayerWeapon";
    expect(repairSession({ ...demoSession("zh"), weaponId: shell }).weaponId).toBe("/Lotus/Weapons/Tenno/Melee/Hammer/DaxDuviriHammer/DaxDuviriHammerWeapon");
  });

  it("drops what cannot be read inside the lists", () => {
    const s = repairSession({
      version: 2,
      card: { pos: [{ tag: "WeaponFireIterationsMod", shown: "x" }, 7, { tag: "WeaponToxinDamageMod", shown: 100 }], neg: { tag: 3 }, cycles: -2 },
      target: { sets: [[{ tags: ["WeaponFireIterationsMod"], tier: "value" }, { tags: [] }, "x"], "y"], layouts: ["31", "99"] },
      weaponId: "nope",
    });
    expect(s.card).toEqual({
      pos: [
        { tag: "WeaponFireIterationsMod", shown: null },
        { tag: "WeaponToxinDamageMod", shown: 100 },
      ],
      neg: null,
      cycles: 0,
    });
    expect(s.target.sets).toEqual([
      [
        { tags: ["WeaponFireIterationsMod"], tier: "any" },
        { tags: [], tier: "any" },
      ],
    ]);
    expect(s.target.layouts).toEqual(["31"]);
    expect(s.weaponId).toBeNull();
  });
});

describe("a cycle counted by hand", () => {
  it("is the same cycle as the comparison screenshot of it", () => {
    const start = { ...demoSession("zh"), card: { ...demoSession("zh").card, cycles: 160 } };
    const after = afterMissed(start, 3500);
    expect(after.card.cycles).toBe(161);
    expect(after.total).toEqual({ cycles: 1, kuva: 3500 });
    const card = (cycles: number | null) => ({ cycles, traits: [] });
    // the screenshot of that cycle (160 -> 161) is already counted, whatever file it comes in
    expect(compareIds([card(160), card(161)], "file").some((id) => after.counted.includes(id))).toBe(true);
    // the real next cycle is not
    expect(compareIds([card(161), card(162)], "file2").some((id) => after.counted.includes(id))).toBe(false);
  });
});

describe("the price and count of a compared cycle", () => {
  it("prices the cycle from the counts on the screenshot, not the page's", () => {
    // the page still says 0; the screenshot shows the riven going from 5 to 6 cycles
    expect(compareCount(0, [5, 6], false)).toEqual({ before: 5, after: 6 });
    expect(cycleCost(5, false)).toBe(2000);
    expect(cycleCost(5, true)).toBe(4000);
    expect(compareCount(0, [null, 6], false)).toEqual({ before: 5, after: 6 });
    expect(compareCount(0, [5, null], false)).toEqual({ before: 5, after: 6 });
  });
  it("falls back to the page when the screenshot has no trustworthy count", () => {
    expect(compareCount(7, [null, null], false)).toEqual({ before: 7, after: 8 });
    expect(compareCount(7, [5, 9], false)).toEqual({ before: 7, after: 8 });
  });
  it("never moves the count back", () => {
    // an older screenshot than the page: still one more cycle, priced at its own count
    expect(compareCount(200, [160, 161], false)).toEqual({ before: 160, after: 201 });
    expect(compareCount(200, [160, 161], true).after).toBe(200);
  });
  it("lets a comparison counted before correct the count without charging it again", () => {
    // first read without counts: the page counts 0 -> 1; the same file read again shows 160 -> 161
    const first = compareCount(0, [null, null], false);
    expect(first.after).toBe(1);
    const again = compareCount(first.after, [160, 161], true);
    expect(again.after).toBe(161);
    // the real next cycle is priced at the full rate
    const next = compareCount(again.after, [161, 162], false);
    expect(next).toEqual({ before: 161, after: 162 });
    expect(cycleCost(next.before, true)).toBe(7000);
  });
});

describe("typed values", () => {
  it("reads the size of a value in each stat's own direction", () => {
    expect(signedValue("Rifle", "WeaponRecoilReductionMod", 90)).toBe(-90);
    expect(signedValue("Rifle", "WeaponRecoilReductionMod", -90)).toBe(-90);
    expect(signedValue("Rifle", "WeaponReloadSpeedMod", -90)).toBe(90);
  });

  it("previews each stat's bar in its own direction, and rolls as typed", () => {
    expect(valueBar("Rifle", "WeaponRecoilReductionMod", 110)).toBe(" ≤ -110%");
    expect(valueBar("Rifle", "WeaponRecoilReductionMod", -110)).toBe(" ≤ -110%");
    expect(valueBar("Rifle", "WeaponReloadSpeedMod", 90)).toBe(" ≥ +90%");
    // the first number the card can show that meets the bar: 110.05 is met by 110.1, not 110.0
    expect(valueBar("Rifle", "WeaponFireIterationsMod", 110.05)).toBe(" ≥ +110.1%");
    expect(firstShown("Rifle", "WeaponFireIterationsMod", 110)).toBe(110);
    expect(valueBar("Rifle", "WeaponRecoilReductionMod", 110.05)).toBe(" ≤ -110.1%");
    expect(valueBar("Rifle", "WeaponFactionDamageGrineer", 1.495)).toBe(" ≥ x1.50");
    expect(showsUp("Rifle", "WeaponRecoilReductionMod")).toBe(false);
    expect(showsUp("Rifle", "WeaponReloadSpeedMod")).toBe(true);
    expect(fmtRoll(1.07)).toBe("1.07");
    expect(fmtRoll(1.075)).toBe("1.075");
    expect(fmtRoll(1.0394)).toBe("1.0394");
  });
});

describe("the saved disposition", () => {
  it("keeps a sensible one and falls back to 1.2 otherwise", () => {
    expect(defaultSession().disposition).toBe(1.2);
    expect(repairSession({ version: 2, disposition: 1.05 }).disposition).toBe(1.05);
    expect(repairSession({ version: 2, disposition: 7 }).disposition).toBe(1.2);
    expect(repairSession({ version: 2 }).disposition).toBe(1.2);
    // kept as it is shown: four decimals at most
    expect(repairSession({ version: 2, disposition: 1.234 }).disposition).toBe(1.234);
    expect(repairSession({ version: 2, disposition: 1.23456 }).disposition).toBe(1.2346);
  });
});
