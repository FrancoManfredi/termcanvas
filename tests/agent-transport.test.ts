import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL_AGENT_FUSE_MS,
  SESSION_CREATE_FUSE_MS,
  attemptJsonPromptAsyncOnce,
  attemptJsonPromptOnce,
  attemptPromptAsyncOnce,
  attemptPromptOnce,
  extractSessionText,
  globalAgentFuseMs,
  isRetryableTransportError,
  isTimeoutLikeError,
  parseSessionId,
  readResultError,
  withTimeout,
  withTimeoutNoResend,
  withTransportRetry,
} from "../headless-runtime/llm/agentTransport.ts";
import { resetFormatUnsupportedMemoForTests } from "../headless-runtime/llm/structuredOutput.ts";

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

test("globalAgentFuseMs: default y override por TERMCANVAS_AGENT_FUSE_MS", () => {
  const prev = process.env.TERMCANVAS_AGENT_FUSE_MS;
  try {
    delete process.env.TERMCANVAS_AGENT_FUSE_MS;
    assert.equal(globalAgentFuseMs(), GLOBAL_AGENT_FUSE_MS);
    process.env.TERMCANVAS_AGENT_FUSE_MS = "1800000";
    assert.equal(globalAgentFuseMs(), 1_800_000);
    process.env.TERMCANVAS_AGENT_FUSE_MS = "0";
    assert.equal(globalAgentFuseMs(), GLOBAL_AGENT_FUSE_MS, "0 cae al default");
    process.env.TERMCANVAS_AGENT_FUSE_MS = "nope";
    assert.equal(globalAgentFuseMs(), GLOBAL_AGENT_FUSE_MS, "inválido cae al default");
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_AGENT_FUSE_MS;
    else process.env.TERMCANVAS_AGENT_FUSE_MS = prev;
  }
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

test("readResultError: error vacío cae al status HTTP (incidente #125)", () => {
  // El SDK devuelve `error: {}` cuando la respuesta no-2xx no trae body
  // (hey-api `finalError = finalError || {}`): sin esto el mensaje era "{}".
  assert.equal(
    readResultError({
      error: {},
      response: { status: 500, statusText: "Internal Server Error" },
    }),
    "HTTP 500 Internal Server Error (empty error body)",
  );
  assert.equal(
    readResultError({ error: {}, response: { status: 504 } }),
    "HTTP 504 (empty error body)",
  );
  assert.equal(
    readResultError({
      data: { error: {} },
      response: { status: 502, statusText: "Bad Gateway" },
    }),
    "HTTP 502 Bad Gateway (empty error body)",
  );
  // Sin status legible conserva el "{}" legacy (nunca inventa).
  assert.equal(readResultError({ error: {} }), "{}");
  assert.equal(
    readResultError({ error: {}, response: { status: "raro" } }),
    "{}",
  );
  // Un error con contenido sigue teniendo prioridad sobre el status.
  assert.equal(
    readResultError({
      error: { message: "boom" },
      response: { status: 500, statusText: "Internal Server Error" },
    }),
    '{"message":"boom"}',
  );
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
  resetFormatUnsupportedMemoForTests();
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

// ── Transporte async (promptAsync + poll), incidente #125 ──

test("attemptPromptAsyncOnce: ack inmediato + poll hasta el assistant completo", async () => {
  let messageCalls = 0;
  let ackParams: Record<string, unknown> | null = null;
  // Turno viejo ya terminado y RECIENTE: el corte por índice (conteo previo)
  // debe ganarle al de timestamp (sesión reusada por el loop).
  const oldUser = { info: { role: "user", text: "prev" } };
  const oldAssistant = {
    info: {
      role: "assistant",
      finish: "stop",
      time: { created: Date.now(), completed: Date.now() },
      parts: [{ type: "text", text: "viejo" }],
    },
  };
  const api = {
    promptAsync: async (params: Record<string, unknown>) => {
      ackParams = params;
      return { data: {} };
    },
    messages: async () => {
      messageCalls += 1;
      // #1: conteo previo (2 mensajes del turno anterior).
      if (messageCalls === 1) return { data: [oldUser, oldAssistant] };
      // #2: nuestro turno con paso intermedio `tool-calls` (no cierra).
      if (messageCalls === 2) {
        return {
          data: [
            oldUser,
            oldAssistant,
            { info: { role: "user", text: "hola" } },
            {
              info: {
                role: "assistant",
                finish: "tool-calls",
                time: { created: Date.now(), completed: Date.now() },
                parts: [{ type: "text", text: "paso intermedio" }],
              },
            },
          ],
        };
      }
      // #3: assistant final (stop) → se devuelve ESTE, no el viejo.
      return {
        data: [
          oldUser,
          oldAssistant,
          { info: { role: "user", text: "hola" } },
          {
            info: {
              role: "assistant",
              finish: "stop",
              time: { created: Date.now(), completed: Date.now() },
              parts: [{ type: "text", text: '{"green":true}' }],
            },
          },
        ],
      };
    },
  };
  const out = await attemptPromptAsyncOnce(api, {
    payload: { parts: [{ type: "text", text: "hola" }] },
    sessionID: "ses_async_1",
    label: "t-async",
    preferKey: "green",
    pollIntervalMs: 5,
    ms: 2_000,
  });
  assert.equal(out.raw, '{"green":true}');
  assert.equal(out.lastErr, null);
  assert.ok(messageCalls >= 3, "pre-conteo + poll hasta completar");
  assert.equal(ackParams?.sessionID, "ses_async_1");
});

test("attemptPromptAsyncOnce: fusible aborta el turno y no reenvía", async () => {
  let prompts = 0;
  let aborted = 0;
  const out = await attemptPromptAsyncOnce(
    {
      promptAsync: async () => {
        prompts += 1;
        return { data: {} };
      },
      messages: async () => ({ data: [] }),
      abort: async () => {
        aborted += 1;
        return { data: {} };
      },
    },
    {
      payload: {},
      sessionID: "ses_fuse",
      label: "t-fuse",
      pollIntervalMs: 5,
      ms: 30,
    },
  );
  assert.equal(out.raw, null);
  assert.match(String((out.lastErr as Error)?.message ?? ""), /timeout 30ms/);
  assert.equal(prompts, 1, "un solo promptAsync (cero reenvíos)");
  assert.equal(aborted, 1, "aborta el turno server-side al vencer");
});

test("attemptPromptAsyncOnce: abort externo corta el poll y aborta el turno", async () => {
  const ctrl = new AbortController();
  let aborted = 0;
  const started = Date.now();
  setTimeout(() => ctrl.abort(), 20);
  const out = await attemptPromptAsyncOnce(
    {
      promptAsync: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      abort: async () => {
        aborted += 1;
        return { data: {} };
      },
    },
    {
      payload: {},
      sessionID: "ses_cancel",
      label: "t-cancel",
      pollIntervalMs: 5,
      ms: 2_000,
      signal: ctrl.signal,
    },
  );
  const elapsed = Date.now() - started;
  assert.equal(out.raw, null);
  assert.match(String((out.lastErr as Error)?.message ?? ""), /abortado/);
  assert.equal(aborted, 1, "aborta el turno server-side al cancelar");
  assert.ok(elapsed < 1_000, `cortó rápido (${elapsed}ms), no esperó al fusible`);
});

test("attemptPromptAsyncOnce: signal ya abortado no envía nada", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let prompts = 0;
  const out = await attemptPromptAsyncOnce(
    {
      promptAsync: async () => {
        prompts += 1;
        return { data: {} };
      },
      messages: async () => ({ data: [] }),
    },
    {
      payload: {},
      sessionID: "ses_pre",
      label: "t-pre",
      signal: ctrl.signal,
    },
  );
  assert.equal(prompts, 0, "no se envía el prompt con signal abortado");
  assert.match(String((out.lastErr as Error)?.message ?? ""), /abortado antes del envío/);
});

test("attemptPromptAsyncOnce: error del ack se surface con status HTTP, sin poll", async () => {
  let polls = 0;
  const out = await attemptPromptAsyncOnce(
    {
      promptAsync: async () => ({
        error: {},
        response: { status: 500, statusText: "Internal Server Error" },
      }),
      messages: async () => {
        polls += 1;
        return { data: [] };
      },
    },
    { payload: {}, sessionID: "ses_err", label: "t-ack", ms: 200 },
  );
  assert.equal(out.raw, null);
  assert.match(
    String((out.lastErr as Error)?.message ?? ""),
    /HTTP 500 Internal Server Error/,
  );
  assert.equal(polls, 1, "solo el conteo previo; sin poll tras el ack roto");
});

test("attemptJsonPromptAsyncOnce: 400 OutputFormat → memo + 1 reintento en texto plano", async () => {
  resetFormatUnsupportedMemoForTests();
  const prev = process.env.TERMCANVAS_STRUCTURED_OUTPUT;
  process.env.TERMCANVAS_STRUCTURED_OUTPUT = "1";
  try {
    const seen: unknown[] = [];
    let acks = 0;
    const api = {
      promptAsync: async (params: Record<string, unknown>) => {
        acks += 1;
        seen.push(params);
        if (acks === 1) {
          return { error: "Expected OutputFormatJsonSchema, got {...}" };
        }
        return { data: {} };
      },
      // Vacío hasta que el ack #2 entra: el conteo previo de cada intento ve
      // la sesión sin mensajes nuevos y el poll final encuentra el assistant.
      messages: async () => ({
        data:
          acks < 2
            ? []
            : [
                {
                  info: {
                    role: "assistant",
                    finish: "stop",
                    time: { created: Date.now(), completed: Date.now() },
                    parts: [{ type: "text", text: '{"verdict":"accept"}' }],
                  },
                },
              ],
      }),
    };
    const out = await attemptJsonPromptAsyncOnce(api, {
      payload: { sessionID: "ses_x", format: { type: "json_schema", schema: {} } },
      sessionID: "ses_x",
      label: "t-400-async",
      preferKey: "verdict",
      pollIntervalMs: 5,
      ms: 2_000,
    });
    assert.ok(out.raw !== null && out.raw.includes("accept"));
    assert.equal(acks, 2);
    assert.ok("format" in (seen[0] as Record<string, unknown>));
    assert.ok(!("format" in (seen[1] as Record<string, unknown>)));
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_STRUCTURED_OUTPUT;
    else process.env.TERMCANVAS_STRUCTURED_OUTPUT = prev;
  }
});
