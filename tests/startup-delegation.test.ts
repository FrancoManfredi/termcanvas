/**
 * TANDA B — delegación de arranque/restore/bind puros a factory/startup.
 *
 * Contrato de delegación (NO duplica asserts de negocio, solo delegación):
 * - El cascarón delega las decisiones puras del arranque en el dominio
 *   (bases del restore, decisión por job, `.done`, reintento de bind,
 *   debounce del self-heal, ruta y formato del port-file).
 * - La lógica vive en startup/startupService (pura con efectos inyectados,
 *   testeable sin server vivo, sin red, sin puertos).
 * - Formas intactas por paridad con jobs/ (migración dashboard reusada, no
 *   duplicada) + disco/tienda reales en tmp para el restore.
 * - Carry-overs pineados por estática: fs/readdir, `listen`/`probarBind`,
 *   `probeExistingFactory` (fetch vivo), `ensureClient` y escrituras
 *   quedan en el cascarón (B-R1/B-R2/red-puertos, no a ciegas).
 * Todo offline en tmp, sin daemon, sin docker, sin LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDotDone,
  buildPortFilePath,
  collectRestoreBases,
  decideRestoreJob,
  formatPortFile,
  shouldKickManager,
  shouldRetryBind,
} from "../headless-runtime/factory/startup/startupService.ts";
import { resolveDashboardMigration } from "../headless-runtime/factory/jobs/jobService.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "factoryServer.ts"),
  "utf-8",
);
const DOMAIN_SRC = fs.readFileSync(
  path.join(HERE, "..", "headless-runtime", "factory", "startup", "startupService.ts"),
  "utf-8",
);

function restoreRegion(): string {
  const start = SERVER_SRC.indexOf("export function restoreJobsFromDisk");
  const end = SERVER_SRC.indexOf("async function probeExistingFactory", start);
  assert.ok(start >= 0 && end > start, "restore delimitado");
  return SERVER_SRC.slice(start, end);
}

function dashboardInfra() {
  return {
    resolveDirectory: (w: string) => w,
    buildDashboardUrl: (sid?: string, d?: string) =>
      sid ? `http://127.0.0.1:4096/${d}/session/${sid}` : "http://127.0.0.1:4096",
    getBaseUrl: () => "http://127.0.0.1:4096",
  };
}

// ── A. Delegación estática: el server no duplica decisiones de arranque ──

test("B-A1 arranque delega: el cascarón importa y llama al dominio", () => {
  assert.ok(SERVER_SRC.includes("./startup/startupService"), "el server importa startup/startupService");
  for (const call of [
    "collectRestoreBasesB(",
    "decideRestoreJobB(",
    "applyDotDoneB(",
    "shouldRetryBindB(",
    "shouldKickManagerBackoffB(",
    "buildPortFilePathB(",
    "formatPortFileB(",
  ]) {
    assert.ok(SERVER_SRC.includes(call), `el cascarón llama al dominio: ${call}`);
  }
});

test("B-A2 restore delega la decisión (cero cómputo inline de migración)", () => {
  const region = restoreRegion();
  assert.ok(region.includes("decideRestoreJobB("), "decisión por el dominio");
  assert.ok(region.includes("applyDotDoneB("), "elevación `.done` por el dominio");
  assert.ok(region.includes("collectRestoreBasesB("), "bases por el dominio");
  assert.equal(region.includes("encodeDirectory("), false, "sin migración inline (reusa jobs/ vía el dominio)");
});

// ── B. Formas intactas (decisiones puras con efectos inyectados) ──

test("B-B1 decisión: estados y status espejo del cascarón (incluye bordes falsy)", () => {
  const infra = dashboardInfra();
  const base = { worktree: "/wt", directory: "/wt" };
  const q = decideRestoreJob({ state: "queued", ...base }, "job-x", "/d/job-x", infra);
  assert.equal(q?.finalState, "queued");
  assert.equal(q?.finalStatus, "Intake");
  const r = decideRestoreJob({ state: "running", ...base }, "job-x", "/d/job-x", infra);
  assert.equal(r?.finalStatus, "Building");
  const d = decideRestoreJob({ state: "done", ...base }, "job-x", "/d/job-x", infra);
  assert.equal(d?.finalStatus, "Complete");
  const bad = decideRestoreJob({ state: "nope", ...base }, "job-x", "/d/job-x", infra);
  assert.equal(bad?.finalState, "queued");
  assert.equal(bad?.finalStatus, "Intake");
  assert.equal(decideRestoreJob(null, "job-x", "/d", infra), null);
  assert.equal(decideRestoreJob("roto", "job-x", "/d", infra), null);
});

test("B-B1b decisión: Triage y Review sobreviven al restore (no degradan)", () => {
  const infra = dashboardInfra();
  const base = { worktree: "/wt", directory: "/wt" };
  const triage = decideRestoreJob({ state: "queued", status: "Triage", ...base }, "job-t", "/d/job-t", infra);
  assert.equal(triage?.finalStatus, "Triage");
  const review = decideRestoreJob({ state: "running", status: "Review", ...base }, "job-r", "/d/job-r", infra);
  assert.equal(review?.finalStatus, "Review");
});

test("B-B2 decisión: timeline/cost/runnerId/refs espejo (sin tocar disco)", () => {
  const infra = dashboardInfra();
  const full = decideRestoreJob(
    {
      id: "job-b2",
      prompt: "hola",
      worktree: "/wt",
      phase: "diagnosisLlm",
      state: "queued",
      timeline: [{ id: "t0" }],
      cost: { estimatedUSD: 3 },
      runnerId: "linux-build",
      createdAt: "2026-01-01T00:00:00.000Z",
      modelRef: { providerID: "a", modelID: "b", variant: "v" },
      reviewerRef: { providerID: "c", modelID: "d" },
    },
    "job-b2",
    "/d/job-b2",
    infra,
  );
  assert.deepEqual(full?.finalTimeline, [{ id: "t0" }]);
  assert.deepEqual(full?.finalCost, { estimatedUSD: 3 });
  assert.equal(full?.finalRunnerId, "linux-build");
  assert.deepEqual(full?.modelRef, { providerID: "a", modelID: "b", variant: "v" });
  assert.deepEqual(full?.reviewerRef, { providerID: "c", modelID: "d" });
  assert.equal(full?.finalDotDonePath, path.join("/d/job-b2", ".done"));
  const migrated = decideRestoreJob({ state: "done", worktree: "/wt" }, "job-b2c", "/d/job-b2c", infra);
  assert.equal(migrated?.finalTimeline.length, 3);
  assert.equal(migrated?.urlMigrated, false);
});

test("B-B3 decisión: migración dashboard REUSA jobs/ (paridad, C7 sin duplicar)", () => {
  const infra = dashboardInfra();
  const input = { sessionId: "s9", worktree: "/wt", directory: "/wt" as string | undefined, dashboardUrl: "http://vieja" };
  const decided = decideRestoreJob({ sessionId: "s9", worktree: "/wt", directory: "/wt", dashboardUrl: "http://vieja" }, "j", "/d/j", infra);
  const direct = resolveDashboardMigration(input, infra);
  assert.ok(direct, "jobs/ migra la URL vieja");
  assert.equal(decided?.finalDashboardUrl, direct?.dashboardUrl);
  assert.equal(decided?.urlMigrated, true);
  const fresh = decideRestoreJob(
    { sessionId: "s9", worktree: "/wt", directory: "/wt", dashboardUrl: "http://127.0.0.1:4096//wt/session/s9" },
    "j2",
    "/d/j2",
    infra,
  );
  assert.equal(fresh?.urlMigrated, false);
  const nosession = decideRestoreJob({ worktree: "/wt" }, "j3", "/d/j3", infra);
  assert.equal(nosession?.finalDashboardUrl, "http://127.0.0.1:4096");
  assert.equal(nosession?.urlMigrated, false);
});

test("B-B4 `.done` eleva a done/Complete (espejo del existsSync del cascarón)", () => {
  const infra = dashboardInfra();
  const decided = decideRestoreJob({ state: "queued", worktree: "/wt" }, "job-dot", "/d/job-dot", infra);
  assert.equal(decided?.finalState, "queued");
  const elevated = applyDotDone(decided);
  assert.equal(elevated?.finalState, "done");
  assert.equal(elevated?.finalStatus, "Complete");
  assert.equal(applyDotDone(null), null);
});

test("B-B5 bases: composición espejo con nombres inyectados (sin fs real)", () => {
  const bases = collectRestoreBases({
    repoRoot: "/repo",
    tmpdir: "/tmp",
    tmpEntries: ["playground-1", "otro"],
    cTmpEntries: ["lab-x"],
    worktreeEntries: ["wt-1"],
  });
  assert.ok(bases.includes(path.join("/repo", ".agents", "factory")));
  assert.ok(bases.includes(path.join("/tmp", "playground-1", ".agents", "factory")));
  assert.equal(bases.includes(path.join("/tmp", "otro", ".agents", "factory")), false);
  assert.ok(bases.includes(path.join("/repo", ".worktrees", "wt-1", ".agents", "factory")));
  assert.deepEqual([...new Set(bases)].length, bases.length, "sin duplicados");
});

test("B-B6 bind/kick/port-file: decisiones puras espejo (efectos vivos en el cascarón)", () => {
  assert.equal(shouldRetryBind("EADDRINUSE", "x"), true);
  assert.equal(shouldRetryBind("OTRO", "listen EADDRINUSE 1"), true);
  assert.equal(shouldRetryBind("OTRO", "already in use"), true);
  assert.equal(shouldRetryBind("OTRO", "otro fallo"), false);
  assert.equal(shouldKickManager(0, 20000), true);
  assert.equal(shouldKickManager(19000, 20000), false);
  assert.equal(buildPortFilePath("/data"), path.join("/data", "factory-port"));
  assert.equal(formatPortFile(17680, 1234), "17680\n1234");
});

// ── C. Carry-overs pineados (efectos vivos en el cascarón) ──

test("B-C1 carry-over B-R1/B-R2/red: fs, listen, probe y ensure vivos en el cascarón", () => {
  const region = restoreRegion();
  assert.ok(region.includes("fs.readFileSync(jobJsonPath"), "lectura job.json viva");
  assert.ok(region.includes('fs.existsSync(path.join(jobDir, ".done"))'), "chequeo `.done` vivo");
  assert.ok(region.includes("workItemStore.getMap().set(id, wi)"), "escritura a la tienda viva");
  assert.ok(SERVER_SRC.includes("http.createServer"), "bind vivo");
  assert.ok(SERVER_SRC.includes("probarBind("), "sonda de puerto viva");
  assert.ok(SERVER_SRC.includes("probeExistingFactory("), "sonda singleton viva");
  assert.ok(SERVER_SRC.includes("opencodeServerManager.ensureClient()"), "health-kick vivo");
  assert.ok(SERVER_SRC.includes("fs.writeFileSync(file, formatPortFileB("), "port-file con formato del dominio");
});

// ── D. Barrido extendido (cero lógica de arranque fuera de delegación) ──

test("B-D1 barrido: ESM cero require() en dominio + server", () => {
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

test("B-D3 barrido: whitelist del dominio (jobs + tipos + path, nada más)", () => {
  const imports = DOMAIN_SRC.split("\n")
    .map((l) => l.match(/from\s*["']([^"']+)["']/)?.[1])
    .filter((s): s is string => typeof s === "string");
  const allowed = new Set(["../jobs/jobService", "../../../shared/types/workItem", "node:path"]);
  for (const spec of imports) {
    assert.ok(allowed.has(spec), `import fuera de la lista blanca TANDA B: ${spec}`);
  }
  assert.ok(imports.includes("../jobs/jobService"), "la migración reusa jobs/ (C7)");
});
