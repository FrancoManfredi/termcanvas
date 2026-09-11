/**
 * automations/triggerEngine — Wave 14 T02 (Track A): pure trigger decisions.
 *
 * Zero I/O: `triggers x states x now x event? -> actions[]`. All effects
 * (disk, jobs, notifications, integrations) live in automationService, which
 * is the only caller in production. Exactly-one validation
 * (`intervalMs XOR cron`) already happened in automationTypes schemas; the
 * engine still fails closed (both or neither set equals not-due) so a
 * hand-built trigger can never slip through.
 *
 * Bounds (Rule 7): at most one action per trigger per evaluation; event
 * dedupe is a caller-held FIFO id list capped at AUTOMATION_SEEN_EVENT_CAP
 * (helpers below are pure). Kill-switches (Rule 8: enabled flags,
 * maxFires 0 = off, cooldownMs 0 = no cooldown) are enforced here.
 *
 * Cron is a 5-field minute-exact matcher evaluated in UTC (no external lib,
 * P0 approximation documented in DESIGN section 9.7). Supported field forms:
 * `*`, `*\/n`, `n`, `n-m`, `n-m/s`, comma lists. `dom` AND `dow` (standard
 * cron OR is intentionally not implemented in P0).
 *
 * ESM only, zero require(). Every export is pure and never throws.
 */

import type { TriggerRuntimeState } from "./automationTypes";
import { explainIntakeFilter, matchesIntakeFilter } from "../integrations/filterEngine";
import type { IntakeFilter } from "../integrations/integrationTypes";

/** Cap of the caller-held dedupe FIFO for event ids (Rule 7). */
export const AUTOMATION_SEEN_EVENT_CAP = 500;

/** Structural schedule trigger (matches the zod output shape, no import). */
export interface ScheduleTriggerLike {
  readonly kind: "schedule";
  readonly name: string;
  readonly enabled: boolean;
  readonly maxFires: number;
  readonly cooldownMs: number;
  readonly intervalMs?: number;
  readonly cron?: string;
  readonly promptRef: string;
}

/** Structural event trigger (matches the zod output shape, no import). */
export interface EventTriggerLike {
  readonly kind: "event";
  readonly name: string;
  readonly enabled: boolean;
  readonly maxFires: number;
  readonly cooldownMs: number;
  readonly on: string;
  readonly action: "create-job" | "notify-integration";
  readonly promptRef?: string;
}

/** Minimal state view the engine needs (full TriggerRuntimeState fits). */
export type EngineStateLike = Pick<TriggerRuntimeState, "fires" | "lastFireAt">;

/** States keyed by trigger name (missing entry equals never-fired). */
export type EngineStates = Readonly<Record<string, EngineStateLike | undefined>>;

/** Inbound event (validated by the service before reaching the engine). */
export interface AutomationEngineEvent {
  readonly id: string;
  readonly kind: string;
  readonly jobId?: string | null;
}

/** One scheduled firing decision (schedule triggers always create jobs). */
export interface DueAction {
  readonly triggerName: string;
  readonly kind: "schedule";
  readonly action: "create-job";
  readonly promptRef: string;
  readonly eventId: null;
}

/** One event firing decision (action comes from the trigger). */
export interface EventAction {
  readonly triggerName: string;
  readonly kind: "event";
  readonly action: "create-job" | "notify-integration";
  readonly promptRef?: string;
  readonly eventId: string;
}

/** Zero state for triggers with no recorded state. Never throws. */
export function defaultEngineState(): EngineStateLike {
  return { fires: 0, lastFireAt: null };
}

function readState(states: EngineStates | null | undefined, name: string): EngineStateLike {
  try {
    const found = states?.[name];
    if (!found || typeof found !== "object") return defaultEngineState();
    const fires =
      typeof found.fires === "number" && Number.isInteger(found.fires) && found.fires >= 0
        ? found.fires
        : 0;
    const lastFireAt =
      typeof found.lastFireAt === "string" && found.lastFireAt.length > 0
        ? found.lastFireAt
        : null;
    return { fires, lastFireAt };
  } catch {
    return defaultEngineState();
  }
}

function asNow(nowMs: unknown): number {
  try {
    if (typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs >= 0) return nowMs;
    return Date.now();
  } catch {
    return Date.now();
  }
}

/**
 * True while the trigger may still fire (fires < maxFires). maxFires 0
 * equals never (Rule 8). Fail-closed on malformed input. Never throws.
 */
