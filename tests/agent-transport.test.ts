import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL_AGENT_FUSE_MS,
  SESSION_CREATE_FUSE_MS,
  attemptJsonPromptOnce,
  attemptPromptOnce,
  extractSessionText,
  isRetryableTransportError,
  isTimeoutLikeError,
  parseSessionId,
  readResultError,
  withTimeout,
  withTimeoutNoResend,
  withTransportRetry,
} from "../headless-runtime/llm/agentTransport.ts";

// Módulo único de transporte LLM (doctrina no-resend, Track A):
// timeout/abort = el modelo sigue pensando → NUNCA reenviar;
// transporte = la request nunca se estableció → UN reintento seguro.

// ── Clasificación ──

test("isTimeoutLikeError: timeout/abort true, resto false", () => {
  assert.equal(isTimeoutLikeError(new Error("timeout 600000ms x")), true);
  assert.equal(isTimeoutLikeError("abort session.prompt"), true);
  assert.equal(isTimeoutLikeError("aborted"), true);
  assert.equal(isTimeoutLikeError("econnreset"), false);
  assert.equal(isTimeoutLikeError("fetch failed"), false);
  assert.equal(isTimeoutLikeError(""), false);
  assert.equal(isTimeoutLikeError(null), false);
});

test("isRetryableTransportError: transporte true, timeout/abort/zod false", () => {
  assert.equal(isRetryableTransportError(""), true);
  assert.equal(isRetryableTransportError("   "), true);
  assert.equal(isRetryableTransportError("{}"), true);
  assert.equal(isRetryableTransportError("econnreset socket hang up"), true);
  assert.equal(isRetryableTransportError("fetch failed"), true);
  assert.equal(isRetryableTransportError("UnknownError: boom"), true);
  assert.equal(isRetryableTransportError("Unexpected server error"), true);
  assert.equal(isRetryableTransportError("timeout 600000ms x"), false);
  assert.equal(isRetryableTransportError("abort x"), false);
  assert.equal(isRetryableTransportError('review JSON parse error: no object'), false);
  assert.equal(isRetryableTransportError("scorer label inválido"), false);
});

test("fusibles: global 10min, create 30s", () => {
  assert.equal(GLOBAL_AGENT_FUSE_MS, 600_000);
  assert.equal(SESSION_CREATE_FUSE_MS, 30_000);
});

// ── Primitivas ──

test("withTimeout: resuelve rápido, rechaza ante fusible corto", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "t"), "ok");
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "corto"), /timeout 20ms corto/);
});

test("withTransportRetry: éxito al 1º (1 llamada); transporte (2 llamadas); timeout (1 llamada + lanza)", async () => {
  let calls = 0;
  const ok = await withTransportRetry(async () => {
    calls += 1;
    return "bien";
  }, 1000, "t");
  assert.equal(ok, "bien");
  assert.equal(calls, 1);

  calls = 0;
  const recovered = await withTransportRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error("fetch failed");
    return "recuperado";
  }, 1000, "t");
  assert.equal(recovered, "recuperado");
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    withTransportRetry(async () => {
      calls += 1;
      throw new Error("timeout 1000ms t");
    }, 1000, "t"),
    /timeout/,
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    withTransportRetry(async () => {
      calls += 1;
      throw new Error("zod parse fallo");
    }, 1000, "t"),
    /zod/,
  );
  assert.equal(calls, 1);
});

