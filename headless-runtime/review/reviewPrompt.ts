/**
 * ReviewPrompt — Ola 4.
 * Prompt revisor con json_schema strict + parse robusto fences→zod.
 * Puro, sin I/O, testeable.
 */

import { z } from "zod";
import { stripScopeBoilerplate } from "../../shared/scope";
import type { ModelRef, WorkItem } from "../../shared/types/workItem";
import type { VerificationReport } from "../../shared/types/implement";
import {
  ReviewLLMResponseSchema,
  type ReviewLLMResponse,
} from "../../shared/types/review";

import { extractBalancedJSONObject } from "../llm/jsonExtract";
import { tagReview, withPhaseTag } from "../llm/phaseTags";

export { ReviewLLMResponseSchema, type ReviewLLMResponse };

/**
 * json_schema strict para session.prompt (SDK v2).
 * Obliga a {verdict, confidence, summary, findings[≤20]}.
 */
export const reviewJsonSchema = {
  type: "object" as const,
  properties: {
    verdict: {
      type: "string" as const,
      enum: ["accept", "revise", "ask_human"],
      description:
        "accept = cumple requirements+tests+security; revise = hay major/blocker que Building debe corregir; ask_human = ambiguo o fuera de alcance",
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "Confianza 0..1 — accept 0.8-0.9, revise 0.7-0.9, ask_human 0.4-0.6",
    },
    summary: {
      type: "string" as const,
      description: "Resumen humano 1-3 frases en español rioplatense neutro",
    },
    findings: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, description: "id único ej f1, f2" },
          axis: {
            type: "string" as const,
            enum: ["requirements", "tests", "security"],
          },
          severity: {
            type: "string" as const,
            enum: ["info", "minor", "major", "blocker"],
          },
          file: { type: "string" as const, description: "path relativo opcional" },
          line: { type: "number" as const, description: "línea opcional" },
          message: { type: "string" as const, description: "qué está mal" },
          suggestion: { type: "string" as const, description: "cómo corregirlo" },
        },
        required: ["id", "axis", "severity", "message"] as const,
        additionalProperties: false as const,
      },
    },
  },
  required: ["verdict", "confidence", "summary", "findings"] as const,
  additionalProperties: false as const,
};

export interface ReviewPromptContext {
  /** @deprecated Turno flaco: se ignora, el reviewer descubre archivos con read/glob/grep. */
  createdFiles?: string[];
  /** @deprecated Turno flaco: se ignora, sin verificación en el turno. */
  verification?: VerificationReport | null;
  reviewAttempt?: number;
  reviewerModel?: ModelRef;
  /**
   * Override del proyecto (`<worktree>/.agents/skills/repo-conventions.md`):
   * único contenido dinámico por issue además del prompt.
   */
  repoOverride?: string;
  /**
   * @deprecated Turno flaco: se ignora, sin diff en el turno.
   * El reviewer descubre el cambio con read/glob/grep.
   */
  diffBlock?: string;
}

/**
 * Construye el turno del revisor: solo datos (las reglas viven en el espejo
 * factory/agents/review/agent.md). Turno flaco: id + prompt + worktree
 * (+ override del proyecto si hay). Sin CreatedFiles, sin diff, sin
 * verificación, sin evidencia y sin cierre orientador: el contrato de
 * salida vive en el espejo.
 */
export function buildReviewPrompt(
  workItem: Pick<WorkItem, "id" | "prompt" | "worktree" | "modelRef">,
  ctx: ReviewPromptContext = {},
): string {
  const attempt = ctx.reviewAttempt ?? 1;
  const promptBlock = (workItem.prompt ?? "").slice(0, 4000) || "(vacío)";

  // Turno único de datos: el agente (system prompt del espejo con ejes y
  // severidades de factory/agents/review/agent.md) ya sabe revisar y
  // descubrir el cambio con read/glob/grep; el turno lleva id, issue,
  // worktree actual, override del proyecto y el shape del cierre (las keys
  // exactas viven acá, no en el body: una sola fuente).
  const overrideText = typeof ctx.repoOverride === "string" ? ctx.repoOverride.trim() : "";
  const slim = [
    `WorkItem: ${workItem.id}`,
    `Prompt original: """${stripScopeBoilerplate(promptBlock)}"""`,
    `Worktree: ${workItem.worktree}`,
    ...(overrideText ? [`## Override del proyecto\n${overrideText}`] : []),
    "",
    "Cerrá con UN bloque ```json con las keys exactas:",
    '{"verdict": "accept|revise|ask_human", "confidence": 0.85, "summary": "...", "findings": [{"id": "f1", "axis": "requirements|tests|security", "severity": "info|minor|major|blocker", "file": "ruta", "message": "...", "suggestion": "..."}]}',
  ].join("\n");
  // Etiqueta humana de fase (primera línea): intento N visible en la sesión.
  return withPhaseTag(slim, tagReview(attempt));
}

