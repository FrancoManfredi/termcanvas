/**
 * TANDA C — dispatch por tabla en factoryServer (C8 rutas en tabla).
 *
 * Verifica que las ~29 ramas `if (method ===` del server se reemplazaron por
 * UN match (`matchRoute` de routing/routeTable, loop acotado a la tabla) +
 * switch por dominio, con formas y handlers intactos:
 * - Todas las filas delegan (canónica + alias dual resuelven al mismo dominio).
 * - El switch cubre todos los dominios (job-build-log comparte dominio).
 * - Cero `if (method ===` en el server (la única excepción viva es el
 *   pre-vuelo OPTIONS, que usa `req.method` y no es una ruta).
 * - 404 idéntico ante no-ruta (misma forma `not found: M P` en ambas salidas).
 * - Precedencia: filas mutuamente excluyentes (método + longitud exacta +
 *   sufijo exacto); pares de confusión pineados.
 * - Uso-cero previo de los wrappers E1 (borrados en esta misma tanda).
 * - Barrido: cero handlers inline fuera de delegación en el preámbulo.
 * - Carry-overs pineados (shims con dueño o pin de suite: no se tocan).
 *
 * Todo offline (estática + `matchRoute` pura, sin daemon, sin red, cero LLM).
 * Reglas: las 8 + C1–C10 (C1 ESM/cotas: `for...of` acotado a la tabla fija;
 * C5 aditivo: solo lee fuentes y formas; C10: test previo a cada borrado).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchRoute, ROUTE_TABLE } from "../headless-runtime/factory/routing/routeTable.ts";
import type { RouteDomain } from "../headless-runtime/factory/routing/routeTable.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);

const TEST_ID = "job-tanda-c-01";
const TEST_SCORER = "mi-scorer";

/** Muestra concreta por fila (canónica o alias con :id/:scorer rellenos). */
function samplePath(template: string): string {
  return template.split(":scorer").join(TEST_SCORER).split(":id").join(TEST_ID);
}

// ── 1. Las 44 filas delegan (canónica + alias) ──

test("TC-1 tabla cerrada: 48 filas / 47 dominios (base del dispatch)", () => {
  assert.equal(ROUTE_TABLE.length, 48);
  assert.equal(new Set(ROUTE_TABLE.map((r) => r.domain)).size, 47);
});

test("TC-2 loop delega cada fila canónica al dominio de la fila", () => {
  for (const row of ROUTE_TABLE) {
    const got = matchRoute(row.method, samplePath(row.canonical));
    assert.equal(got?.domain, row.domain, `${row.method} ${row.canonical}`);
  }
});

test("TC-3 loop delega los alias duales al mismo dominio", () => {
  for (const row of ROUTE_TABLE) {
    if (typeof row.alias !== "string") continue;
    const got = matchRoute(row.method, samplePath(row.alias));
    assert.equal(got?.domain, row.domain, `${row.method} ${row.alias}`);
  }
});

// ── 2. El switch cubre todos los dominios ──

