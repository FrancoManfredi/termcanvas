/**
 * P4c — retry-analysis de propuestas `failed` (precedente retry-review-only).
 * node:test + tsx. Sin red (análisis vía mock inyectado), sin daemon (puras +
 * engine + handler de dominio con TERMCANVAS_FACTORY_DIR en tmpdir).
 * No muta `factory/` real ni jobs productivos.
 *
 * Cubre: failed→ready con mock OK, failed→failed honesto con mock roto,
 * non-failed→409 (ready/pending/adopted/discarded), tope de 1 intento
 * (segundo retry →409), 404 si no existe, parser/guards puros y el handler
 * de dominio (forma 400/404/409/200 del futuro endpoint).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImprovementProposal } from "../shared/types/improvement.ts";
import {
  ImprovementError,
  claimRetryAnalysisBudget,
  isImprovementError,
  persistProposal,
  readProposal,
  retryAnalysisForProposal,
  setAnalysisPromptMock,
} from "../headless-runtime/measure/improvementEngine.ts";
import {
  checkRetryAnalysisGuards,
  isSafeProposalId,
  parseProposalRetryAnalysisPath,
  RETRY_ANALYSIS_MAX,
} from "../headless-runtime/measure/improvementHttp.ts";
import {
  handleProposalRetryAnalysisRoute,
} from "../headless-runtime/factory/measure/improvementRoutes.ts";
import { matchRoute } from "../headless-runtime/factory/routing/routeTable.ts";
import { persistScoreResult } from "../headless-runtime/measure/scorerEngine.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// ── Sandbox factory (toda escritura factory va acá, nunca al repo real) ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "retry-analysis-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

const SCORER = "review-formato-valido";
const JUDGE_MODEL = "opencode-go/muse-spark-1.2-contributor";

const trackedJobs: Array<{ id: string; dir: string }> = [];
let jobSeq = 0;
let proposalSeq = 0;

function nextJobId(): string {
  jobSeq += 1;
  return `job-retry-${Date.now().toString(36)}-${jobSeq}`;
}

function nextProposalId(): string {
  proposalSeq += 1;
  return `imp-retry-${Date.now().toString(36)}-${proposalSeq}`;
}

function makeJob(prompt = "revisar el modulo de pagos del proyecto"): string {
  const id = nextJobId();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "retry-analysis-job-"));
  workItemStore.create({ id, prompt: `${prompt} ${id}`, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  return id;
}

function seedFailingScore(id: string): void {
  const now = new Date().toISOString();
  workItemStore.appendEvent(id, "runner", "verification fail", {
    verification: {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: 1,
          durationMs: 5,
          status: "fail",
          logPath: "logs/build.log",
        },
      ],
      overall: "fail",
      startedAt: now,
      finishedAt: now,
      durationMs: 5,
    },
    createdFiles: ["src/cambio.ts"],
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
  const ok = persistScoreResult({
    scorer: SCORER,
    workItemId: id,
    label: "invalido",
    score: 0,
    passing: false,
    reason: "juez cito evidencia contra invalido",
    model: JUDGE_MODEL,
    origin: "manual",
    at: now,
  });
  assert.equal(ok, true, "persistScoreResult debe guardar el seed");
}

function seedProposal(status: ImprovementProposal["status"], extra: Partial<ImprovementProposal> = {}): ImprovementProposal {
  const base: ImprovementProposal = {
    id: nextProposalId(),
    scorer: SCORER,
    status,
    regressionsAddressed: [],
    createdAt: new Date().toISOString(),
    ...(status === "failed" ? { failureReason: "analysis flake (UnknownError)" } : {}),
    ...(status === "ready"
      ? {
        pattern: "patron",
        rationale: "porque corrige",
        target: "skills/code-review/SKILL.md",
        newContent: "# propuesto\n",
        regressionsAddressed: ["job-retry-x-1"],
      }
      : {}),
    ...(status === "adopted" || status === "discarded"
      ? { decidedAt: new Date().toISOString() }
      : {}),
    ...extra,
  };
  assert.equal(persistProposal(base), true, "la propuesta seed debe persistir");
  return base;
}

function mockAnalysisOk(ids: string[]): void {
  setAnalysisPromptMock(async () => JSON.stringify({
    pattern: "los reviews caen a ask_human por infra timeout 20000ms+retry",
    target: "skills/code-review/SKILL.md",
    rationale: "endurecer la regla de evidencia bloqueante corrige el patron",
    newContent: "# Code Review (propuesto)\n\nRegla: sin evidencia no hay accept.\n",
    regressionsAddressed: ids,
  }));
}

function mockAnalysisBroken(): void {
  setAnalysisPromptMock(async () => "esto no es JSON {sin cerrar");
}

function assertImprovementError(e: unknown, code: 404 | 409): void {
  assert.ok(isImprovementError(e), `debe ser ImprovementError (fue ${String(e)})`);
  assert.equal((e as ImprovementError).code, code);
}

test.after(() => {
  try {
    setAnalysisPromptMock(null);
  } catch {}
  for (const { id, dir } of trackedJobs) {
    try {
      workItemStore.delete(id);
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  trackedJobs.length = 0;
  try {
    delete process.env.TERMCANVAS_FACTORY_DIR;
  } catch {}
  try {
    fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  } catch {}
});

// ── Tope documentado ──

test("tope: 1 retry-analysis por propuesta (fila M09)", () => {
  assert.equal(RETRY_ANALYSIS_MAX, 1);
});

// ── Parser + guards puros ──

test("parser retry-analysis: ok solo con sufijo y 5 segmentos", () => {
  assert.deepEqual(parseProposalRetryAnalysisPath("/factory/improve/proposals/imp-abc-1/retry-analysis"), {
    id: "imp-abc-1",
  });
  assert.ok("error" in parseProposalRetryAnalysisPath("/factory/improve/proposals/imp-abc-1/adopt"));
  assert.ok("error" in parseProposalRetryAnalysisPath("/factory/improve/proposals/imp-abc-1/retry-analysis/extra"));
  assert.ok("error" in parseProposalRetryAnalysisPath("/factory/improve/proposals/retry-analysis"));
  assert.ok("error" in parseProposalRetryAnalysisPath("/factory/improve/proposals/../evil/retry-analysis"));
  assert.ok("error" in parseProposalRetryAnalysisPath("/factory/improve/proposals/adopt/retry-analysis"));
  assert.ok("error" in parseProposalRetryAnalysisPath(null));
});

test("retry-analysis es id reservado (no se confunde con :id)", () => {
  assert.equal(isSafeProposalId("retry-analysis"), false);
});

test("guards: 404 sin propuesta, 409 si no es failed, 409 con tope consumido", () => {
  assert.deepEqual(checkRetryAnalysisGuards(null, "x"), {
    ok: false,
    code: 404,
    error: "proposal not found: x",
  });
  for (const status of ["pending", "ready", "adopted", "discarded"] as const) {
    const g = checkRetryAnalysisGuards({ status }, "imp-q");
    assert.equal(g.ok, false);
    if (!g.ok) {
      assert.equal(g.code, 409);
      assert.match(g.error, /not retryable/);
    }
  }
  assert.deepEqual(checkRetryAnalysisGuards({ status: "failed" }, "imp-q"), { ok: true });
  assert.deepEqual(
    checkRetryAnalysisGuards({ status: "failed", retryCount: 0 }, "imp-q"),
    { ok: true },
  );
  const capped = checkRetryAnalysisGuards({ status: "failed", retryCount: 1 }, "imp-q");
  assert.equal(capped.ok, false);
  if (!capped.ok) {
    assert.equal(capped.code, 409);
    assert.match(capped.error, /budget reached/);
  }
});

// ── Ruta en tabla ──

test("ruta: POST .../:id/retry-analysis matchea su dominio con id", () => {
  const got = matchRoute("POST", "/factory/improve/proposals/imp-abc-1/retry-analysis");
  assert.equal(got?.domain, "improve-proposal-retry-analysis");
  assert.equal(got?.id, "imp-abc-1");
  assert.equal(matchRoute("GET", "/factory/improve/proposals/imp-abc-1/retry-analysis"), null);
});

// ── Engine ──

test("failed→ready con análisis mock OK (consume 1 intento)", async () => {
  const job = makeJob("revisar el modulo de pagos");
  seedFailingScore(job);
  const failed = seedProposal("failed");
  mockAnalysisOk([job]);
  try {
    const out = await retryAnalysisForProposal(failed.id);
    assert.equal(out.status, "ready");
    assert.equal(out.retryCount, 1);
    assert.ok(typeof out.lastRetriedAt === "string" && out.lastRetriedAt.length > 0);
    assert.equal(out.id, failed.id);
    assert.equal(out.scorer, SCORER);
    assert.equal(out.target, "skills/code-review/SKILL.md");
    assert.ok(out.regressionsAddressed.includes(job));
    const back = readProposal(failed.id);
    assert.equal(back?.status, "ready");
    assert.equal(back?.retryCount, 1);
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("failed→failed honesto con análisis mock roto (intento consumido igual)", async () => {
  const failed = seedProposal("failed");
  mockAnalysisBroken();
  try {
    const out = await retryAnalysisForProposal(failed.id);
    assert.equal(out.status, "failed");
    assert.equal(out.retryCount, 1);
    assert.ok(typeof out.lastRetriedAt === "string" && out.lastRetriedAt.length > 0);
    assert.ok((out.failureReason ?? "").length > 0);
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("non-failed→409 sin consumir intento (ready/pending/adopted/discarded)", async () => {
  for (const status of ["ready", "pending", "adopted", "discarded"] as const) {
    const p = seedProposal(status);
    await assert.rejects(retryAnalysisForProposal(p.id), (e: unknown) => {
      assertImprovementError(e, 409);
      return true;
    });
    const back = readProposal(p.id);
    assert.equal(back?.status, status);
    assert.equal(back?.retryCount, undefined);
  }
});

test("doble retry respeta el tope: el segundo →409 aunque el mock sane", async () => {
  const job = makeJob("revisar el modulo de envios");
  seedFailingScore(job);
  const failed = seedProposal("failed");
  mockAnalysisBroken();
  const first = await retryAnalysisForProposal(failed.id);
  assert.equal(first.status, "failed");
  assert.equal(first.retryCount, 1);
  mockAnalysisOk([job]);
  try {
    await assert.rejects(retryAnalysisForProposal(failed.id), (e: unknown) => {
      assertImprovementError(e, 409);
      assert.match((e as Error).message, /budget reached/);
      return true;
    });
    const back = readProposal(failed.id);
    assert.equal(back?.status, "failed");
    assert.equal(back?.retryCount, 1);
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("404 si la propuesta no existe", async () => {
  await assert.rejects(retryAnalysisForProposal("imp-no-existe-0000"), (e: unknown) => {
    assertImprovementError(e, 404);
    return true;
  });
});

test("claim atómico: reserva sincrónica consume el intento sin correr análisis", () => {
  const failed = seedProposal("failed");
  const first = claimRetryAnalysisBudget(failed.id);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.attempt, 1);
    assert.ok(typeof first.stamp === "string" && first.stamp.length > 0);
    assert.equal(first.current.retryCount, 1);
  }
  const second = claimRetryAnalysisBudget(failed.id);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.code, 409);
    assert.match(second.error, /budget reached/);
  }
  const back = readProposal(failed.id);
  assert.equal(back?.status, "failed", "el claim no decide: sigue failed");
  assert.equal(back?.retryCount, 1, "el intento queda consumido aunque no corrió análisis");
});

test("concurrente simulado (C-retry4): 2 llamadas solapadas → 1 ejecuta + 1 ve 409", async () => {
  const job = makeJob("revisar el modulo de conciliacion");
  seedFailingScore(job);
  const failed = seedProposal("failed");
  let executions = 0;
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  setAnalysisPromptMock(async () => {
    executions += 1;
    await gate;
    return JSON.stringify({
      pattern: "los reviews caen a ask_human por infra timeout 20000ms+retry",
      target: "skills/code-review/SKILL.md",
      rationale: "endurecer la regla de evidencia bloqueante corrige el patron",
      newContent: "# Code Review (propuesto)\n\nRegla: sin evidencia no hay accept.\n",
      regressionsAddressed: [job],
    });
  });
  try {
    // Ambas llamadas se crean sin await intermedio: la primera reclama el
    // presupuesto en su prefijo sincrónico y queda en vuelo en el mock; la
    // segunda debe ver 409 sin ejecutar. Sin el fix ambas ejecutarían
    // (check-then-act) y executions sería 2 con retryCount en 1.
    const first = retryAnalysisForProposal(failed.id);
    const second = retryAnalysisForProposal(failed.id);
    releaseGate();
    const settled = await Promise.allSettled([first, second]);
    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<ImprovementProposal> => s.status === "fulfilled",
    );
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );
    assert.equal(fulfilled.length, 1, "exactamente una llamada debe ejecutar el análisis");
    assert.equal(rejected.length, 1, "la otra debe ver 409");
    assertImprovementError(rejected[0].reason, 409);
    assert.match(String((rejected[0].reason as Error).message), /budget reached/);
    assert.equal(executions, 1, "el análisis debe correr una sola vez (sin doble-spend)");
    assert.equal(fulfilled[0].value.status, "ready");
    assert.equal(fulfilled[0].value.retryCount, 1);
    const back = readProposal(failed.id);
    assert.equal(back?.status, "ready");
    assert.equal(back?.retryCount, 1, "retryCount exacto tras la carrera");
  } finally {
    setAnalysisPromptMock(null);
  }
});

// ── Handler de dominio (forma del endpoint, sin daemon) ──

interface Captured {
  status: number;
  body: string;
}

function fakeRes(): Captured & {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
} {
  const captured: Captured = { status: 0, body: "" };
  return {
    ...captured,
    status: 0,
    body: "",
    writeHead(status: number) {
      (this as unknown as Captured).status = status;
      return null;
    },
    end(body: string) {
      (this as unknown as Captured).body = body;
      return null;
    },
  } as unknown as Captured & {
    writeHead(status: number, headers: Record<string, string>): unknown;
    end(body: string): unknown;
  };
}

function readJson(res: { status: number; body: string }): { status: number; json: Record<string, unknown> } {
  return { status: res.status, json: JSON.parse(res.body) as Record<string, unknown> };
}

test("handler: 400 path malo, 404 inexistente, 409 non-failed", async () => {
  const bad = fakeRes();
  await handleProposalRetryAnalysisRoute("/factory/improve/proposals/imp-x/adopt", bad);
  assert.equal(readJson(bad).status, 400);

  const missing = fakeRes();
  await handleProposalRetryAnalysisRoute(
    "/factory/improve/proposals/imp-no-existe-0000/retry-analysis",
    missing,
  );
  const missingOut = readJson(missing);
  assert.equal(missingOut.status, 404);
  assert.match(String(missingOut.json.error ?? ""), /not found/);

  const ready = seedProposal("ready");
  const conflict = fakeRes();
  await handleProposalRetryAnalysisRoute(
    `/factory/improve/proposals/${ready.id}/retry-analysis`,
    conflict,
  );
  const conflictOut = readJson(conflict);
  assert.equal(conflictOut.status, 409);
  assert.match(String(conflictOut.json.error ?? ""), /not retryable/);
});

test("handler: 200 con propuesta failed→ready (mock OK)", async () => {
  const job = makeJob("revisar el modulo de reportes");
  seedFailingScore(job);
  const failed = seedProposal("failed");
  mockAnalysisOk([job]);
  try {
    const res = fakeRes();
    await handleProposalRetryAnalysisRoute(
      `/factory/improve/proposals/${failed.id}/retry-analysis`,
      res,
    );
    const out = readJson(res);
    assert.equal(out.status, 200);
    assert.equal(out.json.ok, true);
    const proposal = out.json.proposal as unknown as ImprovementProposal;
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.retryCount, 1);
  } finally {
    setAnalysisPromptMock(null);
  }
});
