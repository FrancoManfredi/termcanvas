/**
 * ReviewAgent — flujo simple (sin reintentos).
 * Revisor LLM read-only: tools read/glob/grep SIN write/edit/bash.
 * UN solo turno por consume, sin repair retry ni fallback de modelo:
 * cualquier fallo → ask_human parado en Review (nunca throw).
 * Usa OpencodeServerManager (dueño único server efímero) + SDK v2.
 */

import fs from "node:fs";
import path from "node:path";
import type { ModelRef } from "../../shared/types/workItem";
import type { VerificationReport } from "../../shared/types/implement";
import type { ReviewResult } from "../../shared/types/review";
import {
  buildAskHumanResult,
} from "../../shared/types/review";
import { buildReviewPrompt, parseReviewLLMResponse, reviewJsonSchema } from "./reviewPrompt";
import { structuredFormat } from "../llm/structuredOutput";
import { isRetryableTransportError } from "../llm/agentTransport";
import {
  SESSION_CREATE_FUSE_MS,
  attemptJsonPromptOnce,
  parseSessionId,
  withTransportRetry,
} from "../llm/agentTransport";
import { opencodeServerManager, ensureAgentTurnClient } from "../opencodeServerManager";
import { READONLY_TOOLS, toolsetFor } from "../runner/toolPolicy";
import { promptInSessionWithCost } from "../cost/promptWithCost";
import { isSessionNotFoundError, promptInAgentSession, readSessionAgent } from "../sessions/agentSessions";
import { getSkillOrNull, SKILL_MAX_BYTES } from "../factory/agentLoader";
import { sessionAgentArgs } from "../factory/opencodeAgentSync";
import { detectVisualEvidence } from "../implement/verification";
import { workItemStore } from "../workItem/workItemStore";

// Turnos LLM sin timeout por fase (doctrina agentTransport): el turno vive
// hasta el fusible global GLOBAL_AGENT_FUSE_MS — el timeout corto mataba
// turnos sanos (evidencia 2026-09-07: prompt trivial tarda ~31s mínimo).

/** Salida de consume: resultado validado + respuesta cruda para diagnóstico en disco. */
export interface ReviewConsumeOutput {
  result: ReviewResult;
  raw: string | null;
}

/**
 * Helper puro y testeable — Ola 5 Review blindado.
 * True SOLO para errores de transporte donde el reenvío es seguro (la
 * request nunca se estableció): string vacío, `{}`, econn/fetch/
 * UnknownError/"unexpected server error".
 * FALSE ante timeout/abort (el modelo seguía pensando: reenviar clona el
 * mensaje en la sesión) y ante errores de validación zod (no reintentables).
 * También alimenta `isFallbackableReviewError`: ante timeout NO se prueba
 * otro modelo (nada malo tiene el modelo; reenviar duplica igual).
 */
export function isRetryableReviewError(msg: string): boolean {
  try {
    return isRetryableTransportError(msg);
  } catch {
    return false;
  }
}

/** Flujo simple: sin fallback de modelo (cualquier error → ask_human parado). */

// Tools read-only Gao §T02 — fuente única en runner/toolPolicy (SIN write/edit/bash).
// Re-export por compat: el literal vive en toolPolicy.
export const REVIEW_TOOLS: Record<string, boolean> = { ...READONLY_TOOLS };

// ── Skills del reviewer (Ola 10, solo integración: sin cambiar semántica) ──

export interface ResolvedReviewSkills {
  skills: {
    codeReview?: string;
    repoConventions?: string;
    uiVerification?: string;
  };
  names: string[];
}

/**
 * Superficie visual: reutiliza el predicado existente de verification.ts
 * sobre createdFiles, o la evidence visual si ya existe. Puro, nunca lanza.
 */
export function hasVisualSurface(
  createdFiles?: string[],
  verification?: VerificationReport | null,
): boolean {
  try {
    if (detectVisualEvidence(createdFiles ?? [])) return true;
    const evidence = verification?.evidence ?? [];
    return evidence.some((e) => e?.kind === "visual");
  } catch {
    return false;
  }
}

