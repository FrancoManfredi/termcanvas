/**
 * F3-T2 — E2E F3 human-in-the-measure disk-assert helpers (offline unit part).
 *
 * Plan: software-paridad-100/PLAN-100-PARIDAD.md §F3 + §4.3 + §0.
 * Scope-freeze: this is the ONLY file created in F3-T2 besides the two
 * additive engine links (benchmarkEngine record-decision, improvementEngine
 * adopt/discard-from-notification). No changes to validate / routeTable /
 * server / client / UI / LOOPS here.
 *
 * What this file is:
 * - Pure offline disk-assert helpers reused by the F3 live premieres
 *   (Playwright MCP reads spec.md / approval events / decision sidecars /
 *   proposal files / notifications from disk and calls the exported asserts;
 *   screenshots stay attachments).
 * - An offline `node:test` suite proving the helpers on synthetic fixtures
 *   (tmp dirs under os.tmpdir, zero network, zero daemon, zero LLM).
 *
 * Covers (plan §4.3 asserts + F3 DONE):
 * - spec chain: non-trivial job yields a brief (spec.md), the human approves
 *   it (approval event with approvedBy "human"), then implement cites the
 *   approved brief (SpecCite record whose jobId and specApprovedAt link the
 *   exact approval instant).
 * - benchmark decision: a human-only BenchmarkDecision on disk whose
 *   benchmarkId matches the run, whose trialsRef points at that run's
 *   trials, with no winner-like keys anywhere (no auto-winner).
 * - proposal from notification: a proposal-ready notification announcing an
 *   imp-… id, resolved to a proposal that is Adopted or Discarded (decided,
 *   with decidedAt), with no auto fields anywhere (never auto-adopt).
 *
 * Contracts (binding, §0):
 * - ESM only, zero require, zero network, zero polling, zero timers.
 * - Every iteration is bounded by an explicit cap (no open-ended loops).
 * - Every test declares an explicit timeout.
 *
 * Live reuse example:
 *   import {
 *     readF3DiskBundle, assertF3MeasureDisk,
 *   } from "./tests/e2e-f3-measure.asserts.ts";
 *   const bundle = readF3DiskBundle({ jobDir, decisionPath, proposalPath });
 *   const verdict = assertF3MeasureDisk(bundle, { runId, jobId });
 *
 * Offline run (explicit timeout, PowerShell):
 *   npx tsx --test tests/e2e-f3-measure.asserts.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isValidIsoUtcString,
  parseBenchmarkDecision,
  parseSpecCite,
} from "../headless-runtime/factory/measure/decisionRecord.ts";

// ── Exact markers (mirrors of the daemon sources, read-only copies) ──

/** Notification kind announcing a ready proposal (mirror of notify center). */
export const PROPOSAL_READY_KIND = "proposal-ready";

/** Notification kind announcing spec waiting for approval. */
export const SPEC_APPROVAL_KIND = "spec-approval";

/** Notification kind announcing a finished benchmark run. */
export const BENCHMARK_DONE_KIND = "benchmark-done";

/** The single allowed human actor value. */
export const HUMAN_ACTOR = "human";

/** Suffix of the benchmark decision sidecar (mirror of benchmarkEngine). */
export const BENCHMARK_DECISION_SUFFIX = ".decision.json";

/** First-match pattern for a proposal id inside notification text. */
export const PROPOSAL_ID_PATTERN = /imp-[a-z0-9-]+/i;

/** Strict proposal id shape (mirror of shared/types/improvement). */
export const PROPOSAL_ID_STRICT = /^imp-[a-z0-9-]+$/i;

/** Strict benchmark run id shape (mirror of shared/types/benchmark). */
export const BENCHMARK_RUN_ID_STRICT = /^bench-[a-z0-9-]+$/;

/** Keys that must never appear on a stored benchmark decision. */
export const DECISION_FORBIDDEN_KEYS = [
  "winner",
  "autoWinner",
  "winningConfig",
  "recommendation",
  "autoAdopt",
  "auto",
] as const;

/** Keys that must never appear on a stored decided proposal. */
export const PROPOSAL_FORBIDDEN_KEYS = [
  "autoAdopt",
  "autoApprove",
  "auto",
] as const;

