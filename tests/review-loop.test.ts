import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { setHookSeamsForTests } from "../headless-runtime/factory/agents/agentHooks.ts";
import { decideReviewNext } from "../shared/types/review.ts";
import {
  runWorkflow,
  type LoadedWorkflow,
} from "../headless-runtime/workflows/executor.ts";
import {
  loadWorkflow,
  parseWorkflowDefinition,
} from "../headless-runtime/workflows/loader.ts";
import type { AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mkTmpWorktree(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

// Ola 4 T05 — loop Building↔Review con mocks (sin LLM real, sin pnpm).

test("loop revise×1 → Building una vez, luego stay (flujo simple, termina por accept/ask_human/cap o humano)", () => {
  // Puro: decideReviewNext modela el loop sin I/O.
  assert.equal(decideReviewNext("revise", 0), "Building");
  assert.equal(decideReviewNext("revise", 1), null);
  assert.equal(decideReviewNext("revise", 99), null);
});

test("handleReview accept → Complete + .done (mock LLM, sin gastar red)", async () => {
  const worktree = mkTmpWorktree("review-loop-");
  const id = "job-review-loop01";
  workItemStore.clear();
  setReviewPromptMock(async () =>
    JSON.stringify({
      verdict: "accept",
      confidence: 0.9,
      summary: "Cambio mínimo correcto, tests pass",
      findings: [],
    }),
  );
  // Hooks post-review en no-op: el accept se prueba sin gastar LLM de hooks.
  setHookSeamsForTests({ listHookAgents: () => [] });
  try {
    workItemStore.create({ id, prompt: "crear archivo hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const before = workItemStore.get(id);
    assert.equal(before?.status, "Review");

    const after = await reviewService.handleReview(before!);
    assert.equal(after?.status, "Complete");
    assert.equal(after?.reviewCount, 1);
    assert.equal(after?.lastReview?.verdict, "accept");
    // .done creado por Review accept (Implement ya NO lo crea)
    const dir = after?.dir as string;
    assert.ok(fs.existsSync(path.join(dir, ".done")));
    assert.ok(fs.existsSync(path.join(dir, "review.json")));
  } finally {
    setReviewPromptMock(null);
    setHookSeamsForTests(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("handleReview mismo-modelo conceptual → ask_human stay Review (mock fallo parse)", async () => {
  const worktree = mkTmpWorktree("review-loop-");
  const id = "job-review-loop02";
  workItemStore.clear();
  // Mock devuelve texto no-JSON → reviewAgent convierte a ask_human
  setReviewPromptMock(async () => "esto no es json válido {{{");
  try {
    workItemStore.create({ id, prompt: "hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const before = workItemStore.get(id);
    const after = await reviewService.handleReview(before!);
    assert.equal(after?.status, "Review");
    assert.equal(after?.lastReview?.verdict, "ask_human");
    assert.equal(after?.reviewCount, 1);
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

// WS3 — puerta de disposición del loop del fix-issue: el verde solo NO corta
// el ciclo; el until exige además `dispositionsComplete` (ningún finding
// abierto sin estado terminal). La config real y el evaluador del engine se
// prueban juntos: mismo string de `until`, mismo shape de review.

function loadedLoop(yaml: string, tmp: string): LoadedWorkflow {
  const sourcePath = path.join(tmp, "workflow.yaml");
  fs.writeFileSync(sourcePath, yaml, "utf-8");
  return {
    def: parseWorkflowDefinition(yaml, sourcePath),
    source: yaml,
    sourcePath,
    digest: crypto.createHash("sha256").update(yaml).digest("hex"),
    dir: tmp,
  };
}

test("WS3: el loop no corta con green si dispositionsComplete es false", async () => {
  // Contrato de config: el until REAL del fix-issue exige la puerta WS3 y el
  // output_format del review la declara obligatoria.
  const fixIssue = loadWorkflow("fix-issue", { repoRoot: REPO }).def;
  const build = fixIssue.nodes.find((node) => node.id === "build");
  const until = build?.loop_group?.until ?? "";
  assert.match(until, /green == true/, "sigue cortando con verde");
  assert.match(until, /dispositionsComplete == true/, "pero exige disposiciones completas");
  const review = build?.loop_group?.nodes.find((node) => node.id === "review");
  const required =
    (review?.output_format as { required?: unknown[] } | undefined)?.required ?? [];
  assert.ok(
    required.includes("dispositionsComplete"),
    "el review no valida sin declarar dispositionsComplete",
  );

  // Comportamiento: el evaluador resuelve el until real del workflow.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-loop-ws3-"));
  const runsDir = path.join(tmp, "runs");
  const yaml = `name: loop-dispositions
description: WS3
nodes:
  - id: build
    loop_group:
      max_iterations: 3
      until: "$review.output.green == true && $review.output.dispositionsComplete == true"
      nodes:
        - id: review
          prompt: "revisá"
          output_format:
            type: object
            properties:
              green: { type: boolean }
              dispositionsComplete: { type: boolean }
              findings:
                type: array
                items: { type: object }
            required: [green, findings, dispositionsComplete]
`;
  const outputs = [
    JSON.stringify({
      green: true,
      dispositionsComplete: false,
      findings: [{ id: "f1", severity: "info", message: "detalle abierto" }],
    }),
    JSON.stringify({
      green: true,
      dispositionsComplete: true,
      findings: [{ id: "f1", severity: "info", message: "detalle dispuesto" }],
    }),
  ];
  const log: string[] = [];
  let index = 0;
  const runner: AiNodeRunner = async () => {
    const output = outputs[Math.min(index, outputs.length - 1)];
    index += 1;
    log.push(output);
    return { output, sessionId: `s-${index}` };
  };
  try {
    const run = await runWorkflow(loadedLoop(yaml, tmp), {
      cwd: tmp,
      runsDir,
      aiRunner: runner,
    });
    assert.equal(run.status, "completed");
    assert.equal(
      log.length,
      2,
      "ronda 1 (verde sin disposiciones) NO corta; la ronda 2 sí",
    );
    const last = run.nodes["build.review"].outputJson as {
      dispositionsComplete?: boolean;
    };
    assert.equal(last.dispositionsComplete, true);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});
