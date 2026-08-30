import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import { createFactoryRoutes } from "./routes/factory.routes.js";
import { createWorkItemRoutes } from "./routes/workItem.routes.js";
import { createAgentRoutes } from "./routes/agent.routes.js";
import { createWebhookRoutes } from "./routes/webhook.routes.js";
import { createAuthRoutes } from "./routes/auth.routes.js";
import { createGitHubRoutes } from "./routes/github.routes.js";
import { migrate } from "./db/migrate.js";
import { getDb } from "./db/sqlite.js";

export function createApp(): Hono {
  const app = new Hono();

  try {
    const db = getDb();
    migrate(db);
  } catch (e) {
    console.error("[app] migrate failed", e);
  }

  app.use("*", corsMiddleware);

  const factory = createFactoryRoutes();
  const workItems = createWorkItemRoutes();
  const agent = createAgentRoutes();
  const webhook = createWebhookRoutes();
  const auth = createAuthRoutes();
  const github = createGitHubRoutes();

  app.route("/", factory);
  app.route("/", auth);
  app.route("/", github);

  app.use("/api/v1/work-items/*", authMiddleware);
  app.route("/", workItems);

  app.use("/agent/*", authMiddleware);
  app.route("/", agent);

  app.route("/", webhook);

  app.notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} is not implemented`, code: "route_not_found" }, 404));

  app.onError((err, c) => {
    console.error("[app] unhandled", err);
    return c.json({ error: err.message ?? "internal error", code: "internal_error" }, 500);
  });

  return app;
}
