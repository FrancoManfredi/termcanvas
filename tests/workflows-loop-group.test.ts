/**
 * loop_group (Fase 3d): sub-DAG por iteración, $LOOP_PREV y condiciones.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWorkflow, type LoadedWorkflow } from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";
import type { AiNodeRequest, AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-group-"));
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

function sequenceRunner(outputs: string[], log: AiNodeRequest[] = []): AiNodeRunner {
  let index = 0;
  return async (req) => {
    log.push(req);
    const output = outputs[Math.min(index, outputs.length - 1)];
    index += 1;
    return { output, sessionId: `s-${index}` };
  };
}

test("loop_group: until_bash lee salidas del cuerpo y termina", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-bash
description: grupo
nodes:
  - id: grp
    loop_group:
      max_iterations: 4
      until_bash: |
        node -e "process.exit('$check.output' === 'green' ? 0 : 1)"
      nodes:
        - id: work
          prompt: "trabajá"
        - id: check
          depends_on: [work]
          bash: |
            node -e "process.stdout.write('$work.output'.includes('w2') ? 'green' : 'red')"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["w1", "w2"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 2);
  assert.equal(run.nodes["grp.check"].output, "green");
  assert.equal(run.nodes.grp.output, "green");
});

test("loop_group: $LOOP_PREV vacío en la primera iteración y disponible después", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-prev
description: previo
nodes:
  - id: grp
    loop_group:
      max_iterations: 2
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: work
          prompt: "prev=$LOOP_PREV.work.output"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["w1"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 2);
  assert.equal(log[0].prompt, "prev=");
  assert.equal(log[1].prompt, "prev=w1");
});

test("loop_group: falla el grupo si un nodo del cuerpo falla", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: group-fail
description: falla
nodes:
  - id: grp
    loop_group:
      max_iterations: 2
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: bad
          bash: |
            node -e "process.exit(3)"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["nunca"]),
  });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.grp.error ?? "", /loop_group: nodo "bad" falló/);
});

test("loop_group: suma costos y tokens de los nodos IA al run", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: group-cost
description: costos
nodes:
  - id: grp
    loop_group:
      max_iterations: 2
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: work
          prompt: "trabajá"
`;
  const runner: AiNodeRunner = async () => ({
    output: "w",
    costUsd: 0.1,
    usage: { inputTokens: 3, outputTokens: 1 },
  });
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed");
  assert.equal(run.totals?.costUsd, 0.2);
  assert.equal(run.totals?.tokens?.input, 6);
  assert.equal(run.nodes.grp.costUsd, 0.2);
});

test("loop_group: respeta max_iterations", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-cap
description: tope
nodes:
  - id: grp
    loop_group:
      max_iterations: 3
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: work
          prompt: "trabajá"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["w"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 3);
});
