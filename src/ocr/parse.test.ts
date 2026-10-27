import { describe, expect, it } from "vitest";
import { GAME } from "../engine/data";
import en_baza from "./fixtures/en_baza.json";
import en_drawn from "./fixtures/en_drawn_cycle.json";
import en_hirudo from "./fixtures/en_hirudo.json";
import en_torid from "./fixtures/en_torid.json";
import tc_drawn from "./fixtures/tc_drawn_cycle.json";
import v1_017 from "./fixtures/v1_017.json";
import v1_135 from "./fixtures/v1_135_compare.json";
import v1_345 from "./fixtures/v1_345_compare.json";
import v1_end from "./fixtures/v1_end.json";
import v2_1485 from "./fixtures/v2_1485.json";
import v3_105 from "./fixtures/v3_105_compare.json";
import v3_end from "./fixtures/v3_end.json";
import zh_okina from "./fixtures/zh_okina.json";
import { parseScreen } from "./parse";

const EPITAPH_PRIME = "/Lotus/Weapons/Tenno/Pistols/PrimeEpitaph/PrimeEpitaphSidearmWeapon";
const brief = (t: { tag: string; shown: number | null; curse: boolean }) => `${t.curse ? "-" : "+"}${t.tag.replace(/^Weapon|Mod$/g, "")}:${t.shown}`;

