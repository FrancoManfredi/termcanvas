/**
 * TriageAgent — Ola 8.
 * Clasificador LLM read-only: tools read/glob/grep SIN write/edit/bash.
 * Timeout 20s + 1 retry, parse fences→zod, cualquier fallo → fallback building
 * (fallo-sano: nunca bloquea, nunca lanza).
 * Espeja el esqueleto de llamada/parse/timeout de reviewAgent sin su lógica.
 * Usa OpencodeServerManager (dueño único server efímero) + SDK v2.
 * Modelo: el modelRef del job (mismo modelo; disjoint solo aplica a REVIEW).
 */

import path from "node:path";
import type { ModelRef } from "../../shared/types/workItem";
import type { TriageFindings } from "../../shared/types/triage";
import { buildFallbackTriageFindings } from "../../shared/types/triage";
import { buildTriagePrompt, parseTriageLLMResponse, triageJsonSchema } from "./triagePrompt";
import { structuredFormat } from "../llm/structuredOutput";
import {
  SESSION_CREATE_FUSE_MS,
  attemptJsonPromptOnce,
  parseSessionId,
  withTransportRetry,
} from "../llm/agentTransport";
import { opencodeServerManager } from "../opencodeServerManager";
import { READONLY_TOOLS, toolsetFor } from "../runner/toolPolicy";
import { sessionAgentArgs } from "../factory/opencodeAgentSync";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { isSessionNotFoundError, promptInAgentSession, readSessionAgent } from "../sessions/agentSessions";
import { TAG_TRIAGE_REPAIR, withPhaseTag } from "../llm/phaseTags";

/**
 * Repair prompt (1 retry ante parse fallo, paridad reviewAgent): la sesión
 * ya tiene la clasificación hecha — solo se exige el reenvío del bloque
 * JSON, sin re-ejecutar nada. La prosa puede quedar; el bloque es obligatorio.
 */
const TRIAGE_REPAIR_PROMPT = [
  "Tu respuesta anterior NO trajo el bloque JSON de la clasificación (llegó sin objeto parseable).",
  "No re-ejecutes nada, no uses tools: repetí tu clasificación y cerrá con UN bloque ```json",
  'con keys exactas {"decision","scope","complexity","openQuestions","reason","confidence"}.',
].join("\n");

// Tools read-only — fuente única en runner/toolPolicy (SIN write/edit/bash).
// Re-export por compat con suites (triage-spec): el literal vive en toolPolicy.
export const TRIAGE_TOOLS: Record<string, boolean> = { ...READONLY_TOOLS };

export interface TriageAgentInput {
  workItemId: string;
  worktreePath: string;
  model: ModelRef;
  prompt: string;
}

