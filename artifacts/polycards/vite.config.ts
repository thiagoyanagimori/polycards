import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
  preview: {
    port: 4173,
  },
});