/**
 * Extrae el objeto JSON del review desde texto mixto (prosa, ecos de
 * tool-call, fences). Delega en el extractor compartido
 * (`headless-runtime/llm/jsonExtract`) con preferencia a objetos con
 * `verdict`. Se mantiene el export por compatibilidad (tests + callers).
 * Puro, nunca lanza.
 */
export function extractReviewJSONObject(mixed: string): string | null {
  try {
    return extractBalancedJSONObject(mixed, ["verdict"]);
  } catch {
    return null;
  }
}

/**
 * Parsea respuesta cruda del LLM (strip fences, extracción por llaves
 * balanceadas con preferencia a objetos con `verdict`, luego zod) y valida.
 * Throw si inválido — el caller (reviewAgent) reintenta con repair prompt y
 * solo entonces cae a ask_human.
 */
export function parseReviewLLMResponse(raw: string): ReviewLLMResponse {
  if (!raw || typeof raw !== "string") throw new Error("review LLM response vacía");
  let s = raw.trim();
  if (s.length === 0) throw new Error("review LLM response vacía");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    s = fence[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  const extracted = extractReviewJSONObject(s);
  if (extracted === null) {
    throw new Error(`review JSON parse error: no object — raw=${raw.slice(0, 1000)}`);
  }
  s = extracted;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(
      `review JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw=${raw.slice(0, 1000)}`,
    );
  }
  // Normalización tolerante de findings: los LLM suelen devolver id numérico
  // o omitirlo. Solo se normaliza el id (inocuo); el resto sigue estricto —
  // un finding sin message/axis/severity sigue siendo ask_human.
  // Aditivo 2026-09-07: los LLM también emiten null EXPLÍCITO en los campos
  // documentados como opcionales (file/line/suggestion/reverify). El schema
  // los declara .optional() (ausencia ok, null no), así que null se
  // normaliza a ausente ANTES del zod parse — downstream sigue viendo
  // string|undefined, cero drift de tipos. Sin esto, un finding válido con
  // "file":null volteaba todo el review a ask_human (zod invalid_type).
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { findings?: unknown }).findings)) {
    const arr = (parsed as { findings: unknown[] }).findings;
    (parsed as { findings: unknown[] }).findings = arr.map((f, i) => {
      if (!f || typeof f !== "object") return f;
      const rec = f as Record<string, unknown>;
      const id = rec.id;
      const normId =
        typeof id === "string" && id.length > 0
          ? id
          : typeof id === "number" && Number.isFinite(id)
            ? String(id)
            : `f${i + 1}`;
      const out: Record<string, unknown> = { ...rec, id: normId };
      // Combinador (idioma del repo: sin `for` escrito): null en opcionales
      // se normaliza a ausente antes del zod parse.
      (["file", "line", "suggestion", "reverify"] as const).forEach((k) => {
        try {
          if (out[k] === null) delete out[k];
        } catch {
          // noop: un finding envenenado individual lo rechaza zod abajo
        }
      });
      return out;
    });
  }
  // Validación zod (verdict/confidence/summary/findings≤20)
  const validated = ReviewLLMResponseSchema.parse(parsed);
  return {
    ...validated,
    findings: validated.findings ?? [],
  };
}

/**
 * Valida que un objeto sea ReviewLLMResponse sin lanzar fences (para tests).
 */
export function validateReviewLLMPayload(payload: unknown): ReviewLLMResponse {
  return ReviewLLMResponseSchema.parse(payload);
}

export const ReviewFindingAxisValues = ["requirements", "tests", "security"] as const;
export const ReviewSeverityValues = ["info", "minor", "major", "blocker"] as const;
export const _zKeep = z.string().optional();
