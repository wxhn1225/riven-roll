import { describe, expect, it } from "vitest";
import { GAME, weaponById } from "./engine/data";
import { poolFor } from "./engine/pool";
import { readTarget } from "./quick";
import { defaultTarget, toEngineTarget } from "./state";

const epitaph = weaponById("/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon");
if (!epitaph) throw new Error("missing weapon");
const pool = poolFor(epitaph);
const read = (text: string) => readTarget(text, "Pistol", pool);
const tags = (r: ReturnType<typeof read>) => r.sets.map((gs) => gs.map((g) => g.tags));
// Lex rolls puncture but not impact or slash
const lex = weaponById("/Lotus/Weapons/Tenno/Pistol/HeavyPistol");
if (!lex) throw new Error("missing Lex");
const readLex = (text: string) => readTarget(text, "Pistol", poolFor(lex));

describe("typed targets", () => {
  it("reads 基多射负任意", () => {
    const r = read("基多射负任意");
    expect(tags(r)).toEqual([[["WeaponDamageAmountMod"], ["WeaponFireIterationsMod"], ["WeaponFireRateMod"]]]);
    expect(r.neg).toEqual({ kind: "any" });
    expect(r.unknown).toEqual([]);
  });

  it("reads 双暴 / 双爆 as both crit stats, and 爆率 / 爆伤 like 暴率 / 暴伤", () => {
    const both = [["WeaponCritChanceMod"], ["WeaponCritDamageMod"]];
    expect(tags(read("双暴多"))).toEqual([[...both, ["WeaponFireIterationsMod"]]]);
    expect(tags(read("双爆 基"))).toEqual([[...both, ["WeaponDamageAmountMod"]]]);
    expect(tags(read("爆率爆伤射"))).toEqual([[...both, ["WeaponFireRateMod"]]]);
  });

  it("takes the longest name: 暴伤 is critical damage, 触发时间 is status duration", () => {
    expect(tags(read("暴暴伤触发时间"))).toEqual([[["WeaponCritChanceMod"], ["WeaponCritDamageMod"], ["WeaponProcTimeMod"]]]);
  });

  it("reads official names in all three languages", () => {
    expect(tags(read("多重射击 毒素伤害 对克隆尼的伤害"))).toEqual([[["WeaponFireIterationsMod"], ["WeaponToxinDamageMod"], ["WeaponFactionDamageGrineer"]]]);
    expect(tags(read("Multishot, Critical Damage, Damage to Grineer"))).toEqual([[["WeaponFireIterationsMod"], ["WeaponCritDamageMod"], ["WeaponFactionDamageGrineer"]]]);
  });

  it("reads 繁中: official names, the same short forms, and 繁中 keywords", () => {
    const r = read("基多射 負任意");
    expect(tags(r)).toEqual([[["WeaponDamageAmountMod"], ["WeaponFireIterationsMod"], ["WeaponFireRateMod"]]]);
    expect(r.neg).toEqual({ kind: "any" });
    expect(read("高雙暴 多重110").sets[0]).toEqual([
      { tags: ["WeaponCritChanceMod"], tier: "hi" },
      { tags: ["WeaponCritDamageMod"], tier: "hi" },
      { tags: ["WeaponFireIterationsMod"], tier: "value", value: 110 },
    ]);
    expect(tags(read("暴擊傷害 腐蝕或病毒 狀態持續時間"))).toEqual([[["WeaponCritDamageMod"], ["WeaponCorrosiveDamageMod", "WeaponViralDamageMod"], ["WeaponProcTimeMod"]]]);
    expect(read("多重 負變焦").neg).toEqual({ kind: "list", tags: ["WeaponZoomFovMod"] });
    expect(read("多重 不要負").neg).toEqual({ kind: "none" });
    expect(read("後座力-90").sets[0]).toEqual([{ tags: ["WeaponRecoilReductionMod"], tier: "value", value: -90 }]);
  });

  it("reads every official 繁中 name of a stat this weapon rolls", () => {
    for (const tag of pool.pos) {
      const name = GAME.classes.Pistol.stats.find((s) => s.tag === tag)?.name.tc ?? "";
      const r = read(name);
      expect(r.unknown, name).toEqual([]);
      expect(
        r.sets[0].map((g) => g.tags),
        name,
      ).toEqual([[tag]]);
    }
  });

  it("puts 或 and / in one slot and splits targets on ;", () => {
    const r = read("基 多 腐蚀或病毒；多 暴伤 弹药效率/异常伤害");
    expect(tags(r)).toEqual([
      [["WeaponDamageAmountMod"], ["WeaponFireIterationsMod"], ["WeaponCorrosiveDamageMod", "WeaponViralDamageMod"]],
      [["WeaponFireIterationsMod"], ["WeaponCritDamageMod"], ["WeaponAmmoEfficiency", "WeaponStatusDamage"]],
    ]);
  });

  it("reads tiers, rolls and shown values", () => {
    const r = read("多重110 暴伤高 毒1.05");
    expect(r.sets[0]).toEqual([
      { tags: ["WeaponFireIterationsMod"], tier: "value", value: 110 },
      { tags: ["WeaponCritDamageMod"], tier: "hi" },
      { tags: ["WeaponToxinDamageMod"], tier: "w", w: 1.05 },
    ]);
  });

  it("reads a tier written before the stat, the way players say it", () => {
    const tiers = (text: string) => read(text).sets[0].map((g) => [g.tags[0], g.tier]);
    expect(tiers("高双暴")).toEqual([
      ["WeaponCritChanceMod", "hi"],
      ["WeaponCritDamageMod", "hi"],
    ]);
    expect(tiers("高多重 基伤")).toEqual([
      ["WeaponFireIterationsMod", "hi"],
      ["WeaponDamageAmountMod", "any"],
    ]);
    expect(tiers("多重 高暴伤")).toEqual([
      ["WeaponFireIterationsMod", "any"],
      ["WeaponCritDamageMod", "hi"],
    ]);
    expect(tiers("高 多重 中基伤")).toEqual([
      ["WeaponFireIterationsMod", "hi"],
      ["WeaponDamageAmountMod", "mid"],
    ]);
    // written after the stat it still means that one, and both stats of a two-stat word
    expect(tiers("暴伤高 多重")).toEqual([
      ["WeaponCritDamageMod", "hi"],
      ["WeaponFireIterationsMod", "any"],
    ]);
    expect(tiers("双暴高")).toEqual([
      ["WeaponCritChanceMod", "hi"],
      ["WeaponCritDamageMod", "hi"],
    ]);
    expect(tiers("hi ms, cd")).toEqual([
      ["WeaponFireIterationsMod", "hi"],
      ["WeaponCritDamageMod", "any"],
    ]);
  });

  it("leaves a fifth target out instead of adding it to the fourth", () => {
    const r = read("多重;暴率;射速;装填;后坐力");
    expect(tags(r)).toEqual([[["WeaponFireIterationsMod"]], [["WeaponCritChanceMod"]], [["WeaponFireRateMod"]], [["WeaponReloadSpeedMod"]]]);
    expect(r.skipped).toEqual([{ tags: ["WeaponRecoilReductionMod"], why: "sets" }]);
  });

  it("reads full official names with their bracketed notes, without taking a number from them", () => {
    const melee = weaponById("/Lotus/Weapons/Tenno/Melee/LongSword/LongSword");
    if (!melee) throw new Error("missing weapon");
    const r = readTarget("暴击伤害高/暴击几率（重击时 x2）", "Melee", poolFor(melee));
    expect(r.sets[0]).toEqual([{ tags: ["WeaponCritDamageMod", "WeaponCritChanceMod"], tier: "hi" }]);
    expect(r.unknown).toEqual([]);
    expect(read("射速（弓类武器效果加倍）高").sets[0]).toEqual([{ tags: ["WeaponFireRateMod"], tier: "hi" }]);
  });

  it("gives recoil the minus sign the game shows", () => {
    expect(read("后坐力90").sets[0][0]).toEqual({ tags: ["WeaponRecoilReductionMod"], tier: "value", value: -90 });
  });

  it("reads a minus right before a number as its sign, not as 负", () => {
    const r = read("后坐力-110 变焦");
    expect(r.sets[0]).toEqual([
      { tags: ["WeaponRecoilReductionMod"], tier: "value", value: -110 },
      { tags: ["WeaponZoomFovMod"], tier: "any" },
    ]);
    expect(r.neg).toEqual({ kind: "keep" });
    expect(r.unknown).toEqual([]);
    expect(read("多 -变焦").neg).toEqual({ kind: "list", tags: ["WeaponZoomFovMod"] });
  });

  it("reads a number with % as a shown value, a bare 0.9–1.1 as a roll", () => {
    expect(read("多重1%").sets[0][0]).toEqual({ tags: ["WeaponFireIterationsMod"], tier: "value", value: 1 });
    expect(read("多重1").sets[0][0]).toEqual({ tags: ["WeaponFireIterationsMod"], tier: "w", w: 1 });
  });

  it("reads a decimal comma, and still splits words on a comma", () => {
    expect(read("多重110,5%").sets[0][0]).toEqual({ tags: ["WeaponFireIterationsMod"], tier: "value", value: 110.5 });
    expect(read("多重1,05").sets[0][0]).toEqual({ tags: ["WeaponFireIterationsMod"], tier: "w", w: 1.05 });
    expect(tags(read("多重110%,暴伤"))).toEqual([[["WeaponFireIterationsMod"], ["WeaponCritDamageMod"]]]);
  });

  it("keeps a layout or 0负 that follows a comma as its own word", () => {
    const same: [string, string][] = [
      ["多重110,3+1", "多重110 3+1"],
      ["多重110,2+0", "多重110 2+0"],
      ["多重110，3＋1", "多重110 3+1"],
      ["多重1,2+0", "多重1 2+0"],
      ["后坐力-90,3+1", "后坐力-90 3+1"],
      ["多重110,0负 暴伤", "多重110 0负 暴伤"],
      ["多重110,5.6%", "多重110 5.6%"],
      ["多重110,5%,3+1", "多重110.5% 3+1"],
    ];
    for (const [typed, spaced] of same) expect(read(typed), typed).toEqual(read(spaced));
  });

  it("puts a bar on the stat it follows, even one typed twice", () => {
    const r = read("后坐力/装填90 暴率1.075 后坐力-110");
    expect(r.sets[0]).toEqual([
      { tags: ["WeaponRecoilReductionMod", "WeaponReloadSpeedMod"], tier: "value", value: -110 },
      { tags: ["WeaponCritChanceMod"], tier: "w", w: 1.075 },
    ]);
    // after a stat this weapon cannot roll, the number is handed back, not given to the row before
    expect(readLex("多重 冲击 110").unknown).toEqual(["110"]);
    expect(readLex("多重 冲击 110").sets[0][0].tier).toBe("any");
  });

  it("hands back numbers it cannot place instead of dropping them", () => {
    expect(read("110 多重").unknown).toEqual(["110"]);
    expect(read("多重 负变焦 1.05").unknown).toEqual(["1.05"]);
    expect(read("对g 30%").unknown).toEqual(["30%"]);
    // one number cannot be x1.30 for one stat and 1.3% for the other
    const mixed = read("对g/多重 1.3");
    expect(mixed.unknown).toEqual(["1.3"]);
    expect(mixed.sets[0][0].tier).toBe("any");
  });

  it("gives every stat of an OR row the same bar whatever their order", () => {
    const bars = (text: string) => {
      const t = toEngineTarget({ ...defaultTarget(), sets: read(text).sets, layouts: ["31"] }, "Pistol");
      return t?.groups[0].minWBy;
    };
    const a = bars("后坐力/装填90");
    expect(a).toEqual(bars("装填/后坐力90"));
    // 90 means +90% reload too, not "anything above -90%"
    expect(a?.WeaponReloadSpeedMod["31"]).toBeGreaterThan(0.9);
  });

  it("reads negatives: none, a list, and layouts", () => {
    expect(read("基多射 不要负").neg).toEqual({ kind: "none" });
    expect(read("基多射 负变焦冲击").neg).toEqual({ kind: "list", tags: ["WeaponZoomFovMod", "WeaponImpactDamageMod"] });
    expect(read("基多射 3+1").layouts).toEqual(["31"]);
  });

  it("keeps what it understood and hands back the rest", () => {
    const r = read("基多啊啊射负任意");
    expect(tags(r)).toEqual([[["WeaponDamageAmountMod"], ["WeaponFireIterationsMod"], ["WeaponFireRateMod"]]]);
    expect(r.unknown).toEqual(["啊啊"]);
    expect(r.neg).toEqual({ kind: "any" });
  });

  it("says why a stat was left out", () => {
    // Lex cannot roll impact; pistols have no combo; four stats do not fit
    const r = readLex("冲击 连击 基 多 射 暴");
    expect(r.skipped.map((x) => x.why)).toEqual(["weapon", "class", "full"]);
    expect(tags(r)[0]).toHaveLength(3);
  });

  it("allows one spliced stat per target", () => {
    const r = read("病毒 腐蚀 多");
    expect(tags(r)).toEqual([[["WeaponViralDamageMod"], ["WeaponFireIterationsMod"]]]);
    expect(r.skipped).toEqual([{ tags: ["WeaponCorrosiveDamageMod"], why: "spliced" }]);
  });

  it("maps 基 to melee damage on a melee weapon", () => {
    const melee = weaponById("/Lotus/Weapons/Tenno/Melee/LongSword/LongSword");
    if (!melee) return;
    const r = readTarget("基 暴伤 打G", "Melee", poolFor(melee));
    expect(tags(r)).toEqual([[["WeaponMeleeDamageMod"], ["WeaponCritDamageMod"], ["WeaponMeleeFactionDamageGrineer"]]]);
  });

  it("reads English short forms with word boundaries", () => {
    const r = read("dmg ms fr; any neg");
    expect(tags(r)).toEqual([[["WeaponDamageAmountMod"], ["WeaponFireIterationsMod"], ["WeaponFireRateMod"]]]);
    expect(r.neg).toEqual({ kind: "any" });
    expect(tags(read("cc cd"))).toEqual([[["WeaponCritChanceMod"], ["WeaponCritDamageMod"]]]);
  });
});
