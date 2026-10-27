// Optimal cycling policy for a target riven.
//
// Model (from game data; the uniform draws are assumptions, see 机制说明 on the site):
// - an unlocked cycle picks 2 or 3 positives and 0 or 1 negative uniformly (4 layouts, 25% each);
// - a trait lock or a spliced trait freezes the layout; a lock doubles the Kuva cost;
// - a spliced trait is locked for free; its lock can be removed so the next cycle replaces it;
// - stats are drawn uniformly without replacement, positives first, then the negative from what is left;
// - each new trait's roll quality W is uniform on [0.9, 1.1];
// - a spliced trait keeps the higher roll of its two ingredients, the negative's roll included;
// - after a cycle the player keeps whichever of old/new is better, so values only ever go down.
//
// Traits that play the same role for the target are interchangeable, so the state space stays small.
// Values are solved exactly with a Dijkstra-style sweep: a state's value only depends on states with
// lower values, because worse results are never kept.

import { LAYOUTS, type Layout, W_MAX, W_MIN } from "./formula";
import type { Pool } from "./pool";

export interface Group {
  /** Any one of these stats satisfies the group (normal or spliced stats). */
  tags: string[];
  /** Minimum roll quality W; 0.9 means any value. */
  minW: number;
  /**
   * Per-stat, per-layout minimum W, keyed by stat tag then layout key ("31"). Used when the player asks
   * for a shown value (e.g. multishot ≥ 110%), which needs a different roll in each layout and per stat.
   */
  minWBy?: Record<string, Record<string, number>>;
}

export interface Target {
  groups: Group[];
  /**
   * Alternative goals as lists of group indexes: the riven is done when every group of any one set is met
   * (e.g. damage + multishot + corrosive, or multishot + critical damage + status damage). Default: one set
   * with all groups.
   */
  sets?: number[][];
  layouts: Layout[];
  /** Negative stats the player accepts (used when the final layout has a negative). */
  allowedNeg: string[];
  /** Extra rule: at least `k` of a set's groups (all of them if it has fewer) reach roll quality `w` (e.g. any 2 of 3 at 1.08 or more). */
  atLeast?: { k: number; w: number };
}

export interface CardTrait {
  tag: string;
  w: number;
}

export interface Card {
  layout: Layout;
  pos: CardTrait[];
  neg: CardTrait | null;
  spliced: CardTrait | null;
}

export type Objective = "kuva" | "cycles";
export const KUVA_UNLOCKED = 3500;
const KUVA_STEPS = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150];
/** From this many cycles on every cycle costs the same, so plans for 9 and for 160 done cycles are the same plan. */
export const DISCOUNTED_CYCLES = KUVA_STEPS.length;
export const cycleCost = (done: number, locked: boolean) => (done < KUVA_STEPS.length ? KUVA_STEPS[done] : KUVA_UNLOCKED) * (locked ? 2 : 1);

/** Sum the short introductory price schedule, then charge the remaining cycles at the flat rate. */
export function cycleCostTotal(done: number, count: number, locked: boolean): number {
  let total = 0;
  const cheap = Math.min(count, Math.max(0, KUVA_STEPS.length - done));
  for (let j = 0; j < cheap; j++) total += KUVA_STEPS[done + j];
  return (total + (count - cheap) * KUVA_UNLOCKED) * (locked ? 2 : 1);
}

// ---------- roles ----------

interface Role {
  id: number;
  stats: string[];
  canPos: boolean;
  canNeg: boolean;
  allowed: boolean;
  groups: number[]; // target groups this stat can fill; empty when not a target stat
  recipes: number[]; // relevant splice recipes this stat feeds
  /** thresholds that matter for this role, ascending; bucket b means W >= th[b-1] */
  th: number[];
  /** the same for this stat as the negative: only the bars of the splices it feeds matter */
  nth: number[];
}

/** A stat outside the weapon's pool (it cannot be drawn, locked usefully or spliced). */
const JUNK = -1;
/** Spliced traits the target does not want are all alike: only a card brings one (the plan never splices them). */
const OTHER_SPLICED = "*:0";

interface State {
  id: number;
  key: string;
  pos: number; // layout positives
  neg: number; // layout negatives
  /**
   * "" or `${tag}:${level}`, level = how many of its group's thresholds the roll meets; a leading "!" marks a
   * trait the plan spliced itself, whose lock is never removed (a splicer is not spent twice)
   */
  spl: string;
  types: number[]; // non-spliced positive trait types, sorted
  negRole: number; // -1 none
  negB: number; // bucket of the negative's roll in its role's nth
}

interface Dist {
  key: string;
  to: Map<number, number>; // state id -> probability
}

/** A cycle distribution's results (p > 0) sorted by value: what a cycle keeps, the results below a value, is a prefix. */
interface SortedDist {
  ids: Int32Array;
  ps: Float64Array;
  values: Float64Array;
  /** chance of the first i results */
  chance: Float64Array;
  /** the longest prefix any state keeps */
  need: number;
  /** scratch: sum of p × (a value per state) over the first i results, filled up to `filled` */
  sums: Float64Array;
  filled: number;
}

/** What the solved policy does in each unfinished state, in order of value. */
type PolicyStep = { id: number; kind: "cycle"; locked: boolean; s: SortedDist; k: number; q: number } | { id: number; kind: "splice"; dist: Dist };

interface Action {
  kind: "cycle" | "splice";
  /** For cycle: "none", "neg", or the positive type code locked. For splice: recipe index. */
  lock: "none" | "neg" | number;
  recipe: number;
  dist: Dist;
  cost: number;
  locked: boolean;
  /** cycle with the spliced trait's lock removed, so the cycle replaces it */
  drop: boolean;
}

interface KeepResult {
  q: number;
  expected: number;
  keep: { to: number; p: number; v: number }[];
  cumulative: Float64Array;
}

export interface Route {
  action: { kind: "cycle"; lock: "none" | "neg" | { tag: string; stats: string[]; w: number }; drop?: true } | { kind: "splice"; result: string; a: string; b: string };
  /** chance one cycle improves on the current card (1 for splice) */
  stepChance: number;
  stepCycles: number;
  stepCyclesP90: number;
  expected: number; // expected total cost in the solve objective
  outcomes: Outcome[]; // what counts as an improvement, most likely first
  /** the results that are worse than the current card, described the same way (a hint must not take any of them) */
  worse: Outcome[];
  optimal: boolean;
}

export interface Need {
  stats: string[];
  minW: number;
  /** the negative must be this stat with at least this roll (it feeds a splice) */
  neg?: true;
}

export interface Outcome {
  prob: number; // share among improving results
  needs: Need[];
  negAllowed: boolean | null; // null when the result has no negative
  layout: Layout;
}

/** Error code of a plan stopped because it needs more work than its budget (see Solver `limit`). */
export const TOO_COMPLEX = "too-complex";

/**
 * The target needs more work than the budget allows: the plan stops while it grows instead of running out of memory.
 * Work counts what a solve keeps in memory as it is made: states and their actions, outcomes of every distribution,
 * and outcomes kept for routes.
 */
export class TooComplexError extends Error {
  constructor(
    readonly work: number,
    readonly states: number,
  ) {
    super(TOO_COMPLEX);
  }
}