/** Caps: every loop in this file is bounded by one of these. */
export const F3_MAX_TIMELINE_SCAN = 500;
export const F3_MAX_TEXT_FIELDS = 5;
export const F3_MAX_BODY_SCAN = 2000;
export const F3_MIN_SPEC_CHARS = 20;

// ── Loose disk shapes (restore-tolerant: every field optional) ──

export interface F3TimelineEntryLike {
  message?: unknown;
  actor?: unknown;
  meta?: unknown;
  at?: unknown;
}

export interface F3JobLike {
  id?: unknown;
  status?: unknown;
  timeline?: unknown;
}

export interface F3ProposalLike {
  id?: unknown;
  status?: unknown;
  decidedAt?: unknown;
}

export interface F3NotificationLike {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  proposalId?: unknown;
}

export interface F3DiskBundle {
  jobDir: string;
  job: F3JobLike | null;
  jobRaw: string | null;
  specMd: string | null;
  decision: unknown;
  decisionRaw: string | null;
  proposal: unknown;
  proposalRaw: string | null;
  notification: unknown;
  timeline: F3TimelineEntryLike[];
}

// ── Small pure helpers ──

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timelineOf(job: F3JobLike | null): F3TimelineEntryLike[] {
  if (job === null) return [];
  const raw = (job as { timeline?: unknown }).timeline;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, F3_MAX_TIMELINE_SCAN).filter(
    (entry): entry is F3TimelineEntryLike => !!entry && typeof entry === "object",
  );
}

function isSafeProposalIdLike(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > 128) return false;
    if (id.trim() !== id || id.length === 0) return false;
    if (!PROPOSAL_ID_STRICT.test(id)) return false;
    if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSafeBenchmarkRunIdLike(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > 128) return false;
    if (id.trim() !== id) return false;
    if (!BENCHMARK_RUN_ID_STRICT.test(id)) return false;
    if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function firstProposalIdInText(text: unknown): string | null {
  try {
    if (typeof text !== "string") return null;
    const match = PROPOSAL_ID_PATTERN.exec(text.slice(0, F3_MAX_BODY_SCAN));
    if (!match || !match[0]) return null;
    return isSafeProposalIdLike(match[0]) ? match[0] : null;
  } catch {
    return null;
  }
}

// ── 1. Proposal id from notification (pure mirror of the engine link) ──

/**
 * Extracts the announced proposal id from a notification-like value.
 * Explicit proposalId first, then body/title scan. The center id (n-…)
 * never matches. Pure, bounded, never throws (null when not found).
 */
