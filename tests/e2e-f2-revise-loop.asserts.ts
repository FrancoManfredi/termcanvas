/**
 * F2-T1 — E2E F2 revise-loop disk-assert helpers (offline unit part).
 *
 * Plan: software-paridad-100/PLAN-100-PARIDAD.md §F2 + §4.2 + §0.
 * Scope-freeze: this is the ONLY file created in F2-T1. No changes to
 * reviewService / WorkItemList here (premiere-only phase, hardening only
 * if live proves a hole in F2-T2/F2-T3).
 *
 * What this file is:
 * - Pure offline disk-assert helpers reused by the F2-T2 live run
 *   (Playwright MCP reads job.json / review.json / verify.json / timeline
 *   from disk and calls the exported asserts; screenshot stays attachment).
 * - An offline `node:test` suite proving the helpers on synthetic fixtures
 *   (tmp dirs under os.tmpdir, zero network, zero daemon, zero LLM).
 *
 * Covers (§4.2 asserts + F2 DONE):
 * - session continuity: reuse (agentSessions implement+review) OR renewed
 *   event with the exact marker (same-session rebuild, E2E-06).
 * - reverify-before-verdict: reviewer-requested reverify evidence BEFORE
 *   the final verdict (E2E-07; absence is DIFERIDO-honest, never FAIL).
 * - reviewCount: entero >= 0 en job + timeline metas (sin techo).
 * - byte-exact file Y: live file content equals expected bytes exactly.
 * - createdFiles == real paths (H-001 / H-013 no-regression): every entry
 *   resolves inside the worktree and exists as a FILE; literal-folder
 *   suspects (empty spaced dirs from prompt text) are reported.
 * - revise findings actionable: every revise carries >= 1 finding with
 *   file + actionable reason (E2E-02).
 *
 * Contracts (binding, §0):
 * - ESM only, zero network, zero polling, zero timers.
 * - Every iteration is bounded by an explicit cap (no open-ended loops).
 * - Every test declares an explicit timeout.
 *
 * Live reuse example:
 *   import {
 *     readF2DiskBundle, assertF2LoopDisk,
 *   } from "./tests/e2e-f2-revise-loop.asserts.ts";
 *   const bundle = readF2DiskBundle(jobDir);
 *   const verdict = assertF2LoopDisk(bundle, { worktree, expectedRelPath, expectedContent });
 *
 * Offline run (explicit timeout, PowerShell):
 *   npx tsx --test tests/e2e-f2-revise-loop.asserts.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Exact markers (mirror of the daemon sources, read-only copies) ──

/** Exact renewal marker written by workItemStore.appendAgentSessionRenewed. */
export const SESSION_RENEWED_MARK = "sesión renovada (la anterior expiró)";

/** Prefix of the reverify execution event written by ReviewService.maybeRunReverify. */
export const REVERIFY_EXECUTED_PREFIX = "reverify: ejecutados ";

/** Fail-closed note for out-of-allowlist reverify requests. */
export const REVERIFY_IGNORED_NOTE = "reverify ignorado: comando fuera de allowlist";

/** Sin budget de revisiones (doctrina sin-límites): el count solo debe ser
 * entero >= 0 (el loop termina por veredicto o humano, nunca por contador).
 * Re-declarado acá para mantener este módulo sin dependencias. */
export const REVIEW_MAX_COUNT = Number.POSITIVE_INFINITY;

/** reviewAttempt: entero >= 1, sin techo. */
export const REVIEW_MAX_ATTEMPTS = Number.POSITIVE_INFINITY;

/** Caps: every loop in this file is bounded by one of these. */
export const F2_MAX_TIMELINE_SCAN = 500;
export const F2_MAX_CREATED_FILES = 50;
export const F2_MAX_FINDINGS_SCAN = 20;
export const F2_MAX_TOPLEVEL_SCAN = 100;

// ── Loose disk shapes (restore-tolerant: every field optional) ──

export interface F2TimelineEntryLike {
  message?: unknown;
  actor?: unknown;
  meta?: unknown;
  at?: unknown;
  from?: unknown;
  to?: unknown;
}

export interface F2AgentSessionsLike {
  implement?: unknown;
  review?: unknown;
  foreman?: unknown;
  triage?: unknown;
  spec?: unknown;
}

export interface F2FindingLike {
  id?: unknown;
  file?: unknown;
  message?: unknown;
  suggestion?: unknown;
  severity?: unknown;
  axis?: unknown;
}

export interface F2ReviewLike {
  verdict?: unknown;
  findings?: unknown;
  reviewAttempt?: unknown;
  summary?: unknown;
}

export interface F2JobLike {
  reviewCount?: unknown;
  status?: unknown;
  lastReview?: unknown;
  timeline?: unknown;
  agentSessions?: unknown;
  createdFiles?: unknown;
}

