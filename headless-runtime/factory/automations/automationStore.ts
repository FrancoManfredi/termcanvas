/**
 * automations/automationStore — Wave 14 T02 (Track A): central evidence ring.
 *
 * Single writer (C3) of `factory/.automations.json`: append-only ring with a
 * hard cap (AUTOMATIONS_MAX_ENTRIES, oldest evicted). Reads are restore
 * tolerant (missing or corrupt file equals an empty list, never throws).
 * Runtime state per trigger is derived from the ring (fires, lastFireAt,
 * lastEventId), so memory and disk can never drift apart.
 *
 * Bounds (Rule 7): ring cap 200, atomic tmp-then-rename disk writes,
 * no timers, no hand-written loops (array combinators only).
 * Kill-switches (Rule 8) live in automationService, not here.
 *
 * ESM only, zero require(). Every export is fail-safe (never throws).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOMATIONS_MAX_ENTRIES,
  type AutomationFireRecord,
  type AutomationsFileShape,
  type TriggerRuntimeState,
} from "./automationTypes";

/** Evidence file name under the factory base dir (contract). */
export const AUTOMATIONS_FILE_NAME = ".automations.json";

/** Schema version written by this store (restore tolerates other shapes). */
export const AUTOMATIONS_FILE_VERSION = 1;

/** Input for appendFire (seq is assigned by the store). */
export type AutomationFireInput = Omit<AutomationFireRecord, "seq">;

const FIRE_KINDS: ReadonlySet<string> = new Set(["schedule", "event"]);
const FIRE_ACTIONS: ReadonlySet<string> = new Set(["create-job", "notify-integration"]);
const FIRE_RESULTS: ReadonlySet<string> = new Set([
  "created",
  "notified",
  "skipped-quota",
  "skipped-cooldown",
  "skipped-disabled",
  "skipped-dedupe",
]);

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // falls through to cwd probing
  }
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "factory"))
    ) {
      return cwd;
    }
  } catch {
    // falls through to cwd default
  }
  return process.cwd();
}

function getFactoryBaseDir(): string {
  try {
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
  } catch {
    // falls through to repo default
  }
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

/**
 * Absolute path of the central evidence file. Honors
 * `process.env.TERMCANVAS_FACTORY_DIR` so tests run in a sandbox.
 * Never throws.
 */
export function getAutomationsFilePath(): string {
  try {
    return path.join(getFactoryBaseDir(), AUTOMATIONS_FILE_NAME);
  } catch {
    return path.join(process.cwd(), "factory", AUTOMATIONS_FILE_NAME);
  }
}

/** Zero state for a trigger that never fired. Never throws. */
export function defaultTriggerState(): TriggerRuntimeState {
  return {
    fires: 0,
    lastFireAt: null,
    lastEventId: null,
    nextTickAt: null,
    disabledReason: null,
  };
}

function asCleanString(value: unknown, maxLen: number): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, maxLen);
  } catch {
    return null;
  }
}

