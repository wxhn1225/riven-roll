import { type ReactNode, useMemo, useState } from "react";
import { CLASSES, GAME, type Lang, type RivenClass, type StatDef, statsOf, weaponById } from "../engine/data";
import { displayNumber, formatDisplay, LAYOUTS, type Layout, layoutKey, qualityFromDisplay, rawValue } from "../engine/formula";
import { poolFor } from "../engine/pool";
import type { Strings } from "../i18n";
import { CATEGORY_ORDER, statCategory } from "../state";
import { DispositionField, NumberField, Segmented, Switch } from "./controls";
import { StatIcon } from "./icons";

const ORDER: Layout[] = [LAYOUTS[3], LAYOUTS[2], LAYOUTS[1], LAYOUTS[0]]; // 3+1, 3+0, 2+1, 2+0
const CURSED: Layout[] = [LAYOUTS[3], LAYOUTS[1]]; // negatives exist only in 3+1 and 2+1

/** Melee has its own tags for damage and faction damage; line them up with the gun ones. */
const statKey = (tag: string) => (tag === "WeaponMeleeDamageMod" ? "WeaponDamageAmountMod" : tag.replace("WeaponMeleeFactionDamage", "WeaponFactionDamage"));

function span(def: StatDef, l: Layout, curse: boolean) {
  const at = (w: number) => formatDisplay(def, displayNumber(def, rawValue(def, l, curse, w)));
  return `${at(0.9)} ~ ${at(1.1)}`;
}

/** Roll of a typed value in one layout; the sign is taken from how the game shows that column. */
function rollAt(def: StatDef, l: Layout, curse: boolean, v: number) {
  if (def.fmt === "mult") return qualityFromDisplay(def, l, curse, v);
  const sign = Math.sign(displayNumber(def, rawValue(def, l, curse, 1))) || 1;
  return qualityFromDisplay(def, l, curse, sign * Math.abs(v));
}

/** The stat row being checked against a typed value. */
interface Check {
  key: string;
  value: number | null;
}

function Cell({ s, def, l, curse, value }: { s: Strings; def: StatDef; l: Layout; curse: boolean; value: number | null }) {
  const range = span(def, l, curse);
  if (value == null) return <>{range}</>;
  const q = rollAt(def, l, curse, value);
  return (
    <>
      <span className="cell-range">{range}</span>
      <span className={`cell-roll${q.valid ? "" : " bad"}`}>{q.valid ? `${s.ranges.roll} ${q.w.toFixed(3)}` : s.ranges.out}</span>
    </>
  );
}

/** Row header: the stat name toggles a value box for checking a roll. */
function RowHead(props: { s: Strings; def: StatDef; check: Check | null; setCheck: (c: Check | null) => void; children?: ReactNode; lang: Lang }) {
  const { s, def, check, setCheck, children, lang } = props;
  const key = statKey(def.tag);
  const on = check?.key === key;
  return (
    <th scope="row">
      <button type="button" className="row-btn" aria-expanded={on} onClick={() => setCheck(on ? null : { key, value: null })}>
        <span className="stat-name">
          <StatIcon tag={def.tag} />
          {def.name[lang]}
        </span>
      </button>
      {children}
      {on && (
        <span className="row-value">
          <NumberField
            label={`${def.name[lang]} ${s.ranges.value}`}
            value={check.value}
            placeholder={s.ranges.value}
            format={(n) => (def.fmt === "mult" ? formatDisplay(def, n) : formatDisplay(def, Math.abs(n)).replace(/^[+−-]/, ""))}
            size={8}
            autoFocus
            onCommit={(n) => setCheck({ key, value: n == null ? null : n })}
          />
        </span>
      )}
    </th>
  );
}

type View = "class" | "layout";

