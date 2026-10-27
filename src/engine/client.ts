import type { PlanRequest, PlanResponse } from "./engine.worker";
import { DISCOUNTED_CYCLES } from "./solver";

/** Error codes a plan can end with besides the planner's own (see TOO_COMPLEX in solver.ts). */
export const PLAN_ERROR = {
  /** the worker failed before it said it was ready (its script did not load or start) */
  startFailed: "start-failed",
  /** the worker stopped while working, for a reason it could not report */
  crashed: "crashed",
  /** the job ran past TIMEOUT_MS and was stopped */
  timeout: "timeout",
  /** a newer input replaced the job (the page drops these) */
  superseded: "superseded",
} as const;

/** A job that runs this long is stopped: the last guard, after the planner's own work budget. */
export const TIMEOUT_MS = 30_000;
/** A newer input stops an older job that has already run this long, rather than waiting behind it. */
export const RESTART_AFTER_MS = 1_000;

type Job = { request: PlanRequest; resolve: (response: PlanResponse) => void; started: number; timer?: ReturnType<typeof setTimeout> };

let worker: Worker | null = null;
let ready = false;
let nextId = 1;
let active: Job | null = null;
let waiting: Job | null = null;
/** when the job ahead of a waiting input has run RESTART_AFTER_MS, this stops it */
let grace: ReturnType<typeof setTimeout> | undefined;

const log = (what: string, job: Job | null, more: Record<string, unknown> = {}) =>
  console.warn(`[plan] ${what}`, { id: job?.request.id, ms: job ? Math.round(performance.now() - job.started) : undefined, ...more });

function settle(job: Job, response: PlanResponse) {
  clearTimeout(job.timer);
  job.resolve(response);
}

const failure = (job: Job, error: string): PlanResponse => ({ id: job.request.id, ok: false, error });

function stopWorker() {
  worker?.terminate();
  worker = null;
  ready = false;
}

function start(job: Job) {
  active = job;
  job.started = performance.now();
  // the timer belongs to this job: it can only stop this one
  job.timer = setTimeout(() => {
    if (active !== job) return;
    log("timed out", job);
    stopWorker();
    active = null;
    settle(job, failure(job, PLAN_ERROR.timeout));
    startWaiting();
  }, TIMEOUT_MS);
  try {
    getWorker().postMessage(job.request);
  } catch (error) {
    // the worker could not even be made: the same as a worker that did not start
    log(PLAN_ERROR.startFailed, job, { message: error instanceof Error ? error.message : String(error) });
    stopWorker();
    active = null;
    settle(job, failure(job, PLAN_ERROR.startFailed));
    startWaiting();
  }
}

function startWaiting() {
  const next = waiting;
  waiting = null;
  if (next) start(next);
}

function getWorker() {
  if (!worker) {
    const current = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    worker = current;
    ready = false;
    current.onmessage = (e: MessageEvent<PlanResponse | { ready: true }>) => {
      if (worker !== current) return;
      if ("ready" in e.data) {
        ready = true;
        return;
      }
      const job = active;
      if (!job || e.data.id !== job.request.id) return;
      active = null;
      settle(job, e.data);
      startWaiting();
    };
    current.onerror = (event?: ErrorEvent) => {
      if (worker !== current) return;
      const code = ready ? PLAN_ERROR.crashed : PLAN_ERROR.startFailed;
      log(code, active, { message: event?.message, file: event?.filename, line: event?.lineno });
      event?.preventDefault();
      stopWorker();
      const job = active;
      active = null;
      if (job) settle(job, failure(job, code));
      if (code === PLAN_ERROR.startFailed) {
        // the script itself did not start: the input waiting would fail the same way
        const next = waiting;
        waiting = null;
        if (next) settle(next, failure(next, code));
      } else startWaiting();
    };
    current.onmessageerror = () => {
      if (worker !== current) return;
      log("unreadable result", active);
      stopWorker();
      const job = active;
      active = null;
      if (job) settle(job, failure(job, PLAN_ERROR.crashed));
      startWaiting();
    };
  }
  return worker;
}

/** Stop the job being worked out: the page no longer needs it. */
function stopActive(why: string) {
  const job = active;
  if (!job) return;
  log(why, job);
  stopWorker();
  active = null;
  settle(job, failure(job, PLAN_ERROR.superseded));
}

/** What the worker works out for a request: the Kuva budget and cycles in the same price stage only change what it reads off. */
const workOf = ({ id: _, budget: __, cyclesDone, ...rest }: PlanRequest) => JSON.stringify([rest, Math.min(cyclesDone, DISCOUNTED_CYCLES)]);

/** Drop the input waiting, and stop a job that has already run long, unless it works out the same as the new one. */
function supersede(next: Job) {
  clearTimeout(grace);
  if (waiting) settle(waiting, failure(waiting, PLAN_ERROR.superseded));
  waiting = null;
  if (active && workOf(active.request) !== workOf(next.request) && performance.now() - active.started >= RESTART_AFTER_MS) stopActive("stopped for newer input");
}

export function plan(req: Omit<PlanRequest, "id">): Promise<PlanResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    const job: Job = { request: { ...req, id }, resolve, started: 0 };
    supersede(job);
    if (!active) start(job);
    // the job ahead works out the same: the worker answers this one from it right after
    else if (workOf(active.request) === workOf(job.request)) waiting = job;
    else {
      // the job ahead has not run long yet; if it is still going once it has, it is stopped for this one
      waiting = job;
      const ahead = active;
      grace = setTimeout(
        () => {
          if (active !== ahead || waiting !== job) return;
          stopActive("stopped for newer input");
          startWaiting();
        },
        Math.max(0, RESTART_AFTER_MS - (performance.now() - ahead.started)),
      );
    }
  });
}

/** The input can no longer be planned (cleared, or not filled in): nothing being worked out is needed, so it stops now. */
export function cancelPlans() {
  clearTimeout(grace);
  if (waiting) settle(waiting, failure(waiting, PLAN_ERROR.superseded));
  waiting = null;
  stopActive("stopped: nothing to plan");
}
