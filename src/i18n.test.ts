import { describe, expect, it } from "vitest";
import { LANGS } from "./engine/data";
import { fmtKuva, LANG_LABEL, strings } from "./i18n";

/** the outline of a string table: its keys, and for each leaf whether it is text or a function of how many arguments */
const outline = (x: unknown): unknown => {
  if (typeof x === "function") return `fn/${x.length}`;
  if (Array.isArray(x)) return x.map(outline);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, outline(v)]));
  return typeof x;
};

const leaves = (x: unknown): string[] => (typeof x === "string" ? [x] : Array.isArray(x) ? x.flatMap(leaves) : x && typeof x === "object" ? Object.values(x).flatMap(leaves) : []);

// 简中 characters whose 繁中 form differs: one of them in 繁中 text is a word left unconverted
const SIMPLIFIED_ONLY =
  /[伤击发异几机时间续冻热电备弹药飞装换镜变对体点头动枪状态气蚀辐罗炽军连围处额获双负随无谓带没数档达条组种选设际总这个与为从会还实现计战属择队环锁适级类项样标区边压扩张护响录剑镰残归验说开关贴识别载请网图复损]/;

describe("UI text", () => {
  it("has every string in every language", () => {
    const zh = outline(strings("zh"));
    for (const l of LANGS) expect(outline(strings(l)), l).toEqual(zh);
  });

  it("writes 繁中 in Traditional characters", () => {
    for (const text of leaves(strings("tc"))) expect(text).not.toMatch(SIMPLIFIED_ONLY);
    expect(LANG_LABEL.tc).toBe("繁體中文");
  });

  it("punctuates the typed-target hints the way each language does", () => {
    const en = strings("en").target.quick;
    expect(`${en.unknown}${en.colon}${["aa", "bb"].join(en.list)}${en.note("x")}`).toBe("Not understood: aa, bb (x)");
    const zh = strings("zh").target.quick;
    expect(`${zh.unknown}${zh.colon}${["啊", "哦"].join(zh.list)}${zh.note("x")}`).toBe("没认出：啊、哦（x）");
  });

  it("counts Kuva in 萬 for 繁中 and 万 for 简中", () => {
    expect(fmtKuva(1_740_000, "tc")).toBe("174 萬");
    expect(fmtKuva(1_740_000, "zh")).toBe("174 万");
    expect(fmtKuva(1_740_000, "en")).toBe("1.74M");
  });
});
