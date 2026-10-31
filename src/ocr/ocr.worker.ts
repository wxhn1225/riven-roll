/// <reference lib="webworker" />
// Runs PaddleOCR (PP-OCRv6 tiny) on a screenshot entirely in the browser.
// "onnxruntime-web" is aliased to its WASM-only build in vite.config.ts, shared with ppu-paddle-ocr
import * as ort from "onnxruntime-web";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import type { OcrItem } from "./parse";

type FileKey = "wasm" | "detection" | "recognition" | "dictionary";
declare const __READER_PARTS__: Record<FileKey, [string, number][]>;

/** A part of one of the reader's files (the runtime and the models): its address, named for its contents, and its place in the file. */
interface Part {
  key: FileKey;
  url: string;
  at: number;
  size: number;
}
const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
const PARTS: Part[] = (Object.entries(__READER_PARTS__) as [FileKey, [string, number][]][]).flatMap(([key, list]) => {
  let at = 0;
  return list.map(([name, size]) => {
    const part = { key, url: base + name, at, size };
    at += size;
    return part;
  });
});
const SIZES = {} as Record<FileKey, number>;
for (const part of PARTS) SIZES[part.key] = part.at + part.size;
// ppu-paddle-ocr points the runtime at jsDelivr when it is imported: clear that, so it only uses what is shipped here
ort.env.wasm.wasmPaths = undefined;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

/**
 * How far the reader has got before it can read a screenshot: downloading its files, loading them, or ready. While it
 * downloads: bytes so far of the total (as served before compression), bytes a second over the last few seconds, whole
 * seconds since any byte came, and how many times a part was fetched again.
 */
export type OcrModel = { phase: "download"; loaded: number; total: number; speed: number; quiet: number; retries: number } | { phase: "load" } | { phase: "ready" };
const report = (model: OcrModel) => self.postMessage({ model } satisfies OcrMessage);

/** A part that sends nothing this long is fetched again; a slow one that keeps sending is not. */
export const STALL_MS = 30_000;
/** how long to wait before fetching a part again: longer each time, then the last one each time after */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];
/** parts fetched at once */
const PARALLEL = 4;
/** how often a download says how far it is */
const TICK_MS = 500;
const SPEED_WINDOW_MS = 3_000;

/**
 * Where the reader's parts stay between visits, so each is downloaded once; named for this site, as other sites share its
 * origin. A part is kept under its address, which changes with its contents, so a kept part is never out of date. Parts
 * are kept as they arrive, so a download cut off goes on next time from where it was; they are dropped when the reader
 * could not load from them, and parts other versions kept are deleted once this version's reader has loaded.
 */
export const STORE = "riven-roll-reader";

async function openStore(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(STORE);
  } catch {
    // storage turned off or unavailable, as in some private windows: download every visit
    return null;
  }
}

/** Puts a part kept from an earlier visit in its place in its file; one that cannot be read, or is not whole, is downloaded again. */
async function readKept(store: Cache | null, part: Part, file: Uint8Array): Promise<boolean> {
  if (!store) return false;
  try {
    const hit = await store.match(part.url);
    const bytes = hit ? new Uint8Array(await hit.arrayBuffer()) : null;
    if (bytes?.length !== part.size) return false;
    file.set(bytes, part.at);
    return true;
  } catch {
    return false;
  }
}

/** Deletes the parts other versions kept. */
async function dropOthers(store: Cache) {
  const wanted = new Set(PARTS.map((part) => part.url));
  const others = (await store.keys()).filter((request) => !wanted.has(request.url));
  await Promise.all(others.map((request) => store.delete(request)));
}

async function forget(store: Cache) {
  await Promise.all(PARTS.map((part) => store.delete(part.url))).catch(() => {});
}

/** A part the site no longer has (it was updated since the page loaded), or one not as it should be: fetching it again will not help. */
class Gone extends Error {}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });

/**
 * The reader's files: the parts kept from earlier visits, and the rest downloaded a few at a time, each kept as it
 * arrives. A part that fails or stalls is fetched again until it comes; one the site no longer has stops the others.
 * `saved`: done once every part downloaded is in the store.
 */
