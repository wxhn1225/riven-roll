import { afterEach, beforeEach, expect, it, vi } from "vitest";

type FileKey = "wasm" | "detection" | "recognition" | "dictionary";
declare const __READER_PARTS__: Record<FileKey, [string, number][]>;

/** every part the worker asks for: its address, size and file */
const PARTS = (Object.entries(__READER_PARTS__) as [FileKey, [string, number][]][]).flatMap(([key, list]) =>
  list.map(([name, size]) => ({ key, url: new URL(import.meta.env.BASE_URL + name, "https://example.test").href, size })),
);
const SIZES = Object.fromEntries(Object.entries(__READER_PARTS__).map(([key, list]) => [key, list.reduce((a, [, size]) => a + size, 0)])) as Record<FileKey, number>;
const TOTAL = PARTS.reduce((a, part) => a + part.size, 0);
const ADDRESSES = new Set(PARTS.map((part) => part.url)).size;
const partAt = (url: unknown) => PARTS.find((part) => part.url === String(url)) as (typeof PARTS)[number];
/** a part of the recognition model: the one these tests make slow or broken */
const REC = PARTS.find((part) => part.key === "recognition") as (typeof PARTS)[number];
const isRec = (url: unknown) => String(url) === REC.url;
const fetched = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

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

/** a part as the server sends it: its full size, in a few chunks */
const served = (url: unknown) => {
  const { size } = partAt(url);
  const chunk = Math.ceil(size / 4);
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let at = 0; at < size; at += chunk) c.enqueue(new Uint8Array(Math.min(chunk, size - at)));
      c.close();
    },
  });
};

/** a stream that sends a byte, then nothing until its request is called off */
const stalled = (signal?: AbortSignal | null) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(1));
      signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
    },
  });
/** a slow part: a seventh of it every 10 s, until it is whole or its request is called off */
const trickle = (url: unknown, signal?: AbortSignal | null) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const { size } = partAt(url);
      const chunk = Math.ceil(size / 7);
      let sent = 0;
      const timer = setInterval(() => {
        c.enqueue(new Uint8Array(Math.min(chunk, size - sent)));
        sent += chunk;
        if (sent >= size) {
          clearInterval(timer);
          c.close();
        }
      }, 10_000);
      signal?.addEventListener("abort", () => {
        clearInterval(timer);
        c.error(new DOMException("aborted", "AbortError"));
      });
    },
  });
const signalOf = (init: unknown) => (init as RequestInit | undefined)?.signal as AbortSignal;

type WorkerScope = { onmessage: (event: { data: unknown }) => Promise<void> | void; postMessage: ReturnType<typeof vi.fn> };
let scope: WorkerScope;
let reader: typeof import("./ocr.worker");

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
  reader = await import("./ocr.worker");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Posted = { id?: number; ok?: boolean; model?: { phase: string; loaded?: number; total?: number } };
const posted = () => scope.postMessage.mock.calls.map(([message]) => message as Posted);
/** the answers to screenshots, without the reader's progress */
const answers = () => posted().filter((m) => !("model" in m));
const progress = () => posted().flatMap((m) => (m.model ? [m.model] : []));
const lastDownload = () =>
  progress()
    .filter((m) => m.phase === "download")
    .at(-1);

/** what the reader was given: each file's size */
const loadedSizes = () => {
  const [options] = mocks.options.mock.calls.at(-1) as [{ model: Record<string, ArrayBuffer> }];
  const { model } = options;
  return [(mocks.env.wasm.wasmBinary as ArrayBuffer).byteLength, model.detection.byteLength, model.recognition.byteLength, model.charactersDictionary.byteLength];
};
const SIZES_GIVEN = [SIZES.wasm, SIZES.detection, SIZES.recognition, SIZES.dictionary];

it("cuts the big files into parts", () => {
  expect(__READER_PARTS__.wasm.length).toBeGreaterThan(4);
  expect(PARTS.every((part) => part.size > 0 && part.size <= 1 << 20)).toBe(true);
});

