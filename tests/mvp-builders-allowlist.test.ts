/**
 * FASE 3 E2 — builders MVP mudados a intake (allowlist mas ping inocuo).
 * node:test + tsx. Offline total: builders puros, sin daemon, sin red,
 * cero LLM real. Mas lectura estatica del cascaron para la delegacion.
 *
 * Cubre lo pedido en F3-E2:
 * - Los 7 builders MVP emiten el ping inocuo, jamas el prompt crudo.
 * - Allowlist read-only donde hay slot (6 con slot; C sin slot por decision).
 * - Variante C ping-only intacta por decision y documentada.
 * - El cascaron delega por identidad C7 (mismas referencias, formas
 *   intactas, dispatch con el ping).
 *
 * Reglas citadas: C1 (ESM, cotas: sin recorridos nuevos), C2 (fail-safe),
 * C5 (aditivo: pacts F01-F14, timeouts y flujo intactos), C6 y C7
 * (identidad, no espejo), C9 (builders puros), C10 (trazabilidad).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Dominios F3-E2 (duenos) ──
import {
  MVP_TRACKING_PING_PREFIX as DOMAIN_PREFIX,
  MVP_TRACKING_PING_SUFFIX as DOMAIN_SUFFIX,
  MVP_TRACKING_TOOLS as DOMAIN_TOOLS,
  buildMvpAsyncBody as domainAsyncBody,
  buildMvpAsyncLegacy as domainAsyncLegacy,
  buildMvpChatParts as domainChatParts,
  buildMvpNoReplyBody as domainNoReplyBody,
  buildMvpNoReplyLegacy as domainNoReplyLegacy,
  buildMvpSyncBody as domainSyncBody,
  buildMvpSyncLegacy as domainSyncLegacy,
  buildMvpTrackingPing as domainPing,
} from "../headless-runtime/factory/intake/mvpBuilders.ts";
import {
  MVP_VARIANT_C_NOTE,
  isMvpPingForJob,
  isSafeIntakeJobId,
} from "../headless-runtime/factory/intake/intakeService.ts";

// ── Cascaron (re-exporta por identidad C7) ──
import {
  MVP_TRACKING_PING_PREFIX as SERVER_PREFIX,
  MVP_TRACKING_PING_SUFFIX as SERVER_SUFFIX,
  MVP_TRACKING_TOOLS as SERVER_TOOLS,
  buildMvpAsyncBody as serverAsyncBody,
  buildMvpAsyncLegacy as serverAsyncLegacy,
  buildMvpChatParts as serverChatParts,
  buildMvpNoReplyBody as serverNoReplyBody,
  buildMvpNoReplyLegacy as serverNoReplyLegacy,
  buildMvpSyncBody as serverSyncBody,
  buildMvpSyncLegacy as serverSyncLegacy,
  buildMvpTrackingPing as serverPing,
} from "../headless-runtime/factory/factoryServer.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);
const BUILDERS_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "intake", "mvpBuilders.ts"),
  "utf-8",
);

// Prompt adversario estilo H-010: si este texto llegara a la sesion con
// tools de escritura, el agente lo ejecuta como tarea fuera de tracking.
const RAW_PROMPT_ADVERSO =
  "Creá lab6-e9a/ficha.txt con exactamente esta única línea: FICHA E9A OK";
const JOB_ID = "job-mtmdu116-9u37";
const MODEL = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" };
const SESSION_ID = "ses_mvp_f3e2_01";

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
  assert.ok(Array.isArray(parts) && parts.length > 0);
  assert.equal(parts[0]?.type, "text");
  assert.equal(typeof parts[0]?.text, "string");
  return parts[0]?.text as string;
}

// ── A. Identidad C7: el cascaron no duplica ──

test("A1 builders mudados: el cascaron re-exporta las MISMAS funciones (identidad, C7)", () => {
  assert.equal(serverPing, domainPing);
  assert.equal(serverSyncBody, domainSyncBody);
  assert.equal(serverSyncLegacy, domainSyncLegacy);
  assert.equal(serverAsyncBody, domainAsyncBody);
  assert.equal(serverAsyncLegacy, domainAsyncLegacy);
  assert.equal(serverNoReplyBody, domainNoReplyBody);
  assert.equal(serverNoReplyLegacy, domainNoReplyLegacy);
  assert.equal(serverChatParts, domainChatParts);
  assert.equal(SERVER_PREFIX, DOMAIN_PREFIX);
  assert.equal(SERVER_SUFFIX, DOMAIN_SUFFIX);
  assert.deepEqual(SERVER_TOOLS, DOMAIN_TOOLS);
});

// ── B. Las 7 variantes emiten el ping, jamas el prompt crudo ──

test("B1 ping inocuo: se compone de consts mas job id (cero hardcodeos en el uso)", () => {
  const ping = domainPing(JOB_ID);
  assert.equal(ping, `${DOMAIN_PREFIX} ${JOB_ID} ${DOMAIN_SUFFIX}`);
  assert.ok(ping.includes(JOB_ID));
  assert.equal(ping.includes(RAW_PROMPT_ADVERSO), false);
  assert.ok(isMvpPingForJob(ping, JOB_ID));
  assert.equal(isMvpPingForJob(RAW_PROMPT_ADVERSO, JOB_ID), false);
});

test("B2 variante A sync (path y body mas legacy) emite el ping, no el crudo", () => {
  const ping = domainPing(JOB_ID);
  for (const payload of [
    domainSyncBody(MODEL, ping),
    domainSyncLegacy(SESSION_ID, MODEL, ping),
    domainSyncBody(MODEL, ping, "default"),
    domainSyncLegacy(SESSION_ID, MODEL, ping, "default"),
  ]) {
    assert.equal(partText(payload), ping);
    for (const text of collectTexts(payload)) {
      assert.equal(text.includes(RAW_PROMPT_ADVERSO), false);
    }
  }
});

test("B3 variante A fallback async (path y body mas legacy) emite el ping, no el crudo", () => {
  const ping = domainPing(JOB_ID);
  for (const payload of [
    domainAsyncBody(MODEL, ping),
    domainAsyncLegacy(SESSION_ID, MODEL, ping),
    domainAsyncBody(MODEL, ping, "default"),
    domainAsyncLegacy(SESSION_ID, MODEL, ping, "default"),
  ]) {
    assert.equal(partText(payload), ping);
    for (const text of collectTexts(payload)) {
      assert.equal(text.includes(RAW_PROMPT_ADVERSO), false);
    }
  }
});

test("B4 variante B noReply (path y body mas legacy) emite el ping, no el crudo", () => {
  const ping = domainPing(JOB_ID);
  const bodies = [domainNoReplyBody(ping), domainNoReplyLegacy(SESSION_ID, ping)];
  for (const body of bodies) {
    assert.equal(body.noReply, true);
    assert.equal(partText(body), ping);
    for (const text of collectTexts(body)) {
      assert.equal(text.includes(RAW_PROMPT_ADVERSO), false);
    }
  }
  assert.equal((domainNoReplyLegacy(SESSION_ID, ping).sessionID as string), SESSION_ID);
});

test("B5 variante C chat porta el ping, no el crudo (ping-only por decision)", () => {
  const ping = domainPing(JOB_ID);
  const parts = domainChatParts(ping);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.type, "text");
  assert.equal(parts[0]?.text, ping);
  assert.equal((parts[0]?.text as string).includes(RAW_PROMPT_ADVERSO), false);
  assert.equal("tools" in (parts[0] as Record<string, unknown>), false);
});

// ── C. Allowlist donde hay slot; C documentado ──

test("C1 allowlist read-only donde hay slot (6 con slot; sin write ni edit ni bash)", () => {
  assert.deepEqual(Object.keys(DOMAIN_TOOLS).sort(), ["glob", "grep", "read", "webfetch"]);
  const ping = domainPing(JOB_ID);
  for (const payload of [
    domainSyncBody(MODEL, ping),
    domainSyncLegacy(SESSION_ID, MODEL, ping),
    domainAsyncBody(MODEL, ping),
    domainAsyncLegacy(SESSION_ID, MODEL, ping),
    domainNoReplyBody(ping),
    domainNoReplyLegacy(SESSION_ID, ping),
  ]) {
    assert.deepEqual(payload.tools, { read: true, glob: true, grep: true, webfetch: true });
    for (const text of collectTexts(payload)) {
      assert.match(text, /^(?!.*"(write|edit|bash)"\s*:\s*true).*$/s);
    }
  }
});

test("C2 variante C documentada: nota ping-only mas guard de ids (intakeService)", () => {
  assert.equal(typeof MVP_VARIANT_C_NOTE, "string");
  assert.ok(MVP_VARIANT_C_NOTE.includes("sin slot"));
  assert.ok(MVP_VARIANT_C_NOTE.includes("ping"));
  assert.equal(isSafeIntakeJobId(JOB_ID), true);
  assert.equal(isSafeIntakeJobId("../escape"), false);
  assert.equal(isSafeIntakeJobId(""), false);
});

// ── D. Delegacion del cascaron: dispatch con el ping, formas intactas ──

test("D1 estatico: el dispatch MVP usa el ping del dominio; el crudo no cruza la sesion", () => {
  assert.ok(
    SERVER_SRC.includes("const promptText = buildMvpTrackingPing(job.id)"),
    "el texto enviado nace del ping, no del prompt",
  );
  assert.equal(SERVER_SRC.includes("const promptText = job.prompt"), false);
  assert.ok(SERVER_SRC.includes("./intake/mvpBuilders"), "el cascaron delega en intake/mvpBuilders");
  assert.ok(SERVER_SRC.includes("FASE 3 E2"), "bloque E2 delimitado con comentarios");
});

test("D2 estatico: flujo intacto (fire-and-forget, visibilidad, ids, timeouts, titulo)", () => {
  assert.ok(SERVER_SRC.includes("void tryCreateOpencodeSession(job).catch(() => {});"));
  assert.ok(SERVER_SRC.includes("isPromptVisible"));
  assert.ok(SERVER_SRC.includes("job.sessionId = sessionId;"));
  assert.ok(SERVER_SRC.includes("`Factory ${job.id} ${job.phase}`"));
  assert.ok(SERVER_SRC.includes("12000"));
  assert.ok(SERVER_SRC.includes("2000"));
});

test("D3 estatico: builders viven en el dominio (cero literales nuevos en el cascaron)", () => {
  assert.ok(BUILDERS_SRC.includes("toolsetFor"), "la allowlist sale de la politica unica");
  assert.ok(!BUILDERS_SRC.includes("17680"), "cero puertos literales en builders");
  assert.ok(!BUILDERS_SRC.includes("node:22-bookworm"), "cero imagenes literales en builders");
  assert.ok(!BUILDERS_SRC.includes("require("), "ESM: cero require()");
});
