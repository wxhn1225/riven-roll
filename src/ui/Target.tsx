import { useState } from "react";
import { type Lang, type RivenClass, statOf } from "../engine/data";
import { formatDisplay, LAYOUTS, type Layout, layoutKey } from "../engine/formula";
import type { Pool } from "../engine/pool";
import type { Strings } from "../i18n";
import {
  allGroups,
  autoLayouts,
  complete,
  effectiveLayouts,
  firstShown,
  fmtRoll,
  type GroupDraft,
  groupBar,
  shownAt,
  shownRange,
  showsUp,
  statName,
  type TargetDraft,
  valueBar,
} from "../state";
import { NumberField, NumberSlider, Segmented, Switch } from "./controls";
import { QuickTarget } from "./QuickTarget";
import { StatPicker } from "./StatPicker";

interface Props {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  pool: Pool;
  target: TargetDraft;
  onChange: (t: TargetDraft) => void;
}

const LAYOUT_KEYS = ["31", "30", "21", "20"] as const;
const MAX_SETS = 4;
const SET_NAMES = ["A", "B", "C", "D"];

/**
 * How many stats the count rule asks for in each target (by its letter): a target with fewer rows than the count
 * needs all of them, so the count that applies can differ between alternative targets.
 */
export function countRule(target: TargetDraft): [string, number][] {
  // only targets filled in enough to plan for count (one still being filled in is left out, as the plan leaves it out)
  const per = target.sets.flatMap((gs, i): [string, number][] => (gs.length && gs.every(complete) ? [[SET_NAMES[i], Math.min(target.atLeast.k, gs.length)]] : []));
  // one count for every target: say it once
  return new Set(per.map(([, k]) => k)).size <= 1 ? [["", per[0]?.[1] ?? target.atLeast.k]] : per;
}

