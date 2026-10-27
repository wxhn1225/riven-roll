import { useMemo, useState } from "react";
import { CLASSES, GAME, type Lang, type RivenClass, statOf } from "../engine/data";
import type { Pool } from "../engine/pool";
import type { Strings } from "../i18n";
import { type QuickResult, readTarget } from "../quick";
import { fmtRoll, type GroupDraft, type TargetDraft, valueBar } from "../state";
import { Pop } from "./controls";
import { StatIcon } from "./icons";

interface Props {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  pool: Pool;
  onApply: (patch: Partial<TargetDraft>) => void;
}

const SET_NAMES = ["A", "B", "C", "D"];

/** What a typed target changes in the target settings. */
export function patchFrom(r: QuickResult, pool: Pool): Partial<TargetDraft> {
  const patch: Partial<TargetDraft> = {};
  if (r.sets.length) patch.sets = r.sets;
  const wanted = new Set(r.sets.flat().flatMap((g) => g.tags));
  if (r.neg.kind === "none") patch.wantNeg = false;
  else if (r.neg.kind === "any") Object.assign(patch, { wantNeg: true, allowedNeg: pool.neg.filter((t) => !wanted.has(t)) });
  else if (r.neg.kind === "list") Object.assign(patch, { wantNeg: true, allowedNeg: r.neg.tags });
  if (r.layouts.length) Object.assign(patch, { layouts: r.layouts, layoutsAuto: false, wantNeg: patch.wantNeg ?? r.layouts.some((k) => k.endsWith("1")) });
  // new wanted stats can need other layouts; a negative alone keeps the layouts picked by hand (those that no
  // longer fit the negative drop out on their own, see effectiveLayouts)
  else if (r.sets.length) patch.layoutsAuto = true;
  return patch;
}

/** One line of text for the whole target: "基多射 负任意". Shows what it read while typing; Enter fills the target. */
export function QuickTarget({ s, lang, cls, pool, onApply }: Props) {
  const q = s.target.quick;
  const [text, setText] = useState("");
  const [left, setLeft] = useState<string[]>([]);
  const r = useMemo(() => (text.trim() ? readTarget(text, cls, pool) : null), [text, cls, pool]);
  const usable = !!r && (r.sets.length > 0 || r.neg.kind !== "keep" || r.layouts.length > 0);

  const apply = () => {
    if (!r || !usable) return;
    onApply(patchFrom(r, pool));
    setLeft(r.unknown);
    setText("");
  };

  return (
    <div className="quick">
      <div className="quick-row">
        <input
          type="text"
          className="quick-input"
          aria-label={q.label}
          placeholder={q.placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLeft([]);
          }}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        <button type="button" className="btn" disabled={!usable} onClick={apply}>
          {q.apply}
        </button>
        <Pop
          trigger={({ open, toggle, id }) => (
            <button type="button" className="icon-btn" aria-label={q.help} aria-expanded={open} aria-controls={id} onClick={toggle}>
              ?
            </button>
          )}
        >
          {() => (
            <ul className="quick-help">
              {q.rules.map(([k, v]) => (
                <li key={k}>
                  <code>{k}</code>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          )}
        </Pop>
      </div>
      {r && <Preview s={s} lang={lang} cls={cls} r={r} />}
      {!r && left.length > 0 && (
        <p className="quick-read">
          <span className="tag bad">
            {q.unknown}
            {q.colon}
            {left.join(q.list)}
          </span>
        </p>
      )}
    </div>
  );
}

function Preview({ s, lang, cls, r }: { s: Strings; lang: Lang; cls: RivenClass; r: QuickResult }) {
  const q = s.target.quick;
  const name = (t: string) => statOf(cls, t).name[lang];
  // a separate element: spaces at the edge of a flex item are dropped
  const or = <span className={lang === "en" ? "sep wide" : "sep"}>/</span>;
  // a typed value is a bar per stat, each in its own direction; tiers and rolls are one bar for the row
  const bar = (g: GroupDraft) => (g.tier === "hi" || g.tier === "mid" ? ` ${s.target.preset[g.tier]}` : g.tier === "w" && g.w != null ? ` ≥ ${fmtRoll(g.w)}` : "");
  return (
    <div className="quick-read" aria-live="polite">
      {r.sets.map((gs, si) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: targets are positional
        <span className="quick-set" key={si}>
          {r.sets.length > 1 && <span className="set-name">{SET_NAMES[si]}</span>}
          {gs.map((g) => (
            <span className="tag" key={g.tags.join("|")}>
              {g.tags.map((t, j) => (
                <span key={t} className="stat-name">
                  {j > 0 && or}
                  <StatIcon tag={t} />
                  {name(t)}
                  {g.tier === "value" && g.value != null && valueBar(cls, t, g.value)}
                </span>
              ))}
              {bar(g)}
            </span>
          ))}
        </span>
      ))}
      {r.neg.kind === "any" && <span className="tag soft">{q.negAny}</span>}
      {r.neg.kind === "none" && <span className="tag soft">{s.target.noNeg}</span>}
      {r.neg.kind === "list" && (
        <span className="tag soft">
          {q.negList}
          {q.colon}
          {r.neg.tags.map(name).join(q.list)}
        </span>
      )}
      {r.layouts.length > 0 && <span className="tag soft">{r.layouts.map((k) => `${k[0]}+${k[1]}`).join(" ")}</span>}
      {r.skipped.map((x) => (
        <span className="tag muted" key={`${x.tags.join("|")}${x.why}`}>
          {statNameAny(x.tags, cls, lang)}
          {q.note(q.why[x.why])}
        </span>
      ))}
      {r.unknown.length > 0 && (
        <span className="tag bad">
          {q.unknown}
          {q.colon}
          {r.unknown.join(q.list)}
        </span>
      )}
    </div>
  );
}

/** Name of a stat that may not exist on this class: this class first, then any class. */
function statNameAny(tags: string[], cls: RivenClass, lang: Lang) {
  for (const c of [cls, ...CLASSES]) {
    const d = GAME.classes[c].stats.find((x) => tags.includes(x.tag));
    if (d) return d.name[lang];
  }
  return tags[0];
}
