import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelPlans, plan as planRoutes } from "../engine/client";
import { GAME, isLang, LANGS, type Lang, statOf, weaponById } from "../engine/data";
import { whyUnreachable } from "../engine/diagnose";
import { formatDisplay, LAYOUTS, layoutKey, setDisposition } from "../engine/formula";
import { poolFor } from "../engine/pool";
import { fmtKuva, HTML_LANG, LANG_LABEL, strings } from "../i18n";
import { recognize, warmOcr } from "../ocr/client";
import type { ParsedCard } from "../ocr/parse";
import {
  afterKeep,
  afterMissed,
  allGroups,
  type CardDraft,
  cardLayout,
  cardProblem,
  compareIds,
  defaultSession,
  demoSession,
  effectiveLayouts,
  groupBar,
  loadSession,
  remapTag,
  type Session,
  saveSession,
  statName,
  type TargetDraft,
  toEngineCard,
  toEngineTarget,
  weaponClass,
  withAutoValues,
} from "../state";
import { Card, type OcrStatus, type Shot } from "./Card";
import { Compare } from "./Compare";
import { Guide } from "./Guide";
import { MailIcon, RivenMark, TranslateIcon } from "./icons";
import { Ranges } from "./Ranges";
import { type PlanView, RouteList, routeView, type SortKey } from "./RouteList";
import { routeKey } from "./routeText";
import { Target } from "./Target";

type Page = "coach" | "ranges" | "guide";

const readPage = (): Page => (location.hash.startsWith("#/guide") ? "guide" : location.hash.startsWith("#/ranges") ? "ranges" : "coach");