export function Target({ s, lang, cls, pool, target, onChange }: Props) {
  const [more, setMore] = useState(target.atLeast.on);
  const set = (patch: Partial<TargetDraft>) => {
    const next = { ...target, ...patch };
    if (next.layoutsAuto) next.layouts = autoLayouts(next);
    onChange(next);
  };
  const { sets } = target;
  const setSets = (next: GroupDraft[][]) => set({ sets: next.length ? next : [[]] });
  const setGroups = (si: number, groups: GroupDraft[]) => setSets(sets.map((gs, a) => (a === si ? groups : gs)));
  const layoutKeys = effectiveLayouts(target);
  const accepted = LAYOUTS.filter((l) => layoutKeys.includes(layoutKey(l)));
  // the layout with the most traits is the one the value box speaks for
  const primary: Layout | undefined = [...accepted].sort((a, b) => b.pos - a.pos || b.neg - a.neg)[0];
  const wanted = new Set(allGroups(target).flatMap((g) => g.tags));
  const wantable = [...pool.pos, ...pool.spliced];

  const slot = (si: number, groups: GroupDraft[], g: GroupDraft, i: number) => {
    const setGroup = (patch: Partial<GroupDraft>) =>
      setGroups(
        si,
        groups.map((x, j) => (j === i ? { ...x, ...patch } : x)),
      );
    const tag = g.tags[0];
    const def = tag ? statOf(cls, tag) : undefined;
    // the box shows the first stat's number, in its direction (recoil reads "≤ -110%")
    const valueDirection = !tag || showsUp(cls, tag) ? "≥" : "≤";
    // a row whose stats point different ways: say each one's bar
    const mixed = g.tier === "value" && g.value != null && new Set(g.tags.map((t) => showsUp(cls, t))).size > 1;
    const w = tag && primary ? groupBar(cls, target, g, tag, primary) : null;
    const out = w != null && w > 1.1 + 1e-9;
    const value =
      g.tier === "value"
        ? g.value != null && tag
          ? firstShown(cls, tag, g.value)
          : null
        : tag && primary && w != null && !out
          ? Number(shownValue(cls, tag, primary, Math.max(0.9, w)))
          : null;
    // within one target a stat fills one slot, and a riven holds one spliced trait
    const otherSpliced = groups.some((x, j) => j !== i && x.tags.some((y) => pool.spliced.includes(y)));
    const blocked = new Map<string, string>();
    for (const x of groups) if (x !== g) for (const t of x.tags) blocked.set(t, "");
    if (otherSpliced) for (const t of pool.spliced) if (!g.tags.includes(t)) blocked.set(t, s.target.oneSpliced);
    return (
      <li className="slot" key={i}>
        <span className="slot-n">{i + 1}</span>
        <StatPicker
          s={s}
          lang={lang}
          cls={cls}
          multi
          options={wantable}
          selected={g.tags}
          blocked={blocked}
          splices={pool.splices}
          placeholder={s.card.pickStat}
          onChange={(tags) => setGroup({ tags })}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={s.card.remove}
          onClick={() =>
            setGroups(
              si,
              groups.filter((_, j) => j !== i),
            )
          }
        >
          ×
        </button>
        <div className="slot-bar">
          <Segmented
            label={s.target.roll}
            value={g.tier === "any" || g.tier === "mid" || g.tier === "hi" ? g.tier : ("" as "any")}
            options={(["any", "mid", "hi"] as const).map((t) => ({ value: t, label: s.target.preset[t] }))}
            onChange={(tier) => setGroup({ tier })}
          />
          <label className={`bar-field${out ? " out" : ""}`}>
            <span>{s.target.roll}</span>
            <NumberField
              label={s.target.roll}
              value={w == null ? null : Math.max(0.9, w)}
              format={(n) => (out ? s.target.never : fmtRoll(n))}
              min={0.9}
              max={1.1}
              step={0.01}
              size={4}
              onCommit={(n) => n != null && setGroup({ tier: "w", w: n })}
            />
          </label>
          <label className="bar-field">
            <span>
              {s.target.value} {valueDirection}
            </span>
            <NumberField
              label={`${s.target.value} ${valueDirection}`}
              value={value}
              format={(n) => (def ? formatDisplay(def, n) : String(n))}
              size={7}
              onCommit={(n) => n != null && setGroup({ tier: "value", value: n })}
            />
            {accepted.length > 1 && primary && (
              <small className="muted" title={tag ? accepted.map((l) => `${l.pos}+${l.neg}: ${barText(cls, target, g, tag, l, s)}`).join("  ·  ") : undefined}>
                {primary.pos}+{primary.neg}
              </small>
            )}
          </label>
          {mixed && g.value != null && (
            <small className="muted mixed-bars">{g.tags.map((t) => `${statName(cls, t, lang)}${valueBar(cls, t, g.value as number)}`).join(" / ")}</small>
          )}
          {/* what the game can show in the layout the value box speaks for, lowest roll to highest */}
          {primary && g.tags.length > 0 && (
            <small className="muted slot-range">
              {s.target.range(
                g.tags
                  .map((t) => {
                    const r = shownRange(cls, t, primary, false);
                    const text = r ? `${formatDisplay(statOf(cls, t), r[0])} ~ ${formatDisplay(statOf(cls, t), r[1])}` : "—";
                    // a row of several stats names each one
                    return g.tags.length > 1 ? `${statName(cls, t, lang)} ${text}` : text;
                  })
                  .join(" / "),
              )}
            </small>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="panel" aria-label={s.target.title}>
      <header className="panel-h">
        <h2>{s.target.title}</h2>
        <button type="button" className={`text-btn${more ? " on" : ""}`} aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {s.target.more}
        </button>
      </header>

      <QuickTarget s={s} lang={lang} cls={cls} pool={pool} onApply={set} />

      {/* a count rule still applies while its settings are folded away: say so, so "any roll" rows are not misread */}
      {!more && target.atLeast.on && (
        <button type="button" className="text-btn rule-note" onClick={() => setMore(true)}>
          {s.target.atLeastNote(countRule(target), `${s.target.preset[target.atLeast.tier]} ${(target.atLeast.tier === "hi" ? target.tiers.hi : target.tiers.mid).toFixed(2)}`)}
        </button>
      )}

      {more && (
        <div className="more">
          <div className="more-row">
            <span className="field-label">{s.target.tiers}</span>
            <NumberSlider label={s.target.preset.hi} value={target.tiers.hi} min={0.9} max={1.1} step={0.01} onChange={(hi) => set({ tiers: { ...target.tiers, hi } })} />
            <NumberSlider label={s.target.preset.mid} value={target.tiers.mid} min={0.9} max={1.1} step={0.01} onChange={(mid) => set({ tiers: { ...target.tiers, mid } })} />
          </div>
          <div className="more-row">
            <Switch checked={target.atLeast.on} onChange={(on) => set({ atLeast: { ...target.atLeast, on } })} label={s.target.atLeast} />
            <Segmented
              label={s.target.atLeast}
              value={String(target.atLeast.k) as "1" | "2" | "3"}
              options={(["1", "2", "3"] as const).map((k) => ({ value: k, label: k }))}
              onChange={(k) => set({ atLeast: { ...target.atLeast, on: true, k: Number(k) } })}
            />
            <span>{s.target.reach}</span>
            <Segmented
              label={s.target.reach}
              value={target.atLeast.tier}
              options={[
                { value: "hi", label: `${s.target.preset.hi} ${target.tiers.hi.toFixed(2)}` },
                { value: "mid", label: `${s.target.preset.mid} ${target.tiers.mid.toFixed(2)}` },
              ]}
              onChange={(tier) => set({ atLeast: { ...target.atLeast, on: true, tier } })}
            />
          </div>
        </div>
      )}

      {sets.map((groups, si) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: targets are positional
        <div className={`target-set${sets.length > 1 ? " multi" : ""}`} key={si}>
          {si > 0 && (
            <div className="or" aria-hidden="true">
              <span>{s.target.or}</span>
            </div>
          )}
          {sets.length > 1 && (
            <div className="set-h">
              <span className="set-name">{SET_NAMES[si]}</span>
              <button type="button" className="text-btn" onClick={() => setSets(sets.filter((_, j) => j !== si))}>
                {s.target.removeSet}
              </button>
            </div>
          )}
          <ol className="slots">{groups.map((g, i) => slot(si, groups, g, i))}</ol>
          <button type="button" className="add-row" disabled={groups.length >= 3} onClick={() => setGroups(si, [...groups, { tags: [], tier: "any" }])}>
            + {s.target.add}
          </button>
        </div>
      ))}
      {sets.length < MAX_SETS && sets.some((gs) => gs.length > 0) && (
        <button type="button" className="text-btn add-alt" onClick={() => setSets([...sets, []])}>
          + {s.target.or} · {s.target.addAlt}
        </button>
      )}

      <div className="opts">
        <div className="opt-row">
          <span className="field-label">{s.target.layouts}</span>
          <Segmented
            multi
            label={s.target.layouts}
            value={layoutKeys as (typeof LAYOUT_KEYS)[number][]}
            options={LAYOUT_KEYS.filter((k) => target.wantNeg || k.endsWith("0")).map((k) => ({ value: k, label: `${k[0]}+${k[1]}` }))}
            onChange={(k) => {
              const layouts = layoutKeys.includes(k) ? layoutKeys.filter((x) => x !== k) : [...layoutKeys, k];
              if (layouts.length) onChange({ ...target, layouts, layoutsAuto: false });
            }}
          />
        </div>
        <div className="opt-row">
          <span className="field-label">{s.target.negatives}</span>
          <Switch checked={!target.wantNeg} onChange={(v) => set({ wantNeg: !v, layoutsAuto: true })} label={s.target.noNeg} />
        </div>
        {target.wantNeg && (
          <div className="opt-row">
            <span className="field-label">{s.target.accept}</span>
            <span className="text-tools">
              <button type="button" className="text-btn" onClick={() => set({ allowedNeg: pool.neg.filter((t) => !wanted.has(t)) })}>
                {s.target.all}
              </button>
              <button type="button" className="text-btn" onClick={() => set({ allowedNeg: [] })}>
                {s.target.none}
              </button>
            </span>
          </div>
        )}
        {target.wantNeg && (
          <div className="chips">
            {pool.neg
              .filter((t) => !wanted.has(t))
              .map((t) => {
                const on = target.allowedNeg.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className={`chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => set({ allowedNeg: on ? target.allowedNeg.filter((x) => x !== t) : [...target.allowedNeg, t] })}
                  >
                    {statOf(cls, t).name[lang]}
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </section>
  );
}

/** The number a stat shows at roll w, as a plain number (144.1 for "+144.1%"). */
function shownValue(cls: RivenClass, tag: string, layout: Layout, w: number): string {
  return shownAt(cls, tag, layout, w).replace(/[x%+]/g, "");
}

function barText(cls: RivenClass, t: TargetDraft, g: GroupDraft, tag: string, l: Layout, s: Strings) {
  const w = groupBar(cls, t, g, tag, l);
  if (w > 1.1 + 1e-9) return s.target.never;
  return `${Math.max(0.9, w).toFixed(3)} → ${shownAt(cls, tag, l, Math.max(0.9, w))}`;
}
