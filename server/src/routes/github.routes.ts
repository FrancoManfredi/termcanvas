import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getSession } from "../db/sessions.repo.js";
import { listUserRepos } from "../lib/githubRepos.service.js";
import { getUser } from "../lib/githubAuth.service.js";

export function createGitHubRoutes(): Hono {
  const app = new Hono();

  // GET /api/github/repos?per_page=30&page=1&search=&affiliation=owner,collaborator&sort=updated
  app.get("/api/github/repos", async (c) => {
    const sessionId = getCookie(c, "sessionId");
    if (!sessionId) return c.json({ error: "not connected", code: "not_connected" }, 401);
    const sess = getSession(sessionId);
    if (!sess) return c.json({ error: "not connected", code: "not_connected" }, 401);

    const perPage = Math.min(Math.max(Number(c.req.query("per_page") ?? c.req.query("perPage") ?? "30") || 30, 1), 100);
    const page = Math.max(Number(c.req.query("page") ?? "1") || 1, 1);
    const search = c.req.query("search") ?? c.req.query("q") ?? "";

    try {
      const { repos, linkHeader } = await listUserRepos(sess.token, { perPage, page, search });
      if (linkHeader) c.header("Link", linkHeader);
      // Pasar Link si existe para P2
      return c.json({ repos }, 200);
    } catch (e) {
      const err = e as Error & { status?: number; message: string };
      const status = err.status ?? 500;
      if (status === 401) return c.json({ error: "bad credentials — reconectar", code: "bad_credentials" }, 401);
      if (status === 403 || status === 429) return c.json({ error: "rate limited", code: "rate_limited" }, 429);
      const safe = status >= 400 && status < 600 ? (status as 500) : 500;
      return c.json({ error: err.message, code: "fetch_error" }, safe);
    }
  });

  // GET /api/github/user → proxy /user
  app.get("/api/github/user", async (c) => {
    const sessionId = getCookie(c, "sessionId");
    if (!sessionId) return c.json({ error: "not connected", code: "not_connected" }, 401);
    const sess = getSession(sessionId);
    if (!sess) return c.json({ error: "not connected", code: "not_connected" }, 401);
    try {
      const user = await getUser(sess.token);
      return c.json({ login: user.login, avatar_url: user.avatar_url, id: user.id }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg, code: "fetch_error" }, 500);
    }
  });

  return app;
}
