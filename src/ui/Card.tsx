import { useEffect, useMemo, useRef, useState } from "react";
import { GAME, type Lang, type RivenClass, statOf, statsOf, weaponById } from "../engine/data";
import { formatDisplay, signedDisplayInput } from "../engine/formula";
import type { Pool } from "../engine/pool";
import { nameMatches, searchForm } from "../hant";
import type { Strings } from "../i18n";
import { type OcrModel, watchOcrModel } from "../ocr/client";
import { type CardDraft, cardLayout, fillLayout, plannedRoll, readQuality, type Session, shownRange, type TraitDraft } from "../state";
import { DispositionField, NumberField } from "./controls";
import { KuvaIcon, RivenMark, WeaponImage } from "./icons";
import { StatPicker } from "./StatPicker";

export interface Shot {
  url: string;
  /** region of the screenshot holding the card(s), with the full image size; null until read */
  crop: { x: number; y: number; w: number; h: number; width: number; height: number } | null;
}

/** An error is kept as what went wrong, not as text, so it follows a language switch. */
export type OcrStatus = { kind: "idle" } | { kind: "busy" } | { kind: "done"; ms: number } | { kind: "error"; why: "noCard" | "failed" | "load" };

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
const speedOf = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB/s` : `${Math.round(bytes / 1e3)} KB/s`);
/** after this many seconds without a byte, the status says so */
const QUIET_S = 5;

/**
 * What the reader is doing while a screenshot waits: downloading its files (how far, how fast, whether data still
 * comes, retries), loading them, or reading. It follows the reader on its own, so its frequent updates redraw only it.
 */
function ReaderStatus({ s }: { s: Strings }) {
  const [model, setModel] = useState<OcrModel | null>(null);
  useEffect(() => watchOcrModel(setModel), []);
  if (model?.phase === "load" || model?.phase === "ready")
    return (
      <span className="shot-status busy" aria-live="polite">
        {model.phase === "load" ? s.card.loading : s.card.reading}
      </span>
    );
  const pct = model ? Math.floor((model.loaded / model.total) * 100) : 0;
  const details = model && [
    s.card.downloaded(mb(model.loaded), mb(model.total), pct),
    model.quiet >= QUIET_S ? s.card.quiet(model.quiet) : speedOf(model.speed),
    ...(model.retries ? [s.card.retried(model.retries)] : []),
  ];
  return (
    <span className="shot-status busy" aria-live="polite">
      {s.card.downloading}
      {details ? <span aria-hidden="true"> {details.join(" · ")}</span> : "…"}
      {model && (
        <span className="shot-bar" role="progressbar" aria-label={s.card.downloading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

interface Props {
  s: Strings;
  session: Session;
  cls: RivenClass | null;
  pool: Pool | null;
  shot: Shot | null;
  ocr: OcrStatus;
  /** roll bar of a wanted stat for the card's layout, or null when the stat isn't wanted */
  barFor: (tag: string) => number | null;
  onPick: () => void;
  onWeapon: (id: string) => void;
  onCard: (c: CardDraft) => void;
  onKuva: (k: number | null) => void;
  onDemo: () => void;
  onClear: () => void;
  onDisposition: (d: number) => void;
}

export function Card({ s, session, cls, pool, shot, ocr, barFor, onPick, onWeapon, onCard, onKuva, onDemo, onClear, onDisposition }: Props) {
  const { lang, card } = session;
  const layout = cardLayout(card);
  const [zoom, setZoom] = useState(false);
  const status = ocr.kind === "done" ? s.card.readIn((ocr.ms / 1000).toFixed(1)) : ocr.kind === "error" ? s.card[ocr.why] : null;

  // An old riven can hold a stat this weapon no longer rolls (rolled before the game stopped it), or a spliced trait
  // made from one: every stat of the class is offered, those marked; on the card they are kept, locked and counted,
  // but cycles never draw them and no new splice makes them.
  const normal = cls ? statsOf(cls).filter((d) => !d.spliced) : [];
  const splicedAll = cls
    ? statsOf(cls)
        .filter((d) => d.spliced)
        .map((d) => d.tag)
    : [];
  const posOptions = pool ? [...normal.filter((d) => d.buff).map((d) => d.tag), ...splicedAll] : [];
  const negOptions = pool ? normal.filter((d) => d.curse).map((d) => d.tag) : [];
  const makeable = new Set(pool?.splices.map((r) => r.result));
  const oldOnly = (offered: string[], drawn: string[], kept: string[]) =>
    new Map(offered.filter((t) => (splicedAll.includes(t) ? !makeable.has(t) : !drawn.includes(t) || kept.includes(t))).map((t) => [t, s.card.oldOnly]));
  const posNotes = pool ? oldOnly(posOptions, pool.pos, pool.keptPos) : undefined;
  const negNotes = pool ? oldOnly(negOptions, pool.neg, pool.keptNeg) : undefined;
  const usedTags = new Set([...card.pos.map((t) => t.tag), card.neg?.tag].filter(Boolean) as string[]);
  const splicedOnCard = card.pos.some((t) => t.tag && cls && statOf(cls, t.tag).spliced);

  const row = (t: TraitDraft, curse: boolean, set: (t: TraitDraft) => void, remove: () => void, key: string) => {
    const def = cls && t.tag ? statOf(cls, t.tag) : undefined;
    const q = cls && layout ? readQuality(cls, layout, t, curse) : null;
    const bar = !curse && t.tag ? barFor(t.tag) : null;
    // the roll the plan uses (the top of a spliced trait's range), so the card and the plan agree on what is met
    const w = q?.valid && cls && t.tag ? plannedRoll(cls, t.tag, q) : null;
    const meets = w != null && bar != null ? w >= bar - 1e-9 : null;
    // what the game can show for this stat in this layout (a card being filled in counts as 2 positives until it has 3)
    const range = cls && t.tag ? shownRange(cls, t.tag, fillLayout(card), curse) : null;
    const blocked = new Map<string, string>();
    for (const u of usedTags) if (u !== t.tag) blocked.set(u, "");
    if (!curse && splicedOnCard && !(def?.spliced ?? false)) for (const x of splicedAll) blocked.set(x, s.target.oneSpliced);
    return (
      <li key={key} className={`trait${curse ? " neg" : ""}`}>
        <span className="sign" aria-hidden="true">
          {curse ? "−" : "+"}
        </span>
        <NumberField
          className="trait-val"
          label={def ? def.name[lang] : s.card.pickStat}
          value={t.shown}
          format={(n) => (def ? formatDisplay(def, n) : String(n))}
          placeholder={def && range ? formatDisplay(def, range[0]) : "—"}
          size={7}
          onCommit={(n) => set({ tag: t.tag, shown: signedDisplayInput(def, curse, n) })}
        />
        {cls && (
          <StatPicker
            s={s}
            lang={lang}
            cls={cls}
            options={curse ? negOptions : posOptions}
            notes={curse ? negNotes : posNotes}
            selected={t.tag ? [t.tag] : []}
            blocked={blocked}
            splices={pool?.splices}
            placeholder={s.card.pickStat}
            className="trait-stat"
            // a stat picked on an empty row gets the number of the lowest roll (filled in with the card's layout)
            onChange={([tag]) => set(t.shown == null || t.auto ? { tag, shown: null, auto: true } : { tag, shown: signedDisplayInput(statOf(cls, tag), curse, t.shown) })}
          />
        )}
        <span className={`trait-w${meets === true ? " hi" : meets === false ? " lo" : ""}`} title={q && !q.valid ? s.card.invalid : undefined}>
          {w != null ? w.toFixed(3) : ""}
          {q && !q.valid && <span className="warn-dot" role="img" aria-label={s.card.invalid} />}
        </span>
        <span className="trait-bar" aria-hidden="true">
          {w != null && <i style={{ width: `${((w - 0.9) / 0.2) * 100}%` }} className={meets === true ? "hi" : meets === false ? "lo" : undefined} />}
          {bar != null && bar > 0.9 + 1e-9 && bar <= 1.1 && <b style={{ left: `${((bar - 0.9) / 0.2) * 100}%` }} />}
        </span>
        <button type="button" className="icon-btn" aria-label={s.card.remove} onClick={remove}>
          ×
        </button>
        {def && range && <small className="trait-range">{s.card.range(formatDisplay(def, range[0]), formatDisplay(def, range[1]))}</small>}
      </li>
    );
  };

  return (
    <section className="panel card-panel" aria-label={s.card.title}>
      <header className="panel-h">
        <h2>{s.card.title}</h2>
        <span className="panel-tools">
          <button type="button" className="text-btn" onClick={onDemo}>
            {s.card.demo}
          </button>
          <button type="button" className="text-btn" onClick={onClear}>
            {s.card.clear}
          </button>
        </span>
      </header>

      {shot ? (
        <figure className="shot">
          <button type="button" className="shot-img" aria-label={s.card.zoom} onClick={() => setZoom(true)}>
            <ShotImage shot={shot} />
          </button>
          <figcaption>
            {ocr.kind === "busy" ? (
              <ReaderStatus s={s} />
            ) : (
              status && (
                <span className={`shot-status${ocr.kind === "error" ? " warn" : ""}`} aria-live="polite">
                  {status}
                </span>
              )
            )}
            <button type="button" className="shot-again" onClick={onPick}>
              {s.card.another}
            </button>
          </figcaption>
        </figure>
      ) : (
        <button type="button" className="drop" onClick={onPick}>
          <RivenMark size={40} />
          <span>
            <b>{s.card.paste}</b>
            <small>{status ?? s.card.pasteHint}</small>
          </span>
        </button>
      )}
      {zoom && shot && <Lightbox src={shot.url} label={s.card.zoom} onClose={() => setZoom(false)} />}

      <WeaponPicker s={s} lang={lang} value={session.weaponId} onPick={onWeapon} disposition={session.disposition} onDisposition={onDisposition} />

      {cls && (
        <>
          <ul className="traits">
            {card.pos.map((t, i) =>
              row(
                t,
                false,
                (nt) => onCard({ ...card, pos: card.pos.map((x, j) => (j === i ? nt : x)) }),
                () => onCard({ ...card, pos: card.pos.filter((_, j) => j !== i) }),
                `p${i}`,
              ),
            )}
            {card.neg &&
              row(
                card.neg,
                true,
                (nt) => onCard({ ...card, neg: nt }),
                () => onCard({ ...card, neg: null }),
                "n",
              )}
          </ul>
          <div className="trait-add">
            <span>{s.card.add}</span>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label={s.card.addPos}
              title={s.card.addPos}
              disabled={card.pos.length >= 3}
              onClick={() => onCard({ ...card, pos: [...card.pos, { tag: "", shown: null }] })}
            >
              +
            </button>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label={s.card.addNeg}
              title={s.card.addNeg}
              disabled={!!card.neg}
              onClick={() => onCard({ ...card, neg: { tag: "", shown: null } })}
            >
              −
            </button>
            {layout && (
              <span className="layout-tag">
                {layout.pos}+{layout.neg}
              </span>
            )}
          </div>
        </>
      )}

      <div className="card-foot">
        <label>
          <span>{s.card.cycles}</span>
          <NumberField label={s.card.cycles} value={card.cycles} min={0} step={1} size={5} onCommit={(n) => onCard({ ...card, cycles: Math.round(n ?? 0) })} />
        </label>
        <label>
          <KuvaIcon />
          <span>{s.card.kuvaLeft}</span>
          <NumberField
            label={`${s.card.kuvaLeft} ${s.kuva}`}
            value={session.kuva}
            min={0}
            size={11}
            format={(n) => n.toLocaleString("en-US")}
            placeholder="—"
            onCommit={(n) => onKuva(n == null ? null : Math.round(n))}
          />
        </label>
      </div>
    </section>
  );
}

/** The screenshot cut down to the riven card once OCR has found it; the whole image before that. */
function ShotImage({ shot }: { shot: Shot }) {
  const c = shot.crop;
  if (!c) return <img className="shot-full" src={shot.url} alt="" />;
  return (
    <span className="shot-crop" style={{ aspectRatio: `${c.w} / ${c.h}`, width: `min(100%, ${Math.round((300 * c.w) / c.h)}px)` }}>
      <img src={shot.url} alt="" style={{ width: `${(c.width / c.w) * 100}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` }} />
    </span>
  );
}

function Lightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="lightbox" aria-label={label} onClose={onClose} onClick={() => ref.current?.close()} onKeyDown={() => {}}>
      <img src={src} alt="" />
    </dialog>
  );
}

function WeaponPicker({
  s,
  lang,
  value,
  onPick,
  disposition,
  onDisposition,
}: {
  s: Strings;
  lang: Lang;
  value: string | null;
  onPick: (id: string) => void;
  disposition: number;
  onDisposition: (d: number) => void;
}) {
  const current = value ? weaponById(value) : undefined;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const list = useMemo(() => {
    // any language's name finds the weapon, typed in either Chinese script (絕路 finds 绝路 too)
    const k = searchForm(q);
    if (!k) return [];
    return GAME.weapons.filter((w) => nameMatches(w.name, k)).slice(0, 40);
  }, [q]);
  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setOpen(false);
  };
  return (
    <div className="weapon">
      <WeaponImage weapon={current} />
      <div className="weapon-field">
        <input
          type="search"
          role="combobox"
          aria-label={s.card.weapon}
          aria-expanded={open && list.length > 0}
          aria-controls="weapon-list"
          className={current ? "has-value" : undefined}
          placeholder={current ? current.name[lang] : s.card.weapon}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setHi((h) => Math.min(list.length - 1, h + 1));
            else if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
            else if (e.key === "Enter" && list[hi]) pick(list[hi].id);
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {current && (
          <small className="weapon-cls">
            {GAME.classes[current.cls].name[lang]}
            <span aria-hidden="true"> · </span>
            <DispositionField value={disposition} onChange={onDisposition} labels={s.disposition} />
          </small>
        )}
        {open && list.length > 0 && (
          <div id="weapon-list" role="listbox" className="weapon-list">
            {list.map((w, i) => (
              <div key={w.id} role="option" tabIndex={-1} aria-selected={i === hi} onMouseDown={() => pick(w.id)}>
                <WeaponImage weapon={w} className="small" />
                <span>{w.name[lang]}</span>
                <small>{GAME.classes[w.cls].name[lang]}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
