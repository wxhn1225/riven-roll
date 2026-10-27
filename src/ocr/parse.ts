// Turns OCR text boxes from a game screenshot into riven cards.
import { CLASSES, GAME, LANGS, type Lang } from "../engine/data";
import type { Layout } from "../engine/formula";
import { foldOcr } from "../hant";

export interface OcrItem {
  text: string;
  box: { x: number; y: number; w: number; h: number };
  conf: number;
}

export interface ParsedTrait {
  tag: string;
  /** number as shown: 144.5 for "+144.5%", 1.49 for "x1.49"; null when unreadable */
  shown: number | null;
  curse: boolean;
  spliced: boolean;
  /** a lock icon was read in front of the value */
  locked: boolean;
  raw: string;
}

export interface ParsedCard {
  x: number;
  /** bounds of the card's text, title to mastery line, in image pixels */
  box: { x: number; y: number; w: number; h: number };
  title: string;
  traits: ParsedTrait[];
  mr: number | null;
  cycles: number | null;
  layout: Layout | null;
}

export interface ParsedScreen {
  lang: Lang | null;
  weaponId: string | null;
  cards: ParsedCard[];
  kuva: number | null;
  cycleCost: number | null;
  /** traits listed in the lock panel on the left of the cycle screen */
  lockedTags: string[];
}

// ---------- dictionaries ----------

interface NameEntry {
  name: string;
  /** the name with 繁中 written as 简中, for a line whose 繁中 character the reader got in another form */
  folded: string;
  tag: string;
  lang: Lang;
  /** every language that writes a name just this way (射速 is 简中, 国服 and 繁中 alike): which clients reading it fits */
  langs: Lang[];
}

