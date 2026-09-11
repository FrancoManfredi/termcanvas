/**
 * SpecAgent — Ola 8.
 * Escritor de brief LLM read-only: tools read/glob/grep SIN write/edit/bash.
 * Timeout 20s + 1 retry, parse fences→zod, cualquier fallo → skip con evento
 * trazado (fallo-sano: nunca bloquea, nunca lanza).
 * Espeja el esqueleto de llamada/parse/timeout de reviewAgent sin su lógica.
 * Usa OpencodeServerManager (dueño único server efímero) + SDK v2.
 * Modelo: el modelRef del job (mismo modelo; disjoint solo aplica a REVIEW).
 */

import path from "node:path";
import type { ModelRef } from "../../shared/types/workItem";
import type { TriageFindings } from "../../shared/types/triage";
import type { SpecBrief } from "../../shared/types/spec";
import { buildSpecPrompt, parseSpecLLMResponse, specJsonSchema } from "./specPrompt";
import { opencodeServerManager } from "../opencodeServerManager";
import { READONLY_TOOLS, toolsetFor } from "../runner/toolPolicy";
import { sessionAgentArgs } from "../factory/opencodeAgentSync";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { isSessionNotFoundError, promptInAgentSession, readSessionAgent } from "../sessions/agentSessions";
import {
  SESSION_CREATE_FUSE_MS,
  attemptPromptOnce,
  parseSessionId,
  withTransportRetry,
} from "../llm/agentTransport";

// Tools read-only — fuente única en runner/toolPolicy (SIN write/edit/bash).
// Re-export por compat con suites (triage-spec): el literal vive en toolPolicy.
export const SPEC_TOOLS: Record<string, boolean> = { ...READONLY_TOOLS };

export interface SpecAgentInput {
  workItemId: string;
  worktreePath: string;
  model: ModelRef;
  prompt: string;
  triage?: TriageFindings;
  /** Motivo del humano al rechazar el brief anterior (ronda reject): el prompt lo muestra. */
  feedback?: string;
}

export interface SpecConsumeOutput {
  brief: SpecBrief | null;
  raw: string | null;
  skipped: boolean;
  skipReason: string | null;
}

let sdkCache: boolean | null = null;
async function hasSdk(): Promise<boolean> {
  if (sdkCache !== null) return sdkCache;
  try {
    await import("@opencode-ai/sdk");
    sdkCache = true;
    return true;
  } catch {}
  try {
    await import("@opencode-ai/sdk/v2");
    sdkCache = true;
    return true;
  } catch {
    sdkCache = false;
    return false;
  }
}

/** Test seam: permite inyectar prompt mock sin server real. */
let promptMock: ((input: SpecAgentInput) => Promise<string | null>) | null = null;
export function setSpecPromptMock(fn: ((input: SpecAgentInput) => Promise<string | null>) | null): void {
  promptMock = fn;
}

