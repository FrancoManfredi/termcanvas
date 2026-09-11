/**
 * Scorer domain types — Ola 11 Measure.
 * Contrato daemon ↔ renderer para scorers estilo Warp: juez LLM, 1 pregunta,
 * labels (no notas), sampling, scoring manual y re-score que reemplaza.
 * Zod schemas + TypeScript types + invariante + helpers puros.
 */

import { z } from "zod";
import { SCORER_ROLES, type ScorerRoleCanonical } from "../roles";

// ── Constants ──

/** Nombres de scorer válidos: igual que agentes/skills (anti-traversal). */
export const SCORER_NAME_PATTERN = /^[a-z0-9-]+$/i;
/** Máximo de labels por scorer (1 pregunta, pocas etiquetas). */
export const SCORER_MAX_LABELS = 10;
// Turnos del juez sin timeout por fase (doctrina agentTransport: fusible
// global GLOBAL_AGENT_FUSE_MS en headless-runtime/llm/agentTransport).

// ── ScorerLabel ──

export const ScorerLabelSchema = z.object({
  value: z.string().min(1).max(64),
  score: z.number().min(0).max(1),
  description: z.string().max(500).optional(),
});
export type ScorerLabel = z.infer<typeof ScorerLabelSchema>;

// ── ScorerDefinition ──

/**
 * Vocabulario CERRADO de roles que un scorer puede juzgar (Ola 18 P1.5,
 * decisión abierta del plan §11 resuelta: cerrado, con error accionable).
 * Mapeo rol→etapa (ver `scorerAppliesTo` en scorerEngine):
 * `review|implement|verification` exigen su etapa; `triage|spec|foreman`
 * siempre aplican (no dejan artefacto de etapa atribuible).
 *
 * FASE 1 E2 (C6/C7): re-export de `SCORER_ROLES` de `shared/roles` (fuente
 * única, orden original preservado, valores intactos).
 */
export const SCORER_AGENT_ROLES = SCORER_ROLES;
export type ScorerAgentRole = ScorerRoleCanonical;

export const ScorerDefinitionSchema = z.object({
  name: z.string().min(1).max(64).regex(SCORER_NAME_PATTERN),
  description: z.string().min(1).max(2000),
  agents: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(10)
    .superRefine((agents, ctx) => {
      agents.forEach((role, i) => {
        if (!(SCORER_AGENT_ROLES as readonly string[]).includes(role)) {
          ctx.addIssue({
            code: "custom",
            message: `agents[${i}] rol desconocido "${role}" (roles válidos: ${SCORER_AGENT_ROLES.join("|")})`,
            path: [i],
          });
        }
      });
    }),
  labels: z.array(ScorerLabelSchema).min(2).max(SCORER_MAX_LABELS),
  passingScore: z.number().min(0).max(1),
  samplingRate: z.number().int().min(0).max(100),
  model: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (s) => {
        const t = s.trim();
        const i = t.indexOf("/");
        return i > 0 && i < t.length - 1;
      },
      { message: 'model debe tener forma "provider/model"' },
    ),
  selfImprovement: z.boolean(),
});
export type ScorerDefinition = z.infer<typeof ScorerDefinitionSchema>;

// ── ScoreReason (F4-T2, PLAN-100 PARIDAD section 3.3, additive) ──

/**
 * Why a score entry looks the way it does (display-only metadata, P1.7).
 * - "scored": the judge graded the job (a ScoreResult was persisted).
 * - "sampled-out": eligible job skipped by deterministic sampling (25% default).
 * - "judge-down": the judge was attempted but failed (retryable, visible).
 * - "not-applicable": the job never reached the scorer stage (409 in manual).
 * - "unscored-legacy": entries written before F4-T2 carry no reason on disk;
 *   readers resolve them to this honest label WITHOUT rewriting history.
 * Neutral English strings; UI болса.
 */
export const SCORE_REASON_VALUES = [
  "scored",
  "sampled-out",
  "judge-down",
  "not-applicable",
  "unscored-legacy",
] as const;

/** Base enum (single vocabulary; ScoreReasonSchema adds the default). */
export const ScoreReasonValueSchema = z.enum(SCORE_REASON_VALUES);
export type ScoreReason = z.infer<typeof ScoreReasonValueSchema>;

/** Additive metadata, display-only (P1.7: never rewrites stored history). */
export const ScoreReasonSchema = ScoreReasonValueSchema.default("unscored-legacy");

/** Type guard for ScoreReason. Pure, never throws. */
export function isScoreReason(value: unknown): value is ScoreReason {
  try {
    if (typeof value !== "string") return false;
    return (SCORE_REASON_VALUES as readonly string[]).includes(value);
  } catch {
    return false;
  }
}

/**
 * Resolve any stored/unknown value to a ScoreReason.
 * Missing or invalid values become "unscored-legacy" (honest, in memory
 * only — callers must never write the resolved value back to disk).
 * Pure, never throws.
 */
export function resolveScoreReason(value: unknown): ScoreReason {
  try {
    return isScoreReason(value) ? value : "unscored-legacy";
  } catch {
    return "unscored-legacy";
  }
}

/**
 * Display string for a ScoreReason (neutral English tokens, stable for UI).
 * - "sampled-out" renders as "sampled-out (25%)" (rate included when known).
 * Pure, never throws.
 */
