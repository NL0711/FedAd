import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two pages: the ad-admin console (index.html, React) and the phone app (phone.html, plain TypeScript).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": "http://127.0.0.1:8000", "/figures": "http://127.0.0.1:8000", "/v1": "http://127.0.0.1:8000" },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), phone: resolve(__dirname, "phone.html") } },
  },
});
