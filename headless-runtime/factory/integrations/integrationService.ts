/**
 * integrations/integrationService — Wave 14 T03 (Track B): P0 service.
 *
 * Programs against the `IntegrationAdapter` port (today: `mockAdapter`,
 * local disk only). Owns the P0 gates: `integrations.enabled=false` refuses
 * outbound posts with an honest 409; any `mode` other than `mock-local` or
 * any `provider` other than `linear` is refused with a 400 that points at
 * `factory.yaml` (P1 live/slack arrive as another adapter, zero caller
 * changes). Never throws toward routes (every export is total), never
 * touches the network, never reads a secret (there are no secret fields in
 * P0; the validator rejects them fail-closed).
 *
 * Config source: the `integrations:` block of `factory.yaml`, read fresh on
 * every call (no cache, so tests can swap `TERMCANVAS_FACTORY_DIR` freely).
 * A missing file or a missing block means P0 defaults
 * (`enabled:true, mode:mock-local, provider:linear`), mirroring how
 * `agentLoader` tolerates absent sections. ESM only, zero `require()`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTEGRATION_BODY_MAX,
  INTEGRATION_TITLE_MAX,
  IntegrationsSectionSchema,
  LiveSectionSchema,
  IntakeEventSchema,
  MockPostInputSchema,
  PostBackSchema,
  WEBHOOK_DEDUPE_MAX,
} from "./integrationTypes";
import type {
  IntakeEvent,
  LiveSection,
  MockPostRecord,
} from "./integrationTypes";
import {
  ackMockPost,
  listMockPosts,
  postMockPost,
} from "./mockAdapter";
import { explainIntakeFilter, matchesIntakeFilter } from "./filterEngine";
import { createLiveAdapter } from "./liveAdapter";
import type { FetchLike } from "./liveAdapter";
import {
  createJobWithIntegrationRef,
  findJobIdForIntake,
} from "../jobs/jobCreate";
import { workItemStore } from "../../workItem/workItemStore";

// ── Factory dir + yaml text (self-contained mirror of the repo norm) ──

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // falls through to cwd
  }
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "headless-runtime"))
    ) {
      return cwd;
    }
  } catch {
    // falls through to cwd directly
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
    // falls through to repo
  }
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

function readFactoryYamlText(factoryDir?: unknown): string | null {
  try {
    const base =
      typeof factoryDir === "string" && factoryDir.trim().length > 0
        ? path.resolve(factoryDir.trim())
        : getFactoryBaseDir();
    const file = path.join(base, "factory.yaml");
    try {
      return fs.readFileSync(file, "utf-8");
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ── Minimal top-level section reader (scalars only; subset, documented) ──

function indentOf(line: string): number {
  try {
    const m = /^\s*/.exec(line);
    return m && typeof m[0] === "string" ? m[0].length : 0;
  } catch {
    return 0;
  }
}

function stripInlineComment(s: string): string {
  try {
    let inSingle = false;
    let inDouble = false;
    let cut = -1;
    s.split("").forEach((ch, i) => {
      if (cut >= 0) return;
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "#" && !inSingle && !inDouble && i > 0 && /\s/.test(s[i - 1] ?? "")) cut = i;
    });
    const out = (cut >= 0 ? s.slice(0, cut) : s).trim();
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

function coerceScalar(raw: string): unknown {
  try {
    const v = stripInlineComment(raw);
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  } catch {
    return raw;
  }
}

/**
 * Raw lines under a top-level `name:` block (header excluded). Empty when
 * the block is absent. Never throws.
 */
export function sliceTopSection(text: unknown, name: unknown): string[] {
  try {
    if (typeof text !== "string" || typeof name !== "string" || name.length === 0) return [];
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
        if (indentOf(line) === 0) {
          inside = trimmed === `${name}:`;
          return;
        }
        if (inside) out.push(line);
      } catch {
        // tolerant: a weird line never aborts the slice
      }
    });
    return out;
  } catch {
    return [];
  }
}

