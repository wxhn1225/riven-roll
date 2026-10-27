import { afterEach, describe, expect, it } from "vitest";
import { statOf } from "./data";
import {
  DEFAULT_DISPOSITION,
  DISPOSITION_MAX,
  displayNumber,
  formatDisplay,
  formatDisposition,
  type Layout,
  minimumQualityForDisplay,
  qualityFromDisplay,
  rawValue,
  setDisposition,
  signedDisplayInput,
  tidyDisposition,
} from "./formula";

const L31: Layout = { pos: 3, neg: 1 };

// 圣装葬铭 (Epitaph Prime, pistol) cards.
describe("roll quality from shown values", () => {
  it.each([
    ["WeaponFireIterationsMod", false, 144.5, 1.073],
    ["WeaponToxinDamageMod", false, 102.6, 1.013],
    ["WeaponFactionDamageGrineer", false, 1.49, 0.968],
    ["WeaponClipMaxMod", true, -47.1, 1.047],
    ["WeaponFreezeDamageMod", false, 109.8, 1.084],
    ["WeaponDamageAmountMod", false, 262, 1.061],
  ] as const)("%s %s", (tag, curse, shown, expected) => {
    const q = qualityFromDisplay(statOf("Pistol", tag), L31, curse, shown);
    expect(q.valid).toBe(true);
    expect(q.w).toBeCloseTo(expected, 2);
  });

  it("treats a negative recoil number as a buff", () => {
    const q = qualityFromDisplay(statOf("Pistol", "WeaponRecoilReductionMod"), L31, false, -94.8);
    expect(q.valid).toBe(true);
  });

  it("flags values outside 0.9–1.1", () => {
    // 144.5% multishot cannot be a 2+0 pistol roll at rank 8 (max 130.4%)
    const q = qualityFromDisplay(statOf("Pistol", "WeaponFireIterationsMod"), { pos: 2, neg: 0 }, false, 160);
    expect(q.valid).toBe(false);
  });
});

describe("display round trip", () => {
  it("formats like the game", () => {
    const ms = statOf("Pistol", "WeaponFireIterationsMod");
    expect(formatDisplay(ms, displayNumber(ms, rawValue(ms, L31, false, 1.073)))).toBe("+144.5%");
    const grineer = statOf("Pistol", "WeaponFactionDamageGrineer");
    expect(formatDisplay(grineer, displayNumber(grineer, rawValue(grineer, L31, false, 0.968)))).toBe("x1.49");
    const mag = statOf("Pistol", "WeaponClipMaxMod");
    expect(formatDisplay(mag, displayNumber(mag, rawValue(mag, L31, true, 1.047)))).toBe("-47.1%");
  });
});

