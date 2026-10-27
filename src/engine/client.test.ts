import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanRequest, PlanResponse } from "./planner";

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: PlanRequest[] = [];
  terminated = false;
  onmessage: ((event: { data: PlanResponse | { ready: true } }) => void) | null = null;
  onerror: ((event?: { message: string; preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(req: PlanRequest) {
    this.posted.push(req);
  }
  terminate() {
    this.terminated = true;
  }
  /** the script loaded and started */
  ready() {
    this.onmessage?.({ data: { ready: true } });
  }
  finish(index = 0) {
    const req = this.posted[index];
    this.onmessage?.({ data: { id: req.id, ok: true, done: true, reachable: true, routes: [], states: 1, ms: 1, compareValues: [] } });
  }
  fail() {
    this.onerror?.({ message: "boom", preventDefault: () => {} });
  }
}

const request = { weaponId: "test", cyclesDone: 0, budget: null } as Omit<PlanRequest, "id">;
// a request the worker works out differently
const other = { ...request, weaponId: "other" };
let now = 0;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const error = async (p: Promise<PlanResponse>) => {
  const r = await p;
  return r.ok ? "ok" : r.error;
};

it("runs the active input followed only by the newest waiting input", async () => {
  const { plan } = await import("./client");
  const first = plan(request);
  const stale = plan(request);
  const latest = plan(request);
  const worker = FakeWorker.instances[0];
  expect(worker.posted).toHaveLength(1);
  expect(await error(stale)).toBe("superseded");
  worker.finish();
  expect((await first).ok).toBe(true);
  expect(worker.posted).toHaveLength(2);
  expect(worker.posted[1].id).toBe(3);
  worker.finish(1);
  expect((await latest).ok).toBe(true);
});

it("says the worker did not start when it fails before it is ready, and starts a new one next time", async () => {
  const { plan } = await import("./client");
  const first = plan(request);
  const next = plan(request);
  const worker = FakeWorker.instances[0];
  worker.fail();
  expect(await error(first)).toBe("start-failed");
  // the script itself did not start, so the input waiting would fail the same way
  expect(await error(next)).toBe("start-failed");
  expect(worker.terminated).toBe(true);
  const retry = plan(request);
  expect(FakeWorker.instances).toHaveLength(2);
  // a late event from the stopped worker must not fail the new one
  worker.fail();
  expect(FakeWorker.instances[1].terminated).toBe(false);
  FakeWorker.instances[1].finish();
  expect((await retry).ok).toBe(true);
});

it("says the work stopped when the worker fails after it is ready, and tries the newest input on a new worker", async () => {
  const { plan } = await import("./client");
  const first = plan(request);
  const worker = FakeWorker.instances[0];
  worker.ready();
  const next = plan(request);
  worker.fail();
  expect(await error(first)).toBe("crashed");
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].finish();
  expect((await next).ok).toBe(true);
});

it("treats an unreadable result as stopped work", async () => {
  const { plan } = await import("./client");
  const first = plan(request);
  FakeWorker.instances[0].ready();
  FakeWorker.instances[0].onmessageerror?.();
  expect(await error(first)).toBe("crashed");
});

it("stops a job that has run a while when newer input comes, instead of waiting behind it", async () => {
  const { plan } = await import("./client");
  const slow = plan(request);
  const worker = FakeWorker.instances[0];
  now = 1500;
  const latest = plan(other);
  expect(await error(slow)).toBe("superseded");
  expect(worker.terminated).toBe(true);
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].finish();
  expect((await latest).ok).toBe(true);
});

it("keeps a job that has run a while when the newer input works out the same, and answers that one next", async () => {
  const { plan } = await import("./client");
  const slow = plan({ ...request, cyclesDone: 9 });
  const worker = FakeWorker.instances[0];
  now = 1500;
  // another Kuva budget, and more cycles at the same price
  const latest = plan({ ...request, budget: 50_000, cyclesDone: 10 });
  const later = plan({ ...request, budget: 60_000, cyclesDone: 11 });
  expect(await error(latest)).toBe("superseded");
  vi.advanceTimersByTime(5000);
  expect(worker.terminated).toBe(false);
  worker.finish();
  expect((await slow).ok).toBe(true);
  expect(worker.posted.map((r) => r.id)).toEqual([1, 3]);
  worker.finish(1);
  expect((await later).ok).toBe(true);
});

it("times a job out after 30 s; the timer cannot stop a later job", async () => {
  const { plan, TIMEOUT_MS } = await import("./client");
  const slow = plan(request);
  vi.advanceTimersByTime(TIMEOUT_MS);
  expect(await error(slow)).toBe("timeout");
  expect(FakeWorker.instances[0].terminated).toBe(true);
  // a retry runs on a new worker with its own timer
  const retry = plan(request);
  vi.advanceTimersByTime(TIMEOUT_MS - 1);
  FakeWorker.instances[1].finish();
  expect((await retry).ok).toBe(true);
  vi.advanceTimersByTime(10);
  expect(FakeWorker.instances[1].terminated).toBe(false);
});

it("stops a younger job ahead once it has run 1 s, when newer input is still waiting behind it", async () => {
  const { plan } = await import("./client");
  const old = plan(request);
  now = 200;
  const latest = plan(other);
  expect(FakeWorker.instances[0].posted).toHaveLength(1);
  // at 1,000 ms the old job is still going: it is stopped and the latest input starts
  now = 1000;
  vi.advanceTimersByTime(800);
  expect(await error(old)).toBe("superseded");
  expect(FakeWorker.instances[0].terminated).toBe(true);
  expect(FakeWorker.instances[1].posted.map((r) => r.id)).toEqual([2]);
  FakeWorker.instances[1].finish();
  expect((await latest).ok).toBe(true);
});

it("lets a young job that finishes in time hand over to the waiting input as usual", async () => {
  const { plan } = await import("./client");
  const quick = plan(request);
  now = 200;
  const latest = plan(request);
  now = 500;
  FakeWorker.instances[0].finish();
  expect((await quick).ok).toBe(true);
  // the check at 1,000 ms finds a different job running and leaves it alone
  now = 1000;
  vi.advanceTimersByTime(800);
  expect(FakeWorker.instances[0].terminated).toBe(false);
  FakeWorker.instances[0].finish(1);
  expect((await latest).ok).toBe(true);
});

it("stops what is being worked out at once when the input can no longer be planned", async () => {
  const { plan, cancelPlans } = await import("./client");
  const running = plan(request);
  const waiting = plan(request);
  now = 100;
  cancelPlans();
  expect(await error(waiting)).toBe("superseded");
  expect(await error(running)).toBe("superseded");
  expect(FakeWorker.instances[0].terminated).toBe(true);
  // nothing is left to start later
  vi.advanceTimersByTime(5000);
  expect(FakeWorker.instances).toHaveLength(1);
});

it("says the worker did not start when it cannot even be made", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("unavailable");
      }
    },
  );
  const { plan } = await import("./client");
  expect(await plan(request)).toEqual({ id: 1, ok: false, error: "start-failed" });
});
