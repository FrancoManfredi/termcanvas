/**
 * Executor Fase 0: cadena, retry, fallas con trigger_rule, `when`, cancel y artefactos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWorkflow, type LoadedWorkflow } from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";
import { scriptExecEnv } from "../headless-runtime/workflows/nodes/deterministic.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-exec-"));
  return { tmp, runsDir: path.join(tmp, "runs") };
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

const chainYaml = `name: chain
description: cadena determinística
returns: status
outcome_field: green
nodes:
  - id: plan
    bash: |
      node -e "process.stdout.write('plan')"
  - id: impl
    depends_on: [plan]
    bash: |
      node -e "process.stdout.write('impl:' + '$plan.output')"
  - id: status
    depends_on: [impl]
    output_format:
      type: object
      properties:
        green: { type: boolean }
    bash: |
      node -e "process.stdout.write(JSON.stringify({green:'$impl.output'.includes('impl:')}))"
`;

test("cadena completa: outputs, result/outcome, artefactos y eventos", async () => {
  const { tmp, runsDir } = sandbox();
  const run = await runWorkflow(loaded(chainYaml, tmp), {
    cwd: tmp,
    runsDir,
    args: "demo",
  });

  assert.equal(run.status, "completed");
  assert.equal(run.nodes.plan.status, "completed");
  assert.equal(run.nodes.impl.output, "impl:plan");
  assert.deepEqual(run.nodes.status.outputJson, { green: true });
  assert.equal(run.result?.node, "status");
  assert.equal(run.result?.outcome, "succeeded");

  const artifacts = path.join(runsDir, run.id);
  assert.ok(fs.existsSync(path.join(artifacts, "run.json")));
  assert.ok(fs.existsSync(path.join(artifacts, "events.jsonl")));
  assert.ok(fs.existsSync(path.join(artifacts, "workflow-source", "workflow.yaml")));
  assert.equal(
    fs.readFileSync(path.join(artifacts, "artifacts", "nodes", "plan.out"), "utf-8"),
    "plan",
  );
  assert.ok(fs.existsSync(path.join(artifacts, "artifacts", "nodes", "status.json")));

  const events = fs
    .readFileSync(path.join(artifacts, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });
  const types = events.map((event) => event.type);
  assert.ok(types.includes("run_started"));
  assert.ok(types.includes("node_completed"));
  assert.ok(types.includes("run_completed"));
});

test("retry: reintenta y completa con on_error all", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: retry
description: reintento
nodes:
  - id: flaky
    retry:
      max_attempts: 2
      delay_ms: 1
      on_error: all
    bash: |
      node -e "const fs=require('fs');const f=process.env.ARTIFACTS_DIR+'/retry.txt';const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));if(n<1){process.exit(3)}process.stdout.write('ok-after-retry')"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.flaky.attempts, 2);
  assert.equal(run.nodes.flaky.output, "ok-after-retry");
});

test("falla: run failed, dependiente all_success skipped y all_done corre", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: failchain
description: falla y limpieza
nodes:
  - id: bad
    bash: |
      node -e "process.exit(2)"
  - id: blocked
    depends_on: [bad]
    bash: |
      node -e "process.stdout.write('never')"
  - id: cleanup
    depends_on: [bad]
    trigger_rule: all_done
    bash: |
      node -e "process.stdout.write('cleaned')"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "failed");
  assert.equal(run.nodes.bad.status, "failed");
  assert.equal(run.nodes.blocked.status, "skipped");
  assert.equal(run.nodes.cleanup.status, "completed");
  assert.equal(run.nodes.cleanup.output, "cleaned");
});

test("when: salta nodos según salida previa", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: whens
description: condiciones
nodes:
  - id: gate
    bash: |
      node -e "process.stdout.write('si')"
  - id: never
    depends_on: [gate]
    when: "$gate.output == 'no'"
    bash: |
      node -e "process.stdout.write('x')"
  - id: yes
    depends_on: [gate]
    when: "$gate.output == 'si'"
    bash: |
      node -e "process.stdout.write('y')"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.never.status, "skipped");
  assert.equal(run.nodes.yes.status, "completed");
});

test("cancel: corta el run con estado cancelled", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: cancelme
description: cancelación
nodes:
  - id: stop
    cancel: "no seguir"
  - id: after
    depends_on: [stop]
    bash: |
      node -e "process.stdout.write('nunca')"
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "cancelled");
  assert.equal(run.error, "no seguir");
  assert.equal(run.nodes.after, undefined);
});

test("wait: duerme y reporta", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: waits
description: espera
nodes:
  - id: pause
    wait:
      duration_ms: 5
`;
  const run = await runWorkflow(loaded(yaml, tmp), { cwd: tmp, runsDir });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.pause.output, "waited 5ms");
});

test("scriptExecEnv: bajo Electron fuerza ELECTRON_RUN_AS_NODE", () => {
  assert.equal(
    scriptExecEnv({ PATH: "x" }, false)?.ELECTRON_RUN_AS_NODE,
    undefined,
    "fuera de Electron el env queda intacto",
  );
  const electronEnv = scriptExecEnv({ PATH: "x" }, true);
  assert.equal(electronEnv?.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(electronEnv?.PATH, "x", "no pisa otras variables");
  assert.equal(scriptExecEnv(undefined, false), undefined, "undefined se preserva");
  assert.equal(
    scriptExecEnv(undefined, true)?.ELECTRON_RUN_AS_NODE,
    "1",
    "undefined + Electron igualmente setea la bandera",
  );
});
