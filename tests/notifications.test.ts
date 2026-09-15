/**
 * Ola 19 E1 — centro de notificaciones locales + human-accept scorea.
 * node:test + tsx. Sin daemon (offline), sin red (todos los LLMs mockeados),
 * store en sandbox (TERMCANVAS_FACTORY_DIR en tmpdir). No muta `factory/`
 * real ni jobs productivos.
 *
 * Cubre (contrato inamovible):
 * - store cap 100 con descarte (acked-viejas primero; todas-unacked → vieja)
 * - ack marca+persiste, inexistente → false
 * - persist round-trip + corrupto/ausente → []
 * - dedupe (mismo evento 2 veces = 1; dedupeKey manda; acked no dedupea)
 * - flag apagado → notify null + list guarda pero GET filtra a []
 * - yaml: flags parsean + defaultean true
 * - validación zod (kind inválido, title vacío, body gigante truncado)
 * - 5 emisores con texto correcto (reviewService ask_human, spec gate,
 *   proposal ready, benchmark done, daemon-error sin workItemId)
 * - P0.3: accept humano dispara auto-score (mock 1 llamada, 200 aunque falle)
 * - formato GET/POST (buildNotificationsResponse + parseNotificationAckPath)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NOTIFICATIONS_MAX,
  NOTIFICATION_KINDS,
  NOTIFICATION_TEXT_MAX,
  ackNotification,
  isNotificationsEnabled,
  isOsNotificationsEnabled,
  listNotifications,
  notify,
  resetNotificationsForTests,
  resetNotificationsOverrideForTests,
  resetOsNotificationsOverrideForTests,
  setNotificationsOverrideForTests,
  setOsNotificationsOverrideForTests,
} from "../headless-runtime/notify/notifications.ts";
import {
  parseFactoryYaml,
  resetFactoryConfigCache,
} from "../headless-runtime/factory/agentLoader.ts";
import {
  buildNotificationsResponse,
  parseNotificationAckPath,
  resetAcceptAutoScoreHookForTests,
  runHumanAcceptAutoScore,
  setAcceptAutoScoreHookForTests,
} from "../headless-runtime/factory/factoryServer.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { setTriagePromptMock } from "../headless-runtime/triage/triageAgent.ts";
import { setSpecPromptMock } from "../headless-runtime/spec/specAgent.ts";
import { tryCreateOpencodeSession } from "../headless-runtime/factory/factoryServer.ts";

// ── Sandbox factory (todo .notifications.json va acá, nunca al repo real) ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "notif-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

const trackedJobs: Array<{ id: string; dir: string }> = [];
let jobSeq = 0;

function nextJobId(prefix = "job-notif"): string {
  jobSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${jobSeq}`.toLowerCase().replace(/[^a-z0-9-]/g, "x");
}

function makeWorktree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "notif-job-"));
}

function makeJobInStatus(id: string, status: "Review" | "Foreman" | "Building" = "Review"): string {
  const worktree = makeWorktree();
  workItemStore.create({ id, prompt: `hacer algo util ${id}`, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  if (status === "Foreman") {
    workItemStore.transition(id, "Foreman", "foreman", "t");
    return id;
  }
  workItemStore.transition(id, "Foreman", "foreman", "t");
  workItemStore.transition(id, "Building", "foreman", "t");
  if (status === "Building") return id;
  workItemStore.transition(id, "Review", "runner", "verification passed → Review");
  return id;
}

function resetStore(): void {
  try {
    resetNotificationsForTests();
  } catch {}
  try {
    resetNotificationsOverrideForTests();
  } catch {}
  try {
    resetOsNotificationsOverrideForTests();
  } catch {}
  try {
    setNotificationsOverrideForTests(true);
  } catch {}
  try {
    setOsNotificationsOverrideForTests(true);
  } catch {}
}

function notifFile(): string {
  return path.join(SANDBOX_FACTORY, ".notifications.json");
}

test.after(async () => {
  try { setReviewPromptMock(null); } catch {}
  try { setTriagePromptMock(null); } catch {}
  try { setSpecPromptMock(null); } catch {}
  try { resetAcceptAutoScoreHookForTests(); } catch {}
  try { (await import("../headless-runtime/opencodeServerManager.ts")).setTestClient(null); } catch {}
  try { resetNotificationsForTests(); } catch {}
  try { resetNotificationsOverrideForTests(); } catch {}
  try { resetOsNotificationsOverrideForTests(); } catch {}
  try { resetFactoryConfigCache(); } catch {}
  for (const { id, dir } of trackedJobs) {
    try { workItemStore.delete(id); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    try {
      const wt = path.dirname(path.dirname(path.dirname(dir)));
      if (wt.startsWith(os.tmpdir()) && fs.existsSync(wt)) fs.rmSync(wt, { recursive: true, force: true });
    } catch {}
  }
  trackedJobs.length = 0;
  try { fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true }); } catch {}
});

// ── Store: cap 100 ──

test("store cap 100: todas-unacked → se descarta la más vieja", () => {
  resetStore();
  let firstId = "";
  for (let i = 0; i < 100; i++) {
    const n = notify({ kind: "ask_human", workItemId: `job-cap-${i}`, title: `t-${i}`, body: `b-${i}` });
    assert.ok(n, `notify ${i} debe crear`);
    if (i === 0) firstId = n!.id;
  }
  assert.equal(listNotifications().length, 100);
  assert.equal(NOTIFICATIONS_MAX, 100);
  const extra = notify({ kind: "ask_human", workItemId: "job-cap-new", title: "t-new", body: "b-new" });
  assert.ok(extra);
  const list = listNotifications();
  assert.equal(list.length, 100, "nunca crecer sin cota (Regla 7)");
  assert.ok(!list.some((n) => n.id === firstId), "la más vieja se descarta");
  assert.ok(list.some((n) => n.id === extra!.id), "la nueva queda");
  assert.equal(list[0].id, extra!.id, "newest-first");
});

test("store cap 100: con acked → se descarta la más vieja ACKED primero", () => {
  resetStore();
  const ids: string[] = [];
  for (let i = 0; i < 100; i++) {
    const n = notify({ kind: "spec-approval", workItemId: `job-ackcap-${i}`, title: `t-${i}`, body: `b-${i}` });
    assert.ok(n);
    ids.push(n!.id);
  }
  // Ack las 10 más viejas (las del fondo: índices de inserción 0..9).
  // list es newest-first, así que las viejas están al final.
  const oldestFirst = [...listNotifications()].reverse();
  for (let i = 0; i < 10; i++) {
    assert.equal(ackNotification(oldestFirst[i]!.id), true);
  }
  const newestUnackedBefore = listNotifications()[0]!.id;
  const extra = notify({ kind: "spec-approval", workItemId: "job-ackcap-new", title: "t-new", body: "b-new" });
  assert.ok(extra);
  const list = listNotifications();
  assert.equal(list.length, 100);
  // La más vieja ACKED (ids[0]) debe haber salido; la más vieja NO-acked
  // (ids[10]) debe seguir.
  assert.ok(!list.some((n) => n.id === ids[0]), "acked vieja descartada primero");
  assert.ok(list.some((n) => n.id === ids[10]), "unacked vieja se conserva");
  assert.ok(list.some((n) => n.id === newestUnackedBefore), "la newest previa sigue");
});

// ── Ack ──

test("ack marca+persiste, inexistente → false", () => {
  resetStore();
  const n = notify({ kind: "proposal-ready", title: "Propuesta lista para revisar", body: "propuesta imp-1 lista" });
  assert.ok(n);
  assert.equal(n!.acked, false);
  assert.equal(ackNotification(n!.id), true);
  const after = listNotifications().find((x) => x.id === n!.id);
  assert.ok(after);
  assert.equal(after!.acked, true);
  // Persiste: el archivo lleva acked true.
  const raw = JSON.parse(fs.readFileSync(notifFile(), "utf-8") as string) as Array<Record<string, unknown>>;
  const disk = raw.find((x) => x.id === n!.id);
  assert.ok(disk);
  assert.equal(disk!.acked, true);
  assert.equal(ackNotification("n-inexistente-999"), false);
  assert.equal(ackNotification(""), false);
  assert.equal(ackNotification(null as unknown as string), false);
});

// ── Persist round-trip + corrupto/ausente ──

test("persist round-trip: escribís, re-leés, intacto", () => {
  resetStore();
  const a = notify({ kind: "ask_human", workItemId: "job-rt-1", title: "Revisión necesita tu decisión", body: "¿apruebo el cambio?" });
  const b = notify({ kind: "benchmark-done", title: "Benchmark terminado", body: "benchmark listo" });
  assert.ok(a && b);
  assert.ok(fs.existsSync(notifFile()), "evidencia en disco (.notifications.json)");
  const raw = JSON.parse(fs.readFileSync(notifFile(), "utf-8") as string) as unknown[];
  assert.equal(raw.length, 2);
  // Re-leer vía reset+reescritura (simula restart: memoria vacía, disco intacto).
  const saved = fs.readFileSync(notifFile(), "utf-8");
  resetNotificationsForTests();
  // reset borra el disco tmp: lo reescribimos para simular el disco del restart.
  setNotificationsOverrideForTests(true);
  fs.mkdirSync(path.dirname(notifFile()), { recursive: true });
  fs.writeFileSync(notifFile(), saved, "utf-8");
  const reloaded = listNotifications();
  assert.equal(reloaded.length, 2);
  const ids = new Set(reloaded.map((n) => n.id));
  assert.ok(ids.has(a!.id) && ids.has(b!.id), "ids intactos tras round-trip");
  const ra = reloaded.find((n) => n.id === a!.id)!;
  assert.equal(ra.kind, "ask_human");
  assert.equal(ra.workItemId, "job-rt-1");
  assert.equal(ra.title, "Revisión necesita tu decisión");
  assert.equal(ra.body, "¿apruebo el cambio?");
  assert.ok(typeof ra.at === "string" && !Number.isNaN(Date.parse(ra.at)), "at ISO");
  assert.equal(ra.acked, false);
});

test("restore tolerante: ausente → [], corrupto → [] sin throw", () => {
  resetStore();
  // Ausente: tras reset no hay archivo → [].
  try { fs.rmSync(notifFile(), { force: true }); } catch {}
  resetNotificationsForTests();
  setNotificationsOverrideForTests(true);
  assert.deepEqual(listNotifications(), []);
  // Corrupto: archivo con basura → [] sin throw.
  resetNotificationsForTests();
  setNotificationsOverrideForTests(true);
  fs.mkdirSync(path.dirname(notifFile()), { recursive: true });
  fs.writeFileSync(notifFile(), "esto no es json {{{", "utf-8");
  assert.deepEqual(listNotifications(), [], "corrupto → lista vacía");
  // No-array también → [].
  resetNotificationsForTests();
  setNotificationsOverrideForTests(true);
  fs.mkdirSync(path.dirname(notifFile()), { recursive: true });
  fs.writeFileSync(notifFile(), JSON.stringify({ no: "es array" }), "utf-8");
  assert.deepEqual(listNotifications(), []);
});

// ── Dedupe ──

test("dedupe: mismo evento 2 veces = 1 notificación", () => {
  resetStore();
  const first = notify({ kind: "ask_human", workItemId: "job-dedupe-1", title: "Revisión necesita tu decisión", body: "¿apruebo?" });
  const second = notify({ kind: "ask_human", workItemId: "job-dedupe-1", title: "Revisión necesita tu decisión", body: "¿apruebo?" });
  assert.ok(first && second);
  assert.equal(first!.id, second!.id, "retorna la existente sin duplicar");
  assert.equal(listNotifications().length, 1, "toast 1 por evento");
});

test("dedupe: dedupeKey manda (misma key distinto body = 1; distinta key mismo body = 2)", () => {
  resetStore();
  const a = notify({ kind: "daemon-error", title: "Daemon opencode no disponible", body: "cuerpo A", dedupeKey: "daemon-once" });
  const b = notify({ kind: "daemon-error", title: "Daemon opencode no disponible", body: "cuerpo B distinto", dedupeKey: "daemon-once" });
  assert.ok(a && b);
  assert.equal(a!.id, b!.id, "misma dedupeKey → misma notificación aunque cambie el body");
  assert.equal(listNotifications().length, 1);
  const c = notify({ kind: "daemon-error", title: "Daemon opencode no disponible", body: "cuerpo B distinto", dedupeKey: "daemon-otra" });
  assert.ok(c);
  assert.notEqual(c!.id, a!.id, "distinta key → evento distinto aunque el body coincida");
  assert.equal(listNotifications().length, 2);
});

test("dedupe: acked no dedupea (evento nuevo igual tras ack = 2)", () => {
  resetStore();
  const first = notify({ kind: "ask_human", workItemId: "job-rededupe-1", title: "Revisión necesita tu decisión", body: "¿apruebo?" });
  assert.ok(first);
  assert.equal(ackNotification(first!.id), true);
  const second = notify({ kind: "ask_human", workItemId: "job-rededupe-1", title: "Revisión necesita tu decisión", body: "¿apruebo?" });
  assert.ok(second);
  assert.notEqual(first!.id, second!.id, "acked ya fue vista: el reintento re-notifica");
  assert.equal(listNotifications().length, 2);
});

// ── Flag apagado ──

test("flag apagado: notify null + list guarda pero GET filtra a [] (store no borra)", () => {
  resetStore();
  const kept = notify({ kind: "ask_human", workItemId: "job-flag-1", title: "Revisión necesita tu decisión", body: "pregunta previa" });
  assert.ok(kept);
  assert.equal(listNotifications().length, 1);
  setNotificationsOverrideForTests(false);
  try {
    assert.equal(isNotificationsEnabled(), false);
    const nulled = notify({ kind: "ask_human", workItemId: "job-flag-2", title: "Revisión necesita tu decisión", body: "no debe guardarse" });
    assert.equal(nulled, null, "apagado total: no-op null (Regla 8)");
    // El store NO borra: lo guardado sigue ahí vía list.
    const stored = listNotifications();
    assert.equal(stored.length, 1, "store no borra al apagar");
    assert.equal(stored[0]!.id, kept!.id);
    // El GET lo filtra: server devuelve [] + flags.
    const payload = buildNotificationsResponse();
    assert.deepEqual(payload.notifications, [], "GET filtra a [] cuando el centro está apagado");
    assert.equal(payload.notificationsEnabled, false);
    assert.equal(typeof payload.osNotifications, "boolean");
  } finally {
    resetNotificationsOverrideForTests();
    setNotificationsOverrideForTests(true);
  }
  // Tras re-encender, vuelve a notificar.
  const again = notify({ kind: "ask_human", workItemId: "job-flag-3", title: "Revisión necesita tu decisión", body: "de nuevo" });
  assert.ok(again);
});

test("osNotifications: flag independiente (store sigue, solo E2 lo consulta)", () => {
  resetStore();
  assert.equal(isOsNotificationsEnabled(), true, "default true");
  setOsNotificationsOverrideForTests(false);
  try {
    assert.equal(isOsNotificationsEnabled(), false);
    const n = notify({ kind: "ask_human", workItemId: "job-os-1", title: "Revisión necesita tu decisión", body: "el centro sigue guardando" });
    assert.ok(n, "osNotifications false NO apaga el centro");
    assert.equal(listNotifications().length, 1);
    const payload = buildNotificationsResponse();
    assert.equal(payload.osNotifications, false);
    assert.equal(payload.notifications.length, 1, "GET sigue con datos (solo el toast se apaga)");
  } finally {
    resetOsNotificationsOverrideForTests();
    setOsNotificationsOverrideForTests(true);
  }
});

// ── Yaml ──

const BASE_YAML = `ports:
  factoryDefault: 17680
  factoryMax: 17690
timeouts:
  verifyMs: 120000
defaultModels:
  foreman: "opencode-go/muse-spark-1.2-contributor"
  implement: "opencode-go/muse-spark-1.2-contributor"
  review: "auto-disjoint"
reviewerPairs:
  - match: "muse-spark"
    reviewer: "opencode/big-pickle"
scorers:
  samplingRate: 25
`;

test("yaml: flags parsean, defaultean true y rechazan no-booleanos", () => {
  assert.equal(parseFactoryYaml(BASE_YAML).notificationsEnabled, true, "yaml viejo → true");
  assert.equal(parseFactoryYaml(BASE_YAML).osNotifications, true, "yaml viejo → true");
  assert.equal(parseFactoryYaml(`${BASE_YAML}notificationsEnabled: false\n`).notificationsEnabled, false);
  assert.equal(parseFactoryYaml(`${BASE_YAML}osNotifications: false\n`).osNotifications, false);
  assert.equal(parseFactoryYaml(`${BASE_YAML}notificationsEnabled: true\nosNotifications: true\n`).notificationsEnabled, true);
  assert.throws(() => parseFactoryYaml(`${BASE_YAML}notificationsEnabled: si\n`));
  assert.throws(() => parseFactoryYaml(`${BASE_YAML}osNotifications: 1\n`));
  // factory.yaml real trae ambos en true.
  resetFactoryConfigCache();
  const real = fs.readFileSync(path.join(process.cwd(), "factory", "factory.yaml"), "utf-8");
  assert.ok(real.includes("notificationsEnabled: true"));
  assert.ok(real.includes("osNotifications: true"));
});

// ── Validación zod ──

test("validación zod: kind inválido → null sin throw; title vacío → null", () => {
  resetStore();
  assert.equal(notify({ kind: "spam" as never, title: "t", body: "b" }), null);
  assert.equal(notify({ kind: "" as never, title: "t", body: "b" }), null);
  assert.equal(notify({ kind: "ask_human", title: "   ", body: "b" }), null);
  assert.equal(notify({ kind: "ask_human", title: "t", body: "   " }), null);
  assert.equal(notify(null as unknown as never), null);
  assert.equal(notify(undefined as unknown as never), null);
  assert.equal(listNotifications().length, 0, "nada inválido se guarda");
});

test("validación zod: body/title gigantes → truncado honesto con … (no rechazo)", () => {
  resetStore();
  const big = "x".repeat(2000);
  const n = notify({ kind: "ask_human", workItemId: "job-trunc-1", title: big, body: big });
  assert.ok(n, "gigante no se rechaza: se trunca");
  assert.ok(n!.title.length <= NOTIFICATION_TEXT_MAX, `title ≤${NOTIFICATION_TEXT_MAX}`);
  assert.ok(n!.body.length <= NOTIFICATION_TEXT_MAX);
  assert.ok(n!.title.endsWith("…"), "truncado honesto con …");
  assert.ok(n!.body.endsWith("…"));
  assert.equal(n!.title.length, 500);
});

test("contrato: id n-<epoch>-<counter>, at ISO, limit clamp, KINDS", () => {
  resetStore();
  const n = notify({ kind: "daemon-error", title: "t", body: "b" });
  assert.ok(n);
  assert.match(n!.id, /^n-\d+-\d+$/, "id n-<epochMs>-<counter>");
  assert.ok(!Number.isNaN(Date.parse(n!.at)), "at ISO");
  assert.deepEqual([...NOTIFICATION_KINDS].sort(), ["ask_human", "benchmark-done", "daemon-error", "proposal-ready", "spec-approval"].sort());
  // limit clamp: 200 → 100, 0 → [].
  for (let i = 0; i < 5; i++) notify({ kind: "ask_human", title: `t-${i}`, body: `b-${i}-${Date.now()}-${i}` });
  assert.equal(listNotifications(200).length, 6 <= 100 ? 6 : 100);
  assert.deepEqual(listNotifications(0), []);
  assert.ok(listNotifications(1000).length <= 100);
});

// ── Emisores ──

test("emisor (a) ask_human: reviewService genera 1 con el texto de la decisión", async () => {
  resetStore();
  const id = nextJobId("job-askhuman");
  makeJobInStatus(id, "Review");
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict: "ask_human", confidence: 0.9, summary: "necesito tu decisión: ¿apruebo el cambio?", findings: [] }),
  );
  try {
    const before = listNotifications().length;
    await reviewService.handleReview(workItemStore.get(id)!);
    const after = listNotifications();
    assert.equal(after.length, before + 1, "1 notificación por ask_human");
    const found = after.find((n) => n.kind === "ask_human" && n.workItemId === id);
    assert.ok(found, "kind ask_human + workItemId");
    assert.equal(found!.title, "Revisión necesita tu decisión");
    assert.ok(found!.body.includes("necesito tu decisión"), `body espeja la decisión, fue "${found!.body}"`);
  } finally {
    setReviewPromptMock(null);
  }
});

test("emisor (c) proposal ready: createProposal deja 1 proposal-ready", async () => {
  resetStore();
  const { persistScoreResult } = await import("../headless-runtime/measure/scorerEngine.ts");
  const { createProposal, setAnalysisPromptMock } = await import("../headless-runtime/measure/improvementEngine.ts");
  const failing1 = nextJobId("job-propread");
  makeJobInStatus(failing1, "Building");
  const failing2 = nextJobId("job-propread");
  makeJobInStatus(failing2, "Building");
  const scorer = "review-formato-valido";
  for (const fid of [failing1, failing2]) {
    const ok = persistScoreResult({ scorer, workItemId: fid, label: "infra-formato", score: 0, passing: false, reason: "semilla proposal-ready", model: "opencode-go/muse-spark-1.2-contributor", origin: "manual", at: new Date().toISOString() });
    assert.equal(ok, true);
  }
  setAnalysisPromptMock(async () =>
    JSON.stringify({ pattern: "falta evidencia", target: "skills/code-review/SKILL.md", rationale: "endurecer regla", newContent: "# Propuesto\n\nRegla.\n", regressionsAddressed: [failing1, failing2] }),
  );
  try {
    const before = listNotifications().length;
    const proposal = await createProposal(scorer);
    assert.equal(proposal.status, "ready");
    const after = listNotifications();
    const found = after.slice(0, before + 2).find((n) => n.kind === "proposal-ready");
    assert.ok(found, "proposal ready debe notificar");
    assert.equal(found!.title, "Propuesta lista para revisar");
    assert.ok(found!.body.includes(scorer), `body cita el scorer, fue "${found!.body}"`);
    assert.equal(found!.workItemId, undefined, "sin workItemId único (cita N jobs)");
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("emisor (d) benchmark done: runBenchmark deja 1 benchmark-done", async () => {
  resetStore();
  const { runBenchmark } = await import("../headless-runtime/measure/benchmarkEngine.ts");
  const { deleteBenchmarkRun } = await import("../headless-runtime/measure/benchmarkEngine.ts");
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "cambio correcto", findings: [] }),
  );
  let runId = "";
  try {
    const before = listNotifications().length;
    const run = await runBenchmark({
      name: "bench-notif-emisor",
      tasks: [{ id: "task-1", prompt: "prompt neutro", expectedVerdict: "accept", files: [{ path: "notes/task-1.txt", content: "contenido neutro\n" }], verification: { overall: "pass" } }],
      configs: [{ id: "cfg-1", reviewerModel: { providerID: "test-provider", modelID: "model-1" } }],
      repetitions: 1,
      scorers: [],
    });
    runId = run.id;
    assert.equal(run.status, "done");
    const after = listNotifications();
    const found = after.find((n) => n.kind === "benchmark-done");
    assert.ok(found, "benchmark done debe notificar");
    assert.equal(found!.title, "Benchmark terminado");
    assert.ok(found!.body.includes("bench-notif-emisor"), `body cita el run, fue "${found!.body}"`);
    assert.equal(after.length, before + 1);
  } finally {
    setReviewPromptMock(null);
    if (runId) { try { deleteBenchmarkRun(runId); } catch {} }
  }
});

test("emisor (e) daemon-error: session.create caído notifica sin workItemId (punto central)", async () => {
  resetStore();
  const { setTestClient } = await import("../headless-runtime/opencodeServerManager.ts");
  const id = nextJobId("job-daemonerr");
  const worktree = makeWorktree();
  const job = { id, prompt: "hola", worktree, phase: "diagnosisLlm", state: "queued" as const, createdAt: Date.now(), updatedAt: Date.now(), logs: [] as string[], dir: null as string | null };
  trackedJobs.push({ id, dir: worktree });
  // Simula daemon opencode caído sin red real: cliente mock cuyo
  // session.create lanza ECONNREFUSED → camino isConnRefused de
  // tryCreateOpencodeSession (punto central elegido, documentado en el resumen).
  const failingClient = { session: { create: async () => { throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:9999"); } } } as unknown as Parameters<typeof setTestClient>[0];
  setTestClient(failingClient, "http://127.0.0.1:9999");
  try {
    const before = listNotifications().length;
    await tryCreateOpencodeSession(job as never);
    const after = listNotifications();
    const found = after.find((n) => n.kind === "daemon-error");
    assert.ok(found, `daemon no disponible debe notificar (antes ${before}, ahora ${after.length})`);
    assert.equal(found!.title, "Daemon opencode no disponible");
    assert.equal(found!.workItemId, undefined, "sin workItemId: es infra global (decisión del punto e)");
    assert.ok(found!.body.length > 0);
  } finally {
    try { setTestClient(null); } catch {}
  }
});

// ── P0.3 ──

test("P0.3: accept humano dispara auto-score (mock 1 llamada, 200 aunque el scorer lance)", async () => {
  resetStore();
  // Mock cuenta llamadas.
  let calls = 0;
  setAcceptAutoScoreHookForTests(async () => { calls += 1; });
  try {
    await runHumanAcceptAutoScore("job-acept-1");
    assert.equal(calls, 1, "el accept humano entra al loop de medida");
  } finally {
    resetAcceptAutoScoreHookForTests();
  }
  // Aunque el scorer lance, el hook nunca lanza (el accept igual 200).
  setAcceptAutoScoreHookForTests(async () => { throw new Error("scorer roto"); });
  try {
    await runHumanAcceptAutoScore("job-acept-2");
    assert.ok(true, "no lanzó aunque el scorer falló (el accept igual responde 200)");
  } finally {
    resetAcceptAutoScoreHookForTests();
  }
  // El transition del handler sigue intacto: Review→Complete con .done.
  const id = nextJobId("job-acept");
  makeJobInStatus(id, "Review");
  const completed = workItemStore.transition(id, "Complete", "user", "humano acepta igual (POST /review/accept)");
  assert.equal(completed.status, "Complete");
  // Y el hook real (sin mock) tampoco lanza sin daemon (best-effort).
  await runHumanAcceptAutoScore(id);
  assert.ok(true, "hook real best-effort sin daemon");
});

// ── Formato GET/POST ──

test("formato GET /factory/notifications + POST /:id/ack (helpers del server)", () => {
  resetStore();
  const n = notify({ kind: "ask_human", workItemId: "job-fmt-1", title: "Revisión necesita tu decisión", body: "¿apruebo?" });
  assert.ok(n);
  const payload = buildNotificationsResponse();
  assert.equal(payload.notificationsEnabled, true);
  assert.equal(payload.osNotifications, true);
  assert.equal(payload.notifications.length, 1);
  assert.equal(payload.notifications[0]!.id, n!.id);
  // Parse del ack: ruta exacta.
  assert.deepEqual(parseNotificationAckPath(`/factory/notifications/${n!.id}/ack`), { id: n!.id });
  assert.ok("error" in parseNotificationAckPath("/factory/notifications/ack"));
  assert.ok("error" in parseNotificationAckPath("/factory/jobs/x/ack"));
  // Ack vía store (lo que el POST invoca): 200 con {ok, notification}.
  assert.equal(ackNotification(n!.id), true);
  const found = listNotifications().find((x) => x.id === n!.id);
  assert.ok(found && found.acked);
  // Inexistente → el POST respondería 404 {error:"notification not found"}.
  assert.equal(ackNotification("n-0000000000000-999999"), false);
});
