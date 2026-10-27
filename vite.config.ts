import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
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
