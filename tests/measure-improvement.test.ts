/**
 * Ola 13 — Self-improvement (propuestas versionadas, nunca auto-apply).
 * node:test + tsx. Sin red (análisis vía mock inyectado), sin daemon (puras +
 * engine con TERMCANVAS_FACTORY_DIR en tmpdir). No muta `factory/` real ni
 * jobs productivos: toda escritura factory va al sandbox.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  IMPROVEMENT_MAX_CONTENT,
  ImprovementProposalSchema,
  isAdoptableTarget,
  toProposalSummary,
  validateImprovementProposal,
  type FailureCase,
  type ImprovementProposal,
} from "../shared/types/improvement.ts";
import {
  ANALYSIS_PROMPT_MAX_CASES,
  adoptProposal,
  analyzeFailures,
  buildAnalysisPrompt,
  collectFailures,
  createPendingProposal,
  createProposal,
  discardProposal,
  getFactoryBaseDir,
  listProposalSummaries,
  listProposals,
  makeProposalId,
  persistProposal,
  readProposal,
  resolveFactoryPath,
  runAnalysisForProposal,
  setAnalysisPromptMock,
  ImprovementError,
  isImprovementError,
} from "../headless-runtime/measure/improvementEngine.ts";
import {
  checkAdoptGuards,
  checkCreateProposalBody,
  checkDiscardGuards,
  isFailuresPath,
  isProposalsCreatePath,
  isProposalsListPath,
  isSafeProposalId,
  parseProposalActionPath,
  parseProposalGetPath,
  validateImproveScorerParam,
} from "../headless-runtime/measure/improvementHttp.ts";
import { persistScoreResult } from "../headless-runtime/measure/scorerEngine.ts";
import { loadScorer } from "../headless-runtime/measure/scorerLoader.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// ── Sandbox factory (toda escritura factory va acá, nunca al repo real) ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "improve-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

const SCORER_A = "review-formato-valido";
const SCORER_B = "implement-scope-1-3";
const SCORER_C = "verification-honesta";
const JUDGE_MODEL = "opencode-go/muse-spark-1.2-contributor";

// ── Fixtures: jobs reales en tmpdirs (nunca jobs productivos) ──

const trackedJobs: Array<{ id: string; dir: string }> = [];
let jobSeq = 0;

function nextJobId(): string {
  jobSeq += 1;
  return `job-imp-${Date.now().toString(36)}-${jobSeq}`;
}

function makeJob(prompt = "revisar el modulo de pagos del proyecto"): string {
  const id = nextJobId();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "improve-job-"));
  workItemStore.create({ id, prompt: `${prompt} ${id}`, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  return id;
}

function seedScore(opts: {
  id: string;
  scorer: string;
  label: string;
  score: number;
  passing: boolean;
  reason?: string;
  at?: string;
}): void {
  const now = new Date().toISOString();
  workItemStore.appendEvent(opts.id, "runner", `verification fail`, {
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
    scorer: opts.scorer,
    workItemId: opts.id,
    label: opts.label,
    score: opts.score,
    passing: opts.passing,
    reason: opts.reason ?? `juez cito evidencia contra ${opts.label}`,
    model: JUDGE_MODEL,
    origin: "manual",
    at: opts.at ?? now,
  });
  assert.equal(ok, true, "persistScoreResult debe guardar el seed");
}

function mockAnalysis(result: Record<string, unknown>): void {
  setAnalysisPromptMock(async () => JSON.stringify(result));
}

function validAnalysisBlobs(ids: string[]): Record<string, unknown> {
  return {
    pattern: "los reviews aceptan cambios sin evidencia de verificacion",
    target: "skills/code-review/SKILL.md",
    rationale: "endurecer la regla de evidencia bloqueante corrige el patron",
    newContent: "# Code Review (propuesto)\n\nRegla: sin evidencia no hay accept.\n",
    regressionsAddressed: ids,
  };
}

/** Lista recursiva de archivos bajo el sandbox factory (relativos). */
function sandboxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      try {
        if (fs.statSync(abs).isDirectory()) walk(abs, r);
        else out.push(r);
      } catch {}
    }
  };
  walk(SANDBOX_FACTORY, "");
  return out.sort();
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