const stripParen = (s: string) => s.replace(/[（(].*$/, "").trim();
/** a name or a line as compared: no spaces, lower case, and one comma (lines are read with "，" made ","; 重擊時，近戰傷害) */
const squash = (s: string) => s.replace(/\s+/g, "").replace(/，/g, ",").toLowerCase();

/** Gives each name the languages that write it that way, longest names first. */
function byLength<T extends { name: string; lang: Lang }>(entries: T[]): (T & { langs: Lang[] })[] {
  const langs = new Map<string, Set<Lang>>();
  for (const e of entries) langs.set(e.name, (langs.get(e.name) ?? new Set()).add(e.lang));
  return entries.map((e) => ({ ...e, langs: [...(langs.get(e.name) as Set<Lang>)] })).sort((a, b) => b.name.length - a.name.length);
}

const statNames: NameEntry[] = (() => {
  const seen = new Set<string>();
  const out: Omit<NameEntry, "langs">[] = [];
  for (const cls of CLASSES)
    for (const s of GAME.classes[cls].stats)
      for (const lang of LANGS)
        for (const n of [s.name[lang], stripParen(s.name[lang])]) {
          const key = `${squash(n)}|${s.tag}|${lang}`;
          if (n && !seen.has(key)) {
            seen.add(key);
            out.push({ name: squash(n), folded: foldOcr(squash(n)), tag: s.tag, lang });
          }
        }
  return byLength(out);
})();

const statDefByTag = new Map(CLASSES.flatMap((c) => GAME.classes[c].stats.map((s) => [s.tag, s] as const)));

const weaponNames = byLength(GAME.weapons.flatMap((w) => LANGS.map((lang) => ({ name: squash(w.name[lang]), folded: foldOcr(squash(w.name[lang])), id: w.id, lang }))));

function matchStat(text: string): NameEntry | null {
  const t = squash(text);
  const exact = statNames.find((e) => t.includes(e.name));
  // the reader has no 擊 and gives it in another form: compare with 繁中 written as 简中, its misreads put right. The
  // longer name wins: 「暴撃傷害」 holds 「傷害」 as written, but it is 「暴擊傷害」
  const f = foldOcr(t);
  const folded = statNames.find((e) => f.includes(e.folded));
  return folded && folded.folded.length > (exact?.name.length ?? 0) ? folded : (exact ?? null);
}

// ---------- helpers ----------

const normalize = (s: string) => s.replace(/[−–—]/g, "-").replace(/[＋]/g, "+").replace(/[×Ｘ]/g, "x").replace(/[％]/g, "%").replace(/[．]/g, ".").replace(/[，]/g, ",");

// Some game settings write decimals with a comma (+104,5%, x1,49). A trait value never reaches the thousands, so a
// comma with one or two digits after it is always the decimal point there.
const VALUE = /([+\-x])\s*(\d+(?:\.\d+|,\d{1,2}(?!\d))?)\s*(%?)/i;
/** a word as OCR may read it, with spaces inside ("Re maining Kuva", "剩 余赤毒") */
const spaced = (word: string) => [...word].join("\\s*");
const KUVA_LABEL = new RegExp(`${spaced("剩余赤毒")}|${spaced("剩餘赤毒")}|${spaced("remainingkuva")}`, "i");
// 用 3,500 来循环 / 以 3,500 進行循環 / Cycle for 3,500
const CYCLE_FOR = new RegExp(`用\\s*\\d(?:[.,\\s]?\\d)*\\s*来循环|以\\s*\\d(?:[.,\\s]?\\d)*\\s*(?:進行循環|进行循环)|${spaced("cycle")}.*?\\d(?:[.,\\s]?\\d){2,}`, "i");
/** a count with any thousands mark (25,167,812 / 25.167.812 / 25 167 812), read whole even when OCR drops a mark */
const COUNT = /\d(?:[\d,.']|\s(?=\d{3})){2,}/;
const cx = (i: OcrItem) => i.box.x + i.box.w / 2;
const cy = (i: OcrItem) => i.box.y + i.box.h / 2;
const toInt = (s: string) => Number(s.replace(/[^\d]/g, ""));

/**
 * A trait line, and the languages that write its stat name the way it was read (null when it was read only with
 * 繁中 folded, which says nothing about the client).
 */
function readTrait(item: OcrItem): { trait: ParsedTrait; langs: Lang[] | null; stat: NameEntry } | null {
  const text = normalize(item.text);
  const m = VALUE.exec(text);
  const before = m ? text.slice(0, m.index) : "";
  const rest = m ? text.slice(m.index + m[0].length) : text;
  // the name follows the value, except where Chinese writes it first ("收起武器时弹匣每秒自动装填 +101.2 %") and two
  // 繁中 melee names that hold it in the middle ("滑行攻擊 +135% 暴擊機率"). The line without its number is searched too,
  // and the longer name wins: 「暴擊機率」 after the number is part of 「滑行攻擊 暴擊機率」 around it
  const after = matchStat(rest);
  const whole = m ? matchStat(before + rest) : null;
  const stat = whole && whole.name.length > (after?.name.length ?? 0) ? whole : (after ?? whole);
  if (!stat) return null;
  const def = statDefByTag.get(stat.tag);
  if (!def) return null;
  let shown: number | null = null;
  let curse = false;
  if (m) {
    const n = Number(m[2].replace(",", "."));
    if (m[1].toLowerCase() === "x") {
      shown = n;
      curse = n < 1;
    } else {
      shown = m[1] === "-" ? -n : n;
      // smaller-is-better stats (recoil) show a buff as a negative number
      curse = def.smaller ? shown > 0 : shown < 0;
    }
  }
  // anything read in front of the name is the lock icon: in front of the number when the name follows it, else in
  // front of where the name starts, found as read or in the form it was matched in (folded, when the reader got one of
  // its 繁中 characters in another form)
  const joined = squash(before + rest);
  const at = joined.indexOf(stat.name);
  const lead = stat === after ? before : joined.slice(0, at >= 0 ? at : Math.max(0, foldOcr(joined).indexOf(stat.folded)));
  const locked = m != null && /[^\s]/.test(lead);
  return { trait: { tag: stat.tag, shown, curse, spliced: def.spliced, locked, raw: item.text }, langs: at >= 0 ? stat.langs : null, stat };
}

const parseTrait = (item: OcrItem): ParsedTrait | null => readTrait(item)?.trait ?? null;

const valued = (i: OcrItem) => VALUE.test(normalize(i.text));

/**
 * Two lines of one card, one right under the other and only one with a value, as a single trait line: a long name that
 * wraps ("θ +257.4% Weak Point" / "Damage"), or a Chinese name whose value, written after it, goes to the next line.
 * Only when the name runs across both lines, or the value line holds nothing but the value (and the lock): a line that
 * reads a whole stat of its own is a trait whose value was missed, not the rest of the line above.
 */
function joinLines(upper: OcrItem, lower: OcrItem): OcrItem | null {
  const [u, l] = [upper.box, lower.box];
  const overlap = Math.min(u.x + u.w, l.x + l.w) - Math.max(u.x, l.x);
  if (valued(upper) === valued(lower) || l.y <= u.y || l.y - (u.y + u.h) >= Math.min(u.h, l.h) || overlap <= Math.min(u.w, l.w) / 2) return null;
  const x = Math.min(u.x, l.x);
  const both = { ...upper, text: `${upper.text} ${lower.text}`, box: { x, y: u.y, w: Math.max(u.x + u.w, l.x + l.w) - x, h: l.y + l.h - u.y } };
  const read = readTrait(both);
  if (read?.trait.shown == null) return null;
  // the name is looked for with the value taken out, as readTrait does: two 繁中 names hold it in the middle (滑行攻擊 +135% 暴擊機率)
  const [top, bottom] = [upper, lower].map((i) => squash(normalize(i.text).replace(VALUE, "")));
  const line = top + bottom;
  const found = line.indexOf(read.stat.name);
  const [at, length] = found >= 0 ? [found, read.stat.name.length] : [foldOcr(line).indexOf(read.stat.folded), read.stat.folded.length];
  const bare = (valued(upper) ? top : bottom).length <= 1;
  return bare || (at >= 0 && at < top.length && at + length > top.length) ? both : null;
}

/** Trait lines put back together where they wrap; a line that could go with more than one other is left as read. */
function joinWrapped(items: OcrItem[]): OcrItem[] {
  const pairs: { upper: OcrItem; lower: OcrItem; both: OcrItem }[] = [];
  for (const upper of items)
    for (const lower of items) {
      const both = upper !== lower && joinLines(upper, lower);
      if (both) pairs.push({ upper, lower, both });
    }
  const uses = new Map<OcrItem, number>();
  for (const { upper, lower } of pairs) for (const i of [upper, lower]) uses.set(i, (uses.get(i) ?? 0) + 1);
  const joined = new Map<OcrItem, OcrItem>();
  const taken = new Set<OcrItem>();
  for (const { upper, lower, both } of pairs)
    if (uses.get(upper) === 1 && uses.get(lower) === 1) {
      joined.set(upper, both);
      taken.add(lower);
    }
  return items.filter((i) => !taken.has(i)).map((i) => joined.get(i) ?? i);
}

const HAN = /[一-鿿]/;
/** Two texts of one length that differ in exactly one place, a Chinese character in both. */
function oneHanOff(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let off = -1;
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) {
      if (off >= 0) return false;
      off = i;
    }
  return off >= 0 && HAN.test(a[off]) && HAN.test(b[off]);
}

/** OCR reads icons and sparkles as a lone Chinese character (十, 压): Chinese text has two or more in a box */
const chinese = (s: string) => (s.match(/[一-鿿]/g) ?? []).length >= 2;
/** characters a 繁中 cycle screen is full of (傷害, 暴擊, 剩餘, 適用於, 循環, 鎖定) and a 简中 one never shows */
const HANT = /[傷擊撃機餘適於環鎖彈裝後對點觸發變凍電衝屬顯級]/g;

/**
 * lines: for each trait line, the languages that write its stat name the way it was read (null: read only with 繁中
 * folded). marks: the same for other text read as written, the weapon's name and the card footer.
 */
function detectLang(items: OcrItem[], titles: string[], lines: (Lang[] | null)[], marks: Lang[][]): Lang | null {
  // the stat names say it first: an English client writes them in English, whatever stray marks are read around them
  if (lines.length && lines.filter((v) => v?.includes("en")).length * 2 > lines.length) return "en";
  const all = items.map((i) => i.text).join(" ");
  const anyChinese = items.some((i) => chinese(i.text));
  // 繁中 before 简中, whose riven and faction names it shares (裂罅, Grineer). Only what the two write differently tells
  // them apart (射速 is both; 多重射擊, 拉托雙槍 and 精通段位 are 繁中), and one misread character is not enough
  const votes = [...lines, ...marks].filter((v): v is Lang[] => v != null);
  const hant = votes.filter((v) => v.every((l) => l === "tc")).length;
  const hans = votes.filter((v) => v.every((l) => l === "zh" || l === "cn")).length;
  if (hant > hans || (all.match(HANT) ?? []).length >= 3) return "tc";
  if (/裂隙振幅晶体|振幅晶体|克隆尼|科普斯|异变感染体/.test(all)) return "cn";
  if (/裂罅|Grineer|Corpus|Infested/.test(all) && anyChinese) return "zh";
  // 国服 riven names use Chinese parts (分裂, 寒潮); 简中 keeps Latin (sati, geli)
  for (const t of titles) {
    if (/[一-鿿].*[-·].*[一-鿿]/.test(t)) return "cn";
    if (/[一-鿿]/.test(t) && /[a-z]{3,}/i.test(t)) return "zh";
  }
  if (anyChinese) return "zh";
  return /[a-z]/i.test(all) ? "en" : null;
}

// ---------- main ----------

export function parseScreen(items: OcrItem[], width: number): ParsedScreen {
  const traitItems = joinWrapped(items).flatMap((item) => {
    const read = readTrait(item);
    return read ? [{ item, ...read }] : [];
  });
  // what other text read as written says about the client: the weapon's name, 精通段位 on a 繁中 card's footer
  const marks: Lang[][] = [];

  // cluster trait lines into columns (cards, or the lock panel at the far left)
  const sorted = [...traitItems].sort((a, b) => cx(a.item) - cx(b.item));
  const columns: (typeof sorted)[] = [];
  for (const t of sorted) {
    const last = columns[columns.length - 1];
    if (last && cx(t.item) - cx(last[last.length - 1].item) < width * 0.08) last.push(t);
    else columns.push([t]);
  }

  const lockedTags: string[] = [];
  const cards: ParsedCard[] = [];
  const titles: string[] = [];
  for (const col of columns) {
    const xMid = col.reduce((a, t) => a + cx(t.item), 0) / col.length;
    if (xMid < width * 0.15) {
      for (const t of col) lockedTags.push(t.trait.tag);
      continue;
    }
    col.sort((a, b) => a.item.box.y - b.item.box.y);
    const left = Math.min(...col.map((t) => t.item.box.x)) - width * 0.03;
    const right = Math.max(...col.map((t) => t.item.box.x + t.item.box.w)) + width * 0.03;
    const top = col[0].item.box.y;
    const bottom = col[col.length - 1].item.box.y + col[col.length - 1].item.box.h;
    // one line's height: a trait joined from two lines is twice as tall
    const lineH = Math.min(...col.map((t) => t.item.box.h)) || 20;
    const inColumn = (i: OcrItem) => cx(i) > left && cx(i) < right;

    const titleItems = items.filter((i) => inColumn(i) && i.box.y < top && i.box.y > top - lineH * 3.5 && !parseTrait(i)).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const title = titleItems.map((i) => i.text.trim()).join("");
    titles.push(title);

    let mr: number | null = null;
    let cycles: number | null = null;
    const mrItem = items.find((i) => inColumn(i) && i.box.y >= bottom - 4 && i.box.y < bottom + lineH * 3 && /段位|MR/i.test(i.text));
    if (mrItem) {
      const m = /(?:段位|MR)\s*(\d{1,2})/i.exec(mrItem.text);
      if (m) mr = Number(m[1]);
      const tail = items
        .filter((i) => i !== mrItem && Math.abs(cy(i) - cy(mrItem)) < lineH && i.box.x > mrItem.box.x && i.box.x < right + width * 0.02 && /\d/.test(i.text))
        .sort((a, b) => a.box.x - b.box.x)[0];
      if (tail) cycles = toInt(tail.text.replace(/^0+(?=\d)/, ""));
      // 简中 and 国服 cards say 段位, a 繁中 card 精通段位
      if (/精通段位/.test(mrItem.text)) marks.push(["tc"]);
    }

    const traits = col.map((t) => t.trait);
    const counted = traits.filter((t) => t.shown != null);
    const pos = counted.filter((t) => !t.curse).length;
    const neg = counted.filter((t) => t.curse).length;
    const layout = (pos === 2 || pos === 3) && (neg === 0 || neg === 1) && counted.length === traits.length ? ({ pos, neg } as Layout) : null;
    const boxTop = titleItems.length ? titleItems[0].box.y : top;
    const boxBottom = mrItem ? mrItem.box.y + mrItem.box.h : bottom;
    cards.push({ x: xMid, box: { x: left, y: boxTop, w: right - left, h: boxBottom - boxTop }, title, traits, mr, cycles, layout });
  }

  // weapon: an exact weapon name on screen ("适用于" panel), else the start of a riven title; read as written first,
  // then with 繁中 folded (the reader writes 絕路 as 絶路, 雙槍 as 雙檐)
  let weaponId: string | null = null;
  for (const [key, form] of [
    ["name", squash],
    ["folded", (x: string) => foldOcr(squash(x))],
  ] as const) {
    // a name read as written also says which clients write it that way
    const found = (hit: (typeof weaponNames)[number]) => {
      weaponId = hit.id;
      if (key === "name") marks.push(hit.langs);
    };
    for (const i of items) {
      const t = form(i.text);
      const hit = weaponNames.find((w) => w[key] === t);
      if (hit) {
        found(hit);
        break;
      }
    }
    // one Latin letter is too little to start a title with, but one Chinese character can be a whole name (翁 is Okina in 简中)
    if (!weaponId)
      for (const title of titles) {
        const t = form(title);
        const hit = weaponNames.find((w) => (w[key].length >= 2 || /[一-鿿]/.test(w[key])) && t.startsWith(w[key]));
        if (hit) {
          found(hit);
          break;
        }
      }
    if (weaponId) break;
  }
  // a rare character the reader has no glyph for comes out as another (天薙刀 as 天雍刀): a title that starts with a Chinese
  // name of three or more characters but for one of them names that weapon, when no other weapon is that close
  if (!weaponId)
    for (const title of titles) {
      const t = foldOcr(squash(title));
      const near = new Set(weaponNames.filter((w) => w.folded.length >= 3 && oneHanOff(t.slice(0, w.folded.length), w.folded)).map((w) => w.id));
      if (near.size === 1) {
        weaponId = [...near][0];
        break;
      }
    }

  let kuva: number | null = null;
  const kuvaItem = items.find((i) => KUVA_LABEL.test(i.text));
  if (kuvaItem) {
    const own = COUNT.exec(kuvaItem.text.replace(KUVA_LABEL, ""));
    const next = items.filter((i) => i !== kuvaItem && Math.abs(cy(i) - cy(kuvaItem)) < 20 && i.box.x >= kuvaItem.box.x).sort((a, b) => a.box.x - b.box.x)[0];
    const src = own?.[0] ?? (next ? COUNT.exec(next.text)?.[0] : undefined);
    if (src) kuva = toInt(src);
  }

  let cycleCost: number | null = null;
  const costItem = items.find((i) => CYCLE_FOR.test(normalize(i.text)));
  if (costItem) cycleCost = toInt(COUNT.exec(costItem.text)?.[0] ?? "") || null;

  return {
    lang: detectLang(
      items,
      titles,
      traitItems.map((t) => t.langs),
      marks,
    ),
    weaponId,
    cards,
    kuva,
    cycleCost,
    lockedTags,
  };
}
