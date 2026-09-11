/**
 * factoryJobIndex — poll-list job lookup index + freshness helpers.
 *
 * B3 hot-path fix. Every 2.5s poll rebuilds the `useWorkItemStore` list and
 * both adapters (`liveIssues`, `liveActivity`) re-derive all N rows. The old
 * per-row `findActiveFactoryJobForIssue(jobs, n, repo)` scanned all M jobs
 * (each doing an `issueRef` read with a timeline reverse-scan) — O(N x M x T)
 * per adapter per poll (N = issues, M = jobs, T = timeline depth). With
 * N = M = 342 that is ~117k ref reads per adapter per tick, x2 adapters.
 *
 * This module builds ONE `Map<issueNumber, jobs[]>` per snapshot — O(M x T)
 * once — and each row resolves with a map get plus an active check over its
 * (usually 0-1) candidates: O(M x T + N) per snapshot. Match semantics are
 * byte-identical to `findActiveFactoryJobForIssue` (same number equality,
 * same repo rule, same active rule, first-active wins by list order).
 *
 * Also home to the B4/B5 freshness helpers (stalled-job detection and the
 * session-attach wait state), which are pure functions over the same
 * poll-list shapes — kept here so the timing policy lives in one place.
 *
 * Everything here is pure, ESM, and never throws. Neutral English strings.
 */

import {
  isFactoryJobActive,
  isFactoryJobCompleted,
  readFactoryJobIssueRef,
} from "./factoryIssueJobs";

/** A job's `issueRef` repo on either side may be unknown (null). */
function reposAgree(a: string | null, b: string | null): boolean {
  try {
    if (a === null || b === null) return true;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  } catch {
    return false;
  }
}