export interface F2DiskBundle {
  jobDir: string;
  job: F2JobLike | null;
  jobRaw: string | null;
  review: F2ReviewLike | null;
  reviewRaw: string | null;
  timeline: F2TimelineEntryLike[];
}

// ── Small pure helpers ──

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function timelineOf(job: F2JobLike | null): F2TimelineEntryLike[] {
  if (job === null) return [];
  const raw = (job as { timeline?: unknown }).timeline;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, F2_MAX_TIMELINE_SCAN).filter(
    (e): e is F2TimelineEntryLike => !!e && typeof e === "object",
  );
}

function messageOf(entry: F2TimelineEntryLike): string {
  return asString(entry.message);
}

function metaOf(entry: F2TimelineEntryLike): Record<string, unknown> {
  if (entry.meta !== null && typeof entry.meta === "object" && !Array.isArray(entry.meta)) {
    return entry.meta as Record<string, unknown>;
  }
  return {};
}

function isNonEmptyId(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// ── 1. Session continuity (E2E-06) ──

export type F2SessionContinuityKind = "renewed" | "reused" | "none";

export interface F2SessionContinuity {
  ok: boolean;
  kind: F2SessionContinuityKind;
  detail: string;
}

/**
 * Session continuity for the revise→rebuild loop.
 *
 * ok === true when EITHER holds (plan §4.2: reuse OR renewed event):
 * - renewed: any timeline message contains SESSION_RENEWED_MARK, or any
 *   entry meta carries agentSessions.renewed === true.
 * - reused: agentSessions persists a non-empty id for implement AND review
 *   (one session per job+role, at most one each), which proves the rebuild
 *   and the re-review continued the same conversations.
 *
 * Pure, offline, bounded to F2_MAX_TIMELINE_SCAN entries. Never throws.
 */
export function hasSessionContinuity(
  timeline: unknown,
  agentSessions: unknown,
): F2SessionContinuity {
  try {
    const entries = (Array.isArray(timeline) ? timeline : []).slice(0, F2_MAX_TIMELINE_SCAN);
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const entry = raw as F2TimelineEntryLike;
      const msg = messageOf(entry);
      if (msg.includes(SESSION_RENEWED_MARK)) {
        return { ok: true, kind: "renewed", detail: msg.slice(0, 200) };
      }
      const meta = metaOf(entry);
      const ag = meta.agentSessions;
      if (ag !== null && typeof ag === "object" && !Array.isArray(ag)) {
        const rec = ag as Record<string, unknown>;
        if (rec.renewed === true) {
          return { ok: true, kind: "renewed", detail: msg.slice(0, 200) || "meta agentSessions.renewed" };
        }
      }
    }
    const sessions =
      agentSessions !== null && typeof agentSessions === "object" && !Array.isArray(agentSessions)
        ? (agentSessions as F2AgentSessionsLike)
        : null;
    if (sessions !== null && isNonEmptyId(sessions.implement) && isNonEmptyId(sessions.review)) {
      return {
        ok: true,
        kind: "reused",
        detail: `implement+review sessions persisted (${asString(sessions.implement).slice(0, 12)} / ${asString(sessions.review).slice(0, 12)})`,
      };
    }
    return { ok: false, kind: "none", detail: "no reuse ids and no renewed event" };
  } catch {
    return { ok: false, kind: "none", detail: "continuity check failed defensively" };
  }
}

// ── 2. Reverify before verdict (E2E-07) ──

export interface F2ReverifyOrder {
  fired: boolean;
  ok: boolean;
  reverifyIndex: number;
  finalVerdictIndex: number;
  detail: string;
}

function isReverifyExecutedMessage(msg: string): boolean {
  return msg.startsWith(REVERIFY_EXECUTED_PREFIX);
}

function isFinalVerdictMessage(msg: string): boolean {
  const low = msg.toLowerCase();
  if (msg.includes("review accept intento")) return true;
  if (low.includes("→ complete")) return true;
  if (low.includes("-> complete")) return true;
  if (msg.includes("review ask_human intento") && msg.includes("stay Review")) return true;
  return false;
}

/**
 * Locate the reverify execution event and the final verdict event.
 *
 * - fired === false (reviewer never doubted) is DIFERIDO-honest: ok stays
 *   true and detail says so. Absence is never FAIL (plan F2 DONE).
 * - fired === true requires reverifyIndex < finalVerdictIndex and a
 *   non-empty evidence string in the reverify meta.
 *
 * Pure, offline, bounded. Never throws.
 */
