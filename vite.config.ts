import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** The files the screenshot reader downloads. */
const READER_FILES = {
  wasm: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  detection: "src/ocr/models/PP-OCRv6_tiny_det.ort",
  recognition: "src/ocr/models/PP-OCRv6_tiny_rec.ort",
  dictionary: "src/ocr/models/ppocrv6_tiny_dict.txt",
};
/** Each is cut into parts this big, so a download that breaks off goes on from the part it was on. */
const PART_SIZE = 1 << 20;
/** every part's contents by its address under the site, named for those contents */
const parts = new Map<string, Buffer>();
/** each file's parts in order, as [address, size before the server compresses it] */
const readerParts = Object.fromEntries(
  Object.entries(READER_FILES).map(([key, path]) => {
    const bytes = readFileSync(path);
    const list: [string, number][] = [];
    for (let at = 0; at < bytes.length; at += PART_SIZE) {
      const part = bytes.subarray(at, at + PART_SIZE);
      const name = `assets/reader-${createHash("sha256").update(part).digest("hex").slice(0, 16)}.bin`;
      parts.set(name, part);
      list.push([name, part.length]);
    }
    return [key, list];
  }),
);

/** Serves the reader's parts from the dev server and writes them into the build. */
const serveReaderParts = (): Plugin => ({
  name: "reader-parts",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      const part = path.startsWith(server.config.base) ? parts.get(path.slice(server.config.base.length)) : undefined;
      if (!part) return next();
      res.setHeader("Content-Type", "application/octet-stream");
      res.end(part);
    });
  },
  generateBundle() {
    for (const [fileName, source] of parts) this.emitFile({ type: "asset", fileName, source });
  },
});

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), serveReaderParts()],
  define: { __READER_PARTS__: JSON.stringify(readerParts) },
  resolve: {
    // WASM-only runtime (14 MB) instead of the WebGPU build (28 MB); ppu-paddle-ocr imports the bare name
    alias: [{ find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" }],
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["onnxruntime-web", "ppu-paddle-ocr"] },
  test: {
    include: ["src/**/*.test.ts"],
    // the solver tests do real work; CI runners are a few times slower than a desktop
    testTimeout: 30_000,
  },
});