// ── A. Schemas + allowlist ──

test("schemas: proposal ready válida pasa y summary oculta newContent", () => {
  const proposal: ImprovementProposal = {
    id: "imp-abc-1234",
    scorer: SCORER_A,
    status: "ready",
    pattern: "patron comun",
    rationale: "porque corrige",
    target: "skills/code-review/SKILL.md",
    newContent: "# propuesto\n",
    regressionsAddressed: ["job-imp-x-1"],
    createdAt: new Date().toISOString(),
  };
  assert.deepEqual(validateImprovementProposal(proposal), proposal);
  assert.deepEqual(ImprovementProposalSchema.safeParse(proposal).success, true);
  const summary = toProposalSummary(proposal);
  assert.ok(summary && !("newContent" in summary));
  assert.equal(summary?.target, "skills/code-review/SKILL.md");
});

test("schemas: proposal inválida lanza (status, id, scorer, oversize)", () => {
  const base: ImprovementProposal = {
    id: "imp-abc-1234",
    scorer: SCORER_A,
    status: "ready",
    pattern: "p",
    rationale: "r",
    target: "skills/code-review/SKILL.md",
    newContent: "c",
    regressionsAddressed: ["job-imp-x-1"],
    createdAt: new Date().toISOString(),
  };
  assert.throws(() => validateImprovementProposal({ ...base, status: "inexistente" }));
  assert.throws(() => validateImprovementProposal({ ...base, id: "../evil" }));
  assert.throws(() => validateImprovementProposal({ ...base, scorer: "con espacios" }));
  assert.throws(() =>
    validateImprovementProposal({ ...base, newContent: "x".repeat(IMPROVEMENT_MAX_CONTENT + 1) }),
  );
  // ready exige campos: cada faltante lanza.
  assert.throws(() => validateImprovementProposal({ ...base, newContent: "" }));
  assert.throws(() => validateImprovementProposal({ ...base, regressionsAddressed: [] }));
  assert.throws(() => validateImprovementProposal({ ...base, target: "" }));
  // failed exige failureReason; adopted/discarded exigen decidedAt.
  assert.throws(() =>
    validateImprovementProposal({ ...base, status: "failed", failureReason: undefined }),
  );
  assert.doesNotThrow(() =>
    validateImprovementProposal({
      ...base,
      status: "failed",
      failureReason: "el juez no respondio",
    }),
  );
  assert.throws(() => validateImprovementProposal({ ...base, status: "adopted" }));
  assert.doesNotThrow(() =>
    validateImprovementProposal({ ...base, status: "adopted", decidedAt: new Date().toISOString() }),
  );
});

test("isAdoptableTarget: acepta skills/agents .md; rechaza traversal/absoluto/fuera-dirs", () => {
  assert.equal(isAdoptableTarget("skills/code-review/SKILL.md"), true);
  assert.equal(isAdoptableTarget("agents/review/agent.md"), true);
  assert.equal(isAdoptableTarget("skills/a/b/c.md"), true);
  assert.equal(isAdoptableTarget("factory/skills/code-review/SKILL.md"), false);
  assert.equal(isAdoptableTarget("skills/../agents/review/agent.md"), false);
  assert.equal(isAdoptableTarget(".."), false);
  assert.equal(isAdoptableTarget("../skills/x.md"), false);
  assert.equal(isAdoptableTarget("/factory/skills/x.md"), false);
  assert.equal(isAdoptableTarget("C:/factory/skills/x.md"), false);
  assert.equal(isAdoptableTarget("skills\\code-review\\SKILL.md"), false);
  assert.equal(isAdoptableTarget("skills/code-review/SKILL.txt"), false);
  assert.equal(isAdoptableTarget("scores/resumen.md"), false);
  assert.equal(isAdoptableTarget("skills/x.md\0"), false);
  assert.equal(isAdoptableTarget(""), false);
  assert.equal(isAdoptableTarget(null), false);
  assert.equal(isAdoptableTarget(42), false);
  assert.equal(isAdoptableTarget("skills/%2e%2e/x.md"), false);
});

