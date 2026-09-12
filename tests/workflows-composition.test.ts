/**
 * Composición (Fase 3c): include load-time, child workflows y fan_out.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-comp-"));
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

function writeRepoWorkflow(tmp: string, name: string, yaml: string): void {
  const dir = path.join(tmp, ".agents", "workflows", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "workflow.yaml"), yaml, "utf-8");
}

function echoRunner(log: AiNodeRequest[] = []): AiNodeRunner {
  return async (req) => {
    log.push(req);
    return { output: `echo:${req.prompt}`, sessionId: `s-${req.nodeId}` };
  };
}

test("include: expande con prefijo y remapea dependencias de consumidores", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  writeRepoWorkflow(
    tmp,
    "inner",
    `name: inner
description: interno
nodes:
  - id: a
    prompt: "A"
  - id: b
    depends_on: [a]
    prompt: "B"
`,
  );
  const yaml = `name: main
description: principal
nodes:
  - id: blk
    include: inner
  - id: after
    depends_on: [blk]
    prompt: "C"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner: echoRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes["blk__a"].status, "completed");
  assert.equal(run.nodes["blk__b"].status, "completed");
  assert.equal(run.nodes.after.status, "completed");
  const prompts = log.map((req) => req.prompt);
  assert.deepEqual(prompts, ["A", "B", "C"]);
});

test("include con with: inyecta overrides de $INPUTS", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  writeRepoWorkflow(
    tmp,
    "asker",
    `name: asker
description: pregunta
nodes:
  - id: ask
    prompt: "Pregunta: $INPUTS.tema"
`,
  );
  const yaml = `name: main-with
description: principal
nodes:
  - id: blk
    include: asker
    with:
      tema: auth
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner: echoRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log[0].prompt, "Pregunta: auth");
});

test("workflow child: corre en su propio run y devuelve returns", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  writeRepoWorkflow(
    tmp,
    "echo",
    `name: echo
description: eco
inputs:
  item:
    default: nada
returns: echo
nodes:
  - id: echo
    prompt: "eco: $INPUTS.item"
`,
  );
  const yaml = `name: parent
description: padre
nodes:
  - id: child
    workflow: echo
    with:
      item: x
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner: echoRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.child.output, "echo:eco: x");
  const runs = fs.readdirSync(runsDir).filter((entry) => !entry.startsWith("."));
  assert.equal(runs.length, 2);
});

test("fan_out: agrega salidas en orden con paralelismo acotado", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  writeRepoWorkflow(
    tmp,
    "echo2",
    `name: echo2
description: eco
inputs:
  item:
    default: nada
nodes:
  - id: echo
    prompt: "eco: $INPUTS.item"
`,
  );
  const yaml = `name: fan
description: fan out
inputs:
  list:
    default: [a, b, c]
nodes:
  - id: fan
    workflow: echo2
    fan_out:
      items: "$INPUTS.list"
      as: item
      max_parallel: 2
      join: all_success
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner: echoRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.deepEqual(run.nodes.fan.outputJson, [
    "echo:eco: a",
    "echo:eco: b",
    "echo:eco: c",
  ]);
  assert.equal(log.length, 3);
});

test("fan_out all_success: un hijo fallido falla el nodo", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "fragil",
    `name: fragil
description: fragil
inputs:
  item:
    default: nada
nodes:
  - id: work
    prompt: "eco: $INPUTS.item"
`,
  );
  const yaml = `name: fan-fail
description: fan out que falla
inputs:
  list:
    default: [ok, boom]
nodes:
  - id: fan
    workflow: fragil
    fan_out:
      items: "$INPUTS.list"
      as: item
      join: all_success
`;
  const aiRunner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("boom")) throw new Error("hijo roto");
    return { output: req.prompt };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner,
  });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.fan.error ?? "", /fan_out con hijo fallido/);
});

test("costos: los child runs suman al run padre", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "paid",
    `name: paid
description: con costo
nodes:
  - id: work
    prompt: "x"
`,
  );
  const yaml = `name: parent-cost
description: padre
nodes:
  - id: child
    workflow: paid
`;
  const aiRunner: AiNodeRunner = async () => ({
    output: "ok",
    costUsd: 0.25,
    usage: { inputTokens: 4, outputTokens: 2 },
  });
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner,
  });
  assert.equal(run.status, "completed");
  assert.equal(run.totals?.costUsd, 0.25);
  assert.equal(run.totals?.tokens?.input, 4);
  assert.equal(run.totals?.tokens?.output, 2);
});

test("workflow anidado: guarda de profundidad máxima", async () => {
  const { tmp, runsDir } = sandbox();
  writeRepoWorkflow(
    tmp,
    "selfie",
    `name: selfie
description: recursivo
nodes:
  - id: recurse
    workflow: selfie
`,
  );
  const yaml = `name: starter
description: arranque
nodes:
  - id: go
    workflow: selfie
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    repoRoot: tmp,
    aiRunner: echoRunner(),
  });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.go.error ?? "", /profundidad máxima/);
});
