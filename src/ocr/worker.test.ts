import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), destroy: vi.fn(), recognize: vi.fn(), close: vi.fn() }));
vi.mock("onnxruntime-web", () => ({ env: { wasm: {} } }));
vi.mock("ppu-paddle-ocr/web", () => ({
  PaddleOcrService: class {
    initialize = mocks.initialize;
    destroy = mocks.destroy;
    recognize = mocks.recognize;
  },
}));

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
  expect(scope.postMessage.mock.calls.map(([message]) => message.id)).toEqual([1, 2]);
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
  expect(scope.postMessage.mock.calls.map(([message]) => [message.id, message.ok])).toEqual([
    [2, false],
    [3, false],
  ]);
  finish?.({ results: [] });
  await first;
  expect(mocks.recognize).toHaveBeenCalledTimes(2);
  expect(scope.postMessage.mock.calls.map(([message]) => [message.id, message.ok])).toEqual([
    [2, false],
    [3, false],
    [1, true],
    [4, true],
  ]);
  expect(scope.postMessage.mock.calls[0][0]).toEqual({ id: 2, ok: false, error: "superseded" });
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
