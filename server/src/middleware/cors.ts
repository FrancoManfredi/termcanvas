import type { Context, Next } from "hono";

const ALLOWED_ORIGINS = [
  "http://localhost:5174",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:8787",
];

export async function corsMiddleware(c: Context, next: Next): Promise<Response | void> {
  const origin = c.req.header("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  // Handle preflight
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-GitHub-Event, X-Hub-Signature-256",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  await next();

  c.header("Access-Control-Allow-Origin", allowOrigin);
  c.header("Vary", "Origin");
}
