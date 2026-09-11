/**
 * Factory jobs isolation — pure helpers (branch parity mirror, jail
 * resolver, PR text, create gate, PR-once guard, cleanup guards).
 *
 * Zero `child_process` here: every function is pure and offline-testable.
 * The side-effectful twins live in `gitWorktree.ts` / `gitHubPr.ts`.
 * Renderer boundary: this module never imports `src/canvas/*`. Branch
 * parity with `src/canvas/issueWorktreeNaming.ts` (`buildIssueBranchName`)
 * is enforced by `tests/factory-isolation.test.ts`, not by import.
 * Single-writer rule: this module never writes `job.json`; callers persist
 * via `workItemStore.appendEvent` / transitions.
 * Every function never throws (honest unions, errors sliced).
 */

import path from "node:path";
// Route-id safety mirrors `headless-runtime/factory/routing/routeParsers.ts`
// (`isSafeRouteId`: traversal / reserved / length rules); imported, never
// copied, so the DELETE parse honors the same vocabulary (C6/C7).
import { isSafeRouteId } from "../routing/routeParsers";

/** Timeline meta key carrying the isolation record (durable path). */
export const JOB_ISOLATION_META_KEY = "isolation";

/** Timeline meta key carrying the PR outcome (durable path). */
export const JOB_PR_META_KEY = "pr";

/** Terminal statuses that may own a cleanup (DELETE guard). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["Complete", "Cancelled"]);

/** Pact-shaped id prefixes excluded from isolation (mirror family). */
const PACT_ID_PREFIXES: readonly string[] = ["job-abc123", "job-f", "playground-"];

/**
 * Lower/kebab slug mirror of the canvas convention
 * (`src/canvas/issueWorktreeNaming.ts`): lowercase, non-alphanumeric to
 * hyphen, collapse, trim, 40 chars max, trailing hyphen trimmed.
 * Never throws.
 */
export function slugifyIssueTitle(title: unknown): string {
  try {
    const raw = typeof title === "string" ? title : "";
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .replace(/-$/, "");
    return slug;
  } catch {
    return "";
  }
}

/**
 * Branch mirror: MUST equal the canvas `buildIssueBranchName` output
 * given equal inputs (enforced by parity tests). Never throws.
 */
export function buildIsolationBranchName(input: {
  issueNumber: number;
  title?: unknown;
}): string {
  try {
    const raw = input?.issueNumber;
    const n =
      typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
    const slug = slugifyIssueTitle(input?.title);
    return slug.length > 0 ? `issue-${n}-${slug}` : `issue-${n}`;
  } catch {
    return "issue-0";
  }
}

/**
 * Title for the slug, parsed from the daemon prompt first line
 * (`# Resolve issue #N — <title>`). Null when absent (caller falls back
 * to `issue-N`). Never throws.
 */
