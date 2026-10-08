import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // The Cloudflare plugin emits the build output `cf deploy` expects and
  // reads the Worker definition from cloudflare.config.ts.
  plugins: [react(), cloudflare()],
  server: { port: 5173 },
});
