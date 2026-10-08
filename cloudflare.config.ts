import { defineConfig } from "cf/config";

// Assets-only Worker: Vite's client build is uploaded and served from
// Cloudflare's edge. There is no Worker entrypoint; unknown paths fall
// back to index.html so the SPA handles them.
export default defineConfig({
  worker: {
    name: "chunkcoaster",
    compatibilityDate: "2026-10-01",
    observability: { enabled: true },
    assets: {
      notFoundHandling: "single-page-application",
    },
  },
});
