import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react()],
  server: {
    port: 5173,
    strictPort: true,
    // `bun run dev` starts apps/server on its default port 8080 alongside Vite.
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
});
