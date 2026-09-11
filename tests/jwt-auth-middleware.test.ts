import test from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import {
  signJwt,
  verifyJwt,
  JwtError,
  extractBearerToken,
  createJwtAuthMiddleware,
  authenticateRequest,
} from "../src/middleware/jwtAuth.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

const SECRET = "test-secret-12345678";
const WRONG_SECRET = "wrong-secret-87654321";

function mockReqRes(
  authHeader?: string,
  extraHeaders: Record<string, string> = {},
): { req: IncomingMessage; res: ServerResponse & { body: string; statusCode: number } } {
  const socket = new Socket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = new IncomingMessage(socket) as IncomingMessage;
  req.headers = {
    ...(authHeader !== undefined ? { authorization: authHeader } : {}),
    ...extraHeaders,
  };
  req.method = "GET";
  req.url = "/api/protected";

  let body = "";
  let statusCode = 200;
  const res = {
    body: "",
    statusCode: 200,
    writeHead(code: number) {
      statusCode = code;
      (this as unknown as { statusCode: number }).statusCode = code;
      return this;
    },
    end(chunk?: string) {
      body = chunk ?? "";
      (this as unknown as { body: string }).body = body;
      (this as unknown as { statusCode: number }).statusCode = statusCode;
    },
    setHeader() {},
    get status() {
      return statusCode;
    },
    get payload() {
      return body;
    },
  } as unknown as ServerResponse & { body: string; statusCode: number };

  // patch writeHead/end to capture
  const origWriteHead = res.writeHead.bind(res);
  // We use closure variables above; re-wire to update outer vars
  res.writeHead = ((code: number, _headers?: unknown) => {
    statusCode = code;
    (res as unknown as { statusCode: number }).statusCode = code;
    return res;
  }) as unknown as typeof res.writeHead;
  res.end = ((chunk?: unknown) => {
    body = (chunk as string) ?? "";
    (res as unknown as { body: string }).body = body;
    return res;
  }) as unknown as typeof res.end;

  return { req, res };
}

// ─── signJwt / verifyJwt ───────────────────────────────────────────────

test("signJwt genera token de 3 partes y verifyJwt lo valida", () => {
  const token = signJwt({ sub: "user-123", role: "admin" }, SECRET);
  assert.equal(token.split(".").length, 3);
  const payload = verifyJwt(token, SECRET);
  assert.equal(payload.sub, "user-123");
  assert.equal(payload.role, "admin");
  assert.ok(typeof payload.iat === "number");
});

test("signJwt respeta expiresIn y verifyJwt rechaza token expirado", () => {
  // Token que expira en -10s (ya expirado)
  const token = signJwt({ sub: "u1" }, SECRET, { expiresIn: -10 });
  assert.throws(() => verifyJwt(token, SECRET), (err: Error) => {
    assert.ok(err instanceof JwtError);
    assert.equal((err as JwtError).code, "TOKEN_EXPIRED");
    return true;
  });
});

test("verifyJwt respeta nbf (not before)", () => {
  const token = signJwt({ sub: "u1" }, SECRET, { notBefore: 60 });
  assert.throws(() => verifyJwt(token, SECRET), (err: Error) => {
    assert.equal((err as JwtError).code, "TOKEN_NOT_YET_VALID");
    return true;
  });
});

test("verifyJwt rechaza firma inválida (wrong secret)", () => {
  const token = signJwt({ sub: "u1" }, SECRET);
  assert.throws(() => verifyJwt(token, WRONG_SECRET), (err: Error) => {
    assert.equal((err as JwtError).code, "INVALID_SIGNATURE");
    return true;
  });
});

test("verifyJwt rechaza token manipulado (payload tampering)", () => {
  const token = signJwt({ sub: "u1", role: "user" }, SECRET);
  const parts = token.split(".");
  // Tamper payload: change role to admin without re-signing
  const tamperedPayload = Buffer.from(JSON.stringify({ sub: "u1", role: "admin", iat: Math.floor(Date.now()/1000) }))
    .toString("base64url");
  const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  assert.throws(() => verifyJwt(tampered, SECRET), (err: Error) => {
    assert.equal((err as JwtError).code, "INVALID_SIGNATURE");
    return true;
  });
});

test("verifyJwt rechaza token malformado (menos de 3 partes)", () => {
  assert.throws(() => verifyJwt("only.two", SECRET), (err: Error) => {
    assert.equal((err as JwtError).code, "MALFORMED_TOKEN");
    return true;
  });
  assert.throws(() => verifyJwt("", SECRET), (err: Error) => {
    assert.equal((err as JwtError).code, "MISSING_TOKEN");
    return true;
  });
});

test("verifyJwt rechaza algoritmo no soportado", () => {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
  const fakeSig = Buffer.from("fakesig").toString("base64url");
  const token = `${header}.${payload}.${fakeSig}`;
  assert.throws(() => verifyJwt(token, SECRET), (err: Error) => {
    assert.equal((err as JwtError).code, "UNSUPPORTED_ALGORITHM");
    return true;
  });
});

