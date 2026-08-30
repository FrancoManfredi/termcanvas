// @ts-nocheck — mergeConfig vite+vitest type divergence
import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// @ts-ignore — mergeConfig vite + vitest types diverge, runtime merge is correct
export default mergeConfig(viteConfig as any, {
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
} as any);