export function assertReverifyBeforeVerdict(timeline: unknown): F2ReverifyOrder {
  try {
    const entries = (Array.isArray(timeline) ? timeline : []).slice(0, F2_MAX_TIMELINE_SCAN);
    let reverifyIndex = -1;
    let reverifyEvidence = "";
    const limit = Math.min(entries.length, F2_MAX_TIMELINE_SCAN);
    for (let i = 0; i < limit; i++) {
      const raw = entries[i];
      if (raw === null || typeof raw !== "object") continue;
      const msg = messageOf(raw as F2TimelineEntryLike);
      if (isReverifyExecutedMessage(msg)) {
        reverifyIndex = i;
        const meta = metaOf(raw as F2TimelineEntryLike);
        const rev = meta.reverify;
        if (rev !== null && typeof rev === "object" && !Array.isArray(rev)) {
          const ev = (rev as Record<string, unknown>).evidence;
          reverifyEvidence = typeof ev === "string" ? ev : "";
        }
        break;
      }
    }
    if (reverifyIndex === -1) {
      return {
        fired: false,
        ok: true,
        reverifyIndex: -1,
        finalVerdictIndex: -1,
        detail: "DIFERIDO-honest: reviewer never doubted, no reverify event (absence is not FAIL)",
      };
    }
    let finalVerdictIndex = -1;
    for (let i = reverifyIndex + 1; i < limit; i++) {
      const raw = entries[i];
      if (raw === null || typeof raw !== "object") continue;
      const msg = messageOf(raw as F2TimelineEntryLike);
      if (isFinalVerdictMessage(msg)) {
        finalVerdictIndex = i;
        break;
      }
    }
    // Fallback: lastReview accept persisted without a Complete line yet.
    if (finalVerdictIndex === -1) {
      for (let i = limit - 1; i > reverifyIndex; i--) {
        const raw = entries[i];
        if (raw === null || typeof raw !== "object") continue;
        const msg = messageOf(raw as F2TimelineEntryLike);
        if (msg.includes("review accept")) {
          finalVerdictIndex = i;
          break;
        }
      }
    }
    if (finalVerdictIndex === -1) {
      return {
        fired: true,
        ok: false,
        reverifyIndex,
        finalVerdictIndex: -1,
        detail: "reverify fired but no final verdict follows it yet",
      };
    }
    if (reverifyEvidence.trim().length === 0) {
      return {
        fired: true,
        ok: false,
        reverifyIndex,
        finalVerdictIndex,
        detail: "reverify event carries empty evidence",
      };
    }
    return {
      fired: true,
      ok: true,
      reverifyIndex,
      finalVerdictIndex,
      detail: `reverify@${reverifyIndex} before verdict@${finalVerdictIndex}`,
    };
  } catch {
    return { fired: false, ok: false, reverifyIndex: -1, finalVerdictIndex: -1, detail: "order check failed defensively" };
  }
}

// ── 3. Review-count budget (E2E-02) ──

export interface F2BudgetCheck {
  ok: boolean;
  reviewCount: number;
  detail: string;
}

/**
 * reviewCount entero >= 0 en job.json y en cada meta del timeline que traiga
 * uno (sin techo: doctrina sin-límites). reviewAttempt, cuando presente,
 * debe ser entero >= 1. Puro, offline, acotado. Nunca lanza.
 */
export function assertReviewCountBudget(job: unknown): F2BudgetCheck {
  try {
    if (job === null || typeof job !== "object" || Array.isArray(job)) {
      return { ok: false, reviewCount: -1, detail: "job missing" };
    }
    const rec = job as Record<string, unknown>;
    const rc = rec.reviewCount;
    const reviewCount = typeof rc === "number" && Number.isInteger(rc) ? rc : 0;
    if (reviewCount < 0 || reviewCount > REVIEW_MAX_COUNT) {
      return { ok: false, reviewCount, detail: `reviewCount=${reviewCount} inválido (negativo)` };
    }
    const entries = (Array.isArray(rec.timeline) ? rec.timeline : []).slice(0, F2_MAX_TIMELINE_SCAN);
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const meta = metaOf(raw as F2TimelineEntryLike);
      const mrc = meta.reviewCount;
      if (typeof mrc === "number" && Number.isInteger(mrc) && (mrc < 0 || mrc > REVIEW_MAX_COUNT)) {
        return { ok: false, reviewCount: mrc, detail: `timeline meta reviewCount=${mrc} inválido` };
      }
    }
    const lastReview = rec.lastReview;
    if (lastReview !== null && typeof lastReview === "object" && !Array.isArray(lastReview)) {
      const attempt = (lastReview as Record<string, unknown>).reviewAttempt;
      if (attempt !== undefined && (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1 || attempt > REVIEW_MAX_ATTEMPTS)) {
        return { ok: false, reviewCount, detail: `reviewAttempt inválido (debe ser entero >= 1)` };
      }
    }
    return { ok: true, reviewCount, detail: `reviewCount=${reviewCount} válido (sin techo)` };
  } catch {
    return { ok: false, reviewCount: -1, detail: "budget check failed defensively" };
  }
}

