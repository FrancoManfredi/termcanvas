import type { Context, Next } from "hono";
import { getEnv } from "../config/env.js";

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const env = getEnv();
  const requiredKey = env.WARP_API_KEY;
  if (!requiredKey) {
    // open localhost without auth
    await next();
    return;
  }

  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== requiredKey) {
    return c.json({ error: "missing or invalid api key", code: "missing_api_key" }, 401);
  }
  await next();
}