/**
 * Work shared by every solver of a worker: each charges it while it grows, and the planner gives a graph's work back
 * when it lets the graph go. One account, so graphs kept side by side cannot pass the budget together.
 */
export class WorkAccount {
  used = 0;
  constructor(readonly limit: number) {}
}

export class Solver {
  readonly roles: Role[] = [];
  private roleOfStat = new Map<string, number>();
  private negStats: string[];
  private states: State[] = [];
  private byKey = new Map<string, State>();
  private dists = new Map<string, Dist>();
  private cycles = new Map<string, Action>();
  private actions: Action[][] = [];
  value: Float64Array = new Float64Array(0);
  private best: Int32Array = new Int32Array(0);
  private relevantRecipes: number[] = [];
  private splicedGroups = new Map<string, number[]>();
  private sets: number[][];
  // pure functions of the target, called inside the hottest loops
  private thCache = new Map<string, number[]>();
  private typeCache = new Map<number, number>();
  private goalCache = new Map<number, boolean>();
  private typeStride = 1;
  // results worth keeping depend only on the distribution, the price and the value to beat: states that share them
  // share one entry (cleared with every solve, since the values change)
  private keepCache = new Map<string, KeepResult>();
  private kuvaPolicy: Float64Array | null = null;
  // the policy's steps and their sorted distributions, shared by every price evaluation of one solve
  private steps: { list: PolicyStep[]; sorted: Map<Dist, SortedDist> } | null = null;
  private work = 0;

  constructor(
    readonly pool: Pool,
    readonly target: Target,
    readonly objective: Objective = "kuva",
    /** the budget this solver charges (see TooComplexError); past its limit, it throws */
    private readonly account = new WorkAccount(Number.POSITIVE_INFINITY),
  ) {
    this.negStats = pool.neg;
    this.sets = target.sets?.length ? target.sets : [target.groups.map((_, i) => i)];
    this.buildRoles();
    this.typeStride = 1 + Math.max(0, ...this.roles.map((r) => r.th.length));
  }

  private typeCode(role: number, bucket: number) {
    return role * this.typeStride + bucket;
  }

  private typeRole(type: number) {
    return type === JUNK ? -1 : Math.floor(type / this.typeStride);
  }

  private typeBucket(type: number) {
    return type === JUNK ? 0 : type % this.typeStride;
  }

  // ---------- roles and buckets ----------

  private buildRoles() {
    const { pool, target } = this;
    const groupsOf = new Map<string, number[]>();
    target.groups.forEach((g, i) => {
      for (const t of g.tags) groupsOf.set(t, [...(groupsOf.get(t) ?? []), i]);
    });
    for (const [t, gs] of groupsOf) if (pool.spliced.includes(t)) this.splicedGroups.set(t, gs);
    this.relevantRecipes = pool.splices.map((r, i) => (groupsOf.has(r.result) ? i : -1)).filter((i) => i >= 0);
    const allowed = new Set(target.allowedNeg);
    const sig = new Map<string, Role>();
    for (const tag of new Set([...pool.pos, ...pool.neg])) {
      const recipes = this.relevantRecipes.filter((i) => pool.splices[i].a === tag || pool.splices[i].b === tag);
      const groups = groupsOf.get(tag) ?? [];
      const canPos = pool.pos.includes(tag);
      const canNeg = pool.neg.includes(tag);
      const nth = [...new Set(recipes.flatMap((r) => this.splTh(pool.splices[r].result)))].sort((a, b) => a - b);
      const th = [...new Set([...groups.flatMap((g) => this.tagTh(g, tag)), ...nth])].sort((a, b) => a - b);
      // ingredients keep their own identity (a recipe needs two specific stats), and so do wanted stats whose
      // bar is a shown value (each stat converts it to a different roll)
      const own = recipes.length > 0 || groups.some((g) => target.groups[g].minWBy != null);
      // a stat kept from an old roll is never drawn, so it never shares a role with one that is
      const kept = [pool.keptPos.includes(tag), pool.keptNeg.includes(tag)];
      const key = JSON.stringify([own ? tag : "", groups, canPos, canNeg, allowed.has(tag), th, kept]);
      let role = sig.get(key);
      if (!role) {
        role = { id: this.roles.length, stats: [], canPos, canNeg, allowed: allowed.has(tag), groups, recipes, th, nth };
        sig.set(key, role);
        this.roles.push(role);
      }
      role.stats.push(tag);
      this.roleOfStat.set(tag, role.id);
    }
  }

  private relevant(r: Role) {
    return r.groups.length > 0 || r.recipes.length > 0;
  }

  /** bucket of W for a role: number of thresholds met */
  private bucket(r: Role, w: number) {
    let b = 0;
    for (const t of r.th) if (w >= t) b++;
    return b;
  }

  /** probability of each bucket for a fresh roll */
  private bucketProbs(r: Role, th = r.th): number[] {
    const edges = [W_MIN, ...th, W_MAX];
    const out: number[] = [];
    for (let i = 0; i + 1 < edges.length; i++) out.push((edges[i + 1] - edges[i]) / (W_MAX - W_MIN));
    return out;
  }

  /** Minimum roll for `tag` to satisfy group g when the riven has layout `lk` ("31"). */
  private need(g: number, tag: string, lk: string): number {
    const grp = this.target.groups[g];
    return grp.minWBy?.[tag]?.[lk] ?? grp.minW;
  }

  /** Roll thresholds that matter for `tag` in group g, ascending: its bar in each final layout and the count-rule bar. */
  private tagTh(g: number, tag: string): number[] {
    const key = `${g}|${tag}`;
    let th = this.thCache.get(key);
    if (!th) {
      const { layouts, atLeast } = this.target;
      const bars = layouts.map((l) => this.need(g, tag, `${l.pos}${l.neg}`));
      if (atLeast) bars.push(...bars.map((b) => Math.max(b, atLeast.w)));
      // Keep impossible goal bars in need(), but never turn them into probability intervals.
      th = [...new Set(bars)].filter((x) => x > W_MIN && x <= W_MAX).sort((a, b) => a - b);
      this.thCache.set(key, th);
    }
    return th;
  }

  /** Roll thresholds that matter for a spliced stat over every group it can fill, ascending. */
  private splTh(tag: string): number[] {
    const key = `s|${tag}`;
    let th = this.thCache.get(key);
    if (!th) {
      const gs = this.splicedGroups.get(tag) ?? [];
      th = [...new Set(gs.flatMap((g) => this.tagTh(g, tag)))].sort((a, b) => a - b);
      this.thCache.set(key, th);
    }
    return th;
  }

  /** A spliced trait stores how many of its splTh thresholds it meets; does that reach roll t? */
  private splicedMeets(tag: string, level: number, t: number) {
    if (t <= W_MIN) return true;
    const th = this.splTh(tag);
    return level > 0 && th[level - 1] >= t;
  }

  /** Does the negative reach roll quality t? */
  private negMeets(s: State, t: number) {
    if (t <= W_MIN) return true;
    return s.negRole >= 0 && s.negB > 0 && this.roles[s.negRole].nth[s.negB - 1] >= t;
  }

  /** A fresh negative of this role: yields [bucket, probability]. */
  private negDraws(roleId: number): [number, number][] {
    const r = this.roles[roleId];
    if (!r.nth.length) return [[0, 1]];
    return this.bucketProbs(r, r.nth)
      .map((p, b) => [b, p] as [number, number])
      .filter(([, p]) => p > 0);
  }