export function scoreReasonDisplay(
  reason: unknown,
  opts?: { samplingRate?: unknown },
): string {
  try {
    const resolved = resolveScoreReason(reason);
    if (resolved === "sampled-out") {
      const rate = opts?.samplingRate;
      if (typeof rate === "number" && Number.isInteger(rate) && rate >= 0 && rate <= 100) {
        return `sampled-out (${rate}%)`;
      }
      return "sampled-out (25%)";
    }
    return resolved;
  } catch {
    return "unscored-legacy";
  }
}

// ── ScoreResult ──

export const ScoreOriginSchema = z.enum(["sampled", "manual"]);
export type ScoreOrigin = z.infer<typeof ScoreOriginSchema>;

export const ScoreResultSchema = z.object({
  scorer: z.string().min(1).max(64).regex(SCORER_NAME_PATTERN),
  workItemId: z.string().regex(/^job-[a-z0-9\-]+$/),
  label: z.string().min(1).max(64),
  score: z.number().min(0).max(1),
  passing: z.boolean(),
  reason: z.string().min(1).max(2000),
  model: z.string().min(1).max(200),
  origin: ScoreOriginSchema,
  at: z.string().min(1),
  // F4-T2 additive: why this entry exists. Optional so pre-F4 entries
  // (no key on disk) still validate; readers resolve missing to
  // "unscored-legacy" in memory only (history never rewritten).
  scoreReason: ScoreReasonValueSchema.optional(),
});
export type ScoreResult = z.infer<typeof ScoreResultSchema>;

/** Mapa persistido en `scores.json`: `{[scorer]: ScoreResult}` (re-score reemplaza). */
export const ScoresMapSchema = z.record(z.string(), ScoreResultSchema);
export type ScoresMap = z.infer<typeof ScoresMapSchema>;

// ── Summary (GET /factory/scores/summary) ──

export const ScorerSummaryEntrySchema = z.object({
  scored: z.number().int().min(0),
  passing: z.number().int().min(0),
  failing: z.number().int().min(0),
  passRate: z.number().min(0).max(1),
});
export type ScorerSummaryEntry = z.infer<typeof ScorerSummaryEntrySchema>;

export const ScoresSummarySchema = z.object({
  scorers: z.record(z.string(), ScorerSummaryEntrySchema),
});
export type ScoresSummary = z.infer<typeof ScoresSummarySchema>;

// ── Invariante: ≥1 label con score ≥ passingScore y ≥1 con score < passingScore ──

/**
 * Errores del invariante de labels (vacío = válido). Puro, nunca lanza.
 * Sin este invariante un scorer no discrimina: todo pasaría o todo fallaría.
 */
export function getScorerInvariantErrors(
  def: Pick<ScorerDefinition, "labels" | "passingScore"> | null | undefined,
): string[] {
  try {
    const labels = Array.isArray(def?.labels) ? def.labels : [];
    const passingScore =
      typeof def?.passingScore === "number" ? def.passingScore : NaN;
    if (!Number.isFinite(passingScore)) return ["passingScore inválido"];
    const hasPassing = labels.some(
      (l) => typeof l?.score === "number" && l.score >= passingScore,
    );
    const hasFailing = labels.some(
      (l) => typeof l?.score === "number" && l.score < passingScore,
    );
    const errors: string[] = [];
    if (!hasPassing) {
      errors.push(
        `invariante: ningún label con score >= passingScore (${passingScore})`,
      );
    }
    if (!hasFailing) {
      errors.push(
        `invariante: ningún label con score < passingScore (${passingScore})`,
      );
    }
    return errors;
  } catch {
    return ["invariante no verificable"];
  }
}

/**
 * Valida una definición de scorer (schema zod + invariante + labels únicos).
 * Lanza si es inválida — el loader la convierte en null (nunca lanza).
 */
export function validateScorerDefinition(payload: unknown): ScorerDefinition {
  const parsed = ScorerDefinitionSchema.parse(payload);
  const errors = getScorerInvariantErrors(parsed);
  if (errors.length > 0) {
    throw new Error(`scorer inválido "${parsed.name}": ${errors.join("; ")}`);
  }
  const seen = new Set<string>();
  for (const label of parsed.labels) {
    if (seen.has(label.value)) {
      throw new Error(
        `scorer inválido "${parsed.name}": label duplicado "${label.value}"`,
      );
    }
    seen.add(label.value);
  }
  return parsed;
}

/** Valida un ScoreResult y lanza si es inválido. */
export function validateScoreResult(payload: unknown): ScoreResult {
  return ScoreResultSchema.parse(payload);
}

/**
 * Score asociado a un label (mapeo label→score). Null si el label no existe.
 * Puro, nunca lanza.
 */
export function scoreForLabel(
  def: Pick<ScorerDefinition, "labels"> | null | undefined,
  label: unknown,
): number | null {
  try {
    if (typeof label !== "string" || !Array.isArray(def?.labels)) return null;
    const found = def.labels.find((l) => l?.value === label);
    return typeof found?.score === "number" ? found.score : null;
  } catch {
    return null;
  }
}

/** True si el score alcanza el passingScore. Puro, nunca lanza. */
export function isPassingScore(
  def: Pick<ScorerDefinition, "passingScore"> | null | undefined,
  score: unknown,
): boolean {
  try {
    if (typeof score !== "number" || !Number.isFinite(score)) return false;
    if (typeof def?.passingScore !== "number") return false;
    return score >= def.passingScore;
  } catch {
    return false;
  }
}
