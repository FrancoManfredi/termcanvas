/**
 * automations/automationService — Wave 14 T02 (Track A): bounded effects.
 *
 * Orchestrates, never duplicates (C3): jobs are created through the single
 * writer workItemStore, notices go through the notify owner, integrations go
 * through an injected poster behind a local interface (zero static imports
 * of integrations/ — Track B wires the real poster in T04 via
 * setDefaultAutomationDeps; until then a notify-based fallback keeps the
 * notify-integration path live and honest).
 *
 * Bounds (Rule 7): tickOnce is a single pass (no rescheduling, at most one
 * action per trigger); event dedupe is a FIFO capped at 500; the evidence
 * ring is capped at 200 by the store; the ONLY timer is the single ticker
 * interval (start/stop form a pair, LOOPS row A01 registered by T04).
 * Kill-switches (Rule 8): global enabled, per-trigger enabled, maxFires 0 =
 * never, tickMs 0 = ticker fully off.
 *
 * Config (D18 loader fix): effective automations come from a FRESH read of
 * the `automations:` block of factory.yaml on every call — mirror of the
 * integrations reader
 * (headless-runtime/factory/integrations/integrationService.ts:92-284).
 * getFactoryConfig is never consulted here: its in-memory cache plus the
 * opaque skip in parseFactoryYaml
 * (headless-runtime/factory/agentLoader.ts:643) always yielded
 * `triggers: []` (see software-paridad-100/REPORT-D18-followup5-gap.md §2).
 * Decision, single and documented: fresh read per call, no cache, no mtime
 * watch (a tiny yaml read per 30s tick costs nothing; a cache would add
 * state plus a LOOPS row for zero benefit). parseFactoryYaml keeps its
 * skip: this fresh reader is the sole source, and the schemas stay
 * single-sourced in automationTypes (imported, never copied). Tests inject
 * overrides via setAutomationsConfigForTests. Takes effect after the user
 * restarts the daemon (it loads TS once, no watch mode).
 *
 * Pact gate: chained creation from a pact id is refused and recorded
 * (skipped-quota with a pact-id note); pacts F01-F14 stay intact.
 *
 * triggerRef: WorkItem has no top-level triggerRef field (strict schema), so
 * the ref is stamped additively in the job timeline meta (restore tolerant)
 * and in the fire record note. Evidence per fire: 1 ring record (+ timeline
 * entry on the created job); skips are report-only except pact refusals.
 *
 * Event path (D18 bridge): human-born ask_human/proposal-ready notifications
 * become fireEvent({id, kind, jobId}) through a notify created-listener
 * owned here (God +0: armed at import, no route, no timer). Trigger-born
 * notifications carry fromAutomation:true and never re-emit (anti-loop,
 * two layers); quota/cooldown/enabled stay enforced inside fireEvent.
 * Decision and premiere: software-paridad-100/REPORT-D18-event-bridge.md.
 *
 * ESM only, zero require(). Every export is fail-safe (never throws).
 */

import fs from "node:fs";
import path from "node:path";
import { workItemStore } from "../../workItem/workItemStore";
import {
  addNotificationCreatedListener,
  hasNotificationCreatedListener,
  notify,
  removeNotificationCreatedListener,
  type FactoryNotification,
  type NotificationEmitMeta,
} from "../../notify/notifications";
import {
  AUTOMATION_TICK_DEFAULT_MS,
  AutomationsSectionSchema,
  TRIGGER_EVENT_ALLOWLIST,
  type AutomationFireRecord,
} from "./automationTypes";
import type { z } from "zod";
import {
  AUTOMATION_SEEN_EVENT_CAP,
  evaluateDue,
  evaluateEvent,
  isCooldownOver,
  isDuplicateEvent,
  isQuotaLeft,
  isScheduleDue,
  pushSeenEvent,
  type EngineStates,
} from "./triggerEngine";
import {
  appendFire,
  getState as getTriggerState,
  readFires,
} from "./automationStore";

/** Effective automations config (zod output: defaults applied). */
export type AutomationsConfig = z.infer<typeof AutomationsSectionSchema>;

/** Inbound automation event (external callers pass plain objects). */
export interface AutomationEvent {
  readonly id: string;
  readonly kind: (typeof TRIGGER_EVENT_ALLOWLIST)[number];
  readonly jobId?: string | null;
}

/** Link stamped into the created job timeline meta + fire notes. */
export interface AutomationTriggerRef {
  readonly triggerName: string;
  readonly firedAt: string;
  readonly eventId: string | null;
}

