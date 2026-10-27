import { PLAN_ERROR } from "../engine/client";
import type { Lang, RivenClass } from "../engine/data";
import type { Unreachable } from "../engine/diagnose";
import type { RouteStats } from "../engine/engine.worker";
import { cycleCost } from "../engine/solver";
import { fmtKuva, fmtPct, type Strings } from "../i18n";
import { type CardDraft, type Session, statName } from "../state";
import { Segmented } from "./controls";
import { KuvaIcon, SplicerIcon, StatIcon } from "./icons";
import { type KeepWhen, keepWhen, lockedName, routeKey, routeTag, routeTitle, splicedOn } from "./routeText";

export type PlanView =
  | { kind: "idle"; reason: string }
  | { kind: "busy"; last?: RouteStats[] }
  | { kind: "done" }
  | { kind: "unreachable"; why: Unreachable }
  /** `code`: PLAN_ERROR (client.ts), TOO_COMPLEX (solver.ts), or a message of the planner's own */
  | { kind: "error"; code: string }
  | { kind: "ok"; routes: RouteStats[]; ms: number };

export type SortKey = "kuva" | "budget" | "cycles";

export function sortRoutes(routes: RouteStats[], by: SortKey) {
  const r = [...routes];
  // means that differ only by rounding count as equal and keep the solver's order (it puts the higher locked roll first)
  const near = (x: number) => Number(x.toPrecision(9));
  if (by === "budget") r.sort((a, b) => (b.withinBudget ?? 0) - (a.withinBudget ?? 0) || near(a.kuva.mean) - near(b.kuva.mean));
  else if (by === "cycles") r.sort((a, b) => near(a.cycles.mean) - near(b.cycles.mean));
  else r.sort((a, b) => near(a.kuva.mean) - near(b.kuva.mean));
  return r;
}

/**
 * The routes in the order shown, the one recommended (the solver's pick), and the one the page opens: the
 * recommended one, or the route the player opened while it is there.
 */
export function routeView(routesRaw: RouteStats[], by: SortKey, budget: number | null, chosen: string | null) {
  // sorting by "finishes within the Kuva you have" only means something when some route might not
  const budgetMatters = budget != null && routesRaw.some((r) => (r.withinBudget ?? 1) < 0.99);
  const sortBy: SortKey = by === "budget" && !budgetMatters ? "kuva" : by;
  const routes = sortRoutes(routesRaw, sortBy);
  const rec = (routes.find((r) => r.route.optimal) ?? routes[0])?.route ?? null;
  const open = chosen && routes.some((r) => routeKey(r.route) === chosen) ? chosen : rec ? routeKey(rec) : null;
  return { routes, sortBy, budgetMatters, rec, open };
}

interface Props {
  s: Strings;
  lang: Lang;
  cls: RivenClass;
  card: CardDraft;
  session: Session;
  plan: PlanView;
  chosen: string | null;
  by: SortKey;
  /** sorting by cycles also solves for fewest cycles; the other two solve for least kuva */
  onSort: (by: SortKey) => void;
  onChoose: (key: string) => void;
  /** a cycle of the open route that did not bring a better riven: its price and the route */
  onMissed: (price: number, route: string) => void;
  onPaste: () => void;
  /** work the routes out again after a failure */
  onRetry: () => void;
}

const fmtCycles = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