/** Every stat's possible values: one weapon class across layouts, or one layout across weapon classes. */
export function Ranges({
  s,
  lang,
  weaponId,
  disposition,
  onDisposition,
}: {
  s: Strings;
  lang: Lang;
  weaponId: string | null;
  disposition: number;
  onDisposition: (d: number) => void;
}) {
  const weapon = weaponId ? weaponById(weaponId) : undefined;
  const [view, setView] = useState<View>("class");
  const [cls, setCls] = useState<RivenClass>(weapon?.cls ?? "Rifle");
  const [layout, setLayout] = useState("31");
  const [curse, setCurse] = useState(false);
  const [onlyWeapon, setOnlyWeapon] = useState(!!weapon);
  const [check, setCheck] = useState<Check | null>(null);

  return (
    <section className="ranges">
      <header className="ranges-h">
        <h2>{s.ranges.title}</h2>
        <Segmented label={s.ranges.title} value={view} options={(["class", "layout"] as const).map((v) => ({ value: v, label: s.ranges.view[v] }))} onChange={setView} />
      </header>
      {view === "class" ? (
        <ByClass s={s} lang={lang} cls={cls} setCls={setCls} weapon={weapon} onlyWeapon={onlyWeapon} setOnlyWeapon={setOnlyWeapon} check={check} setCheck={setCheck} />
      ) : (
        <ByLayout s={s} lang={lang} layout={layout} setLayout={setLayout} curse={curse} setCurse={setCurse} mine={weapon?.cls} check={check} setCheck={setCheck} />
      )}
      <p className="muted small">
        {s.ranges.note} <DispositionField value={disposition} onChange={onDisposition} labels={s.disposition} />
      </p>
    </section>
  );
}

