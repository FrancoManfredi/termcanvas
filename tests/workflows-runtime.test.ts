/**
 * WorkflowRuntime (Fase 4a): runs en background, gates y cancelación.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntime } from "../headless-runtime/workflows/runtime.ts";
import { WorkflowRunStore } from "../headless-runtime/workflows/runStore.ts";
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
  assert.equal(finished.cwd, tmp, "cwd del run persistido para resume");
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

test("resumeInterrupted: reanuda un run huérfano persistido en `running`", async () => {
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
  // El proceso murió con el run `running`: la fila persiste pero nadie la
  // ejecuta. `resume` a secas la rechaza ("sigue activo").
  const store = new WorkflowRunStore(runsDir);
  const created = store.create({
    workflow: "quick",
    description: "",
    inputs: {},
    args: "",
    sourceDigest: "",
    sourcePath: "",
  });
  store.save({ ...created, status: "running" });
  const fresh = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  await assert.rejects(() => fresh.resume(created.id), /sigue activo/);
  const resumed = await fresh.resumeInterrupted(created.id);
  assert.equal(resumed.id, created.id);
  const finished = await waitFor(() => {
    const current = fresh.getRun(created.id);
    return current && current.status === "completed" ? current : null;
  });
  assert.equal(finished.nodes.a.output, "ok");
});

test("resumeInterrupted: workflow con input required se reanuda sin --input", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "gatedreq",
    `name: gatedreq
description: gate con input requerido
inputs:
  request:
    required: true
nodes:
  - id: gate
    approval:
      message: "¿Sigo?"
`,
  );
  // Run huérfano con su input ya validado al crear: al resumir NO debe
  // volver a exigirlo (bug: resolveInputs corría antes de leer el run).
  const store = new WorkflowRunStore(runsDir);
  const created = store.create({
    workflow: "gatedreq",
    description: "",
    inputs: { request: "pedido original" },
    args: "",
    sourceDigest: "",
    sourcePath: "",
  });
  store.save({ ...created, status: "running" });
  const fresh = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  await fresh.resumeInterrupted(created.id);
  const pending = await waitFor(() => fresh.getPending(created.id));
  assert.equal(pending.nodeId, "gate");
  fresh.respond(created.id, { decision: "approve", text: "ok" });
  const finished = await waitFor(() => {
    const current = fresh.getRun(created.id);
    return current && current.status === "completed" ? current : null;
  });
  assert.equal(finished.inputs.request, "pedido original");
});

test("resume: restaura el cwd persistido del run, no el cwd del daemon (run #125)", async () => {
  const { tmp, runsDir } = sandbox();
  const original = path.join(tmp, "repo-original");
  const otroProyecto = path.join(tmp, "otro-proyecto");
  fs.mkdirSync(original, { recursive: true });
  fs.mkdirSync(otroProyecto, { recursive: true });
  writeRepoWorkflow(
    tmp,
    "pwd",
    `name: pwd
description: cwd del nodo
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write(process.cwd())"
`,
  );
  // Run fallido creado con cwd original (como el run #125). El runtime que
  // resume corre en OTRO cwd (el del daemon): el persistido debe ganar.
  const store = new WorkflowRunStore(runsDir);
  const created = store.create({
    workflow: "pwd",
    description: "",
    inputs: {},
    args: "",
    sourceDigest: "",
    sourcePath: "",
  });
  store.save({ ...created, status: "failed", cwd: original });
  const fresh = new WorkflowRuntime({ repoRoot: tmp, cwd: otroProyecto, runsDir });
  await fresh.resume(created.id);
  const finished = await waitFor(() => {
    const current = fresh.getRun(created.id);
    return current && current.status === "completed" ? current : null;
  });
  const out = (finished.nodes.a.output ?? "").replace(/\\/g, "/");
  assert.ok(
    out.endsWith(original.replace(/\\/g, "/")),
    `el nodo corre en el cwd persistido, no en el del daemon: ${out}`,
  );
  assert.equal(finished.cwd, original, "run.cwd persistido tras resume");
});

test("getWorkflowNodeIds: orden real del DAG; desconocido → []", () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "ordered",
    `name: ordered
description: orden
nodes:
  - id: a
    bash: |
      node -e "process.stdout.write('a')"
  - id: b
    depends_on: [a]
    bash: |
      node -e "process.stdout.write('b')"
  - id: c
    depends_on: [b]
    bash: |
      node -e "process.stdout.write('c')"
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  assert.deepEqual(runtime.getWorkflowNodeIds("ordered"), ["a", "b", "c"]);
  assert.deepEqual(runtime.getWorkflowNodeIds("no-existe"), []);
});