function parseSectionScalars(lines: string[]): Record<string, unknown> | null {
  try {
    const obj: Record<string, unknown> = {};
    let bad = false;
    lines.forEach((line) => {
      try {
        if (bad) return;
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) return;
        if (trimmed.startsWith("- ") || trimmed === "-") {
          bad = true;
          return;
        }
        if (indentOf(line) !== 2) return;
        const idx = trimmed.indexOf(":");
        if (idx <= 0) {
          bad = true;
          return;
        }
        const key = trimmed.slice(0, idx).trim();
        if (!key) {
          bad = true;
          return;
        }
        obj[key] = coerceScalar(trimmed.slice(idx + 1));
      } catch {
        bad = true;
      }
    });
    return bad ? null : obj;
  } catch {
    return null;
  }
}

// ── Config ──

export interface IntegrationsEffectiveConfig {
  enabled: boolean;
  mode: "mock-local";
  provider: "linear";
}

export type IntegrationsConfigResult =
  | { ok: true; config: IntegrationsEffectiveConfig }
  | { ok: false; error: string };

const P0_DEFAULT_CONFIG: IntegrationsEffectiveConfig = {
  enabled: true,
  mode: "mock-local",
  provider: "linear",
};

/**
 * Effective `integrations:` config. Missing file or missing block means P0
 * defaults (tolerant, like `agentLoader`). Present-but-invalid is refused
 * with an actionable error. Never throws.
 */
export function getIntegrationsConfig(factoryDir?: unknown): IntegrationsConfigResult {
  try {
    const text = readFactoryYamlText(factoryDir);
    if (text === null) return { ok: true, config: { ...P0_DEFAULT_CONFIG } };
    const lines = sliceTopSection(text, "integrations");
    if (lines.length === 0) return { ok: true, config: { ...P0_DEFAULT_CONFIG } };
    const obj = parseSectionScalars(lines);
    if (obj === null) {
      return {
        ok: false,
        error:
          "factory/factory.yaml: integrations must be flat scalars (enabled/mode/provider); nested lists are not supported in P0",
      };
    }
    const parsed = IntegrationsSectionSchema.safeParse(obj);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where =
        first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
      return {
        ok: false,
        error: `factory/factory.yaml: invalid integrations${where} (${String(first?.message ?? parsed.error.message).slice(0, 180)})`,
      };
    }
    return {
      ok: true,
      config: {
        enabled: parsed.data.enabled,
        mode: parsed.data.mode,
        provider: parsed.data.provider,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: `factory/factory.yaml: integrations unreadable (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`,
    };
  }
}

// ── Service operations (never throw toward routes) ──

