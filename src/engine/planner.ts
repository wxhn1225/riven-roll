import { weaponById } from "./data";
import { poolFor } from "./pool";
import { type Card, DISCOUNTED_CYCLES, type Objective, type Route, Solver, type Target, TOO_COMPLEX, TooComplexError, WorkAccount } from "./solver";

/**
 * Most work (see TooComplexError) the solved graphs of one worker may hold together, the one being built included.
 * About 90 bytes of memory a unit, so near 180 MB.
 */
export const WORK_BUDGET = 2_000_000;
/** solved graphs kept for reuse (the current card and a comparison) */
const KEEP_SOLVED = 2;

export interface PlanRequest {
  id: number;
  weaponId: string;
  card: Card;
  target: Target;
  objective: Objective;
  cyclesDone: number;
  budget: number | null;
  runs: number;
  /** Additional cards evaluated in the selected objective's units. */
  compare?: Card[];
}

export interface Quantiles {
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface RouteStats {
  route: Route;
  kuva: Quantiles;
  cycles: Quantiles;
  splicers: number;
  withinBudget: number | null;
}

export type PlanResponse =
  | {
      id: number;
      ok: true;
      done: boolean;
      reachable: boolean;
      routes: RouteStats[];
      states: number;
      ms: number;
      compareValues: number[];
      /** For each compared card, the negative that alone keeps it from the target, or null. */
      compareNeg: (string | null)[];
    }
  | { id: number; ok: false; error: string };

type Success = Extract<PlanResponse, { ok: true }>;

function quantiles(sorted: Float64Array): Quantiles {
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  return {
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
  };
}

function withinBudget(sorted: Float64Array, budget: number | null): number | null {
  if (budget == null) return null;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= budget) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/** A worker keeps a bounded set of solved graphs and the most recent simulation. */
export class Planner {
  private modelKey = "";
  private solved = new Map<string, { solver: Solver; start: ReturnType<Solver["solve"]> }>();
  private cached: { key: string; response: Success; samples: Float64Array[] } | null = null;
  /** the budget all solved graphs share; a graph let go gives its work back */
  private account: WorkAccount;

  constructor(
    private rng: () => number = Math.random,
    budget = WORK_BUDGET,
  ) {
    this.account = new WorkAccount(budget);
  }

  plan(req: PlanRequest): PlanResponse {
    const started = performance.now();
    const hadGraphs = this.solved.size > 0;
    try {
      return this.work(req, started);
    } catch (error) {
      if (error instanceof TooComplexError) {
        this.forget();
        let stopped = error;
        // graphs kept from earlier inputs may have taken the room: once more with the whole budget before giving up
        if (hadGraphs) {
          try {
            return this.work(req, started);
          } catch (again) {
            if (!(again instanceof TooComplexError)) return this.failed(req, again);
            this.forget();
            stopped = again;
          }
        }
        const { work, states } = stopped;
        console.warn("[plan] stopped: too complex", { work, states, ms: Math.round(performance.now() - started) });
        return { id: req.id, ok: false, error: TOO_COMPLEX };
      }
      return this.failed(req, error);
    }
  }

