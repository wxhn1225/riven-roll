import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OcrMessage, OcrModel } from "./ocr.worker";

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: { id: number }[] = [];
  terminated = false;
  onmessage: ((event: { data: OcrMessage }) => void) | null = null;
  onerror: ((e: { preventDefault(): void; message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(req: { id: number }) {
    this.posted.push(req);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: OcrMessage) {
    this.onmessage?.({ data });
  }
}

const picture = () => new Blob([new Uint8Array(4)]);
// recognize() reads the image first, then starts (or reuses) the worker and posts to it
const nthWorker = async (n: number) => {
  for (let i = 0; i < 100 && FakeWorker.instances.length < n; i++) await new Promise((r) => setTimeout(r, 0));
  return FakeWorker.instances[n - 1];
};
const posted = async (w: FakeWorker, n: number) => {
  for (let i = 0; i < 100 && w.posted.length < n; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

it("starts a fresh worker after the reader failed to load, so the next screenshot can succeed", async () => {
  const { recognize } = await import("./client");
  const first = recognize(picture());
  const broken = await nthWorker(1);
  await posted(broken, 1);
  broken.reply({ id: broken.posted[0].id, ok: false, error: "network", init: true });
  await expect(first).rejects.toMatchObject({ init: true });
  expect(broken.terminated).toBe(true);
  const second = recognize(picture());
  const fresh = await nthWorker(2);
  expect(FakeWorker.instances).toHaveLength(2);
  await posted(fresh, 1);
  fresh.reply({ id: fresh.posted[0].id, ok: true, width: 1, height: 1, items: [], ms: 1 });
  await expect(second).resolves.toMatchObject({ width: 1 });
});

it("numbers pictures in the order they were chosen, though a later one is read first", async () => {
  const { recognize } = await import("./client");
  const slow = Promise.withResolvers<ArrayBuffer>();
  const quick = Promise.withResolvers<ArrayBuffer>();
  void recognize({ arrayBuffer: () => slow.promise } as Blob).catch(() => {});
  void recognize({ arrayBuffer: () => quick.promise } as Blob).catch(() => {});
  quick.resolve(new ArrayBuffer(4));
  const w = await nthWorker(1);
  await posted(w, 1);
  slow.resolve(new ArrayBuffer(4));
  await posted(w, 2);
  expect(w.posted.map((r) => r.id)).toEqual([2, 1]);
});

it("passes on how far the reader has got, and starts over with a new worker", async () => {
  const { recognize, watchOcrModel } = await import("./client");
  const seen: (OcrModel | null)[] = [];
  const stop = watchOcrModel((m) => seen.push(m));
  const first = recognize(picture());
  const broken = await nthWorker(1);
  broken.reply({ model: { phase: "download", loaded: 5, total: 10 } });
  broken.reply({ model: { phase: "load" } });
  await posted(broken, 1);
  broken.reply({ id: broken.posted[0].id, ok: false, error: "network", init: true });
  await expect(first).rejects.toMatchObject({ init: true });
  // a late word from the stopped worker is not passed on
  broken.reply({ model: { phase: "ready" } });
  expect(seen).toEqual([null, null, { phase: "download", loaded: 5, total: 10 }, { phase: "load" }, null]);
  stop();
  void recognize(picture()).catch(() => {});
  await nthWorker(2);
  FakeWorker.instances[1].reply({ model: { phase: "ready" } });
  expect(seen).toHaveLength(5);
});

it("keeps the worker when a picture simply could not be read", async () => {
  const { recognize } = await import("./client");
  const first = recognize(picture());
  const w = await nthWorker(1);
  await posted(w, 1);
  w.reply({ id: w.posted[0].id, ok: false, error: "bad image" });
  await expect(first).rejects.toMatchObject({ init: false });
  expect(w.terminated).toBe(false);
  void recognize(picture()).catch(() => {});
  await posted(w, 2);
  expect(w.posted).toHaveLength(2);
  expect(FakeWorker.instances).toHaveLength(1);
});
