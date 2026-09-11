import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["software-testing-playground-v2/pact/consumer/**/*.spec.ts"],
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    globals: false,
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@": path.resolve("src"),
    },
  },
});