/** Job creation seam (default uses the single writer workItemStore). */
export interface AutomationJobInput {
  readonly prompt: string;
  readonly worktree: string;
  readonly trigger: AutomationTriggerRef;
}

export type AutomationJobResult =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly error: string };

/** Notice seam (default uses the notify owner). */
export interface AutomationNotifyInput {
  readonly title: string;
  readonly body: string;
  readonly workItemId?: string;
  readonly dedupeKey?: string;
}

/** Integration seam (Track B provides the real poster in T04). */
export interface AutomationPostInput {
  readonly title: string;
  readonly body: string;
  readonly jobId: string | null;
}

export type AutomationPostResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string };

/** Injectable collaborators (all optional; sane fail-safe defaults). */
export interface AutomationDeps {
  readonly createJob?: (input: AutomationJobInput) => AutomationJobResult;
  readonly notifyTrigger?: (input: AutomationNotifyInput) => void;
  readonly postIntegration?: (input: AutomationPostInput) => AutomationPostResult;
  /** Worktree for created jobs (tests point at a tmpdir). */
  readonly worktree?: string;
  /** Factory base dir for promptRef reads (tests sandbox). */
  readonly factoryDir?: string;
}

export interface TickSkipped {
  readonly triggerName: string;
  readonly reason:
    | "global-disabled"
    | "trigger-disabled"
    | "quota"
    | "cooldown"
    | "not-due"
    | "error";
  readonly note?: string;
}

export interface TickReport {
  readonly ok: boolean;
  readonly at: string;
  readonly fired: number;
  readonly skipped: TickSkipped[];
  readonly fires: AutomationFireRecord[];
}

export interface FireReport {
  readonly ok: boolean;
  readonly at: string;
  readonly eventId: string | null;
  readonly fired: number;
  readonly dedupe: boolean;
  readonly skipped: TickSkipped[];
  readonly fires: AutomationFireRecord[];
  readonly error?: string;
}

/** Defaults when no config is readable (daemon never dies on bad yaml). */
export const AUTOMATIONS_DEFAULT_CONFIG: AutomationsConfig = {
  enabled: true,
  tickMs: AUTOMATION_TICK_DEFAULT_MS,
  triggers: [],
};

let configOverride: AutomationsConfig | null = null;
let defaultDeps: AutomationDeps | null = null;
const seenEventIds: string[] = [];

/** Test/composition seam: fixed effective config (null restores yaml). */
export function setAutomationsConfigForTests(cfg: AutomationsConfig | null): void {
  try {
    configOverride = cfg === null ? null : cfg;
  } catch {
    // noop
  }
}

/** Test/composition seam: process-wide default collaborators. */
export function setDefaultAutomationDeps(deps: AutomationDeps | null): void {
  try {
    defaultDeps = deps === null ? null : deps;
  } catch {
    // noop
  }
}

/** Copy of the dedupe FIFO (tests only). */
export function getSeenEventIdsForTests(): string[] {
  try {
    return [...seenEventIds];
  } catch {
    return [];
  }
}

// ── D18 event path: notify → fireEvent bridge (God +0) ──
//
// Decision (single, documented in
// software-paridad-100/REPORT-D18-event-bridge.md §2): generic observer
// registry owned by the notify domain + subscriber owned HERE (the
// automations domain already imports notify, so zero new import edges and
// zero cycles). The bridge arms at import: the daemon loads this module at
// boot via factoryServer → automationRoutes, so the first ask_human notify
// already finds it — no server line, no route, no timer (God +0).
// Emission is synchronous and bounded (straight-line code + the engine's
// quota/cooldown/enabled + the FIFO cap 500; LOOPS +0-note).

/**
 * Notify kinds with a 1:1 trigger event kind. Everything else
 * (spec-approval, benchmark-done, daemon-error) never reaches fireEvent.
 * job-complete has no notify producer today (closed NotificationKind).
 * Never throws.
 */
function isBridgedNotifyKind(kind: unknown): kind is "ask_human" | "proposal-ready" {
  try {
    return kind === "ask_human" || kind === "proposal-ready";
  } catch {
    return false;
  }
}

/**
 * Bridge subscriber: a freshly created human-born ask_human/proposal-ready
 * notification becomes one fireEvent({id, kind, jobId}) with the
 * notification id as the event id (dedupe-safe: dedupe hits never fan
 * out, so one notification fires at most once). Kill-switches
 * (automations.enabled, per-trigger enabled, maxFires, cooldown) are
 * enforced inside fireEvent — the bridge forwards blindly and honestly.
 * Never throws (notify isolates listeners too; double safety).
 */
