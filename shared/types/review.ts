/**
 * Review domain types — Ola 4.
 * Contrato daemon ↔ renderer para pipeline REVIEW automático.
 * Zod schemas + TypeScript types + constantes + helpers puros.
 */

import { z } from "zod";

// ── Constants ──
// Sin topes de trabajo para el reviewer (doctrina sin-límites): ni máximo
// de findings, ni timeout por fase. El loop revise↔Building SÍ tiene cota
// de rondas (Regla 7): termina por veredicto (accept/ask_human), acción
// humana (cancel/reject) o al agotar MAX_REVIEW_ROUNDS (→ ask_human, el
// humano decide; nunca accept forzado).
export const REVIEW_POLL_INTERVAL_MS = 2500;

/**
 * Rondas automáticas implement↔review por job (flujo simple, sin reintentos).
 * Flujo: review 1 puede dar `revise` (count 0<1 → Building), review 2 es
 * terminal (solo `accept` o `ask_human`, nunca otro `revise` automático).
 * Agotada sin `accept`, el job queda en `ask_human` (stay Review, parado).
 */
export const MAX_REVIEW_ROUNDS = 1;

// ── Axis / Severity / Verdict ──
export const ReviewAxisSchema = z.enum(["requirements", "tests", "security"]);
export type ReviewAxis = z.infer<typeof ReviewAxisSchema>;

export const ReviewSeveritySchema = z.enum(["info", "minor", "major", "blocker"]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewVerdictSchema = z.enum(["accept", "revise", "ask_human"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

// ── ReviewerModel (duplicado de ModelRef para evitar ciclo workItem ↔ review) ──
export const ReviewerModelSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  variant: z.string().optional(),
});
export type ReviewerModel = z.infer<typeof ReviewerModelSchema>;

// ── Reverify (Ola 17: review que re-valida) ──

/** Tope de comandos por pedido de re-verificación (cota Regla 7). */
export const REVERIFY_MAX_COMMANDS = 20;

/** Largo máximo por comando pedido (cota Regla 7). */
export const REVERIFY_MAX_COMMAND_LEN = 500;

/**
 * Pedido de re-verificación enfocada del reviewer: el modelo PIDE, el
 * SISTEMA ejecuta (allowlist cerrada en `reverifyAllowlist.ts`; el reviewer
 * sigue sin bash/write/edit directo). Aditivo y opcional: findings viejos
 * sin `reverify` siguen válidos (contratos vivos).
 */
export const ReverifyRequestSchema = z
  .object({
    commands: z.array(z.string()),
    reason: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!Array.isArray(v.commands) || v.commands.length === 0) {
      ctx.addIssue({ code: "custom", message: "reverify.commands requiere ≥1 comando" });
    } else {
      if (v.commands.length > REVERIFY_MAX_COMMANDS) {
        ctx.addIssue({
          code: "custom",
          message: `reverify.commands admite como máximo ${REVERIFY_MAX_COMMANDS}`,
        });
      }
      v.commands.forEach((c, i) => {
        if (typeof c !== "string" || c.trim().length === 0) {
          ctx.addIssue({
            code: "custom",
            message: `reverify.commands[${i}] no puede estar vacío`,
            path: ["commands", i],
          });
        } else if (c.length > REVERIFY_MAX_COMMAND_LEN) {
          ctx.addIssue({
            code: "custom",
            message: `reverify.commands[${i}] supera ${REVERIFY_MAX_COMMAND_LEN} caracteres`,
            path: ["commands", i],
          });
        }
      });
    }
    if (typeof v.reason !== "string" || v.reason.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "reverify.reason no puede estar vacío" });
    } else if (v.reason.length > 1000) {
      ctx.addIssue({ code: "custom", message: "reverify.reason admite como máximo 1000 caracteres" });
    }
  });
export type ReverifyRequest = z.infer<typeof ReverifyRequestSchema>;

// ── ReviewFinding ──
export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  axis: ReviewAxisSchema,
  severity: ReviewSeveritySchema,
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  message: z.string().min(1).max(1000),
  suggestion: z.string().max(1000).optional(),
  // Ola 17 (aditivo, opcional): pedido de re-verificación enfocada.
  reverify: ReverifyRequestSchema.optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

