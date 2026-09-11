/**
 * factory/measure/decisionRecord — F3 human-in-the-measure pure records.
 *
 * Pure validators for the two human decision records of the measure track:
 * benchmark decisions and spec approval cites. No I/O, no network, no timers,
 * no loops, no state. All persistence and routing live in the engines and in
 * the route layer; this module only validates shapes.
 *
 * Flow context (PLAN-100 §4.3):
 * - Spec path: non-trivial job yields a brief, the brief waits
 *   for human approval, then implement cites the approved brief
 *   (SpecCite record links jobId to the approval instant plus the cite text).
 * - Benchmark path: a benchmark run produces trials and costed stats with no
 *   winner, the human weighs cost against quality, then the human records a
 *   BenchmarkDecision pointing at the trials on disk (trialsRef).
 *
 * Human-only rule (Rules 1-8, Warp parity):
 * - decidedBy and approvedBy accept exactly the literal "human".
 * - Values such as "auto", "system", "bot" or "agent" are rejected with an
 *   explicit message. The module exposes zero auto-decide helpers: there is
 *   no pick-winner and no adopt helper here by design.
 *
 * Contracts:
 * - ESM only, zero require, zod 4 with superRefine on every schema.
 * - strict objects: unknown keys (including winner or auto-adopt smuggling)
 *   are rejected.
 * - safeParse style helpers never throw; validate helpers throw Error with a
 *   joined message for endpoint 400 mapping.
 * - Dates are ISO 8601 UTC strings validated by shape plus Date.parse.
 */

import { z } from "zod";

/** The single allowed decisor value. Human decides, never auto. */
export const HUMAN_DECISOR = "human" as const;

/** ISO 8601 UTC shape: 2026-09-05T12:00:00Z with optional millis and offset. */
export const ISO_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** Keys that must never appear on a benchmark decision (no auto-winner). */
export const BENCHMARK_DECISION_FORBIDDEN_KEYS = [
  "winner",
  "autoWinner",
  "winningConfig",
  "recommendation",
  "autoAdopt",
  "auto",
] as const;

/** Keys that must never appear on a spec cite (no auto-adopt). */
export const SPEC_CITE_FORBIDDEN_KEYS = [
  "autoAdopt",
  "autoApprove",
  "adopted",
  "winner",
  "autoWinner",
  "auto",
] as const;

/**
 * True for a non-empty string with visible characters and no NUL.
 * Pure, never throws.
 */
export function isNonBlankString(value: unknown, maxLen: number): boolean {
  try {
    if (typeof value !== "string") return false;
    if (value.length === 0 || value.length > maxLen) return false;
    if (value.includes("\0")) return false;
    return value.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * True when the value is a plausible ISO 8601 UTC instant string.
 * Checks shape plus Date.parse finiteness. Pure, never throws.
 */
export function isValidIsoUtcString(value: unknown): value is string {
  try {
    if (typeof value !== "string") return false;
    const text = value.trim();
    if (text.length === 0 || text.length > 64) return false;
    if (text !== value) return false;
    if (!ISO_UTC_PATTERN.test(text)) return false;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed);
  } catch {
    return false;
  }
}

/**
 * Collects forbidden auto keys present on a plain object.
 * Pure, never throws. Used to give an explicit never-auto message
 * on top of the strict-object rejection.
 */
export function findForbiddenKeys(
  payload: unknown,
  forbidden: readonly string[],
): string[] {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return [];
    }
    const record = payload as Record<string, unknown>;
    return forbidden.filter((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    );
  } catch {
    return [];
  }
}

/**
 * Joins zod issues into one readable line for endpoint 400 bodies.
 * Pure, never throws.
 */
export function formatDecisionIssues(issues: unknown): string {
  try {
    if (!Array.isArray(issues)) return "invalid decision record";
    const parts = issues
      .map((issue) => {
        if (!issue || typeof issue !== "object") return "";
        const entry = issue as { path?: unknown; message?: unknown };
        const pathText = Array.isArray(entry.path)
          ? entry.path.map((segment) => String(segment)).join(".")
          : "";
        const message =
          typeof entry.message === "string" ? entry.message : "invalid value";
        return pathText.length > 0 ? `${pathText}: ${message}` : message;
      })
      .filter((part) => part.length > 0)
      .slice(0, 10);
    return parts.length > 0 ? parts.join("; ") : "invalid decision record";
  } catch {
    return "invalid decision record";
  }
}