export type PostNotificationResult =
  | { ok: true; post: MockPostRecord }
  | { ok: false; code: 400 | 409 | 500; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Posts one notification through the P0 mock adapter. `enabled=false`
 * refuses with an honest 409; bad mode/provider/input refuse with a 400.
 * Never throws, never touches the network.
 */
export function postNotification(input: unknown): PostNotificationResult {
  try {
    const cfg = getIntegrationsConfig();
    if (!cfg.ok) return { ok: false, code: 400, error: cfg.error };
    if (cfg.config.enabled !== true) {
      return {
        ok: false,
        code: 409,
        error:
          "integrations disabled (integrations.enabled=false in factory.yaml): outbound post refused",
      };
    }
    if (cfg.config.mode !== "mock-local") {
      return {
        ok: false,
        code: 400,
        error: 'integrations.mode must be "mock-local" in P0 (live is P1-design-only): outbound post refused',
      };
    }
    if (cfg.config.provider !== "linear") {
      return {
        ok: false,
        code: 400,
        error: 'integrations.provider must be "linear" in P0 (slack is P1): outbound post refused',
      };
    }
    const rec = asRecord(input) ?? {};
    const candidate = {
      provider: rec.provider ?? "linear",
      kind: rec.kind ?? "notification",
      jobId: rec.jobId ?? null,
      title: rec.title ?? "",
      body: rec.body ?? "",
    };
    const parsed = MockPostInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where =
        first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
      return {
        ok: false,
        code: 400,
        error: `invalid integration post${where} (${String(first?.message ?? parsed.error.message).slice(0, 160)}; title 1-${INTEGRATION_TITLE_MAX}, body 0-${INTEGRATION_BODY_MAX})`,
      };
    }
    try {
      const post = postMockPost(parsed.data);
      return { ok: true, post };
    } catch (e) {
      return {
        ok: false,
        code: 400,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      };
    }
  } catch (e) {
    return {
      ok: false,
      code: 500,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

/**
 * Acks one mock post by id (best-effort reconcile path). Unknown id
 * returns false. Never throws.
 */
export function ackNotification(id: unknown): boolean {
  try {
    return ackMockPost(id);
  } catch {
    return false;
  }
}

export interface IntegrationsStatusData {
  enabled: boolean;
  mode: string;
  provider: string;
  count: number;
  lastPostAt: string | null;
  lastAckedAt: string | null;
  /** Non-null when the yaml block exists but does not parse (visible fallback). */
  configError: string | null;
}

// ── F1-T2 live effects (additive; the mock-local path above is untouched) ──
//
// Port selection: `liveMode:false` (the default) keeps the EXACT P0
// mock-local behavior proven by `tests/integrations-mock.test.ts`.
// `liveMode:true` routes intake through the pure filter engine plus the
// live adapter (injected fetch, redacted logs, retry cap 3). Every new
// export below is total: results are values, never throws toward routes.

/** Live intake outcome (auditable, single vocabulary). */
export type IntakeOutcome =
  | "created"
  | "continued"
  | "skipped-dedupe"
  | "skipped-filter";

/** Intake result: ok carries the outcome + one-line explain; err is honest. */
export type IntakeResult =
  | { ok: true; outcome: IntakeOutcome; jobId: string | null; explain: string }
  | { ok: false; code: 400 | 409 | 500; error: string };

/** Job-writer seam (production defaults hit `jobs/jobCreate`; tests inject). */
export interface IntakeJobDeps {
  /** Creates (or continues) the job for a matched event. */
  createJob?: (input: {
    prompt: string;
    worktree: string;
    threadId: string;
    replyTo: string | null;
    eventId: string;
    provider: "linear" | "slack";
    liveMode: boolean;
  }) => { ok: boolean; jobId: string | null; continued: boolean };
  /** Appends a follow-up message to an already-known job. */
  appendToJob?: (jobId: string, message: string) => boolean;
  /** Reply-continues-item lookup (defaults to `findJobIdForIntake`). */
  findJob?: (threadId: string, replyTo: string | null) => string | null;
}

/** Intake call options (all optional; offline-safe defaults). */
export interface IntakeOptions {
  /** Worktree for newly created jobs (default: current directory). */
  worktree?: string;
  /** Injected live section (default: read from `factory.yaml`). */
  live?: LiveSection;
  /** Injected fetch for the live adapter (default: global fetch). */
  fetchImpl?: FetchLike;
  /** Explicit live HTTP timeout in ms (default 15s, see liveAdapter). */
  timeoutMs?: number;
  /** Job-writer seam (default: real `jobs/jobCreate` + workItem store). */
  jobs?: IntakeJobDeps;
  /** Factory dir override for yaml reads (tests). */
  factoryDir?: string;
}

/** Post-back call options (all optional; offline-safe defaults). */
export interface PostBackOptions {
  /** Injected live section (default: read from `factory.yaml`). */
  live?: LiveSection;
  /** Injected fetch for the live adapter (default: global fetch). */
  fetchImpl?: FetchLike;
  /** Explicit live HTTP timeout in ms (default 15s, see liveAdapter). */
  timeoutMs?: number;
  /** Log sink (every line pre-scrubbed; default silent). */
  logger?: (line: string) => void;
  /** Factory dir override for yaml reads (tests). */
  factoryDir?: string;
}

/** Post-back result: live remoteId, or the honest mock fallback. */
export type PostBackServiceResult =
  | { ok: true; via: "live" | "mock"; remoteId: string | null; note: string; attempts: number }
  | { ok: false; code: 400 | 409 | 500; error: string; attempts: number };

/** Caller-held webhook dedupe FIFO (LOOPS L-IN-01, cap FIFO, oldest out). */
const seenIntakeEventIds: string[] = [];

/** True when this event id was already handled. Never throws. */
export function isDuplicateIntakeEvent(eventId: unknown): boolean {
  try {
    if (typeof eventId !== "string" || eventId.length === 0) return false;
    return seenIntakeEventIds.includes(eventId);
  } catch {
    return false;
  }
}

/** Records one handled event id (FIFO cap, keeps first occurrence). */
function pushSeenIntakeEvent(eventId: string): void {
  try {
    if (!seenIntakeEventIds.includes(eventId)) seenIntakeEventIds.push(eventId);
    while (seenIntakeEventIds.length > WEBHOOK_DEDUPE_MAX) seenIntakeEventIds.splice(0, 1);
  } catch {
    // dedupe bookkeeping never breaks intake
  }
}

/** Clears the intake dedupe ring. Tests only. Never throws. */
export function resetIntakeDedupeForTests(): void {
  try {
    seenIntakeEventIds.splice(0, seenIntakeEventIds.length);
  } catch {
    // noop
  }
}

/**
 * Effective `live:` section. Missing file or missing block means the
 * default (liveMode:false — mock-local exactly as today), mirroring how
 * `getIntegrationsConfig` tolerates absent sections. Present-but-invalid
 * is refused with an actionable error. Never throws.
 */
export function getLiveConfig(
  factoryDir?: unknown,
): { ok: true; live: LiveSection } | { ok: false; error: string } {
  try {
    const text = readFactoryYamlText(factoryDir);
    if (text === null) {
      const parsed = LiveSectionSchema.safeParse({});
      if (parsed.success) return { ok: true, live: parsed.data };
      return { ok: true, live: { liveMode: false, provider: "linear", vaultRef: "", webhookSecretRef: "", allowPostBack: true } };
    }
    const lines = sliceTopSection(text, "live");
    if (lines.length === 0) {
      const parsed = LiveSectionSchema.safeParse({});
      if (parsed.success) return { ok: true, live: parsed.data };
      return { ok: true, live: { liveMode: false, provider: "linear", vaultRef: "", webhookSecretRef: "", allowPostBack: true } };
    }
    const obj = parseSectionScalars(lines);
    if (obj === null) {
      return {
        ok: false,
        error:
          "factory/factory.yaml: live must be flat scalars (liveMode/provider/vaultRef/webhookSecretRef/allowPostBack); nested filters ride the trigger, not the yaml",
      };
    }
    const parsed = LiveSectionSchema.safeParse(obj);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where =
        first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
      return {
        ok: false,
        error: `factory/factory.yaml: invalid live${where} (${String(first?.message ?? parsed.error.message).slice(0, 180)})`,
      };
    }
    return { ok: true, live: parsed.data };
  } catch (e) {
    return {
      ok: false,
      error: `factory/factory.yaml: live unreadable (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`,
    };
  }
}

function resolveLive(
  opts: IntakeOptions | PostBackOptions | undefined,
): { ok: true; live: LiveSection } | { ok: false; error: string } {
  try {
    if (opts && typeof (opts as IntakeOptions).live === "object" && (opts as IntakeOptions).live !== null) {
      // Normalize: an explicitly empty ref string means "absent" (the
      // schema defaults apply on undefined, while "" fails min(1) — the
      // T1 contract). Never mutates the caller's object.
      const raw = (opts as IntakeOptions).live as unknown as Record<string, unknown>;
      const normalized: Record<string, unknown> = { ...raw };
      try {
        if (normalized.vaultRef === "") delete normalized.vaultRef;
        if (normalized.webhookSecretRef === "") delete normalized.webhookSecretRef;
      } catch {
        // normalization is best-effort; the parse below decides
      }
      const parsed = LiveSectionSchema.safeParse(normalized);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return { ok: false, error: `invalid injected live section (${String(first?.message ?? "schema").slice(0, 120)})` };
      }
      return { ok: true, live: parsed.data };
    }
    return getLiveConfig((opts as { factoryDir?: string } | undefined)?.factoryDir);
  } catch (e) {
    return {
      ok: false,
      error: `live config unreadable (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`,
    };
  }
}

function buildIntakePrompt(ev: IntakeEvent): string {
  try {
    const head = `[${ev.provider}#${ev.threadId}] ${ev.title}`.slice(0, 200);
    const body = typeof ev.body === "string" ? ev.body.slice(0, 2000) : "";
    return body.length > 0 ? `${head}\n${body}` : head;
  } catch {
    return "intake event (unreadable title)";
  }
}

function defaultCreateJob(input: {
  prompt: string;
  worktree: string;
  threadId: string;
  replyTo: string | null;
  eventId: string;
  provider: "linear" | "slack";
  liveMode: boolean;
}): { ok: boolean; jobId: string | null; continued: boolean } {
  try {
    const res = createJobWithIntegrationRef({
      prompt: input.prompt,
      worktree: input.worktree,
      replyTo: input.replyTo,
      ref: {
        provider: input.provider,
        threadId: input.threadId,
        eventId: input.eventId,
        liveMode: input.liveMode,
      },
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true, jobId: res.jobId, continued: res.continued };
    }
    return { ok: false, jobId: null, continued: false };
  } catch {
    return { ok: false, jobId: null, continued: false };
  }
}

/**
 * Handles one inbound webhook event: validate → dedupe → live gate →
 * pure filter → create-or-continue (reply-continues-item, never a dup).
 * `liveMode:false` (default) refuses with an honest 409 so mock-local
 * stays byte-exact. Never throws (every failure is a value).
 */
export async function handleIntakeEvent(
  event: unknown,
  opts?: IntakeOptions,
): Promise<IntakeResult> {
  try {
    const parsed = IntakeEventSchema.safeParse(event);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where =
        first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
      return {
        ok: false,
        code: 400,
        error: `invalid intake event${where} (${String(first?.message ?? parsed.error.message).slice(0, 160)})`,
      };
    }
    const ev = parsed.data;
    if (isDuplicateIntakeEvent(ev.eventId)) {
      return { ok: true, outcome: "skipped-dedupe", jobId: null, explain: `dedupe hit eventId="${ev.eventId}"` };
    }
    const liveRes = resolveLive(opts);
    if (!liveRes.ok) return { ok: false, code: 400, error: liveRes.error };
    const live = liveRes.live;
    if (live.liveMode !== true) {
      return {
        ok: false,
        code: 409,
        error: "live intake off (live.liveMode=false in factory.yaml): mock-local intact, no job created",
      };
    }
    const matched = matchesIntakeFilter(live.filter, ev);
    const explain = explainIntakeFilter(live.filter, ev);
    if (!matched) {
      pushSeenIntakeEvent(ev.eventId);
      return { ok: true, outcome: "skipped-filter", jobId: null, explain };
    }
    const jobs = opts?.jobs ?? {};
    const find =
      typeof jobs.findJob === "function"
        ? jobs.findJob
        : (threadId: string, replyTo: string | null) => findJobIdForIntake(threadId, replyTo);
    let existing: string | null = null;
    try {
      existing = find(ev.threadId, ev.replyTo) ?? null;
    } catch {
      existing = null;
    }
    if (typeof existing === "string" && existing.length > 0) {
      try {
        if (typeof jobs.appendToJob === "function") {
          jobs.appendToJob(existing, buildIntakePrompt(ev));
        } else {
          try {
            workItemStore.appendEvent(existing, "user", `intake reply ${ev.eventId}: ${ev.title}`.slice(0, 200), {
              integrationRef: {
                provider: ev.provider,
                threadId: ev.threadId,
                eventId: ev.eventId,
                liveMode: true,
              },
            } as unknown as Record<string, unknown>);
          } catch {
            // continue still counts: the job identity held, the note is best-effort
          }
        }
      } catch {
        // append is best-effort; the no-dup verdict stands
      }
      pushSeenIntakeEvent(ev.eventId);
      return { ok: true, outcome: "continued", jobId: existing, explain };
    }
    const worktree =
      typeof opts?.worktree === "string" && opts.worktree.trim().length > 0
        ? opts.worktree.trim()
        : process.cwd();
    const create =
      typeof jobs.createJob === "function" ? jobs.createJob : defaultCreateJob;
    let created: { ok: boolean; jobId: string | null; continued: boolean };
    try {
      created = create({
        prompt: buildIntakePrompt(ev),
        worktree,
        threadId: ev.threadId,
        replyTo: ev.replyTo,
        eventId: ev.eventId,
        provider: ev.provider,
        liveMode: true,
      });
    } catch {
      return { ok: false, code: 500, error: "intake job creation failed (writer threw, caught)" };
    }
    pushSeenIntakeEvent(ev.eventId);
    if (!created.ok || !created.jobId) {
      return { ok: false, code: 500, error: "intake job creation failed (writer refused)" };
    }
    if (created.continued) {
      return { ok: true, outcome: "continued", jobId: created.jobId, explain };
    }
    return { ok: true, outcome: "created", jobId: created.jobId, explain };
  } catch (e) {
    return {
      ok: false,
      code: 500,
      error: `intake failed (${(e instanceof Error ? e.message : String(e)).slice(0, 160)})`,
    };
  }
}

