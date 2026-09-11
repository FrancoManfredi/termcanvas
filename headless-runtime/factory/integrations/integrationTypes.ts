/**
 * Integration contract types (Wave 14 T01 — shared contract).
 *
 * Single vocabulary source (C6) for the P0 integration: schemas live HERE
 * and are imported by definitionValidate.ts and agentLoader.ts (C7), never
 * copied. P0 is mock-local only: no network, no tokens, no SDK. Effects
 * land in T03 (Track B). ESM only, zero require().
 */

import { z } from "zod";

export const INTEGRATION_MOCK_MAX = 100;
export const INTEGRATION_TITLE_MAX = 200;
export const INTEGRATION_BODY_MAX = 2000;

/** P0 accepts mock-local + linear ONLY; live/slack are P1 (validator error). */
export const IntegrationsSectionSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.literal("mock-local", { message: 'mode must be "mock-local" in P0 (live is P1-design-only)' }),
  provider: z.literal("linear", { message: 'provider must be "linear" in P0 (slack is P1)' }),
}).strict().superRefine((v, ctx) => {
  Object.keys(v as object)
    .filter((k) => /token|secret|apikey|api_key|webhook|bearer|password/i.test(k))
    .forEach((k) => {
      ctx.addIssue({ code: "custom", path: [k], message: `secret field "${k}" forbidden in P0 mock-local (no credentials exist)` });
    });
});

export const MockPostInputSchema = z.object({
  provider: z.literal("linear"),
  kind: z.enum(["issue", "notification"]).default("notification"),
  jobId: z.string().max(128).nullable().default(null),
  title: z.string().min(1).max(INTEGRATION_TITLE_MAX),
  body: z.string().max(INTEGRATION_BODY_MAX).default(""),
});

/** One record in the local mock evidence ring. */
export interface MockPostRecord {
  id: string;
  provider: "linear";
  kind: "issue" | "notification";
  jobId: string | null;
  title: string;
  body: string;
  at: string;
  acked: boolean;
  ackAt: string | null;
}

/** Local mock evidence file shape (ring: cap INTEGRATION_MOCK_MAX, oldest evicted). */
export interface IntegrationsMockFileShape {
  version: 1;
  posts: MockPostRecord[];
}

/** Port (the future P1 live adapter implements this same interface). */
export interface IntegrationAdapter {
  post(input: z.infer<typeof MockPostInputSchema>): MockPostRecord;
  ack(id: string): boolean;
  list(limit?: number): MockPostRecord[];
}

// ── F1 live intake contracts (PLAN-100 PARIDAD §3.1, additive) ──
//
// Mock-local above is untouched: P0 posts/acks behave exactly as before
// when `liveMode` is false (the default). Everything below describes the
// opt-in live seam: vault env-name refs only (never secret values), pure
// AND/OR/NOT intake filters, webhook intake events, per-job integration
// refs, and post-back records. ESM only.

/** Allowlist of filterable intake-event fields (F1 filter vocabulary). */
export const IntakeFieldAllowlist = [
  "event",
  "project",
  "label",
  "author",
  "titleContains",
  "bodyContains",
] as const;

/** One filterable field name. */
export type IntakeField = (typeof IntakeFieldAllowlist)[number];

/** Leaf: exactly one of `equals` | `contains` (enforced by superRefine). */
export const FilterLeafSchema = z
  .object({
    field: z.enum(IntakeFieldAllowlist),
    equals: z.string().max(256).optional(),
    contains: z.string().max(256).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.equals === undefined) === (v.contains === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["equals"],
        message: "leaf requires exactly one of equals | contains",
      });
    }
  });

/** Recursive filter node, static side (validated at runtime by the schema). */
export type IntakeFilterLeaf = {
  field: IntakeField;
  equals?: string;
  contains?: string;
};
export type IntakeFilter =
  | IntakeFilterLeaf
  | { op: "and"; all: IntakeFilter[] }
  | { op: "or"; any: IntakeFilter[] }
  | { op: "not"; node: IntakeFilter };

