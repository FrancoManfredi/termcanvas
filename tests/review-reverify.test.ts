/**
 * Ola 17 (Paridad Warp: review que re-valida) — suite E1.
 * El reviewer pide, el SISTEMA ejecuta: allowlist cerrada, fail-closed con
 * nota, 1 reverify por review (con cota MAX_REVIEW_ROUNDS: el loop
 * revise↔Building termina por veredicto, humano o rondas agotadas),
 * evidence capada en timeline + meta del rebuild, flag OFF = revise clásico.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReviewFindingSchema, ReviewLLMResponseSchema } from "../shared/types/review.ts";
import {
  REVERIFY_EVIDENCE_MAX_BYTES,
  REVERIFY_IGNORED_NOTE,
  REVERIFY_TRUNCATION_MARK,
  capReverifyEvidence,
  isReviewerReverifyEnabled,
  resetReviewerReverifyOverrideForTests,
  setReviewerReverifyOverrideForTests,
  validateReverifyCommands,
} from "../headless-runtime/review/reverifyAllowlist.ts";
import {
  setRunFocusedExecutorForTests,
  verificationService,
} from "../headless-runtime/implement/verification.ts";
import { parseFactoryYaml } from "../headless-runtime/factory/agentLoader.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";

const WT = "C:\\repo";
const JOB_PATHS = ["src/a.ts", "src/b/c.ts"];

function mkTmpWorktree(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupJob(id: string, worktree: string): void {
  workItemStore.create({ id, prompt: "hacer algo", worktree, phase: "diagnosisLlm" });
  workItemStore.transition(id, "Foreman", "foreman", "t");
  workItemStore.transition(id, "Building", "foreman", "t");
  workItemStore.transition(id, "Review", "runner", "verification passed → Review");
}

/** Mock de reviewer: siempre revise con el `reverify` dado. */
function reviseMockWith(commands: unknown): () => Promise<string | null> {
  return async () =>
    JSON.stringify({
      verdict: "revise",
      confidence: 0.8,
      summary: "evidencia floja",
      findings: [
        {
          id: "f1",
          axis: "tests",
          severity: "major",
          message: "los tests no se ven en la evidencia",
          reverify: { commands, reason: "confirmar evidencia" },
        },
      ],
    });
}

function timelineOf(id: string): Array<{ message: string; actor: string; meta?: Record<string, unknown> }> {
  const item = workItemStore.get(id);
  assert.ok(item, "job debe existir");
  return (item.timeline ?? []).map((e) => ({
    message: e.message,
    actor: e.actor,
    ...(e.meta ? { meta: e.meta as Record<string, unknown> } : {}),
  }));
}

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

// ── Allowlist: acepta ──

test("allowlist acepta los 5 comandos exactos", () => {
  for (const cmd of ["pnpm test", "pnpm build", "git diff --stat", "git status --porcelain"]) {
    const r = validateReverifyCommands([cmd], WT, JOB_PATHS);
    assert.deepEqual(r.valid, [cmd], cmd);
    assert.deepEqual(r.invalid, [], cmd);
    assert.equal(r.note, null, cmd);
  }
  const diff = validateReverifyCommands(["git diff -- src/a.ts"], WT, JOB_PATHS);
  assert.deepEqual(diff.valid, ["git diff -- src/a.ts"]);
  assert.deepEqual(diff.invalid, []);
  assert.equal(diff.note, null);
});

test("allowlist: trim tolerado, comparación case-sensitive", () => {
  const trimmed = validateReverifyCommands(["  pnpm test  "], WT, JOB_PATHS);
  assert.deepEqual(trimmed.valid, ["pnpm test"]);
  const upper = validateReverifyCommands(["PNPM TEST"], WT, JOB_PATHS);
  assert.deepEqual(upper.valid, []);
  assert.deepEqual(upper.invalid, ["PNPM TEST"]);
  assert.equal(upper.note, REVERIFY_IGNORED_NOTE);
});

test("allowlist: dedupe y multi-path del job", () => {
  const r = validateReverifyCommands(["pnpm test", "pnpm test", "git diff -- src/a.ts src/b/c.ts"], WT, JOB_PATHS);
  assert.deepEqual(r.valid, ["pnpm test", "git diff -- src/a.ts src/b/c.ts"]);
  assert.equal(r.note, null);
});

// ── Allowlist: rechaza ──

