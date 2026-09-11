/**
 * Automation contract types (Wave 14 T01 — shared contract).
 *
 * Single vocabulary source (C6) for triggers: schemas live HERE and are
 * imported by definitionValidate.ts and agentLoader.ts (C7), never copied.
 * ESM only, zero require(). Validators never throw toward the server
 * (safeParse + actionable issues). Effects land in T02 (Track A).
 */

import { z } from "zod";

export const TRIGGER_EVENT_ALLOWLIST = ["job-complete", "ask_human", "proposal-ready"] as const;
export const TRIGGER_ACTION_ALLOWLIST = ["create-job", "notify-integration"] as const;
export const AUTOMATIONS_MAX_TRIGGERS = 20;
export const AUTOMATION_TICK_DEFAULT_MS = 30000;
export const AUTOMATIONS_MAX_ENTRIES = 200;
export const AUTOMATION_NAME_MAX = 64;
export const AUTOMATION_EVENT_ID_MAX = 128;

const baseTrigger = z.object({
  name: z.string().min(1).max(AUTOMATION_NAME_MAX),
  kind: z.enum(["schedule", "event"]),
  enabled: z.boolean().default(true),
  maxFires: z.number().int().min(0).default(5),
  cooldownMs: z.number().int().min(0).default(60000),
});

export const ScheduleTriggerSchema = baseTrigger.extend({
  kind: z.literal("schedule"),
  intervalMs: z.number().int().min(1000).optional(),
  cron: z.string().min(1).max(64).optional(),
  promptRef: z.string().min(1).max(256),
}).superRefine((t, ctx) => {
  const hasI = t.intervalMs !== undefined, hasC = t.cron !== undefined;
  if (hasI === hasC) ctx.addIssue({ code: "custom", path: ["intervalMs"], message: "schedule triggers require exactly one of intervalMs | cron" });
  if (t.cron !== undefined && !/^(\S+\s+){4}\S+$/.test(t.cron.trim()))
    ctx.addIssue({ code: "custom", path: ["cron"], message: "cron must be 5-field cron-like (minute hour dom month dow)" });
  if (t.promptRef.includes("..") || t.promptRef.startsWith("/") || t.promptRef.includes("\\"))
    ctx.addIssue({ code: "custom", path: ["promptRef"], message: "promptRef must be a relative factory/ path (no traversal)" });
});

export const EventTriggerSchema = baseTrigger.extend({
  kind: z.literal("event"),
  on: z.enum(TRIGGER_EVENT_ALLOWLIST),
  action: z.enum(TRIGGER_ACTION_ALLOWLIST),
  promptRef: z.string().min(1).max(256).optional(),
}).superRefine((t, ctx) => {
  if (t.action === "create-job" && !t.promptRef)
    ctx.addIssue({ code: "custom", path: ["promptRef"], message: "promptRef required when action=create-job" });
});

export const TriggerSchema = z.discriminatedUnion("kind", [ScheduleTriggerSchema, EventTriggerSchema]);

// ── F1-T2 webhook-in trigger kind (additive; schedule/event untouched) ──

/** Discriminant of the live-intake trigger kind (F1 webhook-in). */
export const WEBHOOK_TRIGGER_KIND = "webhook-in" as const;

/** Live providers a webhook-in trigger can listen to (F1 scope). */
export const WEBHOOK_PROVIDER_ALLOWLIST = ["linear", "slack"] as const;

/** Caller-held webhook dedupe FIFO cap (LOOPS L-IN-01 twin, Rule 7). */
export const AUTOMATION_WEBHOOK_DEDUPE_CAP = 500;

/** A-row trigger kinds (automation table rows: schedule | event | webhook-in). */
export const AUTOMATION_TRIGGER_KINDS = ["schedule", "event", "webhook-in"] as const;

/** A-row fire results (evidence ring verdicts; `skipped-filter` is F1-new). */
export const AUTOMATION_FIRE_RESULTS = [
  "created",
  "notified",
  "skipped-quota",
  "skipped-cooldown",
  "skipped-disabled",
  "skipped-dedupe",
  "skipped-filter",
] as const;

export type WebhookProvider = (typeof WEBHOOK_PROVIDER_ALLOWLIST)[number];
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number];
export type AutomationFireResult = (typeof AUTOMATION_FIRE_RESULTS)[number];

/**
 * Webhook-in trigger: a provider thread/issue event gated by an AND/OR/NOT
 * intake filter (validated at effect time by `FilterNodeSchema` in the
 * trigger engine — kept `unknown` here so this types module never imports
 * the integrations domain). Kill-switches mirror the other kinds
 * (`enabled:false`, `maxFires:0` = off). ESM only.
 */
export const WebhookTriggerSchema = baseTrigger.extend({
  kind: z.literal(WEBHOOK_TRIGGER_KIND),
  provider: z.enum(WEBHOOK_PROVIDER_ALLOWLIST).default("linear"),
  promptRef: z.string().min(1).max(256).optional(),
  filter: z.unknown().optional(),
}).strict();

export type WebhookTrigger = z.infer<typeof WebhookTriggerSchema>;

/** Full trigger union (schedule | event | webhook-in; additive F1 widening). */
export const FullTriggerSchema = z.discriminatedUnion("kind", [
  ScheduleTriggerSchema,
  EventTriggerSchema,
  WebhookTriggerSchema,
]);

export type AnyTrigger = z.infer<typeof FullTriggerSchema>;

export const AutomationsSectionSchema = z.object({
  enabled: z.boolean().default(true),
  tickMs: z.number().int().min(0).default(AUTOMATION_TICK_DEFAULT_MS),
  triggers: z.array(TriggerSchema).max(AUTOMATIONS_MAX_TRIGGERS).default([]),
}).strict();

/** In-memory runtime state per trigger (kept by automationStore.ts, T02). */
export interface TriggerRuntimeState {
  fires: number;
  lastFireAt: string | null;
  lastEventId: string | null;
  nextTickAt: string | null;
  disabledReason: string | null;
}

/** One evidence entry in the central ring (factory/.automations.json). */
export interface AutomationFireRecord {
  seq: number;
  triggerName: string;
  kind: "schedule" | "event" | "webhook-in";
  at: string;
  action: "create-job" | "notify-integration";
  jobId: string | null;
  eventId: string | null;
  result: "created" | "notified" | "skipped-quota" | "skipped-cooldown" | "skipped-disabled" | "skipped-dedupe" | "skipped-filter";
  note?: string;
}

/** Central evidence file shape (ring: cap AUTOMATIONS_MAX_ENTRIES, oldest evicted). */
export interface AutomationsFileShape {
  version: 1;
  entries: AutomationFireRecord[];
}

/** Link stamped into job.json for every trigger-created job (additive). */
export const TriggerRefSchema = z.object({
  triggerName: z.string(),
  firedAt: z.string(),
  eventId: z.string().nullable().default(null),
});