describe("ordered card arithmetic and schema rounding", () => {
  it("preserves binary32 steps at a visible rounding boundary", () => {
    const heat = statOf("Rifle", "WeaponFireDamageMod");
    const value = rawValue(heat, { pos: 2, neg: 1 }, false, 1);
    expect(value).toBe(1.3364999294281006);
    expect(displayNumber(heat, value)).toBe(133.6);
    const damage = statOf("Pistol", "WeaponDamageAmountMod");
    expect(rawValue(damage, L31, false, 1)).toBe(2.4704997539520264);
    expect(displayNumber(damage, rawValue(damage, L31, false, 1))).toBe(247);
  });

  it("uses the initial-combo floor rule in both directions", () => {
    const combo = statOf("Melee", "WeaponMeleeComboInitialBonusMod");
    expect(combo.roundingMode).toBe("RM_FLOOR");
    expect(displayNumber(combo, rawValue(combo, { pos: 2, neg: 0 }, false, 0.9))).toBe(26.1);
    expect(displayNumber(combo, rawValue(combo, { pos: 3, neg: 0 }, false, 1.1))).toBe(24.2);
    const low = qualityFromDisplay(combo, { pos: 2, neg: 0 }, false, 26.1);
    expect(low.valid).toBe(true);
    expect(low.lo).toBe(0.9);
    const high = qualityFromDisplay(combo, { pos: 3, neg: 0 }, false, 24.2);
    expect(high.valid).toBe(true);
    expect(high.hi).toBe(1.1);
    expect(qualityFromDisplay(combo, { pos: 3, neg: 0 }, false, 24.3).valid).toBe(false);
  });

  it("keeps a Kitgun recoil buff negative even when SmallerIsBetter is absent", () => {
    const recoil = statOf("Kitgun", "WeaponRecoilReductionMod");
    expect(recoil.smaller).toBe(false);
    expect(recoil.reverse).toBe(false);
    const shown = displayNumber(recoil, rawValue(recoil, L31, false, 1));
    expect(shown).toBe(-101.2);
    expect(qualityFromDisplay(recoil, L31, false, shown).valid).toBe(true);
    expect(qualityFromDisplay(recoil, L31, false, -shown).valid).toBe(false);
    expect(signedDisplayInput(recoil, false, 101.2)).toBe(-101.2);
    expect(signedDisplayInput(recoil, false, -101.2)).toBe(-101.2);
    expect(signedDisplayInput(recoil, true, -50)).toBe(50);
  });

  it("normalizes typed magnitudes using display rules rather than benefit metadata", () => {
    const efficiency = statOf("Pistol", "WeaponAmmoEfficiency");
    expect(signedDisplayInput(efficiency, false, -50)).toBe(50);
    const comboLoss = statOf("Melee", "WeaponMeleeComboPointsOnHitMod");
    expect(signedDisplayInput(comboLoss, true, 50)).toBe(-50);
    const faction = statOf("Pistol", "WeaponFactionDamageGrineer");
    expect(signedDisplayInput(faction, true, 0.75)).toBe(0.75);
  });

  it("reverses the displayed sign after signed rounding", () => {
    const reversed = statOf("Melee", "WeaponMeleeComboPointsOnHitMod");
    expect(reversed.reverse).toBe(true);
    // 12.5 / 0.1 = 125 is exact; at 12.45 the signed tie rule is observable.
    expect(displayNumber(reversed, 0.1245)).toBe(-12.5);
    expect(displayNumber(reversed, -0.1245)).toBe(12.4);
  });

  it.each([
    ["Rifle", "WeaponFireDamageMod", false],
    ["Pistol", "WeaponRecoilReductionMod", false],
    ["Pistol", "WeaponRecoilReductionMod", true],
    ["Pistol", "WeaponFactionDamageGrineer", false],
    ["Pistol", "WeaponFactionDamageGrineer", true],
    ["Melee", "WeaponMeleeComboInitialBonusMod", false],
  ] as const)("keeps %s %s curse=%s endpoint and mid-value readings consistent", (cls, tag, curse) => {
    const stat = statOf(cls, tag);
    for (const w of [0.9, 0.95, 1, 1.05, 1.1]) {
      const shown = displayNumber(stat, rawValue(stat, L31, curse, w));
      const result = qualityFromDisplay(stat, L31, curse, shown);
      expect(result.valid).toBe(true);
      expect(w).toBeGreaterThanOrEqual(result.lo - 1e-12);
      expect(w).toBeLessThanOrEqual(result.hi + 1e-12);
      expect(displayNumber(stat, rawValue(stat, L31, curse, result.w))).toBe(shown);
    }
  });

  it("rejects values between display increments and non-finite inputs", () => {
    const stat = statOf("Rifle", "WeaponFireDamageMod");
    expect(qualityFromDisplay(stat, L31, false, 101.25).valid).toBe(false);
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(qualityFromDisplay(stat, L31, false, n).valid).toBe(false);
      expect(Number.isNaN(rawValue(stat, L31, false, n))).toBe(true);
      expect(Number.isNaN(displayNumber(stat, n))).toBe(true);
    }
    expect(qualityFromDisplay(stat, L31, false, 101.2, -1).valid).toBe(false);
    expect(qualityFromDisplay(stat, L31, false, 101.2, 1.5).valid).toBe(false);
    expect(qualityFromDisplay({ ...stat, base: 0 }, L31, false, 0).valid).toBe(false);
  });

  it("accepts an arbitrary numeric target without treating it as a claimed card value", () => {
    const stat = statOf("Rifle", "WeaponFireDamageMod");
    const target = 101.25;
    expect(qualityFromDisplay(stat, L31, false, target).valid).toBe(false);
    const threshold = minimumQualityForDisplay(stat, L31, false, target);
    expect(threshold).toBeGreaterThan(0.9);
    expect(threshold).toBeLessThan(1.1);
    expect(displayNumber(stat, rawValue(stat, L31, false, threshold))).toBe(101.3);
    expect(displayNumber(stat, rawValue(stat, L31, false, threshold - 1e-7))).toBe(101.2);
    expect(minimumQualityForDisplay(stat, L31, false, 0)).toBe(0.9);
    expect(minimumQualityForDisplay(stat, L31, false, 99999)).toBe(Number.POSITIVE_INFINITY);
  });

  it("uses the same target boundary for floor values and favorable negative numbers", () => {
    const combo = statOf("Melee", "WeaponMeleeComboInitialBonusMod");
    const layout: Layout = { pos: 3, neg: 0 };
    const threshold = minimumQualityForDisplay(combo, layout, false, 24.15);
    expect(displayNumber(combo, rawValue(combo, layout, false, threshold))).toBe(24.2);
    expect(minimumQualityForDisplay(combo, layout, false, 24.25)).toBe(Number.POSITIVE_INFINITY);
    const recoil = statOf("Pistol", "WeaponRecoilReductionMod");
    const w = minimumQualityForDisplay(recoil, L31, false, -101.25);
    expect(displayNumber(recoil, rawValue(recoil, L31, false, w))).toBe(-101.3);
  });
});

