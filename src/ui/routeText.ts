import { type Lang, type RivenClass, statOf } from "../engine/data";
import { currentDisposition, displayNumber, formatDisplay, type Layout, qualityFromDisplay, rawValue, W_MAX, W_MIN } from "../engine/formula";
import type { Route } from "../engine/solver";
import type { Strings } from "../i18n";
import { type CardDraft, statName } from "../state";

export function routeKey(r: Route) {
  return JSON.stringify(r.action);
}

function safeName(cls: RivenClass, tag: string, lang: Lang) {
  try {
    return statName(cls, tag, lang);
  } catch {
    return tag;
  }
}

/** The spliced trait on the card, if it has one. */
export function splicedOn(card: CardDraft, cls: RivenClass): string | null {
  for (const t of card.pos)
    try {
      if (t.tag && statOf(cls, t.tag).spliced) return t.tag;
    } catch {
      // a stat from another class: not on this riven
    }
  return null;
}

export function routeTitle(r: Route, cls: RivenClass, card: CardDraft, lang: Lang, s: Strings): string {
  const a = r.action;
  if (a.kind === "splice") return s.routes.splice(safeName(cls, a.a, lang), safeName(cls, a.b, lang), safeName(cls, a.result, lang));
  const sp = splicedOn(card, cls);
  const spName = sp ? safeName(cls, sp, lang) : "";
  const lockText =
    a.lock === "none" ? null : a.lock === "neg" ? s.routes.lockNeg(card.neg ? safeName(cls, card.neg.tag, lang) : "") : s.routes.lock(safeName(cls, a.lock.tag, lang));
  if (a.drop) return lockText ? s.routes.dropAnd(spName, lockText) : s.routes.drop(spName);
  if (!lockText) return sp ? s.routes.keepSpliced(spName) : s.routes.none;
  return lockText;
}

/** Name of the trait the route locks, for the in-game step. */
export function lockedName(r: Route, cls: RivenClass, card: CardDraft, lang: Lang): string | null {
  const a = r.action;
  if (a.kind !== "cycle" || a.lock === "none") return null;
  if (a.lock === "neg") return card.neg ? `−${safeName(cls, card.neg.tag, lang)}` : null;
  return safeName(cls, a.lock.tag, lang);
}

export interface KeepStat {
  tag: string;
  /** " ≥ +134.6%": the smallest number the game can show that the planner reads as reaching the bar; "" for any roll */
  bar: string;
  /** the riven's negative must be this stat */
  neg: boolean;
}

export interface KeepPart {
  /** any `count` different stats of these */
  stats: KeepStat[];
  count: number;
  /** the roll bar the shown `bar` stands for */
  minW: number;
}

export interface KeepChip {
  key: string;
  /** stats the new riven must show; empty when the gain is only in its layout or negative */
  parts: KeepPart[];
  /** the layout this kind of result has, when results differ in layout */
  layout: string | null;
  /** this kind of result needs its negative to be an accepted one, when results differ in that */
  negOk: boolean;
}

export interface KeepWhen {
  /** each entry is one kind of result worth keeping, likeliest first */
  chips: KeepChip[];
  /**
   * some results worth keeping could not be told apart from worse ones by the stats they show (a stat that counts
   * for nothing can still block a later negative): those are left to the screenshot comparison
   */
  partial: boolean;
  /** shared by every result: the negative must be accepted */
  negOk: boolean;
  /** shared by every result and not already fixed by a lock: the layout */
  layout: string | null;
}

const layoutText = (l: Layout) => `${l.pos}+${l.neg}`;

/**
 * The bar as the number the game shows, decided the way the planner reads a card (the middle of the roll interval).
 * A negative's bar is its size: " ≥ 54.2%" for -54.2% or more.
 */
export function displayBar(cls: RivenClass, tag: string, layout: Layout, minW: number, curse = false): string {
  if (!(minW > W_MIN) || minW > W_MAX) return "";
  let def: ReturnType<typeof statOf>;
  try {
    def = statOf(cls, tag);
  } catch {
    return "";
  }
  const at = (w: number) => displayNumber(def, rawValue(def, layout, curse, w));
  const up = at(W_MAX) > at(W_MIN);
  let shown = at(minW);
  for (let i = 0; i < 3; i++) {
    const q = qualityFromDisplay(def, layout, curse, shown);
    if (q.valid && q.w >= minW) break;
    shown = Number((shown + (up ? 1 : -1) * def.roundTo).toFixed(6));
  }
  if (curse && def.fmt !== "mult") return ` ≥ ${formatDisplay(def, Math.abs(shown)).replace("+", "")}`;
  return ` ${up ? "≥" : "≤"} ${formatDisplay(def, shown)}`;
}

/**
 * What a cycle has to show for the new riven to be the better one, likeliest first. Results are only
 * merged when they ask for the same layout and the same kind of negative, so following the hint never
 * keeps a worse card or misses a better one.
 */
// a route's rule is worked out once: a target of many rows can give a route thousands of results, and the list is
// drawn again on every change of the page
const keepCache = new WeakMap<Route, Map<string, KeepWhen | null>>();

