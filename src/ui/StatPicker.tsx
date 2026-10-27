import { useState } from "react";
import { type Lang, type RivenClass, type Splice, statOf } from "../engine/data";
import { nameMatches, searchForm } from "../hant";
import type { Strings } from "../i18n";
import { CATEGORY_ORDER, statCategory } from "../state";
import { Pop } from "./controls";
import { StatIcon } from "./icons";

interface Props {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  /** stats to offer */
  options: string[];
  selected: string[];
  multi?: boolean;
  /** stats that cannot be picked here, with why */
  blocked?: Map<string, string>;
  /** a short note shown with a stat (it can be picked) */
  notes?: Map<string, string>;
  splices?: Splice[];
  placeholder: string;
  onChange: (tags: string[]) => void;
  className?: string;
}

/** Searchable stat list grouped by kind; spliced stats show their recipe. */
export function StatPicker({ s, lang, cls, options, selected, multi, blocked, notes, splices = [], placeholder, onChange, className }: Props) {
  const [q, setQ] = useState("");
  const name = (t: string) => statOf(cls, t).name[lang];
  const recipe = new Map<string, string>();
  // some spliced stats have more than one recipe: show and search them all
  for (const r of splices) recipe.set(r.result, [recipe.get(r.result), `${name(r.a)} + ${name(r.b)}`].filter(Boolean).join(" / "));
  // any language's name finds the stat, typed in either Chinese script; so does a recipe as shown
  const k = searchForm(q);
  const match = (t: string) => !k || nameMatches(statOf(cls, t).name, k) || searchForm(recipe.get(t) ?? "").includes(k);
  const groups = CATEGORY_ORDER.map((c) => ({ c, tags: options.filter((t) => statCategory(cls, t) === c && match(t)) })).filter((g) => g.tags.length);
  const or = lang === "en" ? " or " : " 或 ";

  return (
    <Pop
      wide
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className={`picker-btn${selected.length ? "" : " empty"}${className ? ` ${className}` : ""}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
        >
          <span className="picker-label">
            {selected.length
              ? selected.map((t, i) => (
                  <span key={t} className="stat-name">
                    {i > 0 && <span className="muted">{or}</span>}
                    <StatIcon tag={t} />
                    {name(t)}
                  </span>
                ))
              : placeholder}
          </span>
          <span className="caret" aria-hidden="true">
            ▾
          </span>
        </button>
      )}
    >
      {(close) => (
        <div className="picker">
          <input
            type="search"
            // biome-ignore lint/a11y/noAutofocus: the panel opens because the player wants to search
            autoFocus
            className="picker-search"
            placeholder={s.search}
            aria-label={s.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const first = groups[0]?.tags.find((t) => !blocked?.has(t));
                if (first) {
                  onChange(multi ? (selected.includes(first) ? selected : [...selected, first]) : [first]);
                  if (!multi) close();
                }
              }
            }}
          />
          {multi && <p className="picker-note">{s.anyOf}</p>}
          {groups.map((g) => (
            <section key={g.c} className="picker-group">
              <h4>{s.category[g.c]}</h4>
              <div className="picker-grid">
                {g.tags.map((t) => {
                  const on = selected.includes(t);
                  const why = !on ? blocked?.get(t) : undefined;
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`opt${on ? " on" : ""}`}
                      disabled={!on && blocked?.has(t)}
                      title={why}
                      aria-pressed={multi ? on : undefined}
                      onClick={() => {
                        if (multi) onChange(on ? selected.filter((x) => x !== t) : [...selected, t]);
                        else {
                          onChange([t]);
                          close();
                        }
                      }}
                    >
                      <span className="stat-name">
                        <StatIcon tag={t} />
                        {name(t)}
                      </span>
                      {recipe.has(t) && <small>{recipe.get(t)}</small>}
                      {notes?.has(t) && <small>{notes.get(t)}</small>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {!groups.length && <p className="picker-note">{s.noMatch}</p>}
          {multi && (
            <button type="button" className="btn primary block" onClick={close}>
              {s.done}
            </button>
          )}
        </div>
      )}
    </Pop>
  );
}