it("downloads the reader's files in parts with their progress, then loads them, then is ready", async () => {
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  const steps = progress();
  expect(steps[0]).toEqual({ phase: "download", loaded: 0, total: TOTAL, speed: 0, quiet: 0, retries: 0 });
  expect(steps.slice(-3)).toEqual([expect.objectContaining({ phase: "download", loaded: TOTAL, total: TOTAL, retries: 0 }), { phase: "load" }, { phase: "ready" }]);
  // said when it starts and when it is done: a fast download ends before the first tick
  expect(steps.filter((m) => m.phase === "download")).toHaveLength(2);
  expect(fetched().sort()).toEqual(PARTS.map((part) => part.url).sort());
  // the reader gets whole files, the runtime included, and is ready before the screenshot is answered
  expect(loadedSizes()).toEqual(SIZES_GIVEN);
  expect(posted().findIndex((m) => m.model?.phase === "ready")).toBeLessThan(posted().findIndex((m) => m.id === 1));
});

it("puts each part in its place in its file", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const { size } = partAt(url);
    // every byte of a part says which part it is
    return new Response(new Uint8Array(size).fill(PARTS.indexOf(partAt(url)) + 1));
  });
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  const { model } = mocks.options.mock.calls[0][0] as { model: Record<string, ArrayBuffer> };
  const files: Record<FileKey, ArrayBuffer> = {
    wasm: mocks.env.wasm.wasmBinary as ArrayBuffer,
    detection: model.detection,
    recognition: model.recognition,
    dictionary: model.charactersDictionary,
  };
  for (const key of Object.keys(files) as FileKey[]) {
    let at = 0;
    for (const part of PARTS.filter((p) => p.key === key)) {
      const mark = PARTS.indexOf(part) + 1;
      expect(new Uint8Array(files[key], at, part.size).every((byte) => byte === mark)).toBe(true);
      at += part.size;
    }
    expect(at).toBe(files[key].byteLength);
  }
});

/** the browser's store for the reader's parts, kept in memory */
const memoryStore = () => {
  const files = new Map<string, ArrayBuffer>();
  const store = {
    keys: async () => [...files.keys()].map((url) => new Request(url)),
    match: async (url: string) => (files.has(url) ? new Response(files.get(url)) : undefined),
    put: async (url: string, response: Response) => void files.set(url, await response.arrayBuffer()),
    delete: async (request: Request | string) => files.delete(typeof request === "string" ? request : request.url),
  };
  return { files, store, open: vi.fn(async () => store) };
};

/** the next visit: a fresh worker, with whatever the browser kept */
const revisit = async () => {
  vi.resetModules();
  vi.mocked(fetch).mockClear();
  scope.postMessage.mockClear();
  mocks.options.mockClear();
  reader = await import("./ocr.worker");
};

it("keeps the downloaded parts, and reads them back next visit without downloading", async () => {
  const kept = memoryStore();
  vi.stubGlobal("caches", { open: kept.open });
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(kept.files.size).toBe(ADDRESSES));
  expect(kept.open).toHaveBeenCalledWith(reader.STORE);

  await revisit();
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(fetch).not.toHaveBeenCalled();
  expect(progress()).toEqual([{ phase: "load" }, { phase: "ready" }]);
  expect(loadedSizes()).toEqual(SIZES_GIVEN);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 2, ok: true }));
});

it("keeps each part as it arrives, so a download cut off goes on next visit from where it was", async () => {
  vi.useFakeTimers();
  const kept = memoryStore();
  vi.stubGlobal("caches", { open: kept.open });
  vi.mocked(fetch).mockImplementation(async (url, init) => new Response(isRec(url) ? stalled(signalOf(init)) : served(url)));
  void scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.advanceTimersByTimeAsync(5000);
  // the page is closed here, with one part still coming
  expect(kept.files.size).toBe(ADDRESSES - 1);
  expect(kept.files.has(REC.url)).toBe(false);

  vi.useRealTimers();
  vi.mocked(fetch).mockImplementation(async (url) => new Response(served(url)));
  await revisit();
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(fetched()).toEqual([REC.url]);
  // the progress starts from what was kept
  expect(progress()[0]).toEqual(expect.objectContaining({ phase: "download", loaded: TOTAL - REC.size, total: TOTAL }));
  expect(loadedSizes()).toEqual(SIZES_GIVEN);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 2, ok: true }));
});