describe("parseScreen on 国服 screenshots", () => {
  it("reads a single card with weapon, MR, cycles, kuva and price", () => {
    const s = parseScreen(v1_017.items, v1_017.width);
    expect(s.lang).toBe("cn");
    expect(s.weaponId).toBe(EPITAPH_PRIME);
    expect(s.cards).toHaveLength(1);
    const c = s.cards[0];
    expect(c.traits.map(brief)).toEqual(["+FireIterations:144.5", "+FactionDamageGrineer:1.49", "+ToxinDamage:102.6", "-ClipMax:-47.1"]);
    expect(c.layout).toEqual({ pos: 3, neg: 1 });
    expect(c.mr).toBe(16);
    expect(c.cycles).toBe(160);
    expect(s.kuva).toBe(25167812);
    expect(s.cycleCost).toBe(3500);
  });

  it("reads decimal commas and dotted thousands, as some game settings write them", () => {
    const comma: Record<string, string> = {
      "+144.5%多重射击": "+144,5%多重射击",
      "x1.49对克隆尼的伤害": "x1,49对克隆尼的伤害",
      "+102.6% 毒素伤害": "+102,6% 毒素伤害",
      "-47.1%弹匣容量": "-47,1%弹匣容量",
      "用 3,500来循环": "用 3.500来循环",
      "剩余赤毒： 25,167,812": "剩余赤毒： 25.167.812",
      "999,999,999 1,878 25,167,812 3,242,268": "999.999.999 1.878 25.167.812 3.242.268",
    };
    const items = v1_017.items.map((i) => ({ ...i, text: comma[i.text] ?? i.text }));
    expect(items.filter((i) => i.text.includes(",")).map((i) => i.text)).toEqual(["+144,5%多重射击", "x1,49对克隆尼的伤害", "+102,6% 毒素伤害", "-47,1%弹匣容量"]);
    const s = parseScreen(items, v1_017.width);
    expect(s.cards[0].traits.map(brief)).toEqual(["+FireIterations:144.5", "+FactionDamageGrineer:1.49", "+ToxinDamage:102.6", "-ClipMax:-47.1"]);
    expect(s.kuva).toBe(25167812);
    expect(s.cycleCost).toBe(3500);
    const spaced = parseScreen(
      items.map((i) => ({ ...i, text: i.text.replace("25.167.812", "25 167 812").replace("3.500", "3 500") })),
      v1_017.width,
    );
    expect([spaced.kuva, spaced.cycleCost]).toEqual([25167812, 3500]);
  });

  it("reads a Chinese trait whose value comes after the name, with or without the lock icon", () => {
    for (const [text, locked] of [
      ["收起武器时弹匣每秒自动装填 +101.2 %", false],
      ["θ收起武器时弹匣每秒自动装填 +101.2 %", true],
    ] as const) {
      const items = v1_017.items.map((i) => (i.text === "+102.6% 毒素伤害" ? { ...i, text } : i));
      const traits = parseScreen(items, v1_017.width).cards[0].traits;
      expect(traits.map(brief), text).toEqual(["+FireIterations:144.5", "+FactionDamageGrineer:1.49", "+MagazineReloadHolstered:101.2", "-ClipMax:-47.1"]);
      expect(
        traits.map((t) => t.locked),
        text,
      ).toEqual([false, false, locked, false]);
    }
  });

  it("reads the whole kuva count when OCR drops a thousands mark", () => {
    for (const text of ["剩余赤毒： 25167,812", "剩余赤毒： 25,167812", "剩余赤毒： 25167812"]) {
      const items = v1_017.items.map((i) => (i.text.startsWith("剩余赤毒") ? { ...i, text } : i));
      expect(parseScreen(items, v1_017.width).kuva, text).toBe(25167812);
    }
    const bare = v1_017.items.map((i) => (i.text === "用 3,500来循环" ? { ...i, text: "用 3500来循环" } : i));
    expect(parseScreen(bare, v1_017.width).cycleCost).toBe(3500);
  });

  it("treats negative recoil as a buff and reads the lock icon", () => {
    const c = parseScreen(v1_135.items, v1_135.width).cards[0];
    expect(c.traits.map(brief)).toEqual(["+FireIterations:144.5", "+RecoilReduction:-94.8", "+ImpactDamage:144.7", "-StunChance:-86.7"]);
    expect(c.traits[0].locked).toBe(true);
    expect(c.cycles).toBe(163);
  });

  it("reads a spliced trait and the lock panel", () => {
    const s = parseScreen(v1_end.items, v1_end.width);
    const c = s.cards[0];
    expect(c.traits.map(brief)).toEqual(["+DamageAmount:262", "+ViralDamage:109.8", "+FireIterations:145.2", "-SlashDamage:-99.1"]);
    expect(c.traits[1].spliced).toBe(true);
    expect(s.lockedTags.sort()).toEqual(["WeaponFireIterationsMod", "WeaponViralDamageMod"]);
    expect(s.cycleCost).toBe(7000);
    expect(s.kuva).toBe(24660312);
  });

  it("reads another weapon with a spliced corrosive", () => {
    const s = parseScreen(v2_1485.items, v2_1485.width);
    expect(s.weaponId).toBe("/Lotus/Weapons/ClanTech/Bio/BioWeapon"); // 托里德 Torid, a rifle
    const c = s.cards[0];
    expect(c.traits.map(brief)).toEqual(["+CritDamage:148.1", "+CorrosiveDamage:110", "+FireIterations:105.1", "-ZoomFov:-57.4"]);
    expect(c.mr).toBe(12);
    expect(c.cycles).toBe(296);
  });

  it("splits the before/after comparison into two cards", () => {
    const s = parseScreen(v3_105.items, v3_105.width);
    expect(s.cards).toHaveLength(2);
    expect(s.cards[0].traits.map(brief)).toEqual(["+PunctureDepth:3.3", "+FactionDamageGrineer:1.5", "+ClipMax:51.4", "-CritChance:-129.3"]);
    expect(s.cards[1].traits.map(brief)).toEqual(["+ProjectileSpeed:94.8", "+FreezeDamage:109.7", "+ElectricityDamage:92", "-CritChance:-129.3"]);
  });

  it("finds the multishot card on another comparison frame", () => {
    const c = parseScreen(v1_345.items, v1_345.width).cards[0];
    expect(c.traits.map(brief)).toEqual(["+FireIterations:144.5", "+CritDamage:99.4", "+ProjectileSpeed:108.6", "-CritChance:-144.3"]);
  });

  it("does not invent values the chat window covers", () => {
    const s = parseScreen(v3_end.items, v3_end.width);
    const card = s.cards.find((c) => c.traits.some((t) => t.tag === "WeaponCritDamageMod"));
    expect(card).toBeDefined();
    expect(card?.layout).toBeNull();
  });
});