export function extractProposalIdFromNotificationLike(notification: unknown): string | null {
  try {
    if (typeof notification === "string") return firstProposalIdInText(notification);
    if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
      return null;
    }
    const record = notification as Record<string, unknown>;
    const fields: unknown[] = [
      record.proposalId,
      record.proposal_id,
      record.body,
      record.title,
      record.dedupeKey,
    ].slice(0, F3_MAX_TEXT_FIELDS);
    for (let i = 0; i < fields.length; i++) {
      const value = fields[i];
      if (typeof value !== "string" || value.length === 0) continue;
      if (i <= 1) {
        const clean = value.trim().slice(0, 128);
        if (clean.length > 0 && isSafeProposalIdLike(clean)) return clean;
        continue;
      }
      const found = firstProposalIdInText(value);
      if (found) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the value carries kind "proposal-ready". Pure, never throws.
 */
export function isProposalReadyNotificationLike(notification: unknown): boolean {
  try {
    if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
      return false;
    }
    return (notification as Record<string, unknown>).kind === PROPOSAL_READY_KIND;
  } catch {
    return false;
  }
}

// ── 2. Spec chain (brief → human approval → implement cite) ──

export interface F3SpecCheck {
  ok: boolean;
  detail: string;
}

function approvalInstantOf(approval: unknown): string {
  try {
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) return "";
    const record = approval as Record<string, unknown>;
    for (const key of ["specApprovedAt", "approvedAt", "at"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Spec approval chain over loose inputs.
 *
 * ok === true when ALL hold:
 * - specMd is a non-blank brief of at least F3_MIN_SPEC_CHARS chars
 *   (a real brief, never a stub).
 * - approval carries approvedBy exactly "human" plus a valid ISO instant.
 * - cite passes the shared SpecCite schema with cite.jobId === jobId and
 *   cite.specApprovedAt === the approval instant (implement cites the exact
 *   brief approval it was given).
 *
 * Pure, offline. Never throws.
 */
export function assertSpecChain(
  specMd: unknown,
  approval: unknown,
  cite: unknown,
  jobId: string,
): F3SpecCheck {
  try {
    if (typeof specMd !== "string" || specMd.trim().length < F3_MIN_SPEC_CHARS) {
      return { ok: false, detail: `spec brief too short (need >= ${F3_MIN_SPEC_CHARS} chars of real brief)` };
    }
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      return { ok: false, detail: "approval event missing" };
    }
    const record = approval as Record<string, unknown>;
    if (record.approvedBy !== HUMAN_ACTOR) {
      return { ok: false, detail: `approval must be by "human" (got ${typeof record.approvedBy === "string" ? `"${String(record.approvedBy).slice(0, 30)}"` : typeof record.approvedBy})` };
    }
    const instant = approvalInstantOf(approval);
    if (!isValidIsoUtcString(instant)) {
      return { ok: false, detail: "approval instant must be an ISO 8601 UTC string" };
    }
    const checked = parseSpecCite(cite);
    if (!checked.ok) {
      return { ok: false, detail: `implement cite invalid: ${checked.error.slice(0, 200)}` };
    }
    if (checked.data.jobId !== jobId) {
      return { ok: false, detail: `cite jobId "${checked.data.jobId.slice(0, 60)}" !== job "${String(jobId).slice(0, 60)}"` };
    }
    if (checked.data.specApprovedAt !== instant) {
      return { ok: false, detail: "cite specApprovedAt must equal the approval instant (exact chain link)" };
    }
    return { ok: true, detail: `spec chain ok: job "${jobId}" cites brief approved at ${instant}` };
  } catch {
    return { ok: false, detail: "spec chain check failed defensively" };
  }
}

// ── 3. Benchmark decision on disk (human-only, run-linked, no winner) ──

export interface F3DecisionCheck {
  ok: boolean;
  detail: string;
}

/**
 * Benchmark decision over a loose disk value plus its run id.
 *
 * ok === true when ALL hold:
 * - the value passes the shared BenchmarkDecision schema
 *   (decidedBy exactly "human"; winner-like keys rejected).
 * - decision.benchmarkId === runId and runId is a safe bench id.
 * - decision.trialsRef contains runId (honest pointer at weighed trials).
 * - no forbidden winner/auto key present on the raw object either
 *   (defense in depth for hand-edited sidecars).
 *
 * Pure, offline. Never throws.
 */
export function assertBenchmarkDecisionDisk(decision: unknown, runId: string): F3DecisionCheck {
  try {
    if (!isSafeBenchmarkRunIdLike(runId)) {
      return { ok: false, detail: `run id unsafe: ${String(runId).slice(0, 60)}` };
    }
    const checked = parseBenchmarkDecision(decision);
    if (!checked.ok) {
      return { ok: false, detail: `decision invalid: ${checked.error.slice(0, 200)}` };
    }
    const data = checked.data;
    if (data.decidedBy !== HUMAN_ACTOR) {
      return { ok: false, detail: "decision must be by human (never auto)" };
    }
    if (data.benchmarkId !== runId) {
      return { ok: false, detail: `decision benchmarkId "${data.benchmarkId.slice(0, 60)}" !== run "${runId.slice(0, 60)}"` };
    }
    if (!data.trialsRef.includes(runId)) {
      return { ok: false, detail: `trialsRef must reference run "${runId.slice(0, 60)}"` };
    }
    if (decision !== null && typeof decision === "object" && !Array.isArray(decision)) {
      const raw = decision as Record<string, unknown>;
      for (const key of DECISION_FORBIDDEN_KEYS) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
          return { ok: false, detail: `field "${key}" is forbidden — benchmarks never declare a winner` };
        }
      }
    }
    return { ok: true, detail: `decision ok: run "${runId}" decided by human (${data.change.slice(0, 80)})` };
  } catch {
    return { ok: false, detail: "decision check failed defensively" };
  }
}

// ── 4. Proposal decided from the notification (adopted / discarded) ──

export interface F3ProposalCheck {
  ok: boolean;
  action: "adopted" | "discarded" | "undecided";
  proposalId: string | null;
  detail: string;
}

/**
 * Proposal-from-notification over loose disk values.
 *
 * ok === true when ALL hold:
 * - notification kind is exactly "proposal-ready".
 * - the announced proposal id extracts cleanly and equals proposal.id.
 * - proposal.status is "adopted" or "discarded" (a human decision taken
 *   from the notification; ready/pending/failed is undecided, never ok).
 * - proposal.decidedAt is a non-empty instant string.
 * - no auto-like key present on the raw proposal object (never auto-adopt).
 *
 * Pure, offline. Never throws.
 */
export function assertProposalFromNotificationDisk(
  proposal: unknown,
  notification: unknown,
): F3ProposalCheck {
  const undecided: F3ProposalCheck = {
    ok: false,
    action: "undecided",
    proposalId: null,
    detail: "no verdict",
  };
  try {
    if (!isProposalReadyNotificationLike(notification)) {
      return { ...undecided, detail: `notification kind must be "${PROPOSAL_READY_KIND}"` };
    }
    const announced = extractProposalIdFromNotificationLike(notification);
    if (!announced) {
      return { ...undecided, detail: "no proposal id announced by the notification" };
    }
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
      return { ...undecided, proposalId: announced, detail: "proposal file missing" };
    }
    const record = proposal as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (id !== announced) {
      return {
        ...undecided,
        proposalId: announced,
        detail: `proposal id "${id.slice(0, 60)}" !== announced "${announced.slice(0, 60)}"`,
      };
    }
    const status = typeof record.status === "string" ? record.status : "";
    if (status !== "adopted" && status !== "discarded") {
      return {
        ...undecided,
        proposalId: announced,
        detail: `proposal status "${status || "?"}" is undecided (need adopted|discarded from the notification)`,
      };
    }
    const decidedAt = typeof record.decidedAt === "string" ? record.decidedAt : "";
    if (decidedAt.trim().length === 0) {
      return { ...undecided, action: status, proposalId: announced, detail: "decided proposal must carry decidedAt" };
    }
    for (const key of PROPOSAL_FORBIDDEN_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        return {
          ...undecided,
          action: status,
          proposalId: announced,
          detail: `field "${key}" is forbidden — proposals are decided by humans, never auto`,
        };
      }
    }
    return {
      ok: true,
      action: status,
      proposalId: announced,
      detail: `proposal ${announced} ${status} from the notification at ${decidedAt.slice(0, 40)}`,
    };
  } catch {
    return { ...undecided, detail: "proposal check failed defensively" };
  }
}

