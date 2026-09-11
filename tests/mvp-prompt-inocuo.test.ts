import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MVP_TRACKING_PING_PREFIX,
  MVP_TRACKING_PING_SUFFIX,
  MVP_TRACKING_TOOLS,
  buildMvpAsyncBody,
  buildMvpAsyncLegacy,
  buildMvpChatParts,
  buildMvpNoReplyBody,
  buildMvpNoReplyLegacy,
  buildMvpSyncBody,
  buildMvpSyncLegacy,
  buildMvpTrackingPing,
} from "../headless-runtime/factory/factoryServer.ts";

// H-010 — la sesión MVP de seguimiento NUNCA recibe el prompt crudo del usuario.
// Todo offline: builders puros + lectura estática de factoryServer.ts.
// Cero LLM, cero daemon, cero mocks (no hay nada que mockear: todo es puro).

// Prompt adversario estilo H-010 (corrida 6, E2E-12): si este texto llegara a la
// sesión con tools de escritura, el agente lo ejecuta como tarea y escribe en el
// worktree fuera de todo tracking (createdFiles: [] con archivos reales).
const RAW_PROMPT_ADVERSO =
  "Creá lab6-e9a/ficha.txt con exactamente esta única línea: FICHA E9A OK";
const JOB_ID = "job-mtmdu116-9u37";

const REPO = new URL("..", import.meta.url);
function readSrc(rel: string): string {
  return fs.readFileSync(new URL(rel, REPO), "utf-8");
}
const SERVER_SRC = readSrc("headless-runtime/factory/factoryServer.ts");

function collectTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTexts(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectTexts(v, out);
  }
  return out;
}

function partText(payload: Record<string, unknown>): string {
  const parts = payload.parts as Array<{ type?: string; text?: string }> | undefined;
  assert.ok(Array.isArray(parts) && parts.length > 0, "el payload debe llevar parts");
  assert.equal(parts[0]?.type, "text");
  assert.equal(typeof parts[0]?.text, "string");
  return parts[0]?.text as string;
}

const MODEL = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" };
const SESSION_ID = "ses_mvp_inocuo_01";

// ── Ping documentado ──────────────────────────────────────────────────────
// Texto: "sesión de seguimiento del job <id> lista — sin acción requerida".
// Por qué: frase declarativa de estado, sin imperativo ni tarea interpretable
// ("lista" = estado; "sin acción requerida" = no-op explícito); el job id da
// trazabilidad en la web de opencode (espeja el title `Factory <id> <phase>`).

test("H-010: el ping se compone de las consts exportadas + job id (cero hardcodeos)", () => {
  const ping = buildMvpTrackingPing(JOB_ID);
  assert.equal(ping, `${MVP_TRACKING_PING_PREFIX} ${JOB_ID} ${MVP_TRACKING_PING_SUFFIX}`);
  assert.ok(ping.includes(JOB_ID), "trazabilidad al job");
  assert.notEqual(ping, RAW_PROMPT_ADVERSO);
  assert.equal(ping.includes(RAW_PROMPT_ADVERSO), false, "el ping no arrastra el prompt crudo");
});

test("H-010: variante A sync (path/body + legacy) emite el ping, no el prompt crudo", () => {
  const ping = buildMvpTrackingPing(JOB_ID);
  for (const payload of [
    buildMvpSyncBody(MODEL, ping),
    buildMvpSyncLegacy(SESSION_ID, MODEL, ping),
    buildMvpSyncBody(MODEL, ping, "default"),
    buildMvpSyncLegacy(SESSION_ID, MODEL, ping, "default"),
  ]) {
    assert.equal(partText(payload), ping);
    for (const text of collectTexts(payload)) {
      assert.equal(text.includes(RAW_PROMPT_ADVERSO), false, `fuga del prompt crudo en sync: ${text.slice(0, 80)}`);
    }
  }
});

test("H-010: variante A fallback async (path/body + legacy) emite el ping, no el prompt crudo", () => {
  const ping = buildMvpTrackingPing(JOB_ID);
  for (const payload of [
    buildMvpAsyncBody(MODEL, ping),
    buildMvpAsyncLegacy(SESSION_ID, MODEL, ping),
    buildMvpAsyncBody(MODEL, ping, "default"),
    buildMvpAsyncLegacy(SESSION_ID, MODEL, ping, "default"),
  ]) {
    assert.equal(partText(payload), ping);
    for (const text of collectTexts(payload)) {
      assert.equal(text.includes(RAW_PROMPT_ADVERSO), false, `fuga del prompt crudo en async: ${text.slice(0, 80)}`);
    }
  }
});