test("verifyJwt valida issuer y audience opcionales", () => {
  const token = signJwt({ sub: "u1", iss: "termcanvas", aud: "api" }, SECRET);
  // issuer correcto
  assert.doesNotThrow(() => verifyJwt(token, SECRET, { issuer: "termcanvas" }));
  // issuer incorrecto
  assert.throws(() => verifyJwt(token, SECRET, { issuer: "other" }), (err: Error) => {
    assert.equal((err as JwtError).code, "INVALID_ISSUER");
    return true;
  });
  // audience correcto
  assert.doesNotThrow(() => verifyJwt(token, SECRET, { audience: "api" }));
  // audience incorrecto
  assert.throws(() => verifyJwt(token, SECRET, { audience: "other" }), (err: Error) => {
    assert.equal((err as JwtError).code, "INVALID_AUDIENCE");
    return true;
  });
});

test("verifyJwt soporta aud como array", () => {
  const token = signJwt({ sub: "u1", aud: ["api", "web"] }, SECRET);
  assert.doesNotThrow(() => verifyJwt(token, SECRET, { audience: "web" }));
  assert.throws(() => verifyJwt(token, SECRET, { audience: "mobile" }), (err: Error) => {
    assert.equal((err as JwtError).code, "INVALID_AUDIENCE");
    return true;
  });
});

test("verifyJwt respeta clockTolerance para exp", () => {
  const token = signJwt({ sub: "u1" }, SECRET, { expiresIn: -5 }); // expiró hace 5s
  // sin tolerancia -> falla
  assert.throws(() => verifyJwt(token, SECRET), (e: Error) => (e as JwtError).code === "TOKEN_EXPIRED");
  // con tolerancia 10s -> pasa
  assert.doesNotThrow(() => verifyJwt(token, SECRET, { clockTolerance: 10 }));
});

// ─── extractBearerToken ────────────────────────────────────────────────

test("extractBearerToken extrae token correctamente", () => {
  assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi"); // case-insensitive
  assert.equal(extractBearerToken("Bearer   abc.def.ghi  "), "abc.def.ghi");
});

test("extractBearerToken retorna null si header falta o es inválido", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(extractBearerToken("Bearer   "), null);
  assert.equal(extractBearerToken("Token abc"), null);
});

// ─── createJwtAuthMiddleware ───────────────────────────────────────────

test("middleware: permite request con token válido y popula req.user", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const token = signJwt({ sub: "user-42", role: "admin" }, SECRET);
  const { req, res } = mockReqRes(`Bearer ${token}`);

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal((req as unknown as { user: { sub: string } }).user.sub, "user-42");
  // no escribió 401
  assert.equal(res.statusCode, 200);
});

test("middleware: rechaza request sin Authorization header con 401", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const { req, res } = mockReqRes(undefined);

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.match(body.error, /missing/i);
});

test("middleware: rechaza scheme inválido (Basic) con 401", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const { req, res } = mockReqRes("Basic abc123");

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("middleware: rechaza token expirado con 401 + code TOKEN_EXPIRED", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const token = signJwt({ sub: "u1" }, SECRET, { expiresIn: -10 });
  const { req, res } = mockReqRes(`Bearer ${token}`);

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, "TOKEN_EXPIRED");
});

test("middleware: rechaza firma inválida con 401 + code INVALID_SIGNATURE", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const token = signJwt({ sub: "u1" }, WRONG_SECRET);
  const { req, res } = mockReqRes(`Bearer ${token}`);

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).code, "INVALID_SIGNATURE");
});