// ── 5. Disk bundle (what the live premieres read) ──

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

function readTextFileOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Reads one job dir plus the F3 sidecars into a loose bundle.
 * jobDir holds job.json (+ optional spec.md); decisionPath, proposalPath,
 * and notificationPath point at the benchmark decision sidecar, the
 * proposal file, and a single notification (or a notifications array file
 * from which the proposal-ready entry is picked). Every path is optional;
 * absent files yield nulls, never throws.
 */
export function readF3DiskBundle(paths: {
  jobDir: string;
  decisionPath?: string;
  proposalPath?: string;
  notificationPath?: string;
}): F3DiskBundle {
  const empty: F3DiskBundle = {
    jobDir: typeof paths?.jobDir === "string" ? paths.jobDir : "",
    job: null,
    jobRaw: null,
    specMd: null,
    decision: null,
    decisionRaw: null,
    proposal: null,
    proposalRaw: null,
    notification: null,
    timeline: [],
  };
  try {
    const jobDir = typeof paths?.jobDir === "string" ? paths.jobDir : "";
    if (jobDir.length === 0) return empty;
    const jobFile = readJsonFileOrNull(path.join(jobDir, "job.json"));
    const job =
      jobFile.value !== null && typeof jobFile.value === "object" && !Array.isArray(jobFile.value)
        ? (jobFile.value as F3JobLike)
        : null;
    const specMd = readTextFileOrNull(path.join(jobDir, "spec.md"));
    let decision: unknown = null;
    let decisionRaw: string | null = null;
    if (typeof paths?.decisionPath === "string" && paths.decisionPath.length > 0) {
      const loaded = readJsonFileOrNull(paths.decisionPath);
      decision = loaded.value;
      decisionRaw = loaded.raw;
    }
    let proposal: unknown = null;
    let proposalRaw: string | null = null;
    if (typeof paths?.proposalPath === "string" && paths.proposalPath.length > 0) {
      const loaded = readJsonFileOrNull(paths.proposalPath);
      proposal = loaded.value;
      proposalRaw = loaded.raw;
    }
    let notification: unknown = null;
    if (typeof paths?.notificationPath === "string" && paths.notificationPath.length > 0) {
      const loaded = readJsonFileOrNull(paths.notificationPath);
      notification = loaded.value;
      if (Array.isArray(notification)) {
        let picked: unknown = null;
        for (const entry of notification.slice(0, F3_MAX_TIMELINE_SCAN)) {
          if (isProposalReadyNotificationLike(entry)) {
            picked = entry;
            break;
          }
        }
        notification = picked;
      }
    }
    return {
      jobDir,
      job,
      jobRaw: jobFile.raw,
      specMd,
      decision,
      decisionRaw,
      proposal,
      proposalRaw,
      notification,
      timeline: timelineOf(job),
    };
  } catch {
    return empty;
  }
}

