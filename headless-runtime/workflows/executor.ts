/**
 * Executor del workflow: capas topológicas, nodos en paralelo por capa,
 * retry, `when`, `trigger_rule`, artefactos y transcript de eventos.
 *
 * Fase 0: bash/script/wait/cancel. Los demás bodies fallan con la fase en que llegan.
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkflowDefinition, WorkflowNode } from "./schema";
import type {
  NodeState,
  NodeExecutionResult,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowRun,
} from "./types";
import {
  NodeCancelSignal,
  NodeExecutionError,
  WorkflowValidationError,
} from "./errors";
import { buildLayers, evaluateTriggerRule, evaluateWhen, validateWorkflow } from "./graph";
import { resolveTemplate, resolveValue, type VarContext } from "./variables";
import { redactSecrets, RunArtifacts } from "./artifacts";
import { WorkflowRunStore } from "./runStore";
import {
  executeBash,
  executeCancel,
  executeScript,
  executeWait,
  type NodeRunContext,
} from "./nodes/deterministic";
import { createOpencodeAiRunner, type AiNodeRunner } from "./nodes/ai";
import { runShellCommand } from "./nodes/shell";

export interface LoadedWorkflow {
  def: WorkflowDefinition;
  sourcePath: string;
  source: string;
  digest: string;
  dir: string;
}

export interface ApprovalRequest {
  runId: string;
  nodeId: string;
  message: string;
  decisions: string[];
  attempt: number;
}

export interface ApprovalResponse {
  decision: string;
  text?: string;
}

export interface RunWorkflowOptions {
  cwd: string;
  runsDir: string;
  inputs?: Record<string, unknown>;
  args?: string;
  env?: NodeJS.ProcessEnv;
  onEvent?: (event: WorkflowEvent) => void;
  signal?: AbortSignal;
  /** Runner IA inyectable (tests); default: OpenCode embebido. */
  aiRunner?: AiNodeRunner;
  /** Raíz del proyecto para resolver skills (default: cwd). */
  repoRoot?: string;
  /** Handler de gates humanos. Sin handler, un gate falla el nodo. */
  onApproval?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
}

const PHASE_BY_BODY: Record<string, string> = {
  loop_group: "Fase 3",
  include: "Fase 3",
  workflow: "Fase 3",
};

function nowIso(): string {
  return new Date().toISOString();
}

function isTransient(message: string): boolean {
  return /timeout|ECONNRESET|EPIPE|ETIMEDOUT|rate.?limit|429|\b5\d\d\b/i.test(
    message,
  );
}

function resolveInputs(
  def: WorkflowDefinition,
  provided: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(def.inputs)) {
    const value = provided?.[name];
    if (value !== undefined) {
      inputs[name] = value;
    } else if (spec.default !== undefined) {
      inputs[name] = spec.default;
    } else if (spec.required) {
      throw new WorkflowValidationError(
        `input requerido "${name}" no provisto (usar --input ${name}=<valor>)`,
      );
    }
  }
  for (const key of Object.keys(provided ?? {})) {
    if (!(key in def.inputs)) {
      throw new WorkflowValidationError(`input desconocido "${key}"`);
    }
  }
  return inputs;
}