export class SpecAgent {
  async consume(input: SpecAgentInput): Promise<SpecConsumeOutput> {
    const skip = (skipReason: string, raw: string | null = null): SpecConsumeOutput => ({
      brief: null,
      raw,
      skipped: true,
      skipReason: skipReason.slice(0, 200),
    });

    try {
      // Mock de tests
      if (promptMock) {
        let mocked: string | null = null;
        try {
          mocked = await promptMock(input);
          if (!mocked) return skip("mock sin respuesta", null);
          const parsed = parseSpecLLMResponse(mocked);
          return {
            brief: {
              summary: parsed.summary,
              acceptanceCriteria: parsed.acceptanceCriteria,
              targetFiles: parsed.targetFiles ?? [],
              trivial: parsed.trivial,
              openQuestions: parsed.openQuestions ?? [],
            },
            raw: mocked,
            skipped: false,
            skipReason: null,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return skip(`mock parse fallo: ${msg.slice(0, 120)}`, mocked);
        }
      }

      const ok = await hasSdk();
      if (!ok) return skip("SDK no detectado — se salta spec y sigue a Foreman");

      let client: {
        session: {
          create: (o: unknown) => Promise<unknown>;
          prompt?: (a: unknown, b?: unknown) => Promise<unknown>;
          promptAsync?: (o: unknown) => Promise<unknown>;
        };
      };
      try {
        client = (await opencodeServerManager.ensureClient()) as unknown as typeof client;
      } catch {
        const existing = opencodeServerManager.getClient() as unknown as typeof client | null;
        if (!existing) return skip("opencode server no disponible — se salta spec y sigue a Foreman");
        client = existing;
      }

      // Turno único de datos: las reglas viven en el system prompt del espejo
      // (factory/agents/spec/agent.md), el turno lleva solo datos + cierre.
      const promptText = buildSpecPrompt(
        {
          id: input.workItemId,
          prompt: input.prompt,
          worktree: path.resolve(input.worktreePath),
          modelRef: input.model,
        },
        input.triage,
        input.feedback,
      );

      const directory = path.resolve(input.worktreePath);
      const title = `Spec ${input.workItemId}`;
      // Ola 16: create extraído a closure byte a byte (título, timeouts y
      // doble intento intactos). Los skips de fallo se convierten en errores
      // MARCADOS (`spec session.create…`) para que el catch de abajo devuelva
      // el MISMO skip byte a byte. El mock previo no se toca.
      const createSpecSession = async (): Promise<string> => {
        try {
          const res: unknown = await withTransportRetry(
            // Identidad de fase (ver sessionAgentArgs): cae al shape plano si el server la rechaza.
            () => client.session.create({ title, directory, ...sessionAgentArgs("spec") }),
            SESSION_CREATE_FUSE_MS,
            "spec session.create",
          );
          const sessionId = parseSessionId(res);
          if (!sessionId) throw new Error("session.create sin sessionId");
          return sessionId;
        } catch {
          try {
            const res2: unknown = await withTransportRetry(
              () => client.session.create({ body: { title, directory } }),
              SESSION_CREATE_FUSE_MS,
              "spec session.create body",
            );
            const sessionId = parseSessionId(res2);
            if (!sessionId) throw new Error("spec session.create sin sessionId — se salta spec");
            return sessionId;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.startsWith("spec session.create")) throw e;
            throw new Error(`spec session.create fallo: ${msg.slice(0, 120)}`);
          }
        }
      };

      const sessionAny = client.session as unknown as Record<string, unknown>;
      const promptFn = sessionAny.prompt as ((a: unknown, b?: unknown) => Promise<unknown>) | undefined;
      const promptAsyncFn = sessionAny.promptAsync as ((o: unknown) => Promise<unknown>) | undefined;
      if (typeof promptFn !== "function" && typeof promptAsyncFn !== "function") {
        return skip("session.prompt no disponible — se salta spec");
      }

      const body = {
        model: { providerID: input.model.providerID, modelID: input.model.modelID },
        tools: toolsetFor("spec") as unknown as Record<string, unknown>,
        // Identidad ejecutante del turno (el agent del create solo etiqueta).
        ...sessionAgentArgs("spec"),
        parts: [{ type: "text", text: promptText }],
        json_schema: specJsonSchema,
      };

      // UN solo intento por turno (doctrina agentTransport): la escalera vieja
      // (sync → sync legacy idéntico → async → async legacy idéntico) reenviaba
      // el mismo prompt hasta 4 veces por llamada — con timeouts cortos, cada
      // reenvío clonaba el mensaje en la sesión. promptAsync devuelve un
      // handle sin texto: solo se usa cuando promptFn no existe.
      // Ola 15 cierre: UN solo wrap de costo en el camino común (1 llamada
      // lógica = 1 conteo; mock/skip previos no usan LLM: 0 honesto).
      // Ola 16: la escalera toma sid (no cierra sobre sessionId).
      const runSpecLadder = async (sid: string): Promise<{ raw: string | null; lastErr: unknown }> => {
        if (typeof promptFn === "function") {
          // Plano SDK v2 (ver reviewAgent.buildReviewPromptPayload):
          // el envelope {path,body} se dropea y hace 500 instantáneo.
          return attemptPromptOnce(
            (signal) =>
              (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(
                client.session,
                { sessionID: sid, ...body },
                { signal },
              ),
            { label: "spec session.prompt", preferKey: "acceptanceCriteria", jobId: input.workItemId, sessionId: sid },
          );
        }
        if (typeof promptAsyncFn === "function") {
          return attemptPromptOnce(
            () =>
              (promptAsyncFn as (o: unknown) => Promise<unknown>).call(client.session, {
                sessionID: sid,
                ...body,
              }),
            { label: "spec session.promptAsync", preferKey: "acceptanceCriteria", jobId: input.workItemId, sessionId: sid },
          );
        }
        return { raw: null, lastErr: new Error("session.prompt no disponible") };
      };
      // Ola 16: promptWith lleva el costo adentro (1 llamada lógica = 1
      // conteo, ortogonal), conserva el lastErr para el mensaje de skip y
      // re-lanza not-found para que el helper renueve la sesión UNA vez.
      let specLadderErr: unknown = null;
      const promptWithSpecSession = async (sid: string): Promise<string | null> => {
        let out: { raw: string | null; lastErr: unknown };
        try {
          out = await promptInSessionWithCost(input.workItemId, () => runSpecLadder(sid), promptText, input.model);
        } catch {
          out = { raw: null, lastErr: new Error("cost wrapper fallo") };
        }
        if (out.raw) return out.raw;
        specLadderErr = out.lastErr;
        if (isSessionNotFoundError(out.lastErr)) throw out.lastErr;
        return null;
      };
      let raw: string | null = null;
      try {
        // Ola 16: resume la sesión spec de este job (renovación lazy +1).
        // Cotas Regla 7: ≤1 create y ≤2 prompts por llamada (ver helper).
        raw = (
          await promptInAgentSession({
            jobId: input.workItemId,
            role: "spec",
            create: createSpecSession,
            promptWith: promptWithSpecSession,
            expectAgent: "spec",
            getAgent: (sid: string) => readSessionAgent(sessionAny, sid),
          })
        ).res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Create marcado → MISMO skip byte a byte que antes de Ola 16.
        if (msg.startsWith("spec session.create")) return skip(msg);
        // El helper solo lanza not-found del 2º intento: conserva la forma
        // `spec prompt fallo: ...` de siempre (caso nuevo, misma forma).
        return skip(`spec prompt fallo: ${msg.slice(0, 120)}`);
      }
      const lastErr = specLadderErr;
      if (!raw) {
        const msg = lastErr instanceof Error ? lastErr.message : lastErr ? String(lastErr) : "sin respuesta";
        return skip(`spec prompt fallo: ${msg.slice(0, 120)}`);
      }
      try {
        const parsed = parseSpecLLMResponse(raw);
        return {
          brief: {
            summary: parsed.summary,
            acceptanceCriteria: parsed.acceptanceCriteria,
            targetFiles: parsed.targetFiles ?? [],
            trivial: parsed.trivial,
            openQuestions: parsed.openQuestions ?? [],
          },
          raw,
          skipped: false,
          skipReason: null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return skip(`spec zod parse fallo: ${msg.slice(0, 120)}`, raw);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { brief: null, raw: null, skipped: true, skipReason: `spec unexpected: ${msg.slice(0, 120)}` };
    }
  }
}

export const specAgent = new SpecAgent();