export interface F3MeasureVerdict {
  ok: boolean;
  spec: F3SpecCheck;
  decision: F3DecisionCheck;
  proposal: F3ProposalCheck;
  detail: string;
}

/**
 * Composite F3 measure verdict over a disk bundle.
 * The live premieres call this once per job; ok === true means the spec
 * chain (brief → approve → cite) plus the human benchmark decision plus
 * the proposal adopted/discarded from its notification all hold.
 * The implement cite is read from the job timeline meta when present
 * (live jobs persist it there), else from an explicit cite argument.
 * Offline fs for the file parts; the rest is pure. Never throws.
 */
export function assertF3MeasureDisk(
  bundle: F3DiskBundle,
  opts: { runId: string; jobId: string; cite?: unknown; approval?: unknown },
): F3MeasureVerdict {
  const fallback: F3MeasureVerdict = {
    ok: false,
    spec: { ok: false, detail: "no bundle" },
    decision: { ok: false, detail: "no bundle" },
    proposal: { ok: false, action: "undecided", proposalId: null, detail: "no bundle" },
    detail: "no bundle",
  };
  try {
    if (bundle === null || typeof bundle !== "object") return fallback;
    const runId = typeof opts?.runId === "string" ? opts.runId : "";
    const jobId = typeof opts?.jobId === "string" ? opts.jobId : "";
    let cite: unknown = opts?.cite ?? null;
    let approval: unknown = opts?.approval ?? null;
    if ((cite === null || approval === null) && bundle.job !== null) {
      for (const entry of bundle.timeline) {
        const meta =
          entry.meta !== null && typeof entry.meta === "object" && !Array.isArray(entry.meta)
            ? (entry.meta as Record<string, unknown>)
            : null;
        if (!meta) continue;
        if (cite === null) {
          const candidate = meta.specCite ?? meta.cite;
          if (candidate !== undefined) cite = candidate;
        }
        if (approval === null) {
          const candidate =
            meta.specApproval ?? meta.approval ?? (typeof meta.approvedBy === "string" ? meta : undefined);
          if (candidate !== undefined) approval = candidate;
        }
        if (cite !== null && approval !== null) break;
      }
    }
    const spec = assertSpecChain(bundle.specMd, approval, cite, jobId);
    const decision = assertBenchmarkDecisionDisk(bundle.decision, runId);
    const proposal = assertProposalFromNotificationDisk(bundle.proposal, bundle.notification);
    const ok = spec.ok && decision.ok && proposal.ok;
    const parts = [
      `spec:${spec.ok ? "ok" : "FAIL"}(${spec.detail.slice(0, 100)})`,
      `decision:${decision.ok ? "ok" : "FAIL"}(${decision.detail.slice(0, 100)})`,
      `proposal:${proposal.action}:${proposal.ok ? "ok" : "FAIL"}(${proposal.detail.slice(0, 100)})`,
    ];
    return { ok, spec, decision, proposal, detail: parts.join(" · ") };
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────
// Offline suite (synthetic fixtures, zero network, zero daemon)
// ─────────────────────────────────────────────────────────────

const TEST_TIMEOUT_MS = 30_000;
const DECIDED_AT = "2026-09-05T12:00:00.000Z";
const APPROVED_AT = "2026-09-05T12:30:00.000Z";

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

function makeDecision(runId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    benchmarkId: runId,
    decidedAt: DECIDED_AT,
    decidedBy: "human",
    change: "review model big-pickle -> gpt-4o for review role",
    costWeight: "weekly spend must stay flat",
    qualityWeight: "fewer major misses on requirements",
    trialsRef: `factory/.benchmark-results/${runId}.json`,
    note: "human weighed cost vs quality over 12 trials",
    ...overrides,
  };
}

function makeCite(jobId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId,
    specApprovedAt: APPROVED_AT,
    approvedBy: "human",
    implementCites: "implement follows approved brief section 2 (scope + criteria)",
    ...overrides,
  };
}

