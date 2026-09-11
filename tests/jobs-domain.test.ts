/**
 * FASE 2 E1 — dominio jobs: lista/detalle/logs/eventos/resultado/build-log.
 *
 * Congela formas exactas (quirks compat incluidos), guardas 404/400/500,
 * budget intacto (cost + costSummary pasan verbatim) y paridad de matchers
 * contra la tabla canónica. Todo offline en tmp, sin daemon, sin docker,
 * sin LLM. Mocks solo acá (extras/callbacks inyectados, jamás en el dominio).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  buildResultPayload,
  writeResult,
} from "../headless-runtime/workItem/resultStore.ts";
import {
  getJobDetail,
  getJobEventsSnapshot,
  getJobLogs,
  listJobs,
  readJobBuildLog,
  readJobResult,
  requestJobResume,
  type JobLegacyInput,
} from "../headless-runtime/factory/jobs/jobService.ts";
import {
  isHealthRoute,
  isJobsListRoute,
  parseJobBuildLogRoute,
  parseJobDetailRoute,
  parseJobEventsRoute,
  parseJobLogsRoute,
  parseJobResultRoute,
} from "../headless-runtime/factory/jobs/jobRoutes.ts";
import { matchRoute } from "../headless-runtime/factory/routing/routeTable.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

function mkTmp(prefix = "f2e1-jobs-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function mkVerification(overall: "pass" | "fail" = "pass"): VerificationReport {
  const nowIso = new Date().toISOString();
  return {
    steps: [
      {
        name: "test",
        command: "pnpm test",
        exitCode: overall === "pass" ? 0 : 1,
        durationMs: 10,
        status: overall === "pass" ? "pass" : "fail",
        logSnippet: "ok",
        logPath: "logs/build.log",
      },
    ],
    overall,
    startedAt: nowIso,
    finishedAt: nowIso,
    durationMs: 10,
  };
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function mkJob(id: string, prompt = `prompt de prueba ${id}`): string {
  const dir = mkTmp();
  createdDirs.push(dir);
  workItemStore.create({ id, prompt, worktree: dir });
  createdIds.push(id);
  return dir;
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) rmTmp(dir);
}

// ── Lista: fusión tienda + compat (la vista manda) ──

test("F2-E1 jobs: lista fusiona tienda + compat anterior (la vista manda ante colisión)", () => {
  const dir = mkJob("job-f2e1-jobs-a", "prompt de la tienda");
  try {
    const legacy: JobLegacyInput = {
      id: "job-f2e1-jobs-a",
      prompt: "prompt anterior",
      worktree: dir,
      phase: "diagnosisLlm",
      state: "queued",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      logs: ["linea anterior"],
      dir: null,
    };
    const legacyOnly: JobLegacyInput = {
      id: "job-f2e1-jobs-b",
      prompt: "solo anterior",
      worktree: dir,
      phase: "diagnosisLlm",
      state: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: [],
      dir,
    };
    const list = listJobs({ legacy: [legacy, legacyOnly] });
    const ids = list.map((j) => j.id as string);
    assert.ok(ids.includes("job-f2e1-jobs-a"));
    assert.ok(ids.includes("job-f2e1-jobs-b"));
    const merged = list.find((j) => j.id === "job-f2e1-jobs-a") as Record<string, unknown>;
    assert.equal(merged.prompt, "prompt de la tienda");
    const only = list.find((j) => j.id === "job-f2e1-jobs-b") as Record<string, unknown>;
    assert.equal(only.prompt, "solo anterior");
    assert.equal(only.logsCount, 0);
    assert.deepEqual(only.logs, []);
  } finally {
    cleanup();
  }
});

test("F2-E1 jobs: lista ordena desc por createdAt y nunca lanza", () => {
  mkJob("job-f2e1-jobs-c1");
  mkJob("job-f2e1-jobs-c2");
  try {
    const w1 = workItemStore.get("job-f2e1-jobs-c1");
    if (w1) workItemStore.getMap().set(w1.id, { ...w1, createdAt: "2000-01-01T00:00:00.000Z" });
    const list = listJobs();
    const ids = list.map((j) => j.id as string);
    assert.ok(ids.indexOf("job-f2e1-jobs-c2") < ids.indexOf("job-f2e1-jobs-c1"));
    assert.deepEqual(listJobs({ legacy: null as unknown as JobLegacyInput[] }), listJobs());
  } finally {
    cleanup();
  }
});

test("F2-E1 jobs: extras del caller viajan a lista y detalle (y un extras roto no rompe)", () => {
  mkJob("job-f2e1-jobs-d");
  try {
    const extrasFor = () => ({ triage: { decision: "building" }, specApprovalPending: true });
    const list = listJobs({ extrasFor });
    const item = list.find((j) => j.id === "job-f2e1-jobs-d") as Record<string, unknown>;
    assert.deepEqual(item.triage, { decision: "building" });
    assert.equal(item.specApprovalPending, true);
    const detail = getJobDetail("job-f2e1-jobs-d", { extrasFor }) as Record<string, unknown>;
    assert.deepEqual(detail.triage, { decision: "building" });
    const broken = () => {
      throw new Error("extras rotos");
    };
    assert.ok(Array.isArray(listJobs({ extrasFor: broken })));
    assert.ok(getJobDetail("job-f2e1-jobs-d", { extrasFor: broken }) !== null);
  } finally {
    cleanup();
  }
});

// ── Detalle: formas exactas congeladas ──

test("F2-E1 jobs: detalle congela forma exacta (logs sin logsCount + vista previa)", () => {
  mkJob("job-f2e1-jobs-e", "un prompt de más de ciento veinte caracteres para verificar el corte de la vista previa con relleno suficiente hasta el final mismo xx");
  try {
    const detail = getJobDetail("job-f2e1-jobs-e") as Record<string, unknown>;
    assert.ok(detail !== null);
    assert.ok(!("logsCount" in detail), "quirk compat: el detalle trae logs sin logsCount");
    assert.ok(Array.isArray(detail.logs));
    assert.equal(detail.status, "Intake");
    assert.equal(detail.state, "queued");
    const preview = detail.resultPreview as Record<string, unknown>;
    assert.equal(preview.jobId, "job-f2e1-jobs-e");
    assert.equal(preview.status, "Intake");
    assert.equal((preview.promptPreview as string).length, 120);
    assert.equal(preview.summary, "Job aun no finalizado.");
    assert.ok(!("sessionId" in detail), "opcional ausente se omite");
  } finally {
    cleanup();
  }
});

test("F2-E1 jobs: detalle de Complete resume éxito y rama anterior trae vista previa", () => {
  const dir = mkJob("job-f2e1-jobs-f");
  try {
    workItemStore.transition("job-f2e1-jobs-f", "Foreman", "foreman", "t");
    workItemStore.transition("job-f2e1-jobs-f", "Building", "foreman", "t");
    workItemStore.transition("job-f2e1-jobs-f", "Complete", "runner", "t");
    const detail = getJobDetail("job-f2e1-jobs-f") as Record<string, unknown>;
    assert.equal((detail.resultPreview as Record<string, unknown>).summary, "Job completado correctamente (local).");
    const prev: JobLegacyInput = {
      id: "job-f2e1-jobs-g",
      prompt: "anterior",
      worktree: dir,
      phase: "diagnosisLlm",
      state: "done",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: ["l1"],
      dir,
    };
    const legacyDetail = getJobDetail("job-f2e1-jobs-g", { legacy: prev }) as Record<string, unknown>;
    assert.equal(legacyDetail.status, "Intake");
    assert.deepEqual(legacyDetail.logs, ["l1"]);
    assert.equal((legacyDetail.resultPreview as Record<string, unknown>).summary, "Job completado correctamente (local).");
    assert.equal(legacyDetail.dotDonePath, path.join(dir, ".done"));
  } finally {
    cleanup();
  }
});

test("F2-E1 jobs: detalle 404 honesto (null, nunca lanza)", () => {
  mkJob("job-f2e1-jobs-h");
  try {
    assert.equal(getJobDetail("job-f2e1-no-existe"), null);
    assert.equal(getJobDetail(null), null);
    assert.equal(getJobDetail(undefined), null);
    assert.equal(getJobDetail(""), null);
    assert.equal(getJobDetail(42), null);
    const other: JobLegacyInput = {
      id: "otro-id",
      prompt: "x",
      worktree: "w",
      phase: "p",
      state: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dir: null,
    };
    assert.equal(getJobDetail("job-f2e1-no-existe", { legacy: other }), null);
  } finally {
    cleanup();
  }
});

// ── Logs y eventos ──

test("F2-E1 jobs: logs por id (passthrough + 404 honesto)", () => {
  mkJob("job-f2e1-jobs-i");
  try {
    const ok = getJobLogs("job-f2e1-jobs-i");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.id, "job-f2e1-jobs-i");
      assert.ok(ok.logs.length >= 1);
    }
    assert.deepEqual(getJobLogs("job-f2e1-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
    const prev: JobLegacyInput = {
      id: "job-f2e1-jobs-j",
      prompt: "x",
      worktree: "w",
      phase: "p",
      state: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: ["a", "b"],
      dir: null,
    };
    assert.deepEqual(getJobLogs("job-f2e1-jobs-j", { legacy: prev }), {
      ok: true,
      id: "job-f2e1-jobs-j",
      logs: ["a", "b"],
    });
  } finally {
    cleanup();
  }
});

test("F2-E1 jobs: eventos (terminal honesto: done/error/Complete/Cancelled)", () => {
  mkJob("job-f2e1-jobs-k");
  mkJob("job-f2e1-jobs-l");
  try {
    const live = getJobEventsSnapshot("job-f2e1-jobs-k");
    assert.equal(live.ok, true);
    if (live.ok) {
      assert.equal(live.terminal, false);
      assert.equal(live.state, "queued");
      assert.equal(live.status, "Intake");
    }
    workItemStore.transition("job-f2e1-jobs-l", "Cancelled", "user", "t");
    const gone = getJobEventsSnapshot("job-f2e1-jobs-l");
    assert.equal(gone.ok, true);
    if (gone.ok) {
      assert.equal(gone.terminal, true);
      assert.equal(gone.state, "error");
      assert.equal(gone.status, "Cancelled");
    }
    assert.deepEqual(getJobEventsSnapshot("job-f2e1-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
  } finally {
    cleanup();
  }
});

// ── Resultado: rico primero, parcial honesto ──

test("F2-E1 jobs: resultado rico primero, parcial honesto después, 404/500 exactos", () => {
  const dir = mkJob("job-f2e1-jobs-m");
  try {
    const wi = workItemStore.get("job-f2e1-jobs-m");
    const jobDir = (wi?.dir as string) ?? dir;
    const payload = buildResultPayload({
      workItemId: "job-f2e1-jobs-m",
      worktreePath: dir,
      verification: mkVerification("pass"),
      createdFiles: [],
    });
    writeResult(jobDir, payload);
    const rich = readJobResult("job-f2e1-jobs-m");
    assert.equal(rich.ok, true);
    if (rich.ok) {
      assert.equal((rich.payload as { verification: { overall: string } }).verification.overall, "pass");
    }
    // Pobre (sin verification): se sirve tal cual, honesto, jamás 404.
    fs.writeFileSync(path.join(jobDir, "result.json"), JSON.stringify({ jobId: "job-f2e1-jobs-m", status: "Triage" }), "utf-8");
    const poor = readJobResult("job-f2e1-jobs-m");
    assert.equal(poor.ok, true);
    if (poor.ok) {
      assert.deepEqual(poor.payload, { jobId: "job-f2e1-jobs-m", status: "Triage" });
    }
    // Corrupto: 500 con el texto congelado.
    fs.writeFileSync(path.join(jobDir, "result.json"), "no-json{{{", "utf-8");
    const corrupt = readJobResult("job-f2e1-jobs-m");
    assert.equal(corrupt.ok, false);
    if (!corrupt.ok) {
      assert.equal(corrupt.code, 500);
      assert.match(corrupt.error, /failed to read result\.json/);
    }
    // Ausente: 404 con hint congelado.
    fs.unlinkSync(path.join(jobDir, "result.json"));
    assert.deepEqual(readJobResult("job-f2e1-jobs-m"), {
      ok: false,
      code: 404,
      error: "result not found",
      hint: "job not yet built or verification not finished",
    });
    // Sin job: 404; sin dir: 404; id reservado: 400.
    assert.deepEqual(readJobResult("job-f2e1-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
    const noDir: JobLegacyInput = {
      id: "job-f2e1-jobs-n",
      prompt: "x",
      worktree: "w",
      phase: "p",
      state: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dir: null,
    };
    assert.deepEqual(readJobResult("job-f2e1-jobs-n", { legacy: noDir }), {
      ok: false,
      code: 404,
      error: "no dir for job",
    });
    assert.deepEqual(readJobResult("result"), {
      ok: false,
      code: 400,
      error: "missing id for result/build-log",
    });
  } finally {
    cleanup();
  }
});

// ── Build-log ──

test("F2-E1 jobs: build-log (primario, alternativo, 404/500 exactos)", () => {
  const dir = mkJob("job-f2e1-jobs-o");
  try {
    const wi = workItemStore.get("job-f2e1-jobs-o");
    const jobDir = (wi?.dir as string) ?? dir;
    fs.mkdirSync(path.join(jobDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(jobDir, "logs", "build.log"), "primario", "utf-8");
    fs.writeFileSync(path.join(jobDir, "build.log"), "alternativo", "utf-8");
    assert.deepEqual(readJobBuildLog("job-f2e1-jobs-o"), { ok: true, text: "primario" });
    fs.unlinkSync(path.join(jobDir, "logs", "build.log"));
    assert.deepEqual(readJobBuildLog("job-f2e1-jobs-o"), { ok: true, text: "alternativo" });
    fs.unlinkSync(path.join(jobDir, "build.log"));
    assert.deepEqual(readJobBuildLog("job-f2e1-jobs-o"), {
      ok: false,
      code: 404,
      error: "build.log not found",
    });
    assert.deepEqual(readJobBuildLog("job-f2e1-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
  } finally {
    cleanup();
  }
});

// ── Budget intacto ──

test("F2-E1 jobs: budget intacto (cost + costSummary pasan verbatim por lista y detalle)", () => {
  mkJob("job-f2e1-jobs-p");
  try {
    workItemStore.incrementCost("job-f2e1-jobs-p", 400, 200);
    const stored = workItemStore.get("job-f2e1-jobs-p");
    assert.ok(stored);
    const list = listJobs();
    const item = list.find((j) => j.id === "job-f2e1-jobs-p") as Record<string, unknown>;
    assert.deepEqual(item.cost, stored?.cost);
    assert.deepEqual(item.costSummary, stored?.costSummary);
    const detail = getJobDetail("job-f2e1-jobs-p") as Record<string, unknown>;
    assert.deepEqual(detail.cost, stored?.cost);
    assert.deepEqual(detail.costSummary, stored?.costSummary);
  } finally {
    cleanup();
  }
});

// ── Matchers + paridad con tabla ──

test("F2-E1 jobs: matchers de salud/lista (exactos, sin confusión)", () => {
  assert.equal(isHealthRoute("GET", "/factory/health"), true);
  assert.equal(isHealthRoute("POST", "/factory/health"), false);
  assert.equal(isHealthRoute("GET", "/factory/health/extra"), false);
  assert.equal(isHealthRoute("GET", "/factory/health?x=1"), false);
  assert.equal(isJobsListRoute("GET", "/factory/jobs"), true);
  assert.equal(isJobsListRoute("GET", "/work-items"), true);
  assert.equal(isJobsListRoute("POST", "/factory/jobs"), false);
  assert.equal(isJobsListRoute("GET", "/factory/jobs/extra"), false);
  assert.equal(isJobsListRoute(null, "/factory/jobs"), false);
});

test("F2-E1 jobs: detalle paridad total contra matchRoute (dominio+id)", () => {
  const paths = [
    "/factory/jobs/job-abc123",
    "/work-items/job-abc123",
    "/factory/jobs/job-f2e1-x",
    "/factory/jobs/verify",
    "/factory/jobs/result",
    "/factory/jobs/build-log",
    "/factory/jobs/review",
    "/factory/jobs/..",
    "/factory/jobs/a%2Fb",
    "/factory/jobs/",
    "/factory/jobs",
    "/work-items",
    "/factory/jobs/a/b",
    "/work-items/a/b",
    "/factory/jobs/job-abc/logs",
    "/factory/other/job-abc",
  ];
  for (const p of paths) {
    const mine = parseJobDetailRoute("GET", p);
    const table = matchRoute("GET", p);
    const tableDetail = table?.domain === "job-detail" ? table : null;
    assert.equal(mine !== null, tableDetail !== null, `paridad match en ${p}`);
    if (mine && tableDetail) {
      assert.equal(mine.id, tableDetail.id, `paridad id en ${p}`);
      assert.equal(mine.isWorkItemsAlias, tableDetail.isWorkItemsAlias === true, `paridad alias en ${p}`);
    }
  }
  assert.equal(parseJobDetailRoute("POST", "/factory/jobs/job-abc"), null);
  assert.equal(parseJobDetailRoute("GET", "/factory/jobs/job-abc?x=1"), null);
});

test("F2-E1 jobs: matchers por id (logs/eventos/resultado/build-log, dual + sufijos)", () => {
  assert.deepEqual(parseJobLogsRoute("GET", "/factory/jobs/job-a/logs"), {
    id: "job-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseJobLogsRoute("GET", "/work-items/job-a/logs"), {
    id: "job-a",
    isWorkItemsAlias: true,
  });
  assert.deepEqual(parseJobEventsRoute("GET", "/factory/jobs/job-a/events"), {
    id: "job-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseJobResultRoute("GET", "/work-items/job-a/result"), {
    id: "job-a",
    isWorkItemsAlias: true,
  });
  assert.deepEqual(parseJobBuildLogRoute("GET", "/factory/jobs/job-a/build-log"), {
    id: "job-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseJobBuildLogRoute("GET", "/work-items/job-a/build.log"), {
    id: "job-a",
    isWorkItemsAlias: true,
  });
  // No confunden sufijos ni métodos ni longitudes.
  assert.equal(parseJobLogsRoute("GET", "/factory/jobs/job-a/events"), null);
  assert.equal(parseJobEventsRoute("GET", "/factory/jobs/job-a/logs"), null);
  assert.equal(parseJobResultRoute("GET", "/factory/jobs/job-a/build-log"), null);
  assert.equal(parseJobBuildLogRoute("GET", "/factory/jobs/job-a/result"), null);
  assert.equal(parseJobLogsRoute("POST", "/factory/jobs/job-a/logs"), null);
  assert.equal(parseJobLogsRoute("GET", "/factory/jobs/job-a/logs/extra"), null);
  assert.equal(parseJobLogsRoute("GET", "/factory/jobs/job-a/LOGS"), null);
});

test("F2-E1 jobs: resume 404/409 honestos y ok marca resumed (anti doble disparo)", () => {
  mkJob("job-f2e1-resume-a");
  mkJob("job-f2e1-resume-b");
  mkJob("job-f2e2-resume-c");
  try {
    assert.deepEqual(requestJobResume("job-f2e1-no-existe"), {
      ok: false,
      code: 404,
      error: "job not found: job-f2e1-no-existe",
    });
    // Intake no es retomable.
    assert.deepEqual(requestJobResume("job-f2e1-resume-a"), {
      ok: false,
      code: 409,
      error: "job not resumable (status=Intake)",
    });
    // Building corriendo (sin marca) no se retoma: duplicaría el worker.
    workItemStore.transition("job-f2e1-resume-b", "Foreman", "system", "t");
    workItemStore.transition("job-f2e1-resume-b", "Building", "system", "t");
    assert.deepEqual(requestJobResume("job-f2e1-resume-b"), {
      ok: false,
      code: 409,
      error: "job is running (not parked): job-f2e1-resume-b",
    });
    // Parqueado: ok + segundo POST 409 (marca sincrónica).
    workItemStore.transition("job-f2e2-resume-c", "Foreman", "system", "t");
    workItemStore.transition("job-f2e2-resume-c", "Building", "system", "t");
    workItemStore.appendEvent("job-f2e2-resume-c", "system", "daemon reiniciado", {
      bootInterrupted: true,
    } as unknown as Record<string, unknown>);
    const ok = requestJobResume("job-f2e2-resume-c");
    assert.deepEqual(ok, { ok: true, id: "job-f2e2-resume-c", status: "Building" });
    assert.deepEqual(requestJobResume("job-f2e2-resume-c"), {
      ok: false,
      code: 409,
      error: "job is running (not parked): job-f2e2-resume-c",
    });
    assert.equal(workItemStore.get("job-f2e2-resume-c")?.status, "Building");
  } finally {
    cleanup();
  }
});