// ── 4. Revise findings actionable (E2E-02) ──

export interface F2FindingsCheck {
  ok: boolean;
  reviseCount: number;
  detail: string;
}

function isActionableFinding(f: F2FindingLike): boolean {
  const file = asString(f.file).trim();
  const message = asString(f.message).trim();
  const suggestion = asString(f.suggestion).trim();
  if (file.length === 0) return false;
  return message.length >= 10 || suggestion.length >= 10;
}

/**
 * Every timeline revise (message contains "review revise") must carry >= 1
 * actionable finding (file + reason >= 10 chars) in its meta review/findings
 * or reviewFindings. Non-revise timelines pass vacuously.
 * Pure, offline, bounded to F2_MAX_TIMELINE_SCAN entries and
 * F2_MAX_FINDINGS_SCAN findings each. Never throws.
 */
export function assertReviseFindingsActionable(timeline: unknown): F2FindingsCheck {
  try {
    const entries = (Array.isArray(timeline) ? timeline : []).slice(0, F2_MAX_TIMELINE_SCAN);
    let reviseCount = 0;
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const entry = raw as F2TimelineEntryLike;
      const msg = messageOf(entry);
      if (!msg.includes("review revise")) continue;
      reviseCount++;
      const meta = metaOf(entry);
      const candidates: unknown[] = [];
      const reviewMeta = meta.review;
      if (reviewMeta !== null && typeof reviewMeta === "object" && !Array.isArray(reviewMeta)) {
        const findings = (reviewMeta as Record<string, unknown>).findings;
        for (const f of asArray(findings).slice(0, F2_MAX_FINDINGS_SCAN)) candidates.push(f);
      }
      for (const f of asArray(meta.reviewFindings).slice(0, F2_MAX_FINDINGS_SCAN)) candidates.push(f);
      let actionable = false;
      for (const c of candidates.slice(0, F2_MAX_FINDINGS_SCAN)) {
        if (c !== null && typeof c === "object" && !Array.isArray(c)) {
          if (isActionableFinding(c as F2FindingLike)) {
            actionable = true;
            break;
          }
        }
      }
      if (!actionable) {
        return { ok: false, reviseCount, detail: `revise #${reviseCount} without actionable finding (file + reason)` };
      }
    }
    if (reviseCount === 0) {
      return { ok: true, reviseCount: 0, detail: "no revise observed (accept-direct run)" };
    }
    return { ok: true, reviseCount, detail: `${reviseCount} revise(s) with actionable findings` };
  } catch {
    return { ok: false, reviseCount: 0, detail: "findings check failed defensively" };
  }
}

/**
 * True when the timeline shows the revise→rebuild→reverify cycle shape:
 * at least one Building→Review and one Review→Building transition line.
 * Pure, offline, bounded. Never throws.
 */
export function hasReviseRebuildCycle(timeline: unknown): boolean {
  try {
    const entries = (Array.isArray(timeline) ? timeline : []).slice(0, F2_MAX_TIMELINE_SCAN);
    let sawToReview = false;
    let sawReviseBack = false;
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const msg = messageOf(raw as F2TimelineEntryLike);
      if (msg.includes("verification passed → Review") || msg.includes("→ Review")) sawToReview = true;
      if (msg.includes("review revise") && msg.includes("→ Building")) sawReviseBack = true;
    }
    return sawToReview && sawReviseBack;
  } catch {
    return false;
  }
}

// ── 5. Byte-exact file Y ──

export interface F2FileCheck {
  ok: boolean;
  detail: string;
}

/**
 * Byte-exact assertion: worktree/<relPath> exists as a FILE and its bytes
 * equal Buffer.from(expected, utf-8) exactly (no trim, no normalize).
 * Offline fs read only. Never throws.
 */
export function assertFileByteExact(worktree: string, relPath: string, expected: string): F2FileCheck {
  try {
    if (typeof worktree !== "string" || worktree.length === 0) return { ok: false, detail: "worktree missing" };
    if (typeof relPath !== "string" || relPath.length === 0) return { ok: false, detail: "relPath missing" };
    const target = path.resolve(worktree, relPath);
    const rel = path.relative(path.resolve(worktree), target);
    if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return { ok: false, detail: `relPath escapes worktree: ${relPath}` };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return { ok: false, detail: `file absent on disk: ${relPath}` };
    }
    if (!stat.isFile()) return { ok: false, detail: `not a file on disk: ${relPath}` };
    const actual = fs.readFileSync(target);
    const wanted = Buffer.from(expected, "utf-8");
    if (!actual.equals(wanted)) {
      return {
        ok: false,
        detail: `bytes differ: ${relPath} (disk ${actual.length}B vs expected ${wanted.length}B)`,
      };
    }
    return { ok: true, detail: `byte-exact: ${relPath} (${actual.length}B)` };
  } catch {
    return { ok: false, detail: "file check failed defensively" };
  }
}