function makeApproval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { approvedBy: "human", specApprovedAt: APPROVED_AT, ...overrides };
}

function makeNotification(proposalId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "n-1000-1",
    kind: "proposal-ready",
    title: "Proposal ready for review",
    body: `proposal ${proposalId} from scorer "review-formato-valido" ready: skills/code-review/SKILL.md`,
    at: DECIDED_AT,
    acked: false,
    ...overrides,
  };
}

function makeProposal(proposalId: string, status: string): Record<string, unknown> {
  return {
    id: proposalId,
    scorer: "review-formato-valido",
    status,
    pattern: "missing context in review instructions",
    rationale: "adding the checklist fixes the recurrent miss",
    target: "skills/code-review/SKILL.md",
    newContent: "# skill\n",
    regressionsAddressed: ["job-abc123", "job-abc124"],
    createdAt: DECIDED_AT,
    ...(status === "adopted" || status === "discarded" ? { decidedAt: DECIDED_AT } : {}),
  };
}

const SPEC_MD =
  "# brief\n\nScope: harden the review checklist for format misses.\n" +
  "Criteria: every finding cites file plus line.\n";

test("spec chain: brief to approve to implement cite passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const jobId = "job-f3demo01";
  const result = assertSpecChain(SPEC_MD, makeApproval(), makeCite(jobId), jobId);
  assert.equal(result.ok, true, result.detail);
});

test("spec chain: auto approver rejected (never auto)", { timeout: TEST_TIMEOUT_MS }, () => {
  const jobId = "job-f3demo01";
  for (const approvedBy of ["auto", "system", "bot", "agent", "", null]) {
    const result = assertSpecChain(SPEC_MD, makeApproval({ approvedBy }), makeCite(jobId), jobId);
    assert.equal(result.ok, false, `approvedBy=${String(approvedBy)} must fail`);
    assert.match(result.detail, /human/i);
  }
  const missing = makeApproval();
  delete missing["approvedBy"];
  assert.equal(assertSpecChain(SPEC_MD, missing, makeCite(jobId), jobId).ok, false);
});

test("spec chain: blank brief, bad instant, and cite mismatch fail", { timeout: TEST_TIMEOUT_MS }, () => {
  const jobId = "job-f3demo01";
  assert.equal(assertSpecChain("  ", makeApproval(), makeCite(jobId), jobId).ok, false);
  assert.equal(assertSpecChain("short", makeApproval(), makeCite(jobId), jobId).ok, false);
  assert.equal(
    assertSpecChain(SPEC_MD, makeApproval({ specApprovedAt: "yesterday" }), makeCite(jobId), jobId).ok,
    false,
  );
  assert.equal(
    assertSpecChain(SPEC_MD, makeApproval(), makeCite(jobId, { specApprovedAt: DECIDED_AT }), jobId).ok,
    false,
  );
  assert.equal(
    assertSpecChain(SPEC_MD, makeApproval(), makeCite("job-other"), jobId).ok,
    false,
  );
  assert.equal(assertSpecChain(SPEC_MD, makeApproval(), makeCite(jobId), jobId).ok, true);
});