  /** Does a trait type reach roll quality t? Bucket b means W >= th[b-1]. */
  private meets(type: number, t: number) {
    if (t <= W_MIN) return true;
    const b = this.typeBucket(type);
    return b > 0 && this.roles[this.typeRole(type)].th[b - 1] >= t;
  }

  /**
   * Every trait keeps its role, even when it does not help the target: locking any trait fixes the layout,
   * and a trait still on the card cannot be drawn again. Stats that play the same role stay interchangeable.
   */
  private typeFor(roleId: number, bucket: number): number {
    return this.typeCode(roleId, bucket);
  }

  /** Does this trait count toward the target (or feed a wanted splice)? Used to describe results. */
  private useful(type: number): boolean {
    if (type === JUNK) return false;
    const hit = this.typeCache.get(type);
    if (hit != null) return hit === 1;
    const r = this.roles[this.typeRole(type)];
    let ok = r.recipes.length > 0;
    if (!ok && r.groups.length) {
      // useful when it satisfies one of its groups in at least one accepted final layout
      const lowest = Math.min(...r.groups.flatMap((g) => this.target.layouts.map((l) => this.need(g, r.stats[0], `${l.pos}${l.neg}`))));
      ok = this.meets(type, lowest);
    }
    this.typeCache.set(type, ok ? 1 : 0);
    return ok;
  }

  // ---------- states ----------

  /** Count `n` units of work, and stop once the budget is spent. */
  private charge(n: number) {
    this.work += n;
    this.account.used += n;
    if (this.account.used > this.account.limit) throw new TooComplexError(this.account.used, this.states.length);
  }

  /** Work taken on so far (states, distribution outcomes, kept outcomes). */
  get workUsed() {
    return this.work;
  }

  private intern(pos: number, neg: number, spl: string, types: number[], negRole: number, negB: number): State {
    const sorted = [...types].sort((a, b) => a - b);
    const key = `${pos}${neg}|${spl}|${sorted.join(",")}|${negRole}:${negB}`;
    let s = this.byKey.get(key);
    if (!s) {
      this.charge(1);
      s = { id: this.states.length, key, pos, neg, spl, types: sorted, negRole, negB };
      this.states.push(s);
      this.byKey.set(key, s);
    }
    return s;
  }

  stateOf(card: Card): State {
    return this.stateFor(card);
  }

  private stateFor(card: Card): State {
    const types = card.pos.map((t) => {
      const role = this.roleOfStat.get(t.tag);
      return role == null ? JUNK : this.typeFor(role, this.bucket(this.roles[role], t.w));
    });
    let spl = "";
    if (card.spliced) {
      const w = card.spliced.w;
      spl = this.splicedGroups.has(card.spliced.tag) ? `${card.spliced.tag}:${this.splTh(card.spliced.tag).filter((t) => w >= t).length}` : OTHER_SPLICED;
    }
    const negRole = card.neg ? (this.roleOfStat.get(card.neg.tag) ?? -2) : -1;
    const w = card.neg?.w ?? W_MIN;
    const negB = negRole >= 0 ? this.roles[negRole].nth.filter((t) => w >= t).length : 0;
    return this.intern(card.layout.pos, card.layout.neg, spl, types, negRole, negB);
  }

  isGoal(s: State): boolean {
    let goal = this.goalCache.get(s.id);
    if (goal == null) {
      goal =
        this.target.layouts.some((l) => l.pos === s.pos && l.neg === s.neg) &&
        (s.neg === 0 || (s.negRole >= 0 && this.roles[s.negRole].allowed)) &&
        this.sets.some((set) => this.meetsSet(s, set));
      this.goalCache.set(s.id, goal);
    }
    return goal;
  }

  /** Match each group to a distinct trait; overlapping alternatives cannot reuse one slot. */
  private meetsSet(s: State, set: number[]): boolean {
    const [splTag, splLevel] = s.spl.replace(/^!/, "").split(":");
    const { atLeast } = this.target;
    const lk = `${s.pos}${s.neg}`;
    const matches = set.map((gi) => {
      const choices: { slot: number; high: boolean }[] = [];
      if (splTag && this.splicedGroups.get(splTag)?.includes(gi)) {
        const need = this.need(gi, splTag, lk);
        if (this.splicedMeets(splTag, Number(splLevel), need)) {
          choices.push({ slot: s.types.length, high: atLeast != null && this.splicedMeets(splTag, Number(splLevel), Math.max(need, atLeast.w)) });
        }
      }
      for (let slot = 0; slot < s.types.length; slot++) {
        const type = s.types[slot];
        if (type === JUNK || !this.roles[this.typeRole(type)].groups.includes(gi)) continue;
        const need = this.need(gi, this.roles[this.typeRole(type)].stats[0], lk);
        if (this.meets(type, need)) choices.push({ slot, high: atLeast != null && this.meets(type, Math.max(need, atLeast.w)) });
      }
      return choices;
    });
    if (matches.some((choices) => choices.length === 0) || set.length > s.types.length + (splTag ? 1 : 0)) return false;
    matches.sort((a, b) => a.length - b.length);
    const highNeeded = atLeast ? Math.min(atLeast.k, set.length) : 0;
    const match = (group: number, used: number, high: number): boolean => {
      if (group === matches.length) return high >= highNeeded;
      return matches[group].some(({ slot, high: isHigh }) => !(used & (1 << slot)) && match(group + 1, used | (1 << slot), high + (isHigh ? 1 : 0)));
    };
    return match(0, 0, 0);
  }

  // ---------- transitions ----------

  /** Enumerate drawing k distinct stats from role counts: yields [count per role, probability]. */
  private *draws(counts: number[], k: number): Generator<[number[], number]> {
    const total = counts.reduce((a, b) => a + b, 0);
    if (k === 0) {
      yield [counts.map(() => 0), 1];
      return;
    }
    if (total < k) return;
    const denom = choose(total, k);
    const pick = new Array(counts.length).fill(0);
    function* rec(i: number, left: number, w: number): Generator<[number[], number]> {
      if (i === counts.length) {
        if (left === 0) yield [[...pick], w / denom];
        return;
      }
      for (let c = 0; c <= Math.min(left, counts[i]); c++) {
        pick[i] = c;
        yield* rec(i + 1, left - c, w * choose(counts[i], c));
      }
      pick[i] = 0;
    }
    yield* rec(0, k, 1);
  }

  /** Bucket multisets for c draws of one role: yields [types, prob]. */
  private *bucketDraws(roleId: number, c: number): Generator<[number[], number]> {
    const r = this.roles[roleId];
    if (!this.relevant(r)) {
      yield [new Array(c).fill(this.typeCode(roleId, 0)), 1];
      return;
    }
    const probs = this.bucketProbs(r);
    const n = probs.length;
    const pick = new Array(n).fill(0);
    const self = this;
    function* rec(i: number, left: number): Generator<[number[], number]> {
      if (i === n - 1) {
        pick[i] = left;
        let p = factorial(c);
        const types: number[] = [];
        for (let b = 0; b < n; b++) {
          p *= probs[b] ** pick[b] / factorial(pick[b]);
          for (let j = 0; j < pick[b]; j++) types.push(self.typeFor(roleId, b));
        }
        if (p > 0) yield [types, p];
        return;
      }
      for (let x = 0; x <= left; x++) {
        pick[i] = x;
        yield* rec(i + 1, left - x);
      }
    }
    yield* rec(0, c);
  }

