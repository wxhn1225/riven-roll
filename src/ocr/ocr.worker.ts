/// <reference lib="webworker" />
// Runs PaddleOCR (PP-OCRv6 tiny) on a screenshot entirely in the browser.
// "onnxruntime-web" is aliased to its WASM-only build in vite.config.ts, shared with ppu-paddle-ocr
import * as ort from "onnxruntime-web";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import detectionUrl from "./models/PP-OCRv6_tiny_det.ort?url";
import recognitionUrl from "./models/PP-OCRv6_tiny_rec.ort?url";
import dictionaryUrl from "./models/ppocrv6_tiny_dict.txt?url";
import type { OcrItem } from "./parse";

declare const __READER_SIZES__: Record<FileKey, number>;

const absolute = (path: string) => new URL(path, self.location.origin).href;
/** What the reader downloads: the runtime and the models, each at an address that changes only when its contents do. */
const FILES = {
  wasm: absolute(wasmUrl),
  detection: absolute(detectionUrl),
  recognition: absolute(recognitionUrl),
  dictionary: absolute(dictionaryUrl),
};
// ppu-paddle-ocr points the runtime at jsDelivr when it is imported: clear that, so it only uses what is shipped here
ort.env.wasm.wasmPaths = undefined;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

/**
 * How far the reader has got before it can read a screenshot: downloading its files, loading them, or ready. While it
 * downloads: bytes so far of the total (as served before compression), bytes a second over the last few seconds, whole
 * seconds since any byte came, and how many times a file was fetched again.
 */
export type OcrModel = { phase: "download"; loaded: number; total: number; speed: number; quiet: number; retries: number } | { phase: "load" } | { phase: "ready" };
const report = (model: OcrModel) => self.postMessage({ model } satisfies OcrMessage);

/** A file that sends nothing this long is fetched again, up to TRIES times in all; a slow one that keeps sending is not. */
export const STALL_MS = 30_000;
export const TRIES = 3;
/** how often a download says how far it is */
const TICK_MS = 500;
const SPEED_WINDOW_MS = 3_000;

type FileKey = keyof typeof FILES;

/**
 * Where the reader's files stay between visits, so they are downloaded once; named for this site, as other sites share its
 * origin. A file is kept under its address, which changes with its contents, so a kept file is never out of date; files an
 * earlier version used are deleted. Files are kept only once the reader has loaded from them, and dropped when it could not.
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

/** The files already kept, read back; the ones an earlier version kept are deleted on the way. */
async function keptFiles(store: Cache | null): Promise<Map<FileKey, ArrayBuffer>> {
  const kept = new Map<FileKey, ArrayBuffer>();
  if (!store) return kept;
  try {
    const wanted = new Set<string>(Object.values(FILES));
    for (const request of await store.keys()) if (!wanted.has(request.url)) await store.delete(request);
    for (const [key, url] of Object.entries(FILES) as [FileKey, string][]) {
      const hit = await store.match(url);
      if (hit) kept.set(key, await hit.arrayBuffer());
    }
  } catch {
    // a store that cannot be read is no worse than an empty one
  }
  return kept;
}

async function forget(store: Cache) {
  await Promise.all(Object.values(FILES).map((url) => store.delete(url))).catch(() => {});
}

/**
 * The reader's files: the ones kept from an earlier visit, and the rest downloaded, each fetched again when it fails or
 * stalls; one that cannot be had stops the others.
 */
async function download(kept: Map<FileKey, ArrayBuffer>): Promise<Record<FileKey, ArrayBuffer>> {
  const missing = (Object.entries(FILES) as [FileKey, string][]).filter(([key]) => !kept.has(key));
  if (!missing.length) return Object.fromEntries(kept) as Record<FileKey, ArrayBuffer>;
  const total = Object.values(__READER_SIZES__).reduce((a, b) => a + b, 0);
  // bytes of each file's current try (a kept file counts in full); every byte received (failed tries included) with when, for the speed
  const got = new Map<FileKey, number>([...kept].map(([key, file]) => [key, file.byteLength]));
  let received = 0;
  let lastByte = Date.now();
  const samples: [number, number][] = [[lastByte, 0]];
  let retries = 0;
  let said = "";
  const tell = () => {
    const now = Date.now();
    while (samples.length > 1 && now - samples[1][0] >= SPEED_WINDOW_MS) samples.shift();
    const [since, before] = samples[0];
    const loaded = Math.min(
      total,
      [...got.values()].reduce((a, b) => a + b, 0),
    );
    const speed = now > since ? Math.round(((received - before) * 1000) / (now - since)) : 0;
    const model: OcrModel = { phase: "download", loaded, total, speed, quiet: Math.floor((now - lastByte) / 1000), retries };
    const text = JSON.stringify(model);
    if (text !== said) {
      said = text;
      report(model);
    }
  };

  const stop = new AbortController();
  const fetchFile = async (key: FileKey, url: string): Promise<ArrayBuffer> => {
    for (let attempt = 1; ; attempt++) {
      stop.signal.throwIfAborted();
      got.set(key, 0);
      const attemptStop = new AbortController();
      const abort = () => attemptStop.abort();
      stop.signal.addEventListener("abort", abort);
      let stall = setTimeout(abort, STALL_MS);
      try {
        const res = await fetch(url, { signal: attemptStop.signal });
        if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
        // written straight into a buffer of the file's size, grown or cut when the file turns out to differ
        let bytes = new Uint8Array(__READER_SIZES__[key]);
        let at = 0;
        for (const reader = res.body.getReader(); ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          clearTimeout(stall);
          stall = setTimeout(abort, STALL_MS);
          if (at + value.length > bytes.length) {
            const more = new Uint8Array(Math.max(bytes.length * 2, at + value.length));
            more.set(bytes.subarray(0, at));
            bytes = more;
          }
          bytes.set(value, at);
          at += value.length;
          got.set(key, at);
          received += value.length;
          lastByte = Date.now();
          samples.push([lastByte, received]);
        }
        return at === bytes.length ? bytes.buffer : bytes.slice(0, at).buffer;
      } catch (err) {
        if (stop.signal.aborted || attempt >= TRIES) throw err;
        retries++;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } finally {
        clearTimeout(stall);
        stop.signal.removeEventListener("abort", abort);
      }
    }
  };

  tell();
  const tick = setInterval(tell, TICK_MS);
  try {
    const files = await Promise.all(missing.map(async ([key, url]) => [key, await fetchFile(key, url)] as const));
    tell();
    return Object.fromEntries([...kept, ...files]) as Record<FileKey, ArrayBuffer>;
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
      const kept = await keptFiles(store);
      const files = await download(kept);
      // copies of what was just downloaded, taken before the reader gets the files, kept once it has loaded from them
      const fresh = store ? (Object.keys(FILES) as FileKey[]).filter((key) => !kept.has(key)).map((key) => [FILES[key], new Response(files[key])] as const) : [];
      report({ phase: "load" });
      ort.env.wasm.wasmBinary = files.wasm;
      const s = new PaddleOcrService({
        model: { detection: files.detection, recognition: files.recognition, charactersDictionary: files.dictionary },
        session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      });
      try {
        await s.initialize();
        for (const [url, response] of fresh) store?.put(url, response).catch(() => {});
        report({ phase: "ready" });
        return s;
      } catch (err) {
        await s.destroy().catch(() => {});
        // a kept file may be what it could not load from: next time every file is downloaded again
        if (store && kept.size) await forget(store);
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