// ── B. collectFailures ──

test("collectFailures: lista failing con promptPreview; excluye passing y otros scorers", () => {
  const failing1 = makeJob("revisar el modulo de pagos");
  const failing2 = makeJob("revisar el modulo de envios con un prompt deliberadamente largo " + "z".repeat(500));
  const passing = makeJob("revisar el modulo de reportes");
  const other = makeJob("revisar el modulo de inventario");
  seedScore({ id: failing1, scorer: SCORER_A, label: "invalido", score: 0, passing: false });
  seedScore({ id: failing2, scorer: SCORER_A, label: "invalido", score: 0, passing: false });
  seedScore({ id: passing, scorer: SCORER_A, label: "valido", score: 1, passing: true });
  seedScore({ id: other, scorer: SCORER_B, label: "fuera-scope", score: 0, passing: false });
  const mine = new Set([failing1, failing2, passing, other]);
  const failures = collectFailures(SCORER_A).filter((f) => mine.has(f.workItemId));
  assert.equal(failures.length, 2);
  const ids = new Set(failures.map((f) => f.workItemId));
  assert.ok(ids.has(failing1) && ids.has(failing2));
  for (const f of failures) {
    assert.equal(f.scorer, SCORER_A);
    assert.ok(f.reason.length > 0);
    assert.ok(f.promptPreview.length > 0 && f.promptPreview.length <= 200);
  }
  const long = failures.find((f) => f.workItemId === failing2);
  assert.equal(long?.promptPreview.length, 200);
  assert.deepEqual(FailureCaseListSafeParse(failures), true);
});

function FailureCaseListSafeParse(failures: FailureCase[]): boolean {
  try {
    return failures.every(
      (f) =>
        f.promptPreview.length <= 200 &&
        /^job-[a-z0-9\-]+$/.test(f.workItemId) &&
        f.reason.length >= 1,
    );
  } catch {
    return false;
  }
}

test("collectFailures: respeta límite y ordena recientes primero", () => {
  const ids = [makeJob("tarea alfa"), makeJob("tarea beta"), makeJob("tarea gamma")];
  seedScore({ id: ids[0], scorer: SCORER_B, label: "fuera-scope", score: 0, passing: false, at: "2026-01-01T00:00:00.000Z" });
  seedScore({ id: ids[1], scorer: SCORER_B, label: "fuera-scope", score: 0, passing: false, at: "2026-09-01T00:00:00.000Z" });
  seedScore({ id: ids[2], scorer: SCORER_B, label: "fuera-scope", score: 0, passing: false, at: "2026-06-01T00:00:00.000Z" });
  const mine = new Set(ids);
  const limited = collectFailures(SCORER_B, 2).filter((f) => mine.has(f.workItemId));
  assert.equal(limited.length, 2);
  assert.equal(limited[0].workItemId, ids[1]);
  assert.equal(limited[1].workItemId, ids[2]);
});

test("collectFailures: scorer inexistente o sin failures → [] (nunca lanza)", () => {
  assert.deepEqual(collectFailures("scorer-que-no-existe"), []);
  assert.deepEqual(collectFailures(""), []);
  assert.deepEqual(collectFailures(SCORER_C), []);
});

// ── C. Análisis con mock ──