export function keepWhen(r: Route, cls: RivenClass, layoutFixed: boolean): KeepWhen | null {
  // the shown bars depend on the disposition too
  const key = `${cls}|${layoutFixed}|${currentDisposition()}`;
  let byKey = keepCache.get(r);
  if (!byKey) {
    byKey = new Map();
    keepCache.set(r, byKey);
  }
  if (!byKey.has(key)) byKey.set(key, workOutKeep(r, cls, layoutFixed));
  return byKey.get(key) ?? null;
}

function workOutKeep(r: Route, cls: RivenClass, layoutFixed: boolean): KeepWhen | null {
  if (r.action.kind === "splice" || !r.outcomes.length) return null;
  const worse = r.worse ?? [];
  const outcomes = r.outcomes;
  const first = outcomes[0];
  const sameLayout = outcomes.every((o) => o.layout.pos === first.layout.pos && o.layout.neg === first.layout.neg);
  const sameNeg = outcomes.every((o) => o.negAllowed === first.negAllowed);
  // a kind of result: the parts it asks for (a part asked twice wants two different stats of it)
  type Kind = { needs: Map<string, KeepPart>; layout: string; neg: boolean | null; prob: number };
  const kinds: Kind[] = [];
  const kindOf = new Map<string, Kind>();
  // the same stat, layout and bar come back in many results
  const bars = new Map<string, string>();
  const bar = (tag: string, layout: Layout, minW: number, neg: boolean) => {
    const k = `${tag}|${layoutText(layout)}|${minW}|${neg}`;
    let b = bars.get(k);
    if (b == null) {
      b = displayBar(cls, tag, layout, minW, neg);
      bars.set(k, b);
    }
    return b;
  };
  for (const o of outcomes) {
    const needs = new Map<string, KeepPart>();
    for (const n of o.needs) {
      const neg = n.neg === true;
      const stats = n.stats.map((tag) => ({ tag, bar: bar(tag, o.layout, n.minW, neg), neg }));
      const id = stats.map((x) => (neg ? "-" : "") + x.tag + x.bar).join("|");
      const part = needs.get(id);
      if (part) part.count++;
      else needs.set(id, { stats, count: 1, minW: n.minW });
    }
    const layout = layoutText(o.layout);
    // results asking the same parts as often, in the same layout and with the same negative, are one kind
    const sig = `${layout}|${o.negAllowed}|${[...needs]
      .map(([id, p]) => `${p.count}×${id}`)
      .sort()
      .join("+")}`;
    const same = kindOf.get(sig);
    if (same) same.prob += o.prob;
    else {
      const kind = { needs, layout, neg: o.negAllowed, prob: o.prob };
      kinds.push(kind);
      kindOf.set(sig, kind);
    }
  }
  // a kind of result is only a safe rule when no worse result shows what it asks for (one-to-one, bar for bar)
  const shows = (k: Kind, w: Route["outcomes"][number]) => {
    if (layoutText(w.layout) !== k.layout) return false;
    if (k.neg === true && w.negAllowed !== true) return false;
    const have = w.needs.map((n) => ({ key: n.stats.join("|") + (n.neg ? "-" : ""), minW: n.minW }));
    const want = [...k.needs].flatMap(([, p]) =>
      Array.from({ length: p.count }, () => ({ key: p.stats.map((x) => x.tag).join("|") + (p.stats[0]?.neg ? "-" : ""), minW: p.minW })),
    );
    const match = (i: number, used: Set<number>): boolean =>
      i === want.length || have.some((h, j) => !used.has(j) && h.key === want[i].key && h.minW >= want[i].minW - 1e-12 && match(i + 1, new Set([...used, j])));
    return match(0, new Set());
  };
  const safe = kinds.filter((k) => !worse.some((w) => shows(k, w)));
  // A result asking for everything another one asks (same layout) and more adds nothing to the rule.
  // An accepted negative counts as one more thing asked: if any negative will do, an accepted one will too.
  const asks = (k: Kind) =>
    new Map<string, number>([...[...k.needs].map(([id, p]) => [id, p.count] as [string, number]), ...(k.neg === true ? [["neg", 1] as [string, number]] : [])]);
  const total = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
  const covered = (a: Kind, b: Kind) => {
    const more = asks(a);
    const fewer = asks(b);
    return b.layout === a.layout && total(fewer) < total(more) && [...fewer].every(([id, n]) => (more.get(id) ?? 0) >= n);
  };
  const ranked = safe.filter((x) => !safe.some((y) => covered(x, y))).sort((a, b) => b.prob - a.prob);
  const lockNeg = r.action.kind === "cycle" && r.action.lock === "neg";
  return {
    chips: ranked.map((x) => ({
      key: `${x.layout}|${x.neg}|${[...x.needs].map(([id, p]) => `${p.count}×${id}`).join("+")}`,
      parts: [...x.needs.values()],
      layout: sameLayout ? null : x.layout,
      negOk: !sameNeg && x.neg === true,
    })),
    partial: safe.length < kinds.length,
    negOk: !lockNeg && sameNeg && first.negAllowed === true,
    layout: sameLayout && !layoutFixed ? layoutText(first.layout) : null,
  };
}

/** The stat a route acts on, for its icon. */
export function routeTag(r: Route, card: CardDraft): string | null {
  const a = r.action;
  if (a.kind === "splice") return a.result;
  if (a.lock === "none") return null;
  if (a.lock === "neg") return card.neg?.tag ?? null;
  return a.lock.tag;
}