function ByClass(props: {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  setCls: (c: RivenClass) => void;
  weapon: ReturnType<typeof weaponById>;
  onlyWeapon: boolean;
  setOnlyWeapon: (v: boolean) => void;
  check: Check | null;
  setCheck: (c: Check | null) => void;
}) {
  const { s, lang, cls, setCls, weapon, onlyWeapon, setOnlyWeapon, check, setCheck } = props;
  const pool = useMemo(() => (weapon && weapon.cls === cls && onlyWeapon ? poolFor(weapon) : null), [weapon, cls, onlyWeapon]);
  const stats = statsOf(cls);
  // every recipe of a spliced stat, only the weapon's own when one is picked
  const recipe = (tag: string) => {
    const n = (t: string) => stats.find((d) => d.tag === t)?.name[lang] ?? t;
    return (pool?.splices ?? GAME.classes[cls].splices)
      .filter((x) => x.result === tag)
      .map((r) => `${n(r.a)} + ${n(r.b)}`)
      .join(" / ");
  };
  const cols = 1 + ORDER.length + CURSED.length;
  return (
    <>
      <div className="ranges-bar">
        <Segmented label={s.ranges.view.class} value={cls} options={CLASSES.map((c) => ({ value: c, label: GAME.classes[c].name[lang] }))} onChange={setCls} />
        {weapon && weapon.cls === cls && <Switch checked={onlyWeapon} onChange={setOnlyWeapon} label={weapon.name[lang]} />}
        <span className="muted small ranges-hint">{s.ranges.checkHint}</span>
      </div>
      <div className="table-wrap">
        <table className="range-table">
          <thead>
            <tr>
              <th>{s.ranges.stat}</th>
              {ORDER.map((l) => (
                <th key={layoutKey(l)} className="r">
                  {l.pos}+{l.neg}
                </th>
              ))}
              {CURSED.map((l) => (
                <th key={`n${layoutKey(l)}`} className="r neg">
                  − {l.pos}+{l.neg}
                </th>
              ))}
            </tr>
          </thead>
          {CATEGORY_ORDER.map((c) => {
            const rows = stats.filter((d) => statCategory(cls, d.tag) === c);
            if (!rows.length) return null;
            return (
              <tbody key={c}>
                <tr className="cat">
                  <th colSpan={cols}>{s.category[c]}</th>
                </tr>
                {rows.map((d) => {
                  const canPos = d.buff && (!pool || pool.pos.includes(d.tag) || pool.spliced.includes(d.tag));
                  const canNeg = d.curse && !d.spliced && (!pool || pool.neg.includes(d.tag));
                  const on = check?.key === statKey(d.tag);
                  const value = on ? check.value : null;
                  return (
                    <tr key={d.tag} className={`${!canPos && !canNeg ? "off" : ""}${on ? " checking" : ""}`}>
                      <RowHead s={s} lang={lang} def={d} check={check} setCheck={setCheck}>
                        {d.spliced && <small>{recipe(d.tag)}</small>}
                      </RowHead>
                      {ORDER.map((l) => (
                        <td key={layoutKey(l)} className="r num">
                          {canPos ? <Cell s={s} def={d} l={l} curse={false} value={value} /> : <span className="muted">{pool ? s.ranges.cannot : "—"}</span>}
                        </td>
                      ))}
                      {CURSED.map((l) => (
                        <td key={`n${layoutKey(l)}`} className="r num neg">
                          {canNeg ? <Cell s={s} def={d} l={l} curse value={value} /> : <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </>
  );
}

function ByLayout(props: {
  s: Strings;
  lang: Lang;
  layout: string;
  setLayout: (k: string) => void;
  curse: boolean;
  setCurse: (v: boolean) => void;
  mine: RivenClass | undefined;
  check: Check | null;
  setCheck: (c: Check | null) => void;
}) {
  const { s, lang, layout, setLayout, curse, setCurse, mine, check, setCheck } = props;
  const l = LAYOUTS.find((x) => layoutKey(x) === layout) ?? LAYOUTS[3];
  const neg = curse && l.neg === 1;
  // one row per stat, lined up across classes; named after the first class that has it
  const rows = useMemo(() => {
    const m = new Map<string, { first: RivenClass; byClass: Map<RivenClass, StatDef> }>();
    for (const c of CLASSES)
      for (const d of statsOf(c)) {
        const k = statKey(d.tag);
        let row = m.get(k);
        if (!row) {
          row = { first: c, byClass: new Map() };
          m.set(k, row);
        }
        row.byClass.set(c, d);
      }
    return [...m.values()];
  }, []);
  const cols = 1 + CLASSES.length;
  return (
    <>
      <div className="ranges-bar">
        <Segmented
          label={s.ranges.view.layout}
          value={layout}
          options={ORDER.map((x) => ({ value: layoutKey(x), label: `${x.pos}+${x.neg}` }))}
          onChange={(k) => {
            setLayout(k);
            if (!k.endsWith("1")) setCurse(false);
          }}
        />
        {l.neg === 1 && (
          <Segmented
            label={s.ranges.sign}
            value={neg ? "neg" : "pos"}
            options={[
              { value: "pos", label: "+" },
              { value: "neg", label: "−" },
            ]}
            onChange={(v) => setCurse(v === "neg")}
          />
        )}
        <span className="muted small ranges-hint">{s.ranges.checkHint}</span>
      </div>
      <div className="table-wrap">
        <table className="range-table">
          <thead>
            <tr>
              <th>{s.ranges.stat}</th>
              {CLASSES.map((c) => (
                <th key={c} className={`r${c === mine ? " mine" : ""}${neg ? " neg" : ""}`}>
                  {GAME.classes[c].name[lang]}
                </th>
              ))}
            </tr>
          </thead>
          {CATEGORY_ORDER.map((cat) => {
            // rows with nothing to show in this layout and sign are left out (no element rolls as a negative)
            const inCat = rows.filter(
              (r) => statCategory(r.first, (r.byClass.get(r.first) as StatDef).tag) === cat && [...r.byClass.values()].some((d) => (neg ? d.curse && !d.spliced : d.buff)),
            );
            if (!inCat.length) return null;
            return (
              <tbody key={cat}>
                <tr className="cat">
                  <th colSpan={cols}>{s.category[cat]}</th>
                </tr>
                {inCat.map((r) => {
                  const head = r.byClass.get(r.first) as StatDef;
                  const other = [...new Set([...r.byClass.values()].map((d) => d.name[lang]))].filter((n) => n !== head.name[lang]);
                  const on = check?.key === statKey(head.tag);
                  const value = on ? check.value : null;
                  return (
                    <tr key={head.tag} className={on ? "checking" : undefined}>
                      <RowHead s={s} lang={lang} def={head} check={check} setCheck={setCheck}>
                        {other.length > 0 && <small>{other.join(" / ")}</small>}
                      </RowHead>
                      {CLASSES.map((c) => {
                        const d = r.byClass.get(c);
                        const ok = d && (neg ? d.curse && !d.spliced : d.buff);
                        return (
                          <td key={c} className={`r num${neg ? " neg" : ""}${c === mine ? " mine" : ""}`}>
                            {ok ? <Cell s={s} def={d} l={l} curse={neg} value={value} /> : <span className="muted">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </>
  );
}