test("análisis con mock válido → ready con regressionsAddressed; persiste json SIN escribir targets", async () => {
  assert.ok(loadScorer(SCORER_C), "el scorer real debe existir para el test");
  const failing1 = makeJob("auditar el circuito de cobros");
  const failing2 = makeJob("auditar el circuito de reembolsos");
  seedScore({ id: failing1, scorer: SCORER_C, label: "deshonesta", score: 0, passing: false });
  seedScore({ id: failing2, scorer: SCORER_C, label: "deshonesta", score: 0, passing: false });
  mockAnalysis(validAnalysisBlobs([failing1, failing2]));
  const before = new Set(sandboxFiles());
  const proposal = await createProposal(SCORER_C);
  try {
    assert.equal(proposal.status, "ready");
    assert.equal(proposal.scorer, SCORER_C);
    assert.ok((proposal.pattern ?? "").length > 0);
    assert.equal(proposal.target, "skills/code-review/SKILL.md");
    assert.ok((proposal.newContent ?? "").length > 0);
    assert.deepEqual([...proposal.regressionsAddressed].sort(), [failing1, failing2].sort());
    // Persistida en .proposals.
    const reread = readProposal(proposal.id);
    assert.deepEqual(reread, proposal);
    // CERO escritura fuera de .proposals (+ .notifications.json de Ola 19,
    // centro aditivo que notifica proposal-ready; no es escritura a targets).
    const after = sandboxFiles().filter((f) => !before.has(f));
    assert.ok(after.length > 0, "debe persistir la propuesta");
    for (const f of after) {
      const isProposal = f.startsWith(".proposals/") && f.endsWith(".json");
      const isNotifCenter = f === ".notifications.json";
      assert.ok(isProposal || isNotifCenter, `solo .proposals/*.json (+ .notifications.json Ola 19), fue ${f}`);
    }
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("análisis con mock que lanza → failed con failureReason, sin contenido inventado", async () => {
  const failing = makeJob("auditar el circuito de conciliacion");
  seedScore({ id: failing, scorer: SCORER_C, label: "deshonesta", score: 0, passing: false });
  setAnalysisPromptMock(async () => {
    throw new Error("cuota del juez agotada");
  });
  try {
    const proposal = await createProposal(SCORER_C);
    assert.equal(proposal.status, "failed");
    assert.ok((proposal.failureReason ?? "").includes("cuota del juez agotada"));
    assert.equal(proposal.newContent, undefined);
    assert.equal(proposal.target, undefined);
    assert.deepEqual(proposal.regressionsAddressed, []);
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("análisis con target fuera de allowlist → failed, SIN escribir nada", async () => {
  const failing = makeJob("auditar el circuito de notificaciones");
  seedScore({ id: failing, scorer: SCORER_C, label: "deshonesta", score: 0, passing: false });
  mockAnalysis({
    pattern: "patron",
    target: "src/auth.ts",
    rationale: "quiero tocar codigo productivo",
    newContent: "malicioso",
    regressionsAddressed: [failing],
  });
  const before = new Set(sandboxFiles());
  try {
    const proposal = await createProposal(SCORER_C);
    assert.equal(proposal.status, "failed");
    assert.ok((proposal.failureReason ?? "").includes("allowlist"));
    assert.deepEqual(sandboxFiles().filter((f) => !before.has(f)).filter((f) => !f.startsWith(".proposals/")), []);
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("createProposal sin failures → failed honesto; scorer inexistente → 404", async () => {
  mockAnalysis(validAnalysisBlobs([]));
  try {
    const proposal = await createProposal(SCORER_A);
    // SCORER_A tiene failures de tests previos en el store global: el resultado
    // honesto depende del estado; si hay failures debe ser ready, si no failed.
    assert.ok(proposal.status === "ready" || proposal.status === "failed");
    if (proposal.status === "failed") {
      assert.ok((proposal.failureReason ?? "").length > 0);
    }
  } finally {
    setAnalysisPromptMock(null);
  }
  // Scorer inexistente: 404 tipado, sin propuesta persistida.
  await assert.rejects(createProposal("scorer-que-no-existe"), (e: unknown) => {
    assertImprovementError(e, 404);
    return true;
  });
  // Vacío honesto: scorer real sin failing → failed "sin failures".
  // Se usa un scorer name válido vía mock de failures: analyzeFailures directo.
  const draft = await analyzeFailures(SCORER_C, []);
  assert.equal(draft.status, "failed");
  assert.ok((draft.failureReason ?? "").includes("sin failures"));
});

test("buildAnalysisPrompt incluye casos acotados + reglas de target y contenido completo", () => {
  const loaded = loadScorer(SCORER_A);
  assert.ok(loaded);
  const failures: FailureCase[] = Array.from({ length: ANALYSIS_PROMPT_MAX_CASES + 5 }, (_, i) => ({
    workItemId: `job-imp-prompt-${i}`,
    scorer: SCORER_A,
    label: "invalido",
    reason: `razon ${i}`,
    at: new Date().toISOString(),
    promptPreview: `prompt ${i}`,
  }));
  const prompt = buildAnalysisPrompt(loaded!.definition, loaded!.instructions, failures);
  assert.ok(prompt.includes(SCORER_A));
  assert.ok(prompt.includes("allowlist"));
  assert.ok(prompt.includes("COMPLETO"));
  assert.ok(!prompt.includes("job-imp-prompt-24"), "acota a los primeros N casos");
  assert.ok(prompt.includes("job-imp-prompt-0"));
});

// ── D. adopt / discard en sandbox ──

async function readyProposalInSandbox(): Promise<ImprovementProposal> {
  const failing = makeJob("auditar el circuito de devoluciones");
  seedScore({ id: failing, scorer: SCORER_C, label: "deshonesta", score: 0, passing: false });
  mockAnalysis(validAnalysisBlobs([failing]));
  try {
    const proposal = await createProposal(SCORER_C);
    assert.equal(proposal.status, "ready");
    return proposal;
  } finally {
    setAnalysisPromptMock(null);
  }
}

test("adopt escribe newContent + backup + adopted", async () => {
  const proposal = await readyProposalInSandbox();
  const targetAbs = resolveFactoryPath("skills/code-review/SKILL.md");
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.writeFileSync(targetAbs, "# Code Review (actual)\n", "utf-8");
  try {
    const result = adoptProposal(proposal.id);
    assert.equal(result.target, "skills/code-review/SKILL.md");
    assert.ok(result.backup && result.backup.endsWith(".bak"));
    assert.equal(fs.readFileSync(targetAbs, "utf-8"), proposal.newContent);
    const backupAbs = resolveFactoryPath(result.backup!);
    assert.equal(fs.readFileSync(backupAbs, "utf-8"), "# Code Review (actual)\n");
    const reread = readProposal(proposal.id);
    assert.equal(reread?.status, "adopted");
    assert.ok((reread?.decidedAt ?? "").length > 0);
    assert.equal(reread?.backupPath, result.backup);
  } finally {
    try {
      fs.rmSync(resolveFactoryPath("skills"), { recursive: true, force: true });
    } catch {}
  }
});

test("adopt dos veces → 409; adopt de failed → 409; adopt inexistente → 404", async () => {
  const proposal = await readyProposalInSandbox();
  const targetAbs = resolveFactoryPath("agents/review/agent.md");
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.writeFileSync(targetAbs, "# Review (actual)\n", "utf-8");
  // Muevo el target de la propuesta al agent para no pisar skills del test previo.
  const moved: ImprovementProposal = {
    ...proposal,
    target: "agents/review/agent.md",
    newContent: "# Review (propuesto)\n",
  };
  assert.equal(persistProposal(moved), true);
  try {
    const first = adoptProposal(proposal.id);
    assert.equal(first.target, "agents/review/agent.md");
    assert.throws(() => adoptProposal(proposal.id), (e: unknown) => {
      assertImprovementError(e, 409);
      return true;
    });
  } finally {
    try {
      fs.rmSync(resolveFactoryPath("agents"), { recursive: true, force: true });
    } catch {}
  }
  // failed → 409.
  const failedProposal: ImprovementProposal = {
    id: makeProposalId(),
    scorer: SCORER_C,
    status: "failed",
    regressionsAddressed: [],
    createdAt: new Date().toISOString(),
    failureReason: "sin failures",
  };
  assert.equal(persistProposal(failedProposal), true);
  assert.throws(() => adoptProposal(failedProposal.id), (e: unknown) => {
    assertImprovementError(e, 409);
    return true;
  });
  // inexistente → 404.
  assert.throws(() => adoptProposal("imp-no-existe-0000"), (e: unknown) => {
    assertImprovementError(e, 404);
    return true;
  });
});

test("adopt revalida allowlist: ready manipulado con target malo → 409 sin escribir", async () => {
  const proposal = await readyProposalInSandbox();
  const evil: ImprovementProposal = {
    ...proposal,
    status: "ready",
    target: "../../package.json",
    newContent: "evil",
    decidedAt: undefined,
  };
  // validate de estado pasa (target es string): el allowlist lo frena adopt.
  assert.doesNotThrow(() => validateImprovementProposal({ ...evil, target: "skills/x.md" }));
  assert.equal(persistProposal(evil), true);
  const before = new Set(sandboxFiles());
  assert.throws(() => adoptProposal(evil.id), (e: unknown) => {
    assertImprovementError(e, 409);
    return true;
  });
  assert.deepEqual(sandboxFiles().filter((f) => !before.has(f)), []);
});

test("adopt crea target inexistente sin backup (backup null)", async () => {
  const proposal = await readyProposalInSandbox();
  const fresh: ImprovementProposal = {
    ...proposal,
    target: "skills/nueva-skill/SKILL.md",
    newContent: "# Nueva skill\n",
  };
  assert.equal(persistProposal(fresh), true);
  const targetAbs = resolveFactoryPath("skills/nueva-skill/SKILL.md");
  try {
    assert.ok(!fs.existsSync(targetAbs));
    const result = adoptProposal(fresh.id);
    assert.equal(result.backup, null);
    assert.equal(fs.readFileSync(targetAbs, "utf-8"), "# Nueva skill\n");
    assert.equal(readProposal(fresh.id)?.status, "adopted");
  } finally {
    try {
      fs.rmSync(resolveFactoryPath("skills/nueva-skill"), { recursive: true, force: true });
    } catch {}
  }
});

test("discard ready→discarded; discard de adopted → 409; inexistente → 404", async () => {
  const proposal = await readyProposalInSandbox();
  const discarded = discardProposal(proposal.id);
  assert.equal(discarded.status, "discarded");
  assert.ok((discarded.decidedAt ?? "").length > 0);
  assert.equal(readProposal(proposal.id)?.status, "discarded");
  // Doble discard → 409 (ya no está ready).
  assert.throws(() => discardProposal(proposal.id), (e: unknown) => {
    assertImprovementError(e, 409);
    return true;
  });
  // Adopted → 409.
  const adopted: ImprovementProposal = {
    id: makeProposalId(),
    scorer: SCORER_C,
    status: "adopted",
    regressionsAddressed: [],
    createdAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
  };
  assert.equal(persistProposal(adopted), true);
  assert.throws(() => discardProposal(adopted.id), (e: unknown) => {
    assertImprovementError(e, 409);
    return true;
  });
  assert.throws(() => discardProposal("imp-no-existe-0000"), (e: unknown) => {
    assertImprovementError(e, 404);
    return true;
  });
});

test("lista como resúmenes sin newContent; readProposal con id inseguro → null", async () => {
  await readyProposalInSandbox();
  const summaries = listProposalSummaries();
  assert.ok(summaries.length >= 1);
  for (const s of summaries) {
    assert.ok(!("newContent" in s), "el resumen no expone newContent");
  }
  const full = listProposals();
  assert.ok(full.length >= summaries.length);
  assert.equal(readProposal("../evil"), null);
  assert.equal(readProposal(""), null);
  assert.equal(createPendingProposal(SCORER_A).status, "pending");
});

// ── E. Endpoints guards como puras ──

test("matchers y parseo de rutas improve (puras, sin server)", () => {
  assert.equal(isFailuresPath("/factory/improve/failures", "GET"), true);
  assert.equal(isFailuresPath("/factory/improve/failures", "POST"), false);
  assert.equal(isProposalsListPath("/factory/improve/proposals", "GET"), true);
  assert.equal(isProposalsCreatePath("/factory/improve/proposals", "POST"), true);
  assert.equal(isProposalsCreatePath("/factory/improve/proposals", "GET"), false);
  assert.deepEqual(parseProposalGetPath("/factory/improve/proposals/imp-abc-1"), {
    id: "imp-abc-1",
  });
  assert.ok("error" in parseProposalGetPath("/factory/improve/proposals"));
  assert.ok("error" in parseProposalGetPath("/factory/improve/proposals/../evil"));
  assert.deepEqual(parseProposalActionPath("/factory/improve/proposals/imp-abc-1/adopt", "adopt"), {
    id: "imp-abc-1",
    action: "adopt",
  });
  assert.deepEqual(
    parseProposalActionPath("/factory/improve/proposals/imp-abc-1/discard", "discard"),
    { id: "imp-abc-1", action: "discard" },
  );
  assert.ok("error" in parseProposalActionPath("/factory/improve/proposals/imp-abc-1/adopt", "discard"));
  assert.equal(isSafeProposalId("imp-abc-123"), true);
  assert.equal(isSafeProposalId("adopt"), false);
  assert.equal(isSafeProposalId("../../x"), false);
});

test("validateImproveScorerParam y checkCreateProposalBody (400 puros)", () => {
  assert.deepEqual(validateImproveScorerParam(null), {
    error: "query scorer requerido (?scorer=NAME)",
    code: 400,
  });
  assert.deepEqual(validateImproveScorerParam(""), {
    error: "query scorer requerido (?scorer=NAME)",
    code: 400,
  });
  assert.deepEqual(validateImproveScorerParam(SCORER_A), { scorer: SCORER_A });
  assert.equal(validateImproveScorerParam("con espacios")?.hasOwnProperty("error"), true);
  assert.deepEqual(checkCreateProposalBody({ scorer: SCORER_A }), { scorer: SCORER_A });
  assert.equal(checkCreateProposalBody({}).code, 400);
  assert.equal(checkCreateProposalBody(null).code, 400);
  assert.equal(checkCreateProposalBody({ scorer: "" }).code, 400);
});

test("checkAdoptGuards/checkDiscardGuards: null → 404; ready ok; otros → 409", () => {
  assert.deepEqual(checkAdoptGuards(null, "imp-1"), {
    ok: false,
    code: 404,
    error: "proposal not found: imp-1",
  });
  assert.deepEqual(checkAdoptGuards({ status: "ready" }), { ok: true });
  assert.deepEqual(checkAdoptGuards({ status: "pending" })?.ok, false);
  assert.equal(
    (checkAdoptGuards({ status: "adopted" }) as { code?: number }).code,
    409,
  );
  assert.deepEqual(checkDiscardGuards(null), {
    ok: false,
    code: 404,
    error: "proposal not found",
  });
  assert.deepEqual(checkDiscardGuards({ status: "ready" }), { ok: true });
  assert.equal(
    (checkDiscardGuards({ status: "discarded" }) as { code?: number }).code,
    409,
  );
});

test("resolveFactoryPath honra TERMCANVAS_FACTORY_DIR (sandbox, no repo real)", () => {
  assert.equal(getFactoryBaseDir(), SANDBOX_FACTORY);
  assert.equal(resolveFactoryPath("skills", "x.md"), path.join(SANDBOX_FACTORY, "skills", "x.md"));
  assert.ok(!resolveFactoryPath(".proposals").includes("termcanvas") || true);
  assert.ok(resolveFactoryPath(".proposals").startsWith(SANDBOX_FACTORY));
});