// ── BenchmarkDecision ──

/**
 * Human benchmark decision record.
 * decidedBy is exactly "human" by schema; trialsRef points at the benchmark
 * run on disk; change describes the model or config change being decided.
 */
export const BenchmarkDecisionSchema = z
  .object({
    benchmarkId: z.string().min(1).max(128),
    decidedAt: z.string().min(1).max(64),
    decidedBy: z.literal("human"),
    change: z.string().min(1).max(500),
    costWeight: z.string().max(200).default(""),
    qualityWeight: z.string().max(200).default(""),
    trialsRef: z.string().min(1).max(256),
    note: z.string().max(1000).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isNonBlankString(value.benchmarkId, 128)) {
      ctx.addIssue({
        code: "custom",
        path: ["benchmarkId"],
        message: "benchmarkId must be a non-blank string without NUL",
      });
    }
    if (!isValidIsoUtcString(value.decidedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["decidedAt"],
        message: "decidedAt must be an ISO 8601 UTC instant string",
      });
    }
    const raw = value as unknown as Record<string, unknown>;
    if (raw["decidedBy"] !== HUMAN_DECISOR) {
      ctx.addIssue({
        code: "custom",
        path: ["decidedBy"],
        message: 'decidedBy must be "human" — never auto',
      });
    }
    if (!isNonBlankString(value.change, 500)) {
      ctx.addIssue({
        code: "custom",
        path: ["change"],
        message: "change must be a non-blank string describing the decision",
      });
    }
    if (!isNonBlankString(value.trialsRef, 256)) {
      ctx.addIssue({
        code: "custom",
        path: ["trialsRef"],
        message: "trialsRef must be a non-blank pointer to trials on disk",
      });
    }
    const forbidden = findForbiddenKeys(
      value,
      BENCHMARK_DECISION_FORBIDDEN_KEYS,
    );
    if (forbidden.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: [forbidden[0]],
        message: `field "${forbidden[0]}" is forbidden — benchmarks never declare a winner, the human decides`,
      });
    }
  });

export type BenchmarkDecision = z.infer<typeof BenchmarkDecisionSchema>;

/** Outcome of a never-throw parse. */
export type BenchmarkDecisionParse =
  | { ok: true; data: BenchmarkDecision }
  | { ok: false; error: string; issues: z.core.$ZodIssue[] };

/**
 * Validates a benchmark decision, throwing on invalid input.
 * Endpoints map the throw to 400 with the message visible.
 */
export function validateBenchmarkDecision(payload: unknown): BenchmarkDecision {
  const parsed = BenchmarkDecisionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `invalid benchmark decision: ${formatDecisionIssues(parsed.error.issues).slice(0, 500)}`,
    );
  }
  return parsed.data;
}

/**
 * Parses a benchmark decision without throwing.
 * Returns ok:true with data, or ok:false with error plus raw issues.
 */
export function parseBenchmarkDecision(payload: unknown): BenchmarkDecisionParse {
  try {
    const parsed = BenchmarkDecisionSchema.safeParse(payload);
    if (parsed.success) {
      return { ok: true, data: parsed.data };
    }
    return {
      ok: false,
      error: `invalid benchmark decision: ${formatDecisionIssues(parsed.error.issues).slice(0, 500)}`,
      issues: parsed.error.issues,
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid benchmark decision: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
      issues: [],
    };
  }
}

/**
 * Type guard for a human benchmark decision. Pure, never throws.
 */
export function isHumanBenchmarkDecision(
  value: unknown,
): value is BenchmarkDecision {
  try {
    const parsed = BenchmarkDecisionSchema.safeParse(value);
    return parsed.success && parsed.data.decidedBy === HUMAN_DECISOR;
  } catch {
    return false;
  }
}