/**
 * Override del proyecto (`<worktree>/.agents/skills/repo-conventions.md`):
 * único contenido dinámico por issue; el slim lo conserva mientras los
 * cuerpos estáticos viajan por la tool `skill`. Best-effort con tope 8KB.
 * Nunca lanza.
 */
export function loadRepoConventionsOverride(worktreePath: string): string | null {
  try {
    const overridePath = path.join(
      path.resolve(worktreePath),
      ".agents",
      "skills",
      "repo-conventions.md",
    );
    if (!fs.existsSync(overridePath)) return null;
    const raw = fs.readFileSync(overridePath, "utf-8");
    if (!raw || raw.trim().length === 0) return null;
    return raw.trim().slice(0, SKILL_MAX_BYTES);
  } catch {
    return null;
  }
}

/**
 * Convención del repo = default del factory + override por proyecto.
 * Si existe `<worktree>/.agents/skills/repo-conventions.md` se ANTEPONE
 * al default del factory. Best-effort con tope 8KB: null si no hay nada.
 * Nunca lanza.
 */
export function loadRepoConventionsSkill(worktreePath: string): string | null {
  try {
    let base = "";
    try {
      base = (getSkillOrNull("repo-conventions")?.body ?? "").trim();
    } catch {
      base = "";
    }
    const override = loadRepoConventionsOverride(worktreePath) ?? "";
    if (!base && !override) return null;
    if (override && base) return `${override}\n\n---\n\n${base}`;
    return override || base;
  } catch {
    return null;
  }
}

/**
 * Resuelve las skills del review: code-review SIEMPRE, repo-conventions
 * SIEMPRE (factory+override), ui-verification SOLO con superficie visual.
 * Cada faltante se omite (el prompt pone la nota base). Nunca lanza.
 */
export function resolveReviewSkills(input: {
  worktreePath: string;
  createdFiles?: string[];
  verification?: VerificationReport | null;
}): ResolvedReviewSkills {
  const skills: ResolvedReviewSkills["skills"] = {};
  const names: string[] = [];
  try {
    const codeReview = getSkillOrNull("code-review")?.body;
    if (typeof codeReview === "string" && codeReview.trim().length > 0) {
      skills.codeReview = codeReview;
      names.push("code-review");
    }
  } catch {}
  try {
    const repoConventions = loadRepoConventionsSkill(input.worktreePath);
    if (typeof repoConventions === "string" && repoConventions.trim().length > 0) {
      skills.repoConventions = repoConventions;
      names.push("repo-conventions");
    }
  } catch {}
  try {
    if (hasVisualSurface(input.createdFiles, input.verification)) {
      const uiVerification = getSkillOrNull("ui-verification")?.body;
      if (typeof uiVerification === "string" && uiVerification.trim().length > 0) {
        skills.uiVerification = uiVerification;
        names.push("ui-verification");
      }
    }
  } catch {}
  return { skills, names };
}