  /** How many stats of each role a new cycle can draw (stats kept from an old roll are not drawn). */
  private roleCounts(kind: "pos" | "neg"): number[] {
    const { pos, keptPos, keptNeg } = this.pool;
    return this.roles.map((r) =>
      kind === "pos"
        ? r.canPos
          ? r.stats.filter((t) => pos.includes(t) && !keptPos.includes(t)).length
          : 0
        : r.canNeg
          ? r.stats.filter((t) => this.negStats.includes(t) && !keptNeg.includes(t)).length
          : 0,
    );
  }

  /** `n` stats of a role are on the riven, so a draw cannot repeat them (a role that is never drawn stays at 0). */
  private taken(counts: number[], role: number, n = 1) {
    counts[role] = Math.max(0, counts[role] - n);
  }

  private cycleDist(s: State, lock: "none" | "neg" | number, drop = false): Dist {
    // without its lock the spliced trait is cycled like any other trait: the result has none
    const spl = drop ? "" : s.spl;
    const fixed = lock !== "none" || spl !== "";
    const key = `c|${fixed ? `${s.pos}${s.neg}` : "*"}|${spl}|${lock === "neg" ? `n${s.negRole}:${s.negB}` : lock}`;
    const hit = this.dists.get(key);
    if (hit) return hit;
    const to = new Map<number, number>();
    const layouts = fixed ? [{ pos: s.pos as 2 | 3, neg: s.neg as 0 | 1 }] : LAYOUTS;
    const lockedType = typeof lock === "number" ? lock : null;
    const lockedRole = lockedType != null ? this.typeRole(lockedType) : -1;
    for (const layout of layouts) {
      const pl = 1 / layouts.length;
      const kFree = layout.pos - (spl ? 1 : 0) - (lockedType != null ? 1 : 0);
      const posCounts = this.roleCounts("pos");
      if (lockedRole >= 0) this.taken(posCounts, lockedRole);
      if (lock === "neg" && s.negRole >= 0 && this.roles[s.negRole].canPos) this.taken(posCounts, s.negRole);
      for (const [pick, pp] of this.draws(posCounts, kFree)) {
        // bucket assignments per role (cartesian product)
        let combos: [number[], number][] = [[lockedType != null ? [lockedType] : [], 1]];
        pick.forEach((c, roleId) => {
          if (!c) return;
          const next: [number[], number][] = [];
          for (const [types, p] of combos) for (const [bt, bp] of this.bucketDraws(roleId, c)) next.push([[...types, ...bt], p * bp]);
          combos = next;
        });
        // negative: [role, bucket, probability]
        let negs: [number, number, number][] = [[-1, 0, 1]];
        if (layout.neg === 1) {
          if (lock === "neg") negs = [[s.negRole, s.negB, 1]];
          else {
            const nc = this.roleCounts("neg");
            pick.forEach((c, roleId) => {
              if (this.roles[roleId].canNeg) this.taken(nc, roleId, c);
            });
            if (lockedRole >= 0 && this.roles[lockedRole].canNeg) this.taken(nc, lockedRole);
            const tot = nc.reduce((a, b) => a + Math.max(0, b), 0);
            negs = nc.flatMap((c, roleId) => (c > 0 ? this.negDraws(roleId).map(([b, bp]) => [roleId, b, (c / tot) * bp] as [number, number, number]) : []));
          }
        }
        for (const [types, p] of combos)
          for (const [nr, nb, np] of negs) {
            const t = this.intern(layout.pos, layout.neg, spl, types, nr, nb);
            if (!to.has(t.id)) this.charge(1);
            to.set(t.id, (to.get(t.id) ?? 0) + pl * pp * p * np);
          }
      }
    }
    const d = { key, to };
    this.dists.set(key, d);
    return d;
  }

  private spliceDist(s: State, ri: number): Dist | null {
    const r = this.pool.splices[ri];
    const ra = this.roleOfStat.get(r.a);
    const rb = this.roleOfStat.get(r.b);
    if (ra == null || rb == null || s.spl) return null;
    const types = [...s.types];
    const take = (roleId: number): number | null => {
      const i = types.findIndex((t) => this.typeRole(t) === roleId);
      if (i < 0) return null;
      return types.splice(i, 1)[0];
    };
    // either ingredient may be the riven's negative trait (+Zoom with -Damage splices like +Damage with -Zoom)
    const ta = take(ra);
    const tb = take(rb);
    let positives: number[];
    if (ta != null && tb != null) positives = [ta, tb];
    else if (ta != null && s.negRole === rb) positives = [ta];
    else if (tb != null && s.negRole === ra) positives = [tb];
    else return null;
    const usedNeg = positives.length === 1;
    if (!this.splicedGroups.has(r.result)) return null;
    // the spliced trait keeps the higher of the two ingredient rolls, whether an ingredient was positive or negative
    const level = this.splTh(r.result).filter((t) => positives.some((p) => this.meets(p, t)) || (usedNeg && this.negMeets(s, t))).length;
    // a splice whose roll cannot finish the target would only hold the layout: no splicer is spent on that
    if (!this.splicedCounts(r.result, level, s.pos, s.neg)) return null;
    return { key: `s|${s.key}|${ri}`, to: this.spliceTo(s, types, usedNeg, `!${r.result}:${level}`) };
  }

  /** The riven after a splice: `types` are the traits left; the refill takes the consumed positive's slot, or the negative's. */
  private spliceTo(s: State, types: number[], usedNeg: boolean, spl: string): Map<number, number> {
    const to = new Map<number, number>();
    if (usedNeg) {
      // replacement is a negative drawn from what is left
      const nc = this.roleCounts("neg");
      for (const t of types) if (t !== JUNK && this.roles[this.typeRole(t)].canNeg) this.taken(nc, this.typeRole(t));
      const tot = nc.reduce((a, b) => a + Math.max(0, b), 0);
      nc.forEach((c, roleId) => {
        if (c > 0)
          for (const [b, bp] of this.negDraws(roleId)) {
            const st = this.intern(s.pos, s.neg, spl, types, roleId, b);
            if (!to.has(st.id)) this.charge(1);
            to.set(st.id, (to.get(st.id) ?? 0) + (c / tot) * bp);
          }
      });
    } else {
      // the refill cannot repeat a trait still on the card (the consumed ingredients may come back)
      const pc = this.roleCounts("pos");
      for (const t of types) if (t !== JUNK) this.taken(pc, this.typeRole(t));
      if (s.negRole >= 0 && this.roles[s.negRole].canPos) this.taken(pc, s.negRole);
      for (const [pick, pp] of this.draws(pc, 1)) {
        const roleId = pick.findIndex((c) => c > 0);
        for (const [bt, bp] of this.bucketDraws(roleId, 1)) {
          const st = this.intern(s.pos, s.neg, spl, [...types, ...bt], s.negRole, s.negB);
          if (!to.has(st.id)) this.charge(1);
          to.set(st.id, (to.get(st.id) ?? 0) + pp * bp);
        }
      }
    }
    return to;
  }