export interface TriageConsumeOutput {
  findings: TriageFindings;
  raw: string | null;
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
let promptMock: ((input: TriageAgentInput) => Promise<string | null>) | null = null;
export function setTriagePromptMock(fn: ((input: TriageAgentInput) => Promise<string | null>) | null): void {
  promptMock = fn;
}

export class TriageAgent {
  async consume(input: TriageAgentInput): Promise<TriageConsumeOutput> {
    const fallback = (): TriageConsumeOutput => ({ findings: buildFallbackTriageFindings(), raw: null });
    const packFallback = (raw: string | null): TriageConsumeOutput => ({
      findings: buildFallbackTriageFindings(),
      raw,
    });

    try {
      // Mock de tests
      if (promptMock) {
        let mocked: string | null = null;
        try {
          mocked = await promptMock(input);
          if (!mocked) return packFallback(null);
          const parsed = parseTriageLLMResponse(mocked);
          return {
            findings: {
              decision: parsed.decision,
              scope: parsed.scope ?? "",
              complexity: parsed.complexity,
              openQuestions: parsed.openQuestions ?? [],
              reason: parsed.reason,
              confidence: parsed.confidence,
            },
            raw: mocked,
          };
        } catch {
          return packFallback(mocked);
        }
      }

      const ok = await hasSdk();
      if (!ok) return fallback();

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
        if (!existing) return fallback();
        client = existing;
      }

      // Turno único de datos: las reglas viven en el system prompt del espejo
      // (factory/agents/triage/agent.md), el turno lleva solo id + issue + cierre.
      const promptText = buildTriagePrompt(
        {
          id: input.workItemId,
          prompt: input.prompt,
          worktree: path.resolve(input.worktreePath),
          modelRef: input.model,
        },
        undefined,
      );

      const directory = path.resolve(input.worktreePath);
      const title = `Triage ${input.workItemId}`;
      // Ola 16: create extraído a closure byte a byte (título, timeouts y
      // doble intento intactos). El fallo LANZA (antes: `return fallback()`);
      // el catch de abajo lo convierte al MISMO fallback, y el helper puede
      // renovar la sesión ante daemon reiniciado. El mock previo no se toca.
      const createTriageSession = async (): Promise<string> => {
        try {
          const res: unknown = await withTransportRetry(
            // Identidad de fase (ver sessionAgentArgs): cae al shape plano si el server la rechaza.
            () => client.session.create({ title, directory, ...sessionAgentArgs("triage") }),
            SESSION_CREATE_FUSE_MS,
            "triage session.create",
          );
          const sessionId = parseSessionId(res);
          if (!sessionId) throw new Error("session.create sin sessionId");
          return sessionId;
        } catch {
          const res2: unknown = await withTransportRetry(
            () => client.session.create({ body: { title, directory } }),
            SESSION_CREATE_FUSE_MS,
            "triage session.create body",
          );
          const sessionId = parseSessionId(res2);
          if (!sessionId) throw new Error("triage session.create sin sessionId");
          return sessionId;
        }
      };

      const sessionAny = client.session as unknown as Record<string, unknown>;
      const promptFn = sessionAny.prompt as ((a: unknown, b?: unknown) => Promise<unknown>) | undefined;
      const promptAsyncFn = sessionAny.promptAsync as ((o: unknown) => Promise<unknown>) | undefined;
      if (typeof promptFn !== "function" && typeof promptAsyncFn !== "function") {
        return fallback();
      }

      const body = {
        model: { providerID: input.model.providerID, modelID: input.model.modelID },
        tools: toolsetFor("triage") as unknown as Record<string, unknown>,
        // Identidad ejecutante del turno (el agent del create solo etiqueta).
        ...sessionAgentArgs("triage"),
        parts: [{ type: "text", text: promptText }],
        // Structured output del servidor (body.format): el modelo devuelve
        // el objeto validado en info.structured; el camino de texto queda
        // como red. `json_schema` top-level era clave desconocida (ignorada).
        format: structuredFormat(triageJsonSchema),
      };

      // Forma ÚNICA plana SDK-compatible (paridad reviewAgent +
      // evidencia viva: el envelope {path,body} hace 500 instantáneo y
      // promptAsync devuelve un handle, nunca texto — los rungs legacy
      // duplicados reenviaban la definición+prompt enteros hasta 4 veces
      // por intento). Un shape que funciona supera a cuatro rotos.
      // Doctrina agentTransport: UN intento por turno — ante timeout/abort
      // (el modelo sigue pensando) se aborta y NO se reenvía; solo un error
      // de transporte justifica el reintento interno.
      // `text` = override para el repair retry (misma sesión, solo el
      // reenvío JSON, sin re-ejecutar nada).
      const runTriageLadder = async (sid: string, text?: string): Promise<{ raw: string | null; lastErr: unknown }> => {
        if (typeof promptFn !== "function") {
          return { raw: null, lastErr: new Error("session.prompt no disponible") };
        }
        const useText = typeof text === "string" && text.length > 0 ? text : promptText;
        const full = { sessionID: sid, ...body, parts: [{ type: "text", text: useText }] };
        // Servidor viejo (sin `format`): 400 OutputFormat → memo por
        // proceso + UN reintento en texto plano en el acto (helper único).
        return attemptJsonPromptOnce(
          (signal, payload) =>
            // Plano SDK v2: buildClientParams reparte keys planas.
            (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(
              client.session,
              payload,
              { signal },
            ),
          { payload: full, label: "triage session.prompt", preferKey: "decision", jobId: input.workItemId, sessionId: sid },
        );
      };
      // Ola 16: promptWith lleva el costo adentro (1 llamada lógica = 1
      // conteo, ortogonal) y re-lanza not-found para que el helper renueve
      // la sesión UNA vez; cualquier otro null/fallo cae al fallback sano.
      const promptWithTriageSession = async (sid: string, text?: string): Promise<string | null> => {
        let out: { raw: string | null; lastErr: unknown };
        try {
          const useText = typeof text === "string" && text.length > 0 ? text : promptText;
          out = await promptInSessionWithCost(input.workItemId, () => runTriageLadder(sid, text), useText, input.model);
        } catch (e) {
          out = { raw: null, lastErr: e };
        }
        if (out.raw) return out.raw;
        if (isSessionNotFoundError(out.lastErr)) throw out.lastErr;
        return null;
      };
      let raw: string | null = null;
      try {
        // Ola 16: resume la sesión triage de este job (renovación lazy +1).
        // Cotas Regla 7: ≤1 create y ≤2 prompts por llamada (ver helper).
        raw = (
          await promptInAgentSession({
            jobId: input.workItemId,
            role: "triage",
            create: createTriageSession,
            promptWith: promptWithTriageSession,
            expectAgent: "triage",
            getAgent: (sid: string) => readSessionAgent(sessionAny, sid),
          })
        ).res;
      } catch {
        raw = null;
      }
      if (!raw) return fallback();
      try {
        const parsed = parseTriageLLMResponse(raw);
        return {
          findings: {
            decision: parsed.decision,
            scope: parsed.scope ?? "",
            complexity: parsed.complexity,
            openQuestions: parsed.openQuestions ?? [],
            reason: parsed.reason,
            confidence: parsed.confidence,
          },
          raw,
        };
      } catch {
        // Repair retry (1 vez, misma sesión): el triage suele narrar pese
        // a la instrucción de formato. Antes de caer al fallback se le
        // pide UNA vez que devuelva SOLO el JSON, sin re-ejecutar nada.
        // Solo si esto también falla → fallback building honesto.
        try {
          const repaired = (
            await promptInAgentSession({
              jobId: input.workItemId,
              role: "triage",
              create: createTriageSession,
              promptWith: (sid: string) => promptWithTriageSession(sid, withPhaseTag(TRIAGE_REPAIR_PROMPT, TAG_TRIAGE_REPAIR)),
              expectAgent: "triage",
              getAgent: (sid: string) => readSessionAgent(sessionAny, sid),
            })
          ).res;
          if (repaired) {
            try {
              const parsedRepair = parseTriageLLMResponse(repaired);
              return {
                findings: {
                  decision: parsedRepair.decision,
                  scope: parsedRepair.scope ?? "",
                  complexity: parsedRepair.complexity,
                  openQuestions: parsedRepair.openQuestions ?? [],
                  reason: parsedRepair.reason,
                  confidence: parsedRepair.confidence,
                },
                raw: repaired,
              };
            } catch {
              // el repair tampoco parseó: cae al fallback de abajo
            }
          }
        } catch {
          // renovación/sesión fallida: cae al fallback de abajo
        }
        return packFallback(raw);
      }
    } catch {
      return { findings: buildFallbackTriageFindings(), raw: null };
    }
  }
}

export const triageAgent = new TriageAgent();