test("withTimeoutNoResend: timeout = 1 llamada + onTimeout + lanza (cero reenvíos)", async () => {
  let calls = 0;
  let aborted = false;
  await assert.rejects(
    withTimeoutNoResend(
      () => {
        calls += 1;
        return new Promise(() => {});
      },
      20,
      "t",
      () => {
        aborted = true;
      },
    ),
    /timeout 20ms t/,
  );
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test("withTimeoutNoResend: transporte reintenta 1 vez", async () => {
  let calls = 0;
  const out = await withTimeoutNoResend(async () => {
    calls += 1;
    if (calls === 1) throw new Error("econnrefused");
    return "ok";
  }, 1000, "t");
  assert.equal(out, "ok");
  assert.equal(calls, 2);
});

// ── Extracción ──

test("extractSessionText: string, data.text, parts, gate por key, lista assistant", () => {
  assert.equal(extractSessionText("hola"), "hola");
  assert.equal(extractSessionText({ data: { text: "t" } }), "t");
  assert.equal(
    extractSessionText({ data: { parts: [{ text: "a" }, { text: "b" }] } }),
    "a\nb",
  );
  const obj = { data: { nested: true, verdict: "accept" } };
  const gated = extractSessionText(obj, "verdict");
  assert.ok(gated !== null && gated.includes('"verdict"'));
  assert.equal(extractSessionText(obj, "decision"), null);
  assert.equal(
    extractSessionText([
      { info: { role: "user", text: "q" } },
      { info: { role: "assistant", text: "r" } },
    ]),
    "r",
  );
  assert.equal(extractSessionText(null), null);
  assert.equal(extractSessionText({ data: {} }), "{}");
});

test("readResultError: error plano y anidado, null sin error", () => {
  assert.equal(readResultError({ error: { code: 500 } }), '{"code":500}');
  assert.equal(readResultError({ data: { error: "mal" } }), '"mal"');
  assert.equal(readResultError({ data: { text: "ok" } }), null);
  assert.equal(readResultError(null), null);
});

test("parseSessionId: todas las formas del SDK", () => {
  assert.equal(parseSessionId("ses_abc123"), "ses_abc123");
  assert.equal(parseSessionId({ id: "ses_1" }), "ses_1");
  assert.equal(parseSessionId({ sessionID: "ses_2" }), "ses_2");
  assert.equal(parseSessionId({ data: { sessionId: "ses_3" } }), "ses_3");
  assert.equal(parseSessionId({ data: { session: { id: "ses_4" } } }), "ses_4");
  assert.equal(parseSessionId({ data: null }), null);
  assert.equal(parseSessionId(null), null);
});

// ── Intento único ──

test("attemptPromptOnce: éxito devuelve raw; error embebido va a lastErr; timeout = 1 llamada", async () => {
  const ok = await attemptPromptOnce(async () => ({ data: { text: '{"decision":"building"}' } }), {
    label: "t",
    preferKey: "decision",
  });
  assert.ok(ok.raw !== null && ok.raw.includes("building"));
  assert.equal(ok.lastErr, null);

  const bad = await attemptPromptOnce(async () => ({ error: "boom" }), { label: "t" });
  assert.equal(bad.raw, null);
  assert.match(String((bad.lastErr as Error)?.message ?? bad.lastErr), /boom/);

  let calls = 0;
  const timed = await attemptPromptOnce(
    async () => {
      calls += 1;
      return new Promise(() => {});
    },
    { ms: 20, label: "t" },
  );
  assert.equal(timed.raw, null);
  assert.match(String((timed.lastErr as Error)?.message ?? ""), /timeout/);
  assert.equal(calls, 1);
});

test("attemptJsonPromptOnce: sin opt-in quita format (texto plano directo)", async () => {
  const seen: unknown[] = [];
  const out = await attemptJsonPromptOnce(
    async (_signal, payload) => {
      seen.push(payload);
      return { data: { text: '{"verdict":"accept"}' } };
    },
    {
      payload: { sessionID: "ses_x", format: { type: "json_schema", schema: {} } },
      label: "t-json",
      preferKey: "verdict",
    },
  );
  assert.ok(out.raw !== null && out.raw.includes("accept"));
  assert.equal(seen.length, 1);
  assert.ok(!("format" in (seen[0] as Record<string, unknown>)));
});

test("attemptJsonPromptOnce: 400 OutputFormat → memo + 1 reintento en texto plano", async () => {
  const prev = process.env.TERMCANVAS_STRUCTURED_OUTPUT;
  process.env.TERMCANVAS_STRUCTURED_OUTPUT = "1";
  try {
    const seen: unknown[] = [];
    let calls = 0;
    const out = await attemptJsonPromptOnce(
      async (_signal, payload) => {
        calls += 1;
        seen.push(payload);
        if (calls === 1) throw new Error("Expected OutputFormatJsonSchema, got {...}");
        return { data: { text: '{"verdict":"accept"}' } };
      },
      {
        payload: { sessionID: "ses_x", format: { type: "json_schema", schema: {} } },
        label: "t-400",
        preferKey: "verdict",
      },
    );
    assert.ok(out.raw !== null && out.raw.includes("accept"));
    assert.equal(calls, 2);
    assert.ok("format" in (seen[0] as Record<string, unknown>));
    assert.ok(!("format" in (seen[1] as Record<string, unknown>)));
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_STRUCTURED_OUTPUT;
    else process.env.TERMCANVAS_STRUCTURED_OUTPUT = prev;
  }
});
