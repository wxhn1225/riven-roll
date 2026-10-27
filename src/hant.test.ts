import { describe, expect, it } from "vitest";
import { CLASSES, GAME, LANGS } from "./engine/data";
import { foldOcr, nameMatches, searchForm, toSimplified } from "./hant";

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

describe("繁中 written as 简中", () => {
  it("turns 繁中 into 简中 one character for one", () => {
    expect(toSimplified("雙暴 負任意 後座力")).toBe("双暴 负任意 后座力");
    expect(toSimplified("暴擊傷害")).toBe("暴击伤害");
    expect(toSimplified("多重射击 Multishot")).toBe("多重射击 Multishot");
    for (const w of GAME.weapons) expect(toSimplified(w.name.tc)).toHaveLength(w.name.tc.length);
  });

  it("puts right what the screenshot reader writes for 繁中 it has no glyph for", () => {
    // read off a 繁中 screen: 擊 came back as 撃 / 业, 絕 as 絶, 槍 as 檐
    expect(foldOcr("暴撃傷害")).toBe(foldOcr("暴擊傷害"));
    expect(foldOcr("多重射业")).toBe(foldOcr("多重射擊"));
    expect(foldOcr("絶路 Prime")).toBe(foldOcr("絕路 Prime"));
    expect(foldOcr("什長雙檐")).toBe(foldOcr("什長雙槍"));
  });

  it("finds a name typed in any language, in either Chinese script", () => {
    const rubico = GAME.weapons.find((w) => w.name.en === "Rubico Prime")?.name;
    if (!rubico) throw new Error("missing weapon");
    for (const typed of ["絕路", "绝路", "圣装绝路", "聖裝絕路", "rubico", "RUBICO PRIME"]) expect(nameMatches(rubico, searchForm(typed)), typed).toBe(true);
    expect(nameMatches(rubico, searchForm("墓悼者"))).toBe(false);
    const critDamage = GAME.classes.Rifle.stats.find((s) => s.tag === "WeaponCritDamageMod")?.name;
    if (!critDamage) throw new Error("missing stat");
    for (const typed of ["暴擊", "暴击", "暴擊傷害", "critical"]) expect(nameMatches(critDamage, searchForm(typed)), typed).toBe(true);
  });

  it("never makes two stats of one weapon class read the same", () => {
    for (const fold of [toSimplified, foldOcr])
      for (const cls of CLASSES) {
        const seen = new Map<string, string>();
        for (const s of GAME.classes[cls].stats)
          for (const l of LANGS) {
            const key = fold(squash(s.name[l]));
            expect(seen.get(key) ?? s.tag, `${cls}: ${s.name[l]}`).toBe(s.tag);
            seen.set(key, s.tag);
          }
      }
  });

  it("never makes two weapons read the same", () => {
    const seen = new Map<string, string>();
    for (const w of GAME.weapons)
      for (const l of LANGS) {
        const key = foldOcr(squash(w.name[l]));
        expect(seen.get(key) ?? w.id, w.name[l]).toBe(w.id);
        seen.set(key, w.id);
      }
  });
});