test("benchmark decision: human record linked to its run passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const runId = "bench-abc123";
  const result = assertBenchmarkDecisionDisk(makeDecision(runId), runId);
  assert.equal(result.ok, true, result.detail);
});

test("benchmark decision: auto, winner, and mislink rejected (no auto-winner)", {
  timeout: TEST_TIMEOUT_MS,
}, () => {
  const runId = "bench-abc123";
  assert.equal(assertBenchmarkDecisionDisk(makeDecision(runId, { decidedBy: "auto" }), runId).ok, false);
  for (const key of ["winner", "autoWinner", "winningConfig", "recommendation", "auto"]) {
    const result = assertBenchmarkDecisionDisk(makeDecision(runId, { [key]: "cfg-1" }), runId);
    assert.equal(result.ok, false, `${key} must fail`);
  }
  assert.equal(assertBenchmarkDecisionDisk(makeDecision("bench-other"), runId).ok, false);
  assert.equal(
    assertBenchmarkDecisionDisk(makeDecision(runId, { trialsRef: "factory/.benchmark-results/bench-other.json" }), runId).ok,
    false,
  );
  assert.equal(assertBenchmarkDecisionDisk(null, runId).ok, false);
  assert.equal(assertBenchmarkDecisionDisk(makeDecision(runId), "../evil").ok, false);
});

test("proposal: adopted from the notification passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const proposalId = "imp-abc-123";
  const result = assertProposalFromNotificationDisk(
    makeProposal(proposalId, "adopted"),
    makeNotification(proposalId),
  );
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.action, "adopted");
  assert.equal(result.proposalId, proposalId);
});

test("proposal: discarded from the notification passes", { timeout: TEST_TIMEOUT_MS }, () => {
  const proposalId = "imp-def-456";
  const result = assertProposalFromNotificationDisk(
    makeProposal(proposalId, "discarded"),
    makeNotification(proposalId),
  );
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.action, "discarded");
});

test("proposal: wrong kind, id mismatch, undecided, and auto fields fail", {
  timeout: TEST_TIMEOUT_MS,
}, () => {
  const proposalId = "imp-abc-123";
  assert.equal(
    assertProposalFromNotificationDisk(
      makeProposal(proposalId, "adopted"),
      makeNotification(proposalId, { kind: "benchmark-done" }),
    ).ok,
    false,
  );
  assert.equal(
    assertProposalFromNotificationDisk(
      makeProposal("imp-other-999", "adopted"),
      makeNotification(proposalId),
    ).ok,
    false,
  );
  for (const status of ["ready", "pending", "failed"]) {
    const result = assertProposalFromNotificationDisk(
      makeProposal(proposalId, status),
      makeNotification(proposalId),
    );
    assert.equal(result.ok, false, `status=${status} must be undecided`);
    assert.equal(result.action, "undecided");
  }
  const noDate = makeProposal(proposalId, "adopted");
  delete noDate["decidedAt"];
  assert.equal(assertProposalFromNotificationDisk(noDate, makeNotification(proposalId)).ok, false);
  assert.equal(
    assertProposalFromNotificationDisk(
      { ...makeProposal(proposalId, "adopted"), autoAdopt: true },
      makeNotification(proposalId),
    ).ok,
    false,
  );
  assert.equal(assertProposalFromNotificationDisk(null, makeNotification(proposalId)).ok, false);
});

test("extraction: explicit field, body scan, center id ignored, unsafe rejected", {
  timeout: TEST_TIMEOUT_MS,
}, () => {
  assert.equal(
    extractProposalIdFromNotificationLike({ kind: "proposal-ready", proposalId: "imp-explicit-1", body: "none" }),
    "imp-explicit-1",
  );
  assert.equal(
    extractProposalIdFromNotificationLike("proposal imp-body-9 ready"),
    "imp-body-9",
  );
  assert.equal(extractProposalIdFromNotificationLike({ kind: "proposal-ready", body: "nothing here" }), null);
  assert.equal(extractProposalIdFromNotificationLike({ kind: "proposal-ready", id: "n-1-2" }), null);
  assert.equal(extractProposalIdFromNotificationLike(null), null);
  assert.equal(isProposalReadyNotificationLike(makeNotification("imp-x-1")), true);
  assert.equal(isProposalReadyNotificationLike({ kind: "benchmark-done" }), false);
  assert.equal(isProposalReadyNotificationLike(null), false);
});