/**
 * Posts one terminal-state update back to the provider thread/issue.
 * `liveMode:false` (default) records through the exact mock-local writer
 * (`via:"mock"`); live mode uses the injected-fetch adapter with retry
 * cap 3 and honest failure. Never throws (every failure is a value).
 */
export async function postBackToThread(
  input: unknown,
  opts?: PostBackOptions,
): Promise<PostBackServiceResult> {
  try {
    const parsed = PostBackSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where =
        first && first.path.length > 0 ? ` at "${String(first.path.join("."))}"` : "";
      return {
        ok: false,
        code: 400,
        error: `invalid post-back${where} (${String(first?.message ?? parsed.error.message).slice(0, 160)})`,
        attempts: 0,
      };
    }
    const liveRes = resolveLive(opts);
    if (!liveRes.ok) return { ok: false, code: 400, error: liveRes.error, attempts: 0 };
    const live = liveRes.live;
    if (live.liveMode !== true) {
      const rec = postNotification({
        provider: "linear",
        kind: "notification",
        jobId: parsed.data.jobId,
        title: parsed.data.title,
        body: parsed.data.body,
      });
      if (!rec.ok) {
        const code = rec.code === 409 ? 409 : 500;
        return { ok: false, code, error: rec.error, attempts: 0 };
      }
      return {
        ok: true,
        via: "mock",
        remoteId: rec.post.id,
        note: `mock-local post-back recorded as ${rec.post.id} (liveMode:false)`,
        attempts: 0,
      };
    }
    if (live.allowPostBack !== true) {
      return {
        ok: false,
        code: 409,
        error: "post-back disabled (live.allowPostBack=false): terminal update refused",
        attempts: 0,
      };
    }
    const adapter = createLiveAdapter({
      vaultRef: live.vaultRef,
      webhookSecretRef: live.webhookSecretRef,
      ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(typeof opts?.timeoutMs === "number" ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts?.logger ? { logger: opts.logger } : {}),
    });
    const res = await adapter.postBack(parsed.data);
    if (res.ok) {
      return { ok: true, via: "live", remoteId: res.remoteId, note: res.note, attempts: res.attempts };
    }
    return { ok: false, code: 500, error: res.note, attempts: res.attempts };
  } catch (e) {
    return {
      ok: false,
      code: 500,
      error: `post-back failed (${(e instanceof Error ? e.message : String(e)).slice(0, 160)})`,
      attempts: 0,
    };
  }
}

