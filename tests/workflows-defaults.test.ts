/**
 * Defaults bundled (Fase 5): discovery, validación y corridas con runner stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverWorkflows, loadWorkflow } from "../headless-runtime/workflows/loader.ts";
import { runWorkflow } from "../headless-runtime/workflows/executor.ts";
import type { AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

const repoRoot = process.cwd();
const emptyGlobal = path.join(os.tmpdir(), "wf-defaults-empty-global");
fs.mkdirSync(emptyGlobal, { recursive: true });
process.env.TERMCANVAS_WORKFLOWS_DIR = emptyGlobal;

function sandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-defaults-"));
}

test("bundled: discovery y validación de los defaults", () => {
  const expected = [
    "smoke",
    "plan-approve-implement",
    "parallel-reviews",
    "review-lens",
    "fix-issue",
    "factory-default",
  ];
  const found = discoverWorkflows({ repoRoot, globalDir: emptyGlobal });
  for (const name of expected) {
    assert.ok(found.has(name), `falta el workflow bundled ${name}`);
  }
  for (const name of expected) {
    const loaded = loadWorkflow(name, { repoRoot, globalDir: emptyGlobal });
    assert.equal(loaded.def.name, name);
    assert.equal(loaded.scope, "bundled");
  }
});

test("plan-approve-implement: plan -> gate -> implement -> review", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("Armá un plan")) {
      return { output: '{"summary":"plan ok","steps":["a","b"]}' };
    }
    if (req.prompt.includes("Implementá el plan")) {
      return { output: "impl done" };
    }
    return { output: "OK" };
  };
  const run = await runWorkflow(
    loadWorkflow("plan-approve-implement", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: repoRoot,
      runsDir,
      repoRoot,
      inputs: { request: "arreglar login" },
      aiRunner: runner,
      onApproval: async () => ({ decision: "approve", text: "dale" }),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.plan.outputJson?.summary, "plan ok");
  assert.equal(run.nodes.gate.output, "dale");
  assert.equal(run.nodes.implement.output, "impl done");
  assert.equal(run.nodes.review.output, "OK");
});

test("parallel-reviews: fan_out de 3 lentes con child runs", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => ({
    output: JSON.stringify({ green: true, notes: `lente: ${req.prompt}` }),
  });
  const run = await runWorkflow(
    loadWorkflow("parallel-reviews", { repoRoot, globalDir: emptyGlobal }),
    { cwd: repoRoot, runsDir, repoRoot, aiRunner: runner },
  );
  assert.equal(run.status, "completed");
  const reviews = run.nodes.reviews.outputJson as unknown[];
  assert.equal(Array.isArray(reviews), true);
  assert.equal(reviews.length, 3);
  const runDirs = fs.readdirSync(runsDir).filter((entry) => entry.startsWith("run-"));
  assert.equal(runDirs.length, 4);
});

test("factory-default: pipeline migrado corre por el engine", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("Hacé el triage")) return { output: "triaje" };
    if (req.prompt.includes("Escribí una spec")) return { output: "spec" };
    if (req.prompt.includes("Verificá la implementación")) return { output: "PASS" };
    if (req.prompt.includes("Revisá la implementación")) {
      return { output: '{"green":true,"findings":""}' };
    }
    return { output: "impl" };
  };
  const run = await runWorkflow(
    loadWorkflow("factory-default", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: repoRoot,
      runsDir,
      repoRoot,
      inputs: { request: "arreglar login" },
      aiRunner: runner,
      onApproval: async () => ({ decision: "approve", text: "ok" }),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.triage.output, "triaje");
  assert.equal(run.nodes.approve.output, "ok");
  assert.equal(run.nodes.verify.output, "PASS");
  assert.deepEqual(run.nodes.review.outputJson, { green: true, findings: "" });
  assert.equal(run.result?.outcome, "succeeded");
  assert.ok(
    fs.existsSync(
      path.join(runsDir, run.id, "artifacts", "nodes", "verify.md"),
    ),
    "verify debe dejar evidencia sidecar",
  );
});

test("fix-issue: cadena triage -> implement -> review", async () => {
  const runsDir = path.join(sandbox(), "runs");
  const runner: AiNodeRunner = async (req) => ({
    output: req.prompt.includes("Analizá el issue") ? "triaje" : "hecho",
  });
  const run = await runWorkflow(
    loadWorkflow("fix-issue", { repoRoot, globalDir: emptyGlobal }),
    {
      cwd: repoRoot,
      runsDir,
      repoRoot,
      inputs: { issue: "botón roto" },
      aiRunner: runner,
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.triage.output, "triaje");
  assert.equal(run.nodes.review.output, "hecho");
});