test("H-010: variante B noReply (async + path/body + legacy) emite el ping, no el prompt crudo", () => {
  const ping = buildMvpTrackingPing(JOB_ID);
  const asyncPayload = { path: { id: SESSION_ID }, body: buildMvpNoReplyBody(ping) };
  const pathPayload = { path: { id: SESSION_ID }, body: buildMvpNoReplyBody(ping) };
  const legacyPayload = buildMvpNoReplyLegacy(SESSION_ID, ping);
  assert.equal(legacyPayload.sessionID, SESSION_ID);
  for (const payload of [asyncPayload, pathPayload, legacyPayload]) {
    const body = (payload as { body?: Record<string, unknown> }).body ?? payload;
    assert.equal((body as Record<string, unknown>).noReply, true, "B sigue siendo noReply (sin modelo, sin reply)");
    assert.equal(partText(body as Record<string, unknown>), ping);
    for (const text of collectTexts(payload)) {
      assert.equal(text.includes(RAW_PROMPT_ADVERSO), false, `fuga del prompt crudo en noReply: ${text.slice(0, 80)}`);
    }
  }
});

test("H-010: variante C chat (3 shapes) porta el ping, no el prompt crudo", () => {
  const ping = buildMvpTrackingPing(JOB_ID);
  const parts = buildMvpChatParts(ping);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.type, "text");
  assert.equal(parts[0]?.text, ping);
  assert.equal((parts[0]?.text as string).includes(RAW_PROMPT_ADVERSO), false);
});

// ── Cinturón tools (APLICADO donde el shape lo honra) ─────────────────────
// Vocabulario: allowlist {read,glob,grep,webfetch} espejada de TRIAGE_TOOLS —
// es la forma que el server efímero ya honra en triage/spec/review (mismo
// canal session.prompt path/body). webfetch es solo lectura remota: el
// cinturón sigue siendo no-escritura. Evidencia de que `tools:{}` NO niega:
// el sync MVP llevaba `tools:{}` e igual escribió (H-010). La variante C
// (session.chat anómalo) no tiene slot `tools` en su shape en ningún caller
// del repo → ahí solo rige el ping (carry-over documentado, asertado abajo).

test("H-010: MVP_TRACKING_TOOLS es allowlist read-only espejada de triage (sin write/edit/bash)", () => {
  assert.deepEqual(Object.keys(MVP_TRACKING_TOOLS).sort(), ["glob", "grep", "read", "webfetch"]);
  for (const payload of [
    buildMvpSyncBody(MODEL, buildMvpTrackingPing(JOB_ID)),
    buildMvpSyncLegacy(SESSION_ID, MODEL, buildMvpTrackingPing(JOB_ID)),
    buildMvpAsyncBody(MODEL, buildMvpTrackingPing(JOB_ID)),
    buildMvpAsyncLegacy(SESSION_ID, MODEL, buildMvpTrackingPing(JOB_ID)),
    buildMvpNoReplyBody(buildMvpTrackingPing(JOB_ID)),
    buildMvpNoReplyLegacy(SESSION_ID, buildMvpTrackingPing(JOB_ID)),
  ]) {
    assert.deepEqual(payload.tools, { read: true, glob: true, grep: true, webfetch: true });
    for (const text of collectTexts(payload)) {
      assert.match(text, /^(?!.*"(write|edit|bash)"\s*:\s*true).*$/s, `tools con escritura habilitada: ${text.slice(0, 120)}`);
    }
  }
});

test("H-010 carry-over: variante C no tiene slot tools (el ping es su única protección)", () => {
  const parts = buildMvpChatParts(buildMvpTrackingPing(JOB_ID));
  assert.equal("tools" in (parts[0] as Record<string, unknown>), false);
});

// ── job.prompt sigue persistido donde corresponde ─────────────────────────

test("H-010: job.prompt sigue persistido en prompt.md + job.json (nada se pierde)", () => {
  assert.ok(
    SERVER_SRC.includes('fs.writeFileSync(path.join(dir, "prompt.md"), job.prompt'),
    "prompt.md intacto",
  );
  assert.ok(SERVER_SRC.includes("prompt: job.prompt,"), "job.json intacto");
});

// ── El dispatch a session.prompt jamás ve job.prompt + flujo intacto ──────

test("H-010 estático: el dispatch MVP usa el ping; job.prompt no cruza la sesión", () => {
  assert.ok(
    SERVER_SRC.includes("const promptText = buildMvpTrackingPing(job.id)"),
    "el texto enviado nace del ping, no del prompt",
  );
  assert.equal(
    SERVER_SRC.includes("const promptText = job.prompt"),
    false,
    "la asignación cruda debe haber desaparecido",
  );
  assert.equal(SERVER_SRC.includes("tools: {}"), false, "ningún builder MVP conserva tools:{} (niega nada)");
});

test("H-010 estático: flujo intacto (fire-and-forget, visibilidad, ids, timeouts, título)", () => {
  assert.ok(
    SERVER_SRC.includes("void tryCreateOpencodeSession(job).catch(() => {});"),
    "fire-and-forget intacto",
  );
  assert.ok(SERVER_SRC.includes("isPromptVisible"), "chequeo de visibilidad intacto");
  assert.ok(SERVER_SRC.includes("job.sessionId = sessionId;"), "sessionId guardado intacto");
  assert.ok(SERVER_SRC.includes("`Factory ${job.id} ${job.phase}`"), "título de sesión intacto (contrato)");
  assert.ok(SERVER_SRC.includes("12000"), "timeout sync 12000ms intacto");
  assert.ok(SERVER_SRC.includes("2000"), "timeout async/noReply/chat 2000ms intacto");
});
