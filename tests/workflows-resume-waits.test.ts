/**
 * Fase 6b/6c: resume de runs y waits durables (until / event + signal).
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntime } from "../headless-runtime/workflows/runtime.ts";
import { runWorkflow, type LoadedWorkflow } from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-resume-"));
  return { tmp, runsDir: path.join(tmp, "runs") };
}

function writeRepoWorkflow(tmp: string, name: string, yaml: string): void {
  const dir = path.join(tmp, ".agents", "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yaml"), yaml, "utf-8");
}

function loaded(yaml: string, tmp: string): LoadedWorkflow {
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

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("resume: reusa el run, salta completados y reintenta el fallido", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "sticky",
    `name: sticky
description: reanudable
nodes:
  - id: a
    bash: |
      node -e "const fs=require('fs');const f=process.env.STATE_DIR+'/a.txt';const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));process.stdout.write('a')"
  - id: b
    depends_on: [a]
    bash: |
      node -e "const fs=require('fs');const f=process.env.STATE_DIR+'/ok';if(!fs.existsSync(f)){fs.writeFileSync(f,'x');process.exit(1)}process.stdout.write('b-ok')"
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  const run = await runtime.start("sticky");
  await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current?.status === "failed" ? current : null;
  });
  const counterPath = path.join(runsDir, run.id, "state", "a.txt");
  assert.equal(fs.readFileSync(counterPath, "utf-8"), "1");

  const resumed = await runtime.resume(run.id);
  assert.equal(resumed.id, run.id);
  const done = await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current?.status === "completed" ? current : null;
  });
  assert.equal(done.nodes.a.status, "completed");
  assert.equal(done.nodes.b.output, "b-ok");
  assert.equal(fs.readFileSync(counterPath, "utf-8"), "1");

  const events = fs
    .readFileSync(path.join(runsDir, run.id, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; nodeId?: string; data?: { reason?: string } });
  assert.ok(
    events.some(
      (event) =>
        event.type === "node_skipped" &&
        event.nodeId === "a" &&
        /resume/.test(event.data?.reason ?? ""),
    ),
  );
});

test("wait event: el runtime expone la espera y signal la resuelve", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "waiter",
    `name: waiter
description: espera evento
nodes:
  - id: gate
    wait:
      event: deploy
      deadline_ms: 5000
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  const run = await runtime.start("waiter");
  const pending = await waitFor(() => runtime.getPendingWait(run.id));
  assert.equal(pending.event, "deploy");
  runtime.signal(run.id, "deploy");
  const done = await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current?.status === "completed" ? current : null;
  });
  assert.equal(done.nodes.gate.output, "event deploy");
});

test("wait event: deadline vencido falla el nodo", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "timeout",
    `name: timeout
description: espera vencida
nodes:
  - id: gate
    wait:
      event: nunca
      deadline_ms: 60
`,
  );
  const runtime = new WorkflowRuntime({ repoRoot: tmp, cwd: tmp, runsDir });
  const run = await runtime.start("timeout");
  const failed = await waitFor(() => {
    const current = runtime.getRun(run.id);
    return current?.status === "failed" ? current : null;
  });
  assert.match(failed.nodes.gate.error ?? "", /expiró/);
});

test("wait until: duerme hasta el instante indicado", async () => {
  const { tmp, runsDir } = sandbox();
  const until = new Date(Date.now() + 40).toISOString();
  const yaml = `name: until
description: hasta
nodes:
  - id: espera
    wait:
      until: "${until}"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "completed");
  assert.match(run.nodes.espera.output ?? "", /waited until/);
});