export function isQuotaLeft(
  state: EngineStateLike | null | undefined,
  trigger: { readonly maxFires: unknown } | null | undefined,
): boolean {
  try {
    const max =
      trigger !== null &&
      typeof trigger === "object" &&
      typeof trigger.maxFires === "number" &&
      Number.isInteger(trigger.maxFires) &&
      trigger.maxFires >= 0
        ? trigger.maxFires
        : 0;
    const fires =
      state !== null &&
      typeof state === "object" &&
      typeof state.fires === "number" &&
      Number.isInteger(state.fires) &&
      state.fires >= 0
        ? state.fires
        : 0;
    return fires < max;
  } catch {
    return false;
  }
}

/**
 * True when the cooldown window has passed since lastFireAt.
 * cooldownMs 0 equals no cooldown; never-fired equals over. An unparsable
 * timestamp counts as over (quota still bounds; a corrupt clock must not
 * wedge a trigger forever). Never throws.
 */
export function isCooldownOver(
  state: EngineStateLike | null | undefined,
  trigger: { readonly cooldownMs: unknown } | null | undefined,
  nowMs: unknown,
): boolean {
  try {
    const cooldown =
      trigger !== null &&
      typeof trigger === "object" &&
      typeof trigger.cooldownMs === "number" &&
      Number.isInteger(trigger.cooldownMs) &&
      trigger.cooldownMs >= 0
        ? trigger.cooldownMs
        : 0;
    if (cooldown <= 0) return true;
    const last =
      state !== null && typeof state === "object" && typeof state.lastFireAt === "string"
        ? state.lastFireAt
        : null;
    if (last === null) return true;
    const at = Date.parse(last);
    if (!Number.isFinite(at)) return true;
    return asNow(nowMs) - at >= cooldown;
  } catch {
    return false;
  }
}

