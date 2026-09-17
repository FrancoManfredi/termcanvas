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

interface RecordedEvent {
  type: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

function readEvents(runsDir: string, runId: string): RecordedEvent[] {
  return fs
    .readFileSync(path.join(runsDir, runId, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RecordedEvent);
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

test("output_format: extrae JSON embebido en prosa y fences", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: ai-loose
description: json tolerante
nodes:
  - id: verdict
    prompt: "evaluá"
    output_format:
      type: object
      properties:
        green: { type: boolean }
`;
  const runner: AiNodeRunner = async () => ({
    output: 'Acá va el veredicto:\n```json\n{"green": true}\n```\nlisto.',
  });
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed");
  assert.deepEqual(run.nodes.verdict.outputJson, { green: true });
});

test("output_format: review con código citado + findings anidados elige el objeto externo (run review)", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: ai-review-nested
description: review anidado como plan-approve-implement
nodes:
  - id: build
    loop_group:
      max_iterations: 3
      until: "$review.output.green == true"
      nodes:
        - id: review
          prompt: "revisá"
          output_format:
            type: object
            properties:
              green: { type: boolean }
              findings:
                type: array
                items:
                  type: object
                  properties:
                    id: { type: string }
                    message: { type: string }
                    reverify:
                      type: object
                      properties:
                        commands:
                          type: array
                          items: { type: string }
                        reason: { type: string }
                      required: [commands, reason]
                  required: [id, message]
            required: [green, findings]
`;
  // Texto vivo: prosa + fence de JavaScript citado + fence JSON final con un
  // finding que trae `reverify` anidado. El extractor viejo devolvía el
  // `reverify` interno y la validación moría con "falta green".
  const reviewText = [
    "Let me carefully review the implementation.",
    "",
    "```javascript",
    "listElement.addEventListener('click', function (event) {",
    "  var ok = global.confirm('Delete?');",
    "  if (!ok) return;",
    "});",
    "```",
    "",
    "```json",
    JSON.stringify({
      green: true,
      findings: [
        {
          id: "f1",
          message: "sin cobertura automatizada del cancel",
          reverify: {
            commands: ["git diff --stat"],
            reason: "confirmar que solo cambió app.js",
          },
        },
      ],
    }),
    "```",
  ].join("\n");
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: async () => ({ output: reviewText }),
  });
  assert.equal(run.status, "completed", run.error ?? "");
  const parsed = run.nodes["build.review"].outputJson as {
    green?: unknown;
    findings?: unknown;
  };
  assert.equal(parsed.green, true, "extrae el objeto externo, no el reverify");
  assert.ok(Array.isArray(parsed.findings));
  assert.equal((parsed.findings as Array<{ id: string }>)[0].id, "f1");
});

