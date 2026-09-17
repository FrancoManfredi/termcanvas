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
import { runAllowlistedReverify } from "./reverify";
import { loadWorkflow } from "./loader";
import { expandIncludes } from "./expand";
import { prepareWorkflowWorktree } from "./isolation";
import { extractBalancedJSONObject, stripJsonFences } from "../llm/jsonExtract";
import { validateAgainstSchema, type JsonSchemaLike } from "./jsonSchema";
import { resolveAgentModel } from "../factory/opencodeAgentSync";

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
 * Keys `required` del schema del nodo: le dicen al extractor balanceado qué
 * objeto es "la respuesta" (por presencia de clave). Sin esto, un nodo con
 * findings anidados devolvía el objeto interno más chico (bug run review:
 * `reverify` elegido sobre `{green, findings}`).
 */
function preferKeysFromSchema(schema: JsonSchemaLike | undefined): string[] {
  try {
    const required = schema?.required;
    if (!Array.isArray(required)) return [];
    return required.filter(
      (key): key is string => typeof key === "string" && key.length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Parseo tolerante de la salida IA cuando el nodo declara output_format:
 * JSON directo → fences markdown (el ÚLTIMO parseable: el modelo cita
 * código antes de la respuesta) → fences sueltos → objeto balanceado
 * embebido en prosa, prefiriendo las keys del schema.
 * Devuelve undefined si no hay JSON utilizable.
 */
function parseStructuredOutput(raw: string, schema?: JsonSchemaLike): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // sigue con fences / extractor
  }
  const fences = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (let index = fences.length - 1; index >= 0; index -= 1) {
    const block = (fences[index][1] ?? "").trim();
    if (block.length === 0) continue;
    try {
      return JSON.parse(block);
    } catch {
      // fence sin JSON (código citado): siguiente
    }
  }
  const stripped = stripJsonFences(raw);
  if (stripped.length > 0 && stripped !== raw.trim()) {
    try {
      return JSON.parse(stripped);
    } catch {
      // sigue con el extractor balanceado
    }
  }
  for (const candidate of [raw, stripped]) {
    const extracted = extractBalancedJSONObject(
      candidate,
      preferKeysFromSchema(schema),
    );
    if (extracted === null) continue;
    try {
      return JSON.parse(extracted);
    } catch {
      // candidato inválido: sigue
    }
  }
  return undefined;
}

/**
 * Uso agregado de dos llamadas IA (reparación de formato): suma campo a campo.
 * Si una sola llamada reportó usage, ese valor se conserva tal cual.
 */
function mergeUsage(
  first: NodeExecutionResult["usage"],
  second: NodeExecutionResult["usage"],
): NodeExecutionResult["usage"] {
  if (!first) return second;
  if (!second) return first;
  return {
    inputTokens: (first.inputTokens ?? 0) + (second.inputTokens ?? 0),
    outputTokens: (first.outputTokens ?? 0) + (second.outputTokens ?? 0),
    cacheReadTokens:
      (first.cacheReadTokens ?? 0) + (second.cacheReadTokens ?? 0),
    cacheWriteTokens:
      (first.cacheWriteTokens ?? 0) + (second.cacheWriteTokens ?? 0),
  };
}

/** Costo agregado de dos llamadas IA; undefined si ninguna reportó costo. */
function mergeCostUsd(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (typeof first !== "number") return second;
  if (typeof second !== "number") return first;
  return first + second;
}

/**
 * Ronda previa de un `loop_group` para `$LOOP_HISTORY` y el bloque
 * auto-inyectado (WS1): nada mecánico, solo lo completado de esa ronda.
 */
interface LoopHistoryEntry {
  iteration: number;
  nodes: Record<string, { output: string; outputJson?: unknown }>;
}

const LOOP_HISTORY_MAX_ITERATIONS = 5;
const LOOP_HISTORY_MAX_CHARS_PER_NODE = 2_000;
const LOOP_HISTORY_MAX_TOTAL_CHARS = 12_000;

/**
 * Reparación acotada de formato: si un nodo con `output_format` devuelve texto
 * sin JSON válido (o con schema inválido), se manda UN turno extra a la misma
 * sesión pidiendo solo el objeto del contrato. Si tampoco parsea, el nodo falla
 * con el error original.
 */
const FORMAT_REPAIR_INSTRUCTION =
  "[REPARACIÓN DE FORMATO] Tu mensaje anterior no produjo el JSON válido que exige el contrato del nodo (output_format). Respondé ahora ÚNICAMENTE con el objeto JSON válido, sin prosa, sin fences ni markdown, sin repetir trabajo ni usar tools.";

function trimHistoryText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncado]`;
}

/**
 * Bloque de historial para el prompt de un nodo IA dentro de un loop_group.
 * Presupuesto total acotado, rondas más recientes primero (las viejas se
 * descartan antes que las nuevas). Sin historial → "" (prompt intacto).
 */
function renderLoopHistoryBlock(history: LoopHistoryEntry[]): string {
  if (!Array.isArray(history) || history.length === 0) return "";
  const header =
    "--- HISTORIAL DE RONDAS PREVIAS (no repitas trabajo ya hecho ni revirtás fixes de rondas previas; si un hallazgo previo ya no aplica, justificá por qué) ---";
  const footer = "--- FIN DEL HISTORIAL ---";
  const budget =
    LOOP_HISTORY_MAX_TOTAL_CHARS - header.length - footer.length - 2;
  const chunks: string[] = [];
  let used = 0;
  for (const entry of history
    .slice(-LOOP_HISTORY_MAX_ITERATIONS)
    .reverse()) {
    const lines: string[] = [`Ronda ${entry.iteration}:`];
    for (const [nodeId, state] of Object.entries(entry.nodes)) {
      let text = state.output;
      if (state.outputJson !== undefined) {
        try {
          text = JSON.stringify(state.outputJson);
        } catch {
          text = state.output;
        }
      }
      if (typeof text !== "string" || text.trim() === "") continue;
      lines.push(
        `[${nodeId}] ${trimHistoryText(text, LOOP_HISTORY_MAX_CHARS_PER_NODE)}`,
      );
    }
    const chunk = lines.join("\n");
    if (used + chunk.length + 1 > budget) {
      if (chunks.length === 0) {
        chunks.push(trimHistoryText(chunk, Math.max(0, budget - 1)));
      }
      break;
    }
    chunks.push(chunk);
    used += chunk.length + 1;
  }
  chunks.reverse();
  return [header, ...chunks, footer].join("\n");
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
  const expanded = expandIncludes(def, (name) =>
    loadWorkflow(name, { repoRoot: opts.repoRoot ?? opts.cwd }),
  );
  validateWorkflow(expanded.def);
  const store = new WorkflowRunStore(opts.runsDir);
  let run: WorkflowRun;
  let inputs: Record<string, unknown>;
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
    // Los inputs del run existente son la fuente (sus `required` ya se
    // validaron al crearlo): resolver DESPUÉS de cargarlos evita el falso
    // "input requerido" en resume de workflows con inputs obligatorios.
    inputs = resolveInputs(def, {
      ...(existing.inputs ?? {}),
      ...(opts.inputs ?? {}),
    });
    for (const [nodeId, state] of Object.entries(run.nodes)) {
      if (state.status !== "completed") delete run.nodes[nodeId];
    }
    run.inputs = inputs;
    run.status = "running";
    run.error = undefined;
    run.finishedAt = undefined;
    run.result = undefined;
    run.totals = undefined;
    run.sourceDigest = loaded.digest;
    run.sourcePath = loaded.sourcePath;
    store.save(run);
  } else {
    inputs = resolveInputs(def, opts.inputs);
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
  // Persistir el cwd efectivo: un resume de un run `inherit` (sin worktree
  // propio) lo recupera desde run.json en vez de caer al cwd del daemon.
  run.cwd = effectiveCwd;
  store.save(run);

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
    sessionMeta?: Record<string, unknown>,
    runOpts?: { silentSession?: boolean },
  ): Promise<NodeExecutionResult> =>
    aiRunner({
      runId: run.id,
      nodeId: node.id,
      cwd: effectiveCwd,
      prompt,
      // Precedencia de modelo (fix modelo del foreman ignorado): el nodo y
      // el workflow pinean primero; si no, manda el modelo del agente (la
      // identidad por default); sin modelo del agente, opencode usa el suyo.
      model: node.model ?? def.model ?? resolveAgentModel(node.agent) ?? undefined,
      effort: node.effort ?? def.effort,
      agent: node.agent,
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
      onSessionCreated: (sessionId: string) => {
        // La reparación de formato reutiliza una sesión YA emitida: repetir la
        // fila/ronda en Agent Sessions solo duplicaría el registro.
        if (runOpts?.silentSession) return;
        // Agent Sessions se habilita al ENVIAR el mensaje, no al completar.
        // `iteration` (loops): número de ronda 1-based para que el panel
        // distinga las sesiones de cada ronda del mismo nodo.
        emit("node_session_attached", node.id, {
          sessionId,
          ...(typeof node.agent === "string" && node.agent !== ""
            ? { agent: node.agent }
            : {}),
          ...(sessionMeta !== undefined ? sessionMeta : {}),
        });
      },
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
        { iteration },
      );
      lastResult = result;
      if (!loop.fresh_context && result.sessionId) sessionId = result.sessionId;
      let outputJson = result.outputJson;
      if (outputJson === undefined && node.output_format) {
        outputJson = parseStructuredOutput(result.output, node.output_format);
      }
      if (outputJson !== undefined && node.output_format) {
        const schemaError = validateAgainstSchema(outputJson, node.output_format);
        if (schemaError) {
          throw new NodeExecutionError(
            node.id,
            `output_format inválido (iteración ${iteration}): ${schemaError}`,
          );
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
    /** Rondas completadas del grupo (WS1): fuente de `$LOOP_HISTORY`. */
    const history: LoopHistoryEntry[] = [];
    let lastResult: NodeExecutionResult = { output: "" };
    let cancelSignal: NodeCancelSignal | null = null;
    let groupCost = 0;
    let hasGroupCost = false;
    let groupInputTokens = 0;
    let groupOutputTokens = 0;
    let groupCacheRead = 0;
    let groupCacheWrite = 0;
    let hasGroupTokens = false;

    for (let iteration = 1; iteration <= group.max_iterations; iteration += 1) {
      const iterationStates: Record<string, NodeState> = {};
      const loopPrev: Record<string, unknown> = {};
      for (const [id, state] of Object.entries(prevStates)) {
        loopPrev[id] = { output: state.output, outputJson: state.outputJson };
      }
      // WS1: bloque anti-regresión auto-inyectado en cada nodo IA del cuerpo.
      // `history` solo tiene rondas previas (se apila al cerrar la ronda).
      const historyBlock =
        group.history === false ? "" : renderLoopHistoryBlock(history);
      const groupVarCtx = (): VarContext => ({
        ...buildVarCtx(groupNode.id),
        nodes: { ...run.nodes, ...iterationStates },
        loopPrev,
        loopHistory: history,
      });

      for (const layer of groupGraph.layers) {
        await Promise.all(
          layer.map(async (subId) => {
            const subNode = groupGraph.byId.get(subId);
            if (!subNode) return;
            // F16: id namespaced (`build.implement`) para eventos, sesiones y
            // artefactos — el stepper y Agent Sessions leen lo mismo que
            // `run.nodes` (que ya guarda `${group}.${sub}`).
            const namespacedId = `${groupNode.id}.${subId}`;
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
                emit("node_skipped", namespacedId, { reason: `when: ${subNode.when}` });
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
              emit("node_skipped", namespacedId, { reason: trigger.skipReason });
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
            emit("node_started", namespacedId);
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              state.attempts = attempt;
              try {
                const namedSubNode = { ...subNode, id: namespacedId };
                const result = await executeBody(
                  namedSubNode,
                  groupVarCtx(),
                  historyBlock,
                  { iteration },
                );
                state.status = "completed";
                state.finishedAt = nowIso();
                state.output = result.output;
                let outputJson =
                  result.outputJson !== undefined
                    ? result.outputJson
                    : subNode.output_format
                      ? parseStructuredOutput(
                          result.output,
                          subNode.output_format,
                        )
                      : undefined;
                let schemaError =
                  subNode.output_format && outputJson !== undefined
                    ? validateAgainstSchema(outputJson, subNode.output_format)
                    : null;
                let finalResult = result;
                let usage = result.usage;
                let costUsd = result.costUsd;
                // Reparación acotada de formato: mismo criterio que el camino
                // top-level — UN turno extra en la misma sesión (silencioso
                // para Agent Sessions) antes de fallar con el error original.
                if (
                  subNode.output_format &&
                  (outputJson === undefined || schemaError !== null) &&
                  (subNode.prompt !== undefined ||
                    subNode.command !== undefined)
                ) {
                  const repaired = await repairStructuredOutput(
                    namedSubNode,
                    result,
                    { iteration },
                  );
                  if (repaired) {
                    finalResult = repaired.result;
                    outputJson = repaired.outputJson;
                    schemaError = null;
                    state.output = finalResult.output;
                    // El primer intento ya pudo reportar usage/costo: se suma.
                    usage = mergeUsage(result.usage, finalResult.usage);
                    costUsd = mergeCostUsd(result.costUsd, finalResult.costUsd);
                  }
                }
                if (subNode.output_format && outputJson === undefined) {
                  throw new NodeExecutionError(
                    subId,
                    "output no contiene JSON válido y el nodo declara output_format",
                  );
                }
                if (subNode.output_format && schemaError !== null) {
                  throw new NodeExecutionError(
                    subId,
                    `output_format inválido: ${schemaError}`,
                  );
                }
                if (outputJson !== undefined) state.outputJson = outputJson;
                if (subNode.output_type) {
                  artifacts.writeNodeSidecar(
                    namespacedId,
                    subNode.output_type,
                    finalResult.output,
                  );
                }
                if (finalResult.sessionId) state.sessionId = finalResult.sessionId;
                if (typeof costUsd === "number") {
                  groupCost += costUsd;
                  hasGroupCost = true;
                }
                if (usage) {
                  groupInputTokens += usage.inputTokens ?? 0;
                  groupOutputTokens += usage.outputTokens ?? 0;
                  groupCacheRead += usage.cacheReadTokens ?? 0;
                  groupCacheWrite += usage.cacheWriteTokens ?? 0;
                  hasGroupTokens = true;
                }
                emit("node_completed", namespacedId, {
                  attempts: attempt,
                  outputPreview: redactSecrets(finalResult.output.slice(0, 4_000)),
                  sessionId: finalResult.sessionId,
                  costUsd,
                });
                return;
              } catch (error) {
                if (error instanceof NodeCancelSignal) {
                  state.status = "cancelled";
                  state.finishedAt = nowIso();
                  state.error = error.message;
                  cancelSignal = cancelSignal ?? error;
                  emit("node_failed", namespacedId, {
                    cancelled: true,
                    reason: error.message,
                  });
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
                emit("node_failed", namespacedId, { error: redactSecrets(message) });
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
      // WS3b: reverify system-owned — los findings estructurados del review
      // pueden pedir comandos read-only; los corre el ENGINE (allowlist) en el
      // worktree y la evidencia entra al historial de la próxima ronda.
      let reverifyEntry: { output: string } | null = null;
      if (group.reverify !== false && !cancelSignal) {
        const requestedFindings: unknown[] = [];
        for (const inner of groupGraph.nodes) {
          const subState = iterationStates[inner.id];
          if (subState?.status !== "completed") continue;
          const findings = (
            subState.outputJson as { findings?: unknown } | undefined
          )?.findings;
          if (Array.isArray(findings)) requestedFindings.push(...findings);
        }
        if (requestedFindings.length > 0) {
          try {
            const reverified = await runAllowlistedReverify(
              requestedFindings,
              effectiveCwd,
              { env: baseEnv, signal: opts.signal },
            );
            if (reverified) reverifyEntry = { output: reverified.evidence };
          } catch {
            // best-effort: el reverify jamás rompe el loop
          }
        }
      }
      // WS1: cerrar la ronda — queda disponible como historial/`$LOOP_PREV`
      // para la próxima iteración (orden topológico estable, no de carrera).
      const historyEntry: LoopHistoryEntry = { iteration, nodes: {} };
      for (const inner of groupGraph.nodes) {
        const subState = iterationStates[inner.id];
        if (
          subState?.status !== "completed" ||
          typeof subState.output !== "string" ||
          subState.output.trim() === ""
        ) {
          continue;
        }
        historyEntry.nodes[inner.id] = {
          output: subState.output,
          ...(subState.outputJson !== undefined
            ? { outputJson: subState.outputJson }
            : {}),
        };
      }
      if (reverifyEntry) {
        historyEntry.nodes.reverify = reverifyEntry;
      }
      if (Object.keys(historyEntry.nodes).length > 0) {
        history.push(historyEntry);
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
        loopHistory: history,
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
    if (hasGroupCost) lastResult.costUsd = groupCost;
    if (hasGroupTokens) {
      lastResult.usage = {
        inputTokens: groupInputTokens,
        outputTokens: groupOutputTokens,
        cacheReadTokens: groupCacheRead,
        cacheWriteTokens: groupCacheWrite,
      };
    }
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
    // Roll-up de costos: el nodo padre hereda los totals del child run.
    if (typeof childRun.totals?.costUsd === "number") {
      result.costUsd = childRun.totals.costUsd;
    }
    if (childRun.totals?.tokens) {
      result.usage = {
        inputTokens: childRun.totals.tokens.input ?? 0,
        outputTokens: childRun.totals.tokens.output ?? 0,
        cacheReadTokens: childRun.totals.tokens.cacheRead ?? 0,
        cacheWriteTokens: childRun.totals.tokens.cacheWrite ?? 0,
      };
    }
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

  /** Meta de ronda para `node_session_attached` (solo iteración válida 1-based). */
  const sessionMetaFor = (
    execMeta: { iteration?: number } | undefined,
  ): Record<string, unknown> | undefined => {
    const iteration = execMeta?.iteration;
    if (
      typeof iteration !== "number" ||
      !Number.isInteger(iteration) ||
      iteration < 1
    ) {
      return undefined;
    }
    return { iteration };
  };

  /**
   * Reparación acotada de formato (UN turno extra, misma sesión): pide solo el
   * objeto del contrato cuando el primer intento no parseó o no validó. Devuelve
   * null si no aplica (nodo no IA, sin contrato) o si el turno reparador tampoco
   * produce JSON válido — nunca lanza: el call site decide fallar con su error
   * original.
   */
  const repairStructuredOutput = async (
    node: WorkflowNode,
    first: NodeExecutionResult,
    execMeta?: { iteration?: number },
  ): Promise<{ result: NodeExecutionResult; outputJson: unknown } | null> => {
    if (!node.output_format) return null;
    if (node.prompt === undefined && node.command === undefined) return null;
    try {
      const result = await runAiNode(
        node,
        FORMAT_REPAIR_INSTRUCTION,
        first.sessionId ?? undefined,
        sessionMetaFor(execMeta),
        { silentSession: true },
      );
      const outputJson =
        result.outputJson ??
        parseStructuredOutput(result.output, node.output_format);
      if (outputJson === undefined) return null;
      if (validateAgainstSchema(outputJson, node.output_format) !== null) {
        return null;
      }
      return { result, outputJson };
    } catch {
      return null;
    }
  };

  const executeBody = (
    node: WorkflowNode,
    varCtx: VarContext,
    promptSuffix?: string,
    execMeta?: { iteration?: number },
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
    /** WS1: el historial del loop_group viaja pegado al prompt IA. */
    const withSuffix = (prompt: string): string =>
      typeof promptSuffix === "string" && promptSuffix.length > 0
        ? `${prompt}\n\n${promptSuffix}`
        : prompt;
    if (node.prompt !== undefined) {
      return runAiNode(
        node,
        withSuffix(resolveTemplate(node.prompt, varCtx)),
        undefined,
        sessionMetaFor(execMeta),
      );
    }
    if (node.command !== undefined) {
      const commandText = readCommandFile(loaded, node.command);
      return runAiNode(
        node,
        withSuffix(resolveTemplate(commandText, varCtx)),
        undefined,
        sessionMetaFor(execMeta),
      );
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
        let outputJson =
          result.outputJson !== undefined
            ? result.outputJson
            : node.output_format
              ? parseStructuredOutput(result.output, node.output_format)
              : undefined;
        let schemaError =
          node.output_format && outputJson !== undefined
            ? validateAgainstSchema(outputJson, node.output_format)
            : null;
        let finalResult = result;
        let usage = result.usage;
        let costUsd = result.costUsd;
        // Reparación acotada de formato (incidente run-mu5qisqz-c-75icdi): un
        // nodo IA con contrato que devolvía markdown sin JSON mataba el run
        // entero. Se le da UN turno extra en la misma sesión pidiendo solo el
        // JSON; si tampoco parsea, se tira el error original de siempre.
        if (
          node.output_format &&
          (outputJson === undefined || schemaError !== null) &&
          (node.prompt !== undefined || node.command !== undefined)
        ) {
          const repaired = await repairStructuredOutput(node, result);
          if (repaired) {
            finalResult = repaired.result;
            outputJson = repaired.outputJson;
            schemaError = null;
            state.output = finalResult.output;
            // El primer intento ya pudo reportar usage/costo: se suma.
            usage = mergeUsage(result.usage, finalResult.usage);
            costUsd = mergeCostUsd(result.costUsd, finalResult.costUsd);
          }
        }
        if (node.output_format && outputJson === undefined) {
          throw new NodeExecutionError(
            node.id,
            "output no contiene JSON válido y el nodo declara output_format",
          );
        }
        if (node.output_format && schemaError !== null) {
          throw new NodeExecutionError(
            node.id,
            `output_format inválido: ${schemaError}`,
          );
        }
        if (outputJson !== undefined) state.outputJson = outputJson;
        artifacts.writeNodeOutput(node.id, finalResult.output);
        if (state.outputJson !== undefined) {
          artifacts.writeNodeStructured(node.id, state.outputJson);
        }
        if (finalResult.sessionId) state.sessionId = finalResult.sessionId;
        if (usage) state.usage = usage;
        if (typeof costUsd === "number") state.costUsd = costUsd;
        if (node.output_type) {
          artifacts.writeNodeSidecar(node.id, node.output_type, finalResult.output);
        }
        emit("node_completed", node.id, {
          attempts: attempt,
          outputPreview: redactSecrets(finalResult.output.slice(0, 4_000)),
          sessionId: finalResult.sessionId,
          costUsd,
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