function cleanRepo(value: unknown): string | null {
  try {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Indexes one poll list by linked issue number in a single pass: each job's
 * `issueRef` is read ONCE (memory key, then timeline durable path). Jobs
 * without a valid ref are skipped. Insertion order follows the input list
 * so "first match wins" keeps list order. Never throws.
 */
export function buildFactoryJobIndex(jobs: unknown): Map<number, unknown[]> {
  const index = new Map<number, unknown[]>();
  try {
    if (!Array.isArray(jobs)) return index;
    for (const job of jobs) {
      try {
        const ref = readFactoryJobIssueRef(job);
        if (ref === null) continue;
        const bucket = index.get(ref.issueNumber);
        if (bucket !== undefined) bucket.push(job);
        else index.set(ref.issueNumber, [job]);
      } catch {
        // a broken entry never aborts the index build
      }
    }
  } catch {
    // never throws — partial index still beats a rescan
  }
  return index;
}

/**
 * Perf Ola B3: índice compartido memoizado por identidad del array.
 * Ambos adapters (`liveIssues`, `liveActivity`) más el detalle construyen
 * el índice del MISMO payload por tick; sin memo son 3 builds O(M x T) por
 * tick. WeakMap: misma identidad → mismo Map (cero rebuilds en steady
 * state gracias al guard de `setWorkItems`); payload nuevo → build único
 * compartido por los tres; el GC libera solo (sin leaks, sin invalidación
 * manual). Nunca lanza.
 */
const indexCache = new WeakMap<object, Map<number, unknown[]>>();

export function getFactoryJobIndex(jobs: unknown): Map<number, unknown[]> {
  try {
    if (Array.isArray(jobs)) {
      const hit = indexCache.get(jobs);
      if (hit !== undefined) return hit;
      const built = buildFactoryJobIndex(jobs);
      try {
        indexCache.set(jobs, built);
      } catch {
        // cache best-effort: ante fallo se devuelve el recién construido
      }
      return built;
    }
    return buildFactoryJobIndex(jobs);
  } catch {
    return new Map();
  }
}

/**
 * Indexed twin of `findActiveFactoryJobForIssue`: same match
 * (`issueRef.issueNumber` equal, repo must agree when both sides know it,
 * job active), resolved against a `buildFactoryJobIndex` map instead of
 * the raw list. Null when none — never throws.
 */
export function findActiveFactoryJobForIssueIndexed(
  index: Map<number, unknown[]> | null | undefined,
  issueNumber: number,
  repo?: string | null,
): unknown | null {
  try {
    if (!(index instanceof Map)) return null;
    if (
      typeof issueNumber !== "number" ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return null;
    }
    const bucket = index.get(issueNumber);
    if (!bucket) return null;
    const want = cleanRepo(repo);
    for (const job of bucket) {
      try {
        const ref = readFactoryJobIssueRef(job);
        if (ref === null || ref.issueNumber !== issueNumber) continue;
        if (!reposAgree(ref.repo, want)) continue;
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
 * Indexed twin of `findCompletedFactoryJobForIssue`: same match
 * (`issueRef.issueNumber` equal, repo must agree when both sides know it,
 * job terminal-Complete), resolved against a `buildFactoryJobIndex` map
 * instead of the raw list. Null when none — never throws.
 */
export function findCompletedFactoryJobForIssueIndexed(
  index: Map<number, unknown[]> | null | undefined,
  issueNumber: number,
  repo?: string | null,
): unknown | null {
  try {
    if (!(index instanceof Map)) return null;
    if (
      typeof issueNumber !== "number" ||
      !Number.isInteger(issueNumber) ||
      issueNumber <= 0
    ) {
      return null;
    }
    const bucket = index.get(issueNumber);
    if (!bucket) return null;
    const want = cleanRepo(repo);
    for (const job of bucket) {
      try {
        const ref = readFactoryJobIssueRef(job);
        if (ref === null || ref.issueNumber !== issueNumber) continue;
        if (!reposAgree(ref.repo, want)) continue;
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

/** A non-terminal job with no daemon update for this long reads as stalled. */
export const STALLED_JOB_THRESHOLD_MS = 10 * 60 * 1000;

/** An active job with no `dashboardUrl` past this age reads as overdue. */
export const SESSION_ATTACH_TIMEOUT_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Reads one job timestamp as epoch ms. Accepts epoch-ms numbers and ISO
 * date strings (daemon `WorkItem` uses ISO, legacy `FactoryJob` uses
 * epoch numbers). Null when absent or unparseable — never throws, never
 * invents "now".
 */
export function readJobTimestampMs(job: unknown, key: string): number | null {
  try {
    if (!isRecord(job)) return null;
    const value = job[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const ms = new Date(value.trim()).getTime();
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * B4 honest-stale check: true when the job is non-terminal (still claimed
 * as in-progress by `isFactoryJobActive`) but its `updatedAt` is older
 * than `thresholdMs`. That combination means the daemon restored the row
 * from disk yet no worker is advancing it — daemon restarts never resume
 * in-flight workers (see `restoreJobsFromDisk`: statuses restore as-is,
 * dispatch only happens post-201), so the row would otherwise fake
 * progress forever. Terminal jobs, jobs without a readable `updatedAt`,
 * and junk never read as stalled. Never throws.
 */
export function isFactoryJobStalled(
  job: unknown,
  nowMs: number = Date.now(),
  thresholdMs: number = STALLED_JOB_THRESHOLD_MS,
): boolean {
  try {
    if (!isRecord(job)) return false;
    if (!isFactoryJobActive(job)) return false;
    const updatedAt = readJobTimestampMs(job, "updatedAt");
    if (updatedAt === null) return false;
    if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return false;
    if (typeof thresholdMs !== "number" || !Number.isFinite(thresholdMs)) {
      return false;
    }
    return nowMs - updatedAt > thresholdMs;
  } catch {
    return false;
  }
}

/** Session-link freshness for one linked job (B5 honest UI). */
export type SessionAttachKind = "ready" | "attaching" | "overdue" | "absent";

export interface SessionAttachState {
  kind: SessionAttachKind;
  /** Ms since `createdAtMs` when known, else null (never invented). */
  elapsedMs: number | null;
}

/**
 * B5 condition spelled out: `dashboardUrl` is set only when a
 * `session.create` succeeds on the daemon (`factoryServer`
 * `syncSessionFieldsAndPersist`); per-role pipeline sessions never backfill
 * the top-level link, so a job whose MVP session failed shows no link at
 * ANY stage — including Review. Callers render:
 * - ready: "View Agent" opens the URL.
 * - attaching: active job, no URL yet, within timeout — honest
 *   "attaching… (elapsed)" with the CTA disabled.
 * - overdue: active job, no URL past the timeout — the session never
 *   attached on this path (exact condition in the title, CTA disabled).
 * - absent: no active job and no URL — the pre-existing honest disabled
 *   text. Never throws.
 */
export function sessionAttachState(input: {
  sessionUrl?: string | null;
  active?: boolean | null;
  createdAtMs?: number | null;
  nowMs?: number;
  timeoutMs?: number;
}): SessionAttachState {
  try {
    const url =
      typeof input?.sessionUrl === "string" ? input.sessionUrl.trim() : "";
    if (url !== "") return { kind: "ready", elapsedMs: null };
    const active = input?.active === true;
    if (!active) return { kind: "absent", elapsedMs: null };
    const createdAt =
      typeof input?.createdAtMs === "number" &&
      Number.isFinite(input.createdAtMs) &&
      (input.createdAtMs as number) > 0
        ? (input.createdAtMs as number)
        : null;
    const now =
      typeof input?.nowMs === "number" && Number.isFinite(input.nowMs)
        ? (input.nowMs as number)
        : Date.now();
    const timeout =
      typeof input?.timeoutMs === "number" &&
      Number.isFinite(input.timeoutMs) &&
      (input.timeoutMs as number) > 0
        ? (input.timeoutMs as number)
        : SESSION_ATTACH_TIMEOUT_MS;
    const elapsedMs = createdAt !== null ? Math.max(0, now - createdAt) : null;
    if (elapsedMs !== null && elapsedMs > timeout) {
      return { kind: "overdue", elapsedMs };
    }
    return { kind: "attaching", elapsedMs };
  } catch {
    return { kind: "absent", elapsedMs: null };
  }
}

/**
 * Short elapsed text for honest wait titles ("45s", "3m", "2h", "4d").
 * Null input yields "" (callers omit the parenthetical). Never throws.
 */
export function formatElapsedShort(elapsedMs: number | null): string {
  try {
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return "";
    const s = Math.max(0, Math.floor(elapsedMs / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch {
    return "";
  }
}