it("deletes the parts another version kept once this one has loaded", async () => {
  const kept = memoryStore();
  vi.stubGlobal("caches", { open: kept.open });
  const old = "https://example.test/assets/reader-0000000000000000.bin";
  kept.files.set(old, new ArrayBuffer(3));
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(kept.files.has(old)).toBe(false));
  await vi.waitFor(() => expect(kept.files.size).toBe(ADDRESSES));
});

it("keeps nothing the reader could not load from, and drops kept parts it could not load from", async () => {
  const kept = memoryStore();
  vi.stubGlobal("caches", { open: kept.open });
  // what another version kept stays while this one cannot load
  const other = "https://example.test/assets/reader-1111111111111111.bin";
  kept.files.set(other, new ArrayBuffer(3));
  mocks.initialize.mockRejectedValueOnce(new Error("not a model"));
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: false, init: true }));
  expect([...kept.files.keys()]).toEqual([other]);
  kept.files.delete(other);

  // loaded fine and kept, then a later visit cannot load from what was kept
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(kept.files.size).toBe(ADDRESSES));
  await revisit();
  mocks.initialize.mockRejectedValueOnce(new Error("damaged"));
  await scope.onmessage({ data: { id: 3, image: new ArrayBuffer(1) } });
  expect(fetch).not.toHaveBeenCalled();
  expect(kept.files.size).toBe(0);
  // so the next try downloads them again
  await scope.onmessage({ data: { id: 4, image: new ArrayBuffer(1) } });
  expect(fetch).toHaveBeenCalledTimes(PARTS.length);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 4, ok: true }));
});

it("downloads only a kept part it cannot read or that is not whole, and reads the rest though the cleanup fails", async () => {
  const kept = memoryStore();
  vi.stubGlobal("caches", { open: kept.open });
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.waitFor(() => expect(kept.files.size).toBe(ADDRESSES));
  const [unreadable, cut] = PARTS.filter((part) => part.key === "wasm");
  kept.files.set(cut.url, new ArrayBuffer(cut.size - 1));
  const match = kept.store.match;
  kept.store.match = async (url: string) => {
    if (url === unreadable.url) throw new DOMException("unreadable", "UnknownError");
    return match(url);
  };
  kept.store.keys = async () => {
    throw new DOMException("unreadable", "UnknownError");
  };

  await revisit();
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(fetched().sort()).toEqual([unreadable.url, cut.url].sort());
  expect(loadedSizes()).toEqual(SIZES_GIVEN);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 2, ok: true }));
});

it("downloads as before when the browser will not keep files", async () => {
  vi.stubGlobal("caches", { open: vi.fn().mockRejectedValue(new DOMException("denied", "SecurityError")) });
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  expect(fetch).toHaveBeenCalledTimes(PARTS.length);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: true }));
});

it("fetches a part again when the server fails, without counting its bytes twice", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce(new Response("busy", { status: 503 }));
  const done = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.advanceTimersByTimeAsync(reader.BACKOFF_MS[0]);
  await done;
  expect(fetch).toHaveBeenCalledTimes(PARTS.length + 1);
  expect(lastDownload()).toEqual(expect.objectContaining({ loaded: TOTAL, retries: 1 }));
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: true }));
});

