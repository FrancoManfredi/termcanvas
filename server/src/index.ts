import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getEnv } from "./config/env.js";

const env = getEnv();
const app = createApp();

const port = env.PORT ?? 8787;

console.log(`[server] starting on http://localhost:${port} (mode=${process.env.VITE_FACTORY_BACKEND ?? "local"})`);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`);
  }
);
