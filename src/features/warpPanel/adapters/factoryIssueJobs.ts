/**
 * factoryIssueJobs — pure renderer-side helpers for Warp Resolve → factory jobs.
 *
 * The Warp panel Resolve button creates a factory job
 * (POST /factory/jobs, pipeline foreman→triage→spec→implement→verify→
 * review→merge) instead of opening a canvas terminal. This module is the
 * renderer half of the `issueRef` link:
 *
 * - Daemon half: `headless-runtime/factory/jobs/jobCreate.ts` (GitHub issue
 *   intake refs section) stamps `{provider, issueNumber, repo, url}` under
 *   the `issueRef` timeline meta key — same additive, restore-tolerant
 *   pattern as Ola14 `triggerRef` / F1 `integrationRef`. The two sides are
 *   deliberate mirrors (same shape, same caps, same key): the renderer
 *   cannot import daemon code (node-only), and the daemon never imports
 *   this file. Keep them in sync by hand.
 * - This half: prompt building, repo parsing, ref reading, and matching a
 *   row against the EXISTING `useWorkItemStore` poll list (populated by
 *   the shared `useWorkItemsPolling` 2.5s loop — this module owns zero
 *   intervals and performs zero fetches).
 *
 * ─── Pending → in-progress rule ───
 *
 * A row with a NON-TERMINAL factory job linked by `issueRef` is
 * in-progress — including jobs still QUEUED behind the worker. A freshly
 * created resolve job sits in `Intake` (legacy `state: "queued"`) until
 * the daemon picks it up, possibly behind dozens of pending jobs; that
 * wait is still agent work in flight, so it counts exactly like a running
 * job. Only terminal jobs (`Complete` / `Cancelled`, legacy
 * `done` / `error`) free the row.
 *
 * Exception — human gates (see `readFactoryJobHumanNeed` below): a linked
 * ACTIVE job that waits for the human (pending spec approval, unanswered
 * triage questions, `ask_human` review verdict, or the pending-notification
 * fallback) is NOT progressing, so the derivation (`activityDerivation`
 * rows F-A1–F-A4) moves the row to awaiting/YOUR TURN instead. The gate
 * check runs before the in-progress claim, on the SAME matched job.
 *
 * ─── Queued vs running families (display only) ───
 *
 * The daemon reports ONE `status` per job (`WorkItemStatus` in
 * `shared/types/workItem.ts` — the real cycle stages, read verbatim, never
 * remapped onto the panel's generic implementing/reviewing/fixing phases):
 * `Intake → Foreman → Triage → Building → Review → Complete`, plus
 * terminal `Cancelled`. The legacy `state` compat folds them into two
 * families (same folding as `mapStatusToLegacyState`): `Intake`/`Foreman`/
 * `Triage` are the QUEUED family (waiting for / entering the worker),
 * `Building`/`Review` are the RUNNING family (worker actively holding the
 * job). NOTE: the job record also carries a `phase` string (e.g.
 * `"diagnosisLlm"`) — that is the INTAKE SEED, not a pipeline position,
 * and it is never read here.
 *
 * ─── Live session links ───
 *
 * `readFactoryJobSessionLink` exposes the daemon-built `dashboardUrl`
 * (opencode web-UI session URL, e.g.
 * `http://127.0.0.1:<port>/<enc>/session/<id>` — see `buildDashboardUrl`
 * in `headless-runtime/factory/factoryServer.ts`) when the poll-list job
 * carries it. It is NEVER synthesized from `sessionId` alone: the
 * renderer cannot know the ephemeral opencode base URL, so a job without
 * `dashboardUrl` yields no link (callers disable honestly instead of
 * opening a dead tab).
 *
 * Everything here is pure, ESM, and never throws. Neutral English strings.
 */

import type { IssueFactoryJob } from "../types";
import { SCOPE_DISCIPLINE_LINE, scopeWorktreeLine } from "../../../../shared/scope";
import type { CostSummary } from "../../../../shared/types/workItem";
import { getLatestSpecApprovalRequest } from "../../../../shared/types/spec";
import { needsResume } from "../../../../shared/types/workItem";

/** Meta key carrying the ref (must match the daemon `JOB_ISSUE_META_KEY`). */
export const FACTORY_ISSUE_REF_META_KEY = "issueRef";

/** GitHub issue link stamped onto resolve jobs. */
export interface FactoryIssueRef {
  provider: "github";
  issueNumber: number;
  /** "owner/repo" from the issue URL, null when unknown (never invented). */
  repo: string | null;
  url: string | null;
}

/** Daemon work statuses that still count as "resolving this issue". */
const FACTORY_ACTIVE_STATUSES: readonly string[] = [
  "Intake",
  "Foreman",
  "Triage",
  "Building",
  "Review",
];

/** Terminal daemon statuses: the issue is free to resolve again. */
const FACTORY_TERMINAL_STATUSES: readonly string[] = [
  "Complete",
  "Cancelled",
];

/** Legacy `state` compat (pacts F02–F12): queued/running = active. */
const FACTORY_ACTIVE_LEGACY_STATES: readonly string[] = [
  "queued",
  "running",
];

const FACTORY_TERMINAL_LEGACY_STATES: readonly string[] = [
  "done",
  "error",
];

/** Prompt caps (mirror the webhook-in client caps: short, bounded). */
const PROMPT_TITLE_MAX = 200;
const PROMPT_BODY_MAX = 2000;
const PROMPT_LABELS_MAX = 20;
const PROMPT_LABEL_MAX = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function cleanText(value: unknown, max: number): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, max);
  } catch {
    return null;
  }
}