function automationNotifyListener(
  notif: FactoryNotification,
  meta?: NotificationEmitMeta,
): void {
  try {
    if (!notif || typeof notif !== "object") return;
    // Anti-loop, layer 1 (authoritative): born from a trigger effect.
    try {
      if (meta?.fromAutomation === true) return;
    } catch {
      return;
    }
    // Anti-loop, layer 2 (spoof-tolerant): trigger posts always carry the
    // automation dedupe namespace or an evidence title prefix, even when a
    // hand-built caller omits the flag.
    try {
      const dk = meta?.dedupeKey;
      if (typeof dk === "string" && dk.startsWith("automation:")) return;
    } catch {
      return;
    }
    try {
      const title = typeof notif.title === "string" ? notif.title : "";
      if (title.startsWith("[automation]") || title.startsWith("[integration-mock]")) return;
    } catch {
      return;
    }
    if (!isBridgedNotifyKind(notif.kind)) return;
    const id = typeof notif.id === "string" ? notif.id.trim() : "";
    if (id.length === 0) return;
    const rawJob = (notif as { workItemId?: unknown }).workItemId;
    const jobId =
      typeof rawJob === "string" && rawJob.trim().length > 0 ? rawJob.trim() : null;
    try {
      fireEvent({ id, kind: notif.kind, jobId }, Date.now());
    } catch {
      // the bridge never breaks notify
    }
  } catch {
    // the bridge never breaks notify
  }
}

/**
 * Idempotent arming (true = subscribed). Tests call it after every reset.
 * Never throws.
 */
export function ensureAutomationNotifyBridge(): boolean {
  try {
    return addNotificationCreatedListener(automationNotifyListener);
  } catch {
    return false;
  }
}

/** True while the bridge holds a notify slot. Never throws. */
export function isAutomationNotifyBridgeArmed(): boolean {
  try {
    return hasNotificationCreatedListener(automationNotifyListener);
  } catch {
    return false;
  }
}

/** Releases the notify slot (tests only, via the full reset). Never throws. */
function disarmAutomationNotifyBridge(): void {
  try {
    removeNotificationCreatedListener(automationNotifyListener);
  } catch {
    // noop
  }
}

/** Clears overrides, dedupe FIFO and ticker (tests only). */
export function resetAutomationServiceForTests(): void {
  try {
    stopAutomationTicker();
  } catch {
    // noop
  }
  try {
    disarmAutomationNotifyBridge();
  } catch {
    // noop
  }
  try {
    seenEventIds.length = 0;
  } catch {
    // noop
  }
  try {
    configOverride = null;
    defaultDeps = null;
  } catch {
    // noop
  }
}

/**
 * Fresh automations reader (D18 loader fix). Mirror of the integrations
 * fresh reader (integrationService.ts:92-284): slice the top-level
 * `automations:` block from raw yaml text, shape it into flat top scalars
 * plus a triggers list of flat maps (the same subset the validator parses
 * in definitionValidate.ts), then safeParse against the single vocabulary
 * in automationTypes. The slicer lives here on purpose: this service never
 * imports the integrations domain (see module doc), and the validator
 * exposes issues rather than a parsed object — so a second tiny structural
 * parser is the low-coupling seam. Schemas are NOT duplicated (C6 holds).
 * Straight-line code only: one file read per call, one forEach pass over
 * finite yaml lines, zero timers, zero caches (LOOPS +0-note).
 */
function stripAutomationsComment(value: string): string {
  try {
    let inSingle = false;
    let inDouble = false;
    let cut = -1;
    value.split("").forEach((ch, i) => {
      if (cut >= 0) return;
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "#" && !inSingle && !inDouble && i > 0 && /\s/.test(value[i - 1] ?? "")) cut = i;
    });
    const out = (cut >= 0 ? value.slice(0, cut) : value).trim();
    if (out.length >= 2) {
      const first = out[0];
      const last = out[out.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return out.slice(1, -1);
      }
    }
    return out;
  } catch {
    return "";
  }
}

function coerceAutomationsScalar(raw: string): unknown {
  try {
    const v = stripAutomationsComment(raw);
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  } catch {
    return raw;
  }
}

/**
 * Raw lines under the top-level `automations:` block (header excluded).
 * Empty when the block is absent. Never throws.
 */
export function sliceAutomationsSection(text: unknown): string[] {
  try {
    if (typeof text !== "string") return [];
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let inside = false;
    const out: string[] = [];
    lines.forEach((line) => {
      try {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
          if (inside) out.push(line);
          return;
        }
        const indent = line.length - line.trimStart().length;
        if (indent === 0) {
          inside = trimmed === "automations:";
          return;
        }
        if (inside) out.push(line);
      } catch {
        // a weird line never aborts the slice
      }
    });
    return out;
  } catch {
    return [];
  }
}

