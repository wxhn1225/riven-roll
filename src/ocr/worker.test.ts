import { afterEach, beforeEach, expect, it, vi } from "vitest";

declare const __READER_SIZES__: Record<"wasm" | "detection" | "recognition" | "dictionary", number>;

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), destroy: vi.fn(), recognize: vi.fn(), close: vi.fn(), options: vi.fn(), env: { wasm: {} as Record<string, unknown> } }));
vi.mock("onnxruntime-web", () => ({ env: mocks.env }));
vi.mock("ppu-paddle-ocr/web", () => ({
  PaddleOcrService: class {
    initialize = mocks.initialize;
    destroy = mocks.destroy;
    recognize = mocks.recognize;
    constructor(options: unknown) {
      mocks.options(options);
    }
  },
}));

/** a reader file as the server sends it: its full size, in a few chunks */
const served = (url: string) => {
  const key = url.endsWith(".wasm") ? "wasm" : url.endsWith("_det.ort") ? "detection" : url.endsWith("_rec.ort") ? "recognition" : "dictionary";
  const size = __READER_SIZES__[key];
  const chunk = Math.ceil(size / 4);
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let at = 0; at < size; at += chunk) c.enqueue(new Uint8Array(Math.min(chunk, size - at)));
      c.close();
    },
  });
};

type WorkerScope = { onmessage: (event: { data: unknown }) => Promise<void> | void; postMessage: ReturnType<typeof vi.fn> };
let scope: WorkerScope;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.initialize.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.recognize.mockResolvedValue({ results: [] });
  scope = { onmessage: () => {}, postMessage: vi.fn() };
  vi.stubGlobal("self", { ...scope, location: { origin: "https://example.test" }, crossOriginIsolated: false });
  scope = globalThis.self as unknown as WorkerScope;
  vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
  mocks.env.wasm = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(served(url))),
  );
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1920, height: 1080, close: mocks.close }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return { drawImage: () => {} };
      }
    },
  );
  await import("./ocr.worker");
});

afterEach(() => vi.unstubAllGlobals());

type Posted = { id?: number; ok?: boolean; model?: { phase: string; loaded?: number; total?: number } };
const posted = () => scope.postMessage.mock.calls.map(([message]) => message as Posted);
/** the answers to screenshots, without the reader's progress */
const answers = () => posted().filter((m) => !("model" in m));
const progress = () => posted().flatMap((m) => (m.model ? [m.model] : []));

it("downloads the reader's files with their progress, then loads them, then is ready", async () => {
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  const steps = progress();
  const total = Object.values(__READER_SIZES__).reduce((a, b) => a + b, 0);
  expect(steps[0]).toEqual({ phase: "download", loaded: 0, total });
  expect(steps.slice(-3)).toEqual([{ phase: "download", loaded: total, total }, { phase: "load" }, { phase: "ready" }]);
  // the bytes only go up, one message at most per whole percent
  const loaded = steps.flatMap((m) => (m.phase === "download" ? [m.loaded as number] : []));
  expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
  expect(loaded.length).toBeLessThanOrEqual(101);
  // the reader gets what was downloaded, the runtime included, and is ready before the screenshot is answered
  const { model } = mocks.options.mock.calls[0][0] as { model: Record<string, ArrayBuffer> };
  expect([model.detection.byteLength, model.recognition.byteLength, model.charactersDictionary.byteLength]).toEqual([
    __READER_SIZES__.detection,
    __READER_SIZES__.recognition,
    __READER_SIZES__.dictionary,
  ]);
  expect((mocks.env.wasm.wasmBinary as ArrayBuffer).byteLength).toBe(__READER_SIZES__.wasm);
  expect(posted().findIndex((m) => m.model?.phase === "ready")).toBeLessThan(posted().findIndex((m) => m.id === 1));
});

it("says the reader did not load when a file cannot be downloaded, and downloads again next time", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response("missing", { status: 404 }));
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: false, init: true }));
  expect(mocks.initialize).not.toHaveBeenCalled();
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 2, ok: true }));
  expect(fetch).toHaveBeenCalledTimes(8);
});

it("retries failed model initialization and closes decoded bitmaps on failure and success", async () => {
  mocks.initialize.mockRejectedValueOnce(new Error("model unavailable"));
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 1, ok: false, error: "model unavailable", init: true });
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, ok: true }));
  expect(mocks.initialize).toHaveBeenCalledTimes(2);
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
  expect(mocks.close).toHaveBeenCalledTimes(2);
  expect(mocks.recognize).toHaveBeenCalledWith(expect.anything(), { flatten: true, noCache: true });
});

it("serializes overlapping screenshots instead of concurrently running the shared session", async () => {
  let finish: ((value: { results: [] }) => void) | undefined;
  mocks.recognize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(1));
  const second = scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  await Promise.resolve();
  expect(mocks.recognize).toHaveBeenCalledTimes(1);
  finish?.({ results: [] });
  await Promise.all([first, second]);
  expect(mocks.recognize).toHaveBeenCalledTimes(2);
  expect(answers().map((message) => message.id)).toEqual([1, 2]);
});

it("keeps only the newest screenshot waiting and answers the ones it replaces as superseded", async () => {
  let finish: ((value: { results: [] }) => void) | undefined;
  mocks.recognize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(1));
  for (const id of [2, 3, 4]) scope.onmessage({ data: { id, image: new ArrayBuffer(1) } });
  expect(answers().map((message) => [message.id, message.ok])).toEqual([
    [2, false],
    [3, false],
  ]);
  finish?.({ results: [] });
  await first;
  expect(mocks.recognize).toHaveBeenCalledTimes(2);
  expect(answers().map((message) => [message.id, message.ok])).toEqual([
    [2, false],
    [3, false],
    [1, true],
    [4, true],
  ]);
  expect(answers()[0]).toEqual({ id: 2, ok: false, error: "superseded" });
});

it("drops a screenshot that arrives after a newer one, keeping the newer one waiting", async () => {
  let finish: ((value: { results: [] }) => void) | undefined;
  mocks.recognize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(1));
  // the third picture was read first; the second one comes late
  scope.onmessage({ data: { id: 3, image: new ArrayBuffer(1) } });
  scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(answers().map((message) => [message.id, message.ok])).toEqual([[2, false]]);
  finish?.({ results: [] });
  await first;
  expect(answers().map((message) => [message.id, message.ok])).toEqual([
    [2, false],
    [1, true],
    [3, true],
  ]);
});

it("does not retain a synchronously failed initialization promise", async () => {
  mocks.initialize.mockImplementationOnce(() => {
    throw new Error("initialization threw");
  });
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(mocks.initialize).toHaveBeenCalledTimes(2);
  expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, ok: true }));
});
