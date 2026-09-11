/**
 * Nodos IA (Fase 1): prompt/command con runner inyectado, sesiones y output_format.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWorkflow, type LoadedWorkflow } from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";
import type { AiNodeRequest, AiNodeResponse, AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";

function sandbox(): { tmp: string; runsDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ai-"));
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

function stubRunner(
  log: AiNodeRequest[],
  respond?: (req: AiNodeRequest) => AiNodeResponse,
): AiNodeRunner {
  return async (req) => {
    log.push(req);
    if (respond) return respond(req);
    return { output: `echo:${req.prompt}`, sessionId: `s-${req.nodeId}` };
  };
}

test("prompt: ejecuta el runner, guarda sesión y propaga modelo/effort", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-basic
description: nodo IA
provider: opencode
model: opencode-go/muse
effort: high
nodes:
  - id: think
    prompt: "Pensá: $ARGUMENTS"
    systemPrompt: "sos un planner"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    args: "el bug",
    aiRunner: stubRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.equal(run.nodes.think.output, "echo:Pensá: el bug");
  assert.equal(run.nodes.think.sessionId, "s-think");
  assert.equal(log[0].model, "opencode-go/muse");
  assert.equal(log[0].effort, "high");
  assert.equal(log[0].systemPrompt, "sos un planner");
  const events = fs
    .readFileSync(path.join(runsDir, run.id, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; nodeId?: string; data?: Record<string, unknown> });
  const completed = events.find((event) => event.type === "node_completed" && event.nodeId === "think");
  assert.equal(completed?.data?.sessionId, "s-think");
});

test("output_format + returns/outcome_field se resuelven con la salida IA", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-structured
description: structured output
returns: verdict
outcome_field: green
nodes:
  - id: verdict
    prompt: "evaluá"
    output_format:
      type: object
      properties:
        green: { type: boolean }
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: stubRunner(log, () => ({
      output: '{"green":true}',
      sessionId: "s-verdict",
    })),
  });
  assert.equal(run.status, "completed");
  assert.deepEqual(run.nodes.verdict.outputJson, { green: true });
  assert.equal(run.result?.outcome, "succeeded");
});

test("context shared y resume reutilizan la sesión del nodo upstream", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-sessions
description: sesiones
nodes:
  - id: first
    prompt: "uno"
  - id: shared
    depends_on: [first]
    prompt: "dos"
    context: shared
  - id: resumed
    depends_on: [shared]
    prompt: "tres"
    context:
      resume: first
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: stubRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log.find((req) => req.nodeId === "first")?.sessionId, null);
  assert.equal(log.find((req) => req.nodeId === "shared")?.sessionId, "s-first");
  assert.equal(log.find((req) => req.nodeId === "resumed")?.sessionId, "s-first");
});

test("context shared exige exactamente una dependencia", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-shared-bad
description: shared inválido
nodes:
  - id: a
    prompt: "a"
  - id: b
    prompt: "b"
  - id: c
    depends_on: [a, b]
    prompt: "c"
    context: shared
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: stubRunner(log),
  });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.c.error ?? "", /exactamente una dependencia/);
});

test("command: lee el Markdown del workflow, quita frontmatter y resuelve variables", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  fs.mkdirSync(path.join(tmp, "commands"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "commands", "review.md"),
    `---\ndescription: revisar\n---\nRevisá el cambio de $ARGUMENTS y respondé OK.\n`,
    "utf-8",
  );
  const yaml = `name: ai-command
description: command
nodes:
  - id: review
    command: review
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    args: "auth",
    aiRunner: stubRunner(log),
  });
  assert.equal(run.status, "completed");
  assert.equal(log[0].prompt, "Revisá el cambio de auth y respondé OK.\n");
});

test("command inexistente falla con mensaje claro", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: ai-command-missing
description: command faltante
nodes:
  - id: review
    command: nope
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: stubRunner([]),
  });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.review.error ?? "", /command "nope" no existe/);
});

test("fallo del runner IA marca el nodo y el run como failed", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: ai-fail
description: falla
nodes:
  - id: boom
    prompt: "explotá"
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: async () => {
      throw new Error("modelo caído");
    },
  });
  assert.equal(run.status, "failed");
  assert.match(run.nodes.boom.error ?? "", /modelo caído/);
});

test("reenvía capacidades y scope del nodo al runner", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-caps
description: capacidades
nodes:
  - id: capped
    prompt: "hola"
    skills: [code-review]
    mcp: mcp.json
    allowed_tools: [read, grep]
    denied_tools: [bash]
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: stubRunner(log),
  });
  assert.equal(run.status, "completed");
  const req = log[0];
  assert.deepEqual(req.skills, ["code-review"]);
  assert.equal(req.mcp, "mcp.json");
  assert.deepEqual(req.allowedTools, ["read", "grep"]);
  assert.deepEqual(req.deniedTools, ["bash"]);
  assert.equal(req.workflowDir, tmp);
  assert.equal(req.repoRoot, tmp);
  assert.ok(req.scopeDir.includes("scopes"));
});