test("allowlist rechaza rm e inyección de shell con nota exacta", () => {
  const evil = [
    "rm -rf x",
    "pnpm test && curl evil",
    "pnpm test | head",
    "pnpm test > out.txt",
    "pnpm test; rm -rf /",
    "pnpm test `id`",
    "pnpm test $(whoami)",
    "pnpm test ${HOME}",
    "git status --porcelain || evil",
    "git diff --stat \n rm -rf x",
  ];
  for (const cmd of evil) {
    const r = validateReverifyCommands([cmd], WT, JOB_PATHS);
    assert.deepEqual(r.valid, [], cmd);
    assert.equal(r.invalid.length, 1, cmd);
    assert.equal(r.note, REVERIFY_IGNORED_NOTE, cmd);
  }
});

test("allowlist rechaza git diff fuera del job", () => {
  const outside = [
    "git diff",
    "git diff --",
    "git diff -- ../other/x.ts",
    "git diff -- /abs/x.ts",
    "git diff -- C:/repo/x.ts",
    "git diff -- src/z.ts",
    "git diff -- .",
    "git diff -- src/a.ts --stat",
  ];
  for (const cmd of outside) {
    const r = validateReverifyCommands([cmd], WT, JOB_PATHS);
    assert.deepEqual(r.valid, [], cmd);
    assert.equal(r.note, REVERIFY_IGNORED_NOTE, cmd);
  }
});

test("allowlist: input no-array y mezcla válido/inválido", () => {
  const notArray = validateReverifyCommands("pnpm test", WT, JOB_PATHS);
  assert.deepEqual(notArray.valid, []);
  assert.equal(notArray.note, REVERIFY_IGNORED_NOTE);
  const mixed = validateReverifyCommands(["pnpm test", "rm -rf x"], WT, JOB_PATHS);
  assert.deepEqual(mixed.valid, ["pnpm test"]);
  assert.deepEqual(mixed.invalid, ["rm -rf x"]);
  assert.equal(mixed.note, REVERIFY_IGNORED_NOTE);
});

// ── Schema ──

test("schema: finding con reverify válido parsea; sin reverify intacto; malformado rechaza", () => {
  const base = { id: "f1", axis: "tests", severity: "major", message: "m" };
  const withReverify = {
    ...base,
    reverify: { commands: ["pnpm test"], reason: "confirmar" },
  };
  assert.ok(ReviewFindingSchema.safeParse(withReverify).success);
  assert.ok(ReviewFindingSchema.safeParse(base).success);
  assert.equal(ReviewFindingSchema.safeParse({ ...base, reverify: { commands: [], reason: "x" } }).success, false);
  assert.equal(ReviewFindingSchema.safeParse({ ...base, reverify: { commands: ["pnpm test"], reason: "  " } }).success, false);
  const llm = ReviewLLMResponseSchema.safeParse({
    verdict: "revise",
    confidence: 0.8,
    summary: "s",
    findings: [withReverify],
  });
  assert.ok(llm.success);
});

// ── Cap + flag ──

test("evidence se capa a 8KB con marca", () => {
  const exact = "x".repeat(REVERIFY_EVIDENCE_MAX_BYTES);
  assert.equal(capReverifyEvidence(exact), exact);
  const big = "y".repeat(REVERIFY_EVIDENCE_MAX_BYTES + 100);
  const capped = capReverifyEvidence(big);
  assert.equal(capped.length, REVERIFY_EVIDENCE_MAX_BYTES + REVERIFY_TRUNCATION_MARK.length);
  assert.ok(capped.endsWith(REVERIFY_TRUNCATION_MARK));
});

test("factory.yaml: reviewerReverify parsea y defaultea true", () => {
  assert.equal(parseFactoryYaml(`${BASE_YAML}reviewerReverify: false\n`).reviewerReverify, false);
  assert.equal(parseFactoryYaml(`${BASE_YAML}reviewerReverify: true\n`).reviewerReverify, true);
  assert.equal(parseFactoryYaml(BASE_YAML).reviewerReverify, true);
});

test("flag: override de tests manda", () => {
  try {
    setReviewerReverifyOverrideForTests(false);
    assert.equal(isReviewerReverifyEnabled(), false);
    setReviewerReverifyOverrideForTests(true);
    assert.equal(isReviewerReverifyEnabled(), true);
  } finally {
    resetReviewerReverifyOverrideForTests();
  }
  assert.equal(typeof isReviewerReverifyEnabled(), "boolean");
});

