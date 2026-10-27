/// <reference lib="webworker" />
// Runs PaddleOCR (PP-OCRv6 tiny) on a screenshot entirely in the browser.
// "onnxruntime-web" is aliased to its WASM-only build in vite.config.ts, shared with ppu-paddle-ocr
import * as ort from "onnxruntime-web";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import type { OcrItem } from "./parse";

declare const __READER_SIZES__: Record<keyof typeof FILES, number>;

const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
/** What the reader downloads: the runtime Vite ships next to this worker, and the models. */
const FILES = {
  wasm: wasmUrl,
  detection: `${base}models/PP-OCRv6_tiny_det.ort`,
  recognition: `${base}models/PP-OCRv6_tiny_rec.ort`,
  dictionary: `${base}models/ppocrv6_tiny_dict.txt`,
};
// ppu-paddle-ocr points the runtime at jsDelivr when it is imported: clear that, so it only uses what is shipped here
ort.env.wasm.wasmPaths = undefined;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

/** How far the reader has got before it can read a screenshot: downloading its files, loading them, or ready. */
export type OcrModel = { phase: "download"; loaded: number; total: number } | { phase: "load" } | { phase: "ready" };
const report = (model: OcrModel) => self.postMessage({ model } satisfies OcrMessage);

/** The reader's files, counted as they arrive (in bytes as served before compression, at each whole percent). */
async function download(): Promise<Record<keyof typeof FILES, ArrayBuffer>> {
  const total = Object.values(__READER_SIZES__).reduce((a, b) => a + b, 0);
  let loaded = 0;
  let percent = -1;
  const received = (bytes: number) => {
    loaded += bytes;
    const now = Math.min(100, Math.floor((loaded / total) * 100));
    if (now !== percent) {
      percent = now;
      report({ phase: "download", loaded: Math.min(loaded, total), total });
    }
  };
  received(0);
  const files = await Promise.all(
    Object.entries(FILES).map(async ([key, url]) => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
      // a fetched body is never shared memory
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (const reader = res.body.getReader(); ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        received(value.length);
      }
      return [key, await new Blob(chunks).arrayBuffer()] as const;
    }),
  );
  return Object.fromEntries(files) as Record<keyof typeof FILES, ArrayBuffer>;
}

let ready: Promise<PaddleOcrService> | null = null;
function service() {
  ready ??= Promise.resolve()
    .then(async () => {
      const files = await download();
      report({ phase: "load" });
      ort.env.wasm.wasmBinary = files.wasm;
      const s = new PaddleOcrService({
        model: { detection: files.detection, recognition: files.recognition, charactersDictionary: files.dictionary },
        session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      });
      try {
        await s.initialize();
        report({ phase: "ready" });
        return s;
      } catch (err) {
        await s.destroy().catch(() => {});
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
