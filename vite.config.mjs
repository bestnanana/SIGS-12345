import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const apiTarget = process.env.API_TARGET || "http://localhost:3001";
const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "client",
  envDir: repoRoot,
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      },
      "/local/doLogin": {
        target: apiTarget,
        changeOrigin: true
      },
      "/sso": {
        target: apiTarget,
        changeOrigin: true
      },
      "/uploads": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  },
  build: {
    outDir: "dist"
  }
});