export function parseIssueTitleFromPrompt(
  prompt: unknown,
  issueNumber: number,
): string | null {
  try {
    if (typeof prompt !== "string" || prompt.length === 0) return null;
    if (typeof issueNumber !== "number" || !Number.isInteger(issueNumber)) {
      return null;
    }
    const first = prompt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .at(0);
    if (!first) return null;
    const m = first.match(/^#\s*resolve\s+issue\s+#?(\d+)\s*[—–-]\s*(.+?)\s*$/i);
    if (!m) return null;
    if (Number.parseInt(m[1] as string, 10) !== issueNumber) return null;
    const title = (m[2] as string).trim().slice(0, 200);
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

/**
 * PR title for an isolated job. Never throws.
 */
export function buildPrTitle(issueNumber: number, title?: unknown): string {
  try {
    const clean =
      typeof title === "string" && title.trim().length > 0
        ? title.trim().slice(0, 200)
        : "";
    return clean.length > 0
      ? `Resolve issue #${issueNumber} — ${clean}`
      : `Resolve issue #${issueNumber}`;
  } catch {
    return `Resolve issue #${issueNumber}`;
  }
}

/**
 * PR body for an isolated job. Always carries `Closes #N` so the human
 * merge closes the issue on the GitHub side. Optional `details` enriches
 * the body with the accepted review summary, changed files and the
 * verification report (all sanitized, capped, never throwing — a junk
 * detail just renders an empty section). Neutral English.
 * Never throws.
 */
export interface PrBodyDetails {
  /** Accepted review summary (human-readable, what the change does). */
  summary?: unknown;
  /** Reviewer model ref, rendered as provenance under Summary. */
  reviewer?: unknown;
  /** Files created/modified by implement (timeline `createdFiles`). */
  files?: unknown;
  /** Verification report (timeline `meta.verification` shape). */
  verification?: unknown;
}

/** Trimmed single-line-safe text detail; empty when junk. Never throws. */
function cleanDetailText(v: unknown, max: number): string {
  try {
    if (typeof v !== "string") return "";
    const s = v.trim().replace(/\r/g, "").slice(0, max);
    return s.length > 0 ? s : "";
  } catch {
    return "";
  }
}

/** Trimmed string list detail; empty entries dropped, per-item capped. */
function cleanDetailList(v: unknown, cap: number): string[] {
  try {
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === "string" ? x.trim().slice(0, 200) : ""))
      .filter((s) => s.length > 0)
      .slice(0, cap);
  } catch {
    return [];
  }
}

/** Markdown lines for the verification report section. Never throws. */
function verificationLines(v: unknown): string[] {
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [];
    const rec = v as { overall?: unknown; steps?: unknown };
    const lines = (Array.isArray(rec.steps) ? rec.steps : [])
      .map((s) => {
        if (!s || typeof s !== "object") return "";
        const st = s as { name?: unknown; command?: unknown; status?: unknown };
        const name = typeof st.name === "string" ? st.name : "step";
        const command =
          typeof st.command === "string" && st.command.trim().length > 0
            ? ` — \`${st.command.trim()}\``
            : "";
        const status = typeof st.status === "string" ? st.status : "unknown";
        return `- ${name}${command} — ${status}`;
      })
      .filter((l) => l.length > 0)
      .slice(0, 10);
    if (lines.length === 0) return [];
    const overall = typeof rec.overall === "string" ? rec.overall : "unknown";
    return [`Overall: ${overall}`, ...lines];
  } catch {
    return [];
  }
}

export function buildPrBody(
  issueNumber: number,
  title?: unknown,
  details?: PrBodyDetails,
): string {
  try {
    const heading = buildPrTitle(issueNumber, title);
    const lines: string[] = [
      `# ${heading}`,
      "",
      "Automated change set, opened by the factory daemon for human review.",
      "Merging stays a human decision (panel Merge action or GitHub UI).",
    ];
    const summary = cleanDetailText(details?.summary, 600);
    if (summary.length > 0) {
      lines.push("", "## Summary", summary);
      const reviewer = cleanDetailText(details?.reviewer, 120);
      if (reviewer.length > 0) {
        lines.push("", `Reviewed by \`${reviewer}\`.`);
      }
    }
    const files = cleanDetailList(details?.files, 50);
    if (files.length > 0) {
      lines.push("", "## Changed files", ...files.map((f) => `- \`${f}\``));
    }
    const ver = verificationLines(details?.verification);
    if (ver.length > 0) {
      lines.push("", "## Verification", ...ver);
    }
    lines.push("", `Closes #${issueNumber}`, "");
    return lines.join("\n");
  } catch {
    return `Closes #${issueNumber}\n`;
  }
}

/**
 * Local shape check for a create-body `issueRef` (mirror of the
 * `sanitizeIssueRef` rules in `headless-runtime/factory/jobs/jobCreate.ts`:
 * provider github + integer issueNumber > 0; repo/url trimmed strings).
 * Null when junk. Never throws.
 */
export function sanitizeIsolationIssueRef(ref: unknown): {
  provider: "github";
  issueNumber: number;
  repo: string | null;
  url: string | null;
} | null {
  try {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const r = ref as Record<string, unknown>;
    if (r.provider !== "github") return null;
    if (
      typeof r.issueNumber !== "number" ||
      !Number.isInteger(r.issueNumber) ||
      (r.issueNumber as number) <= 0
    ) {
      return null;
    }
    const repo =
      typeof r.repo === "string" && r.repo.trim().length > 0
        ? r.repo.trim().slice(0, 256)
        : null;
    const url =
      typeof r.url === "string" && r.url.trim().length > 0
        ? r.url.trim().slice(0, 500)
        : null;
    return {
      provider: "github",
      issueNumber: r.issueNumber as number,
      repo,
      url,
    };
  } catch {
    return null;
  }
}

/**
 * Pact-shaped jobs stay on the byte-identical legacy in-place path
 * (same predicate family as the implement/review pact guards).
 * Never throws.
 */
