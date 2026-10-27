import { describe, expect, it } from "vitest";
import { GAME, weaponById } from "./data";
import { poolFor } from "./pool";
import { Solver } from "./solver";

const SPEED = "WeaponProjectileSpeedMod";
const byName = (en: string) => {
  const w = GAME.weapons.find((x) => x.name.en === en);
  if (!w) throw new Error(`missing ${en}`);
  return w;
};

describe("which stats roll on a weapon", () => {
  it("follows the game data for projectile speed; one kept on an old riven stays but is not drawn again", () => {
    // the weapon has no PROJECTILE tag
    for (const name of ["Arca Plasmor", "Tenet Arca Plasmor"]) {
      expect(poolFor(byName(name)).pos, name).not.toContain(SPEED);
      const kept = poolFor(byName(name), { pos: [SPEED], neg: [SPEED] });
      expect([kept.pos.includes(SPEED), kept.neg.includes(SPEED)], name).toEqual([true, true]);
      expect([kept.keptPos, kept.keptNeg], name).toEqual([[SPEED], [SPEED]]);
    }
  });

  it("rolls impact, puncture and slash on every Zaw, a third of the damage each", () => {
    const zaws = GAME.weapons.filter((w) => w.cls === "Zaw");
    expect(zaws.length).toBeGreaterThan(0);
    for (const w of zaws) {
      const pool = poolFor(w);
      for (const tag of ["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"]) {
        expect(pool.pos, w.name.en).toContain(tag);
        expect(pool.neg, w.name.en).toContain(tag);
      }
    }
  });

  it("still does not roll on hitscan weapons", () => {
    for (const name of ["Soma", "Hek", "Lex"]) expect(poolFor(byName(name)).pos, name).not.toContain(SPEED);
  });
});

describe("stats kept from an old roll", () => {
  // the Grimoire no longer rolls magazine capacity; rivens that had it keep it
  const grimoire = GAME.weapons.find((w) => w.id === "/Lotus/Weapons/Tenno/Grimoire/TnGrimoire");
  if (!grimoire) throw new Error("missing Grimoire");
  const CLIP = "WeaponClipMaxMod";
  const card = { layout: { pos: 2, neg: 0 } as const, pos: [CLIP, "WeaponDamageAmountMod"].map((tag) => ({ tag, w: 1 })), neg: null, spliced: null };

  it("stay on the card but are not drawn again", () => {
    expect(poolFor(grimoire).pos).not.toContain(CLIP);
    const pool = poolFor(grimoire, { pos: [CLIP] });
    expect(pool.pos).toContain(CLIP);
    expect(pool.keptPos).toEqual([CLIP]);
    // a better magazine roll than the one on the card can never come back
    const high = new Solver(pool, { groups: [{ tags: [CLIP], minW: 1.07 }], layouts: [{ pos: 2, neg: 0 }], allowedNeg: [] }, "cycles");
    const id = high.solve(card).id;
    expect(high.value[id]).toBe(Number.POSITIVE_INFINITY);
    // the one on the card still counts, and can be locked while the other trait is cycled
    const keep = new Solver(
      pool,
      {
        groups: [
          { tags: [CLIP], minW: 0.9 },
          { tags: ["WeaponFireIterationsMod"], minW: 0.9 },
        ],
        layouts: [{ pos: 2, neg: 0 }],
        allowedNeg: [],
      },
      "cycles",
    );
    keep.solve(card);
    const best = keep.routes(card).find((r) => r.optimal);
    expect(best?.action.kind === "cycle" && typeof best.action.lock === "object" && best.action.lock.tag).toBe(CLIP);
  });
});