  private failed(req: PlanRequest, error: unknown): PlanResponse {
    console.warn("[plan] failed", error);
    return { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  /** Let every graph go (and its work), with the simulation kept for them. */
  private forget() {
    this.solved.clear();
    this.cached = null;
    this.account.used = 0;
  }

  /** Let one graph go, giving its work back. */
  private evict(key: string) {
    const entry = this.solved.get(key);
    if (!entry) return;
    this.account.used -= entry.solver.workUsed;
    this.solved.delete(key);
  }

  private work(req: PlanRequest, started: number): PlanResponse {
    if (!Number.isSafeInteger(req.runs) || req.runs < 1 || req.runs > 100_000) throw new Error("Invalid simulation count");
    if (!Number.isSafeInteger(req.cyclesDone) || req.cyclesDone < 0) throw new Error("Invalid cycle count");
    if (req.budget != null && (!Number.isFinite(req.budget) || req.budget < 0)) throw new Error("Invalid Kuva budget");
    const weapon = weaponById(req.weaponId);
    if (!weapon) throw new Error("Unknown weapon");
    const cards = [req.card, ...(req.compare ?? [])];
    const seen = {
      pos: [...new Set(cards.flatMap((c) => [...c.pos, ...(c.spliced ? [c.spliced] : [])].map((t) => t.tag)))].sort(),
      neg: [...new Set(cards.flatMap((c) => (c.neg ? [c.neg.tag] : [])))].sort(),
    };
    const pool = poolFor(weapon, seen);
    // the state each card starts the solve from: cards in the same state share one graph
    const states = new Solver(pool, req.target, req.objective);
    const stateKey = (card: Card) => states.stateOf(card).key;
    // a card that already meets the target needs no plan: a quick check, not a full solve
    if (!req.compare?.length && states.isGoal(states.stateOf(req.card)))
      return { id: req.id, ok: true, done: true, reachable: true, routes: [], states: states.stateCount, ms: performance.now() - started, compareValues: [], compareNeg: [] };
    // past the discounted cycles the count no longer changes any price: one plan (and one simulation) serves them all
    const priced = Math.min(req.cyclesDone, DISCOUNTED_CYCLES);
    const modelKey = JSON.stringify([req.weaponId, req.target, req.objective, seen]);
    if (modelKey !== this.modelKey) {
      this.modelKey = modelKey;
      this.forget();
    }
    const key = JSON.stringify([modelKey, req.card, req.compare, priced, req.runs]);
    if (this.cached?.key !== key) {
      const solve = (card: Card) => {
        const start = stateKey(card);
        const existing = this.solved.get(start);
        if (existing) {
          // most recently used last, so it is the last to go
          this.solved.delete(start);
          this.solved.set(start, existing);
          return existing;
        }
        // make room before building: old graphs go first, so they never sit in memory next to the new one
        while (this.solved.size && (this.solved.size >= KEEP_SOLVED || this.account.used > this.account.limit / 2)) this.evict(this.solved.keys().next().value as string);
        const solver = new Solver(pool, req.target, req.objective, this.account);
        const entry = { solver, start: solver.solve(card) };
        this.solved.set(start, entry);
        return entry;
      };
      // Of a riven that is not the current one only the value is needed. Those go first, one at a time, each graph
      // giving its room back before the next; the current card comes last and keeps its graph for the routes.
      // Values stay in the order asked (left and right on the page), and a riven in a state asked twice is worked out once.
      const current = stateKey(req.card);
      const compare = (req.compare ?? []).map(stateKey);
      const values = new Map<string, number>();
      for (const [i, key] of compare.entries()) {
        if (key === current || values.has(key)) continue;
        const { solver, start } = solve((req.compare as Card[])[i]);
        values.set(key, solver.value[start.id]);
        this.evict(key);
      }
      const { solver, start } = solve(req.card);
      values.set(current, solver.value[start.id]);
      const compareValues = compare.map((key) => values.get(key) as number);
      // a compared card that would meet the target if its negative were accepted
      const compareNeg = (req.compare ?? []).map((card) => {
        const neg = card.neg?.tag;
        if (!neg || req.target.groups.some((g) => g.tags.includes(neg)) || states.isGoal(states.stateOf(card))) return null;
        const accepting = new Solver(pool, { ...req.target, allowedNeg: [...req.target.allowedNeg, neg] }, req.objective);
        return accepting.isGoal(accepting.stateOf(card)) ? neg : null;
      });
      const done = solver.isGoal(start);
      const reachable = Number.isFinite(solver.value[start.id]);
      const samples: Float64Array[] = [];
      const routes = !done && reachable ? solver.routes(req.card) : [];
      // the exact means with the introductory prices, all routes in one pass
      const kuvaMeans = solver.expectedKuvas(req.card, routes, priced);
      const stats = routes.map((route, r): RouteStats => {
        const sim = solver.simulate(req.card, route, priced, req.runs, this.rng);
        const sortedKuva = sim.kuva.sort();
        samples.push(sortedKuva);
        const kuva = quantiles(sortedKuva);
        const cycles = quantiles(sim.cycles.sort());
        kuva.mean = kuvaMeans[r];
        if (req.objective === "cycles") cycles.mean = route.expected;
        return {
          route,
          kuva,
          cycles,
          splicers: sim.splicers.reduce((sum, n) => sum + n, 0) / sim.splicers.length,
          withinBudget: null,
        };
      });
      this.cached = {
        key,
        samples,
        response: { id: req.id, ok: true, done, reachable, routes: stats, states: solver.stateCount, ms: 0, compareValues, compareNeg },
      };
    }
    const cached = this.cached;
    return {
      ...cached.response,
      id: req.id,
      ms: performance.now() - started,
      routes: cached.response.routes.map((stats, i) => ({ ...stats, withinBudget: withinBudget(cached.samples[i], req.budget) })),
    };
  }
}
