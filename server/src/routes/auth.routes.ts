import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getEnv } from "../config/env.js";
import { exchangeCode, getAuthorizeUrl, getUser, maskToken } from "../lib/githubAuth.service.js";
import { createSession, deleteSession, getSession } from "../db/sessions.repo.js";
import crypto from "node:crypto";

function randomState(): string {
  return crypto.randomBytes(12).toString("hex");
}
function randomSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createAuthRoutes(): Hono {
  const app = new Hono();

  // GET /api/auth/github/start → 302 github authorize o JSON { authUrl }
  app.get("/api/auth/github/start", (c) => {
    const env = getEnv();
    if (!env.GITHUB_CLIENT_ID) {
      return c.json(
        {
          error: "GitHub OAuth no configurado (GITHUB_CLIENT_ID)",
          code: "missing_config",
          hint: "Crea un OAuth App en https://github.com/settings/developers (Homepage http://localhost:5174, Callback http://localhost:5174/api/auth/callback) y añade GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET a server/.env. En local puedes continuar en modo demo.",
        },
        503,
      );
    }
    const state = randomState();
    // guardar state en cookie corta (opcional)
    setCookie(c, "oauth_state", state, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600 });
    const url = getAuthorizeUrl(state);
    // Si client pide JSON (fetch no redirect manual) devolvemos JSON
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("application/json")) {
      return c.json({ authUrl: url, url }, 200);
    }
    return c.redirect(url, 302);
  });

  // GET /api/auth/callback?code=&state=
  app.get("/api/auth/callback", async (c) => {
    const code = c.req.query("code");
    const stateQ = c.req.query("state");
    const stateCookie = getCookie(c, "oauth_state");
    // state validation best-effort (no bloquea si falta)
    if (stateCookie && stateQ && stateCookie !== stateQ) {
      return c.json({ error: "invalid state", code: "invalid_state" }, 400);
    }
    if (!code) return c.json({ error: "missing code", code: "missing_code" }, 400);

    try {
      const { access_token, scope } = await exchangeCode(code);
      const user = await getUser(access_token);
      const sessionId = randomSessionId();
      createSession({
        id: sessionId,
        token: access_token,
        username: user.login,
        avatarUrl: user.avatar_url,
        scope,
        createdAt: new Date().toISOString(),
      });
      setCookie(c, "sessionId", sessionId, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      // Nunca loguear token completo
      console.log(`[auth] GitHub connected ${user.login} token=${maskToken(access_token)}`);

      // Responder HTML con postMessage + close
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conectado</title></head><body><script>
try {
  if (window.opener) {
    window.opener.postMessage({ type: 'github:connected', username: ${JSON.stringify(user.login)}, avatarUrl: ${JSON.stringify(user.avatar_url)} }, window.location.origin);
  }
} catch(e) {}
setTimeout(function(){ try{ window.close(); }catch(e){} window.location.href='/'; }, 800);
</script><p>GitHub conectado como ${user.login}. Podés cerrar esta pestaña.</p></body></html>`;
      return c.html(html, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[auth] callback error", msg);
      return c.json({ error: msg, code: "oauth_failed" }, 500);
    }
  });

  // POST /api/auth/pat → conecta con Personal Access Token (para uso local personal, sin OAuth)
  // Body: { token: "ghp_..." } → valida con GitHub API, crea sesión httpOnly
  app.post("/api/auth/pat", async (c) => {
    let body: { token?: string } | null = null;
    try {
      body = (await c.req.json()) as { token?: string };
    } catch {
      return c.json({ error: "body JSON requerido con { token }", code: "bad_request" }, 400);
    }
    const raw = body?.token?.trim() ?? "";
    if (!raw) return c.json({ error: "token requerido", code: "missing_token" }, 400);
    // validar formato básico: ghp_, github_pat_, gh*_...
    if (!raw.startsWith("ghp_") && !raw.startsWith("github_pat_") && !raw.startsWith("gho_") && !raw.startsWith("ghu_") && raw.length < 20) {
      return c.json({ error: "token con formato inválido", code: "invalid_token_format" }, 400);
    }
    try {
      const user = await getUser(raw);
      const sessionId = randomSessionId();
      createSession({
        id: sessionId,
        token: raw,
        username: user.login,
        avatarUrl: user.avatar_url,
        scope: "repo read:user",
        createdAt: new Date().toISOString(),
      });
      setCookie(c, "sessionId", sessionId, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      console.log(`[auth] GitHub PAT connected ${user.login} token=${maskToken(raw)}`);
      return c.json({ connected: true, username: user.login, avatarUrl: user.avatar_url, scope: "repo" }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[auth] PAT verify failed", msg);
      // mapear 401 como credenciales inválidas
      if (msg.includes("401")) return c.json({ error: "Token inválido o expirado (401)", code: "bad_credentials" }, 401);
      return c.json({ error: msg, code: "pat_failed" }, 500);
    }
  });

  // GET /api/auth/status → { connected, username, avatarUrl, scope }
  app.get("/api/auth/status", (c) => {
    const sessionId = getCookie(c, "sessionId");
    if (!sessionId) {
      // fallback: si GITHUB_PAT está seteado en env y no hay sesión, reportar como conectado (modo personal local)
      // No exponemos si está seteado por seguridad, solo si el usuario ya validó via /pat
      return c.json({ connected: false }, 200);
    }
    const sess = getSession(sessionId);
    if (!sess) return c.json({ connected: false }, 200);
    return c.json({ connected: true, username: sess.username, avatarUrl: sess.avatarUrl, avatar_url: sess.avatarUrl, scope: sess.scope }, 200);
  });

  // POST /api/auth/logout → clear cookie
  app.post("/api/auth/logout", (c) => {
    const sessionId = getCookie(c, "sessionId");
    if (sessionId) deleteSession(sessionId);
    deleteCookie(c, "sessionId", { path: "/" });
    return c.json({ ok: true }, 200);
  });

  // legacy alias /auth/callback for vite proxy /auth
  app.get("/auth/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.json({ error: "missing code" }, 400);
    const url = new URL(c.req.url);
    const newUrl = `/api/auth/callback?${url.searchParams.toString()}`;
    return c.redirect(newUrl, 302);
  });

  return app;
}