test("disk bundle: composite PASS on a full synthetic premiere", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f3-e2e-");
  try {
    const jobId = "job-f3demo01";
    const runId = "bench-abc123";
    const proposalId = "imp-abc-123";
    const jobDir = path.join(wt, ".agents", "factory", jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: jobId,
      status: "Complete",
      timeline: [
        { message: "spec-approval requested: brief ready", actor: "system", meta: makeApproval() },
        { message: "implement cites approved brief", actor: "system", meta: { specCite: makeCite(jobId) } },
      ],
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(path.join(jobDir, "spec.md"), SPEC_MD, "utf-8");
    const decisionPath = path.join(wt, `${runId}${BENCHMARK_DECISION_SUFFIX}`);
    fs.writeFileSync(decisionPath, JSON.stringify(makeDecision(runId), null, 2), "utf-8");
    const proposalPath = path.join(wt, `${proposalId}.json`);
    fs.writeFileSync(proposalPath, JSON.stringify(makeProposal(proposalId, "adopted"), null, 2), "utf-8");
    const notificationsPath = path.join(wt, ".notifications.json");
    fs.writeFileSync(notificationsPath, JSON.stringify([makeNotification(proposalId)], null, 2), "utf-8");
    const bundle = readF3DiskBundle({ jobDir, decisionPath, proposalPath, notificationPath: notificationsPath });
    assert.ok(bundle.job !== null);
    assert.ok(typeof bundle.specMd === "string" && bundle.specMd.includes("Scope"));
    const verdict = assertF3MeasureDisk(bundle, { runId, jobId });
    assert.equal(verdict.ok, true, verdict.detail);
    assert.equal(verdict.spec.ok, true);
    assert.equal(verdict.decision.ok, true);
    assert.equal(verdict.proposal.ok, true);
    assert.equal(verdict.proposal.action, "adopted");
  } finally {
    rmTmp(wt);
  }
});

test("disk bundle: composite FAILs honestly on a broken premiere", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f3-neg-");
  try {
    const jobDir = path.join(wt, ".agents", "factory", "job-f3bad01");
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, "job.json"),
      JSON.stringify({ id: "job-f3bad01", timeline: [] }, null, 2),
      "utf-8",
    );
    const bundle = readF3DiskBundle({ jobDir });
    const verdict = assertF3MeasureDisk(bundle, { runId: "bench-abc123", jobId: "job-f3bad01" });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.spec.ok, false);
    assert.equal(verdict.decision.ok, false);
    assert.equal(verdict.proposal.ok, false);
    const missing = readF3DiskBundle({ jobDir: path.join(wt, ".agents", "factory", "job-f3nope01") });
    assert.equal(missing.job, null);
  } finally {
    rmTmp(wt);
  }
});

test("engine link surface exists and exposes no auto path", { timeout: TEST_TIMEOUT_MS }, async () => {
  const bench = (await import(
    "../headless-runtime/measure/benchmarkEngine.ts"
  )) as Record<string, unknown>;
  const improve = (await import(
    "../headless-runtime/measure/improvementEngine.ts"
  )) as Record<string, unknown>;
  for (const name of ["recordBenchmarkDecision", "tryRecordBenchmarkDecision", "readBenchmarkDecision", "hasBenchmarkDecision"]) {
    assert.equal(typeof bench[name], "function", `benchmarkEngine.${name} must exist`);
  }
  for (const name of [
    "extractProposalIdFromNotification",
    "isProposalReadyNotification",
    "adoptProposalFromNotification",
    "discardProposalFromNotification",
  ]) {
    assert.equal(typeof improve[name], "function", `improvementEngine.${name} must exist`);
  }
  for (const mod of [bench, improve]) {
    const names = Object.keys(mod).map((key) => key.toLowerCase());
    assert.ok(!names.some((name) => name.includes("autowinner") || name === "winner"));
    assert.ok(!names.some((name) => name.includes("autoadopt")));
    assert.ok(!names.some((name) => name.includes("pickwinner")));
  }
});