it("keeps fetching a part that fails, waiting longer each time, until it comes", async () => {
  vi.useFakeTimers();
  const fails = 6;
  let tries = 0;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (isRec(url) && ++tries <= fails) throw new TypeError("network error");
    return new Response(served(url));
  });
  const done = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  // the waits so far, but for the last moment of the last one
  const waits = Array.from({ length: fails }, (_, i) => reader.BACKOFF_MS[Math.min(i, reader.BACKOFF_MS.length - 1)]);
  await vi.advanceTimersByTimeAsync(waits.reduce((a, b) => a + b, 0) - 1);
  expect(tries).toBe(fails);
  expect(answers()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(tries).toBe(fails + 1);
  expect(lastDownload()).toEqual(expect.objectContaining({ loaded: TOTAL, retries: fails }));
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: true }));
});

it("says the reader did not load when the site no longer has a part, and downloads again next time", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    isRec(url) ? new Response("missing", { status: 404 }) : new Response(String(url) === PARTS[0].url ? stalled(signalOf(init)) : served(url)),
  );
  const done = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.advanceTimersByTimeAsync(100);
  await done;
  // asked for once: fetching it again would not help
  expect(fetched().filter((url) => url === REC.url)).toHaveLength(1);
  expect(signalOf(vi.mocked(fetch).mock.calls.find(([url]) => String(url) === PARTS[0].url)?.[1]).aborted).toBe(true);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: false, init: true }));
  expect(mocks.initialize).not.toHaveBeenCalled();
  vi.mocked(fetch).mockImplementation(async (url) => new Response(served(url)));
  await scope.onmessage({ data: { id: 2, image: new ArrayBuffer(1) } });
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 2, ok: true }));
});

it("stops when a part is bigger than it should be", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => new Response(isRec(url) ? new Uint8Array(REC.size + 1) : served(url)));
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  expect(fetched().filter((url) => url === REC.url)).toHaveLength(1);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: false, init: true }));
});

it("calls off a part that sends nothing for a while and fetches it again, but not one that comes slowly but steadily", async () => {
  vi.useFakeTimers();
  const slow = PARTS.find((part) => part.key === "detection") as (typeof PARTS)[number];
  const signals: Record<"rec" | "slow", AbortSignal[]> = { rec: [], slow: [] };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const signal = signalOf(init);
    if (isRec(url)) {
      signals.rec.push(signal);
      return new Response(signals.rec.length <= 2 ? stalled(signal) : served(url));
    }
    if (String(url) === slow.url) {
      signals.slow.push(signal);
      return new Response(trickle(url, signal));
    }
    return new Response(served(url));
  });
  const done = scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.advanceTimersByTimeAsync(reader.STALL_MS + 500);
  expect(lastDownload()).toEqual(expect.objectContaining({ phase: "download", retries: 1 }));
  // the slow part takes 70 s, longer than a stall, but never 30 s without a byte
  await vi.advanceTimersByTimeAsync(2 * reader.STALL_MS + 10_000);
  await done;
  expect(signals.rec).toHaveLength(3);
  expect(signals.rec.slice(0, 2).every((s) => s.aborted)).toBe(true);
  expect(signals.slow).toHaveLength(1);
  expect(signals.slow[0].aborted).toBe(false);
  expect(loadedSizes()).toEqual(SIZES_GIVEN);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: true }));
});

it("says how many seconds have gone by without a byte", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(async (url, init) => new Response(isRec(url) ? stalled(signalOf(init)) : served(url)));
  void scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  await vi.advanceTimersByTimeAsync(7000);
  expect(lastDownload()).toEqual(expect.objectContaining({ phase: "download", quiet: 7, speed: 0 }));
});

it("fetches no more than a few parts at once", async () => {
  let open = 0;
  let most = 0;
  vi.mocked(fetch).mockImplementation(async (url) => {
    most = Math.max(most, ++open);
    const body = served(url);
    // done once its last byte is read
    return new Response(
      body.pipeThrough(
        new TransformStream({
          flush() {
            open--;
          },
        }),
      ),
    );
  });
  await scope.onmessage({ data: { id: 1, image: new ArrayBuffer(1) } });
  expect(most).toBeGreaterThan(1);
  expect(most).toBeLessThanOrEqual(4);
  expect(answers().at(-1)).toEqual(expect.objectContaining({ id: 1, ok: true }));
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