test("TC-4 switch con un case por dominio (47 casos + default)", () => {
  const domains = new Set(ROUTE_TABLE.map((r) => r.domain));
  assert.equal(domains.size, 47);
  for (const domain of domains) {
    assert.ok(SERVER_SRC.includes(`case "${domain}":`), `switch delega ${domain}`);
  }
  const cases = SERVER_SRC.match(/case "/g) ?? [];
  assert.equal(cases.length, 47, `47 casos exactos, hallados ${cases.length}`);
  assert.ok(SERVER_SRC.includes("default: break;"), "default defensivo (C2)");
});

// ── 3. Cero ramas por método ──

test("TC-5 cero `if (method ===` en el server (28→0 ramas)", () => {
  const hits = SERVER_SRC.match(/if\s*\(\s*method\s*===/g) ?? [];
  assert.equal(hits.length, 0, `ramas restantes: ${hits.length}`);
});

test("TC-6 UN solo match en el dispatch (excepción OPTIONS documentada)", () => {
  assert.ok(SERVER_SRC.includes('if (req.method === "OPTIONS")'), "pre-vuelo OPTIONS intacto (no es ruta)");
  const uses = SERVER_SRC.match(/matchRoute\(/g) ?? [];
  assert.equal(uses.length, 1, `UN match, hallados ${uses.length}`);
});

// ── 4. 404 idéntico ante no-ruta ──

test("TC-7 no-ruta 404 con forma histórica en ambas salidas del loop", () => {
  const template = "not found: ${method} ${pathname}";
  const hits = SERVER_SRC.split(template).length - 1;
  assert.equal(hits, 2, `dos salidas 404 idénticas, halladas ${hits}`);
});

test("TC-8 no-ruta: método erróneo y path ajeno no matchean", () => {
  assert.equal(matchRoute("POST", "/factory/health"), null);
  assert.equal(matchRoute("DELETE", "/factory/jobs"), null);
  assert.equal(matchRoute("GET", "/nope/nada"), null);
  assert.equal(matchRoute("GET", "/factory/jobs")?.domain, "jobs-list");
});

// ── 5. Precedencia: filas mutuamente excluyentes ──

test("TC-9 estructura excluyente: longitud exacta + sufijo declarado en cada fila", () => {
  for (const row of ROUTE_TABLE) {
    assert.ok(row.canonicalLen > 0, `${row.domain} declara longitud`);
    if (row.kind !== "exact") {
      assert.equal(typeof row.suffix, "string", `${row.domain} declara sufijo`);
    }
  }
});

test("TC-10 pares de confusión resuelven al dominio propio", () => {
  assert.equal(matchRoute("POST", `/factory/jobs/${TEST_ID}/discard`)?.domain, "job-discard");
  assert.equal(matchRoute("POST", `/work-items/${TEST_ID}/discard`)?.domain, "job-discard");
  assert.equal(matchRoute("GET", `/factory/jobs/${TEST_ID}/discard`), null);
  assert.equal(matchRoute("POST", `/factory/jobs/${TEST_ID}/review/rerun`)?.domain, "job-review-rerun");
  assert.equal(matchRoute("POST", `/work-items/${TEST_ID}/review/rerun`)?.domain, "job-review-rerun");
  assert.equal(matchRoute("GET", `/factory/jobs/${TEST_ID}/review/rerun`), null);
  assert.equal(matchRoute("POST", `/factory/jobs/${TEST_ID}/review/retry`)?.domain, "job-review-retry");
  assert.equal(matchRoute("POST", `/factory/jobs/${TEST_ID}/review/retry`)?.domain, "job-review-retry");
  assert.equal(matchRoute("POST", `/factory/jobs/${TEST_ID}/review/retry-review`)?.domain, "job-review-retry-review");
  assert.equal(matchRoute("GET", `/factory/jobs/${TEST_ID}/review`)?.domain, "job-review");
  assert.equal(matchRoute("GET", `/factory/jobs/${TEST_ID}/review/raw`)?.domain, "job-review-raw");
  assert.equal(matchRoute("GET", `/factory/jobs/${TEST_ID}/scores`)?.domain, "job-scores-get");
  assert.equal(matchRoute("POST", `/factory/jobs/${TEST_ID}/scores/${TEST_SCORER}`)?.domain, "job-scores-manual");
  assert.equal(matchRoute("GET", "/factory/benchmarks")?.domain, "benchmarks-list");
  assert.equal(matchRoute("POST", "/factory/benchmarks")?.domain, "benchmarks-create");
  assert.equal(matchRoute("GET", "/factory/benchmarks/bench-1")?.domain, "benchmark-get");
  assert.equal(matchRoute("GET", "/factory/improve/proposals")?.domain, "improve-proposals-list");
  assert.equal(matchRoute("GET", "/factory/improve/proposals/prop-1")?.domain, "improve-proposal-get");
  assert.equal(matchRoute("POST", "/factory/improve/proposals/prop-1/adopt")?.domain, "improve-proposal-adopt");
  assert.equal(matchRoute("POST", "/factory/improve/proposals/prop-1/discard")?.domain, "improve-proposal-discard");
  assert.equal(matchRoute("POST", "/factory/improve/proposals/prop-1/retry-analysis")?.domain, "improve-proposal-retry-analysis");
});

// ── 6. Formas idénticas: cada dominio responde por su operación ──

const DOMAIN_OPS: ReadonlyArray<readonly [RouteDomain, string]> = [
  ["health", "buildHealthPayloadE2("],
  ["jobs-list", "applyDashboardUrlsTA("],
  ["foreman-logs", "foremanLogStore.list("],
  ["jobs-create", "createJobRequestT2("],
  ["job-detail", "resolveDashboardMigrationTA("],
  ["job-logs", "getJobLogsT2("],
  ["job-events", "getJobEventsSnapshot("],
  ["job-result", "readJobResultRawTA("],
  ["job-build-log", "readJobBuildLog("],
  ["job-review", "getReviewById("],
  ["job-review-raw", "readReviewRawById("],
  ["job-review-accept", "acceptReviewEqual("],
  ["job-review-retry", "requestReviewRetryToBuilding("],
  ["job-review-retry-review", "requestReviewRetryOnly("],
  ["job-triage-respond", "applyTriageRespondTransition("],
  ["job-spec-approve", "applySpecApproveTransition("],
  ["job-verify-retry", "requestVerifyRetryT2("],
  ["job-verify", "readVerifyById("],
  ["job-cancel", "requestJobCancelTA("],
  ["job-discard", "requestJobDiscard("],
  ["job-review-rerun", "runReviewRerun("],
  ["job-scores-get", "readScores("],
  ["job-scores-manual", "scoreJob("],
  ["scorers-list", "listScorers("],
  ["scores-summary", "getScoresSummary("],
  ["benchmarks-create", "createPendingBenchmarkRun("],
  ["benchmarks-list", "listBenchmarkRuns("],
  ["benchmark-get", "getBenchmarkRun("],
  ["improve-failures", "collectFailures("],
  ["improve-proposals-create", "createPendingProposal("],
  ["improve-proposals-list", "listProposalSummaries("],
  ["improve-proposal-get", "readProposal("],
  ["improve-proposal-adopt", "adoptProposal("],
  ["improve-proposal-discard", "discardProposal("],
  ["improve-proposal-retry-analysis", "handleProposalRetryAnalysisRoute("],
  ["notifications-list", "buildNotificationsResponseE2("],
  ["notifications-ack", "ackNotificationByIdE2("],
  ["definition-status", "buildDefinitionStatusResponse("],
];

test("TC-11 cada dominio responde por su operación (38 formas intactas)", () => {
  assert.equal(DOMAIN_OPS.length, 38);
  for (const [domain, op] of DOMAIN_OPS) {
    assert.ok(SERVER_SRC.includes(op), `${domain} responde por ${op}`);
  }
});

// ── 7. Deltas documentados: forma casi-válida → 404 genérico ──

test("TC-12 ids reservados o inseguros con forma casi-válida son no-ruta (delta documentado)", () => {
  // Antes: 400 o 404 específico del dominio; ahora: 404 genérico del loop.
  // Ningún pact ni suite vecina pineaba estos bordes por HTTP.
  assert.equal(matchRoute("GET", "/factory/jobs/review"), null);
  assert.equal(matchRoute("GET", "/work-items/review"), null);
  assert.equal(matchRoute("POST", "/factory/jobs/review/review/accept"), null);
  assert.equal(matchRoute("GET", "/factory/jobs/abc%2fdef/logs"), null);
  assert.equal(matchRoute("GET", "/factory/jobs/../result"), null);
});

// ── 8. Uso-cero previo (C10): wrappers E1 muertos por el loop ──

test("TC-13 uso-cero: wrappers E1 enterrados (cero apariciones tras el loop)", () => {
  // Uso-cero previo verificado antes del borrado (definición sin llamados);
  // tras el entierro no queda ni la definición (el MATCH vive en la tabla).
  for (const name of ["isHealthRouteForE1", "isJobsListRouteForE1", "parseJobDetailRouteForE1"]) {
    assert.equal(SERVER_SRC.includes(name), false, `${name} enterrado`);
  }
});

test("TC-14 uso-cero: gates E2 de lista/definición enterrados de los imports", () => {
  // Uso-cero previo verificado antes del borrado (solo el import, sin gate);
  // tras el entierro no queda ni el import (el loop ya matchea exacto).
  for (const name of ["isNotificationsListRouteE2", "isDefinitionStatusRouteE2"]) {
    assert.equal(SERVER_SRC.includes(name), false, `${name} enterrado`);
  }
});

// ── 9. Barrido: cero handlers inline fuera de delegación ──

test("TC-15 el preámbulo del dispatch no decide rutas ni responde", () => {
  const start = SERVER_SRC.indexOf("switch (routed.domain) {");
  assert.ok(start >= 0, "switch presente");
  const end = SERVER_SRC.indexOf("default: break;", start);
  assert.ok(end > start, "switch delimitado");
  const prelude = SERVER_SRC.slice(start, end);
  for (const token of ["pathname.startsWith", "pathname ===", "pathname.endsWith", "pathname.includes", "res.writeHead", "res.end"]) {
    assert.equal(prelude.includes(token), false, `el preámbulo no contiene ${token}`);
  }
});

// ── 10. Carry-overs pineados (con dueño o pin: no se tocan) ──

test("TC-16 carry-over: shims exportados con pin de barrido siguen vivos", () => {
  for (const name of [
    "export function parseVerifyRetryPath",
    "export function parseVerifyGetPath",
    "export function checkVerifyRetryGuards",
    "export function parseTriageRespondPath",
    "export function checkTriageRespondGuards",
    "export function parseTriageRespondBody",
    "export function applyTriageRespondTransition",
  ]) {
    assert.ok(SERVER_SRC.includes(name), `sigue vivo: ${name}`);
  }
});

test("TC-17 carry-over: disco local y variante C con pin de suite siguen vivos", () => {
  for (const name of [
    "function ensureJobDir(",
    "function appendJobLog(",
    "buildMvpChatParts(promptText)",
    "const promptText = buildMvpTrackingPing(job.id)",
  ]) {
    assert.ok(SERVER_SRC.includes(name), `sigue vivo: ${name}`);
  }
});