// en_drawn: OCR of a drawn English cycle screen in the game's wording;
// en_hirudo, en_torid, en_baza: OCR of players' English riven screenshots
describe("parseScreen on English screens", () => {
  const RUBICO_PRIME = "/Lotus/Weapons/Tenno/LongGuns/RubicoPrime/RubicoPrimeWeapon";
  const HIRUDO = "/Lotus/Weapons/Infested/Melee/InfWFAccompanyingSparring/InfestedKogake";
  const TORID = "/Lotus/Weapons/ClanTech/Bio/BioWeapon";
  const BAZA = "/Lotus/Weapons/Tenno/LongGuns/TnSMG/TnSMGWeapon";
  const swap = (map: Record<string, string>) => en_drawn.items.map((i) => ({ ...i, text: map[i.text] ?? i.text }));
  const stray = (text: string, x: number, y: number) => ({ text, box: { x, y, w: 22, h: 22 }, conf: 0.7 });

  it("reads the card, weapon, kuva and price in English", () => {
    const s = parseScreen(en_drawn.items, en_drawn.width);
    expect(s.lang).toBe("en");
    expect(s.weaponId).toBe(RUBICO_PRIME);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].traits.map(brief)).toEqual(["+CritDamage:143.4", "+ToxinDamage:103.4", "+ReloadSpeed:53.3", "-ZoomFov:-54.2"]);
    expect([s.cards[0].mr, s.cards[0].cycles, s.kuva, s.cycleCost]).toEqual([13, 24, 6420000, 3500]);
  });

  it("stays English when icons and sparkles read as stray Chinese characters", () => {
    // a four-point sparkle reads as 十; real screenshots have lone characters like these too (压, 固, 容)
    const items = [...en_drawn.items, stray("十", 353, 169), stray("十", 759, 419), stray("十", 1051, 527), stray("口十", 880, 600)];
    expect(parseScreen(items, en_drawn.width).lang).toBe("en");
  });

  it("reads the kuva and the price when OCR splits their words", () => {
    const s = parseScreen(swap({ "Remaining Kuva: 6,420,000": "Re maining Kuva: 6,420,000", "Cycle for 3,500": "Cy cle for 3,500" }), en_drawn.width);
    expect([s.kuva, s.cycleCost]).toEqual([6420000, 3500]);
    const apart = parseScreen(
      [...swap({ "Remaining Kuva: 6,420,000": "Remaining Kuva:" }), { text: "6,420,000", box: { x: 1060, y: 987, w: 110, h: 29 }, conf: 0.99 }],
      en_drawn.width,
    );
    expect(apart.kuva).toBe(6420000);
  });

  it("reads players' English screenshots, a stray 海 from the riven art included", () => {
    const hirudo = parseScreen(en_hirudo.items, en_hirudo.width);
    expect(en_hirudo.items.map((i) => i.text)).toContain("海");
    expect(hirudo.lang).toBe("en");
    expect(hirudo.weaponId).toBe(HIRUDO);
    expect(hirudo.cards[0].traits.map(brief)).toEqual(["+FireRate:66.4", "+MeleeRangeInc:2.4", "+CritDamage:108.9", "-ArmorPiercingDamage:-98"]);
    expect([hirudo.cards[0].mr, hirudo.cards[0].cycles]).toEqual([15, 49]);
    const torid = parseScreen(en_torid.items, en_torid.width);
    expect(torid.lang).toBe("en");
    expect(torid.weaponId).toBe(TORID);
    expect(torid.cards[0].traits.map(brief)).toEqual(["+CritDamage:137.6", "+CritChance:169.4", "+DamageAmount:187.5", "-FactionDamageCorpus:0.56"]);
    expect([torid.cards[0].mr, torid.cards[0].cycles, torid.cards[0].layout]).toEqual([12, 19, { pos: 3, neg: 1 }]);
  });

  it("joins a stat name the card wraps onto a second line, with the lock read in front of it", () => {
    // "θ +257.4% Weak Point" / "Damage"
    const baza = parseScreen(en_baza.items, en_baza.width);
    expect(baza.lang).toBe("en");
    expect(baza.weaponId).toBe(BAZA);
    const card = baza.cards[0];
    expect(card.traits.map(brief)).toEqual(["+CritChance:170.8", "+CritDamage:146.3", "+WeakpointDamage:257.4", "-RecoilReduction:89.1"]);
    expect(card.traits.map((t) => [t.spliced, t.locked])).toEqual([
      [false, false],
      [false, false],
      [true, true],
      [false, false],
    ]);
    expect([card.mr, card.cycles, card.layout]).toEqual([13, 23, { pos: 3, neg: 1 }]);
  });

  it("leaves a line under a trait alone when together they read no other stat", () => {
    const wrapped = en_baza.items.find((i) => i.text === "Damage");
    const s = parseScreen(
      en_baza.items.filter((i) => i !== wrapped).map((i) => (i.text === "θ +257.4% Weak Point" ? { ...i, text: "θ +257.4% Weak Point Damage" } : i)),
      en_baza.width,
    );
    // the footer right under the last trait stays the footer
    expect(s.cards[0].traits.map(brief).at(-1)).toBe("-RecoilReduction:89.1");
    expect([s.cards[0].mr, s.cards[0].cycles]).toEqual([13, 23]);
  });

  it("still tells 简中 from the same screen in Chinese", () => {
    const zh = swap({
      "Rubico Prime": "绝路 Prime",
      "+ 143.4 % Critical Damage": "+143.4% 暴击伤害",
      "+103.4 % Toxin": "+103.4% 毒素伤害",
      "+53.3% Reload Speed": "+53.3% 装填速度",
      "-54.2% Zoom": "-54.2% 变焦",
      "Remaining Kuva: 6,420,000": "剩余赤毒：6,420,000",
    });
    const s = parseScreen([...zh, stray("十", 353, 169)], en_drawn.width);
    expect(s.lang).toBe("zh");
    expect(s.cards[0].traits.map(brief)).toEqual(["+CritDamage:143.4", "+ToxinDamage:103.4", "+ReloadSpeed:53.3", "-ZoomFov:-54.2"]);
    expect(s.kuva).toBe(6420000);
  });
});

