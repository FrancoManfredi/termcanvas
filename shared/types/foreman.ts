/**
 * Foreman domain types — shared between daemon and renderer.
 * Ola 2: ForemanDecision union building|needs_triage|needs_input + LLM real + fallback.
 * Ola 3 fix: añade decision "error" para infra/model fallos (401, 429, payment, timeout) — no triage.
 */

import { z } from "zod";
import type { ModelRef } from "./workItem";

export const ForemanLogLevelSchema = z.enum([
  "info",
  "warn",
  "error",
  "decision",
]);

export type ForemanLogLevel = z.infer<typeof ForemanLogLevelSchema>;

export const ForemanDecisionKindSchema = z.enum([
  "building",
  "needs_triage",
  "needs_input",
  "error",
]);

export type ForemanDecisionKind = z.infer<typeof ForemanDecisionKindSchema>;

export const ForemanDecisionSchema = z.object({
  decision: ForemanDecisionKindSchema,
  reason: z.string().min(1).max(600),
  runnerId: z.literal("linux-build").optional(),
  confidence: z.number().min(0).max(1),
  retryable: z.boolean().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type ForemanDecision = z.infer<typeof ForemanDecisionSchema>;

export const ForemanLogSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1), // ISO8601
  level: ForemanLogLevelSchema,
  message: z.string().min(1),
  workItemId: z.string().min(1),
  decision: ForemanDecisionSchema,
  context: z
    .object({
      promptPreview: z.string(),
      worktree: z.string(),
      modelRef: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
          variant: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ForemanLog = z.infer<typeof ForemanLogSchema>;

/**
 * Helper to build a ForemanLog — Ola 2 supports union decisions.
 */
export function buildForemanLog(params: {
  workItemId: string;
  prompt: string;
  worktree: string;
  modelRef?: ModelRef;
  decision?: ForemanDecision;
}): ForemanLog {
  const decision: ForemanDecision = params.decision ?? {
    decision: "building",
    reason: "stub Ola 1 - always building",
    runnerId: "linux-build",
    confidence: 1.0,
  };
  const at = new Date().toISOString();
  const modelRefStr = params.modelRef
    ? `${params.modelRef.providerID}/${params.modelRef.modelID}${params.modelRef.variant && params.modelRef.variant !== "default" ? ` variant=${params.modelRef.variant}` : ""}`
    : "none";
  const decisionStr = decision.decision;
  const runnerPart = decision.runnerId ? ` runner ${decision.runnerId}` : "";
  const reasonShort = decision.reason.slice(0, 120).replace(/\s+/g, " ");
  const message = `[Foreman] ${params.workItemId} → ${decisionStr}${runnerPart} reason="${reasonShort}" modelRef=${modelRefStr}`;
  const promptPreview = params.prompt.slice(0, 80).replace(/\s+/g, " ");
  // level: error for infra/model failures, decision for normal building/triage
  const level: ForemanLogLevel = decision.decision === "error" ? "error" : "decision";
  return {
    id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at,
    level,
    message,
    workItemId: params.workItemId,
    decision,
    context: {
      promptPreview,
      worktree: params.worktree,
      ...(params.modelRef ? { modelRef: params.modelRef } : {}),
    },
  };
}

/**
 * Fallback decision — prompt ambiguo / falta contexto → Triage.
 * Confidence 0.8-0.9 para ambiguo (el LLM debe usar ese rango), 0.5 para fallback genérico ambiguo.
 */
export function buildFallbackDecision(reason: string, confidence = 0.5): ForemanDecision {
  const short = reason.slice(0, 200).replace(/\s+/g, " ");
  return {
    decision: "needs_triage",
    reason: `fallback: LLM no disponible — ${short}`,
    confidence,
  };
}

/**
 * Error decision — infra / LLM / model no disponible (401, 429, payment, timeout, etc.)
 * No va a Triage, va a status error/failed. Reason debe contener código y detalle.
 */
export function buildErrorDecision(reason: string, confidence = 0.5): ForemanDecision {
  const short = reason.slice(0, 200).replace(/\s+/g, " ");
  // Si ya viene con "error:" no duplicar prefix, sino añadir
  const prefix = short.toLowerCase().startsWith("error:") || short.toLowerCase().includes("infra") ? short : `error: infra/model no disponible — ${short}`;
  return {
    decision: "error",
    reason: prefix.slice(0, 600),
    confidence,
  };
}

/**
 * Error de auth/payment/quota — ÚNICO caso que debe ir a `error` → Cancelled (no retry).
 * Solo 401/402/429 (+ 403/529 como variantes de quota) + keywords explícitas de pago.
 * Warp: requiere fix credencial, no reintento automático.
 */
export function isAuthPaymentError(msg: string): boolean {
  if (/\b401\b/.test(msg) || /\b402\b/.test(msg) || /\b429\b/.test(msg)) return true;
  const lower = msg.toLowerCase();
  if (
    lower.includes("payment") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("insufficient") ||
    lower.includes("credit") ||
    lower.includes("unauthorized") ||
    lower.includes("authenticate") ||
    lower.includes("apikey") ||
    lower.includes("api key") ||
    lower.includes("forbidden") && (lower.includes("quota") || lower.includes("billing") || lower.includes("payment"))
  )
    return true;
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("over quota")) return true;
  // 403 solo si es payment/quota context, no genérico
  if (/\b403\b/.test(msg) && (lower.includes("quota") || lower.includes("payment") || lower.includes("billing"))) return true;
  if (/\b529\b/.test(msg) && (lower.includes("quota") || lower.includes("payment") || lower.includes("overloaded"))) return true;
  return false;
}

/**
 * Error retryable (timeout/network/abort) — debe ir a `needs_triage` retryable (confidence 0.52), NO a error.
 * Incluye timeout, econnrefused, abort, fetch failed, network, zod parse, prompt variants failed, etc.
 */
export function isRetryableError(msg: string): boolean {
  const lower = msg.toLowerCase();
  if (
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("abort") ||
    lower.includes("aborted") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("econom") // ECONNRESET etc.
  )
    return true;
  if (
    lower.includes("zod parse fallo") ||
    lower.includes("prompt fallo") ||
    lower.includes("all prompt variants failed") ||
    lower.includes("sdk no detectado") ||
    lower.includes("createopencodeclient") ||
    lower.includes("session.create") ||
    lower.includes("llm no disponible") ||
    lower.includes("model no disponible") ||
    lower.includes("model not found") ||
    lower.includes("unexpected") // genérico sin auth => retryable
  ) {
    // Pero si además es auth/payment, no es retryable — es error
    if (isAuthPaymentError(msg)) return false;
    return true;
  }
  return false;
}

/**
 * Helper legacy: detecta si un mensaje corresponde a fallo de infra/model/LLM
 * (vs prompt ambiguo que debe ir a needs_triage).
 * Usado por ForemanService y factoryServer para decidir error vs triage.
 * @deprecated Usar isAuthPaymentError para decidir error; isRetryableError para triage retryable.
 * Ahora mapea solo a auth/payment para no confundir timeout con error Cancelled.
 */
export function isInfraErrorMessage(msg: string): boolean {
  return isAuthPaymentError(msg);
}