  /** A cycle is the same action in every state that draws from its distribution: one object serves them all. */
  private cycleAction(s: State, lock: "none" | "neg" | number, drop: boolean): Action {
    const dist = this.cycleDist(s, lock, drop);
    const key = `${dist.key}|${drop}`;
    let a = this.cycles.get(key);
    if (!a) {
      const locked = lock !== "none";
      a = { kind: "cycle", lock, recipe: -1, dist, cost: this.objective === "cycles" ? 1 : KUVA_UNLOCKED * (locked ? 2 : 1), locked, drop };
      this.cycles.set(key, a);
    }
    return a;
  }

  private actionsFor(s: State): Action[] {
    const out: Action[] = [];
    const cycles = (drop: boolean) => {
      out.push(this.cycleAction(s, "none", drop));
      // any lock keeps the layout, so a trait the target does not want is worth locking too
      for (const t of new Set(s.types)) if (t !== JUNK) out.push(this.cycleAction(s, t, drop));
      if (s.neg === 1 && s.negRole >= 0) out.push(this.cycleAction(s, "neg", drop));
    };
    cycles(false);
    if (this.canUnlockSpliced(s)) cycles(true);
    // splicers are only spent on a spliced stat the target wants
    if (!s.spl)
      for (const ri of this.relevantRecipes) {
        const d = this.spliceDist(s, ri);
        if (d) out.push({ kind: "splice", lock: "none", recipe: ri, dist: d, cost: 0, locked: false, drop: false });
      }
    return out;
  }

  /**
   * The spliced trait's lock is free and can be removed, letting the cycle replace it. So that no splicer is
   * wasted, a trait the plan spliced keeps its lock, and so does one on the card that still counts.
   */
  private canUnlockSpliced(s: State): boolean {
    if (!s.spl || s.spl.startsWith("!")) return false;
    const [tag, level] = s.spl.split(":");
    return !this.splicedCounts(tag, Number(level), s.pos, s.neg);
  }

  /**
   * Can a spliced `tag` at `level` be part of a finished riven in the layout it holds? The target must take that
   * layout (and a negative, if it has one); the trait must fill a group of some target set at that layout's bar; the
   * set's other groups need stats that are not spliced (one spliced trait per riven) and must fit the other slots;
   * and the count rule must be reachable with the other traits rolling their best. Only then is a splicer spent on
   * it, and only then does an existing one keep its lock.
   */
  private splicedCounts(tag: string, level: number, pos: number, neg: number): boolean {
    if (!this.target.layouts.some((l) => l.pos === pos && l.neg === neg)) return false;
    if (neg === 1 && !this.roles.some((r) => r.canNeg && r.allowed)) return false;
    const mine = this.splicedGroups.get(tag) ?? [];
    const lk = `${pos}${neg}`;
    const { atLeast } = this.target;
    // another group of the set needs a stat that is not spliced and can reach its bar in this layout
    const plain = (g: number) => this.target.groups[g].tags.some((t) => this.pool.pos.includes(t) && !this.pool.spliced.includes(t) && this.need(g, t, lk) <= W_MAX);
    return this.sets.some(
      (set) =>
        set.length <= pos &&
        set.some((gi) => {
          if (!mine.includes(gi)) return false;
          const need = this.need(gi, tag, lk);
          if (!this.splicedMeets(tag, level, need) || !set.every((g) => g === gi || plain(g))) return false;
          if (!atLeast) return true;
          return this.splicedMeets(tag, level, Math.max(need, atLeast.w)) || set.length - 1 >= Math.min(atLeast.k, set.length);
        }),
    );
  }

  // ---------- solve ----------

