import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // motion v13 dom entry missing AnimatePresence; alias to react entry for Sidebar
      motion: "motion/react",
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
      "/agent": { target: "http://localhost:8787", changeOrigin: true },
      "/webhooks": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "vendor";
          if (id.includes("node_modules/motion") || id.includes("node_modules/framer-motion")) return "anim";
          if (id.includes("node_modules/yaml") || id.includes("node_modules/zod")) return "parse";
        },
      },
    },
  },
});