function cleanLabels(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const entry of value) {
      if (out.length >= PROMPT_LABELS_MAX) break;
      if (typeof entry === "string" && entry.trim().length > 0) {
        out.push(entry.trim().slice(0, PROMPT_LABEL_MAX));
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Parses "owner/repo" out of a GitHub issue URL
 * (`https://github.com/owner/repo/issues/123`). Null for anything else —
 * never invented, never throws.
 */
export function parseGitHubIssueRepo(url: unknown): string | null {
  try {
    if (typeof url !== "string") return null;
    const match = url
      .trim()
      .match(/^https?:\/\/github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i);
    if (!match) return null;
    const owner = match[1].trim().replace(/\.git$/i, "");
    const repo = match[2].trim().replace(/\.git$/i, "");
    if (owner.length === 0 || repo.length === 0) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

export interface FactoryResolveIssueSnapshot {
  issueNumber: number;
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  url?: unknown;
}

/**
 * Builds the daemon prompt for one issue (title/body/labels/url, capped).
 * Junk degrades to honest placeholders — never throws, never empty.
 */
export function buildFactoryResolvePrompt(
  issue: FactoryResolveIssueSnapshot,
): string {
  try {
    const raw = isRecord(issue as unknown) ? issue : null;
    const n =
      raw !== null &&
      typeof raw.issueNumber === "number" &&
      Number.isInteger(raw.issueNumber) &&
      raw.issueNumber > 0
        ? raw.issueNumber
        : 0;
    const title = raw !== null ? cleanText(raw.title, PROMPT_TITLE_MAX) : null;
    const body = raw !== null ? cleanText(raw.body, PROMPT_BODY_MAX) : null;
    const labels = raw !== null ? cleanLabels(raw.labels) : [];
    const url = raw !== null ? cleanText(raw.url, PROMPT_BODY_MAX) : null;
    const header =
      title !== null
        ? `# Resolve issue #${n} — ${title}`
        : `# Resolve issue #${n}`;
    // Dedup: si el body ya trae el SCOPE canónico (issues que lo incluyen),
    // no se appendea de nuevo — una sola copia para todas las fases.
    const bodyHasScope = body !== null && body.includes(SCOPE_DISCIPLINE_LINE);
    const scopeBlock = bodyHasScope
      ? []
      : [`## SCOPE`, SCOPE_DISCIPLINE_LINE, scopeWorktreeLine(n)];
    return [
      header,
      ``,
      `## ISSUE`,
      `- URL: ${url ?? `unknown`}`,
      `- Labels: ${labels.length > 0 ? labels.join(`, `) : `none`}`,
      ``,
      `## ORIGINAL BODY`,
      body ?? `(no description)`,
      ``,
      ...scopeBlock,
    ].join(`\n`);
  } catch {
    return `# Resolve issue`;
  }
}

/**
 * Builds the `issueRef` stamped onto the create body. The repo comes from
 * the issue URL (null when the URL is absent — never invented).
 * Never throws.
 */
export function buildFactoryJobIssueRef(input: {
  issueNumber: number;
  url?: unknown;
}): FactoryIssueRef {
  try {
    const n =
      typeof input?.issueNumber === "number" &&
      Number.isInteger(input.issueNumber) &&
      input.issueNumber > 0
        ? input.issueNumber
        : 0;
    const url = cleanText(input?.url, 500);
    return {
      provider: "github",
      issueNumber: n,
      repo: url !== null ? parseGitHubIssueRepo(url) : null,
      url,
    };
  } catch {
    return { provider: "github", issueNumber: 0, repo: null, url: null };
  }
}

/**
 * Validates one `issueRef` candidate (same rules as the daemon
 * `sanitizeIssueRef`: provider must be "github", issueNumber a positive
 * integer; repo/url degrade to null). Null when invalid — never throws.
 */
export function sanitizeFactoryIssueRef(value: unknown): FactoryIssueRef | null {
  try {
    if (!isRecord(value)) return null;
    if (value.provider !== "github") return null;
    if (
      typeof value.issueNumber !== "number" ||
      !Number.isInteger(value.issueNumber) ||
      value.issueNumber <= 0
    ) {
      return null;
    }
    const repo =
      typeof value.repo === "string" && value.repo.trim().length > 0
        ? value.repo.trim().slice(0, 256)
        : null;
    const url =
      typeof value.url === "string" && value.url.trim().length > 0
        ? value.url.trim().slice(0, 500)
        : null;
    return {
      provider: "github",
      issueNumber: value.issueNumber,
      repo,
      url,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the `issueRef` of one poll-list job: memory key first, then the
 * timeline meta durable path (newest entry wins — survives daemon
 * restarts). Null when absent or malformed: pre-issueRef jobs never match
 * (restore-tolerant). Never throws.
 */
export function readFactoryJobIssueRef(job: unknown): FactoryIssueRef | null {
  try {
    if (!isRecord(job)) return null;
    const fast = sanitizeFactoryIssueRef(job[FACTORY_ISSUE_REF_META_KEY]);
    if (fast !== null) return fast;
    const timeline = job.timeline;
    if (Array.isArray(timeline)) {
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        try {
          const entry = timeline[i] as Record<string, unknown>;
          const meta = entry?.meta as unknown;
          if (isRecord(meta)) {
            const ref = sanitizeFactoryIssueRef(
              meta[FACTORY_ISSUE_REF_META_KEY],
            );
            if (ref !== null) return ref;
          }
        } catch {
          // a broken entry never aborts the scan
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True while a poll-list job is still working: daemon `status` in ANY
 * non-terminal state — queued family (`Intake`/`Foreman`/`Triage`, still
 * waiting behind the worker) counts exactly like the running family
 * (`Building`/`Review`) — else legacy `state` queued/running. Terminal
 * (`Complete`/`Cancelled`, legacy `done`/`error`) frees the row. Unknown
 * or malformed shapes read as NOT active — busy is only ever claimed on
 * positive evidence, never invented. Never throws.
 */
export function isFactoryJobActive(job: unknown): boolean {
  try {
    if (!isRecord(job)) return false;
    const status = typeof job.status === "string" ? job.status : null;
    if (status !== null) {
      if (
        (FACTORY_TERMINAL_STATUSES as readonly string[]).includes(status)
      ) {
        return false;
      }
      return (FACTORY_ACTIVE_STATUSES as readonly string[]).includes(status);
    }
    const state = typeof job.state === "string" ? job.state : null;
    if (state !== null) {
      if ((FACTORY_TERMINAL_LEGACY_STATES as readonly string[]).includes(state)) {
        return false;
      }
      return (FACTORY_ACTIVE_LEGACY_STATES as readonly string[]).includes(state);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True while a poll-list job reached terminal `Complete`: daemon `status`
 * === "Complete" (Review → Complete via accept), else legacy `state` ===
 * "done". `Cancelled` (legacy `error`) and unknown/malformed shapes read
 * as NOT completed — completion is only ever claimed on positive evidence,
 * never invented. Never throws.
 */
export function isFactoryJobCompleted(job: unknown): boolean {
  try {
    if (!isRecord(job)) return false;
    const status = typeof job.status === "string" ? job.status : null;
    if (status !== null) {
      return status === "Complete";
    }
    const state = typeof job.state === "string" ? job.state : null;
    if (state !== null) {
      return state === "done";
    }
    return false;
  } catch {
    return false;
  }
}

function sameRepo(a: string | null, b: string | null): boolean {
  try {
    if (a === null || b === null) return true;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Finds the active factory job linked to one issue in the EXISTING poll
 * list (zero new fetches — callers pass `useWorkItemStore` items).
 * Match = `issueRef.issueNumber` equal (repo must also agree when both
 * sides know it; a null repo on either side falls back to number-only so
 * old links without a repo still match) AND the job is active. Null when
 * none — never throws.
 */
export function findActiveFactoryJobForIssue(
  jobs: unknown,
  issueNumber: number,
  repo?: string | null,
): unknown | null {
  try {
    if (!Array.isArray(jobs)) return null;
    if (
      typeof issueNumber !== "number" ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return null;
    }
    const want =
      typeof repo === "string" && repo.trim().length > 0
        ? repo.trim()
        : null;
    for (const job of jobs) {
      try {
        const ref = readFactoryJobIssueRef(job);
        if (ref === null || ref.issueNumber !== issueNumber) continue;
        if (!sameRepo(ref.repo, want)) continue;
        if (!isFactoryJobActive(job)) continue;
        return job;
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Finds ALL active factory jobs linked to one issue in the EXISTING poll
 * list (misma regla que el singular, pero devuelve la lista: un issue
 * puede acumular varios jobs parados y el descarte los limpia todos en un
 * click). Tope 10 (estructural, sin loops). Nunca lanza.
 */
export function findActiveFactoryJobsForIssue(
  jobs: unknown,
  issueNumber: number,
  repo?: string | null,
): string[] {
  const out: string[] = [];
  try {
    if (!Array.isArray(jobs)) return out;
    if (
      typeof issueNumber !== "number" ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return out;
    }
    const want =
      typeof repo === "string" && repo.trim().length > 0
        ? repo.trim()
        : null;
    jobs.forEach((job) => {
      try {
        if (out.length >= 10) return;
        const ref = readFactoryJobIssueRef(job);
        if (ref === null || ref.issueNumber !== issueNumber) return;
        if (!sameRepo(ref.repo, want)) return;
        if (!isFactoryJobActive(job)) return;
        const rec = job as { id?: unknown };
        if (typeof rec.id !== "string" || rec.id.length === 0) return;
        if (!out.includes(rec.id)) out.push(rec.id);
      } catch {
        // una entrada rota nunca frena a las demás
      }
    });
  } catch {
    // nunca lanza
  }
  return out;
}

/**
 * Finds the COMPLETED factory job linked to one issue in the EXISTING poll
 * list (zero new fetches — callers pass `useWorkItemStore` items).
 * Match = `issueRef.issueNumber` equal (repo must also agree when both
 * sides know it — same rule as the active finder, so old links without a
 * repo still match) AND the job completed (`Complete` / legacy `done`;
 * `Cancelled` / `error` never match). Null when none — never throws.
 */
export function findCompletedFactoryJobForIssue(
  jobs: unknown,
  issueNumber: number,
  repo?: string | null,
): unknown | null {
  try {
    if (!Array.isArray(jobs)) return null;
    if (
      typeof issueNumber !== "number" ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return null;
    }
    const want =
      typeof repo === "string" && repo.trim().length > 0
        ? repo.trim()
        : null;
    for (const job of jobs) {
      try {
        const ref = readFactoryJobIssueRef(job);
        if (ref === null || ref.issueNumber !== issueNumber) continue;
        if (!sameRepo(ref.repo, want)) continue;
        if (!isFactoryJobCompleted(job)) continue;
        return job;
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Warp cycle stages (read verbatim from the daemon `status`) ────────────

/**
 * Forward pipeline lanes in daemon order (the real `WorkItemStatus`
 * cycle — `shared/types/workItem.ts`). `Cancelled` is terminal and lives
 * outside the lanes (`stepIndex: -1`). `stepCount` is always the lane
 * count so timelines stay stable.
 */
export const FACTORY_STAGE_LANES: readonly string[] = [
  "Intake",
  "Foreman",
  "Triage",
  "Building",
  "Review",
  "Complete",
];

const FACTORY_STAGE_LANE_COUNT = 6;

/** Display family: queued (waiting) vs running (worker holds it) vs terminal. */
export type FactoryStageFamily = "queued" | "running" | "terminal";

function familyForStatus(status: string): FactoryStageFamily {
  try {
    if (status === "Building" || status === "Review") return "running";
    if (status === "Complete" || status === "Cancelled") return "terminal";
    return "queued";
  } catch {
    return "queued";
  }
}

/**
 * Legacy `state` → daemon stage mirror (same folding as the daemon
 * `mapStatusToLegacyState`, reversed): queued → Intake (lane 0),
 * running → Building (lane 3), done → Complete, error → Cancelled.
 * Never throws.
 */
function legacyStateToStage(state: string): {
  status: string;
  stepIndex: number;
  terminal: boolean;
} | null {
  try {
    if (state === "queued") {
      return { status: "Intake", stepIndex: 0, terminal: false };
    }
    if (state === "running") {
      return { status: "Building", stepIndex: 3, terminal: false };
    }
    if (state === "done") {
      return { status: "Complete", stepIndex: 5, terminal: true };
    }
    if (state === "error") {
      return { status: "Cancelled", stepIndex: -1, terminal: true };
    }
    return null;
  } catch {
    return null;
  }
}

export interface FactoryJobStage {
  /** Verbatim daemon `status` (never remapped, never invented). */
  status: string;
  /** Display label — the verbatim status (honest, no paraphrase). */
  label: string;
  family: FactoryStageFamily;
  /** Lane index in `FACTORY_STAGE_LANES` (-1 for terminal Cancelled). */
  stepIndex: number;
  stepCount: number;
  terminal: boolean;
}

/**
 * Reads the Warp cycle stage of one poll-list job from its daemon
 * `status` (else legacy `state`). The record `phase` string (e.g.
 * `"diagnosisLlm"`) is deliberately IGNORED — it is the intake seed,
 * not a pipeline position. Null when the shape carries no recognizable
 * stage (unknown is never placed on a lane). Never throws.
 */
export function readFactoryJobStage(job: unknown): FactoryJobStage | null {
  try {
    if (!isRecord(job)) return null;
    const status = typeof job.status === "string" ? job.status : null;
    if (status !== null) {
      const lane = (
        FACTORY_STAGE_LANES as readonly string[]
      ).indexOf(status);
      if (lane >= 0) {
        return {
          status,
          label: status,
          family: familyForStatus(status),
          stepIndex: lane,
          stepCount: FACTORY_STAGE_LANE_COUNT,
          terminal: status === "Complete",
        };
      }
      if (status === "Cancelled") {
        return {
          status,
          label: status,
          family: "terminal",
          stepIndex: -1,
          stepCount: FACTORY_STAGE_LANE_COUNT,
          terminal: true,
        };
      }
    }
    const state = typeof job.state === "string" ? job.state : null;
    if (state !== null) {
      const legacy = legacyStateToStage(state);
      if (legacy !== null) {
        return {
          status: legacy.status,
          label: legacy.status,
          family: familyForStatus(legacy.status),
          stepIndex: legacy.stepIndex,
          stepCount: FACTORY_STAGE_LANE_COUNT,
          terminal: legacy.terminal,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Live session link (daemon-built `dashboardUrl` only) ──────────────────

export interface FactoryJobSessionLink {
  jobId: string;
  /** Live opencode web-UI session URL (new-tab safe). */
  sessionUrl: string;
}

function cleanSessionUrl(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    return trimmed.slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Live session link for one poll-list job. Returns the daemon-built
 * `dashboardUrl` when present AND session-shaped (`/session/<id>` — the
 * daemon only stamps it after a real `session.create`; the old failure
 * fallbacks wrote the bare opencode base and View Agent opened a dead
 * port). NEVER synthesized from `sessionId` alone: the renderer cannot
 * know the opencode base URL, so a job without a session URL yields null
 * (callers disable honestly — never a dead tab). The record
 * `phase`/`status` play no role here. Never throws.
 */
export function readFactoryJobSessionLink(
  job: unknown,
): FactoryJobSessionLink | null {
  try {
    if (!isRecord(job)) return null;
    // Session-shaped URL only (base-URL fallbacks never open a dead tab).
    const sessionUrl = cleanLiveSessionUrl(job.dashboardUrl);
    if (sessionUrl === null) return null;
    const jobId = typeof job.id === "string" ? job.id : "";
    return { jobId, sessionUrl };
  } catch {
    return null;
  }
}

/**
 * TODAS las sesiones por fase de un poll-list job (`sessions: [{role,
 * sessionId, sessionUrl}]`, en orden de fase). Espejo del daemon
 * `allSessionsExtras`: el panel nunca construye URLs (no conoce el puerto
 * efímero). Roles sin URL válida se omiten; ausente → null (honesto).
 * Never throws.
 */
export interface FactoryJobPhaseSession {
  role: string;
  sessionUrl: string;
}

export function readFactoryJobSessions(job: unknown): FactoryJobPhaseSession[] | null {
  try {
    if (!isRecord(job)) return null;
    const raw = job.sessions;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out: FactoryJobPhaseSession[] = [];
    raw.forEach((entry) => {
      try {
        if (!isRecord(entry)) return;
        const role = typeof entry.role === "string" ? entry.role.trim() : "";
        const sessionUrl = cleanSessionUrl(entry.sessionUrl);
        if (role === "" || sessionUrl === null) return;
        out.push({ role, sessionUrl });
      } catch {
        // una entrada rota nunca aborta a las demás
      }
    });
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export interface FactoryJobHookRun {
  name: string;
  stage: string;
  status: string;
  sessionUrl: string | null;
}

/** Agente hook declarado (daemon `hookAgents`): roster del panel. */
export interface FactoryJobDeclaredHookAgent {
  name: string;
  stage: string;
  blocking?: boolean;
}

function sanitizeHookAgentEntry(
  entry: unknown,
): FactoryJobDeclaredHookAgent | null {
  try {
    if (!isRecord(entry)) return null;
    const name = cleanDecisionText(entry.name, 64);
    const stage = cleanDecisionText(entry.stage, 32);
    if (name === undefined || stage === undefined) return null;
    const out: FactoryJobDeclaredHookAgent = { name, stage };
    if (entry.blocking === true) out.blocking = true;
    else if (entry.blocking === false) out.blocking = false;
    return out;
  } catch {
    return null;
  }
}

/**
 * Roster declarado de agentes hook del job (daemon `hookAgents`): todos los
 * agentes con `stage` de hook, aunque todavía no hayan corrido. Dedup por
 * nombre, tope 20, junk fuera. Null cuando ausente (payload viejo o sin
 * hooks declarados) — callers degradan a `hookStages` o a nada. Nunca lanza.
 */
export function readFactoryJobHookAgents(
  job: unknown,
): FactoryJobDeclaredHookAgent[] | null {
  try {
    if (!isRecord(job)) return null;
    const raw = job.hookAgents;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out: FactoryJobDeclaredHookAgent[] = [];
    const seen = new Set<string>();
    for (const entry of raw.slice(0, 20)) {
      const clean = sanitizeHookAgentEntry(entry);
      if (clean === null || seen.has(clean.name)) continue;
      seen.add(clean.name);
      out.push(clean);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Corridas hook de un poll-list job (daemon `hookRuns`, espejo de
 * `hookRunsExtras`: el panel nunca construye URLs). Entradas rotas se
 * omiten; ausente/vacío → null (honesto). Never throws.
 */
export function readFactoryJobHookRuns(job: unknown): FactoryJobHookRun[] | null {
  try {
    if (!isRecord(job)) return null;
    const raw = job.hookRuns;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out: FactoryJobHookRun[] = [];
    raw.slice(-20).forEach((entry) => {
      try {
        if (!isRecord(entry)) return;
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        const stage = typeof entry.stage === "string" ? entry.stage.trim() : "";
        const status = typeof entry.status === "string" ? entry.status.trim() : "";
        if (!name || !stage || !status) return;
        const sessionUrl = typeof entry.sessionUrl === "string" && /^https?:\/\//i.test(entry.sessionUrl.trim())
          ? entry.sessionUrl.trim().slice(0, 500)
          : null;
        out.push({ name: name.slice(0, 64), stage: stage.slice(0, 32), status: status.slice(0, 16), sessionUrl });
      } catch {
        // una corrida rota nunca aborta a las demás
      }
    });
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Live ROLE session link for one poll-list job. The daemon attaches
 * session actually doing the work — foreman/triage/implement/review —
 * vs the MVP tracking session behind `dashboardUrl`, which only carries
 * the tracking ping). Preferred over `readFactoryJobSessionLink` whenever
 * present: View Agent must open the session with the real tool calls,
 * never the empty tracking session. Never synthesized, never throws.
 */
export function readRoleSessionLink(job: unknown): FactoryJobSessionLink | null {
  try {
    if (!isRecord(job)) return null;
    const live = job.liveSession;
    if (live === null || typeof live !== "object" || Array.isArray(live)) {
      return null;
    }
    const sessionUrl = cleanSessionUrl(
      (live as Record<string, unknown>).sessionUrl,
    );
    if (sessionUrl === null) return null;
    const jobId = typeof job.id === "string" ? job.id : "";
    return { jobId, sessionUrl };
  } catch {
    return null;
  }
}

// ─── Isolation (daemon T01 jail + PR, renderer mirror) ─────────────────────
//
// Daemon half: `headless-runtime/factory/isolation/isolationStore.ts`
// (memory `workItem.isolation` fast path + timeline `isolation` / `pr` meta
// durable path across restarts — the same additive, restore-tolerant pattern
// as `issueRef` above). Deliberate mirror, never imported (node-only).
// The panel reads branch + PR link from the EXISTING poll-list item (zero
// new fetches, zero new intervals).

/** Timeline meta key carrying the isolation record (must match the daemon). */
export const FACTORY_ISOLATION_META_KEY = "isolation";

/** Timeline meta key carrying the PR outcome (must match the daemon). */
export const FACTORY_PR_META_KEY = "pr";

/** Isolation snapshot of one poll-list job (subset of the daemon record). */
export interface FactoryJobIsolation {
  branch: string;
  baseBranch?: string;
  worktreePath?: string;
  repoRoot?: string;
  prNumber?: number;
  prUrl?: string;
  state?: string;
}

/** Live PR link of one poll-list job (daemon-built URL only). */
export interface FactoryJobPrLink {
  /** PR URL — always present (a number alone yields no link, never built). */
  prUrl: string;
  /** PR number, when the record carries a valid one. */
  prNumber?: number;
}

function cleanBranch(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    return trimmed;
  } catch {
    return null;
  }
}

function cleanOptText(value: unknown, max: number): string | undefined {
  try {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.slice(0, max);
  } catch {
    return undefined;
  }
}

function cleanPrNumber(value: unknown): number | undefined {
  try {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function cleanPrUrl(value: unknown): string | undefined {
  try {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 500) return undefined;
    if (!/^https?:\/\//i.test(trimmed)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

/**
 * Validates one isolation-record candidate (memory object or timeline
 * `isolation` meta). Requires a non-empty `branch`; every other field is
 * picked only when well-formed. Null when junk — never throws.
 */
export function sanitizeFactoryJobIsolation(
  value: unknown,
): FactoryJobIsolation | null {
  try {
    if (!isRecord(value)) return null;
    const branch = cleanBranch(value.branch);
    if (branch === null) return null;
    const out: FactoryJobIsolation = { branch };
    const baseBranch = cleanOptText(value.baseBranch, 128);
    if (baseBranch !== undefined) out.baseBranch = baseBranch;
    const worktreePath = cleanOptText(value.worktreePath, 1024);
    if (worktreePath !== undefined) out.worktreePath = worktreePath;
    const repoRoot = cleanOptText(value.repoRoot, 1024);
    if (repoRoot !== undefined) out.repoRoot = repoRoot;
    const prNumber = cleanPrNumber(value.prNumber);
    if (prNumber !== undefined) out.prNumber = prNumber;
    const prUrl = cleanPrUrl(value.prUrl);
    if (prUrl !== undefined) out.prUrl = prUrl;
    const state = cleanOptText(value.state, 32);
    if (state !== undefined) out.state = state;
    return out;
  } catch {
    return null;
  }
}

function timelineMetas(job: unknown, key: string): unknown[] {
  try {
    if (!isRecord(job)) return [];
    const timeline = job.timeline;
    if (!Array.isArray(timeline)) return [];
    const out: unknown[] = [];
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      try {
        const entry = timeline[i] as Record<string, unknown>;
        const meta = entry?.meta as unknown;
        if (isRecord(meta) && key in meta) out.push(meta[key]);
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Routing decisions (Foreman / Triage) ───────────────────────────────────

/** Foreman routing decision for the panel (verbatim daemon fields). */
export interface FactoryJobForemanDecision {
  decision: string;
  reason?: string;
  confidence?: number;
  retryable?: boolean;
}

/** Triage decision for the panel (building / spec / triage + fallback). */
export interface FactoryJobTriageDecision {
  decision: string;
  reason?: string;
  confidence?: number;
  fallback?: boolean;
}

function cleanDecisionText(value: unknown, max: number): string | undefined {
  try {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeForemanDecision(
  value: unknown,
): FactoryJobForemanDecision | null {
  try {
    if (!isRecord(value)) return null;
    const decision = cleanDecisionText(value.decision, 64);
    if (decision === undefined) return null;
    const out: FactoryJobForemanDecision = { decision };
    const reason = cleanDecisionText(value.reason, 280);
    if (reason !== undefined) out.reason = reason;
    if (typeof value.confidence === "number" && Number.isFinite(value.confidence)) {
      out.confidence = value.confidence;
    }
    if (value.retryable === true) out.retryable = true;
    return out;
  } catch {
    return null;
  }
}

function sanitizeTriageDecision(
  value: unknown,
): FactoryJobTriageDecision | null {
  try {
    if (!isRecord(value)) return null;
    const decision = cleanDecisionText(value.decision, 64);
    if (decision === undefined) return null;
    const out: FactoryJobTriageDecision = { decision };
    const reason = cleanDecisionText(value.reason, 280);
    if (reason !== undefined) out.reason = reason;
    if (typeof value.confidence === "number" && Number.isFinite(value.confidence)) {
      out.confidence = value.confidence;
    }
    if (value.fallback === true) out.fallback = true;
    return out;
  } catch {
    return null;
  }
}

/**
 * Newest Foreman decision of one poll-list job: summary `foreman`
 * projection first (top-level, computed by `projectSummaryTimeline`), else
 * the newest `foremanDecision` timeline meta (full view / legacy rows).
 * Null when absent or junk (never invented). Never throws.
 */
export function readFactoryJobForemanDecision(
  job: unknown,
): FactoryJobForemanDecision | null {
  try {
    if (!isRecord(job)) return null;
    const fast = sanitizeForemanDecision(job.foreman);
    if (fast !== null) return fast;
    for (const candidate of timelineMetas(job, "foremanDecision")) {
      const found = sanitizeForemanDecision(candidate);
      if (found !== null) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Newest Triage decision of one poll-list job: summary `triage` extras
 * first (top-level in both list views), else the newest `triage` timeline
 * meta. Null when absent or junk (never invented). Never throws.
 */
export function readFactoryJobTriageDecision(
  job: unknown,
): FactoryJobTriageDecision | null {
  try {
    if (!isRecord(job)) return null;
    const fast = sanitizeTriageDecision(job.triage);
    if (fast !== null) return fast;
    for (const candidate of timelineMetas(job, "triage")) {
      const found = sanitizeTriageDecision(candidate);
      if (found !== null) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Isolation record of one poll-list job: memory `isolation` first, then
 * the timeline `isolation` meta durable path (newest entry wins — survives
 * daemon restarts). Null when absent or malformed: pre-isolation jobs read
 * honest-empty. Never throws.
 */
export function readFactoryJobIsolation(
  job: unknown,
): FactoryJobIsolation | null {
  try {
    if (!isRecord(job)) return null;
    const fast = sanitizeFactoryJobIsolation(job.isolation);
    if (fast !== null) return fast;
    for (const candidate of timelineMetas(job, FACTORY_ISOLATION_META_KEY)) {
      const found = sanitizeFactoryJobIsolation(candidate);
      if (found !== null) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * LIVE session-shaped URL or null: the daemon's session links always carry
 * the `/session/<id>` segment. A bare opencode base (e.g.
 * `http://127.0.0.1:4096` stamped by the old fallback paths) is NOT a live
 * link — accepting it enabled "View Agent" against a dead port. FactoryLab
 * already guarded this way (`hasValidDashboard`); the Warp panel mirrors it
 * here so every caller (View Agent, phase dropdown) stays honest.
 */
function cleanLiveSessionUrl(value: unknown): string | null {
  try {
    const url = cleanSessionUrl(value);
    if (url === null) return null;
    return url.includes("/session/") ? url : null;
  } catch {
    return null;
  }
}

/**
 * Live PR link of one poll-list job: the daemon-built `prUrl` from the
 * isolation record (memory, then timeline `isolation` meta), else the
 * timeline `pr` meta durable path. A bare `prNumber` without URL yields
 * null — the renderer cannot know the repo host path, so the URL is NEVER
 * synthesized. Null when absent or malformed. Never throws.
 */
export function readFactoryJobPrLink(job: unknown): FactoryJobPrLink | null {
  try {
    if (!isRecord(job)) return null;
    const iso = readFactoryJobIsolation(job);
    const isoUrl = iso !== null ? cleanPrUrl(iso.prUrl) : undefined;
    if (isoUrl !== undefined) {
      const link: FactoryJobPrLink = { prUrl: isoUrl };
      if (iso?.prNumber !== undefined) link.prNumber = iso.prNumber;
      return link;
    }
    // Perf Ola B: el summary proyecta la meta `pr` más nueva (`pr`) cuando
    // `isolation` no trae URL — misma fuente que el scan de abajo, sin
    // timeline. El scan queda como fallback para la vista full.
    try {
      const projected = job.pr;
      if (isRecord(projected)) {
        const prUrl = cleanPrUrl(projected.prUrl);
        if (prUrl !== undefined) {
          const link: FactoryJobPrLink = { prUrl };
          const prNumber = cleanPrNumber(projected.prNumber);
          if (prNumber !== undefined) link.prNumber = prNumber;
          return link;
        }
      }
    } catch {
      // cae al scan de abajo
    }
    for (const candidate of timelineMetas(job, FACTORY_PR_META_KEY)) {
      try {
        if (!isRecord(candidate)) continue;
        const prUrl = cleanPrUrl(candidate.prUrl);
        if (prUrl === undefined) continue;
        const link: FactoryJobPrLink = { prUrl };
        const prNumber = cleanPrNumber(candidate.prNumber);
        if (prNumber !== undefined) link.prNumber = prNumber;
        return link;
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Panel-ready factory snapshot for one (already matched) poll-list job:
 * the verbatim cycle stage plus the live session link when the daemon
 * attached it. Null when the job carries no recognizable stage (the row
 * then falls back to the generic phase — never a fabricated lane).
 * Never throws.
 */
export function describeFactoryJobForPanel(
  job: unknown,
): IssueFactoryJob | null {
  try {
    const stage = readFactoryJobStage(job);
    if (stage === null) return null;
    // Role session first (real work), MVP tracking link as fallback.
    const link = readRoleSessionLink(job) ?? readFactoryJobSessionLink(job);
    const jobId =
      isRecord(job) && typeof job.id === "string" ? job.id : "";
    const info: IssueFactoryJob = {
      jobId,
      stage: stage.status,
      stageLabel: stage.label,
      family: stage.family,
      stepIndex: stage.stepIndex,
      stepCount: stage.stepCount,
      terminal: stage.terminal,
    };
    if (link !== null) info.sessionUrl = link.sessionUrl;
    // Phase sessions dropdown (daemon `sessions`, en orden de fase):
    // el detalle muestra una entrada por rol con sesión registrada.
    const sessions = readFactoryJobSessions(job);
    if (sessions !== null) info.sessions = sessions;
    // Hooks declarativos (daemon `hookRuns`): chips de progreso + filas
    // extra en el dropdown como `{role: "hook:<name>"}`. Sin hooks → nada.
    const hooks = readFactoryJobHookRuns(job);
    if (hooks !== null) {
      info.hooks = hooks.map((h) => ({ name: h.name, stage: h.stage, status: h.status }));
      const withUrl = hooks.filter((h) => h.sessionUrl !== null);
      if (withUrl.length > 0) {
        const merged = [...(info.sessions ?? [])];
        for (const h of withUrl) {
          if (merged.some((s) => s.role === `hook:${h.name}`)) continue;
          merged.push({ role: `hook:${h.name}`, sessionUrl: h.sessionUrl as string });
        }
        info.sessions = merged;
      }
    }
    // Roster declarado (nombres + stage): chips pending en el stepper y
    // filas deshabilitadas en Agent Sessions, visibles desde que el agente
    // existe (aunque nunca haya corrido).
    const hookAgents = readFactoryJobHookAgents(job);
    if (hookAgents !== null) info.hookAgents = hookAgents;
    const cost = readFactoryJobCostSummary(job);
    if (cost !== undefined) info.costSummary = cost;
    // Isolation surface (T01 jail + PR, honest-empty when absent — the
    // daemon records them on the same poll-list item, zero new fetches).
    const isolation = readFactoryJobIsolation(job);
    if (isolation !== null) {
      info.branch = isolation.branch;
      if (isolation.prNumber !== undefined) info.prNumber = isolation.prNumber;
      // Explicit-cleanup surface (item 5): the isolated worktree folder the
      // detail Delete button targets. Honest-empty when the record carries
      // none (pre-isolation jobs) — callers disable instead of guessing.
      if (
        typeof isolation.worktreePath === "string" &&
        isolation.worktreePath.trim() !== ""
      ) {
        info.worktreePath = isolation.worktreePath;
      }
    }
    const prLink = readFactoryJobPrLink(job);
    if (prLink !== null) {
      info.prUrl = prLink.prUrl;
      if (prLink.prNumber !== undefined) info.prNumber = prLink.prNumber;
    }
    // Routing decisions (why Triage/Building): verbatim daemon reason +
    // confidence, summary-projected. Absent = unknown (honest-empty).
    const foremanDecision = readFactoryJobForemanDecision(job);
    if (foremanDecision !== null) info.foremanDecision = foremanDecision;
    const triageDecision = readFactoryJobTriageDecision(job);
    if (triageDecision !== null) info.triageDecision = triageDecision;
    return info;
  } catch {
    return null;
  }
}

// ─── Human gates ("needs a human") ──────────────────────────────────────────
//
// A factory job linked to an issue stops being agent work in flight when it
// waits for the human. The daemon exposes exactly three such gates, all
// readable from the EXISTING poll-list item (zero new polls, zero new
// daemon routes — the panel only reuses `POST …/spec/approve` and
// `POST …/triage/respond` plus the pre-existing `POST …/review/accept`
// "humano acepta igual"):
//
// | #   | Condition on the poll-list job (all require an ACTIVE job) | Gate |
// |-----|--------------------------------------------------------------|------|
// | H1  | `status === "Triage"` + pending spec approval: the list extra
// |     | `specApprovalPending === true`, or the timeline meta
// |     | `needsSpecApproval` (same `getLatestSpecApprovalRequest` the
// |     | daemon guards `POST …/spec/approve` with)                  | spec-approval |
// | H2  | `status === "Triage"` + unanswered triage questions: the list
// |     | extra `triage.openQuestions` (or timeline `meta.triage.
// |     | openQuestions`, same source the FactoryLab TriageQuestions UI
// |     | reads) is non-empty and no `meta.triageRespond` answer was
// |     | recorded yet                                            | triage-respond |
// | H3  | `status === "Review"` + `lastReview.verdict === "ask_human"`
// |     | (the daemon emits the `ask_human` notification with the same
// |     | `workItemId` at that exact moment — two views of one event) | ask-human |
// | H4  | Fallback: none of the above is legible, but a PENDING
// |     | (`acked !== true`) `ask_human` notification links to the job by
// |     | `workItemId === job.id`                                   | ask-human |
// | H0  | Parked turn (daemon restart marker `bootInterrupted` with no
// |     | later `resumed`): dominates every other gate, nothing else is
// |     | actionable until resumed                                 | resume |
//
// Precedence is H0 → H1 → H2 → H3 → H4 (parked first, then earliest
// pipeline gate). A
// terminal job (`Complete`/`Cancelled`) never reports a need: completion
// frees the row even if a stale notification was never acked. Unknown or
// malformed shapes report no need — a human gate is only ever claimed on
// positive evidence, never invented. Never throws.

/** Human-gate kinds (mirror `FactoryAwaitingKind` in `../types`). */
export type FactoryHumanNeedKind =
  | "spec-approval"
  | "triage-respond"
  | "ask-human"
  | "resume";

export interface FactoryHumanNeed {
  kind: FactoryHumanNeedKind;
  /** Daemon job id the Approve/Respond/Accept POST targets. */
  jobId: string;
  /** Verbatim spec summary (spec-approval only, when present). */
  specSummary?: string;
  /** Unanswered triage questions verbatim (triage-respond only). */
  questions?: string[];
  /** Verbatim review summary (ask-human only, when present). */
  reviewSummary?: string;
  /**
   * True cuando el review NUNCA corrió por fallo de infra/proveedor
   * (daemon `lastReview.isInfraError`). Solo presente en true: con datos
   * viejos o sin flag, ausente. La UI bloquea Accept y ofrece reintentar.
   */
  reviewInfraError?: boolean;
}

const TRIAGE_QUESTIONS_CAP = 10;
const TRIAGE_TEXT_MAX = 500;

function cleanJobId(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    if (
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.includes("..") ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes("\0")
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function cleanQuestionList(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const entry of value) {
      if (out.length >= TRIAGE_QUESTIONS_CAP) break;
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      out.push(trimmed.slice(0, TRIAGE_TEXT_MAX));
    }
    return out;
  } catch {
    return [];
  }
}

function jobStatus(job: Record<string, unknown>): string | null {
  try {
    return typeof job.status === "string" ? job.status : null;
  } catch {
    return null;
  }
}

function timelineOf(job: Record<string, unknown>): unknown[] {
  try {
    return Array.isArray(job.timeline) ? job.timeline : [];
  } catch {
    return [];
  }
}

/**
 * Latest triage questions from a poll-list job: the list extra
 * `triage.openQuestions` first (put there by `triageSpecExtras`), else the
 * timeline `meta.triage.openQuestions` newest-first (the source the
 * FactoryLab TriageQuestions UI reads). Empty when none — never throws.
 */
function latestTriageQuestions(job: Record<string, unknown>): string[] {
  try {
    const extra = job.triage;
    if (isRecord(extra)) {
      const cleaned = cleanQuestionList(extra.openQuestions);
      if (cleaned.length > 0) return cleaned;
    }
    const timeline = timelineOf(job);
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      try {
        const entry = timeline[i] as Record<string, unknown>;
        const meta = entry?.meta as unknown;
        if (isRecord(meta) && isRecord(meta.triage)) {
          const cleaned = cleanQuestionList(
            (meta.triage as Record<string, unknown>).openQuestions,
          );
          if (cleaned.length > 0) return cleaned;
        }
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * True when the timeline records a human triage answer (`meta.
 * `triageRespond` with at least one non-empty answer — the trace
 * `applyTriageRespondTransition` leaves). A responded job leaves Triage
 * anyway; this is the backstop for races. Perf Ola B: el summary proyecta
 * `triageAnswered` (mismo scan en el server); el scan queda como fallback
 * para la vista full. Never throws.
 */
function hasTriageAnswer(job: Record<string, unknown>): boolean {
  try {
    if (job.triageAnswered === true) return true;
    const timeline = timelineOf(job);
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      try {
        const entry = timeline[i] as Record<string, unknown>;
        const meta = entry?.meta as unknown;
        if (!isRecord(meta) || !isRecord(meta.triageRespond)) continue;
        const answers = (meta.triageRespond as Record<string, unknown>)
          .answers;
        if (!Array.isArray(answers)) continue;
        for (const answer of answers) {
          if (typeof answer === "string" && answer.trim().length > 0) {
            return true;
          }
        }
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Pending spec-approval summary, or null (H1 evidence). Never throws. */
function pendingSpecApproval(job: Record<string, unknown>): string | null {
  try {
    if (jobStatus(job) !== "Triage") return null;
    if (job.specApprovalPending === true) {
      const extra = isRecord(job.spec) ? job.spec : null;
      const summary =
        extra !== null && typeof extra.summary === "string"
          ? extra.summary.trim()
          : "";
      return summary !== "" ? summary : "(no summary)";
    }
    const found = getLatestSpecApprovalRequest(
      timelineOf(job) as Parameters<typeof getLatestSpecApprovalRequest>[0],
    );
    if (found === null) return null;
    const summary =
      typeof found.specSummary === "string" ? found.specSummary.trim() : "";
    return summary !== "" ? summary : "(no summary)";
  } catch {
    return null;
  }
}

/** `lastReview` verdict/summary read (H3 evidence). Never throws. */
function lastReviewAskHuman(
  job: Record<string, unknown>,
): { reviewSummary: string; reviewInfraError?: boolean } | null {
  try {
    if (jobStatus(job) !== "Review") return null;
    const lastReview = job.lastReview;
    if (!isRecord(lastReview)) return null;
    if (lastReview.verdict !== "ask_human") return null;
    const summary =
      typeof lastReview.summary === "string" ? lastReview.summary.trim() : "";
    return {
      reviewSummary: summary !== "" ? summary : "(no summary)",
      ...(lastReview.isInfraError === true ? { reviewInfraError: true as const } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Fallback matcher (H4): a PENDING (`acked !== true`) `ask_human`
 * notification linked to the job by `workItemId === jobId`. Exported for
 * unit tests; never throws. Anything else (acked, other kinds, other
 * jobs, junk) yields null — the gate needs positive evidence.
 */
export function matchPendingAskHumanNotification(
  notifications: unknown,
  jobId: string,
): { notificationId: string } | null {
  try {
    const cleanId = cleanJobId(jobId);
    if (cleanId === null) return null;
    if (!Array.isArray(notifications)) return null;
    for (const entry of notifications) {
      try {
        if (!isRecord(entry)) continue;
        if (entry.kind !== "ask_human") continue;
        if (entry.acked === true) continue;
        if (
          typeof entry.workItemId !== "string" ||
          entry.workItemId.trim() !== cleanId
        ) {
          continue;
        }
        const notificationId =
          typeof entry.id === "string" && entry.id.trim() !== ""
            ? entry.id.trim()
            : "";
        return { notificationId };
      } catch {
        // a broken entry never aborts the scan
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Human gate of one poll-list job (H1 → H2 → H3 → H4). Null when the job
 * needs nothing from the human. Only ACTIVE jobs can wait: terminal jobs
 * free the row even with stale signals. `notifications` is the optional
 * `GET /factory/notifications` list for the H4 fallback (absent = the
 * fallback stays dormant — structured signals H1–H3 carry the panel).
 * Never throws.
 */
export function readFactoryJobHumanNeed(
  job: unknown,
  notifications?: unknown,
): FactoryHumanNeed | null {
  try {
    if (!isRecord(job)) return null;
    if (!isFactoryJobActive(job)) return null;
    const jobId = cleanJobId(job.id);
    if (jobId === null) return null;

    // H0 — turno parqueado por reinicio: domina sobre cualquier otro gate
    // (nada más es accionable hasta retomar; el spec stale ya murió en P1a).
    // Perf Ola B: el summary proyecta `parked` (mismo `needsResume`
    // calculado en el server); el scan queda como fallback para la full.
    try {
      if (job.parked === true) {
        return { kind: "resume", jobId };
      }
    } catch {
      // cae al scan de abajo
    }
    try {
      if (needsResume(jobStatus(job), timelineOf(job) as Parameters<typeof needsResume>[1])) {
        return { kind: "resume", jobId };
      }
    } catch {
      // cae a los gates normales
    }

    const specSummary = pendingSpecApproval(job);
    if (specSummary !== null) {
      return { kind: "spec-approval", jobId, specSummary };
    }

    if (jobStatus(job) === "Triage" && !hasTriageAnswer(job)) {
      const questions = latestTriageQuestions(job);
      if (questions.length > 0) {
        return { kind: "triage-respond", jobId, questions };
      }
    }

    const askHuman = lastReviewAskHuman(job);
    if (askHuman !== null) {
      return {
        kind: "ask-human",
        jobId,
        reviewSummary: askHuman.reviewSummary,
        ...(askHuman.reviewInfraError === true ? { reviewInfraError: true as const } : {}),
      };
    }

    if (
      matchPendingAskHumanNotification(notifications, jobId) !== null
    ) {
      return { kind: "ask-human", jobId };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Measured cost (display only) ───────────────────────────────────────────

/**
 * Measured cost passthrough for the panel `~USD` line (same shape the
 * FactoryLab CostBadge reads — `CostSummary | null | undefined` with the
 * same honesty: `null` = tracking off, `undefined` = no data yet, never
 * an invented 0.00). `null` passes through, a record with a numeric
 * `llmCalls` passes through, anything else reads `undefined`. Never
 * throws.
 */
export function readFactoryJobCostSummary(
  job: unknown,
): CostSummary | null | undefined {
  try {
    if (!isRecord(job)) return undefined;
    if (!("costSummary" in job)) return undefined;
    const summary = job.costSummary;
    if (summary === null) return null;
    if (!isRecord(summary)) return undefined;
    return typeof summary.llmCalls === "number" &&
      Number.isFinite(summary.llmCalls)
      ? (summary as unknown as CostSummary)
      : undefined;
  } catch {
    return undefined;
  }
}
