import type { OcrRequest, OcrResponse } from "./ocr.worker";
import { type ParsedScreen, parseScreen } from "./parse";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: OcrResponse) => void>();

function getWorker() {
  if (!worker) {
    const active = new Worker(new URL("./ocr.worker.ts", import.meta.url), { type: "module" });
    worker = active;
    const failed = (message: string) => {
      if (worker !== active) return;
      worker = null;
      active.terminate();
      for (const [id, resolve] of pending) resolve({ id, ok: false, error: message, init: true });
      pending.clear();
    };
    active.onmessage = (e: MessageEvent<OcrResponse>) => {
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
  const image = await file.arrayBuffer();
  const id = nextId++;
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
