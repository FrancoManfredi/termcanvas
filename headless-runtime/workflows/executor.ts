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
import { loadWorkflow } from "./loader";
import { expandIncludes } from "./expand";
import { prepareWorkflowWorktree } from "./isolation";
import { extractBalancedJSONObject, stripJsonFences } from "../llm/jsonExtract";

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

export interface WaitRequest {
  runId: string;
  nodeId: string;
  event: string;
  deadlineMs?: number;
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
  /** Handler de waits por evento (runtime). Sin handler, el nodo falla. */
  onWait?: (request: WaitRequest) => Promise<void>;
  /** Callback inmediato con el run recién creado (para runtimes en background). */
  onRunCreated?: (run: WorkflowRun) => void;
  /** Reanuda un run terminal existente (reusa fila, artefactos y nodos completados). */
  resumeRunId?: string;
  /** Aislamiento del run: inherit (cwd actual) o worktree (git worktree por run). */
  isolation?: "inherit" | "worktree";
  /** Branch base para el worktree (default: HEAD del repo). */
  baseBranch?: string;
  /** Profundidad de anidamiento de child workflows (máx 3). */
  depth?: number;
}

const PHASE_BY_BODY: Record<string, string> = {};

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

/**
 * Parseo tolerante de la salida IA cuando el nodo declara output_format:
 * JSON directo → sin fences → objeto balanceado embebido en prosa.
 * Devuelve undefined si no hay JSON utilizable.
 */
function parseStructuredOutput(raw: string): unknown {
  const candidates = [raw, stripJsonFences(raw)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // sigue con el extractor balanceado
    }
  }
  for (const candidate of [raw, stripJsonFences(raw)]) {
    const extracted = extractBalancedJSONObject(candidate);
    if (extracted === null) continue;
    try {
      return JSON.parse(extracted);
    } catch {
      // candidato inválido: sigue
    }
  }
  return undefined;
}

