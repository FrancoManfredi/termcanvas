import type { Context, Next } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";

/**
 * Verifies X-Hub-Signature-256 if GITHUB_WEBHOOK_SECRET is set.
 * If secret not set, passes through (dry-run open).
 * Stores raw body as c._rawBody for downstream handler to avoid re-reading.
 */
export async function githubWebhookAuth(c: Context, next: Next): Promise<Response | void> {
  const secret = getEnv().GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    await next();
    return;
  }
  const signature = c.req.header("x-hub-signature-256") ?? "";
  if (!signature.startsWith("sha256=")) {
    return c.json({ error: "missing signature", code: "missing_signature" }, 401);
  }
  const body = await c.req.text();
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  let ok = false;
  if (a.length === b.length) {
    try {
      ok = timingSafeEqual(a, b);
    } catch {
      ok = signature === expected;
    }
  } else {
    ok = false;
  }
  if (!ok) {
    return c.json({ error: "invalid signature", code: "invalid_signature" }, 401);
  }
  // Store raw body for handler to parse without re-reading (Hono consumes stream)
  (c as unknown as { _rawBody: string })._rawBody = body;
  await next();
}