test("middleware: rechaza token malformado con 401", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const { req, res } = mockReqRes("Bearer not.a.jwt.at.all.extra");

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("middleware: valida issuer/audience cuando se configuran", () => {
  const middleware = createJwtAuthMiddleware({
    secret: SECRET,
    issuer: "termcanvas",
    audience: "api",
  });
  const validToken = signJwt({ sub: "u1", iss: "termcanvas", aud: "api" }, SECRET);
  const invalidIssToken = signJwt({ sub: "u1", iss: "evil", aud: "api" }, SECRET);

  // válido pasa
  {
    const { req, res } = mockReqRes(`Bearer ${validToken}`);
    let next = false;
    middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
    assert.equal(next, true);
  }
  // issuer inválido falla
  {
    const { req, res } = mockReqRes(`Bearer ${invalidIssToken}`);
    let next = false;
    middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
    assert.equal(next, false);
    assert.equal(JSON.parse(res.body).code, "INVALID_ISSUER");
  }
});

test("middleware: rechaza token vacío después de Bearer", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const { req, res } = mockReqRes("Bearer ");

  let nextCalled = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("createJwtAuthMiddleware lanza si secret es muy corto", () => {
  assert.throws(() => createJwtAuthMiddleware({ secret: "short" }), /at least 8/);
  assert.throws(() => createJwtAuthMiddleware({ secret: "" }), /at least 8/);
});

// ─── authenticateRequest (helper para http.createServer) ───────────────

test("authenticateRequest retorna payload si token válido, null si no", () => {
  const token = signJwt({ sub: "u1" }, SECRET);
  const { req: okReq, res: okRes } = mockReqRes(`Bearer ${token}`);
  const payload = authenticateRequest(okReq, okRes, SECRET);
  assert.ok(payload);
  assert.equal(payload?.sub, "u1");

  const { req: badReq, res: badRes } = mockReqRes("Bearer invalid");
  const bad = authenticateRequest(badReq, badRes, SECRET);
  assert.equal(bad, null);
  assert.equal(badRes.statusCode, 401);
});

// ─── Integración: múltiples requests con mismo middleware ──────────────

test("middleware es reutilizable: valida múltiples requests secuenciales", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const goodToken = signJwt({ sub: "good" }, SECRET);
  const badToken = "bad.token.here";

  for (const { token, shouldPass } of [
    { token: goodToken, shouldPass: true },
    { token: badToken, shouldPass: false },
    { token: goodToken, shouldPass: true },
  ]) {
    const { req, res } = mockReqRes(`Bearer ${token}`);
    let next = false;
    middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
    assert.equal(next, shouldPass);
  }
});

test("timingSafeEqual: dos firmas válidas distintas no colisionan", () => {
  const t1 = signJwt({ sub: "a" }, SECRET);
  const t2 = signJwt({ sub: "b" }, SECRET);
  // t1 válido con SECRET, t2 también pero payload distinto -> ambos pasan con su secret
  assert.doesNotThrow(() => verifyJwt(t1, SECRET));
  assert.doesNotThrow(() => verifyJwt(t2, SECRET));
  // cross-check: t1 no pasa con otro secret aunque payload sea igual
  const t1Wrong = signJwt({ sub: "a" }, WRONG_SECRET);
  assert.notEqual(t1, t1Wrong);
});

// ─── Cobertura extra: edge cases del middleware no cubiertos ──────────

test("middleware: rechaza token con nbf futuro (TOKEN_NOT_YET_VALID)", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const token = signJwt({ sub: "u1" }, SECRET, { notBefore: 60 });
  const { req, res } = mockReqRes(`Bearer ${token}`);
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).code, "TOKEN_NOT_YET_VALID");
});

test("middleware: respeta clockTolerance para nbf/exp", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET, clockTolerance: 10 });
  const expiredToken = signJwt({ sub: "u1" }, SECRET, { expiresIn: -5 });
  const { req, res } = mockReqRes(`Bearer ${expiredToken}`);
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, true, "con tolerancia 10s debería pasar aunque expiró hace 5s");
  assert.equal(res.statusCode, 200);
});

test("middleware: rechaza INVALID_AUDIENCE con 401", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET, audience: "api" });
  const token = signJwt({ sub: "u1", aud: "web" }, SECRET);
  const { req, res } = mockReqRes(`Bearer ${token}`);
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(JSON.parse(res.body).code, "INVALID_AUDIENCE");
});

test("middleware: rechaza UNSUPPORTED_ALGORITHM con 401", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
  const fakeSig = Buffer.from("fakesig").toString("base64url");
  const token = `${header}.${payload}.${fakeSig}`;
  const { req, res } = mockReqRes(`Bearer ${token}`);
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(JSON.parse(res.body).code, "UNSUPPORTED_ALGORITHM");
});

test("middleware: rechaza token con JSON inválido (MALFORMED_TOKEN)", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const badPayload = Buffer.from("not-json").toString("base64url");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const token = `${header}.${badPayload}.fakesig`;
  const { req, res } = mockReqRes(`Bearer ${token}`);
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(JSON.parse(res.body).code, "MALFORMED_TOKEN");
});

test("middleware: no popula req.user en caso de fallo y Content-Type es JSON", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const { req, res } = mockReqRes("Bearer invalid.token.here");
  // capturar headers de writeHead
  let capturedHeaders: Record<string, string> | undefined;
  const origWriteHead = res.writeHead;
  res.writeHead = ((code: number, headers?: Record<string, string>) => {
    capturedHeaders = headers;
    return origWriteHead.call(res, code, headers);
  }) as unknown as typeof res.writeHead;
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal((req as unknown as { user?: unknown }).user, undefined);
  assert.equal(capturedHeaders?.["Content-Type"], "application/json");
});

test("middleware: acepta Bearer case-insensitive", () => {
  const middleware = createJwtAuthMiddleware({ secret: SECRET });
  const token = signJwt({ sub: "u1" }, SECRET);
  const { req, res } = mockReqRes(`bEaReR ${token}`);
  let next = false;
  middleware(req as unknown as IncomingMessage & { user?: unknown }, res, () => { next = true; });
  assert.equal(next, true);
});

test("createJwtAuthMiddleware acepta secret de exactamente 8 caracteres", () => {
  assert.doesNotThrow(() => createJwtAuthMiddleware({ secret: "12345678" }));
});

test("authenticateRequest: retorna null y 401 si falta Authorization header", () => {
  const { req, res } = mockReqRes(undefined);
  const result = authenticateRequest(req, res, SECRET);
  assert.equal(result, null);
  assert.equal(res.statusCode, 401);
  assert.match(JSON.parse(res.body).error, /missing token/i);
});
