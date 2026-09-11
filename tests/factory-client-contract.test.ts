/**
 * factory-client-contract (FASE 1 E2 — C10 trazabilidad).
 *
 * Contrato del esqueleto `src/lib/factoryClient.ts`:
 * - Formas defensivas: ante red caída, HTTP !ok o JSON inesperado → fallback
 *   con `ok:false`, NUNCA lanza.
 * - Timeouts: cada operación usa su constante nombrada exportada (salud con
 *   timeout corto); el timeout corta incluso mocks que ignoran AbortSignal.
 * - Fetch inyectado: todas las operaciones aceptan `fetchFn`; los tests
 *   SIEMPRE pasan mock + puerto explícito (cero red real: el `fetch` global
 *   se reemplaza por una guarda que falla si alguien toca red).
 * - Cero literales de puerto en el cliente (el puerto viene de discovery).
 * - ESM: cero `require()`.
 *
 * Offline total: mocks + `Response` reales en memoria. Cero LLM, cero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACTORY_BENCHMARKS_TIMEOUT_MS,
  FACTORY_BENCHMARK_CREATE_TIMEOUT_MS,
  FACTORY_BUILD_LOG_TIMEOUT_MS,
  FACTORY_DEFAULT_TIMEOUT_MS,
  FACTORY_DEFINITION_TIMEOUT_MS,
  FACTORY_FAILURES_TIMEOUT_MS,
  FACTORY_HEALTH_TIMEOUT_MS,
  FACTORY_JOBS_TIMEOUT_MS,
  FACTORY_JOB_SCORES_TIMEOUT_MS,
  FACTORY_MANUAL_SCORE_TIMEOUT_MS,
  FACTORY_NOTIFICATIONS_TIMEOUT_MS,
  FACTORY_NOTIFICATION_ACK_TIMEOUT_MS,
  FACTORY_PROPOSALS_TIMEOUT_MS,
  FACTORY_PROPOSAL_CREATE_TIMEOUT_MS,
  FACTORY_PROPOSAL_DECIDE_TIMEOUT_MS,
  FACTORY_REVIEW_ACTION_TIMEOUT_MS,
  FACTORY_REVIEW_TIMEOUT_MS,
  FACTORY_SCORERS_TIMEOUT_MS,
  FACTORY_SCORES_SUMMARY_TIMEOUT_MS,
  FACTORY_SPEC_TIMEOUT_MS,
  FACTORY_TRIAGE_TIMEOUT_MS,
  FACTORY_VERIFY_RETRY_TIMEOUT_MS,
  FACTORY_VERIFY_TIMEOUT_MS,
  createFactoryBenchmark,
  createFactoryProposal,
  factoryUrl,
  getFactoryBenchmark,
  getFactoryBuildLog,
  getFactoryDefinitionStatus,
  getFactoryHealth,
  getFactoryJob,
  getFactoryJobEvents,
  getFactoryJobLogs,
  getFactoryJobResult,
  getFactoryJobScores,
  getFactoryProposal,
  getFactoryReview,
  getFactoryReviewRaw,
  getFactoryScoresSummary,
  getFactoryVerify,
  listFactoryBenchmarks,
  listFactoryFailures,
  listFactoryJobs,
  listFactoryNotifications,
  listFactoryProposals,
  listFactoryScorers,
  postFactoryJobDiscard,
  postFactoryManualScore,
  postFactoryReviewRerun,
  postFactoryNotificationAck,
  postFactoryProposalAdopt,
  postFactoryProposalDiscard,
  postFactoryProposalRetryAnalysis,
  postFactoryReviewAccept,
  postFactoryReviewRetry,
  postFactoryReviewRetryReview,
  postFactorySpecApprove,
  postFactoryTriageRespond,
  postFactoryVerifyRetry,
  type FactoryFetch,
} from "../src/lib/factoryClient.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Puerto de prueba: solo viaja en URLs mockeadas, jamás toca red. */
const TEST_PORT = 19876;