const useHashRoute = (): Page => {
  const [page, setPage] = useState<Page>(readPage);
  useEffect(() => {
    const on = () => setPage(readPage());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return page;
};

function draftFrom(cls: NonNullable<ReturnType<typeof weaponClass>>, pc: ParsedCard, fallbackCycles: number): CardDraft {
  const tr = (t: ParsedCard["traits"][number]) => ({ tag: remapTag(cls, t.tag) ?? "", shown: t.shown });
  const neg = pc.traits.find((t) => t.curse);
  return {
    pos: pc.traits
      .filter((t) => !t.curse)
      .slice(0, 3)
      .map(tr),
    neg: neg ? tr(neg) : null,
    cycles: pc.cycles ?? fallbackCycles,
  };
}

function withWeapon(x: Session, id: string): Session {
  const w = weaponById(id);
  if (!w || x.weaponId === id) return x;
  const sameClass = weaponClass(x.weaponId) === w.cls;
  const p = poolFor(w);
  const target: TargetDraft = sameClass ? x.target : { ...x.target, sets: [[]], allowedNeg: p.neg, layoutsAuto: true, layouts: x.target.wantNeg ? ["31"] : ["30"] };
  // another weapon is another riven: comparisons counted for the last one do not apply
  return { ...x, weaponId: id, target, card: sameClass ? x.card : { ...x.card, pos: [], neg: null }, chosen: null, counted: [] };
}

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "riven-roll:theme";
const THEMES: Theme[] = ["auto", "light", "dark"];

/** Light, dark, or the system's: a per-browser choice, kept apart from the session so 清空 and 示例 leave it alone. */
function ThemeButton({ s }: { s: ReturnType<typeof strings> }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" ? t : "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage blocked: the choice lasts until the page closes
    }
  }, [theme]);
  const label = `${s.theme.label}: ${s.theme[theme]}`;
  return (
    <button type="button" className="icon-btn theme-btn" aria-label={label} title={label} onClick={() => setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {theme === "light" && (
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </>
        )}
        {theme === "dark" && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />}
        {theme === "auto" && (
          <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * The language menu, one control on every screen: a native select, so keyboards, screen readers and phones get their
 * own picker. Where the browser lets CSS draw it (appearance: base-select) it opens as a menu of the languages named in
 * themselves, each with what its client calls a riven, the difference between 简体中文 and 国服 at a glance; elsewhere
 * it is the plain select with the same text.
 */
const DRAWN_SELECT = typeof CSS !== "undefined" && CSS.supports("appearance", "base-select");

function LangSelect({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <span className="lang">
      <TranslateIcon />
      <select aria-label="语言 · 語言 · Language" title="语言 · 語言 · Language" value={lang} onChange={(e) => onChange(e.target.value as Lang)}>
        <button type="button">
          <selectedcontent />
        </button>
        {LANGS.map((l) => (
          // a plain select shows the label alone: its text would run name and example together
          <option key={l} value={l} lang={HTML_LANG[l]} label={DRAWN_SELECT ? undefined : LANG_LABEL[l]}>
            <span className="lang-name">{LANG_LABEL[l]}</span>
            <span className="lang-sep"> · </span>
            <span className="lang-eg">{GAME.ui.riven[l]}</span>
          </option>
        ))}
      </select>
    </span>
  );
}

/** A screenshot file's identity. */
async function imageKey(f: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The part of a screenshot that holds the riven card(s): the text block plus the card art above it. */
function cardCrop(cards: ParsedCard[], width: number, height: number): Shot["crop"] {
  if (!cards.length || !width || !height) return null;
  const x0 = Math.min(...cards.map((c) => c.box.x));
  const x1 = Math.max(...cards.map((c) => c.box.x + c.box.w));
  const y0 = Math.min(...cards.map((c) => c.box.y));
  const y1 = Math.max(...cards.map((c) => c.box.y + c.box.h));
  const h = y1 - y0;
  const padX = (x1 - x0) * 0.12;
  const x = Math.max(0, x0 - padX);
  const y = Math.max(0, y0 - h * 1.25);
  return { x, y, w: Math.min(width, x1 + padX) - x, h: Math.min(height, y1 + h * 0.3) - y, width, height };
}

/** Two rivens read from one screenshot, old and new. kuvaShown: the screenshot showed the Kuva left, which already
 * has this cycle's price taken off. */
interface Comparison {
  cards: [ParsedCard, ParsedCard];
  values: number[] | null;
  ids: string[];
  kuvaShown: boolean;
}

/** Where players can write about problems and ideas. */
const CONTACT = "wxhn1225@agent.qq.com";

export function App() {
  const [session, setSession] = useState<Session>(() => {
    const demo = new URLSearchParams(location.search).get("demo");
    if (demo != null) return demoSession(isLang(demo) ? demo : "zh");
    return loadSession();
  });
  const page = useHashRoute();
  const { lang } = session;
  const s = useMemo(() => strings(lang), [lang]);
  // every value below is worked out with the player's disposition
  setDisposition(session.disposition);
  const onDisposition = useCallback(
    (disposition: number) =>
      setSession((x) => {
        // filled-in numbers show the lowest roll with the new disposition
        setDisposition(disposition);
        const c = weaponClass(x.weaponId);
        return { ...x, disposition, card: c ? withAutoValues(c, x.card) : x.card };
      }),
    [],
  );
  const cls = weaponClass(session.weaponId);
  const weapon = session.weaponId ? weaponById(session.weaponId) : undefined;
  const [shot, setShot] = useState<Shot | null>(null);
  const [ocr, setOcr] = useState<OcrStatus>({ kind: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  // the last one-click change that is easy to hit by mistake, the session (and comparison) before it; any later
  // change of the session retires it, so undoing never takes back an edit made after it
  const [undo, setUndo] = useState<{ what: string; before: Session; compare?: Comparison | null } | null>(null);
  const undoFresh = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [compare, setCompare] = useState<Comparison | null>(null);
  const [plan, setPlan] = useState<PlanView>({ kind: "idle", reason: "" });
  const [sortBy, setSortBy] = useState<SortKey>(() => (session.target.objective === "cycles" ? "cycles" : "kuva"));
  const ocrId = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const shotUrl = shot?.url;

  const update = useCallback((f: (x: Session) => Session) => setSession((x) => f(x)), []);
  const cancelOcr = useCallback(() => {
    ocrId.current++;
    setOcr({ kind: "idle" });
  }, []);
  useEffect(
    () => () => {
      ocrId.current++;
    },
    [],
  );
  useEffect(() => {
    if (!shotUrl) return;
    return () => URL.revokeObjectURL(shotUrl);
  }, [shotUrl]);
  useEffect(() => saveSession(session), [session]);
  useEffect(() => {
    document.title = s.title;
    document.documentElement.lang = HTML_LANG[lang];
    // the 繁中 serif's hundreds of faces are a stylesheet of their own, fetched the first time 繁中 is shown
    if (lang === "tc") Promise.all([import("@fontsource/noto-serif-tc/700.css"), import("@fontsource/noto-serif-tc/900.css")]).catch(() => {});
  }, [s.title, lang]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(id);
  }, [undo]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every change of the session
  useEffect(() => {
    if (undoFresh.current) undoFresh.current = false;
    else setUndo(null);
  }, [session]);
  const offerUndo = (what: string, compare?: Comparison | null) => {
    undoFresh.current = true;
    setUndo({ what, before: session, compare });
  };

  const pool = useMemo(() => {
    if (!weapon) return null;
    return poolFor(weapon, { pos: session.card.pos.map((t) => t.tag).filter(Boolean), neg: session.card.neg?.tag ? [session.card.neg.tag] : [] });
  }, [weapon, session.card]);

  const setWeapon = useCallback(
    (id: string) => {
      cancelOcr();
      setCompare(null);
      update((x) => withWeapon(x, id));
    },
    [cancelOcr, update],
  );

  // ---------- screenshots ----------
  const onImage = useCallback(
    async (f: File) => {
      const id = ++ocrId.current;
      const url = URL.createObjectURL(f);
      setShot({ url, crop: null });
      setOcr({ kind: "busy" });
      setCompare(null);
      if (location.hash && !location.hash.startsWith("#/coach")) location.hash = "";
      try {
        const [{ screen, ms, width, height }, shotKey] = await Promise.all([recognize(f), imageKey(f)]);
        if (id !== ocrId.current) return;
        const crop = cardCrop(screen.cards, width, height);
        setShot((old) => (old?.url === url ? { url, crop } : old));
        setOcr({ kind: "done", ms });
        if (screen.lang && screen.lang !== session.lang) {
          setToast(LANG_LABEL[screen.lang]);
        }
        const weaponId = screen.weaponId ?? session.weaponId;
        const c = weaponClass(weaponId);
        const cards = screen.cards.filter((k) => k.traits.length >= 2);
        update((x) => {
          const weaponChanged = weaponId != null && weaponId !== x.weaponId;
          const next = weaponId ? withWeapon(x, weaponId) : x;
          const result = { ...next, lang: screen.lang ?? next.lang, kuva: screen.kuva ?? next.kuva };
          if (!c || !cards.length) return result;
          if (cards.length >= 2 && next.card.pos.length && !weaponChanged) return result;
          return { ...result, card: draftFrom(c, cards[0], next.card.cycles), chosen: null, step: { cycles: 0, kuva: 0 } };
        });
        if (cards.length >= 2 && c) {
          const pair: [ParsedCard, ParsedCard] = [cards[0], cards[cards.length - 1]];
          setCompare({ cards: pair, values: null, ids: compareIds(pair, shotKey), kuvaShown: screen.kuva != null });
        } else if (!cards.length) setOcr({ kind: "error", why: "noCard" });
      } catch (err) {
        // the reader did not load (the next paste tries again with a fresh one), or it could not read this picture
        if (id === ocrId.current) setOcr({ kind: "error", why: (err as { init?: boolean }).init ? "load" : "failed" });
      }
    },
    [session.lang, session.weaponId, update],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        onImage(f);
      }
    };
    const hasFile = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const onOver = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget == null) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragging(false);
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) onImage(f);
    };
    addEventListener("paste", onPaste);
    addEventListener("dragover", onOver);
    addEventListener("dragleave", onLeave);
    addEventListener("drop", onDrop);
    return () => {
      removeEventListener("paste", onPaste);
      removeEventListener("dragover", onOver);
      removeEventListener("dragleave", onLeave);
      removeEventListener("drop", onDrop);
    };
  }, [onImage]);

  // ---------- planning ----------
  const engineCard = cls ? toEngineCard(cls, session.card) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: worked out with the disposition (formula.ts reads it), so it must refresh with it
  const engineTarget = useMemo(() => {
    const t = cls ? toEngineTarget(session.target, cls) : null;
    if (!t) return null;
    const wanted = new Set(t.groups.flatMap((g) => g.tags));
    return { ...t, allowedNeg: t.allowedNeg.filter((x) => !wanted.has(x)) };
  }, [session.target, cls, session.disposition]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: worked out with the disposition (formula.ts reads it), so it must refresh with it
  const compareCards = useMemo(() => {
    if (!compare || !cls) return null;
    const a = toEngineCard(cls, draftFrom(cls, compare.cards[0], 0));
    const b = toEngineCard(cls, draftFrom(cls, compare.cards[1], 0));
    return a && b ? [a, b] : null;
  }, [compare, cls, session.disposition]);
  const runId = useRef(0);
  // what keeps the card from being planned is part of the key: every edit of a card that cannot be planned yet
  // (+100% fixed to +666%) must bring its own message, though the card stays unplannable
  const problem = !engineCard && cls ? cardProblem(cls, session.card) : null;
  // a retry after a failure works the same input out again
  const [retry, setRetry] = useState(0);
  const planKey = JSON.stringify([session.weaponId, engineCard, engineTarget, session.card.cycles, session.kuva, compareCards, session.target.objective, problem, retry]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: planKey captures every input
  useEffect(() => {
    const id = ++runId.current;
    setCompare((c) => (c?.values ? { ...c, values: null } : c));
    // nothing to plan: what is still being worked out for an older input is stopped
    const idle = (reason: string) => {
      cancelPlans();
      setPlan({ kind: "idle", reason });
    };
    if (!session.weaponId) return idle(s.routes.needWeapon);
    if (!engineTarget) return idle(s.routes.needGroups);
    if (!engineCard) {
      const name = (tag: string) => (cls ? statName(cls, tag, lang) : tag);
      const value = (tag: string, n: number) => (cls ? formatDisplay(statOf(cls, tag), n) : String(n));
      return idle(problem ? s.routes.cardProblem(problem, name, value) : s.routes.needCard);
    }
    setPlan((p) => ({ kind: "busy", last: p.kind === "ok" ? p.routes : p.kind === "busy" ? p.last : undefined }));
    const timer = setTimeout(async () => {
      const r = await planRoutes({
        weaponId: session.weaponId as string,
        card: engineCard,
        target: engineTarget,
        objective: session.target.objective,
        cyclesDone: session.card.cycles,
        budget: session.kuva,
        runs: 3000,
        compare: compareCards ?? undefined,
      });
      if (id !== runId.current) return;
      if (!r.ok) return setPlan({ kind: "error", code: r.error });
      if (compareCards) setCompare((c) => (c ? { ...c, values: r.compareValues } : c));
      if (r.done) return setPlan({ kind: "done" });
      if (!r.reachable || !r.routes.length) return setPlan({ kind: "unreachable", why: whyUnreachable(engineCard, engineTarget, pool ?? undefined) });
      setPlan({ kind: "ok", routes: r.routes, ms: r.ms });
    }, 150);
    return () => {
      clearTimeout(timer);
      if (runId.current === id) runId.current++;
    };
  }, [planKey, lang]);

  // roll bar of each wanted stat in the card's layout (or the target's main layout), for the card rows
  // biome-ignore lint/correctness/useExhaustiveDependencies: worked out with the disposition (formula.ts reads it), so it must refresh with it
  const barFor = useCallback(
    (tag: string) => {
      if (!cls) return null;
      const gs = allGroups(session.target).filter((x) => x.tags.includes(tag));
      if (!gs.length) return null;
      const l = cardLayout(session.card) ?? LAYOUTS.find((x) => effectiveLayouts(session.target).includes(layoutKey(x))) ?? LAYOUTS[3];
      // the card row counts as meeting the target when it meets any group that wants this stat
      return Math.min(...gs.map((g) => groupBar(cls, session.target, g, tag, l)));
    },
    [cls, session.target, session.card, session.disposition],
  );

  // while routes are worked out again the old ones stay on show, and so does the one open
  const shownRoutes = plan.kind === "ok" ? plan.routes : plan.kind === "busy" ? (plan.last ?? []) : [];
  const chosenKey = session.chosen && shownRoutes.some((r) => routeKey(r.route) === session.chosen) ? session.chosen : null;
  // the route the page has open: the step a comparison or a missed cycle is counted on
  const openRoute = routeView(shownRoutes, sortBy, session.kuva, chosenKey).open ?? undefined;

  const onMissed = (price: number, route: string) => {
    offerUndo(s.undo.missed);
    update((x) => afterMissed(x, price, route));
  };

  const onKeep = (which: 0 | 1) => {
    if (!compare || !cls) return;
    const kept = compare.cards[which];
    const locked = compare.cards[1].traits.some((t) => t.locked && !t.spliced);
    const { ids, kuvaShown } = compare;
    offerUndo(s.undo.keep, compare);
    update((x) => afterKeep(x, { ids, cycles: [compare.cards[0].cycles, compare.cards[1].cycles], locked, kuvaShown }, which, (cycles) => draftFrom(cls, kept, cycles), openRoute));
    setCompare(null);
  };

  const pick = () => {
    warmOcr();
    file.current?.click();
  };

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">
          <RivenMark size={34} />
          {s.title}
        </a>
        <nav className="tabs" aria-label="page">
          {(["coach", "ranges", "guide"] as const).map((p) => (
            <a key={p} href={p === "coach" ? "#/" : `#/${p}`} aria-current={page === p ? "page" : undefined}>
              {s.nav[p]}
            </a>
          ))}
        </nav>
        <LangSelect lang={lang} onChange={(l) => update((x) => ({ ...x, lang: l }))} />
        <ThemeButton s={s} />
      </header>

      {page === "guide" ? (
        <Guide lang={lang} />
      ) : page === "ranges" ? (
        <Ranges s={s} lang={lang} weaponId={session.weaponId} disposition={session.disposition} onDisposition={onDisposition} />
      ) : (
        <main className="coach">
          <div className="col-left">
            <Card
              s={s}
              session={session}
              cls={cls}
              pool={pool}
              shot={shot}
              ocr={ocr}
              barFor={barFor}
              onPick={pick}
              onWeapon={setWeapon}
              onCard={(card) => {
                cancelOcr();
                setCompare(null);
                update((x) => ({ ...x, card: cls ? withAutoValues(cls, card) : card, chosen: null }));
              }}
              onKuva={(kuva) => {
                cancelOcr();
                update((x) => ({ ...x, kuva }));
              }}
              onDemo={() => {
                offerUndo(s.undo.demo);
                const next = demoSession(lang);
                cancelOcr();
                setCompare(null);
                setShot(null);
                setSession(next);
                setSortBy(next.target.objective === "cycles" ? "cycles" : "kuva");
              }}
              onDisposition={onDisposition}
              onClear={() => {
                offerUndo(s.undo.clear);
                const next = { ...defaultSession(), lang };
                cancelOcr();
                setSession(next);
                setSortBy(next.target.objective === "cycles" ? "cycles" : "kuva");
                setCompare(null);
                setShot(null);
                setOcr({ kind: "idle" });
              }}
            />
            {cls && pool && <Target s={s} lang={lang} cls={cls} pool={pool} target={session.target} onChange={(target) => update((x) => ({ ...x, target, chosen: null }))} />}
          </div>
          <div className="col-right">
            {compare && cls && (
              <Compare
                s={s}
                lang={lang}
                cls={cls}
                cards={compare.cards}
                values={compare.values}
                objective={session.target.objective}
                fmt={(n) => fmtKuva(n, lang, true)}
                onKeep={onKeep}
              />
            )}
            {cls ? (
              <RouteList
                s={s}
                lang={lang}
                cls={cls}
                card={session.card}
                session={session}
                plan={plan}
                chosen={chosenKey}
                by={sortBy}
                onSort={(by) => {
                  setSortBy(by);
                  const objective = by === "cycles" ? "cycles" : "kuva";
                  if (objective !== session.target.objective) update((x) => ({ ...x, target: { ...x.target, objective } }));
                }}
                onChoose={(key) => update((x) => ({ ...x, chosen: key, step: { cycles: 0, kuva: 0 } }))}
                onMissed={onMissed}
                onPaste={pick}
                onRetry={() => setRetry((n) => n + 1)}
              />
            ) : (
              <section className="panel routes-panel">
                <p className="empty">{s.routes.needWeapon}</p>
              </section>
            )}
          </div>
        </main>
      )}

      <footer className="site-foot">
        <MailIcon />
        {s.contact}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </footer>

      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImage(f);
          e.target.value = "";
        }}
      />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <span>{s.card.paste}</span>
        </div>
      )}
      {undo ? (
        <div className="toast undo" role="status">
          {undo.what}
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              cancelOcr();
              // undoing a choice between two rivens brings the choice back
              setCompare(undo.compare ?? null);
              setSession(undo.before);
              setSortBy(undo.before.target.objective === "cycles" ? "cycles" : "kuva");
              setUndo(null);
            }}
          >
            {s.undo.label}
          </button>
        </div>
      ) : (
        toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )
      )}
    </div>
  );
}