describe("a spliced trait already on the riven", () => {
  it("keeps counting for the target after it used up an ingredient that cannot come back", () => {
    // Burst Laser (a companion weapon) no longer rolls ammo maximum; an old one spliced with reload speed made
    // "magazine reloaded when holstered", and the target is that stat
    const burst = byName("Burst Laser");
    const HOLSTER = "WeaponMagazineReloadHolstered";
    expect(poolFor(burst).pos).not.toContain("WeaponAmmoMaxMod");
    const pool = poolFor(burst, { pos: [HOLSTER, "WeaponCritDamageMod", "WeaponDamageAmountMod"] });
    expect(pool.spliced).toContain(HOLSTER);
    // no recipe for it is left, so nothing can splice it again
    expect(pool.splices.some((r) => r.result === HOLSTER)).toBe(false);
    const s = new Solver(pool, { groups: [{ tags: [HOLSTER], minW: 0.9 }], layouts: [{ pos: 3, neg: 0 }], allowedNeg: [] }, "cycles");
    const card = {
      layout: { pos: 3, neg: 0 } as const,
      pos: ["WeaponCritDamageMod", "WeaponDamageAmountMod"].map((tag) => ({ tag, w: 1 })),
      neg: null,
      spliced: { tag: HOLSTER, w: 1.001 },
    };
    expect(s.isGoal(s.solve(card))).toBe(true);
  });
});

describe("impact, puncture and slash", () => {
  const [IMPACT, PUNCTURE, SLASH] = ["WeaponImpactDamageMod", "WeaponArmorPiercingDamageMod", "WeaponSlashDamageMod"];
  /** the physical stats a weapon's riven rolls as a positive and as a negative, as letters: "IPS", "P", "" */
  const physical = (name: string) => {
    const { pos, neg } = poolFor(byName(name));
    return [IMPACT, PUNCTURE, SLASH].map((tag, i) => (pos.includes(tag) && neg.includes(tag) ? "IPS"[i] : "")).join("");
  };

  it("follow the damage type of an attack that has one", () => {
    for (const [name, rolls] of [
      ["Penta", "I"],
      ["Zarr", "I"],
      ["Kuva Bramma", "I"],
      ["Tonkor", "P"],
      ["Aksondol", "P"],
      ["Ogris", ""],
    ])
      expect(physical(name), name).toBe(rolls);
  });

  it("take each type of a physical attack whose share is more than half the largest", () => {
    for (const [name, rolls] of [
      // 45/25/30
      ["Brakk", "IPS"],
      // 45/30/25
      ["Karak", "IPS"],
      // 15/65/20
      ["Hek", "P"],
      // 55/15/30
      ["Strun", "IS"],
      // 25/50/25: exactly half does not count
      ["Tiberon", "P"],
    ])
      expect(physical(name), name).toBe(rolls);
  });

  it("take all three for an attack in the new damage format, whatever its damage", () => {
    for (const name of ["Larkspur", "Keratinos", "Galariak Prime"]) expect(physical(name), name).toBe("IPS");
  });

  it("use the charged projectile when the first mode has no other", () => {
    expect(physical("Proboscis Cernos")).toBe("IS");
  });

  it("use the first projectile of a projectile sequence", () => {
    // Arbucep's sequence is all elemental
    expect(physical("Arbucep")).toBe("");
    // impact, then puncture, then slash
    for (const name of ["Deconstructor", "Deconstructor Prime"]) expect(physical(name), name).toBe("I");
  });

  it("roll on every kitgun, all three like a Zaw", () => {
    for (const w of GAME.weapons.filter((x) => x.cls === "Kitgun")) expect(physical(w.name.en), w.name.en).toBe("IPS");
  });

  it("follow the weapon a variant derives from, since the riven belongs to the family", () => {
    // Strun Wraith's own attack has slash at 20%, Strun's at 30%
    expect(physical("Strun Wraith")).toBe(physical("Strun"));
    // Kuva Ogris has physical damage of its own, but Ogris has none
    expect(physical("Kuva Ogris")).toBe("");
    for (const name of ["Karak Wraith", "Kuva Karak"]) expect(physical(name), name).toBe(physical("Karak"));
    expect(physical("Tiberon Prime")).toBe("P");
  });

  it("use the player's weapon when one is exported twice under one name", () => {
    expect(GAME.weapons.filter((w) => w.name.en === "Azothane")).toHaveLength(1);
    const shell = "/Lotus/Weapons/Tenno/Melee/Swords/DaxDuviriTwoHandedKatana/DaxDuviriTwoHandedKatanaPlayerWeapon";
    expect(weaponById(shell)?.id).toBe("/Lotus/Weapons/Tenno/Melee/Swords/DaxDuviriTwoHandedKatana/DaxDuviriTwoHandedKatanaWeapon");
    expect(poolFor(byName("Azothane")).pos).toContain(SLASH);
  });
});
