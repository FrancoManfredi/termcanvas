/**
 * TANDA B — delegación de decisiones de sesión a intake/intakeSession.
 *
 * Contrato de delegación (NO duplica asserts de negocio, solo delegación):
 * - El cascarón delega la extracción del sessionId + el formateo de errores
 *   del SDK en el dominio (alias de 1 línea, cero cambios de call-sites).
 * - La lógica vive en intake/intakeSession (pura, testeable sin server vivo,
 *   sin red, con respuestas SDK mockeadas).
 * - Formas intactas por constantes espejo + pins de carry-over.
 * - Carry-overs pineados por estática: orquestador vivo (flujo contra red
 *   viva + needles del scanner + texto H-010) queda en el cascarón
 *   (B-S1/B-S2 en el reporte, no a ciegas); el create usa el transporte
 *   único sin reintento ante timeout.
 * Todo offline en memoria, sin daemon, sin docker, sin LLM (SDK mockeado por
 * formas: objetos literales con las shapes v2/legacy/anidadas).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTAKE_PROMPT_ASYNC_MS,
  INTAKE_PROMPT_SYNC_MS,
  INTAKE_SESSION_CREATE_MS,
  INTAKE_VISIBLE_MS,
  extractIntakeSessionId,
  intakeResultError,
  shortIntakeError,
} from "../headless-runtime/factory/intake/intakeSession.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);
const DOMAIN_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "intake", "intakeSession.ts"),
  "utf-8",
);

// ── A. Delegación estática: el server no duplica decisiones de sesión ──

test("B-A1 sesión delega: el cascarón importa y llama al dominio (alias de 1 línea)", () => {
  assert.ok(SERVER_SRC.includes("./intake/intakeSession"), "el server importa intake/intakeSession");
  assert.ok(SERVER_SRC.includes("extractIntakeSessionIdB("), "la extracción delega en el dominio");
  assert.ok(SERVER_SRC.includes("intakeResultErrorB("), "el error del SDK delega en el dominio");
  assert.ok(SERVER_SRC.includes("shortIntakeErrorB("), "el recorte delega en el dominio");
  assert.ok(DOMAIN_SRC.includes("export function extractIntakeSessionId("), "el dominio expone la extracción");
  assert.ok(DOMAIN_SRC.includes("export function intakeResultError("), "el dominio expone el error del SDK");
  assert.ok(DOMAIN_SRC.includes("export function shortIntakeError("), "el dominio expone el recorte");
});

test("B-A2 cero extracción duplicada en el server (el shape snake vive solo en el dominio)", () => {
  assert.equal(SERVER_SRC.includes("session_id"), false, "el shape snake se mudó al dominio");
  assert.ok(DOMAIN_SRC.includes("session_id"), "el dominio cubre el shape snake");
  assert.ok(DOMAIN_SRC.includes("ses_"), "el dominio cubre el string directo");
  assert.ok(DOMAIN_SRC.includes("o.session"), "el dominio cubre el anidado");
});

test("B-A3 alias delgados estilo E1 (cero cambios de call-sites)", () => {
  assert.ok(
    SERVER_SRC.includes("const hasResultError = (res: unknown): string | null => intakeResultErrorB(res);"),
    "hasResultError es alias de 1 línea",
  );
  assert.ok(
    SERVER_SRC.includes("const shortErr = (e: unknown): string => shortIntakeErrorB(e);"),
    "shortErr es alias de 1 línea",
  );
  assert.ok(SERVER_SRC.includes("sessionId = extractIntakeSessionIdB(res);"), "la asignación usa el dominio");
  assert.ok(SERVER_SRC.includes("job.sessionId = sessionId;"), "el guardado intacto sigue en el cascarón");
});

// ── B. Formas intactas (decisiones puras con SDK mockeado, sin red) ──

test("B-B1 extracción: shapes mockeados del SDK (v2, legacy, anidados, unknown)", () => {
  assert.equal(extractIntakeSessionId("ses_mock_01"), "ses_mock_01");
  assert.equal(extractIntakeSessionId({ data: { id: "ses_mock_02" } }), "ses_mock_02");
  assert.equal(extractIntakeSessionId({ data: { sessionID: "ses_mock_03" } }), "ses_mock_03");
  assert.equal(extractIntakeSessionId({ sessionId: "ses_mock_04" }), "ses_mock_04");
  assert.equal(extractIntakeSessionId({ data: { session_id: "ses_mock_05" } }), "ses_mock_05");
  assert.equal(extractIntakeSessionId({ data: { session: { id: "ses_mock_06" } } }), "ses_mock_06");
  assert.equal(extractIntakeSessionId({ data: { session: { sessionID: "ses_mock_07" } } }), "ses_mock_07");
  assert.equal(extractIntakeSessionId({ data: null }), undefined);
  assert.equal(extractIntakeSessionId({ error: { message: "boom" } }), undefined);
  assert.equal(extractIntakeSessionId(null), undefined);
  assert.equal(extractIntakeSessionId(undefined), undefined);
  assert.equal(extractIntakeSessionId(42), undefined);
});

test("B-B2 error del SDK: {error} recorta a 180, resto null honesto", () => {
  const err = intakeResultError({ error: { message: "Unexpected server error" } });
  assert.ok(typeof err === "string" && err.includes("Unexpected server error"));
  assert.ok((err as string).length <= 180);
  assert.equal(intakeResultError({ data: { id: "ses_x" } }), null);
  assert.equal(intakeResultError(null), null);
  assert.equal(intakeResultError({ error: null }), null);
});

test("B-B3 recorte: 140 chars sin saltos, nunca lanza", () => {
  assert.equal(shortIntakeError(new Error("a\nb  c")), "a b c");
  assert.equal(shortIntakeError("x".repeat(500)).length, 140);
  assert.equal(typeof shortIntakeError(undefined), "string");
});

test("B-B4 create del intake por el transporte único (sin reintento ante timeout)", () => {
  assert.equal(INTAKE_SESSION_CREATE_MS, 8000);
  assert.equal(INTAKE_PROMPT_SYNC_MS, 12000);
  assert.equal(INTAKE_PROMPT_ASYNC_MS, 2000);
  assert.equal(INTAKE_VISIBLE_MS, 1000);
  for (const v of [INTAKE_SESSION_CREATE_MS, INTAKE_PROMPT_SYNC_MS, INTAKE_PROMPT_ASYNC_MS, INTAKE_VISIBLE_MS]) {
    assert.ok(Number.isFinite(v) && v > 0 && v <= 12000, "timeouts acotados y finitos");
  }
  assert.ok(SERVER_SRC.includes("withTransportRetry"), "el create vivo usa el transporte único");
  assert.ok(SERVER_SRC.includes("intake session.create"), "el create vivo pineado por label");
  assert.ok(SERVER_SRC.includes("SESSION_CREATE_FUSE_MS"), "el create vivo usa el fusible único");
});

// ── C. Carry-overs pineados (no migrables sin daemon vivo ni romper pins) ──

test("B-C1 carry-over B-S1: el orquestador vivo queda en el cascarón (texto H-010 + needles intactos)", () => {
  assert.ok(SERVER_SRC.includes("export async function tryCreateOpencodeSession"), "el orquestador sigue exportado");
  assert.ok(SERVER_SRC.includes("const promptText = buildMvpTrackingPing(job.id)"), "el ping intacto");
  assert.ok(SERVER_SRC.includes("isPromptVisible"), "la visibilidad intacta");
  assert.ok(SERVER_SRC.includes("`Factory ${job.id} ${job.phase}`"), "el título intacto");
  assert.ok(SERVER_SRC.includes("withTransportRetry"), "el create usa el transporte único (doctrina no-resend)");
  assert.ok(!SERVER_SRC.includes("isTimeoutErrorLocal"), "sin reintento ante timeout (huérfana sesiones)");
});

test("B-C2 carry-over B-SHIM: shims con texto pineado por H-010 no se borran", () => {
  assert.ok(SERVER_SRC.includes("function ensureJobDir("), "ensureJobDir viva (prompt.md + job.json pineados)");
  assert.ok(SERVER_SRC.includes("function appendJobLog("), "appendJobLog viva (flujo de sesión)");
  assert.ok(SERVER_SRC.includes('fs.writeFileSync(path.join(dir, "prompt.md"), job.prompt'), "prompt.md intacto");
});

// ── D. Barrido extendido (cero lógica de sesión fuera de delegación) ──

test("B-D1 barrido: ESM cero require() en el dominio + punto de llamada", () => {
  for (const src of [DOMAIN_SRC, SERVER_SRC]) {
    assert.doesNotMatch(src, /\brequire\s*\(\s*["'`]/);
  }
});

test("B-D2 barrido: el dominio nuevo no trae loops al daemon (scanner verde)", () => {
  const pats: Array<[string, RegExp]> = [
    ["setInterval", /setInterval\s*\(/],
    ["setTimeout", /setTimeout\s*\(/],
    ["while", /while\s*\(/],
    ["for", /for\s*\(/],
    ["retry-word", /\bretry\b/i],
  ];
  for (const [name, re] of pats) {
    assert.equal(re.test(DOMAIN_SRC), false, `el dominio no debe traer ${name} (prohibido en archivos nuevos)`);
  }
});

test("B-D3 barrido: el dominio es puro total (cero imports)", () => {
  const imports = DOMAIN_SRC.split("\n").filter((l) => /(^|\s)import[\s(]/.test(l));
  assert.deepEqual(imports, [], `intakeSession debe ser puro sin imports, hallados: ${imports.join(" | ")}`);
});
