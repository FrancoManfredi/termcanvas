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
  // WS1: la segunda ronda hereda el bloque anti-regresión además del previo.
  assert.ok(log[1].prompt.startsWith("prev=w1"), log[1].prompt);
  assert.match(log[1].prompt, /HISTORIAL DE RONDAS PREVIAS/);
  assert.match(log[1].prompt, /Ronda 1:[\s\S]*\[work\] w1/);
});

test("loop_group: history false apaga el bloque y $LOOP_HISTORY resuelve igual", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-history-off
description: sin historial
nodes:
  - id: grp
    loop_group:
      max_iterations: 2
      history: false
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: work
          prompt: "prev=$LOOP_PREV.work.output hist=$LOOP_HISTORY"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: sequenceRunner(["w1"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 2);
  assert.equal(log[0].prompt, "prev= hist=[]");
  assert.ok(log[1].prompt.startsWith("prev=w1 hist=["));
  assert.ok(!log[1].prompt.includes("HISTORIAL DE RONDAS PREVIAS"));
});

test("loop_group: el historial acumula rondas previas sin la actual", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-history
description: acumula
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
    aiRunner: sequenceRunner(["w1", "w2", "w3"], log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 3);
  assert.ok(!log[0].prompt.includes("HISTORIAL"), "ronda 1 sin historial");
  assert.match(log[1].prompt, /Ronda 1:[\s\S]*\[work\] w1/);
  assert.ok(!log[1].prompt.includes("Ronda 2:"), "la ronda actual no se incluye");
  assert.match(log[2].prompt, /Ronda 1:[\s\S]*\[work\] w1/);
  assert.match(log[2].prompt, /Ronda 2:[\s\S]*\[work\] w2/);
});

test("loop_group: reverify system-owned ejecuta solo la allowlist y viaja al historial", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-reverify
description: reverify
nodes:
  - id: grp
    loop_group:
      max_iterations: 2
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: work
          prompt: "trabajá"
        - id: review
          depends_on: [work]
          prompt: "revisá"
          output_format:
            type: object
            properties:
              findings:
                type: array
                items:
                  type: object
                  properties:
                    id: { type: string }
                    message: { type: string }
            required: [findings]
`;
  const outputs = [
    "w1",
    JSON.stringify({
      findings: [
        {
          id: "f1",
          message: "algo",
          reverify: {
            commands: ["git status --porcelain", "git restore ."],
            reason: "verificar",
          },
        },
      ],
    }),
    "w2",
    JSON.stringify({ findings: [] }),
  ];
  let index = 0;
  const runner: AiNodeRunner = async (req) => {
    log.push(req);
    const output = outputs[Math.min(index, outputs.length - 1)];
    index += 1;
    return { output, sessionId: "s-" + index };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed");
  assert.equal(log.length, 4, "dos rondas con dos nodos IA cada una");
  const round2 = log[2].prompt;
  assert.match(round2, /\[reverify system-owned\]/);
  assert.match(round2, /\$ git status --porcelain/);
  assert.match(round2, /ignorados \(fuera de allowlist\): git restore \./);
  assert.match(round2, /HISTORIAL DE RONDAS PREVIAS/);
});

test("loop_group: reverify false apaga la ejecución system-owned", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-reverify-off
description: sin reverify
nodes:
  - id: grp
    loop_group:
      max_iterations: 2
      reverify: false
      until_bash: |
        node -e "process.exit(1)"
      nodes:
        - id: work
          prompt: "trabajá"
        - id: review
          depends_on: [work]
          prompt: "revisá"
          output_format:
            type: object
            properties:
              findings:
                type: array
                items:
                  type: object
                  properties:
                    id: { type: string }
                    message: { type: string }
            required: [findings]
`;
  const outputs = [
    "w1",
    JSON.stringify({
      findings: [
        {
          id: "f1",
          message: "algo",
          reverify: { commands: ["git status --porcelain"], reason: "x" },
        },
      ],
    }),
    "w2",
    JSON.stringify({ findings: [] }),
  ];
  let index = 0;
  const runner: AiNodeRunner = async (req) => {
    log.push(req);
    const output = outputs[Math.min(index, outputs.length - 1)];
    index += 1;
    return { output, sessionId: "s-" + index };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed");
  assert.equal(log[2].prompt.includes("[reverify system-owned]"), false);
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

test("loop_group: node_session_attached lleva la iteración de cada ronda", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: group-rounds
description: rondas
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
  let index = 0;
  // Fake que emite el attach como el runner real (nodes/ai.ts): sesión
  // nueva por ronda del loop_group.
  const runner: AiNodeRunner = async (req) => {
    index += 1;
    const sid = `s-round-${index}`;
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
      event.type === "node_session_attached" && event.nodeId === "grp.work",
  );
  assert.equal(attached.length, 2, "una sesión por ronda del subnodo");
  assert.equal(attached[0]?.data?.iteration, 1);
  assert.equal(attached[1]?.data?.iteration, 2);
  assert.notEqual(
    attached[0]?.data?.sessionId,
    attached[1]?.data?.sessionId,
    "rondas distintas, sesiones distintas",
  );
  assert.equal(
    run.nodes["grp.work"].sessionId,
    attached[1]?.data?.sessionId,
    "run.json guarda solo la última ronda",
  );
});