async function download(store: Cache | null): Promise<{ files: Record<FileKey, ArrayBuffer>; saved: Promise<unknown> }> {
  const files = Object.fromEntries(Object.entries(SIZES).map(([key, size]) => [key, new Uint8Array(size)])) as Record<FileKey, Uint8Array<ArrayBuffer>>;
  const kept = await Promise.all(PARTS.map((part) => readKept(store, part, files[part.key])));
  const missing = PARTS.filter((_, i) => !kept[i]);
  const saves: Promise<unknown>[] = [];
  const whole = () => ({
    files: Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, bytes.buffer])) as Record<FileKey, ArrayBuffer>,
    saved: Promise.all(saves),
  });
  if (!missing.length) return whole();

  const total = PARTS.reduce((a, part) => a + part.size, 0);
  // bytes of the parts already whole, and of each part still coming its current try; every byte received (failed tries
  // included) with when, for the speed
  let finished = total - missing.reduce((a, part) => a + part.size, 0);
  const got = new Map<Part, number>();
  let received = 0;
  let lastByte = Date.now();
  const samples: [number, number][] = [[lastByte, 0]];
  let retries = 0;
  let said = "";
  const tell = () => {
    const now = Date.now();
    while (samples.length > 1 && now - samples[1][0] >= SPEED_WINDOW_MS) samples.shift();
    const [since, before] = samples[0];
    const loaded = finished + [...got.values()].reduce((a, b) => a + b, 0);
    const speed = now > since ? Math.round(((received - before) * 1000) / (now - since)) : 0;
    const model: OcrModel = { phase: "download", loaded, total, speed, quiet: Math.floor((now - lastByte) / 1000), retries };
    const text = JSON.stringify(model);
    if (text !== said) {
      said = text;
      report(model);
    }
  };

  const stop = new AbortController();
  const fetchPart = async (part: Part) => {
    for (let attempt = 0; ; attempt++) {
      stop.signal.throwIfAborted();
      got.set(part, 0);
      const attemptStop = new AbortController();
      const abort = () => attemptStop.abort();
      stop.signal.addEventListener("abort", abort);
      let stall = setTimeout(abort, STALL_MS);
      try {
        const res = await fetch(part.url, { signal: attemptStop.signal });
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new Gone(`${part.url}: HTTP ${res.status}`);
        if (!res.ok || !res.body) throw new Error(`${part.url}: HTTP ${res.status}`);
        const bytes = new Uint8Array(part.size);
        let at = 0;
        for (const reader = res.body.getReader(); ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          clearTimeout(stall);
          stall = setTimeout(abort, STALL_MS);
          if (at + value.length > part.size) throw new Gone(`${part.url}: more than ${part.size} bytes`);
          bytes.set(value, at);
          at += value.length;
          got.set(part, at);
          received += value.length;
          lastByte = Date.now();
          samples.push([lastByte, received]);
        }
        if (at < part.size) throw new Error(`${part.url}: ${at} of ${part.size} bytes`);
        got.delete(part);
        finished += part.size;
        files[part.key].set(bytes, part.at);
        if (store) saves.push(store.put(part.url, new Response(bytes)).catch(() => {}));
        return;
      } catch (err) {
        if (stop.signal.aborted || err instanceof Gone) throw err;
        retries++;
        got.set(part, 0);
        await pause(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)], stop.signal);
      } finally {
        clearTimeout(stall);
        stop.signal.removeEventListener("abort", abort);
      }
    }
  };

  tell();
  const tick = setInterval(tell, TICK_MS);
  try {
    const queue = [...missing];
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
        for (let part = queue.shift(); part; part = queue.shift()) await fetchPart(part);
      }),
    );
    tell();
    return whole();
  } catch (err) {
    stop.abort();
    throw err;
  } finally {
    clearInterval(tick);
  }
}

let ready: Promise<PaddleOcrService> | null = null;
function service() {
  ready ??= Promise.resolve()
    .then(async () => {
      const store = await openStore();
      const { files, saved } = await download(store);
      report({ phase: "load" });
      ort.env.wasm.wasmBinary = files.wasm;
      const s = new PaddleOcrService({
        model: { detection: files.detection, recognition: files.recognition, charactersDictionary: files.dictionary },
        session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      });
      try {
        await s.initialize();
        if (store) dropOthers(store).catch(() => {});
        report({ phase: "ready" });
        return s;
      } catch (err) {
        await s.destroy().catch(() => {});
        // a kept part may be what it could not load from: next time every part is downloaded again
        if (store) {
          await saved;
          await forget(store);
        }
        throw err;
      }
    })
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

export interface OcrRequest {
  id: number;
  image: ArrayBuffer;
}
/** init: the reader itself failed to load (network, missing runtime); this worker cannot recover from that */
export type OcrResponse = { id: number; ok: true; width: number; height: number; items: OcrItem[]; ms: number } | { id: number; ok: false; error: string; init?: true };
/** what the worker posts: an answer to a screenshot, or how far the reader has got */
export type OcrMessage = OcrResponse | { model: OcrModel };

async function recognizeRequest({ id, image }: OcrRequest) {
  try {
    const t0 = performance.now();
    const bitmap = await createImageBitmap(new Blob([image]));
    const { width, height } = bitmap;
    let canvas: OffscreenCanvas;
    try {
      canvas = new OffscreenCanvas(width, height);
      (canvas.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
    let s: PaddleOcrService;
    try {
      s = await service();
    } catch (err) {
      const msg: OcrResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err), init: true };
      self.postMessage(msg);
      return;
    }
    // Consecutive rolls may differ in only a few digits; don't reuse a sampled-image cache key.
    const r = await s.recognize(canvas, { flatten: true, noCache: true });
    const items: OcrItem[] = r.results.map((i) => ({
      text: i.text,
      box: { x: i.box.x, y: i.box.y, w: i.box.width, h: i.box.height },
      conf: i.confidence,
    }));
    const msg: OcrResponse = { id, ok: true, width, height, items, ms: performance.now() - t0 };
    self.postMessage(msg);
  } catch (err) {
    const msg: OcrResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(msg);
  }
}

// A shared inference session must finish the current image before starting another. Of the images waiting, only the
// newest (by id, the order they were chosen in) is still wanted: an older one is answered at once as superseded.
let running: Promise<void> | null = null;
let next: OcrRequest | null = null;
let newest = 0;
const supersede = (request: OcrRequest) => self.postMessage({ id: request.id, ok: false, error: "superseded" } satisfies OcrResponse);
self.onmessage = (e: MessageEvent<OcrRequest | { warm: true }>) => {
  const request = e.data;
  if ("warm" in request) {
    // a preload that fails says so (id 0), so the page starts over with a fresh worker
    service().catch((err) => self.postMessage({ id: 0, ok: false, error: err instanceof Error ? err.message : String(err), init: true } satisfies OcrResponse));
    return;
  }
  if (request.id < newest) {
    supersede(request);
    return running;
  }
  newest = request.id;
  if (next) supersede(next);
  next = request;
  running ??= (async () => {
    for (let r: OcrRequest | null = next; r; r = next) {
      next = null;
      await recognizeRequest(r);
    }
    running = null;
  })();
  return running;
};
