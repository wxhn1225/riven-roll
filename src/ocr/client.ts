import type { OcrMessage, OcrModel, OcrRequest, OcrResponse } from "./ocr.worker";
import { type ParsedScreen, parseScreen } from "./parse";

export type { OcrModel };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: OcrResponse) => void>();

/** how far the reader has got; null before a worker has said anything */
let model: OcrModel | null = null;
const watchers = new Set<(model: OcrModel | null) => void>();
const setModel = (next: OcrModel | null) => {
  model = next;
  for (const watch of watchers) watch(next);
};

/** Follow how far the reader has got (downloading, loading, ready); returns the way to stop. */
export function watchOcrModel(watch: (model: OcrModel | null) => void): () => void {
  watchers.add(watch);
  watch(model);
  return () => watchers.delete(watch);
}

function getWorker() {
  if (!worker) {
    const active = new Worker(new URL("./ocr.worker.ts", import.meta.url), { type: "module" });
    worker = active;
    setModel(null);
    const failed = (message: string) => {
      if (worker !== active) return;
      worker = null;
      active.terminate();
      setModel(null);
      for (const [id, resolve] of pending) resolve({ id, ok: false, error: message, init: true });
      pending.clear();
    };
    active.onmessage = (e: MessageEvent<OcrMessage>) => {
      if ("model" in e.data) {
        if (worker === active) setModel(e.data.model);
        return;
      }
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
      // the runtime did not load: its failure stays in this worker, so the next screenshot gets a new one
      if (!e.data.ok && e.data.init) failed(e.data.error);
    };
    active.onerror = (e) => {
      e.preventDefault();
      failed(e.message || "OCR worker failed to load");
    };
    active.onmessageerror = () => failed("OCR worker returned an unreadable message");
  }
  return worker;
}

/** Start downloading the model before the first screenshot arrives. */
export function warmOcr() {
  try {
    getWorker().postMessage({ warm: true });
  } catch {
    // Preloading is optional; recognize() reports failures when there is an image.
  }
}

export interface OcrResult {
  screen: ParsedScreen;
  ms: number;
  width: number;
  height: number;
}

export async function recognize(file: Blob): Promise<OcrResult> {
  // numbered when chosen: an earlier picture can take longer to read
  const id = nextId++;
  const image = await file.arrayBuffer();
  const res = await new Promise<OcrResponse>((resolve) => {
    try {
      const active = getWorker();
      pending.set(id, resolve);
      const req: OcrRequest = { id, image };
      active.postMessage(req, [image]);
    } catch (err) {
      pending.delete(id);
      resolve({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  if (!res.ok) throw Object.assign(new Error(res.error), { init: res.init === true });
  return { screen: parseScreen(res.items, res.width), ms: res.ms, width: res.width, height: res.height };
}