  /** Explore every state reachable from `start` and solve all values. */
  solve(start: Card) {
    this.keepCache.clear();
    this.kuvaPolicy = null;
    this.steps = null;
    const s0 = this.stateFor(start);
    const queue = [s0.id];
    const seen = new Set<number>([s0.id]);
    // many states share one distribution (every unlocked cycle draws from the same one): walk its outcomes once
    const walked = new Set<Dist>();
    while (queue.length) {
      const id = queue.pop() as number;
      const s = this.states[id];
      const acts = this.actionsFor(s);
      this.charge(acts.length);
      this.actions[id] = acts;
      for (const a of acts) {
        if (walked.has(a.dist)) continue;
        walked.add(a.dist);
        for (const t of a.dist.to.keys())
          if (!seen.has(t)) {
            seen.add(t);
            queue.push(t);
          }
      }
    }
    const n = this.states.length;
    this.value = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
    this.best = new Int32Array(n).fill(-1);
    // Spliced states lead to unspliced ones by removing the spliced trait, and unspliced ones to spliced
    // ones by splicing. Solve each side with the other side's values fixed and repeat: values only go
    // down, and settle within a few rounds.
    for (let round = 0; round < 50; round++) {
      const before = this.value.slice();
      this.sweep((s) => s.spl !== "");
      this.sweep((s) => s.spl === "");
      let changed = false;
      for (let i = 0; i < n && !changed; i++) {
        const a = before[i];
        const b = this.value[i];
        changed = a !== b && !(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)));
      }
      if (!changed) break;
    }
    return s0;
  }

  /**
   * Dijkstra-style value sweep. States settle in order of value; an action's value is its cost plus the
   * already settled (cheaper) results, divided by their total chance. Many states share one cycle
   * distribution (every unlocked cycle without a splice draws from the same one), and since states settle in
   * order, all users of a distribution see the same settled results: keep one running total per
   * distribution and settle all of its waiting users at once when it is the cheapest thing left.
   */
  private sweep(include: (s: State) => boolean) {
    const n = this.states.length;
    const ids: number[] = [];
    const inSet = new Uint8Array(n);
    for (const s of this.states)
      if (include(s) && this.actions[s.id]) {
        ids.push(s.id);
        inSet[s.id] = 1;
      }
    const settled = new Uint8Array(n);
    // results on the other side (an unspliced riven after removing the spliced trait) have known values;
    // they join the running totals when the sweep reaches their value
    const outside = new Uint8Array(n);
    // one running total per distribution and price; its users and results are kept in flat typed arrays
    const accOf = new Map<string, number>();
    const accAt = new Map<Action, number>();
    const accDist: Dist[] = [];
    const accCost: number[] = [];
    const users: number[] = [];
    // one heap for states (their goal / splice value) and distributions (encoded as -1 - index)
    const heap = new MinHeap();

    for (const id of ids) {
      this.value[id] = Number.POSITIVE_INFINITY;
      this.best[id] = -1;
    }
    for (const id of ids) {
      let t = this.isGoal(this.states[id]) ? 0 : Number.POSITIVE_INFINITY;
      this.actions[id].forEach((a, ai) => {
        if (a.kind === "splice") {
          // successors are spliced states, already solved
          let v = 0;
          for (const [to, p] of a.dist.to) v += p * this.value[to];
          if (v < t) {
            t = v;
            this.best[id] = ai;
          }
          return;
        }
        let k = accAt.get(a);
        if (k == null) {
          const key = `${a.dist.key}|${a.cost}`;
          k = accOf.get(key);
          if (k == null) {
            k = accDist.length;
            accOf.set(key, k);
            accDist.push(a.dist);
            accCost.push(a.cost);
            users.push(0);
            for (const to of a.dist.to.keys())
              if (!inSet[to] && !outside[to] && Number.isFinite(this.value[to])) {
                outside[to] = 1;
                heap.push(to, this.value[to]);
              }
          }
          accAt.set(a, k);
        }
        users[k]++;
      });
      if (this.isGoal(this.states[id])) this.best[id] = -1;
      if (Number.isFinite(t)) heap.push(id, t);
    }

    const accs = accDist.length;
    const num = new Float64Array(accs);
    const den = new Float64Array(accs);
    // users not settled yet
    const left = Int32Array.from(users);
    // each distribution's users [state, action index], in the order they were met
    const userStart = new Int32Array(accs + 1);
    for (let k = 0; k < accs; k++) userStart[k + 1] = userStart[k] + users[k];
    const userId = new Int32Array(userStart[accs]);
    const userAction = new Int32Array(userStart[accs]);
    const nextUser = userStart.slice(0, accs);
    for (const id of ids)
      this.actions[id].forEach((a, ai) => {
        const k = accAt.get(a);
        if (k == null) return;
        userId[nextUser[k]] = id;
        userAction[nextUser[k]++] = ai;
      });
    // successor -> [distribution, probability], for results in this sweep or already solved
    const counts = (to: number) => inSet[to] === 1 || Number.isFinite(this.value[to]);
    const revStart = new Int32Array(n + 1);
    for (const d of accDist) for (const to of d.to.keys()) if (counts(to)) revStart[to + 1]++;
    for (let i = 0; i < n; i++) revStart[i + 1] += revStart[i];
    const revAcc = new Int32Array(revStart[n]);
    const revP = new Float64Array(revStart[n]);
    const nextRev = revStart.slice(0, n);
    accDist.forEach((d, k) => {
      for (const [to, p] of d.to)
        if (counts(to)) {
          revAcc[nextRev[to]] = k;
          revP[nextRev[to]++] = p;
        }
    });

    const candidate = (k: number) => (den[k] > 0 ? (accCost[k] + num[k]) / den[k] : Number.POSITIVE_INFINITY);
    const reach = (id: number, v: number) => {
      for (let j = revStart[id]; j < revStart[id + 1]; j++) {
        const k = revAcc[j];
        num[k] += revP[j] * v;
        den[k] += revP[j];
        if (left[k] > 0) heap.push(-1 - k, candidate(k));
      }
    };
    const settle = (id: number, v: number) => {
      settled[id] = 1;
      this.value[id] = v;
      for (const a of this.actions[id]) if (a.kind === "cycle") left[accAt.get(a) as number]--;
      reach(id, v);
    };

    while (heap.size) {
      const [code, v] = heap.pop();
      if (code >= 0) {
        if (outside[code]) reach(code, v);
        else if (!settled[code]) settle(code, v);
        continue;
      }
      const k = -1 - code;
      if (left[k] === 0 || v !== candidate(k)) continue; // stale
      for (let u = userStart[k]; u < userStart[k + 1]; u++) {
        const id = userId[u];
        if (settled[id]) continue;
        this.best[id] = userAction[u];
        settle(id, v);
      }
    }
  }

  // ---------- routes ----------

  /** Every next move from the card, with its expected total cost when the optimal policy follows. */
  routes(card: Card): Route[] {
    const s = this.stateOf(card);
    const v0 = this.value[s.id];
    const out: Route[] = [];
    const acts = this.actions[s.id] ?? [];
    acts.forEach((a, ai) => {
      if (a.kind === "splice") {
        let exp = 0;
        for (const [to, p] of a.dist.to) exp += p * this.value[to];
        if (!Number.isFinite(exp)) return;
        const r = this.pool.splices[a.recipe];
        out.push({
          action: { kind: "splice", result: r.result, a: r.a, b: r.b },
          stepChance: 1,
          stepCycles: 0,
          stepCyclesP90: 0,
          expected: exp,
          outcomes: [],
          worse: [],
          optimal: this.best[s.id] === ai,
        });
        return;
      }
      const { q, expected, keep } = this.keepSet(a, v0);
      if (q <= 0 || !Number.isFinite(expected)) return;
      const lockInfo =
        typeof a.lock === "number"
          ? (() => {
              const t = card.pos.find((x) => this.typeOfTrait(x) === a.lock) as CardTrait;
              return { tag: t.tag, stats: this.roles[this.typeRole(a.lock)].stats, w: t.w };
            })()
          : a.lock;
      out.push({
        action: a.drop ? { kind: "cycle", lock: lockInfo, drop: true } : { kind: "cycle", lock: lockInfo },
        stepChance: q,
        stepCycles: 1 / q,
        stepCyclesP90: q >= 1 ? 1 : Math.ceil(Math.log(0.1) / Math.log1p(-q)),
        expected,
        outcomes: this.describe(keep, a, typeof lockInfo === "object" ? lockInfo.tag : null),
        worse: this.describe(
          [...a.dist.to].filter(([to, p]) => p > 0 && this.value[to] > v0 + 1e-7 * Math.max(1, Math.abs(v0))).map(([to, p]) => ({ to, p })),
          a,
          typeof lockInfo === "object" ? lockInfo.tag : null,
        ),
        optimal: this.best[s.id] === ai,
      });
    });
    out.sort((x, y) => x.expected - y.expected);
    // Locks that cost the same: the higher roll goes first and is the one recommended, so the better trait is kept
    const lockW = (r: Route) => (r.action.kind === "cycle" && typeof r.action.lock === "object" ? r.action.lock.w : null);
    for (let i = 0; i < out.length; ) {
      let j = i + 1;
      while (j < out.length && out[j].expected - out[i].expected <= 1e-9 * Math.max(1, Math.abs(out[i].expected))) j++;
      const locks = out.slice(i, j).filter((r) => lockW(r) != null);
      const recommended = locks.find((r) => r.optimal);
      locks.sort((a, b) => (lockW(b) as number) - (lockW(a) as number));
      for (let k = i, n = 0; k < j; k++) if (lockW(out[k]) != null) out[k] = locks[n++];
      if (recommended) {
        recommended.optimal = false;
        locks[0].optimal = true;
      }
      i = j;
    }
    return out;
  }

  private typeOfTrait(t: CardTrait) {
    const role = this.roleOfStat.get(t.tag);
    return role == null ? JUNK : this.typeFor(role, this.bucket(this.roles[role], t.w));
  }

  /**
   * Repeat action `a` until the new card beats the current one (value below v0), then play optimally.
   * Returns the per-cycle chance of that, the route's expected cost, and the results worth keeping.
   */
  private keepSet(a: Action, v0: number): KeepResult {
    const cacheKey = `${a.dist.key}|${a.cost}|${v0}`;
    const cached = this.keepCache.get(cacheKey);
    if (cached) return cached;
    // strictly better, with room for rounding: equally good results (another state with the same value) are
    // not progress, and summation order must not decide whether they count
    const bar = v0 - 1e-7 * Math.max(1, Math.abs(v0));
    const keep: { to: number; p: number; v: number }[] = [];
    for (const [to, p] of a.dist.to) {
      const v = this.value[to];
      if (!(p > 0 && v < bar)) continue;
      this.charge(1);
      keep.push({ to, p, v });
    }
    let num = a.cost;
    let den = 0;
    for (const x of keep) {
      num += x.p * x.v;
      den += x.p;
    }
    const cumulative = new Float64Array(keep.length);
    let p = 0;
    keep.forEach((x, i) => {
      p += x.p / den;
      cumulative[i] = p;
    });
    if (cumulative.length) cumulative[cumulative.length - 1] = 1;
    const result = { q: Math.min(1, den), expected: den > 0 ? num / den : Number.POSITIVE_INFINITY, keep, cumulative };
    this.keepCache.set(cacheKey, result);
    return result;
  }

  /** What each kept result shows besides the locked trait. `lockTag` is the locked trait's stat, which cannot show twice. */
  private describe(keep: { to: number; p: number }[], a: Action, lockTag: string | null): Outcome[] {
    if (!keep.length) return [];
    const total = keep.reduce((x, y) => x + y.p, 0);
    const agg = new Map<string, Outcome>();
    for (const { to, p } of keep) {
      const s = this.states[to];
      // the lock holds one trait; others of the same type are still asked for
      const types = [...s.types];
      if (typeof a.lock === "number") types.splice(types.indexOf(a.lock), 1);
      const needs: Need[] = [];
      const byRole = new Map<string, { stats: string[]; minW: number; n: number }>();
      for (const t of types) {
        if (!this.useful(t)) continue;
        const r = this.roles[this.typeRole(t)];
        const b = this.typeBucket(t);
        const minW = b > 0 ? r.th[b - 1] : W_MIN;
        const stats = lockTag ? r.stats.filter((x) => x !== lockTag) : r.stats;
        const k = `${r.id}|${minW}`;
        const g = byRole.get(k);
        if (g) g.n++;
        else byRole.set(k, { stats, minW, n: 1 });
      }
      for (const g of byRole.values()) {
        // as many traits of a role as it has stats: each of them, by name
        if (g.n === g.stats.length) for (const x of g.stats) needs.push({ stats: [x], minW: g.minW });
        else for (let i = 0; i < g.n; i++) needs.push({ stats: g.stats, minW: g.minW });
      }
      needs.sort((x, y) => x.stats[0].localeCompare(y.stats[0]));
      // a negative that feeds a wanted splice: which one it is, and how high it rolled when that matters
      if (s.neg === 1 && s.negRole >= 0 && this.roles[s.negRole].recipes.length && a.lock !== "neg")
        needs.push({ stats: this.roles[s.negRole].stats, minW: s.negB > 0 ? this.roles[s.negRole].nth[s.negB - 1] : W_MIN, neg: true });
      const negAllowed = s.neg === 1 ? s.negRole >= 0 && this.roles[s.negRole].allowed : null;
      const layout = { pos: s.pos as 2 | 3, neg: s.neg as 0 | 1 };
      const key = JSON.stringify([needs, negAllowed, layout]);
      const o = agg.get(key);
      if (o) o.prob += p / total;
      else agg.set(key, { prob: p / total, needs, negAllowed, layout });
    }
    return [...agg.values()].sort((x, y) => y.prob - x.prob);
  }

  // ---------- simulation ----------

  /** The distribution `dist` sorted by value (built once per solve). */
  private sortedOf(dist: Dist, sorted: Map<Dist, SortedDist>): SortedDist {
    const known = sorted.get(dist);
    if (known) return known;
    const list = [...dist.to].filter(([, p]) => p > 0).sort((a, b) => this.value[a[0]] - this.value[b[0]]);
    this.charge(list.length);
    const s: SortedDist = {
      ids: Int32Array.from(list, ([to]) => to),
      ps: Float64Array.from(list, ([, p]) => p),
      values: Float64Array.from(list, ([to]) => this.value[to]),
      chance: new Float64Array(list.length + 1),
      need: 0,
      sums: new Float64Array(list.length + 1),
      filled: 0,
    };
    for (let i = 0; i < list.length; i++) s.chance[i + 1] = s.chance[i] + s.ps[i];
    sorted.set(dist, s);
    return s;
  }

  /** A cycle from a state worth v0 keeps the results strictly below it (as keepSet): how many, and their chance. */
  private keptPrefix(a: Action, v0: number, sorted: Map<Dist, SortedDist>) {
    const s = this.sortedOf(a.dist, sorted);
    const bar = v0 - 1e-7 * Math.max(1, Math.abs(v0));
    let lo = 0;
    let hi = s.values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s.values[mid] < bar) lo = mid + 1;
      else hi = mid;
    }
    s.need = Math.max(s.need, lo);
    return { s, k: lo, q: Math.min(1, s.chance[lo]) };
  }

  /**
   * What the policy does in each unfinished state, in order of value. Many states share one cycle distribution, and
   * each keeps a prefix of it sorted by value, so a price evaluation sums each distribution once instead of every
   * state summing its own results.
   */
  private policySteps() {
    if (this.steps) return this.steps;
    const sorted = new Map<Dist, SortedDist>();
    const list: PolicyStep[] = [];
    const order = this.states.filter((s) => Number.isFinite(this.value[s.id]) && !this.isGoal(s)).sort((a, b) => this.value[a.id] - this.value[b.id]);
    for (const { id } of order) {
      const a = this.actions[id][this.best[id]];
      list.push(a.kind === "splice" ? { id, kind: "splice", dist: a.dist } : { id, kind: "cycle", locked: a.locked, ...this.keptPrefix(a, this.value[id], sorted) });
    }
    this.steps = { list, sorted };
    return this.steps;
  }

  /** Evaluate the chosen policy in Kuva, even when its optimization objective was cycle count. */
  private policyKuva(): Float64Array {
    if (this.objective === "kuva") return this.value;
    if (this.kuvaPolicy) return this.kuvaPolicy;
    const { list, sorted } = this.policySteps();
    // One cycle costs at least the unlocked price. This gives a monotone lower starting bound.
    const values = Float64Array.from(this.value, (v) => v * KUVA_UNLOCKED);
    for (let round = 0; round < 1000; round++) {
      let converged = true;
      // states go in order of value, so the results a cycle keeps (lower values) are already updated this round,
      // and every distribution's prefix sum only grows along the way
      for (const s of sorted.values()) s.filled = 0;
      for (const step of list) {
        let next = 0;
        if (step.kind === "splice") {
          for (const [to, p] of step.dist.to) if (p > 0) next += p * values[to];
        } else {
          const s = step.s;
          for (; s.filled < step.k; s.filled++) s.sums[s.filled + 1] = s.sums[s.filled] + s.ps[s.filled] * values[s.ids[s.filled]];
          next = step.q > 0 ? (KUVA_UNLOCKED * (step.locked ? 2 : 1) + s.sums[step.k]) / step.q : Number.POSITIVE_INFINITY;
        }
        if (!Number.isFinite(next)) throw new Error("The selected policy has no finite Kuva expectation");
        if (Math.abs(next - values[step.id]) > 1e-11 * Math.max(1, Math.abs(next))) converged = false;
        values[step.id] = next;
      }
      if (converged) {
        this.kuvaPolicy = values;
        return values;
      }
    }
    throw new Error("The selected policy's Kuva expectation did not converge");
  }

  private fullPriceAction(id: number, action: Action, values: Float64Array): number {
    if (action.kind === "splice") {
      let result = 0;
      for (const [to, p] of action.dist.to) if (p > 0) result += p * values[to];
      return result;
    }
    const { q, keep } = this.keepSet(action, this.value[id]);
    if (!(q > 0)) return Number.POSITIVE_INFINITY;
    let result = KUVA_UNLOCKED * (action.locked ? 2 : 1);
    for (const { to, p } of keep) result += p * values[to];
    return result / q;
  }

  /**
   * Expected actual Kuva for this route, then the solved policy. The policy is optimized at the stable
   * price; this evaluates its introductory discounts exactly rather than changing that policy.
   */
  expectedKuva(card: Card, first: Route, cyclesDone: number): number {
    return this.expectedKuvas(card, [first], cyclesDone)[0];
  }

  /**
   * expectedKuva for several routes from one card, worked out together. Past the discounted cycles the policy's
   * full-price values hold, so the values are built one discount step at a time, from the last back to
   * `cyclesDone`, for every state at once: a cycle at step d costs that step's price, then is worth the step d + 1
   * value of the riven kept. What a cycle keeps (the results below the state's value) is a prefix of its distribution
   * sorted by value, and many states share one distribution, so each step sums a distribution once, as prefix sums.
   */
  expectedKuvas(card: Card, routes: Route[], cyclesDone: number): number[] {
    const start = this.stateOf(card);
    if (this.isGoal(start)) return routes.map(() => 0);
    const firsts = routes.map((r) => {
      const i = this.actions[start.id].findIndex((a) => this.sameAction(a, r, card));
      if (i < 0) throw new Error("Unknown route for this card");
      return this.actions[start.id][i];
    });
    const terminal = this.policyKuva();
    const done0 = Math.max(0, Math.floor(cyclesDone));
    if (done0 >= KUVA_STEPS.length)
      return firsts.map((a) => (a === this.actions[start.id][this.best[start.id]] ? terminal[start.id] : this.fullPriceAction(start.id, a, terminal)));

    const { list, sorted } = this.policySteps();
    const firstCycles = firsts.map((a) => (a.kind === "splice" ? null : { locked: a.locked, ...this.keptPrefix(a, this.value[start.id], sorted) }));
    const n = this.states.length;

    // step DISCOUNTED_CYCLES and on: the full-price values
    let next = Float64Array.from(terminal);
    const route = firsts.map((a) => (a === this.actions[start.id][this.best[start.id]] ? terminal[start.id] : this.fullPriceAction(start.id, a, terminal)));
    let cur = new Float64Array(n);
    for (let done = KUVA_STEPS.length - 1; done >= done0; done--) {
      for (const s of sorted.values()) for (let i = 0; i < s.need; i++) s.sums[i + 1] = s.sums[i] + s.ps[i] * next[s.ids[i]];
      cur.set(next);
      // a spliced riven cannot splice again, so a splice leads to states that cycle (or are done): cycles first
      for (const c of list) if (c.kind === "cycle") cur[c.id] = cycleCost(done, c.locked) + (c.q < 1 ? (1 - c.q) * next[c.id] : 0) + c.s.sums[c.k];
      for (const c of list)
        if (c.kind === "splice") {
          let v = 0;
          for (const [to, p] of c.dist.to) if (p > 0) v += p * cur[to];
          cur[c.id] = v;
        }
      firstCycles.forEach((c, r) => {
        if (c) route[r] = cycleCost(done, c.locked) + (c.q < 1 ? (1 - c.q) * route[r] : 0) + c.s.sums[c.k];
      });
      [next, cur] = [cur, next];
    }
    // a route that splices first spends no cycle: it is worth what the spliced riven is worth from the same step
    return firsts.map((a, r) => {
      const c = firstCycles[r];
      // a cycle that keeps nothing never ends
      if (c) return c.q > 0 ? route[r] : Number.POSITIVE_INFINITY;
      let v = 0;
      for (const [to, p] of a.dist.to) if (p > 0) v += p * next[to];
      return v;
    });
  }

  /**
   * Sample total Kuva / cycles / splicers of following `first` (route index from routes()) and then the
   * optimal policy. `cyclesDone` sets the Kuva price schedule.
   */
  simulate(card: Card, first: Route, cyclesDone: number, runs = 3000, rng = Math.random) {
    const s0 = this.stateOf(card);
    const acts = this.actions[s0.id];
    const firstIndex = acts.findIndex((a) => this.sameAction(a, first, card));
    if (firstIndex < 0) throw new Error("Unknown route for this card");
    const kuva = new Float64Array(runs);
    const cycles = new Float64Array(runs);
    const splicers = new Float64Array(runs);
    for (let i = 0; i < runs; i++) {
      let id = s0.id;
      let done = cyclesDone;
      let ai = firstIndex;
      let k = 0;
      let c = 0;
      let sp = 0;
      for (let guard = 0; guard < 200 && !this.isGoal(this.states[id]); guard++) {
        const a = this.actions[id][ai];
        if (!a) throw new Error("The selected route has no continuation");
        if (a.kind === "splice") {
          id = sampleMap(a.dist.to, rng);
          sp++;
        } else {
          const { q, keep, cumulative } = this.keepSet(a, this.value[id]);
          if (!(q > 0)) throw new Error("The selected route cannot make progress");
          const n = q >= 1 ? 1 : Math.max(1, Math.ceil(Math.log1p(-rng()) / Math.log1p(-q)));
          if (!Number.isSafeInteger(n) || !Number.isSafeInteger(done + n)) throw new Error("The requested roll is too rare to simulate at this precision");
          k += cycleCostTotal(done, n, a.locked);
          done += n;
          c += n;
          id = keep[sampleCumulative(cumulative, rng())].to;
        }
        ai = this.best[id];
      }
      if (!this.isGoal(this.states[id])) throw new Error("The simulated policy did not finish within the transition limit");
      kuva[i] = k;
      cycles[i] = c;
      splicers[i] = sp;
    }
    return { kuva, cycles, splicers };
  }

  private sameAction(a: Action, r: Route, card: Card) {
    const act = r.action;
    if (act.kind === "splice") {
      if (a.kind !== "splice") return false;
      const r = this.pool.splices[a.recipe];
      return r.result === act.result && r.a === act.a && r.b === act.b;
    }
    if (a.kind !== "cycle" || a.drop !== !!act.drop) return false;
    if (act.lock === "none" || act.lock === "neg") return a.lock === act.lock;
    const lockTag = act.lock.tag;
    const t = card.pos.find((x) => x.tag === lockTag);
    return t != null && a.lock === this.typeOfTrait(t);
  }

  get stateCount() {
    return this.states.length;
  }
}

// ---------- helpers ----------

const factCache = [1];
function factorial(n: number) {
  for (let i = factCache.length; i <= n; i++) factCache[i] = factCache[i - 1] * i;
  return factCache[n];
}

function choose(n: number, k: number) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function sampleMap(m: Map<number, number>, rng: () => number) {
  let u = rng();
  let last = -1;
  for (const [k, p] of m) {
    last = k;
    u -= p;
    if (u <= 0) return k;
  }
  return last;
}

function sampleCumulative(cumulative: Float64Array, u: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (u < cumulative[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.ids[0], this.keys[0]];
    const lastId = this.ids.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
