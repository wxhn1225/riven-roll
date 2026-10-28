import { type Lang, type RivenClass, statOf } from "../engine/data";
import { formatDisplay } from "../engine/formula";
import type { Objective } from "../engine/solver";
import type { Strings } from "../i18n";
import type { ParsedCard } from "../ocr/parse";
import { remapTag, statName } from "../state";
import { KuvaIcon, StatIcon } from "./icons";

/** Old/new cards from the cycle confirmation screen, with the better one marked, or neither when they are even. */
export function Compare(props: {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  cards: [ParsedCard, ParsedCard];
  values: number[] | null;
  negs: (string | null)[];
  objective: Objective;
  fmt: (n: number) => string;
  onKeep: (which: 0 | 1) => void;
}) {
  const { s, lang, cls, cards, values, negs, objective, fmt, onKeep } = props;
  const cycles = objective === "cycles";
  const better = !values ? null : values[1] < values[0] - 1e-9 ? 1 : values[0] < values[1] - 1e-9 ? 0 : null;
  const diff = values ? Math.abs(values[0] - values[1]) : 0;
  return (
    <section className="panel compare" aria-label={s.compare.title}>
      <header className="panel-h">
        <h2>{s.compare.title}</h2>
        {values && better == null && <span className="muted">{s.compare.even}</span>}
        {values && diff > 1 && (
          <span className="muted with-ico">
            {!cycles && <KuvaIcon label={s.kuva} />}
            {cycles ? s.compare.savesCycles(fmt(diff)) : s.compare.saves(fmt(diff))}
          </span>
        )}
      </header>
      <div className="compare-cards">
        {cards.map((c, i) => (
          <button key={c.x} type="button" className={`compare-card${better === i ? " better" : ""}`} onClick={() => onKeep(i as 0 | 1)}>
            <span className="compare-h">
              <b>{i === 0 ? s.compare.old : s.compare.new}</b>
              {better === i && <span className="seal">{s.compare.better}</span>}
              {values && (
                <span className="muted with-ico">
                  {!cycles && <KuvaIcon label={s.kuva} />}
                  {cycles ? s.compare.cycles(fmt(values[i])) : fmt(values[i])}
                </span>
              )}
            </span>
            {c.traits.map((t, j) => {
              const tag = remapTag(cls, t.tag);
              const def = tag ? statOf(cls, tag) : undefined;
              return (
                // a line's place on the card: the reader can read one stat on two lines
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a card read once are fixed
                <span key={`${j}|${t.tag}`} className={`compare-line${t.curse ? " neg" : ""}`}>
                  <span className="num">{t.shown == null ? "?" : def ? formatDisplay(def, t.shown) : t.shown}</span> {tag && <StatIcon tag={tag} />}
                  {def?.name[lang] ?? t.tag}
                </span>
              );
            })}
            {values && negs[i] && <span className="compare-note">{s.compare.negNotOk(statName(cls, negs[i], lang))}</span>}
            <span className={`btn${better === i ? " primary" : ""}`}>{s.compare.keep(i === 0 ? s.compare.old : s.compare.new)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