// tc_drawn: OCR of the same drawn cycle screen in the 繁中 client's wording; the reader has no glyph for 擊 or 絕 and
// wrote 撃 and 絶
describe("parseScreen on a 繁中 screen", () => {
  const RUBICO_PRIME = "/Lotus/Weapons/Tenno/LongGuns/RubicoPrime/RubicoPrimeWeapon";
  const swap = (map: Record<string, string>) => tc_drawn.items.map((i) => ({ ...i, text: map[i.text] ?? i.text }));

  it("reads the card, weapon, kuva and price, and says 繁中", () => {
    expect(tc_drawn.items.map((i) => i.text)).toContain("+143.4%暴撃傷害");
    const s = parseScreen(tc_drawn.items, tc_drawn.width);
    expect(s.lang).toBe("tc");
    expect(s.weaponId).toBe(RUBICO_PRIME);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].traits.map(brief)).toEqual(["+CritDamage:143.4", "+ToxinDamage:103.4", "+ReloadSpeed:53.3", "-ZoomFov:-54.2"]);
    expect([s.cards[0].mr, s.cards[0].cycles, s.kuva, s.cycleCost]).toEqual([13, 24, 6420000, 3500]);
  });

  it("reads 擊 whichever way the reader writes it, and 繁中 as written", () => {
    for (const crit of ["+143.4%暴擊傷害", "+143.4%暴业傷害", "+143.4%暴擘傷害"]) {
      const s = parseScreen(swap({ "+143.4%暴撃傷害": crit }), tc_drawn.width);
      expect(s.cards[0].traits.map(brief)[0], crit).toBe("+CritDamage:143.4");
      expect(s.lang).toBe("tc");
    }
    expect(parseScreen(swap({ "絶路 Prime": "絕路 Prime" }), tc_drawn.width).weaponId).toBe(RUBICO_PRIME);
  });

  it("reads the lock icon on a name written before its value, also when the name was read with a misread character", () => {
    // 收起武器時彈匣每秒自動裝填 is the one stat written name first; here the reader got 彈 as 弹
    const holstered = (text: string) => swap({ "+53.3%裝填速度": text });
    const line = (text: string) => parseScreen(holstered(text), tc_drawn.width).cards[0].traits.find((t) => t.tag === "WeaponMagazineReloadHolstered");
    expect(line("收起武器時彈匣每秒自動裝填 +101.2 %")?.locked).toBe(false);
    expect(line("收起武器時弹匣每秒自動裝填 +101.2 %")?.locked).toBe(false);
    expect(line("θ收起武器時弹匣每秒自動裝填 +101.2 %")?.locked).toBe(true);
  });

  // a card as the reader gives it, one line per box
  const card = (lines: string[]) => [
    ...lines.map((text, i) => ({ text, box: { x: 400, y: 40 + (i ? 30 + 30 * i : 0), w: 340, h: 24 }, conf: 1 })),
    { text: "104", box: { x: 700, y: 40 + 30 + 30 * (lines.length - 1), w: 45, h: 24 }, conf: 1 },
  ];
  const melee = (line: string) => card(["翁 Acricron", line, "+101.2% 暴擊傷害", "+101.2% 毒素傷害", "-90% 狀態持續時間", "精通段位 10"]);

  it("reads the two 繁中 melee stats that hold their number in the middle", () => {
    const slide = parseScreen(melee("滑行攻擊 +135% 暴擊機率"), 1000).cards[0].traits[0];
    expect([slide.tag, slide.shown, slide.spliced, slide.locked]).toEqual(["SlideAttackCritChanceMod", 135, false, false]);
    const heavy = parseScreen(melee("重擊時，+134.7% 近戰傷害"), 1000).cards[0].traits[0];
    expect([heavy.tag, heavy.shown, heavy.spliced, heavy.locked]).toEqual(["WeaponMeleeHeavyAttackDamageMod", 134.7, true, false]);
    // a lock icon in front is still the lock icon
    expect(parseScreen(melee("θ滑行攻擊 +135% 暴擊機率"), 1000).cards[0].traits[0].locked).toBe(true);
    expect(GAME.classes.Melee.stats.filter((s) => /%/.test(s.name.tc))).toEqual([]);
  });

  it("tells a 繁中 card cropped to the riven by what 繁中 writes differently", () => {
    // 射速 is written alike in both; 多重射擊, 拉托雙槍 and 精通段位 are 繁中
    const lato = parseScreen(card(["拉托雙槍 Acricron", "+142.2% 多重射擊", "+88.7% 射速", "精通段位 10"]), 1000);
    expect([lato.lang, lato.weaponId]).toEqual(["tc", "/Lotus/Weapons/Tenno/Akimbo/AkimboPistol"]);
    // a weapon both write alike: the footer still says 繁中
    expect(parseScreen(card(["翁 Acricron", "+142.2% 射速", "精通段位 10"]), 1000).lang).toBe("tc");
    // the same cards in 简中 stay 简中
    expect(parseScreen(card(["拉托双枪 Acricron", "+142.2% 多重射击", "+88.7% 射速", "段位 10"]), 1000).lang).toBe("zh");
    expect(parseScreen(card(["翁 Acricron", "+142.2% 射速", "段位 10"]), 1000).lang).toBe("zh");
  });

  it("does not take a 简中 screen with one stray 繁中-looking character for 繁中", () => {
    const zh = swap({
      "絶路 Prime": "绝路 Prime",
      "+143.4%暴撃傷害": "+143.4% 暴击伤害",
      "+103.4% 毒素傷害": "+103.4% 毒素伤害",
      "+53.3%裝填速度": "+53.3% 装填速度",
      "-54.2%變焦": "-54.2% 变焦",
      精通段位13: "段位 13",
      "以3,500 進行循環": "用 3,500 来循环",
      "剩餘赤毒：6,420,000": "剩余赤毒：6,420,000",
      適用於: "适用于",
      鎖定特性: "锁定属性",
      顯示已升級: "显示已升级",
      "軍械庫/裂镀MOD": "军械库 / 裂罅 Mod",
      裂辞拼接: "裂罅熔接",
      關朗: "关闭",
    });
    const s = parseScreen([...zh, { text: "傷", box: { x: 300, y: 300, w: 20, h: 20 }, conf: 0.6 }], tc_drawn.width);
    expect(s.lang).toBe("zh");
    expect(s.cards[0].traits.map(brief)).toEqual(["+CritDamage:143.4", "+ToxinDamage:103.4", "+ReloadSpeed:53.3", "-ZoomFov:-54.2"]);
    expect([s.weaponId, s.kuva, s.cycleCost]).toEqual([RUBICO_PRIME, 6420000, 3500]);
  });
});

describe("parseScreen on 简中 screenshots", () => {
  it("finds a weapon whose name is one Chinese character from a card cropped to the riven", () => {
    // 翁 is Okina; the picture has no 适用于 panel, so only the title names the weapon
    const s = parseScreen(zh_okina.items, zh_okina.width);
    expect(s.lang).toBe("zh");
    expect(s.weaponId).toBe("/Lotus/Weapons/Tenno/Melee/Swords/TennoSai/TennoSais");
    const c = s.cards[0];
    expect(c.traits.map(brief)).toEqual(["+FireRate:65.8", "+StatusDamage:106.4", "+MeleeRangeInc:2.2", "-ArmorPiercingDamage:-102.4"]);
    expect(c.traits.map((t) => [t.spliced, t.locked])).toEqual([
      [false, false],
      [true, true],
      [false, true],
      [false, false],
    ]);
    expect([c.mr, c.cycles, c.layout]).toEqual([10, 104, { pos: 3, neg: 1 }]);
  });
});