export interface AutomationsYamlParsed {
  readonly top: Record<string, unknown>;
  readonly triggers: Array<Record<string, unknown>>;
  readonly malformed: boolean;
}

/**
 * Shapes sliced `automations:` lines into flat top scalars plus a triggers
 * list of flat maps. Tolerant on purpose: anything outside the subset flags
 * malformed and the caller degrades to safe defaults (the validate command
 * shouts with file:line; the daemon never dies). Never throws.
 */
export function parseAutomationsBlock(lines: string[]): AutomationsYamlParsed {
  const top: Record<string, unknown> = {};
  const triggers: Array<Record<string, unknown>> = [];
  let malformed = false;
  try {
    if (!Array.isArray(lines)) return { top, triggers, malformed: true };
    let inTriggers = false;
    let current: Record<string, unknown> | null = null;
    let currentIndent = 0;
    const putPair = (target: Record<string, unknown>, text: string): boolean => {
      try {
        const idx = text.indexOf(":");
        if (idx <= 0) return false;
        const key = text.slice(0, idx).trim();
        if (!key) return false;
        target[key] = coerceAutomationsScalar(text.slice(idx + 1));
        return true;
      } catch {
        return false;
      }
    };
    lines.forEach((line) => {
      try {
        if (malformed) return;
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) return;
        const indent = line.length - line.trimStart().length;
        if (indent === 2) {
          if (current !== null) {
            triggers.push(current);
            current = null;
          }
          if (trimmed === "triggers:") {
            inTriggers = true;
            return;
          }
          inTriggers = false;
          if (!putPair(top, trimmed)) malformed = true;
          return;
        }
        if (!inTriggers) return;
        if (trimmed.startsWith("- ") || trimmed === "-") {
          if (current !== null) triggers.push(current);
          current = {};
          currentIndent = indent;
          const rest = trimmed === "-" ? "" : trimmed.slice(2).trim();
          if (rest.length > 0 && !putPair(current, rest)) malformed = true;
          return;
        }
        if (current === null || indent <= currentIndent) {
          malformed = true;
          return;
        }
        if (!putPair(current, trimmed)) malformed = true;
      } catch {
        malformed = true;
      }
    });
    if (current !== null) triggers.push(current);
  } catch {
    malformed = true;
  }
  return { top, triggers, malformed };
}

/**
 * Parses full factory.yaml text into an effective automations config.
 * Null when the block is absent or unusable (the caller falls back to safe
 * defaults — missing file, missing block, malformed shape and schema
 * failures all degrade the same honest way). Never throws.
 */
export function parseAutomationsYamlText(text: unknown): AutomationsConfig | null {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    const lines = sliceAutomationsSection(text);
    if (lines.length === 0) return null;
    const parsed = parseAutomationsBlock(lines);
    if (parsed.malformed) return null;
    const checked = AutomationsSectionSchema.safeParse({ ...parsed.top, triggers: parsed.triggers });
    if (!checked.success) return null;
    return checked.data;
  } catch {
    return null;
  }
}