/**
 * Reconciles one mock post by id (ack path of ack+postback reconcile).
 * Unknown id is `{ok:true, acked:false}` (best-effort, like the mock).
 * Never throws.
 */
export function reconcileAckNotification(
  id: unknown,
): { ok: boolean; acked: boolean } {
  try {
    return { ok: true, acked: ackNotification(id) };
  } catch {
    return { ok: true, acked: false };
  }
}

/**
 * Status snapshot for `GET /factory/integrations/status`. Never throws.
 */
export function getStatus(): IntegrationsStatusData {
  try {
    const fallback: IntegrationsStatusData = {
      enabled: false,
      mode: "",
      provider: "",
      count: 0,
      lastPostAt: null,
      lastAckedAt: null,
      configError: null,
    };
    let enabled = false;
    let mode = "";
    let provider = "";
    let configError: string | null = null;
    try {
      const cfg = getIntegrationsConfig();
      if (cfg.ok) {
        enabled = cfg.config.enabled === true;
        mode = cfg.config.mode;
        provider = cfg.config.provider;
      } else {
        configError = cfg.error;
      }
    } catch {
      configError = "integrations config unreadable";
    }
    let count = 0;
    let lastPostAt: string | null = null;
    let lastAckedAt: string | null = null;
    try {
      const recent = listMockPosts();
      count = recent.length;
      if (recent.length > 0) {
        lastPostAt = typeof recent[0]?.at === "string" ? (recent[0] as MockPostRecord).at : null;
        const acked = recent.find((p) => p?.acked === true) ?? null;
        lastAckedAt =
          acked && typeof acked.ackAt === "string" ? (acked.ackAt as string) : null;
      }
    } catch {
      // disk best-effort: counts stay zeroed
    }
    return { ...fallback, enabled, mode, provider, count, lastPostAt, lastAckedAt, configError };
  } catch {
    return {
      enabled: false,
      mode: "",
      provider: "",
      count: 0,
      lastPostAt: null,
      lastAckedAt: null,
      configError: "integrations status unavailable",
    };
  }
}
