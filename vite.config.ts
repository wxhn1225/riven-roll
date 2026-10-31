import { statSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The files the screenshot reader downloads, at their size before the server compresses them: what its progress counts up to. */
const readerSizes = {
  wasm: statSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm").size,
  detection: statSync("src/ocr/models/PP-OCRv6_tiny_det.ort").size,
  recognition: statSync("src/ocr/models/PP-OCRv6_tiny_rec.ort").size,
  dictionary: statSync("src/ocr/models/ppocrv6_tiny_dict.txt").size,
};

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  define: { __READER_SIZES__: JSON.stringify(readerSizes) },
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
