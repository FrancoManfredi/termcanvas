/**
 * Implement types — Ola 3.
 * Contrato daemon ↔ renderer para pipeline IMPLEMENT real.
 * Zod schemas + TypeScript types + constantes.
 */

import { z } from "zod";

// ── Constants ──
// Techo ABSOLUTO por intento de modelo (el watchdog por progreso corta
// antes ante 180s sin progreso; ver IMPLEMENT_PROGRESS_IDLE_MS). 1h cubre
// implements grandes reales; un turno colgado muere por idle, no por esto.
export const IMPLEMENT_LLM_TIMEOUT_MS = 3_600_000;
/** Cadencia de sondeo de progreso (partes del mensaje) durante el turno. */
export const IMPLEMENT_PROGRESS_POLL_MS = 20_000;
/** Sin progreso nuevo en este lapso → abort del turno (colgado). */
export const IMPLEMENT_PROGRESS_IDLE_MS = 180_000;
export const IMPLEMENT_VERIFY_TIMEOUT_MS = 120_000;
export const IMPLEMENT_SETUP_TIMEOUT_MS = 15000;
export const IMPLEMENT_MAX_CREATED_FILES = 50;
export const IMPLEMENT_MAX_FILES_MINIMAL = 3;
// Flujo simple (sin reintentos): sin strict second pass (eliminado L12) y
// sin pre-verify rescan (eliminado P05). Un solo turno LLM por consume; si
// no toca archivos, el job queda parado en Building.
// Timeline model excerpt cap: every implement branch records what the model
// returned truncated to this length, so the timeline explains the outcome
// without storing full prose.
export const IMPLEMENT_MODEL_SNIPPET_MAX = 200;
export const BUILD_LOG_MAX_BYTES = 1_048_576; // 1MB
export const BUILD_LOG_SNIPPET_HEAD = 2048;
export const BUILD_LOG_SNIPPET_TAIL = 2048;

// ── ImplementInput (PRD literal) ──
export const ImplementInputSchema = z.object({
  id: z.string().regex(/^job-[a-z0-9\-]+$/),
  prompt: z.string().min(1),
  worktreePath: z.string().min(1),
  modelRef: z
    .object({
      providerID: z.string().min(1),
      modelID: z.string().min(1),
      variant: z.string().optional(),
    })
    .optional(),
  // Revise round: el reviewer devolvió el job con findings accionables.
  // Ausente = primer implement (prompt base intacto). Presente = el prompt
  // cambia a modo REVISE (corregir findings sobre el cambio ya aplicado).
  reviewFeedback: z
    .object({
      verdict: z.string().min(1),
      summary: z.string(),
      attempt: z.number().int().min(1).optional(),
      findings: z.array(
        z.object({
          message: z.string().min(1),
          severity: z.string().optional(),
          file: z.string().optional(),
          line: z.number().optional(),
          suggestion: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

export type ImplementInput = z.infer<typeof ImplementInputSchema>;

// ── ImplementOutput ──
// Trace branch: one explicit timeline event per consume path, so no branch
// ever ends silent (llm-ok, llm-no-tools, llm-second-pass, timeout, no-sdk,
// no-git, fallback, fallback-refused, patch-applied, rollback).
export const ImplementTraceBranchSchema = z.enum([
  "llm-ok",
  "llm-no-tools",
  "llm-second-pass",
  "timeout",
  "no-sdk",
  "no-git",
  "fallback",
  "fallback-refused",
  "patch-applied",
  "rollback",
]);

export type ImplementTraceBranch = z.infer<typeof ImplementTraceBranchSchema>;

export const ImplementTraceEventSchema = z.object({
  branch: ImplementTraceBranchSchema,
  message: z.string().min(1),
  modelSnippet: z.string().max(500).optional(),
});

export type ImplementTraceEvent = z.infer<typeof ImplementTraceEventSchema>;

export const ImplementOutputSchema = z.object({
  createdFiles: z.array(z.string()),
  modifiedFiles: z.array(z.string()),
  durationMs: z.number().min(0),
  strategy: z.enum(["llm", "fallback"]),
  trace: z.array(ImplementTraceEventSchema).optional(),
});

export type ImplementOutput = z.infer<typeof ImplementOutputSchema>;

// ── VerificationStep ──
export const VerificationStepSchema = z.object({
  name: z.enum(["setup", "test", "build"]),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().min(0),
  status: z.enum(["pass", "fail", "skipped"]),
  logSnippet: z.string().optional(),
  logPath: z.string(),
});

export type VerificationStep = z.infer<typeof VerificationStepSchema>;

// ── VerificationEvidence (Ola 9: evidencia aditiva, opcional) ──
export const VerificationEvidenceSchema = z.object({
  kind: z.enum(["test", "build", "visual", "note"]),
  status: z.enum(["pass", "fail", "skipped", "pending-human"]),
  ref: z.string().optional(),
  summary: z.string().min(1),
});

export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;

// ── VerificationReport ──
export const VerificationReportSchema = z.object({
  steps: z.array(VerificationStepSchema).min(1),
  overall: z.enum(["pass", "fail"]),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().min(0),
  evidence: z.array(VerificationEvidenceSchema).optional(),
});

export type VerificationReport = z.infer<typeof VerificationReportSchema>;

// ── ImplementResultJson (PRD exacto + runnerId) ──
export const ImplementResultJsonSchema = z.object({
  workItemId: z.string().regex(/^job-[a-z0-9\-]+$/),
  modelRef: z
    .object({
      providerID: z.string().min(1),
      modelID: z.string().min(1),
      variant: z.string().optional(),
    })
    .optional(),
  worktreePath: z.string().min(1),
  status: z.enum(["pass", "fail"]),
  verification: VerificationReportSchema,
  createdFiles: z.array(z.string()),
  timestamp: z.string().min(1),
  runnerId: z.literal("linux-build"),
});

export type ImplementResultJson = z.infer<typeof ImplementResultJsonSchema>;

// ── Allowed transitions Ola 3 (documentación) ──
export const ALLOWED_TRANSITIONS_OLA3 = {
  Intake: ["Foreman", "Cancelled"],
  Foreman: ["Building", "Triage", "Cancelled"],
  Triage: ["Foreman", "Cancelled"],
  Building: ["Complete", "Triage", "Cancelled", "Review"],
  Review: ["Complete", "Cancelled"],
  Complete: [],
  Cancelled: [],
} as const;

// ── Helpers ──
export function isImplementingStatus(status: string): boolean {
  return status === "Building";
}

export function isPassFailStatus(status: string): boolean {
  return status === "pass" || status === "fail";
}

/**
 * Validate ImplementResultJson and throw if invalid.
 */
export function validateImplementResult(payload: unknown): ImplementResultJson {
  return ImplementResultJsonSchema.parse(payload);
}

/**
 * Validate VerificationReport and throw if invalid.
 */
export function validateVerificationReport(payload: unknown): VerificationReport {
  return VerificationReportSchema.parse(payload);
}
