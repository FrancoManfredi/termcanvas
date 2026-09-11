/**
 * WorkflowRuntime (Fase 4a): runs en background, gates y cancelación.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntime } from "../headless-runtime/workflows/runtime.ts";
import type { AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-runtime-"));
  return { tmp, runsDir: path.join(tmp, "runs") };
}

function writeRepoWorkflow(tmp: string, name: string, yaml: string): void {
  const dir = path.join(tmp, ".agents", "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yaml"), yaml, "utf-8");
}

async function waitFor<T>(
  fn: () => T | null | undefined,
  timeoutMs = 5_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const echoRunner: AiNodeRunner = async (req) => ({
  output: `echo:${req.prompt}`,
  sessionId: "s-runtime",
});

test("start: devuelve el run al instante y completa en background", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "quick",
    `name: quick
description: rápido
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write('ok')"
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir, aiRunner: echoRunner });
  const run = await runtime.start("quick");
  assert.equal(run.workflow, "quick");
  assert.ok(runtime.isActive(run.id));
  const finished = await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current && current.status === "completed" ? current : null;
  });
  assert.equal(finished.nodes.a.output, "ok");
  assert.equal(runtime.isActive(run.id), false);
});

test("gate: approve desde el runtime resuelve la espera", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "gated",
    `name: gated
description: gate
nodes:
  - id: gate
    approval:
      message: "¿Sigo?"
      capture_response: true
`,
  );
  const gates: string[] = [];
  const runtime = new WorkflowRuntime({
    repoRoot: tmp,
    cwd: tmp,
    runsDir,
    onGate: (request) => gates.push(request.nodeId),
  });
  const run = await runtime.start("gated");
  const pending = await waitFor(() => runtime.getPending(run.id));
  assert.equal(pending.nodeId, "gate");
  assert.equal(gates.length, 1);
  runtime.respond(run.id, { decision: "approve", text: "dale" });
  const finished = await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current && current.status === "completed" ? current : null;
  });
  assert.equal(finished.nodes.gate.output, "dale");
});

test("cancel: aborta el run activo y queda cancelled", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "sleeper",
    `name: sleeper
description: espera
nodes:
  - id: dormir
    wait:
      duration_ms: 60000
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  const run = await runtime.start("sleeper");
  await new Promise((resolve) => setTimeout(resolve, 50));
  runtime.cancel(run.id);
  const finished = await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current && current.status === "cancelled" ? current : null;
  });
  assert.equal(finished.error, "cancelado");
});

test("respond sin gate pendiente falla con mensaje claro", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "nogate",
    `name: nogate
description: sin gate
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write('x')"
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  const run = await runtime.start("nogate");
  assert.throws(
    () => runtime.respond(run.id, { decision: "approve" }),
    /no tiene gate pendiente/,
  );
  assert.throws(() => runtime.cancel("run-inexistente"), /no está activo/);
});
