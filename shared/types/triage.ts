/**
 * Triage domain types — Ola 8.
 * Contrato daemon ↔ renderer para el pre-paso Triage-agent (Intake→Foreman).
 * Zod schemas + TypeScript types + helpers puros. Sin cambios a schemas existentes.
 */

import { z } from "zod";
import { isPactReviewJob } from "./review";

// ── Decision / Complexity ──

export const TriageDecisionSchema = z.enum(["building", "spec", "triage"]);
export type TriageDecision = z.infer<typeof TriageDecisionSchema>;

export const TriageComplexitySchema = z.enum(["trivial", "simple", "complex"]);
export type TriageComplexity = z.infer<typeof TriageComplexitySchema>;

// ── TriageFindings ──

export const TriageFindingsSchema = z.object({
  decision: TriageDecisionSchema,
  scope: z.string().max(2000),
  complexity: TriageComplexitySchema,
  openQuestions: z.array(z.string().min(1).max(500)).default([]),
  reason: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1),
  fallback: z.boolean().optional(),
});

export type TriageFindings = z.infer<typeof TriageFindingsSchema>;

/**
 * Validate TriageFindings and throw if invalid.
 */
export function validateTriageFindings(payload: unknown): TriageFindings {
  return TriageFindingsSchema.parse(payload);
}

/**
 * Fallo-sano obligatorio (lección del review): si el LLM de triage falla por
 * cualquier causa (timeout, server, parse), nunca bloquea — defiere al foreman.
 */
export function buildFallbackTriageFindings(): TriageFindings {
  return {
    decision: "building",
    scope: "",
    complexity: "simple",
    openQuestions: [],
    reason: "triage LLM no disponible, defiere al foreman",
    confidence: 0.5,
    fallback: true,
  };
}

// ── Auto-continue acotado Building→Triage→Foreman (puros, testeables) ──

/** Confianza mínima para retomar solo (sin pregunta humana). */
export const TRIAGE_AUTO_CONTINUE_MIN_CONFIDENCE = 0.8;

/** Marca en la meta de la transición Triage→Foreman automática (una vez por job). */
export const TRIAGE_AUTO_CONTINUE_META_KEY = "triageAutoContinue";

type TimelineEntry = {
  from?: unknown;
  to?: unknown;
  meta?: unknown;
};

function timelineEntries(timeline: unknown): TimelineEntry[] {
  try {
    if (!Array.isArray(timeline)) return [];
    return timeline.filter(
      (e): e is TimelineEntry => !!e && typeof e === "object" && !Array.isArray(e),
    );
  } catch {
    return [];
  }
}

function triageMetaOf(entry: TimelineEntry): Record<string, unknown> | null {
  try {
    const meta = (entry as { meta?: unknown }).meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
    return meta as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanQuestions(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];
    return value
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim());
  } catch {
    return [];
  }
}

/**
 * Últimos findings de triage válidos del timeline (meta.triage). Null si no
 * hay. Puro, nunca lanza.
 */
export function latestTriageFindings(timeline: unknown): TriageFindings | null {
  try {
    const found = timelineEntries(timeline)
      .map((e) => triageMetaOf(e)?.triage)
      .filter((t) => t !== undefined && t !== null);
    if (found.length === 0) return null;
    const parsed = TriageFindingsSchema.safeParse(found[found.length - 1]);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * ¿Ya se usó el auto-continue en este job? (marca en cualquier meta del
 * timeline). Puro, nunca lanza.
 */
export function hasTriageAutoContinueMarker(timeline: unknown): boolean {
  try {
    return timelineEntries(timeline).some(
      (e) => triageMetaOf(e)?.[TRIAGE_AUTO_CONTINUE_META_KEY] === true,
    );
  } catch {
    return false;
  }
}

/**
 * Índice de la última entrada Building→Triage (-1 si no hay). El timeline
 * es append-only: el índice ordena en tiempo. Puro, nunca lanza.
 */
export function latestBuildingToTriageIndex(timeline: unknown): number {
  try {
    return timelineEntries(timeline).reduce(
      (acc, e, i) => (e.to === "Triage" && e.from === "Building" ? i : acc),
      -1,
    );
  } catch {
    return -1;
  }
}

/**
 * ¿Hay preguntas abiertas FRESCAS (posteriores al último parking
 * Building→Triage) sin respuesta humana posterior (`triageRespond`)?
 * true = el humano todavía no contestó: regenerar preguntas gastaría una
 * llamada LLM al pedo. Puro, nunca lanza.
 */
export function hasFreshOpenQuestions(timeline: unknown): boolean {
  try {
    const list = timelineEntries(timeline);
    const parkIdx = latestBuildingToTriageIndex(timeline);
    const questionIdx = list.reduce((acc, e, i) => {
      if (i <= parkIdx) return acc;
      const questions = cleanQuestions(
        (triageMetaOf(e)?.triage as Record<string, unknown> | undefined)?.openQuestions,
      );
      return questions.length > 0 ? i : acc;
    }, -1);
    if (questionIdx < 0) return false;
    const answeredAfter = list.some((e, i) => {
      if (i <= questionIdx) return false;
      const answers = (triageMetaOf(e)?.triageRespond as Record<string, unknown> | undefined)?.answers;
      return Array.isArray(answers) && answers.length > 0;
    });
    return !answeredAfter;
  } catch {
    return false;
  }
}

/**
 * ¿El job puede retomar solo a Foreman con estos findings? Solo cuando el
 * triage dice building con confianza alta, no es fallback y nunca se usó el
 * auto-continue en este job (una vez por job, sin loops). Puro, nunca lanza.
 */
export function shouldAutoContinueFromTriage(findings: unknown, timeline: unknown): boolean {
  try {
    const parsed = TriageFindingsSchema.safeParse(findings);
    if (!parsed.success) return false;
    const f = parsed.data;
    if (f.decision !== "building") return false;
    if (f.fallback === true) return false;
    if (!(typeof f.confidence === "number") || f.confidence < TRIAGE_AUTO_CONTINUE_MIN_CONFIDENCE) {
      return false;
    }
    if (hasTriageAutoContinueMarker(timeline)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Gate pact: los pact jobs (F01–F14 + playground) ni tocan el código triage/spec.
 * Delega en isPactReviewJob (misma lista, cero literales nuevos, evita ciclo
 * implement ↔ triage).
 */
export function isPactTriageJob(params: {
  id: string;
  prompt?: string;
  worktree?: string;
}): boolean {
  return isPactReviewJob(params);
}
