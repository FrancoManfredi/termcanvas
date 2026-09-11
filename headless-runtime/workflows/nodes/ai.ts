/**
 * Nodos IA (prompt/command) sobre OpenCode — Fase 1.
 *
 * El runner real reutiliza el server embebido (ensureClient) y el transporte
 * único con fusible (attemptJsonPromptOnce): cero reenvíos ante timeout,
 * un reintento ante error de transporte y structured output cuando el nodo
 * declara `output_format`. Inyectable para tests (`aiRunner`).
 */

import type { NodeExecutionResult } from "../types";
import { NodeExecutionError } from "../errors";

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
  systemPrompt?: string;
  outputFormat?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Sesión a reutilizar (context: shared / context.resume); null = nueva. */
  sessionId?: string | null;
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

/** Runner real: server OpenCode embebido + transporte con fusible. */
export function createOpencodeAiRunner(): AiNodeRunner {
  return async (req: AiNodeRequest): Promise<AiNodeResponse> => {
    const { ensureClient } = await import("../../opencodeServerManager");
    const { attemptJsonPromptOnce, parseSessionId } = await import("../../llm/agentTransport");
    const { structuredFormat } = await import("../../llm/structuredOutput");

    let sessionApi: Record<string, unknown>;
    try {
      const client = (await ensureClient()) as unknown as { session: Record<string, unknown> };
      sessionApi = client.session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NodeExecutionError(
        req.nodeId,
        `server OpenCode no disponible: ${message.slice(0, 200)}`,
      );
    }

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

    const promptFn = sessionApi.prompt as
      | ((params: unknown, opts?: unknown) => Promise<unknown>)
      | undefined;
    if (typeof promptFn !== "function") {
      throw new NodeExecutionError(req.nodeId, "session.prompt no disponible en el SDK");
    }

    const parts: Array<Record<string, unknown>> = [];
    if (req.systemPrompt) parts.push({ type: "text", text: req.systemPrompt });
    parts.push({ type: "text", text: req.prompt });

    const payload: Record<string, unknown> = { parts };
    const modelRef = buildModelRef(req.model);
    if (modelRef) payload.model = modelRef;
    if (req.effort) payload.variant = req.effort;
    if (req.outputFormat) payload.format = structuredFormat(req.outputFormat);

    const attempt = await attemptJsonPromptOnce(
      (signal: AbortSignal, body: Record<string, unknown>) =>
        promptFn.call(sessionApi, { sessionID: sessionId, ...body }, { signal }),
      {
        payload,
        label: `workflow ${req.nodeId} session.prompt`,
        jobId: req.runId,
        sessionId,
      },
    );

    if (attempt.raw === null) {
      const message =
        attempt.lastErr instanceof Error
          ? attempt.lastErr.message
          : String(attempt.lastErr ?? "sin respuesta");
      throw new NodeExecutionError(
        req.nodeId,
        `prompt falló: ${message.slice(0, 300)}`,
      );
    }

    const response: AiNodeResponse = { output: attempt.raw, sessionId };
    const usage = mapUsage(attempt.usage);
    if (usage) response.usage = usage;
    return response;
  };
}