export async function runWorkflow(
  loaded: LoadedWorkflow,
  opts: RunWorkflowOptions,
): Promise<WorkflowRun> {
  if ((opts.depth ?? 0) > 3) {
    throw new WorkflowValidationError(
      "workflow anidado: profundidad máxima 3 excedida",
    );
  }
  const def = loaded.def;
  let inputs = resolveInputs(def, opts.inputs);
  const expanded = expandIncludes(def, (name) =>
    loadWorkflow(name, { repoRoot: opts.repoRoot ?? opts.cwd }),
  );
  validateWorkflow(expanded.def);
  const store = new WorkflowRunStore(opts.runsDir);
  let run: WorkflowRun;
  if (opts.resumeRunId) {
    const existing = store.load(opts.resumeRunId);
    if (!existing) {
      throw new WorkflowValidationError(`run "${opts.resumeRunId}" no existe`);
    }
    if (existing.status === "running" || existing.status === "pending") {
      throw new WorkflowValidationError(
        `run "${opts.resumeRunId}" sigue activo; cancelalo antes de resumir`,
      );
    }
    run = existing;
    inputs = existing.inputs ?? inputs;
    for (const [nodeId, state] of Object.entries(run.nodes)) {
      if (state.status !== "completed") delete run.nodes[nodeId];
    }
    run.status = "running";
    run.error = undefined;
    run.finishedAt = undefined;
    run.result = undefined;
    run.totals = undefined;
    run.sourceDigest = loaded.digest;
    run.sourcePath = loaded.sourcePath;
    store.save(run);
  } else {
    run = store.create({
      workflow: def.name,
      description: def.description,
      inputs,
      args: opts.args ?? "",
      sourceDigest: loaded.digest,
      sourcePath: loaded.sourcePath,
    });
  }
  const artifacts: RunArtifacts = store.artifactsFor(run.id);
  opts.onRunCreated?.(run);
  const frozenDir = path.join(artifacts.runDir, "workflow-source");
  fs.mkdirSync(frozenDir, { recursive: true });
  const frozenFile = path.join(frozenDir, "workflow.yaml");
  if (!fs.existsSync(frozenFile)) {
    if (fs.existsSync(loaded.sourcePath)) {
      fs.copyFileSync(loaded.sourcePath, frozenFile);
    } else {
      fs.writeFileSync(frozenFile, loaded.source, "utf-8");
    }
  }

  let effectiveCwd = opts.cwd;
  if (opts.isolation === "worktree" && !opts.resumeRunId) {
    const worktree = prepareWorkflowWorktree({
      repoRoot: opts.repoRoot ?? opts.cwd,
      runId: run.id,
      baseBranch: opts.baseBranch,
    });
    run.worktree = worktree;
    effectiveCwd = worktree.path;
    store.save(run);
  } else if (opts.resumeRunId && run.worktree) {
    effectiveCwd = run.worktree.path;
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

  const graph = buildLayers(expanded.def.nodes);
  let cancelledReason: string | null = null;
  run.status = "running";
  store.save(run);
  emit("run_started", undefined, {
    nodes: expanded.def.nodes.length,
    args: run.args,
  });

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
      cwd: effectiveCwd,
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
        outputJson = parseStructuredOutput(result.output);
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
          cwd: effectiveCwd,
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

  const resolveOverrides = (nodeId?: string): Record<string, unknown> => {
    const raw = nodeId ? expanded.inputOverrides[nodeId] : undefined;
    if (!raw) return inputs;
    const base: VarContext = {
      args: run.args,
      inputs,
      nodes: run.nodes,
      artifactsDir: artifacts.artifactsDir,
      stateDir: artifacts.stateDir,
      workflowName: def.name,
      runId: run.id,
    };
    const resolved: Record<string, unknown> = { ...inputs };
    for (const [key, value] of Object.entries(raw)) {
      try {
        resolved[key] = resolveValue(value, base);
      } catch {
        resolved[key] = value;
      }
    }
    return resolved;
  };

  const buildVarCtx = (nodeId?: string): VarContext => ({
    args: run.args,
    inputs: resolveOverrides(nodeId),
    nodes: run.nodes,
    artifactsDir: artifacts.artifactsDir,
    stateDir: artifacts.stateDir,
    workflowName: def.name,
    runId: run.id,
  });

  const evalCtxFor = (nodeId: string) => ({
    resolveExpression: (expr: string) => resolveValue(expr, buildVarCtx(nodeId)),
  });

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

  const executeLoopGroup = async (
    groupNode: WorkflowNode,
    varCtx: VarContext,
  ): Promise<NodeExecutionResult> => {
    const group = groupNode.loop_group;
    if (!group) {
      throw new NodeExecutionError(groupNode.id, "nodo loop_group sin body");
    }
    const groupGraph = buildLayers(group.nodes);
    let prevStates: Record<string, NodeState> = {};
    let lastResult: NodeExecutionResult = { output: "" };
    let cancelSignal: NodeCancelSignal | null = null;

    for (let iteration = 1; iteration <= group.max_iterations; iteration += 1) {
      const iterationStates: Record<string, NodeState> = {};
      const loopPrev: Record<string, unknown> = {};
      for (const [id, state] of Object.entries(prevStates)) {
        loopPrev[id] = { output: state.output, outputJson: state.outputJson };
      }
      const groupVarCtx = (): VarContext => ({
        ...buildVarCtx(groupNode.id),
        nodes: { ...run.nodes, ...iterationStates },
        loopPrev,
      });

      for (const layer of groupGraph.layers) {
        await Promise.all(
          layer.map(async (subId) => {
            const subNode = groupGraph.byId.get(subId);
            if (!subNode) return;
            if (subNode.when) {
              let whenTrue = false;
              try {
                whenTrue = evaluateWhen(subNode.when, {
                  resolveExpression: (expr) => resolveValue(expr, groupVarCtx()),
                });
              } catch {
                whenTrue = false;
              }
              if (!whenTrue) {
                iterationStates[subId] = {
                  id: subId,
                  status: "skipped",
                  attempts: 0,
                  skipReason: `when: ${subNode.when}`,
                };
                return;
              }
            }
            const trigger = evaluateTriggerRule(
              subNode.trigger_rule,
              groupGraph.directDeps.get(subId) ?? [],
              iterationStates,
            );
            if (!trigger.run) {
              iterationStates[subId] = {
                id: subId,
                status: "skipped",
                attempts: 0,
                skipReason: trigger.skipReason,
              };
              return;
            }
            const maxAttempts = subNode.retry?.max_attempts ?? 1;
            const retryDelay = subNode.retry?.delay_ms ?? 1_000;
            const retryMode = subNode.retry?.on_error ?? "transient";
            const state: NodeState = {
              id: subId,
              status: "running",
              attempts: 0,
              startedAt: nowIso(),
            };
            iterationStates[subId] = state;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              state.attempts = attempt;
              try {
                const result = await executeBody(subNode, groupVarCtx());
                state.status = "completed";
                state.finishedAt = nowIso();
                state.output = result.output;
                if (result.outputJson !== undefined) {
                  state.outputJson = result.outputJson;
                }
                if (result.sessionId) state.sessionId = result.sessionId;
                return;
              } catch (error) {
                if (error instanceof NodeCancelSignal) {
                  state.status = "cancelled";
                  state.finishedAt = nowIso();
                  state.error = error.message;
                  cancelSignal = cancelSignal ?? error;
                  return;
                }
                const message =
                  error instanceof Error ? error.message : String(error);
                const canRetry =
                  attempt < maxAttempts &&
                  (retryMode === "all" || isTransient(message));
                if (canRetry) {
                  await new Promise((resolve) => setTimeout(resolve, retryDelay));
                  continue;
                }
                state.status = "failed";
                state.finishedAt = nowIso();
                state.error = message;
                return;
              }
            }
          }),
        );
        if (cancelSignal) break;
      }

      for (const [subId, state] of Object.entries(iterationStates)) {
        run.nodes[`${groupNode.id}.${subId}`] = {
          ...state,
          id: `${groupNode.id}.${subId}`,
        };
      }
      prevStates = iterationStates;
      store.save(run);

      const sinks = groupGraph.nodes.filter(
        (inner) => (groupGraph.dependents.get(inner.id) ?? []).length === 0,
      );
      const completedSinks = sinks
        .map((inner) => iterationStates[inner.id])
        .filter((state) => state && state.status === "completed");
      if (sinks.length === 1 && completedSinks[0]) {
        lastResult = { output: completedSinks[0].output ?? "" };
        if (completedSinks[0].outputJson !== undefined) {
          lastResult.outputJson = completedSinks[0].outputJson;
        }
      } else {
        const aggregate: Record<string, unknown> = {};
        for (const sink of sinks) {
          const state = iterationStates[sink.id];
          if (state?.status === "completed") {
            aggregate[sink.id] = state.outputJson ?? state.output;
          }
        }
        lastResult = { output: JSON.stringify(aggregate), outputJson: aggregate };
      }

      if (cancelSignal) break;
      const failed = Object.values(iterationStates).find(
        (state) => state.status === "failed",
      );
      if (failed) {
        throw new NodeExecutionError(
          groupNode.id,
          `loop_group: nodo "${failed.id}" falló: ${(failed.error ?? "").slice(0, 300)}`,
        );
      }

      const untilVars: VarContext = {
        ...buildVarCtx(groupNode.id),
        nodes: { ...run.nodes, ...iterationStates },
        loopPrev,
      };
      if (group.until) {
        try {
          const done = evaluateWhen(group.until, {
            resolveExpression: (expr) => resolveValue(expr, untilVars),
          });
          if (done) break;
        } catch {
          // condición inválida: no termina por esta vía
        }
      }
      if (group.until_bash) {
        const command = resolveTemplate(group.until_bash, untilVars);
        const shellResult = await runShellCommand(command, {
          cwd: effectiveCwd,
          env: {
            ...baseEnv,
            ARTIFACTS_DIR: artifacts.artifactsDir,
            STATE_DIR: artifacts.stateDir,
            LOOP_PREV_OUTPUT: lastResult.output,
          },
          timeoutMs: 60_000,
          signal: opts.signal,
        });
        if (shellResult.exitCode === 0) break;
      }
    }

    if (cancelSignal) throw cancelSignal;
    return lastResult;
  };

  const runBounded = async <T>(
    items: unknown[],
    limit: number,
    fn: (item: unknown, index: number) => Promise<T>,
  ): Promise<T[]> => {
    const results: T[] = new Array(items.length);
    let cursor = 0;
    const width = Math.max(1, Math.min(limit, items.length));
    await Promise.all(
      Array.from({ length: width }, async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= items.length) return;
          results[index] = await fn(items[index], index);
        }
      }),
    );
    return results;
  };

  const runChildWorkflow = async (
    parentNode: WorkflowNode,
    childName: string,
    childInputs: Record<string, unknown>,
  ): Promise<NodeExecutionResult> => {
    let childLoaded: LoadedWorkflow;
    try {
      childLoaded = loadWorkflow(childName, {
        repoRoot: opts.repoRoot ?? opts.cwd,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NodeExecutionError(
        parentNode.id,
        `workflow hijo "${childName}": ${message.slice(0, 300)}`,
      );
    }
    const childRun = await runWorkflow(childLoaded, {
      cwd: effectiveCwd,
      runsDir: opts.runsDir,
      inputs: childInputs,
      args: run.args,
      env: opts.env,
      repoRoot: opts.repoRoot,
      aiRunner: opts.aiRunner,
      onApproval: opts.onApproval,
      signal: opts.signal,
      depth: (opts.depth ?? 0) + 1,
    });
    if (childRun.status === "failed") {
      throw new NodeExecutionError(
        parentNode.id,
        `workflow hijo "${childName}" falló: ${(childRun.error ?? "").slice(0, 300)}`,
      );
    }
    if (childRun.status === "cancelled") {
      throw new NodeCancelSignal(
        parentNode.id,
        `workflow hijo "${childName}" cancelado: ${childRun.error ?? ""}`,
      );
    }
    let output = childRun.result?.output;
    let outputJson = childRun.result?.outputJson;
    if (output === undefined) {
      const completed = Object.values(childRun.nodes).filter(
        (state) => state.status === "completed",
      );
      const last = completed[completed.length - 1];
      output = last?.output ?? "";
      outputJson = last?.outputJson;
    }
    const result: NodeExecutionResult = { output };
    if (outputJson !== undefined) result.outputJson = outputJson;
    return result;
  };

  const executeWorkflowNode = async (
    node: WorkflowNode,
    varCtx: VarContext,
  ): Promise<NodeExecutionResult> => {
    const childName = node.workflow;
    if (!childName) {
      throw new NodeExecutionError(node.id, "nodo workflow sin nombre");
    }
    const baseInputs = node.with
      ? (resolveValue(node.with, varCtx) as Record<string, unknown>)
      : {};
    if (!node.fan_out) {
      return runChildWorkflow(node, childName, baseInputs);
    }
    const fanOut = node.fan_out;
    const itemsRaw = resolveValue(fanOut.items, varCtx);
    let items: unknown[] = [];
    if (Array.isArray(itemsRaw)) {
      items = itemsRaw;
    } else {
      try {
        const parsed = JSON.parse(String(itemsRaw));
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
    }
    if (items.length === 0) {
      throw new NodeExecutionError(
        node.id,
        "fan_out.items no resolvió a un array no vacío",
      );
    }
    const outcomes = await runBounded(
      items,
      fanOut.max_parallel,
      async (item) => {
        try {
          const child = await runChildWorkflow(node, childName, {
            ...baseInputs,
            [fanOut.as]: item,
          });
          return { ok: true as const, value: child.outputJson ?? child.output };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    if (fanOut.join === "all_success") {
      const failure = outcomes.find((outcome) => !outcome.ok);
      if (failure && !failure.ok) {
        throw new NodeExecutionError(
          node.id,
          `fan_out con hijo fallido: ${failure.error.slice(0, 300)}`,
        );
      }
    }
    const values = outcomes.map((outcome) =>
      outcome.ok
        ? outcome.value
        : { archon_failed: true, error: outcome.error },
    );
    return { output: JSON.stringify(values), outputJson: values };
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
      cwd: effectiveCwd,
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
    if (node.workflow !== undefined) {
      return executeWorkflowNode(node, varCtx);
    }
    if (node.loop_group !== undefined) {
      return executeLoopGroup(node, varCtx);
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
    if (node.wait !== undefined) {
      return executeWait(node.wait, nodeCtx, (event, deadlineMs) =>
        opts.onWait
          ? opts.onWait({ runId: run.id, nodeId: node.id, event, deadlineMs })
          : Promise.reject(
              new NodeExecutionError(
                node.id,
                "wait por evento sin handler (onWait) en el runtime",
              ),
            ),
      );
    }
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
    if (states[node.id]?.status === "completed") {
      emit("node_skipped", node.id, { reason: "resume: nodo ya completado" });
      return;
    }

    if (node.when) {
      const original = states[node.id];
      let whenTrue = false;
      try {
        whenTrue = evaluateWhen(node.when, evalCtxFor(node.id));
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
        const result = await executeBody(node, buildVarCtx(node.id));
        state.status = "completed";
        state.finishedAt = nowIso();
        state.output = result.output;
        if (result.outputJson !== undefined) {
          state.outputJson = result.outputJson;
        } else if (node.output_format) {
          const parsed = parseStructuredOutput(result.output);
          if (parsed === undefined) {
            throw new NodeExecutionError(
              node.id,
              "output no contiene JSON válido y el nodo declara output_format",
            );
          }
          state.outputJson = parsed;
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
        if (opts.signal?.aborted) {
          state.status = "cancelled";
          state.finishedAt = nowIso();
          state.error = "cancelado";
          cancelledReason = "cancelado";
          emit("node_failed", node.id, { cancelled: true, reason: "cancelado" });
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

  const totals: NonNullable<WorkflowRun["totals"]> = {};
  let totalCost = 0;
  let hasCost = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let hasTokens = false;
  for (const state of Object.values(run.nodes)) {
    if (typeof state.costUsd === "number") {
      totalCost += state.costUsd;
      hasCost = true;
    }
    if (state.usage) {
      inputTokens += state.usage.inputTokens ?? 0;
      outputTokens += state.usage.outputTokens ?? 0;
      cacheRead += state.usage.cacheReadTokens ?? 0;
      cacheWrite += state.usage.cacheWriteTokens ?? 0;
      hasTokens = true;
    }
  }
  if (hasCost) totals.costUsd = totalCost;
  if (hasTokens) {
    totals.tokens = {
      input: inputTokens,
      output: outputTokens,
      cacheRead,
      cacheWrite,
    };
  }
  if (hasCost || hasTokens) run.totals = totals;

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