/** Guarda global: si el cliente toca red real, el test explota. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("red real prohibida en tests (pasá fetchFn inyectado)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FactoryFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as FactoryFetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

function jsonRes(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textRes(text: string, status = 200): Response {
  return new Response(text, { status });
}

function opts(fetchFn: FactoryFetch) {
  return { fetchFn, port: TEST_PORT };
}

// ── Salud ──

test("health ok: URL canónica por discovery-pattern + timeout corto nombrado", async () => {
  const fetchFn = mockFetch(() => jsonRes({ buildId: "b1", ok: true }));
  const res = await getFactoryHealth(opts(fetchFn));
  assert.equal(res.ok, true);
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/health`);
  if (res.ok) assert.equal((res.data as Record<string, unknown>).buildId, "b1");
  assert.ok(
    FACTORY_HEALTH_TIMEOUT_MS <= 2000,
    `salud con timeout corto, es ${FACTORY_HEALTH_TIMEOUT_MS}`,
  );
});

test("health timeout corta incluso mocks que ignoran AbortSignal (fallback, sin lanzar)", async () => {
  const fetchFn = mockFetch(() => new Promise<Response>(() => {}));
  const res = await getFactoryHealth({ fetchFn, port: TEST_PORT, timeoutMs: 25 });
  assert.equal(res.ok, false);
  assert.equal(res.data, null);
  assert.equal(res.status, null);
  assert.match(String((res as { error?: string }).error ?? ""), /timeout/i);
});

test("health forma inesperada → fallback null sin lanzar", async () => {
  const fetchFn = mockFetch(() => jsonRes(42));
  const res = await getFactoryHealth(opts(fetchFn));
  assert.equal(res.ok, false);
  assert.equal(res.data, null);
});

test("fetch que lanza → ok:false sin lanzar", async () => {
  const fetchFn = mockFetch(() => {
    throw new Error("boom red");
  });
  const res = await listFactoryJobs(opts(fetchFn));
  assert.equal(res.ok, false);
  assert.deepEqual(res.data, []);
});

// ── Jobs ──

test("list jobs acepta {jobs}, {workItems} y array directo; basura → []", async () => {
  const sample = [{ id: "job-a" }, { id: "job-b" }];
  for (const body of [{ jobs: sample }, { workItems: sample }, sample]) {
    const fetchFn = mockFetch(() => jsonRes(body));
    const res = await listFactoryJobs(opts(fetchFn));
    assert.equal(res.ok, true, JSON.stringify(body));
    if (res.ok) assert.deepEqual(res.data, sample);
  }
  const bad = mockFetch(() => jsonRes({ nope: 1 }));
  const resBad = await listFactoryJobs(opts(bad));
  assert.equal(resBad.ok, false);
  assert.deepEqual(resBad.data, []);
});

test("detalle/logs/eventos/resultado: 404 → fallback; ok → datos", async () => {
  const notFound = mockFetch(() => jsonRes({ error: "job not found: x" }, 404));
  assert.equal((await getFactoryJob("job-x", opts(notFound))).ok, false);
  assert.deepEqual((await getFactoryJobLogs("job-x", opts(notFound))).data, []);
  assert.deepEqual((await getFactoryJobEvents("job-x", opts(notFound))).data, []);
  assert.equal((await getFactoryJobResult("job-x", opts(notFound))).data, null);

  const okLogs = mockFetch(() => jsonRes({ logs: ["a", "b"] }));
  const logs = await getFactoryJobLogs("job-x", opts(okLogs));
  assert.equal(logs.ok, true);
  if (logs.ok) assert.deepEqual(logs.data, ["a", "b"]);

  const okEvents = mockFetch(() => jsonRes({ events: [{ m: 1 }] }));
  const events = await getFactoryJobEvents("job-x", opts(okEvents));
  assert.equal(events.ok, true);

  const okJob = mockFetch(() => jsonRes({ id: "job-x", status: "Review" }));
  const job = await getFactoryJob("job-x", opts(okJob));
  assert.equal(job.ok, true);
});

test("build-log devuelve texto crudo; 404 → cadena vacía", async () => {
  const ok = mockFetch(() => textRes("línea1\nlínea2"));
  const res = await getFactoryBuildLog("job-x", opts(ok));
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data, "línea1\nlínea2");
  const nf = mockFetch(() => textRes("nope", 404));
  const resNf = await getFactoryBuildLog("job-x", opts(nf));
  assert.equal(resNf.ok, false);
  assert.equal(resNf.data, "");
});

// ── Review ──

test("review get + raw + accept/retry/retry-review usan paths y POST canónicos", async () => {
  const reviewBody = { workItemId: "job-x", status: "Review", reviewCount: 1, lastReview: null };
  const g = mockFetch(() => jsonRes(reviewBody));
  const got = await getFactoryReview("job-x", opts(g));
  assert.equal(got.ok, true);
  assert.equal(g.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/review`);

  const r = mockFetch(() => textRes("crudo"));
  const raw = await getFactoryReviewRaw("job-x", opts(r));
  assert.equal(raw.ok, true);
  if (raw.ok) assert.equal(raw.data, "crudo");

  for (const [fn, action] of [
    [postFactoryReviewAccept, "accept"],
    [postFactoryReviewRetry, "retry"],
    [postFactoryReviewRetryReview, "retry-review"],
  ] as const) {
    const f = mockFetch(() => jsonRes({ ok: true }));
    const res = await fn("job-x", opts(f));
    assert.equal(res.ok, true, action);
    assert.equal(f.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/review/${action}`);
    assert.equal((f.calls[0].init as RequestInit).method, "POST");
  }
});

test("discard POSTea a /factory/jobs/:id/discard (no retomar trabajo)", async () => {
  const f = mockFetch(() =>
    jsonRes({ ok: true, id: "job-x", status: "Cancelled", cleaned: { deleted: [], restored: [], skipped: [], artifactsRemoved: [] } }),
  );
  const res = await postFactoryJobDiscard("job-x", opts(f));
  assert.equal(res.ok, true);
  assert.equal(f.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/discard`);
  assert.equal((f.calls[0].init as RequestInit).method, "POST");
  if (res.ok) assert.equal((res.data.cleaned as Record<string, unknown> | undefined) !== undefined, true);

  const bad = mockFetch(() => jsonRes({ ok: true }));
  const badRes = await postFactoryJobDiscard("", opts(bad));
  assert.equal(badRes.ok, false);
  assert.equal(bad.calls.length, 0);
});

test("rerun POSTea a /factory/jobs/:id/review/rerun (re-revisar)", async () => {
  const f = mockFetch(() =>
    jsonRes({ ok: true, id: "job-x", status: "Complete", verdict: "accept", summary: "ok", findings: 0, attempt: 2 }),
  );
  const res = await postFactoryReviewRerun("job-x", opts(f));
  assert.equal(res.ok, true);
  assert.equal(f.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/review/rerun`);
  assert.equal((f.calls[0].init as RequestInit).method, "POST");
  if (res.ok) assert.equal((res.data as Record<string, unknown>).verdict, "accept");

  const bad = mockFetch(() => jsonRes({ ok: true }));
  const badRes = await postFactoryReviewRerun("", opts(bad));
  assert.equal(badRes.ok, false);
  assert.equal(bad.calls.length, 0);
});

// ── Triage / Spec / Verify ──

test("triage respond POSTea {answers} limpio", async () => {
  const f = mockFetch(() => jsonRes({ ok: true, status: "Foreman", answers: 2 }));
  const res = await postFactoryTriageRespond("job-x", ["  sí  ", "", 42, "no"], opts(f));
  assert.equal(res.ok, true);
  assert.equal(f.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/triage/respond`);
  const sent = JSON.parse(String((f.calls[0].init as RequestInit).body)) as { answers: unknown };
  assert.deepEqual(sent.answers, ["sí", "no"]);
});

test("spec approve POST + verify get/retry", async () => {
  const a = mockFetch(() => jsonRes({ ok: true, status: "Foreman" }));
  const approved = await postFactorySpecApprove("job-x", opts(a));
  assert.equal(approved.ok, true);
  assert.equal(a.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/spec/approve`);

  const v = mockFetch(() => jsonRes({ overall: "pass", steps: [] }));
  const verify = await getFactoryVerify("job-x", opts(v));
  assert.equal(verify.ok, true);

  const rr = mockFetch(() => jsonRes({ ok: true, status: "Triage" }));
  const retry = await postFactoryVerifyRetry("job-x", opts(rr));
  assert.equal(retry.ok, true);
  assert.equal(rr.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/review/verify-retry`);
});

// ── Scorers ──

test("scorers: lista/resumen/scores por job/scoring manual", async () => {
  const l = mockFetch(() => jsonRes({ scorers: [{ name: "s1" }] }));
  const list = await listFactoryScorers(opts(l));
  assert.equal(list.ok, true);

  const s = mockFetch(() => jsonRes({ scorers: { s1: { scored: 2, passing: 1, failing: 1, passRate: 0.5 } } }));
  const summary = await getFactoryScoresSummary(opts(s));
  assert.equal(summary.ok, true);

  const badSummary = mockFetch(() => jsonRes({ nope: true }));
  const summaryBad = await getFactoryScoresSummary(opts(badSummary));
  assert.equal(summaryBad.ok, false);
  assert.deepEqual(summaryBad.data, { scorers: {} });

  const js = mockFetch(() => jsonRes({ workItemId: "job-x", scores: { s1: { label: "ok" } } }));
  const scores = await getFactoryJobScores("job-x", opts(js));
  assert.equal(scores.ok, true);
  if (scores.ok) {
    assert.equal(scores.data.workItemId, "job-x");
    assert.deepEqual(Object.keys(scores.data.scores), ["s1"]);
  }

  const m = mockFetch(() => jsonRes({ ok: true }));
  const manual = await postFactoryManualScore("job-x", "s1", opts(m));
  assert.equal(manual.ok, true);
  assert.equal(m.calls[0].url, `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-x/scores/s1`);
  assert.equal((m.calls[0].init as RequestInit).method, "POST");
});

// ── Benchmarks ──

test("benchmarks crear/listar/detalle; definition inválida no toca red", async () => {
  const c = mockFetch(() => jsonRes({ id: "bench-1", trials: 4 }, 201));
  const created = await createFactoryBenchmark({ name: "b", tasks: [] }, opts(c));
  assert.equal(created.ok, true);
  if (created.ok) assert.equal(created.data.id, "bench-1");
  assert.equal((c.calls[0].init as RequestInit).method, "POST");

  const fail = mockFetch(() => jsonRes({ error: "bad definition" }, 400));
  const createdFail = await createFactoryBenchmark({ name: "b" }, opts(fail));
  assert.equal(createdFail.ok, false);
  if (!createdFail.ok) assert.equal(createdFail.data.id, null);

  const noNet = mockFetch(() => jsonRes({ id: "nunca" }, 201));
  const invalid = await createFactoryBenchmark("no-objeto", opts(noNet));
  assert.equal(invalid.ok, false);
  assert.equal(noNet.calls.length, 0);

  const li = mockFetch(() => jsonRes({ runs: [{ id: "bench-1" }] }));
  assert.equal((await listFactoryBenchmarks(opts(li))).ok, true);

  const d = mockFetch(() => jsonRes({ id: "bench-1", status: "done" }));
  assert.equal((await getFactoryBenchmark("bench-1", opts(d))).ok, true);
});

// ── Failures / Proposals ──

test("failures y proposals (+adopt/discard) con paths canónicos", async () => {
  const f = mockFetch(() => jsonRes({ scorer: "s1", failures: [{ workItemId: "job-x" }] }));
  const failures = await listFactoryFailures("s1", opts(f));
  assert.equal(failures.ok, true);
  assert.ok(f.calls[0].url.includes("/factory/improve/failures?scorer=s1"));

  const p = mockFetch(() => jsonRes({ proposals: [{ id: "p1" }] }));
  assert.equal((await listFactoryProposals(opts(p))).ok, true);

  const pd = mockFetch(() => jsonRes({ id: "p1", status: "ready" }));
  assert.equal((await getFactoryProposal("p1", opts(pd))).ok, true);

  const cp = mockFetch(() => jsonRes({ id: "p2" }, 201));
  const createdP = await createFactoryProposal("s1", opts(cp));
  assert.equal(createdP.ok, true);
  if (createdP.ok) assert.equal(createdP.data.id, "p2");
  const sentP = JSON.parse(String((cp.calls[0].init as RequestInit).body)) as { scorer: string };
  assert.equal(sentP.scorer, "s1");

  const ad = mockFetch(() => jsonRes({ ok: true, target: "x", backup: "y" }));
  assert.equal((await postFactoryProposalAdopt("p1", opts(ad))).ok, true);
  assert.ok(ad.calls[0].url.endsWith("/factory/improve/proposals/p1/adopt"));

  const di = mockFetch(() => jsonRes({ ok: true }));
  assert.equal((await postFactoryProposalDiscard("p1", opts(di))).ok, true);
  assert.ok(di.calls[0].url.endsWith("/factory/improve/proposals/p1/discard"));

  const ra = mockFetch(() => jsonRes({ ok: true, proposal: { id: "p1", status: "ready" } }));
  assert.equal((await postFactoryProposalRetryAnalysis("p1", opts(ra))).ok, true);
  assert.ok(ra.calls[0].url.endsWith("/factory/improve/proposals/p1/retry-analysis"));

  const raBad = mockFetch(() => jsonRes({ ok: false }, 200));
  assert.equal((await postFactoryProposalRetryAnalysis("", opts(raBad))).ok, false);
  assert.equal(raBad.calls.length, 0);
});

// ── Notificaciones / Definition ──

test("notificaciones lista + ack; definition status + forma corrupta", async () => {
  const n = mockFetch(() =>
    jsonRes({ notifications: [{ id: "n1" }], notificationsEnabled: true, osNotifications: false }),
  );
  const list = await listFactoryNotifications(opts(n));
  assert.equal(list.ok, true);
  if (list.ok) {
    assert.equal(list.data.notifications.length, 1);
    assert.equal(list.data.notificationsEnabled, true);
    assert.equal(list.data.osNotifications, false);
  }

  const a = mockFetch(() => jsonRes({ ok: true }));
  const ack = await postFactoryNotificationAck("n1", opts(a));
  assert.equal(ack.ok, true);
  if (ack.ok) assert.equal(ack.data.acked, true);
  assert.ok(a.calls[0].url.endsWith("/factory/notifications/n1/ack"));

  const nf = mockFetch(() => jsonRes({ error: "gone" }, 404));
  const ackFail = await postFactoryNotificationAck("n1", opts(nf));
  assert.equal(ackFail.ok, false);
  if (!ackFail.ok) assert.equal(ackFail.data.acked, false);

  const ds = mockFetch(() =>
    jsonRes({ valid: true, issues: [], checkedAt: "2026-01-01T00:00:00.000Z" }),
  );
  const def = await getFactoryDefinitionStatus(opts(ds));
  assert.equal(def.ok, true);
  if (def.ok) assert.equal(def.data.valid, true);

  const corrupt = mockFetch(() => jsonRes([1, 2, 3]));
  const defBad = await getFactoryDefinitionStatus(opts(corrupt));
  assert.equal(defBad.ok, false);
  if (!defBad.ok) assert.equal(defBad.data.valid, null);
});

// ── Ids inválidos / mocks corruptos / estática ──

test("id inválido o traversal no toca red (fail-closed local)", async () => {
  for (const badId of ["", "   ", "../x", "a/b", ".", ".."]) {
    const f = mockFetch(() => jsonRes({}));
    const res = await getFactoryJob(badId, opts(f));
    assert.equal(res.ok, false, JSON.stringify(badId));
    assert.equal(f.calls.length, 0, JSON.stringify(badId));
  }
});

test("mocks corruptos (fetch retorna basura) → ok:false, nunca lanza", async () => {
  const garbage = mockFetch(() => null as unknown as Response);
  await assert.doesNotReject(async () => {
    const res = await getFactoryHealth(opts(garbage));
    assert.equal(res.ok, false);
    assert.equal(res.data, null);
  });
  const noText = mockFetch(() =>
    ({ ok: true, status: 200 }) as unknown as Response,
  );
  await assert.doesNotReject(async () => {
    const res = await listFactoryJobs(opts(noText));
    assert.equal(res.ok, false);
    assert.deepEqual(res.data, []);
  });
});

test("factoryUrl pura: builder sin literales, rechaza puerto inválido sin lanzar", () => {
  assert.equal(factoryUrl(TEST_PORT, "/factory/health"), `http://127.0.0.1:${TEST_PORT}/factory/health`);
  assert.equal(factoryUrl(NaN, "/factory/health"), "");
  assert.equal(factoryUrl(-1, "/factory/health"), "");
  assert.doesNotThrow(() => {
    factoryUrl(null as unknown as number, "/factory/health");
    factoryUrl(undefined as unknown as number, null as unknown as string);
  });
});

test("todos los timeouts nombrados exportados, numéricos y positivos", () => {
  for (const t of [
    FACTORY_HEALTH_TIMEOUT_MS,
    FACTORY_JOBS_TIMEOUT_MS,
    FACTORY_BUILD_LOG_TIMEOUT_MS,
    FACTORY_REVIEW_TIMEOUT_MS,
    FACTORY_REVIEW_ACTION_TIMEOUT_MS,
    FACTORY_TRIAGE_TIMEOUT_MS,
    FACTORY_SPEC_TIMEOUT_MS,
    FACTORY_VERIFY_TIMEOUT_MS,
    FACTORY_VERIFY_RETRY_TIMEOUT_MS,
    FACTORY_SCORERS_TIMEOUT_MS,
    FACTORY_SCORES_SUMMARY_TIMEOUT_MS,
    FACTORY_JOB_SCORES_TIMEOUT_MS,
    FACTORY_MANUAL_SCORE_TIMEOUT_MS,
    FACTORY_BENCHMARKS_TIMEOUT_MS,
    FACTORY_BENCHMARK_CREATE_TIMEOUT_MS,
    FACTORY_FAILURES_TIMEOUT_MS,
    FACTORY_PROPOSALS_TIMEOUT_MS,
    FACTORY_PROPOSAL_CREATE_TIMEOUT_MS,
    FACTORY_PROPOSAL_DECIDE_TIMEOUT_MS,
    FACTORY_NOTIFICATIONS_TIMEOUT_MS,
    FACTORY_NOTIFICATION_ACK_TIMEOUT_MS,
    FACTORY_DEFINITION_TIMEOUT_MS,
    FACTORY_DEFAULT_TIMEOUT_MS,
  ]) {
    assert.equal(typeof t, "number");
    assert.ok(t > 0, `timeout positivo, es ${t}`);
  }
});

test("estática: ESM cero require() y cero literales de puerto en el cliente", () => {
  const src = fs.readFileSync(path.join(REPO, "src", "lib", "factoryClient.ts"), "utf-8");
  assert.equal(/\brequire\s*\(\s*["'`]/.test(src), false, "cero require()");
  assert.equal(/1768\d/.test(src), false, "cero literales de puerto del rango factory");
  assert.equal(/127\.0\.0\.1:\d/.test(src), false, "puerto siempre por discovery/opts, jamás literal");
});