/** Recursive AND/OR/NOT filter over intake events (pure, offline-tested). */
export const FilterNodeSchema: z.ZodType<IntakeFilter> = z.union([
  FilterLeafSchema,
  z
    .object({
      op: z.literal("and"),
      all: z.array(z.lazy(() => FilterNodeSchema)).min(1).max(10),
    })
    .strict(),
  z
    .object({
      op: z.literal("or"),
      any: z.array(z.lazy(() => FilterNodeSchema)).min(1).max(10),
    })
    .strict(),
  z
    .object({ op: z.literal("not"), node: z.lazy(() => FilterNodeSchema) })
    .strict(),
]);

/**
 * Live section: vault refs only, never secrets. `liveMode: false` (default)
 * keeps the exact P0 mock-local behavior; `liveMode: true` requires
 * `vaultRef` (an env NAME, never the key).
 */
export const LiveSectionSchema = z
  .object({
    liveMode: z.boolean().default(false),
    provider: z.enum(["linear", "slack"]).default("linear"),
    vaultRef: z.string().min(1).max(128).default(""),
    webhookSecretRef: z.string().max(128).default(""),
    filter: FilterNodeSchema.optional(),
    allowPostBack: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.liveMode && !v.vaultRef) {
      ctx.addIssue({
        code: "custom",
        path: ["vaultRef"],
        message: "liveMode:true requires vaultRef (env name, never the secret)",
      });
    }
    if (!v.liveMode) return;
    for (const k of Object.keys(v as object)) {
      if (/token|secret|apikey|api_key|webhook|bearer|password/i.test(k) && k !== "webhookSecretRef") {
        ctx.addIssue({
          code: "custom",
          path: [k],
          message: `secret value forbidden in yaml (use *Ref): "${k}"`,
        });
      }
    }
  });

/** Validated live section (inferred, never redefined). */
export type LiveSection = z.infer<typeof LiveSectionSchema>;

/**
 * Inbound intake event (webhook-in body; signature verified against the env
 * secret, redacted logs). `threadId` is the identity for
 * reply-continues-item; `replyTo` set on replies must resolve to the same
 * work item. `eventId` is the dedupe key (cap 500 FIFO, LOOPS L-IN-01).
 */
export const IntakeEventSchema = z.object({
  provider: z.enum(["linear", "slack"]),
  threadId: z.string().min(1).max(256),
  replyTo: z.string().max(256).nullable().default(null),
  author: z.string().max(256).default(""),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).default(""),
  labels: z.array(z.string().max(64)).max(20).default([]),
  eventId: z.string().min(1).max(128),
});

/** Validated intake event (inferred, never redefined). */
export type IntakeEvent = z.infer<typeof IntakeEventSchema>;

/** What each job created from intake carries in job.json (additive). */
export const IntegrationRefSchema = z.object({
  provider: z.enum(["linear", "slack"]),
  threadId: z.string(),
  eventId: z.string(),
  liveMode: z.boolean().default(false),
});

/** Validated integration ref (inferred, never redefined). */
export type IntegrationRef = z.infer<typeof IntegrationRefSchema>;

/** Post-back record (thread/issue update on terminal states; retry cap 3). */
export const PostBackSchema = z.object({
  jobId: z.string().max(128),
  threadId: z.string().min(1).max(256),
  kind: z.enum(["complete", "ask_human", "proposal-ready", "benchmark-done"]),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).default(""),
});

/** Validated post-back (inferred, never redefined). */
export type PostBack = z.infer<typeof PostBackSchema>;

/** LOOPS L-IN-01: webhook dedupe ring cap (FIFO, oldest evicted first). */
export const WEBHOOK_DEDUPE_MAX = 500;
/** LOOPS L-IN-02: post-back attempts (1 try + 2 retries, then honest fail). */
export const POSTBACK_MAX_ATTEMPTS = 3;
/** One integrationRef per job (replies continue it, never duplicate). */
export const INTEGRATION_REF_MAX = 1;