function readAutomationsYamlText(): string | null {
  try {
    const file = path.join(resolveFactoryBaseDir(), "factory.yaml");
    try {
      return fs.readFileSync(file, "utf-8");
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Effective automations config: test override, else a FRESH read of the
 * `automations:` block from factory.yaml disk text on every call (never
 * the cached getFactoryConfig — see module doc), else fail-safe defaults.
 * Disk edits are visible on the next tick with no process restart; code
 * changes still need the user to restart the daemon. Never throws.
 */
export function getEffectiveAutomationsConfig(): AutomationsConfig {
  try {
    if (configOverride !== null) return configOverride;
    const text = readAutomationsYamlText();
    if (text === null) return { ...AUTOMATIONS_DEFAULT_CONFIG, triggers: [] };
    const parsed = parseAutomationsYamlText(text);
    if (parsed !== null) return parsed;
    return { ...AUTOMATIONS_DEFAULT_CONFIG, triggers: [] };
  } catch {
    return { ...AUTOMATIONS_DEFAULT_CONFIG, triggers: [] };
  }
}

const PACT_ID_PREFIXES: readonly string[] = [
  "job-abc123",
  "job-f03",
  "job-f04",
  "job-f10",
  "job-f11",
  "job-f13",
  "job-f14",
  "playground-",
];

/**
 * Pact gate mirror (see implementService isPactJob): ids reserved for pact
 * tests F01-F14 must never seed chained work. Fail-closed. Never throws.
 */
export function isPactAutomationId(value: unknown): boolean {
  try {
    if (typeof value !== "string") return false;
    const v = value.trim().toLowerCase();
    if (v.length === 0) return false;
    return PACT_ID_PREFIXES.some((p) => v.startsWith(p));
  } catch {
    return false;
  }
}

function resolveFactoryBaseDir(explicit?: string): string {
  try {
    if (typeof explicit === "string" && explicit.trim().length > 0) {
      return path.resolve(explicit.trim());
    }
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
    return path.join(process.cwd(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

function resolveDefaultWorktree(factoryDir?: string): string {
  try {
    const parent = path.dirname(resolveFactoryBaseDir(factoryDir));
    if (typeof parent === "string" && parent.length > 0 && fs.existsSync(parent)) {
      return parent;
    }
    return process.cwd();
  } catch {
    return process.cwd();
  }
}

function readPromptText(promptRef: string, factoryDir?: string): string {
  try {
    if (typeof promptRef !== "string" || promptRef.length === 0) return "";
    if (promptRef.includes("..") || path.isAbsolute(promptRef) || promptRef.includes("\\")) {
      return "";
    }
    const base = resolveFactoryBaseDir(factoryDir);
    const repoRoot = path.dirname(base);
    const candidate = path.join(repoRoot, promptRef);
    if (!fs.existsSync(candidate)) return "";
    const text = fs.readFileSync(candidate, "utf-8");
    if (typeof text !== "string" || text.trim().length === 0) return "";
    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

function defaultCreateJob(deps: AutomationDeps, input: AutomationJobInput): AutomationJobResult {
  try {
    const now = Date.now();
    const rand = Math.floor(Math.random() * 0xffff)
      .toString(36)
      .replace(/[^a-z0-9]/g, "x");
    const id = `job-auto-${now.toString(36)}-${rand}`.toLowerCase();
    if (isPactAutomationId(id)) {
      return { ok: false, error: "generated id collides with pact range" };
    }
    const worktree =
      typeof deps.worktree === "string" && deps.worktree.trim().length > 0
        ? deps.worktree.trim()
        : resolveDefaultWorktree(deps.factoryDir);
    const item = workItemStore.create({
      id,
      prompt: input.prompt,
      worktree,
      phase: "diagnosisLlm",
    });
    try {
      workItemStore.appendEvent(item.id, "system", `trigger-fired ${input.trigger.triggerName}`, {
        triggerRef: {
          triggerName: input.trigger.triggerName,
          firedAt: input.trigger.firedAt,
          eventId: input.trigger.eventId,
        },
      });
    } catch {
      // evidence best-effort; the job itself already exists
    }
    return { ok: true, jobId: item.id };
  } catch (e) {
    return {
      ok: false,
      error: String(e instanceof Error ? e.message : e).slice(0, 160),
    };
  }
}

function defaultNotifyTrigger(input: AutomationNotifyInput): void {
  try {
    notify({
      kind: "proposal-ready",
      title: input.title,
      body: input.body,
      ...(input.workItemId ? { workItemId: input.workItemId } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      // Born from a trigger effect: the notify→event bridge must skip it
      // (anti-loop, D18). Human-born notifications never carry this flag.
      fromAutomation: true,
    });
  } catch {
    // evidence best-effort
  }
}

/**
 * Notify-based fallback for notify-integration (honest while Track B wires
 * the real poster in T04): records evidence in the notification center and
 * reports the notification id. Never throws.
 */
function defaultPostIntegration(input: AutomationPostInput): AutomationPostResult {
  try {
    const noted = notify({
      kind: "proposal-ready",
      title: `[integration-mock] ${input.title}`.slice(0, 200),
      body: `${input.body}${input.jobId ? ` (job ${input.jobId})` : ""}`.slice(0, 2000),
      // Same anti-loop mark as defaultNotifyTrigger (D18).
      fromAutomation: true,
    });
    if (noted && typeof noted.id === "string" && noted.id.length > 0) {
      return { ok: true, id: noted.id };
    }
    return { ok: true, id: `auto-post-${Date.now().toString(36)}` };
  } catch (e) {
    return {
      ok: false,
      error: String(e instanceof Error ? e.message : e).slice(0, 160),
    };
  }
}

function mergedDeps(deps?: AutomationDeps): Required<Pick<AutomationDeps, "createJob" | "notifyTrigger" | "postIntegration">> &
  AutomationDeps {
  const base = defaultDeps ?? {};
  const over = deps ?? {};
  const factoryDir =
    typeof over.factoryDir === "string" && over.factoryDir.trim().length > 0
      ? over.factoryDir
      : base.factoryDir;
  const worktree =
    typeof over.worktree === "string" && over.worktree.trim().length > 0
      ? over.worktree
      : base.worktree;
  const resolved: AutomationDeps = {
    ...(factoryDir ? { factoryDir } : {}),
    ...(worktree ? { worktree } : {}),
  };
  const createJob =
    over.createJob ?? base.createJob ?? ((input: AutomationJobInput) => defaultCreateJob(resolved, input));
  const notifyTrigger = over.notifyTrigger ?? base.notifyTrigger ?? defaultNotifyTrigger;
  const postIntegration =
    over.postIntegration ?? base.postIntegration ?? defaultPostIntegration;
  return { ...resolved, createJob, notifyTrigger, postIntegration };
}

function buildStatesMap(
  names: ReadonlyArray<string>,
): { map: EngineStates; skipped: TickSkipped[] } {
  const entries = names.map((name) => {
    try {
      return [name, getTriggerState(name)] as const;
    } catch {
      return [name, getTriggerState("")] as const;
    }
  });
  const map: Record<string, ReturnType<typeof getTriggerState>> = {};
  entries.forEach(([name, state]) => {
    map[name] = state;
  });
  return { map, skipped: [] };
}

/**
 * Single bounded pass over schedule triggers (never reschedules itself).
 * Only real effects are persisted (created); classification of the rest is
 * report-only. Never throws.
 */
export function tickOnce(nowMs?: number, deps?: AutomationDeps): TickReport {
  try {
    const now = typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs >= 0
      ? nowMs
      : Date.now();
    const at = new Date(now).toISOString();
    const cfg = getEffectiveAutomationsConfig();
    if (cfg.enabled !== true) {
      return {
        ok: true,
        at,
        fired: 0,
        skipped: [{ triggerName: "*", reason: "global-disabled" }],
        fires: [],
      };
    }
    const resolved = mergedDeps(deps);
    const schedules = cfg.triggers.filter(
      (t): t is Extract<AutomationsConfig["triggers"][number], { kind: "schedule" }> =>
        !!t && typeof t === "object" && t.kind === "schedule",
    );
    const { map: states } = buildStatesMap(schedules.map((t) => t.name));
    const actions = evaluateDue(schedules, states, now);
    const byName = new Map(actions.map((a) => [a.triggerName, a]));
    const fires: AutomationFireRecord[] = [];
    const skipped: TickSkipped[] = [];
    schedules.forEach((t) => {
      try {
        const action = byName.get(t.name);
        if (!action) {
          const st = states[t.name] ?? getTriggerState(t.name);
          if (t.enabled !== true) {
            skipped.push({ triggerName: t.name, reason: "trigger-disabled" });
          } else if (!isQuotaLeft(st, t)) {
            skipped.push({ triggerName: t.name, reason: "quota" });
          } else if (!isCooldownOver(st, t, now)) {
            skipped.push({ triggerName: t.name, reason: "cooldown" });
          } else if (!isScheduleDue(t, st, now)) {
            skipped.push({ triggerName: t.name, reason: "not-due" });
          } else {
            skipped.push({ triggerName: t.name, reason: "not-due" });
          }
          return;
        }
        const promptText = readPromptText(action.promptRef, resolved.factoryDir);
        const prompt =
          promptText.length > 0
            ? promptText
            : `[automation ${action.triggerName}] scheduled fire at ${at} (promptRef: ${action.promptRef})`;
        const created = resolved.createJob({
          prompt,
          worktree: resolved.worktree ?? resolveDefaultWorktree(resolved.factoryDir),
          trigger: { triggerName: action.triggerName, firedAt: at, eventId: null },
        });
        if (!created.ok) {
          skipped.push({
            triggerName: t.name,
            reason: "error",
            note: `create-failed: ${created.error}`.slice(0, 200),
          });
          return;
        }
        const record = appendFire({
          triggerName: action.triggerName,
          kind: "schedule",
          at,
          action: "create-job",
          jobId: created.jobId,
          eventId: null,
          result: "created",
        });
        fires.push(record);
        try {
          resolved.notifyTrigger({
            title: `[automation] ${action.triggerName} fired`,
            body: `job ${created.jobId} created at ${at}`,
            workItemId: created.jobId,
            dedupeKey: `automation:${action.triggerName}:${at}`,
          });
        } catch {
          // evidence best-effort
        }
      } catch (e) {
        skipped.push({
          triggerName: t.name,
          reason: "error",
          note: String(e instanceof Error ? e.message : e).slice(0, 200),
        });
      }
    });
    return { ok: true, at, fired: fires.length, skipped, fires };
  } catch (e) {
    try {
      return {
        ok: false,
        at: new Date().toISOString(),
        fired: 0,
        skipped: [
          {
            triggerName: "*",
            reason: "error",
            note: String(e instanceof Error ? e.message : e).slice(0, 200),
          },
        ],
        fires: [],
      };
    } catch {
      return {
        ok: false,
        at: "1970-01-01T00:00:00.000Z",
        fired: 0,
        skipped: [{ triggerName: "*", reason: "error" }],
        fires: [],
      };
    }
  }
}

function isValidEvent(event: unknown): event is AutomationEvent {
  try {
    if (!event || typeof event !== "object") return false;
    const e = event as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.trim().length === 0 || e.id.trim().length > 128) {
      return false;
    }
    if (typeof e.kind !== "string") return false;
    if (!(TRIGGER_EVENT_ALLOWLIST as readonly string[]).includes(e.kind)) return false;
    const jobId = e.jobId;
    if (jobId !== undefined && jobId !== null && typeof jobId !== "string") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Single bounded pass for one inbound event: dedupe (FIFO 500), then at most
 * one action per matching trigger. Pact-sourced chaining is refused and
 * recorded. Never throws.
 */
export function fireEvent(event: unknown, nowMs?: number, deps?: AutomationDeps): FireReport {
  try {
    const now = typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs >= 0
      ? nowMs
      : Date.now();
    const at = new Date(now).toISOString();
    if (!isValidEvent(event)) {
      return {
        ok: false,
        at,
        eventId: null,
        fired: 0,
        dedupe: false,
        skipped: [{ triggerName: "*", reason: "error", note: "invalid event" }],
        fires: [],
        error: "invalid event (id and allowlisted kind required)",
      };
    }
    const eventId = event.id.trim();
    if (isDuplicateEvent(seenEventIds, eventId)) {
      return {
        ok: true,
        at,
        eventId,
        fired: 0,
        dedupe: true,
        skipped: [{ triggerName: "*", reason: "not-due", note: `skipped-dedupe ${eventId}` }],
        fires: [],
      };
    }
    pushSeenEvent(seenEventIds, eventId);
    void AUTOMATION_SEEN_EVENT_CAP;
    const cfg = getEffectiveAutomationsConfig();
    if (cfg.enabled !== true) {
      return {
        ok: true,
        at,
        eventId,
        fired: 0,
        dedupe: false,
        skipped: [{ triggerName: "*", reason: "global-disabled" }],
        fires: [],
      };
    }
    const resolved = mergedDeps(deps);
    const matching = cfg.triggers.filter(
      (t): t is Extract<AutomationsConfig["triggers"][number], { kind: "event" }> =>
        !!t && typeof t === "object" && t.kind === "event" && t.on === event.kind,
    );
    const fires: AutomationFireRecord[] = [];
    const skipped: TickSkipped[] = [];
    matching.forEach((t) => {
      try {
        const decided = evaluateEvent(t, getTriggerState(t.name), event, now);
        if (decided.length === 0) {
          const st = getTriggerState(t.name);
          if (t.enabled !== true) {
            skipped.push({ triggerName: t.name, reason: "trigger-disabled" });
          } else if (!isQuotaLeft(st, t)) {
            skipped.push({ triggerName: t.name, reason: "quota" });
          } else if (!isCooldownOver(st, t, now)) {
            skipped.push({ triggerName: t.name, reason: "cooldown" });
          } else {
            skipped.push({ triggerName: t.name, reason: "not-due" });
          }
          return;
        }
        const action = decided[0];
        if (!action) {
          skipped.push({ triggerName: t.name, reason: "not-due" });
          return;
        }
        const jobId = typeof event.jobId === "string" && event.jobId.trim().length > 0
          ? event.jobId.trim()
          : null;
        if (action.action === "create-job") {
          if (jobId !== null && isPactAutomationId(jobId)) {
            const record = appendFire({
              triggerName: t.name,
              kind: "event",
              at,
              action: "create-job",
              jobId: null,
              eventId,
              result: "skipped-quota",
              note: `pact-id rejected: ${jobId.slice(0, 80)}`,
            });
            fires.push(record);
            skipped.push({
              triggerName: t.name,
              reason: "quota",
              note: `pact-id rejected: ${jobId.slice(0, 80)}`,
            });
            return;
          }
          const promptText =
            typeof action.promptRef === "string" && action.promptRef.length > 0
              ? readPromptText(action.promptRef, resolved.factoryDir)
              : "";
          const prompt =
            promptText.length > 0
              ? promptText
              : `[automation ${t.name}] event ${event.kind} (${eventId}) at ${at}` +
                (typeof action.promptRef === "string" && action.promptRef.length > 0
                  ? ` (promptRef: ${action.promptRef})`
                  : "");
          const created = resolved.createJob({
            prompt,
            worktree: resolved.worktree ?? resolveDefaultWorktree(resolved.factoryDir),
            trigger: { triggerName: t.name, firedAt: at, eventId },
          });
          if (!created.ok) {
            skipped.push({
              triggerName: t.name,
              reason: "error",
              note: `create-failed: ${created.error}`.slice(0, 200),
            });
            return;
          }
          fires.push(
            appendFire({
              triggerName: t.name,
              kind: "event",
              at,
              action: "create-job",
              jobId: created.jobId,
              eventId,
              result: "created",
            }),
          );
          try {
            resolved.notifyTrigger({
              title: `[automation] ${t.name} fired`,
              body: `event ${event.kind} (${eventId}) created job ${created.jobId}`,
              workItemId: created.jobId,
              dedupeKey: `automation:${t.name}:${eventId}`,
            });
          } catch {
            // evidence best-effort
          }
          return;
        }
        const posted = resolved.postIntegration({
          title: `[automation] ${t.name} — ${event.kind}`,
          body: `event ${eventId}${jobId ? ` for job ${jobId}` : ""} at ${at}`,
          jobId,
        });
        if (!posted.ok) {
          skipped.push({
            triggerName: t.name,
            reason: "error",
            note: `post-failed: ${posted.error}`.slice(0, 200),
          });
          return;
        }
        fires.push(
          appendFire({
            triggerName: t.name,
            kind: "event",
            at,
            action: "notify-integration",
            jobId,
            eventId,
            result: "notified",
          }),
        );
      } catch (e) {
        skipped.push({
          triggerName: t.name,
          reason: "error",
          note: String(e instanceof Error ? e.message : e).slice(0, 200),
        });
      }
    });
    return { ok: true, at, eventId, fired: fires.length, dedupe: false, skipped, fires };
  } catch (e) {
    try {
      return {
        ok: false,
        at: new Date().toISOString(),
        eventId: null,
        fired: 0,
        dedupe: false,
        skipped: [
          {
            triggerName: "*",
            reason: "error",
            note: String(e instanceof Error ? e.message : e).slice(0, 200),
          },
        ],
        fires: [],
        error: String(e instanceof Error ? e.message : e).slice(0, 200),
      };
    } catch {
      return {
        ok: false,
        at: "1970-01-01T00:00:00.000Z",
        eventId: null,
        fired: 0,
        dedupe: false,
        skipped: [{ triggerName: "*", reason: "error" }],
        fires: [],
        error: "fireEvent failed",
      };
    }
  }
}

let tickerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the single automation ticker (one setInterval, fixed tickMs).
 * tickMs 0 (or unresolvable) equals fully off: no timer, returns false.
 * Restart-safe: an existing timer is cleared first. Never throws.
 */
export function startAutomationTicker(options?: {
  readonly tickMs?: number;
  readonly deps?: AutomationDeps;
}): boolean {
  try {
    stopAutomationTicker();
    const cfg = getEffectiveAutomationsConfig();
    const raw = options?.tickMs ?? cfg.tickMs;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) return false;
    const deps = options?.deps;
    tickerHandle = setInterval(() => {
      try {
        tickOnce(Date.now(), deps);
      } catch {
        // a tick must never kill the ticker
      }
    }, raw);
    return true;
  } catch {
    return false;
  }
}

/** Clears the ticker interval (true when a timer was running). Never throws. */
export function stopAutomationTicker(): boolean {
  try {
    if (tickerHandle !== null) {
      clearInterval(tickerHandle);
      tickerHandle = null;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** True while the single ticker interval is armed. Never throws. */
export function isAutomationTickerRunning(): boolean {
  try {
    return tickerHandle !== null;
  } catch {
    return false;
  }
}

/** Ring read-through for routes/panels (never throws). */
export function readAutomationFires(): AutomationFireRecord[] {
  try {
    return readFires();
  } catch {
    return [];
  }
}

// Armed at import (see the D18 bridge section above): the daemon pulls this
// module at boot through factoryServer → automationRoutes, so production
// needs no wiring call. Idempotent; a tests-only reset disarms and the
// suite re-arms via ensureAutomationNotifyBridge().
try {
  ensureAutomationNotifyBridge();
} catch {
  // boot continues; an explicit ensure re-arms later
}
