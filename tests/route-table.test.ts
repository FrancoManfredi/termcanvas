/**
 * Tabla de rutas factory (FASE 1 E1 — C8 rutas en tabla).
 * Verifica por lectura del server: ~30 dominios + alias dual + rechazos
 * (traversal/longitud) + método erróneo. Todo offline, puro, cero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { matchRoute, ROUTE_TABLE } from "../headless-runtime/factory/routing/routeTable.ts";

const ID = "job-abc123";

// ── 0. Tabla cerrada: 35 dominios / 36 filas ──

test("tabla cerrada: 52 dominios únicos en 53 filas (build-log comparte dominio)", () => {
  assert.equal(ROUTE_TABLE.length, 53);
  const domains = new Set(ROUTE_TABLE.map((r) => r.domain));
  assert.equal(domains.size, 52);
  assert.ok(domains.has("health"));
  assert.ok(domains.has("settings-get"));
  assert.ok(domains.has("settings-set"));
  assert.ok(domains.has("job-detail"));
  assert.ok(domains.has("definition-status"));
  assert.ok(domains.has("automations-list"));
  assert.ok(domains.has("automations-tick"));
  assert.ok(domains.has("integrations-status"));
  assert.ok(domains.has("integrations-test-post"));
  assert.ok(domains.has("integrations-webhook-in"));
  assert.ok(domains.has("integrations-post-back"));
});

// ── 1. Exactas globales ──

test("exactas: health / scorers / scores-summary / definition-status", () => {
  assert.deepEqual(matchRoute("GET", "/factory/health"), { domain: "health" });
  assert.deepEqual(matchRoute("GET", "/factory/settings"), { domain: "settings-get" });
  assert.deepEqual(matchRoute("POST", "/factory/settings"), { domain: "settings-set" });
  assert.equal(matchRoute("GET", "/factory/settings/extra"), null);
  assert.deepEqual(matchRoute("GET", "/factory/scorers"), { domain: "scorers-list" });
  assert.deepEqual(matchRoute("GET", "/factory/scores/summary"), { domain: "scores-summary" });
  assert.deepEqual(matchRoute("GET", "/factory/definition/status"), { domain: "definition-status" });
  assert.deepEqual(matchRoute("GET", "/factory/notifications"), { domain: "notifications-list" });
});

test("exactas: benchmarks create vs list se distinguen por método", () => {
  assert.equal(matchRoute("POST", "/factory/benchmarks")?.domain, "benchmarks-create");
  assert.equal(matchRoute("GET", "/factory/benchmarks")?.domain, "benchmarks-list");
});

test("exactas: improve proposals create vs list se distinguen por método", () => {
  assert.equal(matchRoute("POST", "/factory/improve/proposals")?.domain, "improve-proposals-create");
  assert.equal(matchRoute("GET", "/factory/improve/proposals")?.domain, "improve-proposals-list");
});

test("exactas: jobs-create solo POST (GET va a lista)", () => {
  assert.equal(matchRoute("POST", "/factory/jobs")?.domain, "jobs-create");
  assert.equal(matchRoute("GET", "/factory/jobs")?.domain, "jobs-list");
});

// ── 2. Alias dual ──

test("alias dual: lista factory ↔ work-items", () => {
  assert.equal(matchRoute("GET", "/factory/jobs")?.domain, "jobs-list");
  const alias = matchRoute("GET", "/work-items");
  assert.equal(alias?.domain, "jobs-list");
  assert.equal(alias?.isWorkItemsAlias, true);
});

test("alias dual: foreman-logs con segunda forma", () => {
  assert.equal(matchRoute("GET", "/factory/foreman/logs")?.domain, "foreman-logs");
  assert.equal(matchRoute("GET", "/foreman/logs")?.domain, "foreman-logs");
});

test("alias dual: detalle/logs/events/result/review/verify/cancel/scores", () => {
  const cases: Array<[string, string]> = [
    [`/factory/jobs/${ID}`, `/work-items/${ID}`],
    [`/factory/jobs/${ID}/logs`, `/work-items/${ID}/logs`],
    [`/factory/jobs/${ID}/events`, `/work-items/${ID}/events`],
    [`/factory/jobs/${ID}/result`, `/work-items/${ID}/result`],
    [`/factory/jobs/${ID}/review`, `/work-items/${ID}/review`],
    [`/factory/jobs/${ID}/verify`, `/work-items/${ID}/verify`],
  ];
  const methods = ["GET", "GET", "GET", "GET", "GET", "GET"] as const;
  const domains = ["job-detail", "job-logs", "job-events", "job-result", "job-review", "job-verify"] as const;
  cases.forEach(([canonical, alias], i) => {
    const c = matchRoute(methods[i], canonical);
    const a = matchRoute(methods[i], alias);
    assert.equal(c?.domain, domains[i], canonical);
    assert.equal(c?.id, ID, canonical);
    assert.equal(a?.domain, domains[i], alias);
    assert.equal(a?.id, ID, alias);
    assert.equal(a?.isWorkItemsAlias, true, alias);
  });
});

test("alias dual: build-log cubre build-log + build.log en ambas formas", () => {
  for (const suffix of ["/build-log", "/build.log"]) {
    const c = matchRoute("GET", `/factory/jobs/${ID}${suffix}`);
    const a = matchRoute("GET", `/work-items/${ID}${suffix}`);
    assert.equal(c?.domain, "job-build-log", suffix);
    assert.equal(a?.domain, "job-build-log", suffix);
  }
});

test("alias dual: POSTs con alias (accept/retry/retry-review/respond/approve/reject/resume/verify-retry/cancel/discard/rerun/merge-notify)", () => {
  const cases: Array<[string, string]> = [
    [`/factory/jobs/${ID}/review/accept`, `/work-items/${ID}/review/accept`],
    [`/factory/jobs/${ID}/review/retry`, `/work-items/${ID}/review/retry`],
    [`/factory/jobs/${ID}/review/retry-review`, `/work-items/${ID}/review/retry-review`],
    [`/factory/jobs/${ID}/triage/respond`, `/work-items/${ID}/triage/respond`],
    [`/factory/jobs/${ID}/spec/approve`, `/work-items/${ID}/spec/approve`],
    [`/factory/jobs/${ID}/spec/reject`, `/work-items/${ID}/spec/reject`],
    [`/factory/jobs/${ID}/resume`, `/work-items/${ID}/resume`],
    [`/factory/jobs/${ID}/review/verify-retry`, `/work-items/${ID}/review/verify-retry`],
    [`/factory/jobs/${ID}/cancel`, `/work-items/${ID}/cancel`],
    [`/factory/jobs/${ID}/discard`, `/work-items/${ID}/discard`],
    [`/factory/jobs/${ID}/review/rerun`, `/work-items/${ID}/review/rerun`],
    [`/factory/jobs/${ID}/merge-notify`, `/work-items/${ID}/merge-notify`],
  ];
  const domains = [
    "job-review-accept",
    "job-review-retry",
    "job-review-retry-review",
    "job-triage-respond",
    "job-spec-approve",
    "job-spec-reject",
    "job-resume",
    "job-verify-retry",
    "job-cancel",
    "job-discard",
    "job-review-rerun",
    "job-merge-notify",
  ] as const;
  cases.forEach(([canonical, alias], i) => {
    assert.equal(matchRoute("POST", canonical)?.domain, domains[i], canonical);
    assert.equal(matchRoute("POST", alias)?.domain, domains[i], alias);
    assert.equal(matchRoute("POST", alias)?.id, ID, alias);
  });
});

test("dominios restantes: review-raw / scores-get / scores-manual / benchmark-get / proposals / ack", () => {
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/review/raw`)?.domain, "job-review-raw");
  assert.equal(matchRoute("GET", `/work-items/${ID}/review/raw`)?.domain, "job-review-raw");
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/scores`)?.domain, "job-scores-get");
  const manual = matchRoute("POST", `/factory/jobs/${ID}/scores/mi-scorer`);
  assert.equal(manual?.domain, "job-scores-manual");
  assert.equal(manual?.id, ID);
  assert.equal(manual?.scorer, "mi-scorer");
  assert.equal(matchRoute("POST", `/work-items/${ID}/scores/mi-scorer`)?.domain, "job-scores-manual");
  assert.equal(matchRoute("GET", "/factory/benchmarks/bench-1")?.domain, "benchmark-get");
  assert.equal(matchRoute("GET", "/factory/improve/proposals/prop-1")?.domain, "improve-proposal-get");
  assert.equal(matchRoute("POST", "/factory/improve/proposals/prop-1/adopt")?.domain, "improve-proposal-adopt");
  assert.equal(matchRoute("POST", "/factory/improve/proposals/prop-1/discard")?.domain, "improve-proposal-discard");
  assert.equal(matchRoute("POST", "/factory/notifications/nt-1/ack")?.domain, "notifications-ack");
  assert.equal(matchRoute("GET", "/factory/improve/failures")?.domain, "improve-failures");
});

test("P4c retry-analysis: POST .../proposals/:id/retry-analysis resuelve a su dominio", () => {
  const got = matchRoute("POST", "/factory/improve/proposals/imp-abc-1/retry-analysis");
  assert.equal(got?.domain, "improve-proposal-retry-analysis");
  assert.equal(got?.id, "imp-abc-1");
  assert.equal(matchRoute("GET", "/factory/improve/proposals/imp-abc-1/retry-analysis"), null);
  assert.equal(matchRoute("POST", "/factory/improve/proposals/imp-abc-1/retry-analysis/extra"), null);
});

test("F1 webhook-in + post-back: exactas sin alias", () => {
  assert.equal(matchRoute("POST", "/factory/integrations/webhook-in")?.domain, "integrations-webhook-in");
  assert.equal(matchRoute("POST", "/factory/integrations/post-back")?.domain, "integrations-post-back");
  assert.equal(matchRoute("GET", "/factory/integrations/webhook-in"), null);
  assert.equal(matchRoute("GET", "/factory/integrations/post-back"), null);
  assert.equal(matchRoute("POST", "/factory/integrations/webhook-in/extra"), null);
});

// ── 3. Rechazos: traversal / longitud / método ──

test("rechazo traversal .. en id (canónica y alias)", () => {
  assert.equal(matchRoute("GET", "/factory/jobs/../result"), null);
  assert.equal(matchRoute("GET", "/work-items/../result"), null);
  assert.equal(matchRoute("GET", "/factory/jobs/.."), null);
  assert.equal(matchRoute("POST", "/factory/jobs/../cancel"), null);
  assert.equal(matchRoute("POST", "/factory/jobs/../discard"), null);
  assert.equal(matchRoute("POST", "/factory/jobs/../review/rerun"), null);
});

test("rechazo traversal codificado y slash interno", () => {
  assert.equal(matchRoute("GET", "/factory/jobs/%2e%2e"), null);
  assert.equal(matchRoute("GET", "/factory/jobs/abc%2fdef"), null);
  assert.equal(matchRoute("GET", "/factory/jobs/abc/result/extra"), null);
});

test("rechazo longitud inexacta (segmento extra o faltante)", () => {
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/result/extra`), null);
  assert.deepEqual(matchRoute("GET", "/factory/jobs"), { domain: "jobs-list" });
  assert.equal(matchRoute("GET", "/factory/jobs/"), null);
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/review/raw/extra`), null);
  assert.equal(matchRoute("GET", "/factory/health/extra"), null);
});

test("método erróneo no matchea (fail-closed a no-ruta)", () => {
  assert.equal(matchRoute("POST", "/factory/health"), null);
  assert.deepEqual(matchRoute("GET", "/factory/jobs"), { domain: "jobs-list" });
  assert.deepEqual(matchRoute("GET", "/factory/jobs"), matchRoute("GET", "/factory/jobs"));
  assert.equal(matchRoute("DELETE", "/factory/jobs"), null);
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/cancel`), null);
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/discard`), null);
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/review/rerun`), null);
  assert.equal(matchRoute("POST", `/factory/jobs/${ID}/result`), null);
  assert.equal(matchRoute("POST", "/factory/scorers"), null);
});

test("no-ruta: entradas inválidas nunca lanzan", () => {
  assert.equal(matchRoute(null, "/factory/health"), null);
  assert.equal(matchRoute("GET", null), null);
  assert.equal(matchRoute("GET", ""), null);
  assert.equal(matchRoute("GET", "factory/health"), null);
  assert.equal(matchRoute("GET", "/nope/nada"), null);
  assert.equal(matchRoute("GET", "/factory/health?x=1"), null);
});

test("no confunde retry con retry-review ni review con review/raw", () => {
  assert.equal(matchRoute("POST", `/factory/jobs/${ID}/review/retry`)?.domain, "job-review-retry");
  assert.equal(matchRoute("POST", `/factory/jobs/${ID}/review/retry-review`)?.domain, "job-review-retry-review");
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/review`)?.domain, "job-review");
  assert.equal(matchRoute("GET", `/factory/jobs/${ID}/review/raw`)?.domain, "job-review-raw");
});
