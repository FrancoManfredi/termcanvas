/**
 * Nodos IA (prompt/command) sobre OpenCode — Fase 1 + Fase 2.
 *
 * - Server singleton embebido para nodos sin capacidades (rápido).
 * - Server scopeado por nodo (spawn + teardown) cuando el nodo declara
 *   skills o mcp: config vía OPENCODE_CONFIG_CONTENT con skills.paths,
 *   permission.skill deny-all/allow-list y mcp servers.
 * - Tools por nodo: record en el body de session.prompt (vocabulario
 *   canónico de runner/toolPolicy).
 * - Transporte único con fusible y structured output.
 */

import type { NodeExecutionResult } from "../types";
import type { PromptAttempt } from "../../llm/agentTransport";
import { NodeExecutionError } from "../errors";
import { buildToolsRecord, materializeNodeCapabilities, normalizeMcpNames } from "../capabilities";

export interface AiNodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AiNodeRequest {
  runId: string;
  nodeId: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  /** Agente OpenCode espejado (identidad ejecutante del turno). */
  agent?: string;
  systemPrompt?: string;
  outputFormat?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Sesión a reutilizar (context: shared / context.resume); null = nueva. */
  sessionId?: string | null;
  /**
   * Callback: la sesión ya está resuelta (creada o reutilizada) y el mensaje
   * está por enviarse. El executor lo usa para emitir `node_session_attached`
   * (Agent Sessions habilita la fila en el envío, no al completar la fase).
   * Nunca debe romper el nodo: el llamador lo invoca dentro de try/catch.
   */
  onSessionCreated?: (sessionId: string) => void;
  /** Fase 2: capacidades por nodo. */
  skills?: string[];
  mcp?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  repoRoot: string;
  workflowDir: string;
  scopeDir: string;
}

export interface AiNodeResponse extends NodeExecutionResult {
  sessionId?: string;
  usage?: AiNodeUsage;
  costUsd?: number;
}

export type AiNodeRunner = (req: AiNodeRequest) => Promise<AiNodeResponse>;

