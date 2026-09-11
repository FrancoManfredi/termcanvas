import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Types ────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
  [key: string]: unknown;
}

export interface JwtAuthOptions {
  secret: string;
  issuer?: string;
  audience?: string;
  clockTolerance?: number; // seconds, default 0
}

export interface JwtVerifyOptions {
  issuer?: string;
  audience?: string;
  clockTolerance?: number;
}

// ─── Base64url helpers ─────────────────────────────────────────────────

function base64urlEncode(input: string | Buffer): string {
  const b64 = Buffer.isBuffer(input)
    ? input.toString("base64")
    : Buffer.from(input, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(input: string): Buffer {
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return Buffer.from(b64, "base64");
}

// ─── Sign ───────────────────────────────────────────────────────────────

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  options?: { expiresIn?: number; notBefore?: number },
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body: Record<string, unknown> = { ...payload };

  if (body.iat === undefined) body.iat = now;
  if (options?.expiresIn !== undefined && body.exp === undefined) {
    body.exp = now + options.expiresIn;
  }
  if (options?.notBefore !== undefined && body.nbf === undefined) {
    body.nbf = now + options.notBefore;
  }

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(body));
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${base64urlEncode(sig)}`;
}

// ─── Verify ─────────────────────────────────────────────────────────────

export class JwtError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "MISSING_TOKEN"
      | "MALFORMED_TOKEN"
      | "INVALID_SIGNATURE"
      | "TOKEN_EXPIRED"
      | "TOKEN_NOT_YET_VALID"
      | "INVALID_ISSUER"
      | "INVALID_AUDIENCE"
      | "UNSUPPORTED_ALGORITHM",
  ) {
    super(message);
    this.name = "JwtError";
  }
}

export function verifyJwt(
  token: string,
  secret: string,
  options?: JwtVerifyOptions,
): JwtPayload {
  if (!token || typeof token !== "string") {
    throw new JwtError("Missing token", "MISSING_TOKEN");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtError("Malformed token: expected 3 parts", "MALFORMED_TOKEN");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new JwtError("Malformed token: invalid JSON", "MALFORMED_TOKEN");
  }

  if (header.alg !== "HS256") {
    throw new JwtError(
      `Unsupported algorithm: ${header.alg ?? "none"}`,
      "UNSUPPORTED_ALGORITHM",
    );
  }

  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest();
  const expectedB64 = base64urlEncode(expectedSig);

  // timing-safe compare on the raw bytes
  const actualBuf = base64urlDecode(signatureB64);
  const expectedBuf = base64urlDecode(expectedB64);
  if (
    actualBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(actualBuf, expectedBuf)
  ) {
    throw new JwtError("Invalid signature", "INVALID_SIGNATURE");
  }

  const now = Math.floor(Date.now() / 1000);
  const tolerance = options?.clockTolerance ?? 0;

  if (payload.exp !== undefined && typeof payload.exp === "number") {
    if (now > payload.exp + tolerance) {
      throw new JwtError("Token expired", "TOKEN_EXPIRED");
    }
  }

  if (payload.nbf !== undefined && typeof payload.nbf === "number") {
    if (now < payload.nbf - tolerance) {
      throw new JwtError("Token not yet valid (nbf)", "TOKEN_NOT_YET_VALID");
    }
  }

  if (options?.issuer !== undefined && payload.iss !== options.issuer) {
    throw new JwtError(
      `Invalid issuer: expected ${options.issuer}`,
      "INVALID_ISSUER",
    );
  }

  if (options?.audience !== undefined) {
    const aud = payload.aud;
    const expected = options.audience;
    const matches = Array.isArray(aud)
      ? aud.includes(expected)
      : aud === expected;
    if (!matches) {
      throw new JwtError(
        `Invalid audience: expected ${expected}`,
        "INVALID_AUDIENCE",
      );
    }
  }

  return payload;
}

// ─── Bearer extraction ─────────────────────────────────────────────────

export function extractBearerToken(
  authHeader: string | undefined | null,
): string | null {
  if (!authHeader) return null;
  // Trim and split on whitespace — must be exactly "Bearer <token>"
  const trimmed = authHeader.trim();
  // Case-sensitive per RFC 6750? We accept case-insensitive "Bearer"
  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

// ─── Middleware factory ────────────────────────────────────────────────

export interface AuthenticatedRequest extends IncomingMessage {
  user?: JwtPayload;
}

export type NextFunction = (err?: unknown) => void;

export function createJwtAuthMiddleware(options: JwtAuthOptions) {
  const { secret, issuer, audience, clockTolerance } = options;

  if (!secret || secret.length < 8) {
    throw new Error("JWT secret must be at least 8 characters");
  }

  return (
    req: AuthenticatedRequest,
    res: ServerResponse,
    next: NextFunction,
  ): void => {
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = extractBearerToken(authHeader);

    if (!token) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: missing or malformed Authorization header" }));
      return;
    }

    try {
      const payload = verifyJwt(token, secret, {
        issuer,
        audience,
        clockTolerance,
      });
      req.user = payload;
      next();
    } catch (err) {
      const code =
        err instanceof JwtError ? err.code : "INVALID_SIGNATURE";
      const statusMap: Record<string, number> = {
        TOKEN_EXPIRED: 401,
        INVALID_SIGNATURE: 401,
        MALFORMED_TOKEN: 401,
        MISSING_TOKEN: 401,
        TOKEN_NOT_YET_VALID: 401,
        INVALID_ISSUER: 401,
        INVALID_AUDIENCE: 401,
        UNSUPPORTED_ALGORITHM: 401,
      };
      const status = statusMap[code] ?? 401;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Unauthorized",
          code,
        }),
      );
    }
  };
}

// Convenience helper for `http.createServer` — returns boolean + sets res on failure
export function authenticateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
  options?: JwtVerifyOptions,
): JwtPayload | null {
  const token = extractBearerToken(
    req.headers["authorization"] as string | undefined,
  );
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized: missing token" }));
    return null;
  }
  try {
    return verifyJwt(token, secret, options);
  } catch (err) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unauthorized",
        code: err instanceof JwtError ? err.code : "INVALID_SIGNATURE",
      }),
    );
    return null;
  }
}
