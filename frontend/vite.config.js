import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build to ../openwashdip/serve/static so FastAPI serves the compiled SPA directly.
// In dev (`npm run dev`), proxy /api + /healthz to the uvicorn backend on :8000.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../openwashdip/serve/static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/healthz": "http://127.0.0.1:8000",
    },
  },
});