// ── 6. createdFiles == real paths (H-001 / H-013 no-regression) ──

export interface F2CreatedFilesCheck {
  ok: boolean;
  checked: number;
  detail: string;
}

/**
 * Strict equality: every createdFiles entry resolves inside the worktree
 * and exists as a FILE (dirs, empty placeholders and prompt-text literals
 * fail). Absolute paths and `..` escapes fail. Empty list fails: a Complete
 * delivery with zero tracked files is the H-013 ghost.
 * Offline fs only, bounded to F2_MAX_CREATED_FILES. Never throws.
 */
export function assertCreatedFilesExact(worktree: string, createdFiles: unknown): F2CreatedFilesCheck {
  try {
    if (typeof worktree !== "string" || worktree.length === 0) {
      return { ok: false, checked: 0, detail: "worktree missing" };
    }
    if (!Array.isArray(createdFiles) || createdFiles.length === 0) {
      return { ok: false, checked: 0, detail: "createdFiles empty: untracked delivery (H-013)" };
    }
    const root = path.resolve(worktree);
    const entries = createdFiles.slice(0, F2_MAX_CREATED_FILES);
    let checked = 0;
    for (const raw of entries) {
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return { ok: false, checked, detail: "createdFiles holds empty entry" };
      }
      const target = path.resolve(root, raw);
      const rel = path.relative(root, target);
      if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        return { ok: false, checked, detail: `createdFiles escapes worktree: ${raw}` };
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(target);
      } catch {
        return { ok: false, checked, detail: `createdFiles absent on disk: ${raw}` };
      }
      if (!stat.isFile()) {
        return { ok: false, checked, detail: `createdFiles not a file (literal/empty dir?): ${raw}` };
      }
      checked++;
    }
    return { ok: true, checked, detail: `${checked} tracked file(s) exist as files` };
  } catch {
    return { ok: false, checked: 0, detail: "createdFiles check failed defensively" };
  }
}

/**
 * H-001 double-write guard: top-level scan (bounded to
 * F2_MAX_TOPLEVEL_SCAN entries) reporting directories whose name looks
 * like prompt text (contains a space) and is empty. Non-empty spaced dirs
 * are NOT flagged (legit names may hold spaces).
 * Offline fs only. Never throws.
 */
export function findLiteralFolderSuspects(worktree: string): string[] {
  const out: string[] = [];
  try {
    if (typeof worktree !== "string" || worktree.length === 0) return out;
    const root = path.resolve(worktree);
    let names: string[] = [];
    try {
      names = fs.readdirSync(root).slice(0, F2_MAX_TOPLEVEL_SCAN);
    } catch {
      return out;
    }
    for (const name of names.slice(0, F2_MAX_TOPLEVEL_SCAN)) {
      if (typeof name !== "string" || !name.includes(" ")) continue;
      if (name === ".agents" || name.startsWith(".")) continue;
      const full = path.join(root, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      let kids: string[] = [];
      try {
        kids = fs.readdirSync(full);
      } catch {
        continue;
      }
      if (kids.length === 0) out.push(name);
    }
    return out;
  } catch {
    return out;
  }
}

// ── 7. Disk bundle (what the live run reads) ──

function readJsonFileOrNull(file: string): { value: unknown; raw: string | null } {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    try {
      return { value: JSON.parse(raw) as unknown, raw };
    } catch {
      return { value: null, raw };
    }
  } catch {
    return { value: null, raw: null };
  }
}

/**
 * Read one job dir ({worktree}/.agents/factory/{id}/) into a loose bundle.
 * Reads job.json (required) + review.json (optional). Never throws.
 */
export function readF2DiskBundle(jobDir: string): F2DiskBundle {
  const empty: F2DiskBundle = { jobDir, job: null, jobRaw: null, review: null, reviewRaw: null, timeline: [] };
  try {
    if (typeof jobDir !== "string" || jobDir.length === 0) return empty;
    const jobFile = readJsonFileOrNull(path.join(jobDir, "job.json"));
    const reviewFile = readJsonFileOrNull(path.join(jobDir, "review.json"));
    const job =
      jobFile.value !== null && typeof jobFile.value === "object" && !Array.isArray(jobFile.value)
        ? (jobFile.value as F2JobLike)
        : null;
    const review =
      reviewFile.value !== null && typeof reviewFile.value === "object" && !Array.isArray(reviewFile.value)
        ? (reviewFile.value as F2ReviewLike)
        : null;
    return {
      jobDir,
      job,
      jobRaw: jobFile.raw,
      review: review,
      reviewRaw: reviewFile.raw,
      timeline: timelineOf(job),
    };
  } catch {
    return empty;
  }
}