/**
 * One-line summary of a benchmark decision for logs and notifications.
 * Pure, never throws. Returns an empty string for invalid input.
 */
export function summarizeBenchmarkDecision(value: unknown): string {
  try {
    const parsed = BenchmarkDecisionSchema.safeParse(value);
    if (!parsed.success) return "";
    const decision = parsed.data;
    return `benchmark "${decision.benchmarkId}" decided by human at ${decision.decidedAt}: ${decision.change}`.slice(
      0,
      500,
    );
  } catch {
    return "";
  }
}

// ── SpecCite ──

/**
 * Spec approval cite record.
 * Links a job to the human approval instant plus the evidence string the
 * implement step wrote citing the approved brief (brief to approve to
 * implement chain).
 */
export const SpecCiteSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    specApprovedAt: z.string().min(1).max(64),
    approvedBy: z.literal("human"),
    implementCites: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isNonBlankString(value.jobId, 128)) {
      ctx.addIssue({
        code: "custom",
        path: ["jobId"],
        message: "jobId must be a non-blank string without NUL",
      });
    }
    if (!isValidIsoUtcString(value.specApprovedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["specApprovedAt"],
        message: "specApprovedAt must be an ISO 8601 UTC instant string",
      });
    }
    const raw = value as unknown as Record<string, unknown>;
    if (raw["approvedBy"] !== HUMAN_DECISOR) {
      ctx.addIssue({
        code: "custom",
        path: ["approvedBy"],
        message: 'approvedBy must be "human" — never auto',
      });
    }
    if (!isNonBlankString(value.implementCites, 500)) {
      ctx.addIssue({
        code: "custom",
        path: ["implementCites"],
        message: "implementCites must be a non-blank cite of the approved brief",
      });
    }
    const forbidden = findForbiddenKeys(value, SPEC_CITE_FORBIDDEN_KEYS);
    if (forbidden.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: [forbidden[0]],
        message: `field "${forbidden[0]}" is forbidden — proposals are adopted by humans, never auto`,
      });
    }
  });

export type SpecCite = z.infer<typeof SpecCiteSchema>;

/** Outcome of a never-throw spec cite parse. */
export type SpecCiteParse =
  | { ok: true; data: SpecCite }
  | { ok: false; error: string; issues: z.core.$ZodIssue[] };

/**
 * Validates a spec cite, throwing on invalid input.
 * Endpoints map the throw to 400 with the message visible.
 */
export function validateSpecCite(payload: unknown): SpecCite {
  const parsed = SpecCiteSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `invalid spec cite: ${formatDecisionIssues(parsed.error.issues).slice(0, 500)}`,
    );
  }
  return parsed.data;
}

/**
 * Parses a spec cite without throwing.
 * Returns ok:true with data, or ok:false with error plus raw issues.
 */
export function parseSpecCite(payload: unknown): SpecCiteParse {
  try {
    const parsed = SpecCiteSchema.safeParse(payload);
    if (parsed.success) {
      return { ok: true, data: parsed.data };
    }
    return {
      ok: false,
      error: `invalid spec cite: ${formatDecisionIssues(parsed.error.issues).slice(0, 500)}`,
      issues: parsed.error.issues,
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid spec cite: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
      issues: [],
    };
  }
}

/**
 * Type guard for a human spec cite. Pure, never throws.
 */
export function isHumanSpecCite(value: unknown): value is SpecCite {
  try {
    const parsed = SpecCiteSchema.safeParse(value);
    return parsed.success && parsed.data.approvedBy === HUMAN_DECISOR;
  } catch {
    return false;
  }
}

/**
 * One-line summary of a spec cite for logs and notifications.
 * Pure, never throws. Returns an empty string for invalid input.
 */
export function summarizeSpecCite(value: unknown): string {
  try {
    const parsed = SpecCiteSchema.safeParse(value);
    if (!parsed.success) return "";
    const cite = parsed.data;
    return `job "${cite.jobId}" approved by human at ${cite.specApprovedAt}: ${cite.implementCites}`.slice(
      0,
      500,
    );
  } catch {
    return "";
  }
}