describe("the player's disposition", () => {
  afterEach(() => setDisposition(DEFAULT_DISPOSITION));
  it("scales every value, and reads a card's roll with it", () => {
    const def = statOf("Pistol", "WeaponFireIterationsMod");
    const at12 = rawValue(def, L31, false, 1);
    setDisposition(1);
    expect(rawValue(def, L31, false, 1) / at12).toBeCloseTo(1 / 1.2, 6);
    // under 1.0 the number a 1.2 card shows at roll 1 would need a roll of 1.2: it cannot be read as valid
    const shown = displayNumber(def, at12);
    expect(qualityFromDisplay(def, L31, false, shown).valid).toBe(false);
  });
  it("shows exactly the number it computes with", () => {
    expect(formatDisposition(1.2)).toBe("1.20");
    expect(formatDisposition(1.234)).toBe("1.234");
    expect(formatDisposition(tidyDisposition(1.23456))).toBe("1.2346");
    // 1.23 and 1.234 never look the same
    expect(formatDisposition(1.23)).not.toBe(formatDisposition(1.234));
    setDisposition(1.23456);
    const def = statOf("Pistol", "WeaponFireIterationsMod");
    const used = rawValue(def, L31, false, 1);
    setDisposition(1.2346);
    expect(rawValue(def, L31, false, 1)).toBe(used);
  });

  it("stays within the span dispositions had", () => {
    setDisposition(9);
    const def = statOf("Pistol", "WeaponFireIterationsMod");
    const top = rawValue(def, L31, false, 1);
    setDisposition(DISPOSITION_MAX);
    expect(rawValue(def, L31, false, 1)).toBe(top);
    // nonsense falls back to the game's value
    setDisposition(Number.NaN);
    const back = rawValue(def, L31, false, 1);
    setDisposition(DEFAULT_DISPOSITION);
    expect(rawValue(def, L31, false, 1)).toBe(back);
  });
});