// ── ReviewResult ──
export const ReviewResultSchema = z.object({
  workItemId: z.string().regex(/^job-[a-z0-9\-]+$/),
  reviewerModel: ReviewerModelSchema,
  verdict: ReviewVerdictSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(20000),
  findings: z.array(ReviewFindingSchema),
  reviewAttempt: z.number().int().min(1),
  reviewedAt: z.string().min(1),
  // Aditivo, opcional: true cuando el review NUNCA corrió por fallo de
  // infra/proveedor (rate limit, 5xx, timeout, session.create, parse). Un
  // ask_human con este flag NO es un juicio del reviewer: aceptar igual
  // debe bloquearse (POST review/accept → 409) y la UI ofrece reintentar.
  // Ausente en datos viejos (misma forma que antes).
  isInfraError: z.boolean().optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// ── LLM-only payload (lo que devuelve el revisor, sin contexto daemon) ──
export const ReviewLLMResponseSchema = z.object({
  verdict: ReviewVerdictSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(2000),
  findings: z.array(ReviewFindingSchema).default([]),
});
export type ReviewLLMResponse = z.infer<typeof ReviewLLMResponseSchema>;

/**
 * Validate ReviewResult and throw if invalid.
 */
export function validateReviewResult(payload: unknown): ReviewResult {
  return ReviewResultSchema.parse(payload);
}

/**
 * Validate LLM-only payload and throw if invalid.
 */
export function validateReviewLLMResponse(payload: unknown): ReviewLLMResponse {
  return ReviewLLMResponseSchema.parse(payload);
}

/**
 * Build an ask_human ReviewResult without spending LLM.
 * Used when builder === reviewer or LLM fails (timeout/parse).
 * `isInfraError: true` marca que el review NUNCA corrió (fallo de
 * infra/proveedor): solo se setea en ese caso para no cambiar la forma de
 * los ask_human legítimos.
 */
export function buildAskHumanResult(params: {
  workItemId: string;
  reviewerModel: ReviewerModel;
  reviewAttempt: number;
  summary: string;
  confidence?: number;
  isInfraError?: boolean;
}): ReviewResult {
  const attempt = Math.max(1, params.reviewAttempt);
  return {
    workItemId: params.workItemId,
    reviewerModel: params.reviewerModel,
    verdict: "ask_human",
    confidence: params.confidence ?? 0.5,
    summary: params.summary.slice(0, 2000),
    findings: [],
    reviewAttempt: attempt,
    reviewedAt: new Date().toISOString(),
    ...(params.isInfraError === true ? { isInfraError: true as const } : {}),
  };
}

/**
 * Patrones de mensaje de error de infra/proveedor (rate limit, 5xx,
 * overload, auth/cuota). Fuente única: la usa la clasificación del
 * reviewAgent (¿pruebo modelo fallback?) y la heurística de
 * `isInfraReviewResult` para datos viejos sin flag. Puro, nunca lanza.
 */
export const REVIEW_INFRA_MESSAGE_PATTERNS = [
  "rate limit",
  "ratelimit",
  "rate_limit",
  "too many requests",
  "over quota",
  "quota exceeded",
  "overloaded",
  "service unavailable",
  "internal error",
  "server error",
  "capacity",
  " 500",
  " 502",
  " 503",
  " 529",
  "timeout",
  "timed out",
  "aborted",
  "abort",
] as const;

/**
 * ¿El mensaje describe un fallo de infra/proveedor (no un veredicto)?
 * Puro, nunca lanza.
 */
export function matchesInfraErrorMessage(msg: unknown): boolean {
  try {
    const m = String(msg ?? "").toLowerCase();
    if (m.length === 0) return false;
    return REVIEW_INFRA_MESSAGE_PATTERNS.some((p) => m.includes(p));
  } catch {
    return false;
  }
}

/**
 * Subconjunto que justifica UN intento con modelo fallback (sin timeout ni
 * abort: con el modelo seguía pensando, reenviar —aunque sea a otro
 * modelo— duplica el turno; doctrina agentTransport/no-resend).
 */
export const REVIEW_FALLBACKABLE_INFRA_PATTERNS = [
  "rate limit",
  "ratelimit",
  "rate_limit",
  "too many requests",
  "over quota",
  "quota exceeded",
  "overloaded",
  "service unavailable",
  "internal error",
  " 500",
  " 502",
  " 503",
  " 529",
  "capacity",
] as const;

/**
 * ¿El mensaje matchea alguno de los patrones dados? Puro, nunca lanza.
 */
export function matchesAnyInfraPattern(msg: unknown, patterns: readonly string[]): boolean {
  try {
    const m = String(msg ?? "").toLowerCase();
    if (m.length === 0) return false;
    return patterns.some((p) => m.includes(p));
  } catch {
    return false;
  }
}
/**
 * Prefijos de summary que el daemon genera SOLO cuando el review nunca
 * corrió (fallos de infra). Heurística para datos viejos sin `isInfraError`.
 */
export const REVIEW_INFRA_SUMMARY_PREFIXES = [
  "review prompt fallo:",
  "review zod parse fallo:",
  "review session.create fallo:",
  "opencode server no disponible:",
  "SDK no detectado",
  "session.prompt no disponible",
  "review unexpected:",
  "reviewAgent throw:",
] as const;

/**
 * ¿Este resultado es un ask_human por fallo de infra (el review nunca
 * corrió)? true por flag explícito; para datos viejos, heurística por
 * prefijo de summary + findings vacíos. Cualquier otro veredicto → false.
 * Puro, nunca lanza.
 */
export function isInfraReviewResult(result: unknown): boolean {
  try {
    if (!result || typeof result !== "object" || Array.isArray(result)) return false;
    const r = result as Record<string, unknown>;
    if (r.isInfraError === true) return true;
    if (r.verdict !== "ask_human") return false;
    if (Array.isArray(r.findings) && r.findings.length > 0) return false;
    const summary = typeof r.summary === "string" ? r.summary : "";
    return REVIEW_INFRA_SUMMARY_PREFIXES.some((p) => summary.startsWith(p));
  } catch {
    return false;
  }
}
/**
 * Pact jobs nunca van a Review (F01-F14 + playground).
 * Misma lista que ImplementService.isPactJob — duplicada aquí para
 * que ReviewService no importe ImplementService (evita ciclo).
 */
export function isPactReviewJob(params: {
  id: string;
  prompt?: string;
  worktree?: string;
}): boolean {
  const id = (params.id ?? "").toLowerCase();
  const p = params.prompt ?? "";
  const w = (params.worktree ?? "").toLowerCase();
  if (p.startsWith("playground-")) return true;
  if (w.includes("playground-")) return true;
  if (w.includes("playground") && id.startsWith("job-")) {
    if (id.startsWith("playground-") || id.includes("playground")) return true;
  }
  if (id.startsWith("job-abc123")) return true;
  if (id.startsWith("job-f10")) return true;
  if (id.startsWith("job-f11")) return true;
  if (id.startsWith("job-f13")) return true;
  if (id.startsWith("job-f14")) return true;
  if (id.startsWith("job-f04")) return true;
  if (id.startsWith("job-f03")) return true;
  if (id === "job-f04-cancel01") return true;
  if (id.startsWith("playground-")) return true;
  return false;
}

/**
 * Decide siguiente transición Review dado verdict + count previo.
 * Puro y testeable sin store. Con cota de rondas (Regla 7,
 * MAX_REVIEW_ROUNDS): el loop revise↔Building termina por veredicto,
 * humano o al agotar rondas (→ stay = ask_human, nunca accept forzado).
 * - accept → Complete
 * - revise + count < MAX → Building (sigue el loop automático)
 * - revise + count ≥ MAX → stay Review (null = ask_human, decide el humano)
 * - ask_human → stay Review (null = sin transición)
 */
export function decideReviewNext(
  verdict: ReviewVerdict,
  countBefore: number,
): "Complete" | "Building" | null {
  if (verdict === "accept") return "Complete";
  if (verdict === "revise") {
    const count = typeof countBefore === "number" && Number.isFinite(countBefore) ? Math.trunc(countBefore) : 0;
    return count < MAX_REVIEW_ROUNDS ? "Building" : null;
  }
  return null;
}
