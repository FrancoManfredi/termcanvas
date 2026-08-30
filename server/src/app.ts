import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { createFactoryRoutes } from "./routes/factory.routes.js";
import { createWorkItemRoutes } from "./routes/workItem.routes.js";
import { createAgentRoutes } from "./routes/agent.routes.js";
import { createWebhookRoutes } from "./routes/webhook.routes.js";
import { migrate } from "./db/migrate.js";
import { getDb } from "./db/sqlite.js";

export function createApp(): Hono {
  const app = new Hono();

  // ensure DB + migrate
  try {
    const db = getDb();
    migrate(db);
  } catch (e) {
    console.error("[app] migrate failed", e);
  }

  // global middleware
  app.use("*", corsMiddleware);

  // health without auth
  // auth is applied per route group where needed, but we apply after health
  // factory, workItem, agent routes may require auth optionally
  const factory = createFactoryRoutes();
  const workItems = createWorkItemRoutes();
  const agent = createAgentRoutes();
  const webhook = createWebhookRoutes();

  // Mount with optional auth
  // health already inside factory routes (no auth), so we mount factory first without extra auth wrapper
  // For other routes, wrap with authMiddleware
  app.route("/", factory);

  // Work items with auth
  app.use("/api/v1/work-items/*", authMiddleware);
  app.route("/", workItems);

  // Agent runs with auth
  app.use("/agent/*", authMiddleware);
  app.route("/", agent);

  // Webhook without auth (has its own HMAC)
  app.route("/", webhook);

  // 404 handler with code route_not_found
  app.notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} is not implemented`, code: "route_not_found" }, 404));

  // error handler
  app.onError((err, c) => {
    console.error("[app] unhandled", err);
    return c.json({ error: err.message ?? "internal error", code: "internal_error" }, 500);
  });

  return app;
}