function matchCronPart(part: string, value: number, min: number, max: number): boolean {
  try {
    if (part.length === 0) return false;
    const slash = part.split("/");
    if (slash.length > 2) return false;
    const rangeText = (slash[0] ?? "").trim();
    const step = slash.length > 1 ? Number((slash[1] ?? "").trim()) : 1;
    if (!Number.isInteger(step) || step <= 0) return false;
    let lo: number;
    let hi: number;
    if (rangeText === "*") {
      lo = min;
      hi = max;
    } else if (rangeText.includes("-")) {
      const bounds = rangeText.split("-");
      if (bounds.length !== 2) return false;
      lo = Number((bounds[0] ?? "").trim());
      hi = Number((bounds[1] ?? "").trim());
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false;
    } else {
      const n = Number(rangeText);
      if (!Number.isInteger(n)) return false;
      lo = n;
      hi = n;
    }
    if (value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  } catch {
    return false;
  }
}

function matchCronField(field: string, value: number, min: number, max: number): boolean {
  try {
    const f = field.trim();
    if (f.length === 0) return false;
    if (f === "*") return true;
    if (f.startsWith("*/")) {
      const step = Number(f.slice(2).trim());
      if (!Number.isInteger(step) || step <= 0) return false;
      return value % step === 0;
    }
    return f
      .split(",")
      .some((part) => matchCronPart(part.trim(), value, min, max));
  } catch {
    return false;
  }
}

/**
 * Minute-exact UTC cron matcher (5 fields: minute hour dom month dow).
 * Returns false for anything malformed (fail-closed). Never throws.
 */
export function cronMatchesMinute(cron: unknown, nowMs: unknown): boolean {
  try {
    if (typeof cron !== "string") return false;
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return false;
    const [minF = "", hourF = "", domF = "", monthF = "", dowRaw = ""] = fields;
    // Normalize Sunday 7 to 0 without touching ranges/steps textually.
    const dowF = dowRaw.replace(/\b7\b/g, "0");
    const d = new Date(asNow(nowMs));
    if (!matchCronField(minF, d.getUTCMinutes(), 0, 59)) return false;
    if (!matchCronField(hourF, d.getUTCHours(), 0, 23)) return false;
    if (!matchCronField(domF, d.getUTCDate(), 1, 31)) return false;
    if (!matchCronField(monthF, d.getUTCMonth() + 1, 1, 12)) return false;
    if (!matchCronField(dowF, d.getUTCDay(), 0, 6)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a schedule trigger is due right now (interval elapsed, or cron
 * minute match). Fails closed when exactly-one is violated (both or neither
 * of intervalMs/cron set). Ignores enabled/quota/cooldown (the caller
 * layers those). Never throws.
 */
export function isScheduleDue(
  trigger: ScheduleTriggerLike | null | undefined,
  state: EngineStateLike | null | undefined,
  nowMs: unknown,
): boolean {
  try {
    if (!trigger || typeof trigger !== "object" || trigger.kind !== "schedule") return false;
    const hasI =
      typeof trigger.intervalMs === "number" &&
      Number.isInteger(trigger.intervalMs) &&
      trigger.intervalMs > 0;
    const hasC = typeof trigger.cron === "string" && trigger.cron.trim().length > 0;
    if (hasI === hasC) return false;
    const now = asNow(nowMs);
    if (hasI) {
      const last =
        state !== null && typeof state === "object" && typeof state.lastFireAt === "string"
          ? state.lastFireAt
          : null;
      if (last === null) return true;
      const at = Date.parse(last);
      if (!Number.isFinite(at)) return true;
      return now - at >= (trigger.intervalMs as number);
    }
    return cronMatchesMinute(trigger.cron, now);
  } catch {
    return false;
  }
}

/**
 * Pure schedule pass: at most one DueAction per due schedule trigger.
 * Layering per trigger: enabled, then quota, then cooldown, then due.
 * Never throws.
 */
export function evaluateDue(
  triggers: ReadonlyArray<ScheduleTriggerLike> | null | undefined,
  states: EngineStates | null | undefined,
  nowMs: unknown,
): DueAction[] {
  try {
    if (!Array.isArray(triggers)) return [];
    const now = asNow(nowMs);
    return triggers
      .filter(
        (t): t is ScheduleTriggerLike =>
          !!t &&
          typeof t === "object" &&
          t.kind === "schedule" &&
          typeof t.name === "string" &&
          t.name.length > 0 &&
          t.enabled === true &&
          typeof t.promptRef === "string" &&
          t.promptRef.length > 0,
      )
      .filter((t) => isQuotaLeft(readState(states, t.name), t))
      .filter((t) => isCooldownOver(readState(states, t.name), t, now))
      .filter((t) => isScheduleDue(t, readState(states, t.name), now))
      .map((t) => ({
        triggerName: t.name,
        kind: "schedule" as const,
        action: "create-job" as const,
        promptRef: t.promptRef,
        eventId: null,
      }));
  } catch {
    return [];
  }
}

/**
 * Pure event pass: zero or one EventAction for a single trigger against a
 * single event. Layering: kind/on match, enabled, quota, cooldown.
 * Dedupe is caller-held (see isDuplicateEvent). Never throws.
 */
export function evaluateEvent(
  trigger: EventTriggerLike | null | undefined,
  state: EngineStateLike | null | undefined,
  event: AutomationEngineEvent | null | undefined,
  nowMs: unknown,
): EventAction[] {
  try {
    if (!trigger || typeof trigger !== "object" || trigger.kind !== "event") return [];
    if (!event || typeof event !== "object") return [];
    if (typeof trigger.name !== "string" || trigger.name.length === 0) return [];
    if (typeof event.id !== "string" || event.id.length === 0) return [];
    if (typeof event.kind !== "string" || event.kind.length === 0) return [];
    if (trigger.on !== event.kind) return [];
    if (trigger.enabled !== true) return [];
    if (!isQuotaLeft(state ?? defaultEngineState(), trigger)) return [];
    if (!isCooldownOver(state ?? defaultEngineState(), trigger, nowMs)) return [];
    if (trigger.action !== "create-job" && trigger.action !== "notify-integration") return [];
    return [
      {
        triggerName: trigger.name,
        kind: "event" as const,
        action: trigger.action,
        ...(typeof trigger.promptRef === "string" && trigger.promptRef.length > 0
          ? { promptRef: trigger.promptRef }
          : {}),
        eventId: event.id,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * F1-T2 webhook-in evaluation: pure `trigger x state x event x now`.
 *
 * Layering per trigger: kind match, enabled, quota, cooldown, provider
 * allowlist match (unset trigger provider = any provider), then the pure
 * `filterEngine` verdict over the event (absent filter = accept-all).
 * At most one WebhookAction per call. Malformed input fails closed to [].
 * Never throws, never touches I/O (the filter engine is pure).
 */

/** Structural webhook-in trigger (matches WebhookTriggerSchema output). */
export interface WebhookTriggerLike {
  readonly kind: "webhook-in";
  readonly name: string;
  readonly enabled: boolean;
  readonly maxFires: number;
  readonly cooldownMs: number;
  readonly provider?: string;
  readonly promptRef?: string;
  readonly filter?: IntakeFilter;
}

/** Inbound live intake event view the engine needs. */
export interface WebhookEngineEvent {
  readonly id: string;
  readonly provider: string;
  readonly threadId: string;
  readonly author?: string;
  readonly title: string;
  readonly body?: string;
  readonly labels?: ReadonlyArray<string>;
}

/** One webhook firing decision (webhook triggers always create jobs). */
export interface WebhookAction {
  readonly triggerName: string;
  readonly kind: "webhook-in";
  readonly action: "create-job";
  readonly promptRef?: string;
  readonly eventId: string;
  readonly threadId: string;
  /** One-line auditable filter reason (filterEngine.explain). */
  readonly explain: string;
}

function asNonEmptyString(value: unknown): string | null {
  try {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Pure webhook pass: zero or one WebhookAction for a single trigger
 * against a single intake event. Never throws.
 */
export function evaluateWebhook(
  trigger: WebhookTriggerLike | null | undefined,
  state: EngineStateLike | null | undefined,
  event: WebhookEngineEvent | null | undefined,
  nowMs: unknown,
): WebhookAction[] {
  try {
    if (!trigger || typeof trigger !== "object" || trigger.kind !== "webhook-in") return [];
    if (!event || typeof event !== "object") return [];
    if (typeof trigger.name !== "string" || trigger.name.length === 0) return [];
    const eventId = asNonEmptyString(event.id);
    const provider = asNonEmptyString(event.provider);
    const threadId = asNonEmptyString(event.threadId);
    const title = typeof event.title === "string" ? event.title : "";
    if (eventId === null || provider === null || threadId === null) return [];
    if (title.length === 0) return [];
    if (trigger.enabled !== true) return [];
    if (!isQuotaLeft(state ?? defaultEngineState(), trigger)) return [];
    if (!isCooldownOver(state ?? defaultEngineState(), trigger, nowMs)) return [];
    if (
      typeof trigger.provider === "string" &&
      trigger.provider.length > 0 &&
      trigger.provider !== provider
    ) {
      return [];
    }
    let labels: string[] = [];
    try {
      if (Array.isArray(event.labels)) {
        labels = event.labels.filter((l): l is string => typeof l === "string");
      }
    } catch {
      labels = [];
    }
    const intakeEvent = {
      provider,
      threadId,
      replyTo: null,
      author: typeof event.author === "string" ? event.author : "",
      title,
      body: typeof event.body === "string" ? event.body : "",
      labels,
      eventId,
    };
    let matched = false;
    let explain = "";
    try {
      matched = matchesIntakeFilter(
        trigger.filter as IntakeFilter | undefined,
        intakeEvent as never,
      );
    } catch {
      matched = false;
    }
    try {
      explain = explainIntakeFilter(
        trigger.filter as IntakeFilter | undefined,
        intakeEvent as never,
      );
    } catch {
      explain = "reject (explain failed) => false";
    }
    if (!matched) return [];
    return [
      {
        triggerName: trigger.name,
        kind: "webhook-in" as const,
        action: "create-job" as const,
        ...(typeof trigger.promptRef === "string" && trigger.promptRef.length > 0
          ? { promptRef: trigger.promptRef }
          : {}),
        eventId,
        threadId,
        explain,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Pure dedupe probe against the caller-held FIFO. Never throws.
 */
export function isDuplicateEvent(
  seenIds: ReadonlyArray<string> | null | undefined,
  eventId: unknown,
): boolean {
  try {
    if (!Array.isArray(seenIds)) return false;
    if (typeof eventId !== "string" || eventId.length === 0) return false;
    return seenIds.includes(eventId);
  } catch {
    return false;
  }
}

/**
 * Pure FIFO push with hard cap (evicts oldest beyond the cap, keeps first
 * occurrence on re-push). Mutates and returns the same array. Never throws.
 */
export function pushSeenEvent(seenIds: string[], eventId: unknown): string[] {
  try {
    if (!Array.isArray(seenIds)) return [];
    if (typeof eventId !== "string" || eventId.trim().length === 0) return seenIds;
    const id = eventId.trim();
    if (!seenIds.includes(id)) {
      seenIds.push(id);
    }
    if (seenIds.length > AUTOMATION_SEEN_EVENT_CAP) {
      seenIds.splice(0, seenIds.length - AUTOMATION_SEEN_EVENT_CAP);
    }
    return seenIds;
  } catch {
    try {
      return Array.isArray(seenIds) ? seenIds : [];
    } catch {
      return [];
    }
  }
}