export interface F2LoopVerdict {
  ok: boolean;
  session: F2SessionContinuity;
  reverify: F2ReverifyOrder;
  budget: F2BudgetCheck;
  findings: F2FindingsCheck;
  file: F2FileCheck;
  createdFiles: F2CreatedFilesCheck;
  literalSuspects: string[];
  detail: string;
}

/**
 * Composite F2 loop verdict over a disk bundle plus the live worktree.
 * The live run calls this once per job; ok === true means E2E-02 shape +
 * E2E-06 continuity + E2E-07 ordering (or honest DIFERIDO) + byte-exact Y
 * + H-001/H-013 file tracking all hold.
 * Offline fs for the file parts; the rest is pure. Never throws.
 */
export function assertF2LoopDisk(
  bundle: F2DiskBundle,
  opts: { worktree: string; expectedRelPath: string; expectedContent: string },
): F2LoopVerdict {
  const fallback: F2LoopVerdict = {
    ok: false,
    session: { ok: false, kind: "none", detail: "no bundle" },
    reverify: { fired: false, ok: false, reverifyIndex: -1, finalVerdictIndex: -1, detail: "no bundle" },
    budget: { ok: false, reviewCount: -1, detail: "no bundle" },
    findings: { ok: false, reviseCount: 0, detail: "no bundle" },
    file: { ok: false, detail: "no bundle" },
    createdFiles: { ok: false, checked: 0, detail: "no bundle" },
    literalSuspects: [],
    detail: "no bundle",
  };
  try {
    if (bundle === null || typeof bundle !== "object") return fallback;
    const job = bundle.job;
    if (job === null) return { ...fallback, detail: "job.json absent or invalid" };
    const timeline = bundle.timeline;
    const sessions = (job as { agentSessions?: unknown }).agentSessions;
    const session = hasSessionContinuity(timeline, sessions);
    const reverify = assertReverifyBeforeVerdict(timeline);
    const budget = assertReviewCountBudget(job);
    const findings = assertReviseFindingsActionable(timeline);
    const created = (job as { createdFiles?: unknown }).createdFiles;
    const createdFiles = assertCreatedFilesExact(opts.worktree, created);
    const file = assertFileByteExact(opts.worktree, opts.expectedRelPath, opts.expectedContent);
    const literalSuspects = findLiteralFolderSuspects(opts.worktree);
    const literalsOk = literalSuspects.length === 0;
    const ok =
      session.ok && reverify.ok && budget.ok && findings.ok && file.ok && createdFiles.ok && literalsOk;
    const parts = [
      `session:${session.kind}:${session.ok ? "ok" : "FAIL"}`,
      `reverify:${reverify.fired ? `fired@${reverify.reverifyIndex}<verdict@${reverify.finalVerdictIndex}` : "DIFERIDO"}:${reverify.ok ? "ok" : "FAIL"}`,
      `budget:${budget.detail}:${budget.ok ? "ok" : "FAIL"}`,
      `findings:${findings.detail}:${findings.ok ? "ok" : "FAIL"}`,
      `file:${file.detail}:${file.ok ? "ok" : "FAIL"}`,
      `createdFiles:${createdFiles.detail}:${createdFiles.ok ? "ok" : "FAIL"}`,
      `literals:${literalsOk ? "none" : literalSuspects.slice(0, 3).join("|")}:${literalsOk ? "ok" : "FAIL"}`,
    ];
    return { ok, session, reverify, budget, findings, file, createdFiles, literalSuspects, detail: parts.join(" · ") };
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────
// Offline suite (synthetic fixtures, zero network, zero daemon)
// ─────────────────────────────────────────────────────────────

const TEST_TIMEOUT_MS = 30_000;

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function entry(message: string, meta?: Record<string, unknown>): F2TimelineEntryLike {
  return { message, actor: "system", ...(meta ? { meta } : {}) };
}

test("session continuity: renewed marker passes (message)", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [entry("created Intake"), entry(`sesión renovada (la anterior expiró) rol=implement abc→def`)];
  const r = hasSessionContinuity(tl, {});
  assert.equal(r.ok, true);
  assert.equal(r.kind, "renewed");
});

test("session continuity: renewed via meta passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [
    entry("created Intake"),
    entry("rebuilt", { agentSessions: { role: "implement", renewed: true, oldSessionId: "a", newSessionId: "b" } }),
  ];
  const r = hasSessionContinuity(tl, {});
  assert.equal(r.ok, true);
  assert.equal(r.kind, "renewed");
});