function sanitizeFireEntry(item: unknown): AutomationFireRecord | null {
  try {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const triggerName = asCleanString(o.triggerName, 64);
    const kindRaw = typeof o.kind === "string" ? o.kind : "";
    const actionRaw = typeof o.action === "string" ? o.action : "";
    const resultRaw = typeof o.result === "string" ? o.result : "";
    const at = asCleanString(o.at, 64);
    if (!triggerName || !FIRE_KINDS.has(kindRaw) || !FIRE_ACTIONS.has(actionRaw)) return null;
    if (!FIRE_RESULTS.has(resultRaw) || !at) return null;
    const seqRaw = o.seq;
    const seq =
      typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw > 0 ? seqRaw : 0;
    if (seq <= 0) return null;
    const jobId =
      o.jobId === null || o.jobId === undefined
        ? null
        : asCleanString(o.jobId, 128) ?? null;
    const eventId =
      o.eventId === null || o.eventId === undefined
        ? null
        : asCleanString(o.eventId, 128) ?? null;
    const note =
      typeof o.note === "string" && o.note.trim().length > 0
        ? o.note.trim().slice(0, 300)
        : undefined;
    return {
      seq,
      triggerName,
      kind: kindRaw as AutomationFireRecord["kind"],
      at,
      action: actionRaw as AutomationFireRecord["action"],
      jobId,
      eventId,
      result: resultRaw as AutomationFireRecord["result"],
      ...(note !== undefined ? { note } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Reads the ring oldest-first (missing or corrupt file equals []). Applies
 * the hard cap defensively (keeps the newest entries). Never throws.
 */
export function readFires(): AutomationFireRecord[] {
  try {
    const filePath = getAutomationsFilePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const rawEntries: unknown = Array.isArray(parsed)
      ? parsed
      : (parsed as Partial<AutomationsFileShape> | null)?.entries;
    const candidates: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
    const cleaned = candidates
      .map((item) => sanitizeFireEntry(item))
      .filter((e): e is AutomationFireRecord => e !== null);
    if (cleaned.length > AUTOMATIONS_MAX_ENTRIES) {
      return cleaned.slice(-AUTOMATIONS_MAX_ENTRIES);
    }
    return cleaned;
  } catch {
    return [];
  }
}

let seqCounter = 0;
let seqSeededForPath: string | null = null;

function nextSeq(existing: AutomationFireRecord[], filePath: string): number {
  try {
    if (seqSeededForPath !== filePath) {
      const maxSeen = existing.reduce(
        (acc, e) => (e.seq > acc ? e.seq : acc),
        0,
      );
      seqCounter = maxSeen;
      seqSeededForPath = filePath;
    }
    seqCounter += 1;
    if (!Number.isSafeInteger(seqCounter) || seqCounter <= 0) {
      seqCounter = Date.now();
    }
    return seqCounter;
  } catch {
    return Date.now();
  }
}

function persistBestEffort(entries: AutomationFireRecord[], filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload: AutomationsFileShape = {
      version: AUTOMATIONS_FILE_VERSION,
      entries,
    };
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // best-effort: evidence must never break the caller
  }
}

/**
 * Appends one fire record to the ring (assigns seq, evicts oldest beyond
 * the cap, persists atomically best-effort). Never throws.
 */
export function appendFire(input: AutomationFireInput): AutomationFireRecord {
  try {
    const filePath = getAutomationsFilePath();
    const existing = readFires();
    const record: AutomationFireRecord = {
      seq: nextSeq(existing, filePath),
      triggerName: input.triggerName,
      kind: input.kind,
      at: input.at,
      action: input.action,
      jobId: input.jobId ?? null,
      eventId: input.eventId ?? null,
      result: input.result,
      ...(typeof input.note === "string" && input.note.trim().length > 0
        ? { note: input.note.trim().slice(0, 300) }
        : {}),
    };
    const next = [...existing, record];
    const capped =
      next.length > AUTOMATIONS_MAX_ENTRIES ? next.slice(-AUTOMATIONS_MAX_ENTRIES) : next;
    persistBestEffort(capped, filePath);
    return record;
  } catch {
    try {
      return {
        seq: Date.now(),
        triggerName: "unknown",
        kind: "schedule",
        at: new Date().toISOString(),
        action: "create-job",
        jobId: null,
        eventId: null,
        result: "skipped-disabled",
        note: "appendFire failed internally",
      };
    } catch {
      return {
        seq: 1,
        triggerName: "unknown",
        kind: "schedule",
        at: "1970-01-01T00:00:00.000Z",
        action: "create-job",
        jobId: null,
        eventId: null,
        result: "skipped-disabled",
      };
    }
  }
}

/**
 * Runtime state for one trigger, derived from the ring: fires counts only
 * real effects (created + notified); skips do not consume quota visibility
 * here (quota itself is enforced from this same count in the engine).
 * Unknown triggers get the zero state. Never throws.
 */
export function getState(triggerName: string): TriggerRuntimeState {
  try {
    if (typeof triggerName !== "string" || triggerName.trim().length === 0) {
      return defaultTriggerState();
    }
    const name = triggerName.trim();
    const matching = readFires().filter((e) => e.triggerName === name);
    const effects = matching.filter(
      (e) => e.result === "created" || e.result === "notified",
    );
    const last = matching.length > 0 ? matching[matching.length - 1] : undefined;
    return {
      fires: effects.length,
      lastFireAt: last?.at ?? null,
      lastEventId: last?.eventId ?? null,
      nextTickAt: null,
      disabledReason: null,
    };
  } catch {
    return defaultTriggerState();
  }
}

/**
 * Newest-first slice of the ring for list responses (default 20, clamped
 * to the hard cap). Never throws.
 */
export function listRecentFires(limit?: number): AutomationFireRecord[] {
  try {
    const n =
      typeof limit === "number" && Number.isInteger(limit) && limit > 0
        ? Math.min(limit, AUTOMATIONS_MAX_ENTRIES)
        : 20;
    return readFires().slice(-n).reverse();
  } catch {
    return [];
  }
}

/** Resets module seq bookkeeping (tests only; disk is sandbox-scoped). */
export function resetAutomationStoreForTests(): void {
  try {
    seqCounter = 0;
    seqSeededForPath = null;
  } catch {
    // noop
  }
}