/** Convierte "provider/model" al shape {providerID, modelID} que espera el SDK. */
export function buildModelRef(model?: string): unknown {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return model;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

interface SessionUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function mapUsage(usage: unknown): AiNodeUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const raw = usage as SessionUsageLike;
  const mapped: AiNodeUsage = {};
  if (typeof raw.inputTokens === "number") mapped.inputTokens = raw.inputTokens;
  if (typeof raw.outputTokens === "number") mapped.outputTokens = raw.outputTokens;
  if (typeof raw.cacheReadTokens === "number") mapped.cacheReadTokens = raw.cacheReadTokens;
  if (typeof raw.cacheWriteTokens === "number") mapped.cacheWriteTokens = raw.cacheWriteTokens;
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/**
 * Predicado de frescura compartido con el server manager (fuente única):
 * true cuando el nodo corre en un server scopeado recién nacido (scope
 * propio o revisión/huella de agentes cambiada desde que nació el singleton).
 * Re-export para compat de las suites que lo importan de este módulo.
 */
export { shouldUseScopedServer } from "../../opencodeServerManager";

/** Runner real: server OpenCode embebido (o scopeado) + transporte con fusible. */
export function createOpencodeAiRunner(): AiNodeRunner {
  return async (req: AiNodeRequest): Promise<AiNodeResponse> => {
    const { ensureAgentTurnClient } = await import("../../opencodeServerManager");
    const { attemptJsonPromptAsyncOnce, attemptJsonPromptOnce, parseSessionId } = await import("../../llm/agentTransport");
    const { structuredFormat } = await import("../../llm/structuredOutput");

    let scopedHandle: { close: () => void } | null = null;
    try {
      const tools = buildToolsRecord({
        allowed_tools: req.allowedTools,
        denied_tools: req.deniedTools,
      });

      let sessionApi: Record<string, unknown>;
      // MCPs del agente (agent.md → factory/mcps/<bundle>.json): se resuelven
      // ANTES de materializar para que el server scopeado los inyecte junto a
      // los del nodo. Sin bundles declarados no hay costo extra.
      let agentMcpNames: string[] = [];
      try {
        const { loadAgentDef } = await import("../../factory/agentLoader");
        const agentDef = req.agent ? loadAgentDef(req.agent) : null;
        agentMcpNames = normalizeMcpNames(agentDef?.frontmatter?.mcps);
      } catch {
        agentMcpNames = [];
      }
      const scope = materializeNodeCapabilities(
        { skills: req.skills, mcp: req.mcp },
        {
          repoRoot: req.repoRoot,
          workflowDir: req.workflowDir,
          scopeDir: req.scopeDir,
          agentMcps: agentMcpNames,
        },
      );
      // Frescura (fix PLATANO, helper compartido): si la revisión/huella de
      // agentes vigente cambió desde que nació el singleton, este nodo corre
      // en un server recién nacido (config fresca de disco) en vez de
      // heredar el prompt/modelo anterior del singleton. El mismo helper
      // cubre el scope propio del nodo (skills/mcp) y sella el teardown.
      const turn = await ensureAgentTurnClient({
        hasNodeScope: scope !== null,
        ...(scope ? { scopeConfig: scope.config as Record<string, unknown> } : {}),
      });
      scopedHandle = turn.fresh ? { close: turn.close } : null;
      sessionApi = (turn.client as unknown as { session: Record<string, unknown> }).session;

      let sessionId = req.sessionId ?? null;
      if (!sessionId) {
        const createFn = sessionApi.create as
          | ((params?: unknown) => Promise<unknown>)
          | undefined;
        if (typeof createFn !== "function") {
          throw new NodeExecutionError(req.nodeId, "session.create no disponible en el SDK");
        }
        const title = `workflow ${req.runId} ${req.nodeId}`;
        let created: unknown;
        try {
          created = await createFn.call(sessionApi, {
            title,
            directory: req.cwd,
          });
        } catch {
          created = await createFn.call(sessionApi, {
            body: { title, directory: req.cwd },
          });
        }
        sessionId = parseSessionId(created);
        if (!sessionId) {
          throw new NodeExecutionError(req.nodeId, "session.create sin sessionId");
        }
      }

      // La sesión ya existe (creada o reutilizada): avisar ANTES del prompt
      // para que Agent Sessions la habilite en el envío. Observabilidad pura:
      // jamás rompe el nodo.
      try {
        req.onSessionCreated?.(sessionId);
      } catch {
        // best-effort
      }

      const promptFn = sessionApi.prompt as
        | ((params: unknown, opts?: unknown) => Promise<unknown>)
        | undefined;
      // Transporte async (incidente #125): `promptAsync` + `messages` es el
      // camino preferido — el turno no vive pegado al request HTTP (el
      // server puede cortar la respuesta síncrona de un turno largo
      // mientras la sesión sigue corriendo). Sin esas dos funciones se cae
      // al prompt síncrono de siempre (fakes/tests y servers viejos).
      const promptAsyncFn = sessionApi.promptAsync as
        | ((params: unknown, opts?: unknown) => Promise<unknown>)
        | undefined;
      const messagesFn = sessionApi.messages as
        | ((params: unknown, opts?: unknown) => Promise<unknown>)
        | undefined;
      const abortFn = sessionApi.abort as
        | ((params: unknown, opts?: unknown) => Promise<unknown>)
        | undefined;
      if (
        typeof promptFn !== "function" &&
        typeof promptAsyncFn !== "function"
      ) {
        throw new NodeExecutionError(
          req.nodeId,
          "session.prompt/promptAsync no disponibles en el SDK",
        );
      }

      const parts: Array<Record<string, unknown>> = [];
      if (req.systemPrompt) parts.push({ type: "text", text: req.systemPrompt });
      parts.push({ type: "text", text: req.prompt });

      const payload: Record<string, unknown> = { parts };
      const modelRef = buildModelRef(req.model);
      if (modelRef) payload.model = modelRef;
      if (req.effort) payload.variant = req.effort;
      if (!req.agent || req.agent.trim() === "") {
        // Estricto: un nodo IA sin identidad jamás corre con el agente
        // primario de opencode (Build). Falla con error claro.
        throw new NodeExecutionError(
          req.nodeId,
          "nodo IA sin `agent`: la identidad es obligatoria (nunca corre el agente primario)",
        );
      }
      {
        const { resolveSessionAgent } = await import("../../factory/opencodeAgentSync");
        const identity = resolveSessionAgent(req.agent);
        if (identity === null) {
          throw new NodeExecutionError(
            req.nodeId,
            `agente "${req.agent}" no resuelto: falta factory/agents/${req.agent}/agent.md (el server efímero inyecta los agentes inline)`,
          );
        }
        Object.assign(payload, identity);
      }
      if (req.outputFormat) payload.format = structuredFormat(req.outputFormat);
      if (tools) payload.tools = tools;

      const attemptOpts = {
        payload,
        label: `workflow ${req.nodeId} session.prompt`,
        jobId: req.runId,
        sessionId,
        ...(typeof req.timeoutMs === "number" ? { ms: req.timeoutMs } : {}),
      };
      let attempt: PromptAttempt;
      if (typeof promptAsyncFn === "function" && typeof messagesFn === "function") {
        attempt = await attemptJsonPromptAsyncOnce(
          {
            promptAsync: (params, opts) =>
              promptAsyncFn.call(sessionApi, params, opts),
            messages: (params, opts) =>
              messagesFn.call(sessionApi, params, opts),
            ...(typeof abortFn === "function"
              ? {
                  abort: (params, opts) =>
                    abortFn.call(sessionApi, params, opts),
                }
              : {}),
          },
          {
            ...attemptOpts,
            sessionID: sessionId,
            // Cancelación del run (discard/cancel): corta el poll y aborta
            // el turno en el server en vez de dejarlo hasta el fusible.
            ...(req.signal ? { signal: req.signal } : {}),
          },
        );
      } else if (typeof promptFn === "function") {
        attempt = await attemptJsonPromptOnce(
          (signal: AbortSignal, body: Record<string, unknown>) =>
            promptFn.call(
              sessionApi,
              { sessionID: sessionId, ...body },
              { signal },
            ),
          attemptOpts,
        );
      } else {
        throw new NodeExecutionError(
          req.nodeId,
          "session.prompt/promptAsync no disponibles en el SDK",
        );
      }

      if (attempt.raw === null) {
        const message =
          attempt.lastErr instanceof Error
            ? attempt.lastErr.message
            : attempt.lastErr === null || attempt.lastErr === undefined
              ? "sin respuesta"
              : (() => {
                  try {
                    return JSON.stringify(attempt.lastErr).slice(0, 300);
                  } catch {
                    return String(attempt.lastErr).slice(0, 300);
                  }
                })();
        throw new NodeExecutionError(
          req.nodeId,
          `prompt falló: ${message.slice(0, 300)}`,
        );
      }

      const response: AiNodeResponse = { output: attempt.raw, sessionId };
      const usage = mapUsage(attempt.usage);
      if (usage) response.usage = usage;
      return response;
    } catch (error) {
      if (error instanceof NodeExecutionError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new NodeExecutionError(req.nodeId, message.slice(0, 300));
    } finally {
      try {
        scopedHandle?.close();
      } catch {
        // teardown best-effort: el server scopeado muere con el proceso si falla
      }
    }
  };
}