test("session continuity: reused implement+review passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [entry("created Intake"), entry("review revise intento 1 → Building (1 findings)")];
  const r = hasSessionContinuity(tl, { implement: "ses_impl_123", review: "ses_rev_456" });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "reused");
});

test("session continuity: neither reuse nor renewal fails", { timeout: TEST_TIMEOUT_MS }, () => {
  const r = hasSessionContinuity([entry("created Intake")], {});
  assert.equal(r.ok, false);
  assert.equal(r.kind, "none");
  const malformed = hasSessionContinuity(null, null);
  assert.equal(malformed.ok, false);
});

test("reverify before verdict: fired-before-accept passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [
    entry("review revise intento 1 → Building (1 findings)"),
    entry("reverify: ejecutados 1 comando(s): git status --porcelain", {
      reverify: { commands: ["git status --porcelain"], evidence: "$ git status --porcelain\nclean" },
    }),
    entry("review accept intento 2: defecto corregido"),
  ];
  const r = assertReverifyBeforeVerdict(tl);
  assert.equal(r.fired, true);
  assert.equal(r.ok, true);
  assert.ok(r.reverifyIndex < r.finalVerdictIndex);
});

test("reverify before verdict: absent is DIFERIDO-honest (not FAIL)", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [entry("review revise intento 1 → Building (1 findings)"), entry("review accept intento 2: ok")];
  const r = assertReverifyBeforeVerdict(tl);
  assert.equal(r.fired, false);
  assert.equal(r.ok, true);
  assert.ok(r.detail.includes("DIFERIDO"));
});

test("reverify before verdict: empty evidence fails", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [
    entry("reverify: ejecutados 1 comando(s): git status --porcelain", {
      reverify: { commands: ["git status --porcelain"], evidence: "   " },
    }),
    entry("review accept intento 2: ok"),
  ];
  const r = assertReverifyBeforeVerdict(tl);
  assert.equal(r.fired, true);
  assert.equal(r.ok, false);
});

test("review-count: enteros >= 0 pasan (sin techo), negativos fallan", { timeout: TEST_TIMEOUT_MS }, () => {
  for (const n of [0, 1, 2, 3, 99]) {
    const r = assertReviewCountBudget({ reviewCount: n, timeline: [] });
    assert.equal(r.ok, true, `count ${n} must pass`);
  }
  const bad = assertReviewCountBudget({ reviewCount: -1, timeline: [] });
  assert.equal(bad.ok, false);
  const metaBad = assertReviewCountBudget({
    reviewCount: 2,
    timeline: [entry("x", { reviewCount: -1 })],
  });
  assert.equal(metaBad.ok, false);
});

test("revise findings: actionable passes, file-less fails", { timeout: TEST_TIMEOUT_MS }, () => {
  const good = [
    entry("review revise intento 1 → Building (1 findings)", {
      review: { verdict: "revise", findings: [{ id: "f1", file: "lab2-rev/dato.txt", message: "el archivo trae X pero se pidio Y exacto" }] },
    }),
  ];
  const rGood = assertReviseFindingsActionable(good);
  assert.equal(rGood.ok, true);
  assert.equal(rGood.reviseCount, 1);
  const bad = [
    entry("review revise intento 1 → Building (1 findings)", {
      review: { verdict: "revise", findings: [{ id: "f1", message: "mal" }] },
    }),
  ];
  assert.equal(assertReviseFindingsActionable(bad).ok, false);
  assert.equal(assertReviseFindingsActionable([entry("review accept intento 1: ok")]).ok, true);
});

test("revise→rebuild cycle shape detected", { timeout: TEST_TIMEOUT_MS }, () => {
  const tl = [
    entry("verification passed → Review"),
    entry("review revise intento 1 → Building (1 findings)"),
    entry("verification passed → Review"),
  ];
  assert.equal(hasReviseRebuildCycle(tl), true);
  assert.equal(hasReviseRebuildCycle([entry("review accept intento 1: ok")]), false);
});

test("byte-exact file: match passes, mismatch and missing fail", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f2-byte-");
  try {
    const rel = path.join("lab2-rev", "dato.txt");
    fs.mkdirSync(path.join(wt, "lab2-rev"), { recursive: true });
    const expected = "linea uno\nlinea dos\n";
    fs.writeFileSync(path.join(wt, rel), expected, "utf-8");
    assert.equal(assertFileByteExact(wt, rel, expected).ok, true);
    assert.equal(assertFileByteExact(wt, rel, "otra cosa\n").ok, false);
    assert.equal(assertFileByteExact(wt, path.join("lab2-rev", "ausente.txt"), expected).ok, false);
    assert.equal(assertFileByteExact(wt, "../fuera.txt", expected).ok, false);
  } finally {
    rmTmp(wt);
  }
});