export function isPactIsolationJob(input: {
  id?: unknown;
  prompt?: unknown;
  worktree?: unknown;
}): boolean {
  try {
    const idLC = String(input?.id ?? "").toLowerCase();
    if (PACT_ID_PREFIXES.some((p) => idLC.startsWith(p))) return true;
    const prompt = String(input?.prompt ?? "");
    if (prompt.startsWith("playground-")) return true;
    const wLC = String(input?.worktree ?? "").toLowerCase();
    if (wLC.includes("playground-")) return true;
    if (
      wLC.includes("playground") &&
      (idLC.startsWith("playground-") || idLC.includes("playground"))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create gate: isolate only when the body carries a valid `issueRef`
 * AND the job is not pact-shaped. Everything else keeps the legacy
 * in-place path (pacts F01–F14 never touch git/gh). Never throws.
 */
export function shouldIsolate(body: unknown): boolean {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const b = body as Record<string, unknown>;
    if (sanitizeIsolationIssueRef(b.issueRef) === null) return false;
    if (
      isPactIsolationJob({ id: b.id, prompt: b.prompt, worktree: b.worktree })
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Isolation record shape carried in memory + timeline meta. */
export interface IsolationRecordLike {
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly repoRoot: string;
}

function isFullIsolationRecord(value: unknown): value is IsolationRecordLike {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const r = value as Record<string, unknown>;
    return (
      typeof r.branch === "string" &&
      (r.branch as string).length > 0 &&
      typeof r.baseBranch === "string" &&
      (r.baseBranch as string).length > 0 &&
      typeof r.worktreePath === "string" &&
      (r.worktreePath as string).length > 0 &&
      typeof r.repoRoot === "string" &&
      (r.repoRoot as string).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Durable-path read: latest timeline `isolation` meta with a full record
 * (reverse scan; a broken entry never aborts the scan). Null when absent.
 * Never throws.
 */
export function readIsolationFromTimeline(
  timeline: unknown,
): IsolationRecordLike | null {
  try {
    if (!Array.isArray(timeline)) return null;
    const entries = [...timeline].reverse();
    const found = entries
      .map((e) => {
        try {
          const meta = (e as Record<string, unknown> | null)?.meta as unknown;
          if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
            return null;
          }
          const holder = (meta as Record<string, unknown>)[
            JOB_ISOLATION_META_KEY
          ];
          return isFullIsolationRecord(holder) ? holder : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is IsolationRecordLike => x !== null)
      .at(0);
    return found ?? null;
  } catch {
    return null;
  }
}

/**
 * Durable-path PR read: latest timeline `pr` meta carrying a prNumber
 * (reverse scan). Null when absent. Never throws.
 */
export function readPrFromTimeline(
  timeline: unknown,
): { prNumber?: number; prUrl?: string } | null {
  try {
    if (!Array.isArray(timeline)) return null;
    const entries = [...timeline].reverse();
    const numbered = entries
      .map((e) => {
        try {
          const meta = (e as Record<string, unknown> | null)?.meta as unknown;
          if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
            return null;
          }
          return (meta as Record<string, unknown>)[JOB_PR_META_KEY] as unknown;
        } catch {
          return null;
        }
      })
      .filter(
        (m): m is Record<string, unknown> =>
          !!m &&
          typeof m === "object" &&
          !Array.isArray(m) &&
          typeof (m as Record<string, unknown>).prNumber === "number" &&
          Number.isInteger((m as Record<string, unknown>).prNumber) &&
          ((m as Record<string, unknown>).prNumber as number) > 0,
      )
      .at(0);
    if (!numbered) return null;
    const out: { prNumber?: number; prUrl?: string } = {
      prNumber: numbered.prNumber as number,
    };
    if (typeof numbered.prUrl === "string" && numbered.prUrl.length > 0) {
      out.prUrl = numbered.prUrl as string;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Single pure resolver: the jail when recorded (memory fast path, then
 * timeline durable path across restarts), else the requested anchor
 * resolved (legacy in-place behavior). Never throws.
 */
export function effectiveWorktreeFor(job: {
  worktree: unknown;
  isolation?: { worktreePath?: unknown } | null;
  timeline?: unknown;
}): string {
  try {
    const anchor = typeof job?.worktree === "string" ? job.worktree : "";
    const mem = job?.isolation?.worktreePath;
    if (typeof mem === "string" && mem.length > 0) return mem;
    const durable = readIsolationFromTimeline(job?.timeline);
    if (durable !== null) return durable.worktreePath;
    return path.resolve(anchor);
  } catch {
    try {
      return path.resolve(String(job?.worktree ?? "."));
    } catch {
      return String(job?.worktree ?? ".");
    }
  }
}

/** Once-per-job PR guard outcome. */
export type PrGuardOutcome =
  | { opened: true; prNumber?: number; prUrl?: string }
  | { opened: false };

/**
 * PR-once guard: memory `isolation.state` is the fast path, the persisted
 * timeline `pr` meta (with prNumber) is the durable path across restarts.
 * Never throws.
 */
export function prGuard(jobLike: {
  isolation?: {
    state?: unknown;
    prNumber?: unknown;
    prUrl?: unknown;
  } | null;
  timeline?: unknown;
}): PrGuardOutcome {
  try {
    const iso = jobLike?.isolation;
    const state = typeof iso?.state === "string" ? iso.state : "";
    if (state === "pr-open" || state === "pr-merged") {
      const out: { opened: true; prNumber?: number; prUrl?: string } = {
        opened: true,
      };
      if (
        typeof iso?.prNumber === "number" &&
        Number.isInteger(iso.prNumber) &&
        (iso.prNumber as number) > 0
      ) {
        out.prNumber = iso.prNumber as number;
      }
      if (typeof iso?.prUrl === "string" && (iso.prUrl as string).length > 0) {
        out.prUrl = iso.prUrl as string;
      }
      return out;
    }
    const durable = readPrFromTimeline(jobLike?.timeline);
    if (durable !== null && typeof durable.prNumber === "number") {
      return { opened: true, ...durable };
    }
    return { opened: false };
  } catch {
    return { opened: false };
  }
}

/** PR visibility for the DELETE guard. */
export type PrVisibility = "open" | "merged" | "closed" | "none" | "unknown";

/** DELETE guard verdict (honest shapes for the route). */
export type WorktreeDeleteVerdict =
  | { ok: true }
  | { ok: false; code: 409; reason: string };

/**
 * Explicit-cleanup guard matrix (pure): non-terminal always refuses
 * (`force` never overrides non-terminality); open/unknown/absent PR
 * refuses without `force`; dirtiness refuses without `force`.
 * Never throws.
 */
export function decideWorktreeDelete(input: {
  status: unknown;
  hasIsolation: boolean;
  prState: PrVisibility;
  dirty: boolean;
  force?: boolean;
}): WorktreeDeleteVerdict {
  try {
    const force = input?.force === true;
    if (input?.hasIsolation !== true) {
      return {
        ok: false,
        code: 409,
        reason: "no isolated worktree recorded given this job",
      };
    }
    const status = typeof input?.status === "string" ? input.status : "";
    if (!TERMINAL_STATUSES.has(status)) {
      return {
        ok: false,
        code: 409,
        reason: `job is not terminal (status=${status || "unknown"})`,
      };
    }
    const pr = input?.prState ?? "unknown";
    if (pr === "open") {
      if (!force) {
        return {
          ok: false,
          code: 409,
          reason: "PR is still open (pass force to remove anyway)",
        };
      }
    } else if (pr === "merged" || pr === "closed") {
      // Human already closed the loop: fall through to the dirt check.
    } else if (!force) {
      return {
        ok: false,
        code: 409,
        reason:
          pr === "none"
            ? "no PR on record (pass force to remove anyway)"
            : "PR state unknown (pass force to remove anyway)",
      };
    }
    if (input?.dirty === true && !force) {
      return {
        ok: false,
        code: 409,
        reason: "worktree has uncommitted changes (pass force to discard)",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 409, reason: "cleanup guard failed" };
  }
}

/**
 * Pure parse of `DELETE /factory/jobs/:id/worktree` (factory canonical
 * only, no alias). Rejects traversal + reserved segments. Never throws.
 */
export function parseWorktreeDeletePath(
  pathname: unknown,
): { id: string } | { error: string } {
  try {
    if (typeof pathname !== "string" || pathname.length === 0) {
      return { error: "invalid pathname" };
    }
    const parts = pathname.split("/").filter(Boolean);
    if (
      parts.length !== 4 ||
      parts[0] !== "factory" ||
      parts[1] !== "jobs" ||
      parts[3] !== "worktree"
    ) {
      return { error: "not a worktree delete path" };
    }
    const id = parts[2] as string;
    if (!isSafeRouteId(id)) return { error: "invalid id" };
    return { id };
  } catch {
    return { error: "invalid pathname" };
  }
}