/** Lee un command Markdown del workflow (<dir>/commands/<name>.md) sin frontmatter. */
function readCommandFile(loaded: LoadedWorkflow, name: string): string {
  const filePath = path.join(loaded.dir, "commands", `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new WorkflowValidationError(
      `command "${name}" no existe: ${filePath}`,
    );
  }
  const text = fs.readFileSync(filePath, "utf-8");
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text : text.slice(end + 4).replace(/^\r?\n/, "");
}

export async function runWorkflow(
  loaded: LoadedWorkflow,
  opts: RunWorkflowOptions,
): Promise<WorkflowRun> {
  const def = loaded.def;
  validateWorkflow(def);
  const inputs = resolveInputs(def, opts.inputs);
  const store = new WorkflowRunStore(opts.runsDir);
  const run = store.create({
    workflow: def.name,
    description: def.description,
    inputs,
    args: opts.args ?? "",
    sourceDigest: loaded.digest,
    sourcePath: loaded.sourcePath,
  });
  const artifacts: RunArtifacts = store.artifactsFor(run.id);
  const frozenDir = path.join(artifacts.runDir, "workflow-source");
  fs.mkdirSync(frozenDir, { recursive: true });
  if (fs.existsSync(loaded.sourcePath)) {
    fs.copyFileSync(loaded.sourcePath, path.join(frozenDir, "workflow.yaml"));
  } else {
    fs.writeFileSync(path.join(frozenDir, "workflow.yaml"), loaded.source, "utf-8");
  }

  const emit = (type: WorkflowEventType, nodeId?: string, data?: Record<string, unknown>) => {
    const event: WorkflowEvent = {
      ts: nowIso(),
      type,
      runId: run.id,
      workflow: def.name,
      ...(nodeId ? { nodeId } : {}),
      ...(data ? { data } : {}),
    };
    artifacts.appendEvent(event);
    opts.onEvent?.(event);
  };

  const graph = buildLayers(def.nodes);
  let cancelledReason: string | null = null;
  run.status = "running";
  store.save(run);
  emit("run_started", undefined, { nodes: def.nodes.length, args: run.args });

  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  const aiRunner = opts.aiRunner ?? createOpencodeAiRunner();

  const resolveNodeSession = (node: WorkflowNode): string | null => {
    const context = node.context;
    if (context === "shared") {
      const deps = graph.directDeps.get(node.id) ?? [];
      if (deps.length !== 1) {
        throw new NodeExecutionError(
          node.id,
          "context: shared requiere exactamente una dependencia",
        );
      }
      const sessionId = run.nodes[deps[0]]?.sessionId;
      if (!sessionId) {
        throw new NodeExecutionError(
          node.id,
          `context: shared: "${deps[0]}" no tiene sesión`,
        );
      }
      return sessionId;
    }
    if (context && typeof context === "object" && "resume" in context) {
      const sessionId = run.nodes[context.resume]?.sessionId;
      if (!sessionId) {
        throw new NodeExecutionError(
          node.id,
          `context.resume: "${context.resume}" no tiene sesión`,
        );
      }
      return sessionId;
    }
    return null;
  };

  const runAiNode = (
    node: WorkflowNode,
    prompt: string,
    sessionOverride?: string | null,
  ): Promise<NodeExecutionResult> =>
    aiRunner({
      runId: run.id,
      nodeId: node.id,
      cwd: opts.cwd,
      prompt,
      model: node.model ?? def.model,
      effort: node.effort ?? def.effort,
      systemPrompt: node.systemPrompt,
      outputFormat: node.output_format,
      timeoutMs: node.timeout,
      signal: opts.signal,
      sessionId:
        sessionOverride !== undefined
          ? sessionOverride
          : resolveNodeSession(node),
      skills: node.skills,
      mcp: node.mcp,
      allowedTools: node.allowed_tools,
      deniedTools: node.denied_tools,
      repoRoot: opts.repoRoot ?? opts.cwd,
      workflowDir: loaded.dir,
      scopeDir: path.join(artifacts.artifactsDir, "scopes", node.id),
    });

  const executeLoop = async (
    node: WorkflowNode,
    varCtx: VarContext,
  ): Promise<NodeExecutionResult> => {
    const loop = node.loop;
    if (!loop) throw new NodeExecutionError(node.id, "nodo loop sin body");
    let prevOutput = "";
    let sessionId = resolveNodeSession(node);
    let lastResult: NodeExecutionResult = { output: "" };
    for (let iteration = 1; iteration <= loop.max_iterations; iteration += 1) {
      const iterationVars: VarContext = { ...varCtx, loopPrevOutput: prevOutput };
      const promptSource =
        loop.prompt !== undefined
          ? loop.prompt
          : readCommandFile(loaded, loop.command ?? "");
      const prompt = resolveTemplate(promptSource, iterationVars);
      const result = await runAiNode(
        node,
        prompt,
        loop.fresh_context ? null : sessionId,
      );
      lastResult = result;
      if (!loop.fresh_context && result.sessionId) sessionId = result.sessionId;
      let outputJson = result.outputJson;
      if (outputJson === undefined && node.output_format) {
        try {
          outputJson = JSON.parse(result.output);
        } catch {
          outputJson = undefined;
        }
      }
      if (outputJson !== undefined) lastResult.outputJson = outputJson;
      prevOutput = result.output;

      const untilHit = loop.until ? result.output.includes(loop.until) : false;
      let fieldHit = false;
      if (loop.until_field) {
        const record = outputJson as Record<string, unknown> | undefined;
        fieldHit = record?.[loop.until_field] === true;
      }
      let bashHit = false;
      if (loop.until_bash) {
        const command = resolveTemplate(loop.until_bash, iterationVars);
        const shellResult = await runShellCommand(command, {
          cwd: opts.cwd,
          env: {
            ...baseEnv,
            ARTIFACTS_DIR: artifacts.artifactsDir,
            STATE_DIR: artifacts.stateDir,
            LOOP_PREV_OUTPUT: result.output,
          },
          timeoutMs: 60_000,
          signal: opts.signal,
        });
        bashHit = shellResult.exitCode === 0;
      }
      if (untilHit || fieldHit || bashHit) break;
    }
    return lastResult;
  };

  const buildVarCtx = (): VarContext => ({
    args: run.args,
    inputs,
    nodes: run.nodes,
    artifactsDir: artifacts.artifactsDir,
    stateDir: artifacts.stateDir,
    workflowName: def.name,
    runId: run.id,
  });

  const evalCtx = {
    resolveExpression: (expr: string) => resolveValue(expr, buildVarCtx()),
  };

  const executeApproval = async (
    node: WorkflowNode,
    varCtx: VarContext,
  ): Promise<NodeExecutionResult> => {
    const approval = node.approval;
    if (!approval) throw new NodeExecutionError(node.id, "nodo approval sin body");
    if (!opts.onApproval) {
      throw new NodeExecutionError(
        node.id,
        "gate sin handler de aprobación (onApproval); no se puede resolver desatendido",
      );
    }
    const decisions = approval.decisions ?? ["approve", "reject"];
    const maxAttempts = approval.on_reject?.max_attempts ?? 1;
    let rejectionReason = "";
    let attempt = 0;
    let reworkSession: string | null = null;
    for (;;) {
      attempt += 1;
      const message = resolveTemplate(approval.message, {
        ...varCtx,
        rejectionReason,
      });
      const response = await opts.onApproval({
        runId: run.id,
        nodeId: node.id,
        message,
        decisions,
        attempt,
      });
      const decision =
        typeof response?.decision === "string" ? response.decision : "";
      if (!decisions.includes(decision)) {
        throw new NodeExecutionError(
          node.id,
          `decisión inválida "${decision}" (válidas: ${decisions.join(", ")})`,
        );
      }
      if (decision !== "reject") {
        const text = response.text ?? "";
        const output = approval.capture_response ? text || decision : decision;
        return { output, outputJson: { decision, text } };
      }
      rejectionReason = response.text ?? "";
      if (!approval.on_reject) {
        throw new NodeCancelSignal(
          node.id,
          rejectionReason ? `gate rechazado: ${rejectionReason}` : "gate rechazado",
        );
      }
      if (attempt >= maxAttempts) {
        throw new NodeExecutionError(
          node.id,
          `gate rechazado tras ${attempt} intento(s)${
            rejectionReason ? `: ${rejectionReason}` : ""
          }`,
        );
      }
      const reworkPrompt = resolveTemplate(approval.on_reject.prompt, {
        ...varCtx,
        rejectionReason,
      });
      const rework = await runAiNode(node, reworkPrompt, reworkSession);
      if (rework.sessionId) reworkSession = rework.sessionId;
    }
  };

  const executeBody = (
    node: WorkflowNode,
    varCtx: VarContext,
  ): Promise<NodeExecutionResult> => {
    const nodeEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      ARTIFACTS_DIR: artifacts.artifactsDir,
      STATE_DIR: artifacts.stateDir,
      ARGUMENTS: run.args,
    };
    const nodeCtx: NodeRunContext = {
      nodeId: node.id,
      cwd: opts.cwd,
      env: nodeEnv,
      timeoutMs: node.timeout,
      signal: opts.signal,
      artifactsDir: artifacts.artifactsDir,
      stateDir: artifacts.stateDir,
    };
    if (node.prompt !== undefined) {
      return runAiNode(node, resolveTemplate(node.prompt, varCtx));
    }
    if (node.command !== undefined) {
      const commandText = readCommandFile(loaded, node.command);
      return runAiNode(node, resolveTemplate(commandText, varCtx));
    }
    if (node.loop !== undefined) {
      return executeLoop(node, varCtx);
    }
    if (node.approval !== undefined) {
      return executeApproval(node, varCtx);
    }
    if (node.bash !== undefined) {
      return executeBash(resolveTemplate(node.bash, varCtx), nodeCtx);
    }
    if (node.script !== undefined) {
      const code = resolveTemplate(node.script.code, varCtx);
      const scriptEnv: NodeJS.ProcessEnv = { ...nodeEnv };
      for (const [key, value] of Object.entries(node.with ?? {})) {
        scriptEnv[`INPUTS_${key.toUpperCase().replace(/-/g, "_")}`] = String(
          resolveValue(value, varCtx),
        );
      }
      return executeScript(
        { code, runtime: node.script.runtime },
        { ...nodeCtx, env: scriptEnv },
      );
    }
    if (node.wait !== undefined) return executeWait(node.wait, nodeCtx);
    if (node.cancel !== undefined) {
      return Promise.resolve(executeCancel(resolveTemplate(node.cancel, varCtx), nodeCtx));
    }
    const body = Object.keys(PHASE_BY_BODY).find(
      (key) => (node as unknown as Record<string, unknown>)[key] !== undefined,
    );
    const phase = body ? PHASE_BY_BODY[body] : "una fase futura";
    return Promise.reject(
      new NodeExecutionError(
        node.id,
        `nodo "${body ?? "desconocido"}" aún no implementado (llega en ${phase})`,
      ),
    );
  };

  const executeNode = async (node: WorkflowNode): Promise<void> => {
    if (cancelledReason || opts.signal?.aborted) return;
    const states = run.nodes;

    if (node.when) {
      const original = states[node.id];
      let whenTrue = false;
      try {
        whenTrue = evaluateWhen(node.when, evalCtx);
      } catch {
        whenTrue = false;
      }
      if (!whenTrue) {
        states[node.id] = {
          id: node.id,
          status: "skipped",
          attempts: 0,
          skipReason: `when: ${node.when}`,
        };
        emit("node_skipped", node.id, { reason: states[node.id].skipReason });
        store.save(run);
        return;
      }
      if (original?.status === "skipped") delete states[node.id];
    }

    const deps = graph.directDeps.get(node.id) ?? [];
    const trigger = evaluateTriggerRule(node.trigger_rule, deps, states);
    if (!trigger.run) {
      states[node.id] = {
        id: node.id,
        status: "skipped",
        attempts: 0,
        skipReason: trigger.skipReason,
      };
      emit("node_skipped", node.id, { reason: trigger.skipReason });
      store.save(run);
      return;
    }

    const maxAttempts = node.retry?.max_attempts ?? 1;
    const retryDelay = node.retry?.delay_ms ?? 1_000;
    const retryMode = node.retry?.on_error ?? "transient";
    const state: NodeState = {
      id: node.id,
      status: "running",
      attempts: 0,
      startedAt: nowIso(),
    };
    states[node.id] = state;
    emit("node_started", node.id);
    store.save(run);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      state.attempts = attempt;
      try {
        const result = await executeBody(node, buildVarCtx());
        state.status = "completed";
        state.finishedAt = nowIso();
        state.output = result.output;
        if (result.outputJson !== undefined) {
          state.outputJson = result.outputJson;
        } else if (node.output_format) {
          try {
            state.outputJson = JSON.parse(result.output);
          } catch {
            throw new NodeExecutionError(
              node.id,
              "output no es JSON válido y el nodo declara output_format",
            );
          }
        }
        artifacts.writeNodeOutput(node.id, result.output);
        if (state.outputJson !== undefined) {
          artifacts.writeNodeStructured(node.id, state.outputJson);
        }
        if (result.sessionId) state.sessionId = result.sessionId;
        if (result.usage) state.usage = result.usage;
        if (typeof result.costUsd === "number") state.costUsd = result.costUsd;
        if (node.output_type) {
          artifacts.writeNodeSidecar(node.id, node.output_type, result.output);
        }
        emit("node_completed", node.id, {
          attempts: attempt,
          outputPreview: redactSecrets(result.output.slice(0, 4_000)),
          sessionId: result.sessionId,
          costUsd: result.costUsd,
        });
        store.save(run);
        return;
      } catch (error) {
        if (error instanceof NodeCancelSignal) {
          state.status = "cancelled";
          state.finishedAt = nowIso();
          state.error = error.message;
          cancelledReason = error.message;
          emit("node_failed", node.id, { cancelled: true, reason: error.message });
          store.save(run);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const canRetry =
          attempt < maxAttempts &&
          (retryMode === "all" || isTransient(message));
        if (canRetry) {
          emit("node_retry", node.id, { attempt, error: redactSecrets(message) });
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        state.status = "failed";
        state.finishedAt = nowIso();
        state.error = message;
        emit("node_failed", node.id, { error: redactSecrets(message) });
        store.save(run);
        return;
      }
    }
  };

  for (const layer of graph.layers) {
    if (cancelledReason || opts.signal?.aborted) break;
    await Promise.all(
      layer.map((nodeId) => {
        const node = graph.byId.get(nodeId);
        return node ? executeNode(node) : Promise.resolve();
      }),
    );
  }

  const failedNode = Object.values(run.nodes).find(
    (state) => state.status === "failed",
  );
  if (cancelledReason) {
    run.status = "cancelled";
    run.error = cancelledReason;
  } else if (failedNode) {
    run.status = "failed";
    run.error = `nodo "${failedNode.id}": ${failedNode.error ?? "error"}`;
  } else {
    run.status = "completed";
  }
  run.finishedAt = nowIso();

  if (def.returns) {
    const returned = run.nodes[def.returns];
    const result = {
      node: def.returns,
      output: returned?.output,
      outputJson: returned?.outputJson,
    } as WorkflowRun["result"];
    if (def.outcome_field && result) {
      const raw = result.outputJson as Record<string, unknown> | undefined;
      const value = raw?.[def.outcome_field];
      result.outcome = value === true ? "succeeded" : value === false ? "failed" : null;
    }
    run.result = result;
  }

  const finalType: WorkflowEventType =
    run.status === "cancelled"
      ? "run_cancelled"
      : run.status === "failed"
        ? "run_failed"
        : "run_completed";
  emit(finalType, undefined, {
    status: run.status,
    error: run.error ? redactSecrets(run.error) : undefined,
    result: run.result ?? undefined,
  });
  store.save(run);
  return run;
}
