/**
 * Loops (Fase 3a): until, until_bash, until_field, max_iterations, fresh_context y command.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-loop-"));
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

test("loop until: corta al ver el sentinel", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: loop-until
description: hasta
nodes:
  - id: work
    loop:
      prompt: "trabajá"
      max_iterations: 5
      until: DONE
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["working", "DONE"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.work.output, "DONE");
  assert.equal(log.length, 2);
});

test("loop max_iterations: corta por tope y completa con la última salida", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: loop-cap
description: tope
nodes:
  - id: work
    loop:
      prompt: "trabajá"
      max_iterations: 3
      until: NUNCA
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["working"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 3);
  assert.equal(run.nodes.work.output, "working");
});

test("loop until_bash: exit 0 corta la iteración", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: loop-bash
description: bash
nodes:
  - id: work
    loop:
      prompt: "trabajá"
      max_iterations: 4
      until_bash: |
        node -e "process.exit(0)"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["a", "b"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 1);
});

test("loop until_field: termina con booleano validado", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: loop-field
description: campo
nodes:
  - id: work
    output_format:
      type: object
      properties:
        done: { type: boolean }
    loop:
      prompt: "trabajá"
      max_iterations: 5
      until_field: done
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(['{"done":false}', '{"done":true}'], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 2);
  assert.deepEqual(run.nodes.work.outputJson, { done: true });
});

test("loop fresh_context: false reutiliza sesión, true no", async () => {
  const { tmp, runsDir } = sandbox();
  const sharedLog: AiNodeRequest[] = [];
  const sharedYaml = `name: loop-shared
description: sesión compartida
nodes:
  - id: work
    loop:
      prompt: "trabajá"
      max_iterations: 2
      until: NUNCA
`;
  await runWorkflow(loaded(sharedYaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["a", "b"], sharedLog),
  });
  assert.equal(sharedLog[0].sessionId, null);
  assert.equal(sharedLog[1].sessionId, "s-1");

  const { tmp: tmp2, runsDir: runsDir2 } = sandbox();
  const freshLog: AiNodeRequest[] = [];
  const freshYaml = `name: loop-fresh
description: sesión fresca
nodes:
  - id: work
    loop:
      prompt: "trabajá"
      max_iterations: 2
      until: NUNCA
      fresh_context: true
`;
  await runWorkflow(loaded(freshYaml, tmp2), {
    cwd: tmp2,
    runsDir: runsDir2,
    aiRunner: sequenceRunner(["a", "b"], freshLog),
  });
  assert.equal(freshLog[0].sessionId, null);
  assert.equal(freshLog[1].sessionId, null);
});

test("loop con command resuelve $LOOP_PREV_OUTPUT", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  fs.mkdirSync(path.join(tmp, "commands"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "commands", "iterate.md"),
    "Anterior: $LOOP_PREV_OUTPUT\n",
    "utf-8",
  );
  const yaml = `name: loop-command
description: command
nodes:
  - id: work
    loop:
      command: iterate
      max_iterations: 2
      until: NUNCA
`;
  await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["primera", "segunda"], log),
  });
  assert.equal(log[0].prompt, "Anterior: \n");
  assert.equal(log[1].prompt, "Anterior: primera\n");
});

test("schema: loop exige prompt XOR command y una condición", () => {
  const base = `name: bad
description: d
nodes:
  - id: work
    loop:
`;
  assert.throws(
    () =>
      parseWorkflowDefinition(
        `${base}      prompt: "a"\n      command: b\n      max_iterations: 2\n      until: X\n`,
        "t.yaml",
      ),
    /exactamente uno de prompt\|command/,
  );
  assert.throws(
    () =>
      parseWorkflowDefinition(
        `${base}      prompt: "a"\n      max_iterations: 2\n`,
        "t.yaml",
      ),
    /al menos uno de until/,
  );
  assert.throws(
    () =>
      parseWorkflowDefinition(
        `${base}      prompt: "a"\n      max_iterations: 2\n      until_field: done\n`,
        "t.yaml",
      ),
    /until_field requiere/,
  );
});

test("loop: node_session_attached lleva la iteración de cada ronda", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: loop-rounds
description: rondas
nodes:
  - id: work
    loop:
      prompt: "trabajá"
      max_iterations: 2
      until: NUNCA
`;
  let index = 0;
  const runner: AiNodeRunner = async (req) => {
    index += 1;
    const sid = `s-loop-${index}`;
    req.onSessionCreated?.(sid);
    return { output: `w${index}`, sessionId: sid };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed");
  const events = fs
    .readFileSync(path.join(runsDir, run.id, "events.jsonl"), "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        JSON.parse(line) as {
          type?: unknown;
          nodeId?: unknown;
          data?: { sessionId?: unknown; iteration?: unknown };
        },
    );
  const attached = events.filter(
    (event) =>
      event.type === "node_session_attached" && event.nodeId === "work",
  );
  assert.equal(attached.length, 2, "una sesión por ronda del loop");
  assert.equal(attached[0]?.data?.iteration, 1);
  assert.equal(attached[1]?.data?.iteration, 2);
});