export interface ReviewAgentInput {
  workItemId: string;
  worktreePath: string;
  reviewerModel: ModelRef;
  reviewAttempt: number;
  prompt: string;
  builderModelRef?: ModelRef;
  createdFiles?: string[];
  verification?: VerificationReport | null;
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
let promptMock: ((input: ReviewAgentInput) => Promise<string | null>) | null = null;
export function setReviewPromptMock(fn: ((input: ReviewAgentInput) => Promise<string | null>) | null): void {
  promptMock = fn;
}

/**
 * Payload PLANO para SDK v2 `Session.prompt`
 * (POST /session/{sessionID}/message): buildClientParams reparte keys
 * planas (`sessionID`→path, resto→body). `format` viaja en body con el
 * schema (structured output del servidor, SDK 1.18.29 + binario 1.18.29).
 * Corrección 2026-09-07 a la nota previa: el SDK no "dropeaba" nada — el
 * envelope `{path:{id},body}` es forma v1 (v2 usa `path.sessionID`) y
 * `json_schema` top-level era clave desconocida (ignorada, correcto es
 * `body.format`). El camino de texto queda como red ante todo.
 * Puro, nunca lanza (el caller valida).
 */
export function buildReviewPromptPayload(
  sid: string,
  model: ModelRef,
  promptText: string,
): Record<string, unknown> {
  return {
    sessionID: sid,
    model: { providerID: model.providerID, modelID: model.modelID },
    tools: { ...toolsetFor("review") } as unknown as Record<
      string,
      unknown
    >,
    // Identidad ejecutante del turno (el agent del create solo etiqueta).
    ...sessionAgentArgs("review"),
    parts: [{ type: "text", text: promptText }],
    // Structured output del servidor (body.format): el modelo devuelve el
    // objeto validado en info.structured; el camino de texto (extract +
    // repair + ask_human) queda como red.
    format: structuredFormat(reviewJsonSchema),
  };
}

export class ReviewAgent {
  async consume(input: ReviewAgentInput): Promise<ReviewConsumeOutput> {
    const attempt = Math.max(1, input.reviewAttempt);
    const askHuman = (summary: string, confidence = 0.5): ReviewResult =>
      buildAskHumanResult({
        workItemId: input.workItemId,
        reviewerModel: input.reviewerModel,
        reviewAttempt: attempt,
        summary,
        confidence,
      });
    // El review NUNCA corrió (fallo de infra/proveedor): mismo ask_human
    // pero marcado para que el Accept humano no complete a ciegas
    // (POST review/accept → 409) y la UI ofrezca reintentar.
    const askHumanInfra = (summary: string): ReviewResult =>
      buildAskHumanResult({
        workItemId: input.workItemId,
        reviewerModel: input.reviewerModel,
        reviewAttempt: attempt,
        summary,
        confidence: 0.5,
        isInfraError: true,
      });
    const pack = (result: ReviewResult, raw: string | null): ReviewConsumeOutput => ({ result, raw });

    // Sin resolución de skills: el turno lleva solo datos y las reglas
    // viven en el system prompt del espejo. Nada se inyecta ni se traza.

    // Turno con config fresca: singleton si sigue vigente; server scopeado
    // recién nacido si la config de agentes cambió (fix PLATANO fuera del engine).
    let closeTurn: () => void = () => {};
    try {
      // Mock de tests
      if (promptMock) {
        let mocked: string | null = null;
        try {
          mocked = await promptMock(input);
          if (!mocked) return pack(askHuman("mock sin respuesta — ask_human"), null);
          const parsed = parseReviewLLMResponse(mocked);
          return pack(
            {
              workItemId: input.workItemId,
              reviewerModel: input.reviewerModel,
              verdict: parsed.verdict,
              confidence: parsed.confidence,
              summary: parsed.summary,
              findings: parsed.findings ?? [],
              reviewAttempt: attempt,
              reviewedAt: new Date().toISOString(),
            },
            mocked,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return pack(askHuman(`mock parse fallo: ${msg.slice(0, 160)}`), mocked);
        }
      }

      const ok = await hasSdk();
      if (!ok) return pack(askHumanInfra("SDK no detectado — ask_human sin gastar LLM"), null);

      // Turno flaco: se decide abajo (tras resolver el cliente) según si el
      // server confirma al agente review. Sin confirmación → completo.

      let client: {
        session: {
          create: (o: unknown) => Promise<unknown>;
          prompt?: (a: unknown, b?: unknown) => Promise<unknown>;
          promptAsync?: (o: unknown) => Promise<unknown>;
        };
      };
      try {
        const turn = await ensureAgentTurnClient();
        client = turn.client as unknown as typeof client;
        closeTurn = turn.close;
      } catch (e) {
        const existing = opencodeServerManager.getClient() as unknown as typeof client | null;
        if (!existing) {
          const msg = e instanceof Error ? e.message : String(e);
          return pack(askHumanInfra(`opencode server no disponible: ${msg.slice(0, 140)}`), null);
        }
        client = existing;
      }

      // Turno flaco: las reglas y el contrato de salida viven en el system
      // prompt del espejo (factory/agents/review/agent.md); el turno lleva
      // id + prompt + worktree (+ override). El reviewer descubre el cambio
      // con read/glob/grep, sin CreatedFiles, diff, verificación ni cierre.
      const promptText = buildReviewPrompt(
        {
          id: input.workItemId,
          prompt: input.prompt,
          worktree: path.resolve(input.worktreePath),
          ...(input.builderModelRef ? { modelRef: input.builderModelRef } : {}),
        },
        {
          reviewAttempt: attempt,
          reviewerModel: input.reviewerModel,
          repoOverride: loadRepoConventionsOverride(input.worktreePath) ?? undefined,
        },
      );

      const directory = path.resolve(input.worktreePath);
      const title = `Review ${input.workItemId} intento ${attempt}`;
      // Ola 16: create extraído a closure byte a byte (título, directorio,
      // doble forma y extracción intactos). El fallo LANZA el MISMO mensaje
      // que antes iba al ask_human, marcado con el prefijo
      // `review session.create fallo:` para que el pack de abajo devuelva el
      // MISMO ask_human byte a byte. El mock previo no se toca.
      const createReviewSession = async (): Promise<string> => {
        let sessionId: string | null = null;
        try {
          const res: unknown = await withTransportRetry(
            // Identidad de fase (ver sessionAgentArgs): cae al shape plano si el server la rechaza.
            () => client.session.create({ title, directory, ...sessionAgentArgs("review") }),
            SESSION_CREATE_FUSE_MS,
            "review session.create",
          );
          sessionId = parseSessionId(res);
          if (!sessionId) throw new Error("session.create sin sessionId");
        } catch {
          try {
            const res2: unknown = await withTransportRetry(
              () => client.session.create({ body: { title, directory } }),
              SESSION_CREATE_FUSE_MS,
              "review session.create body",
            );
            sessionId = parseSessionId(res2);
            if (!sessionId) throw new Error("session.create sin sessionId (fallback)");
          } catch (e2) {
            const msg = e2 instanceof Error ? e2.message : String(e2);
            throw new Error(`review session.create fallo: ${msg.slice(0, 140)}`);
          }
        }
        if (!sessionId) throw new Error("review session.create fallo: session.create sin sessionId");
        return sessionId;
      };

      const sessionAny = client.session as unknown as Record<string, unknown>;
      const promptFn = sessionAny.prompt as ((a: unknown, b?: unknown) => Promise<unknown>) | undefined;
      if (typeof promptFn !== "function") {
        return pack(askHumanInfra("session.prompt no disponible — ask_human"), null);
      }

      // Payload plano SDK-compatible (ver buildReviewPromptPayload): la
      // escalera de 4 formas (sync path/body → sync legacy → async
      // path/body → async legacy) se eliminó — las formas `{path,body}`
      // hacen 500 instantáneo y promptAsync devuelve un handle (texto null,
      // error null — nunca la respuesta; probe S4 2026-09-07). Una forma
      // que funciona con timeout real supera a cuatro rotas.
      // Doctrina agentTransport: UN intento por turno, abort ante timeout,
      // cero reenvíos; fallback de structured→texto en el helper único.
      const runLadderInner = async (sid: string, model: ModelRef, text?: string): Promise<{ raw: string | null; lastErr: unknown }> => {
        const useText = typeof text === "string" && text.length > 0 ? text : promptText;
        const full = buildReviewPromptPayload(sid, model, useText);
        return attemptJsonPromptOnce(
          (signal, payload) =>
            (promptFn as (a: unknown, b: unknown) => Promise<unknown>).call(
              client.session,
              payload,
              { signal },
            ),
          { payload: full, label: "review session.prompt", preferKey: "verdict", jobId: input.workItemId, sessionId: sid },
        );
      };

      // Ola 16: el fallo de create ya trae el mensaje final de ask_human
      // (prefijo `review session.create fallo:`): no aplica fallback de
      // modelo (antes era return temprano) y el pack de abajo lo devuelve
      // byte a byte. Puro, nunca lanza.
      const isReviewCreateFailure = (e: unknown): boolean => {
        try {
          const m = e instanceof Error ? e.message : String(e ?? "");
          return m.startsWith("review session.create fallo:");
        } catch {
          return false;
        }
      };

      // Ola 16 — DECISIÓN DEL WRAP (documentada): UNA llamada al helper POR
      // INTENTO (por modelo), no por llamada a consume(). Cada intento resume
      // la sesión review del job (≤1 create + ≤2 prompts por intento, ver
      // helper); el fallback de modelo corre sobre la (posiblemente renovada)
      // sesión; el re-review entre turnos la reutiliza porque cada consume()
      // resume la misma (job, review). Envolver por llamada obligaría a meter
      // el fallback de modelo adentro de promptWith (hasta 4 prompts por
      // renewal, contra el espíritu de las cotas). El costo de Ola 15 queda
      // ADENTRO de promptWith (1 intento = 1 llamada lógica = 1 conteo).
      const runLadder = async (model: ModelRef, text?: string): Promise<{ raw: string | null; lastErr: unknown }> => {
        const promptWithReviewSession = async (
          sid: string,
        ): Promise<{ raw: string | null; lastErr: unknown }> => {
          let out: { raw: string | null; lastErr: unknown };
          try {
            out = await promptInSessionWithCost(input.workItemId, () => runLadderInner(sid, model, text), typeof text === "string" && text.length > 0 ? text : promptText, model);
          } catch (e) {
            out = { raw: null, lastErr: e };
          }
          if (out.raw) return out;
          if (isSessionNotFoundError(out.lastErr)) throw out.lastErr;
          return out;
        };
        try {
          // Ola 16: resume la sesión review de este job (renovación lazy +1).
          return (
            await promptInAgentSession({
              jobId: input.workItemId,
              role: "review",
              create: createReviewSession,
              promptWith: promptWithReviewSession,
              expectAgent: "review",
              getAgent: (sid: string) => readSessionAgent(sessionAny, sid),
            })
          ).res;
        } catch (e) {
          return { raw: null, lastErr: e };
        }
      };

      // Flujo simple: UN solo turno con el modelo primario, sin fallback de
      // modelo ni repair retry. Cualquier fallo → ask_human parado en Review.
      const primary = input.reviewerModel;
      const first = await runLadder(primary);
      const raw: string | null = first.raw;
      const lastErr: unknown = first.lastErr;
      const effectiveModel: ModelRef = primary;

      if (!raw) {
        const msg = lastErr instanceof Error ? lastErr.message : lastErr ? String(lastErr) : "sin respuesta";
        // Ola 16: el create marcado ya trae el ask_human final byte a byte.
        if (isReviewCreateFailure(lastErr)) return pack(askHumanInfra(msg), null);
        return pack(askHumanInfra(`review prompt fallo: ${msg.slice(0, 160)}`), null);
      }
      try {
        const parsed = parseReviewLLMResponse(raw);
        return pack(
          {
            workItemId: input.workItemId,
            reviewerModel: effectiveModel,
            verdict: parsed.verdict,
            confidence: parsed.confidence,
            summary: parsed.summary,
            findings: parsed.findings ?? [],
            reviewAttempt: attempt,
            reviewedAt: new Date().toISOString(),
          },
          raw,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Sin repair retry: parse fallido → ask_human honesto con raw.
        return pack(askHumanInfra(`review zod parse fallo: ${msg.slice(0, 1000)}`), raw);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        result: buildAskHumanResult({
          workItemId: input.workItemId,
          reviewerModel: input.reviewerModel,
          reviewAttempt: attempt,
          summary: `review unexpected: ${msg.slice(0, 160)}`,
          isInfraError: true,
        }),
        raw: null,
      };
    } finally {
      // Teardown del server efímero del turno (no-op si corrió en el singleton).
      try {
        closeTurn();
      } catch {
        // best-effort
      }
    }
  }
}

export const reviewAgent = new ReviewAgent();