// ── runFocused ──

test("runFocused sin válidas: evidence con nota, cero ejecuciones", async () => {
  let calls = 0;
  setRunFocusedExecutorForTests(async () => {
    calls++;
    return { exitCode: 0, output: "nunca" };
  });
  try {
    const r = await verificationService.runFocused(["rm -rf x"], { worktree: WT, jobPaths: JOB_PATHS });
    assert.deepEqual(r.commands, []);
    assert.ok(r.evidence.includes(REVERIFY_IGNORED_NOTE));
    assert.equal(calls, 0);
    assert.ok(r.isolation === "docker" || r.isolation === "none");
  } finally {
    setRunFocusedExecutorForTests(null);
  }
});

test("runFocused ejecuta válidas con seam y arma evidence", async () => {
  const seen: string[] = [];
  setRunFocusedExecutorForTests(async (command) => {
    seen.push(command);
    return { exitCode: 0, output: `$ ${command}\nmock-output-ok` };
  });
  const worktree = mkTmpWorktree("reverify-focused-");
  try {
    const r = await verificationService.runFocused(["pnpm test", "git status --porcelain"], {
      worktree,
      jobPaths: [],
    });
    assert.deepEqual(r.commands, ["pnpm test", "git status --porcelain"]);
    assert.ok(r.evidence.includes("mock-output-ok"));
    assert.ok(r.evidence.includes("git status --porcelain"));
    assert.deepEqual(seen, ["pnpm test", "git status --porcelain"]);
  } finally {
    setRunFocusedExecutorForTests(null);
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("runFocused capa evidence gigante del executor", async () => {
  // Un solo comando ya viene acotado por buildSnippet (~4KB): para superar
  // el cap de 8KB se necesitan varios comandos con salida grande.
  setRunFocusedExecutorForTests(async () => ({ exitCode: 0, output: "z".repeat(30000) }));
  const worktree = mkTmpWorktree("reverify-cap-");
  try {
    const r = await verificationService.runFocused(["pnpm test", "git status --porcelain", "git diff --stat"], {
      worktree,
      jobPaths: [],
    });
    assert.deepEqual(r.commands, ["pnpm test", "git status --porcelain", "git diff --stat"]);
    assert.ok(r.evidence.length <= REVERIFY_EVIDENCE_MAX_BYTES + REVERIFY_TRUNCATION_MARK.length);
    assert.ok(r.evidence.endsWith(REVERIFY_TRUNCATION_MARK));
  } finally {
    setRunFocusedExecutorForTests(null);
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("runFocused real: git status --porcelain en worktree tmp", async () => {
  setRunFocusedExecutorForTests(null);
  const worktree = mkTmpWorktree("reverify-real-");
  try {
    const r = await verificationService.runFocused(["git status --porcelain"], { worktree, jobPaths: [] });
    assert.deepEqual(r.commands, ["git status --porcelain"]);
    assert.ok(r.evidence.includes("git status --porcelain"));
    assert.ok(r.evidence.length > 0);
    assert.ok(r.isolation === "docker" || r.isolation === "none");
  } finally {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

// ── reviewService ──

test("finding con reverify inválido → revise clásico, cero ejecuciones (flujo simple, sin reverify)", async () => {
  const worktree = mkTmpWorktree("reverify-invalid-");
  const id = "job-reverify-inv01";
  let calls = 0;
  workItemStore.clear();
  setReviewerReverifyOverrideForTests(true);
  setReviewPromptMock(reviseMockWith(["rm -rf x"]));
  setRunFocusedExecutorForTests(async () => {
    calls++;
    return { exitCode: 0, output: "nunca" };
  });
  try {
    setupJob(id, worktree);
    const after = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(after?.status, "Building");
    const findings = after?.lastReview?.findings ?? [];
    assert.equal(findings.length, 1);
    assert.deepEqual(
      (findings[0] as unknown as { reverify: { commands: string[] } }).reverify.commands,
      ["rm -rf x"],
    );
    const tl = timelineOf(id);
    assert.ok(!tl.some((e) => e.message.startsWith("reverify: ejecutados")), "cero ejecuciones");
    assert.equal(calls, 0);
    const building = tl.find((e) => e.message.includes("→ Building"));
    assert.ok(building && building.meta && !("reverify" in (building.meta as Record<string, unknown>)));
    workItemStore.transition(id, "Review", "runner", "rebuild simulado → Review");
  } finally {
    setReviewPromptMock(null);
    setRunFocusedExecutorForTests(null);
    resetReviewerReverifyOverrideForTests();
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("revise válido: flujo simple sin ejecuciones, revise clásico a Building", async () => {
  const worktree = mkTmpWorktree("reverify-ok-");
  const id = "job-reverify-ok01";
  const seen: string[] = [];
  workItemStore.clear();
  setReviewerReverifyOverrideForTests(true);
  setReviewPromptMock(reviseMockWith(["git status --porcelain"]));
  setRunFocusedExecutorForTests(async (command) => {
    seen.push(command);
    return { exitCode: 0, output: `$ ${command}\nmock-output-ok` };
  });
  try {
    setupJob(id, worktree);
    const after = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(after?.status, "Building");
    assert.equal(after?.reviewCount, 1);
    assert.deepEqual(seen, [], "flujo simple: cero ejecuciones de reverify");
    const tl = timelineOf(id);
    assert.ok(!tl.some((e) => e.message.startsWith("reverify: ejecutados")), "sin evento de ejecución");
    const building = tl.find((e) => e.message.includes("→ Building"));
    assert.ok(building, "revise clásico vuelve a Building");
    assert.ok(building && building.meta && !("reverify" in (building.meta as Record<string, unknown>)), "sin meta reverify");
    workItemStore.transition(id, "Review", "runner", "rebuild simulado → Review");
  } finally {
    setReviewPromptMock(null);
    setRunFocusedExecutorForTests(null);
    resetReviewerReverifyOverrideForTests();
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("siempre-pide-reverify: flujo simple sin ejecuciones; 2º turno post-cap → ask_human", async () => {
  const worktree = mkTmpWorktree("reverify-loop-");
  const id = "job-reverify-loop01";
  let calls = 0;
  workItemStore.clear();
  setReviewerReverifyOverrideForTests(true);
  setReviewPromptMock(reviseMockWith(["git status --porcelain"]));
  setRunFocusedExecutorForTests(async () => {
    calls++;
    return { exitCode: 0, output: "ok" };
  });
  try {
    setupJob(id, worktree);
    // Ciclo 1: primer review → revise clásico → Building(1), cero ejecuciones.
    const c1 = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(c1?.status, "Building");
    assert.equal(calls, 0);
    workItemStore.transition(id, "Review", "runner", "rebuild 1 → Review");
    // Ciclo 2: ronda agotada (MAX=1) → post-cap ask_human sin LLM-call.
    const c2 = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(c2?.status, "Review");
    assert.equal(c2?.lastReview?.verdict, "ask_human");
    assert.equal(calls, 0);
    // Fast-forward: ya en Review con revise previo → post-cap ask_human.
    const seed = workItemStore.get(id)!;
    (seed as unknown as Record<string, unknown>).reviewCount = 1;
    (seed as unknown as Record<string, unknown>).lastReview = { verdict: "revise", findings: [] };
    const c3 = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(c3?.status, "Review");
    assert.equal(c3?.lastReview?.verdict, "ask_human");
    assert.equal(calls, 0);
  } finally {
    setReviewPromptMock(null);
    setRunFocusedExecutorForTests(null);
    resetReviewerReverifyOverrideForTests();
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("flag OFF → revise clásico con cero ejecuciones", async () => {
  const worktree = mkTmpWorktree("reverify-off-");
  const id = "job-reverify-off01";
  let calls = 0;
  workItemStore.clear();
  setReviewerReverifyOverrideForTests(false);
  setReviewPromptMock(reviseMockWith(["git status --porcelain", "pnpm test"]));
  setRunFocusedExecutorForTests(async () => {
    calls++;
    return { exitCode: 0, output: "nunca" };
  });
  try {
    setupJob(id, worktree);
    const after = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(after?.status, "Building");
    assert.equal(after?.lastReview?.verdict, "revise");
    assert.equal(calls, 0);
    const tl = timelineOf(id);
    assert.ok(!tl.some((e) => e.message.includes("reverify")), "cero trazas de reverify con flag OFF");
    workItemStore.transition(id, "Review", "runner", "rebuild simulado → Review");
  } finally {
    setReviewPromptMock(null);
    setRunFocusedExecutorForTests(null);
    resetReviewerReverifyOverrideForTests();
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});