test("createdFiles exact: files pass, missing and dirs fail (H-001/H-013)", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f2-cf-");
  try {
    fs.mkdirSync(path.join(wt, "lab2-rev"), { recursive: true });
    fs.writeFileSync(path.join(wt, "lab2-rev", "dato.txt"), "Y\n", "utf-8");
    fs.mkdirSync(path.join(wt, "vacia"), { recursive: true });
    assert.equal(assertCreatedFilesExact(wt, ["lab2-rev/dato.txt"]).ok, true);
    assert.equal(assertCreatedFilesExact(wt, []).ok, false);
    assert.equal(assertCreatedFilesExact(wt, ["lab2-rev/ausente.txt"]).ok, false);
    assert.equal(assertCreatedFilesExact(wt, ["vacia"]).ok, false);
    assert.equal(assertCreatedFilesExact(wt, ["/abs/x.txt"]).ok, false);
  } finally {
    rmTmp(wt);
  }
});

test("literal-folder suspects: empty spaced dir flagged, files ignored", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f2-lit-");
  try {
    fs.mkdirSync(path.join(wt, "lab2-rev con un archivo datotxt"), { recursive: true });
    fs.mkdirSync(path.join(wt, "lab2-rev"), { recursive: true });
    fs.writeFileSync(path.join(wt, "lab2-rev", "dato.txt"), "Y\n", "utf-8");
    const suspects = findLiteralFolderSuspects(wt);
    assert.ok(suspects.includes("lab2-rev con un archivo datotxt"));
    assert.equal(suspects.includes("lab2-rev"), false);
  } finally {
    rmTmp(wt);
  }
});

test("disk bundle: composite PASS on synthetic revise loop", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f2-e2e-");
  try {
    const rel = path.join("lab2-rev", "dato.txt");
    const expected = "valor exacto Y\n";
    fs.mkdirSync(path.join(wt, "lab2-rev"), { recursive: true });
    fs.writeFileSync(path.join(wt, rel), expected, "utf-8");
    const jobDir = path.join(wt, ".agents", "factory", "job-f2demo01");
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: "job-f2demo01",
      reviewCount: 2,
      status: "Complete",
      agentSessions: { implement: "ses_impl_1", review: "ses_rev_1" },
      createdFiles: ["lab2-rev/dato.txt"],
      timeline: [
        { message: "verification passed → Review", actor: "runner" },
        {
          message: "review revise intento 1 → Building (1 findings)",
          actor: "system",
          meta: {
            review: {
              verdict: "revise",
              findings: [{ id: "f1", file: "lab2-rev/dato.txt", message: "el archivo trae X pero se pidio Y exacto" }],
            },
            reviewCount: 1,
          },
        },
        {
          message: "reverify: ejecutados 1 comando(s): git status --porcelain",
          actor: "system",
          meta: { reverify: { commands: ["git status --porcelain"], evidence: "$ git status --porcelain\nok" } },
        },
        { message: "review accept intento 2: defecto corregido", actor: "system", meta: { reviewCount: 2 } },
      ],
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(
      path.join(jobDir, "review.json"),
      JSON.stringify({ workItemId: "job-f2demo01", verdict: "accept", findings: [] }, null, 2),
      "utf-8",
    );
    const bundle = readF2DiskBundle(jobDir);
    assert.ok(bundle.job !== null);
    const verdict = assertF2LoopDisk(bundle, { worktree: wt, expectedRelPath: rel, expectedContent: expected });
    assert.equal(verdict.ok, true, verdict.detail);
    assert.equal(verdict.session.ok, true);
    assert.equal(verdict.reverify.fired, true);
    assert.equal(verdict.budget.ok, true);
  } finally {
    rmTmp(wt);
  }
});

test("disk bundle: composite FAILs on invalid count and ghost files", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f2-neg-");
  try {
    const jobDir = path.join(wt, ".agents", "factory", "job-f2bad01");
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: "job-f2bad01",
      reviewCount: -1,
      status: "Complete",
      agentSessions: {},
      createdFiles: [],
      timeline: [{ message: "review accept intento 3: ok", actor: "system" }],
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    const bundle = readF2DiskBundle(jobDir);
    const verdict = assertF2LoopDisk(bundle, {
      worktree: wt,
      expectedRelPath: "ausente.txt",
      expectedContent: "Y\n",
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.budget.ok, false);
    assert.equal(verdict.session.ok, false);
    const missing = readF2DiskBundle(path.join(wt, ".agents", "factory", "job-f2nope01"));
    assert.equal(missing.job, null);
  } finally {
    rmTmp(wt);
  }
});