test("totales: agrega costos y tokens de los nodos", async () => {
  const { tmp, runsDir } = sandbox();
  const yaml = `name: totals
description: totales
nodes:
  - id: a
    prompt: "a"
  - id: b
    depends_on: [a]
    prompt: "b"
`;
  const runner: AiNodeRunner = async (req) => ({
    output: "ok",
    sessionId: `s-${req.nodeId}`,
    costUsd: 0.1,
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed");
  assert.equal(run.totals?.costUsd, 0.2);
  assert.deepEqual(run.totals?.tokens, {
    input: 20,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("reenvía capacidades y scope del nodo al runner", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-caps
description: capacidades
nodes:
  - id: capped
    prompt: "hola"
    agent: reviewer
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
  assert.equal(req.agent, "reviewer");
  assert.deepEqual(req.skills, ["code-review"]);
  assert.equal(req.mcp, "mcp.json");
  assert.deepEqual(req.allowedTools, ["read", "grep"]);
  assert.deepEqual(req.deniedTools, ["bash"]);
  assert.equal(req.workflowDir, tmp);
  assert.equal(req.repoRoot, tmp);
  assert.ok(req.scopeDir.includes("scopes"));
});

test("output_format: la reparación manda un turno extra en la misma sesión", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-repair
description: reparación de formato
nodes:
  - id: plan
    prompt: "planificá"
    output_format:
      type: object
      properties:
        summary: { type: string }
      required: [summary]
`;
  const runner: AiNodeRunner = async (req) => {
    log.push(req);
    // El runner real avisa la sesión resuelta antes de enviar el turno
    // (nodes/ai.ts): acá se emula para verificar el filtrado silencioso.
    req.onSessionCreated?.("s-fixed");
    if (log.length === 1) {
      return {
        output: "## Plan\n\nSin JSON en la respuesta.",
        sessionId: "s-fixed",
        costUsd: 0.25,
        usage: { inputTokens: 10, outputTokens: 4 },
      };
    }
    return {
      output: '{"summary":"ok"}',
      sessionId: "s-fixed",
      costUsd: 0.5,
      usage: { inputTokens: 6, outputTokens: 2 },
    };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed", run.error ?? "");
  assert.equal(
    (run.nodes.plan.outputJson as { summary?: string }).summary,
    "ok",
  );
  assert.equal(run.nodes.plan.output, '{"summary":"ok"}');
  assert.equal(log.length, 2);
  assert.ok(log[1].prompt.includes("REPARACIÓN DE FORMATO"));
  assert.equal(log[1].sessionId, "s-fixed");
  // La contabilidad suma ambos turnos, no pisa el usage/costo del primero.
  assert.equal(run.nodes.plan.costUsd, 0.75);
  assert.deepEqual(run.nodes.plan.usage, {
    inputTokens: 16,
    outputTokens: 6,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  // El turno reparador reutiliza la sesión ya emitida: no duplica la fila
  // de Agent Sessions.
  const attached = readEvents(runsDir, run.id).filter(
    (event) => event.type === "node_session_attached" && event.nodeId === "plan",
  );
  assert.equal(attached.length, 1);
});

test("output_format: si la reparación tampoco parsea, falla con el error original", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-repair-fail
description: reparación fallida
nodes:
  - id: plan
    prompt: "planificá"
    output_format:
      type: object
      properties:
        summary: { type: string }
      required: [summary]
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: async (req) => {
      log.push(req);
      return { output: "solo prosa, sin JSON", sessionId: "s-fixed" };
    },
  });
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /output no contiene JSON válido/);
  // Exactamente dos llamadas: una original y una de reparación, sin retry.
  assert.equal(log.length, 2);
});

test("output_format: JSON válido a la primera no dispara reparación", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-repair-happy
description: sin reparación
nodes:
  - id: plan
    prompt: "planificá"
    output_format:
      type: object
      properties:
        summary: { type: string }
      required: [summary]
`;
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: async (req) => {
      log.push(req);
      return { output: '{"summary":"ok"}', sessionId: "s-happy" };
    },
  });
  assert.equal(run.status, "completed", run.error ?? "");
  assert.deepEqual(run.nodes.plan.outputJson, { summary: "ok" });
  assert.equal(log.length, 1);
});

test("output_format: schema inválido se repara con un segundo turno", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: ai-repair-schema
description: reparación de schema
nodes:
  - id: plan
    prompt: "planificá"
    output_format:
      type: object
      properties:
        summary: { type: string }
      required: [summary]
`;
  const runner: AiNodeRunner = async (req) => {
    log.push(req);
    if (log.length === 1) {
      return { output: '{"summary":42}', sessionId: "s-schema" };
    }
    return { output: '{"summary":"ok"}', sessionId: "s-schema" };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed", run.error ?? "");
  assert.deepEqual(run.nodes.plan.outputJson, { summary: "ok" });
  assert.equal(log.length, 2);
});

test("loop_group: el sub-nodo repara formato con un turno extra", async () => {
  const { tmp, runsDir } = sandbox();
  const log: AiNodeRequest[] = [];
  const yaml = `name: group-repair
description: reparación en loop_group
nodes:
  - id: grp
    loop_group:
      max_iterations: 1
      nodes:
        - id: review
          prompt: "revisá"
          output_format:
            type: object
            properties:
              green: { type: boolean }
            required: [green]
`;
  const runner: AiNodeRunner = async (req) => {
    log.push(req);
    // El runner real avisa la sesión resuelta antes de enviar el turno
    // (nodes/ai.ts): acá se emula para verificar el filtrado silencioso.
    req.onSessionCreated?.("s-group");
    if (log.length === 1) {
      return {
        output: "revisión en prosa, sin JSON",
        sessionId: "s-group",
        costUsd: 0.25,
        usage: { inputTokens: 4, outputTokens: 1 },
      };
    }
    return {
      output: '{"green":true}',
      sessionId: "s-group",
      costUsd: 0.5,
      usage: { inputTokens: 2, outputTokens: 1 },
    };
  };
  const run = await runWorkflow(loaded(yaml, tmp), {
    cwd: tmp,
    runsDir,
    aiRunner: runner,
  });
  assert.equal(run.status, "completed", run.error ?? "");
  assert.equal(run.nodes["grp.review"].status, "completed");
  assert.deepEqual(run.nodes["grp.review"].outputJson, { green: true });
  assert.equal(log.length, 2);
  assert.ok(log[1].prompt.includes("REPARACIÓN DE FORMATO"));
  assert.equal(log[1].sessionId, "s-group");
  // La contabilidad del grupo suma ambos turnos.
  assert.equal(run.nodes.grp.costUsd, 0.75);
  assert.equal(run.totals?.tokens?.input, 6);
  // El nodo del grupo queda persistido una sola vez por ronda (sin duplicar
  // la sesión en Agent Sessions).
  const attached = readEvents(runsDir, run.id).filter(
    (event) =>
      event.type === "node_session_attached" && event.nodeId === "grp.review",
  );
  assert.equal(attached.length, 1);
});