export function RouteList({ s, lang, cls, card, session, plan, chosen, by, onSort, onChoose, onMissed, onPaste, onRetry }: Props) {
  const budget = session.kuva;
  const routesRaw = plan.kind === "ok" ? plan.routes : plan.kind === "busy" ? plan.last : undefined;
  const { routes, sortBy, budgetMatters, open: openKey } = routeView(routesRaw ?? [], by, budget, chosen);
  // while the routes are worked out again (the card or the target changed) the old ones are only shown, not followed
  const stale = plan.kind === "busy";
  const head = (
    <header className="panel-h">
      <h2>{s.routes.title}</h2>
      {routesRaw && routesRaw.length > 1 && (
        <Segmented
          label={s.routes.title}
          value={sortBy}
          options={(["cycles", "kuva", "budget"] as const)
            .filter((k) => k !== "budget" || budgetMatters)
            .map((k) => ({ value: k, label: s.routes.sort[k], title: s.routes.sortTip[k] }))}
          onChange={onSort}
        />
      )}
    </header>
  );
  if (!routesRaw) {
    const msg =
      plan.kind === "idle"
        ? plan.reason
        : plan.kind === "busy"
          ? s.routes.computing
          : plan.kind === "done"
            ? s.routes.done
            : plan.kind === "unreachable"
              ? s.routes.why(plan.why, (t) => nameOf(cls, t, lang))
              : plan.kind === "error"
                ? s.routes.failed(plan.code)
                : "";
    return (
      <section className="panel routes-panel">
        {head}
        <p className={`empty${plan.kind === "done" ? " good" : plan.kind === "unreachable" || plan.kind === "error" ? " warn" : ""}`}>{msg}</p>
        {plan.kind === "error" && (
          <div className="loop retry">
            <button type="button" className="btn" onClick={onRetry}>
              {s.routes.retry}
            </button>
            {/* a calculator that did not start may be from an older version of the page */}
            {plan.code === PLAN_ERROR.startFailed && (
              <button type="button" className="btn" onClick={() => location.reload()}>
                {s.routes.reload}
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  // fewest cycles ranks, headlines and draws total cycles; least Kuva and the budget sort use Kuva
  const byCycles = sortBy === "cycles";
  const metric = (r: RouteStats) => (byCycles ? r.cycles : r.kuva);
  const scale = niceMax(Math.max(...routes.map((r) => metric(r).p90)));
  const pct = (x: number) => `${Math.min(100, (x / scale) * 100)}%`;
  const fmt = (n: number) => fmtKuva(n, lang);
  const fmtCount = (n: number) => (n < 10 ? n.toFixed(1) : fmtKuva(n, lang));
  const fmtTotal = (n: number) => (byCycles ? s.routes.totalCycles(fmtCount(n)) : fmt(n));
  // under the total the unit is already said (English "cycles" is long)
  const fmtSpread = (n: number) => (byCycles ? s.routes.spreadCycles(fmtCount(n)) : fmt(n));
  const spliced = splicedOn(card, cls);

  return (
    <section className={`panel routes-panel${plan.kind === "busy" ? " stale" : ""}`}>
      {head}
      <ol className="routes">
        {routes.map((r, i) => {
          const key = routeKey(r.route);
          const open = key === openKey;
          // the step's tally belongs to the route it was counted on
          const step = session.step.route === key ? session.step : { cycles: 0, kuva: 0 };
          const a = r.route.action;
          // a lock, or a spliced trait that stays locked, keeps the layout as it is
          const layoutFixed = a.kind === "cycle" && (a.lock !== "none" || (spliced != null && !a.drop));
          const k = keepWhen(r.route, cls, layoutFixed);
          const icon = routeTag(r.route, card);
          const locked = a.kind === "cycle" && a.lock !== "none";
          const price = cycleCost(card.cycles, locked);
          return (
            <li key={key} className={`route${r.route.optimal ? " rec" : ""}${open ? " open" : ""}`}>
              <button type="button" className="route-head" aria-expanded={open} onClick={() => !open && onChoose(key)}>
                <span className="route-no">{String(i + 1).padStart(2, "0")}</span>
                <span className="route-title">
                  {r.route.optimal && <span className="seal">{s.routes.rec}</span>}
                  {icon && <StatIcon tag={icon} />}
                  {routeTitle(r.route, cls, card, lang, s)}
                </span>
                <span className="route-num" title={a.kind === "splice" ? undefined : s.routes.perCycle(fmtPct(r.route.stepChance), fmtCycles(r.route.stepCycles))}>
                  {a.kind === "splice" ? (
                    <b>—</b>
                  ) : (
                    <>
                      <b>{fmtPct(r.route.stepChance)}</b>
                      <small>{s.routes.cycles(fmtCycles(r.route.stepCycles))}</small>
                    </>
                  )}
                </span>
                <span className="route-num total" title={byCycles ? s.routes.totalTip.cycles : s.routes.totalTip.kuva}>
                  <b>
                    {!byCycles && <KuvaIcon label={s.kuva} />}
                    {fmtTotal(metric(r).mean)}
                  </b>
                  <small>
                    {s.routes.median} {fmtSpread(metric(r).p50)} · {s.routes.p90} {fmtSpread(metric(r).p90)}
                  </small>
                  {byCycles && (
                    <small className="with-ico">
                      <KuvaIcon label={s.kuva} />
                      {fmt(r.kuva.mean)}
                    </small>
                  )}
                </span>
              </button>
              <div className="route-body">
                <span className="range" aria-hidden="true">
                  <i style={{ left: pct(metric(r).p10), width: `calc(${pct(metric(r).p90)} - ${pct(metric(r).p10)})` }} />
                  <em style={{ left: pct(metric(r).p25), width: `calc(${pct(metric(r).p75)} - ${pct(metric(r).p25)})` }} />
                  <b style={{ left: pct(metric(r).p50) }} />
                </span>
                {k && !open && <Keep k={k} s={s} cls={cls} lang={lang} max={3} />}
                <span className="route-foot">
                  {r.splicers > 0.05 && (
                    <span className="with-ico">
                      <SplicerIcon label={s.routes.splicers} />× {r.splicers.toFixed(r.splicers > 0.99 && r.splicers < 1.01 ? 0 : 2)}
                    </span>
                  )}
                  {r.withinBudget != null && (
                    <span>
                      {s.routes.within} {fmtPct(r.withinBudget)}
                    </span>
                  )}
                </span>
              </div>
              {open && (
                <div className="route-steps">
                  <ol className="steps">
                    {a.kind === "splice" ? (
                      <li>{s.steps.splice(nameOf(cls, a.a, lang), nameOf(cls, a.b, lang), nameOf(cls, a.result, lang))}</li>
                    ) : (
                      <>
                        {a.drop && spliced && <li>{s.steps.dropSpliced(nameOf(cls, spliced, lang))}</li>}
                        {locked ? (
                          <li>
                            {s.steps.lock(lockedName(r.route, cls, card, lang) ?? "")}
                            {/* the spliced trait is not cycled away by locking another one */}
                            {spliced && !a.drop && s.steps.alsoKept(nameOf(cls, spliced, lang))}
                          </li>
                        ) : (
                          !a.drop && <li>{spliced ? s.steps.keepSpliced(nameOf(cls, spliced, lang)) : s.steps.unlock}</li>
                        )}
                        <li>{s.steps.cycle(price.toLocaleString("en-US"))}</li>
                        {k && (
                          <li>
                            <Keep k={k} s={s} cls={cls} lang={lang} />
                          </li>
                        )}
                      </>
                    )}
                  </ol>
                  <div className="loop">
                    {a.kind !== "splice" && (
                      <button type="button" className="btn big" disabled={stale} onClick={() => onMissed(price, key)}>
                        {s.steps.missed}
                      </button>
                    )}
                    <button type="button" className="btn big primary" onClick={onPaste}>
                      {s.steps.paste}
                    </button>
                  </div>
                  <dl className="tally">
                    <div>
                      <dt>{s.steps.step}</dt>
                      <dd>
                        {step.cycles} <small>{a.kind === "splice" ? "" : s.steps.of(fmtCycles(r.route.stepCycles))}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>{s.steps.spent}</dt>
                      <dd>
                        <KuvaIcon label={s.kuva} />
                        {fmt(step.kuva)}
                      </dd>
                    </div>
                    <div>
                      <dt>{s.steps.total}</dt>
                      <dd>
                        <KuvaIcon label={s.kuva} />
                        {fmt(session.total.kuva)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="axis" aria-hidden="true">
        {[0, 0.5, 1].map((f) => (
          <span key={f}>{f === 0 ? "0" : fmtTotal(scale * f)}</span>
        ))}
      </div>
    </section>
  );
}

/** The keep-new rule; `max` shortens it in the route list (the open route shows all of it). */
function Keep({ k, s, cls, lang, max }: { k: KeepWhen; s: Strings; cls: RivenClass; lang: Lang; max?: number }) {
  // a separate element: spaces at the edge of a flex item are dropped
  const sep = <span className={lang === "en" ? "sep wide" : "sep"}>/</span>;
  const chips = max == null ? k.chips : k.chips.slice(0, max);
  return (
    <span className="keep">
      <span className="keep-label">{s.routes.keepWhen}</span>
      {chips.map((c) => (
        <span className="tag" key={c.key}>
          {c.parts.length === 0 && <span>{c.negOk || k.negOk ? s.routes.negBecomesOk : s.routes.betterMix}</span>}
          {c.parts.map((p, i) => (
            <span key={p.stats.map((x) => x.tag).join("|")} className="tag-part">
              {i > 0 && <span className="plus">+</span>}
              {p.count > 1 && <span className="tag-n">{s.routes.anyOf(p.count)}</span>}
              {p.stats.map((x, j) => (
                <span key={x.tag} className="stat-name">
                  {j > 0 && sep}
                  <StatIcon tag={x.tag} />
                  {x.neg && "−"}
                  {nameOf(cls, x.tag, lang)}
                  {x.bar}
                </span>
              ))}
            </span>
          ))}
          {c.layout && <span className="tag-q">{c.layout}</span>}
          {c.negOk && c.parts.length > 0 && <span className="tag-q">{s.routes.negOk}</span>}
        </span>
      ))}
      {chips.length < k.chips.length && <span className="tag muted">…</span>}
      {k.partial && <span className="tag soft">{k.chips.length ? s.routes.restCompare : s.routes.allCompare}</span>}
      {k.negOk && <span className="tag soft">{s.routes.negOk}</span>}
      {k.layout && <span className="tag soft">{k.layout}</span>}
    </span>
  );
}

function nameOf(cls: RivenClass, tag: string, lang: Lang) {
  try {
    return statName(cls, tag, lang);
  } catch {
    return tag;
  }
}

function niceMax(x: number) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}
