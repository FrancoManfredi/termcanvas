/**
 * F5-T3 — E2E F5 verify-teeth disk-assert helpers (offline unit part).
 *
 * Plan: software-paridad-100/PLAN-100-PARIDAD.md §F5 + §4.5 + §0.
 * Scope-freeze: this file ([N]) plus the F5-T1 live E2E-05 premiere are the
 * teeth deliverable. No changes to runner/verification here (read-only
 * imports of their pure helpers; fixes H-012/H-013 already landed with
 * suites empty-folder-fallback 8/8 + verify-retry-reconcile 7/7).
 *
 * What this file is:
 * - Pure offline late-write reconcile matrix over the production helpers
 *   (resultStore.resolveVerifyRetryCreatedFiles / discoverLateCreatedFiles /
 *   reconcileCreatedFiles + verification.detectCreatedFilesAnomaly), proving
 *   the exact contract the live late-write case relies on.
 * - Exported disk-bundle asserts reused by the F5-T1 live run (Playwright
 *   MCP reads job.json / result.json / verify.json / timeline from disk and
 *   calls assertF5TeethDisk; screenshot stays attachment).
 * - An offline `node:test` suite proving helpers + matrix on synthetic
 *   fixtures (tmp dirs under os.tmpdir, zero network, zero daemon, zero
 *   LLM, zero timers).
 *
 * Covers (plan §4.5 + H-012/H-013):
 * - late-write reconcile: empty-folder fail (H-012) + file landing ~2s
 *   later reconciled BEFORE persist (kept in result+verify+transition with
 *   the reconciledLateFiles note, H-013).
 * - exact-equality createdFiles: every entry is a real file in the
 *   worktree; [] on a Complete delivery is the H-013 ghost (FAIL).
 * - no invention: vague prompts and missing paths discover nothing.
 * - no duplicates: already-declared files are kept, never re-added.
 *
 * Contracts (binding, §0):
 * - ESM only, zero network, zero polling, zero timers.
 * - Every iteration is bounded by an explicit cap (no open-ended loops).
 * - Every test declares an explicit timeout.
 *
 * Live reuse example:
 *   import {
 *     readF5DiskBundle, assertF5TeethDisk,
 *   } from "./tests/e2e-f5-teeth.asserts.ts";
 *   const bundle = readF5DiskBundle(jobDir);
 *   const verdict = assertF5TeethDisk(bundle, { worktree, expectedRelPath, lateWriteExpected: true });
 *
 * Offline run (explicit timeout, PowerShell):
 *   npx tsx --test tests/e2e-f5-teeth.asserts.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverLateCreatedFiles,
  reconcileCreatedFiles,
  resolveVerifyRetryCreatedFiles,
} from "../headless-runtime/workItem/resultStore.ts";
import { detectCreatedFilesAnomaly } from "../headless-runtime/implement/verification.ts";

// ── Exact markers (mirrors of the daemon sources, read-only copies) ──

/** Timeline meta key carrying late-reconciled files (mirror of verifyService runVerifyRetryWorker). */
export const RECONCILED_LATE_FILES_KEY = "reconciledLateFiles";

/** Timeline message of the retry transition Triage → Review (mirror of the worker). */
export const VERIFY_RETRY_TO_REVIEW_MARK = "verify-retry pass → Review";

/** Anomaly tag for the empty-folder fail (mirror of verification H-012 branch). */
export const H012_ANOMALY_MARK = "H-012";

/** Caps: every loop in this file is bounded by one of these. */
export const F5_MAX_TIMELINE_SCAN = 500;
export const F5_MAX_CREATED_FILES = 50;
export const F5_MAX_TOPLEVEL_SCAN = 100;
export const F5_MAX_NOTE_FILES = 10;

// ── Loose disk shapes (restore-tolerant: every field optional) ──

export interface F5TimelineEntryLike {
  message?: unknown;
  actor?: unknown;
  meta?: unknown;
  at?: unknown;
  from?: unknown;
  to?: unknown;
}

export interface F5JobLike {
  status?: unknown;
  createdFiles?: unknown;
  timeline?: unknown;
}

export interface F5ResultLike {
  createdFiles?: unknown;
  verification?: unknown;
}

export interface F5VerifyLike {
  createdFiles?: unknown;
  verification?: unknown;
}

export interface F5DiskBundle {
  jobDir: string;
  job: F5JobLike | null;
  jobRaw: string | null;
  result: F5ResultLike | null;
  resultRaw: string | null;
  verify: F5VerifyLike | null;
  verifyRaw: string | null;
  timeline: F5TimelineEntryLike[];
}

// ── Small pure helpers ──

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timelineOf(job: F5JobLike | null): F5TimelineEntryLike[] {
  if (job === null) return [];
  const raw = (job as { timeline?: unknown }).timeline;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, F5_MAX_TIMELINE_SCAN).filter(
    (e): e is F5TimelineEntryLike => !!e && typeof e === "object",
  );
}

function messageOf(entry: F5TimelineEntryLike): string {
  return asString(entry.message);
}

function metaOf(entry: F5TimelineEntryLike): Record<string, unknown> {
  if (entry.meta !== null && typeof entry.meta === "object" && !Array.isArray(entry.meta)) {
    return entry.meta as Record<string, unknown>;
  }
  return {};
}

function createdFilesOf(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as Record<string, unknown>).createdFiles;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").slice(0, F5_MAX_CREATED_FILES);
}

function fileInWorktree(worktree: string, rel: string): boolean {
  try {
    const root = path.resolve(worktree);
    const target = path.resolve(root, rel);
    const relCheck = path.relative(root, target);
    if (relCheck === "" || relCheck === ".." || relCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relCheck)) {
      return false;
    }
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

// ── 1. Live markers (what the F5-T1 run greps on disk) ──

/**
 * True when any timeline entry meta carries a non-empty reconciledLateFiles
 * array (the worker note written only when the retry actually reconciled
 * late files). Pure, offline, bounded. Never throws.
 */
export function hasReconciledLateFilesNote(timeline: unknown): { ok: boolean; files: string[] } {
  try {
    const entries = (Array.isArray(timeline) ? timeline : []).slice(0, F5_MAX_TIMELINE_SCAN);
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const meta = metaOf(raw as F5TimelineEntryLike);
      const note = meta[RECONCILED_LATE_FILES_KEY];
      if (Array.isArray(note)) {
        const files = note.filter((x): x is string => typeof x === "string").slice(0, F5_MAX_NOTE_FILES);
        if (files.length > 0) return { ok: true, files };
      }
    }
    return { ok: false, files: [] };
  } catch {
    return { ok: false, files: [] };
  }
}

/**
 * True when the timeline holds the retry transition Triage → Review.
 * Pure, offline, bounded. Never throws.
 */
export function hasVerifyRetryTransition(timeline: unknown): boolean {
  try {
    const entries = (Array.isArray(timeline) ? timeline : []).slice(0, F5_MAX_TIMELINE_SCAN);
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      if (messageOf(raw as F5TimelineEntryLike).includes(VERIFY_RETRY_TO_REVIEW_MARK)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── 2. Disk bundle (what the live run reads) ──

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

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Read one job dir ({worktree}/.agents/factory/{id}/) into a loose bundle.
 * Reads job.json (required) + result.json + verify.json (optional).
 * Never throws.
 */
export function readF5DiskBundle(jobDir: string): F5DiskBundle {
  const empty: F5DiskBundle = {
    jobDir,
    job: null,
    jobRaw: null,
    result: null,
    resultRaw: null,
    verify: null,
    verifyRaw: null,
    timeline: [],
  };
  try {
    if (typeof jobDir !== "string" || jobDir.length === 0) return empty;
    const jobFile = readJsonFileOrNull(path.join(jobDir, "job.json"));
    const resultFile = readJsonFileOrNull(path.join(jobDir, "result.json"));
    const verifyFile = readJsonFileOrNull(path.join(jobDir, "verify.json"));
    const job = asRecordOrNull(jobFile.value) as F5JobLike | null;
    return {
      jobDir,
      job,
      jobRaw: jobFile.raw,
      result: asRecordOrNull(resultFile.value) as F5ResultLike | null,
      resultRaw: resultFile.raw,
      verify: asRecordOrNull(verifyFile.value) as F5VerifyLike | null,
      verifyRaw: verifyFile.raw,
      timeline: timelineOf(job),
    };
  } catch {
    return empty;
  }
}

function verificationOverall(value: unknown): string {
  const rec = asRecordOrNull(value);
  const verification = rec !== null ? asRecordOrNull(rec.verification) : null;
  const overall = verification !== null ? verification.overall : null;
  return typeof overall === "string" ? overall : "";
}

export interface F5TeethVerdict {
  ok: boolean;
  exactEquality: boolean;
  fileExact: boolean;
  retryTransition: boolean;
  lateNote: boolean;
  ghost: boolean;
  literalSuspects: string[];
  verifyPass: boolean;
  detail: string;
}

/**
 * Composite F5 teeth verdict over a disk bundle plus the live worktree.
 * The F5-T1 live run calls this once per E2E-05 job; ok === true means:
 * exact-equality createdFiles (every entry a real file; empty on a
 * terminal delivery is the H-013 ghost), the expected file byte-exact,
 * the retry transition present, the reconciledLateFiles note present
 * exactly when lateWriteExpected, zero literal-folder suspects, and
 * verify.json overall === "pass".
 * Offline fs for the file parts; the rest is pure. Never throws.
 */
export function assertF5TeethDisk(
  bundle: F5DiskBundle,
  opts: { worktree: string; expectedRelPath: string; lateWriteExpected: boolean },
): F5TeethVerdict {
  const fallback: F5TeethVerdict = {
    ok: false,
    exactEquality: false,
    fileExact: false,
    retryTransition: false,
    lateNote: false,
    ghost: false,
    literalSuspects: [],
    verifyPass: false,
    detail: "no bundle",
  };
  try {
    if (bundle === null || typeof bundle !== "object") return fallback;
    const job = bundle.job;
    if (job === null) return { ...fallback, detail: "job.json absent or invalid" };
    const worktree = typeof opts.worktree === "string" ? opts.worktree : "";
    const expectedRel = typeof opts.expectedRelPath === "string" ? opts.expectedRelPath : "";
    const created = createdFilesOf(job);
    const status = asString((job as { status?: unknown }).status);
    const terminal = status === "Complete" || status === "Review";
    const ghost = terminal && created.length === 0;
    let exactEquality = created.length > 0;
    if (exactEquality) {
      for (const rel of created) {
        if (typeof rel !== "string" || rel.trim().length === 0 || !fileInWorktree(worktree, rel)) {
          exactEquality = false;
          break;
        }
      }
    }
    let fileExact = false;
    try {
      if (worktree.length > 0 && expectedRel.length > 0) {
        const root = path.resolve(worktree);
        const target = path.resolve(root, expectedRel);
        const relCheck = path.relative(root, target);
        if (!(relCheck === "" || relCheck === ".." || relCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relCheck))) {
          fileExact = fs.statSync(target).isFile();
        }
      }
    } catch {
      fileExact = false;
    }
    const timeline = bundle.timeline;
    const retryTransition = hasVerifyRetryTransition(timeline);
    const note = hasReconciledLateFilesNote(timeline);
    const lateNote = opts.lateWriteExpected ? note.ok : true;
    const literalSuspects = findLiteralFolderSuspects(worktree);
    const verifyPass = verificationOverall(bundle.verify) === "pass";
    const ok =
      exactEquality && fileExact && retryTransition && lateNote &&
      !ghost && literalSuspects.length === 0 && verifyPass;
    const parts = [
      `createdFiles:${created.length}:${exactEquality ? "ok" : "FAIL"}`,
      `file:${expectedRel}:${fileExact ? "ok" : "FAIL"}`,
      `retry:${retryTransition ? "ok" : "FAIL"}`,
      `lateNote:${opts.lateWriteExpected ? (note.ok ? `ok(${note.files.slice(0, 3).join("|")})` : "FAIL") : "n/a-ok"}`,
      `ghost:${ghost ? "FAIL" : "none-ok"}`,
      `literals:${literalSuspects.length === 0 ? "none-ok" : `FAIL(${literalSuspects.slice(0, 3).join("|")})`}`,
      `verify:${verifyPass ? "pass-ok" : "FAIL"}`,
    ];
    return {
      ok,
      exactEquality,
      fileExact,
      retryTransition,
      lateNote,
      ghost,
      literalSuspects,
      verifyPass,
      detail: parts.join(" · "),
    };
  } catch {
    return fallback;
  }
}

/**
 * H-001 double-write guard: top-level scan (bounded) reporting directories
 * whose name looks like prompt text (contains a space) and is empty.
 * Offline fs only. Never throws.
 */
export function findLiteralFolderSuspects(worktree: string): string[] {
  const out: string[] = [];
  try {
    if (typeof worktree !== "string" || worktree.length === 0) return out;
    const root = path.resolve(worktree);
    let names: string[] = [];
    try {
      names = fs.readdirSync(root).slice(0, F5_MAX_TOPLEVEL_SCAN);
    } catch {
      return out;
    }
    for (const name of names.slice(0, F5_MAX_TOPLEVEL_SCAN)) {
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

// ─────────────────────────────────────────────────────────────
// Offline suite: late-write reconcile matrix (synthetic fixtures)
// ─────────────────────────────────────────────────────────────

const TEST_TIMEOUT_MS = 30_000;

const PROMPT_FOLDER_FILE =
  "Creá la carpeta lab5-teeth con un archivo leeme.txt que explique en 2 líneas para qué sirve la carpeta";
const EXPECTED_REL = "lab5-teeth/leeme.txt";
const EXPECTED_CONTENT = "notas del lab\n";

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

function writeLateFile(wt: string): void {
  fs.mkdirSync(path.join(wt, "lab5-teeth"), { recursive: true });
  fs.writeFileSync(path.join(wt, "lab5-teeth", "leeme.txt"), EXPECTED_CONTENT, "utf-8");
}

test("matrix M1: late-write between fail and retry is discovered (H-013 core)", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-m1-");
  try {
    // Fail-time disk: exact folder, file absent (H-012 shape) → nothing to track.
    fs.mkdirSync(path.join(wt, "lab5-teeth"), { recursive: true });
    assert.deepEqual(discoverLateCreatedFiles(wt, PROMPT_FOLDER_FILE, []), []);
    // Async session lands ~2s later (job-mtngz1t6-6vob shape).
    writeLateFile(wt);
    const found = discoverLateCreatedFiles(wt, PROMPT_FOLDER_FILE, []);
    assert.ok(found.includes(EXPECTED_REL), `late file must be found, got: ${JSON.stringify(found)}`);
    const resolved = resolveVerifyRetryCreatedFiles([], wt, PROMPT_FOLDER_FILE);
    assert.ok(resolved.kept.includes(EXPECTED_REL), `kept must hold the late file: ${JSON.stringify(resolved)}`);
    assert.ok(resolved.added.includes(EXPECTED_REL), `added must cite the late file: ${JSON.stringify(resolved)}`);
    assert.deepEqual(resolved.dropped, []);
  } finally {
    rmTmp(wt);
  }
});

test("matrix M2: still-empty retry reconciles nothing and stays H-012 fail", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-m2-");
  try {
    fs.mkdirSync(path.join(wt, "lab5-teeth"), { recursive: true });
    assert.deepEqual(discoverLateCreatedFiles(wt, PROMPT_FOLDER_FILE, []), []);
    const resolved = resolveVerifyRetryCreatedFiles([], wt, PROMPT_FOLDER_FILE);
    assert.deepEqual(resolved.kept, []);
    assert.deepEqual(resolved.added, []);
    const anomaly = detectCreatedFilesAnomaly(wt, PROMPT_FOLDER_FILE, []);
    assert.ok(
      anomaly !== null && anomaly.includes(H012_ANOMALY_MARK),
      `empty must stay H-012 fail, got: ${String(anomaly)}`,
    );
  } finally {
    rmTmp(wt);
  }
});

test("matrix M3: on-time declared file is kept once, never re-added", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-m3-");
  try {
    writeLateFile(wt);
    const resolved = resolveVerifyRetryCreatedFiles([EXPECTED_REL], wt, PROMPT_FOLDER_FILE);
    assert.deepEqual(resolved.kept.filter((f) => f === EXPECTED_REL).length, 1);
    assert.deepEqual(resolved.added, [], "already declared is not late");
  } finally {
    rmTmp(wt);
  }
});

test("matrix M4: no invention without a clear requested path", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-m4-");
  try {
    fs.writeFileSync(path.join(wt, "suelto.txt"), "x\n", "utf-8");
    assert.deepEqual(
      discoverLateCreatedFiles(wt, "Mejorá algo del proyecto donde veas oportunidad", []),
      [],
    );
    assert.deepEqual(discoverLateCreatedFiles(wt, PROMPT_FOLDER_FILE, []), []);
    assert.deepEqual(discoverLateCreatedFiles(wt, null, []), []);
    assert.deepEqual(discoverLateCreatedFiles(wt, "", []), []);
    assert.deepEqual(resolveVerifyRetryCreatedFiles(null, wt, PROMPT_FOLDER_FILE).kept, []);
  } finally {
    rmTmp(wt);
  }
});

test("matrix M5: prompt-aware reconcile drops the empty placeholder (H-012), legacy intact", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-m5-");
  try {
    fs.mkdirSync(path.join(wt, "lab5-teeth"), { recursive: true });
    const withPrompt = reconcileCreatedFiles(["lab5-teeth"], wt, PROMPT_FOLDER_FILE);
    assert.deepEqual(withPrompt.kept, [], "empty folder without the file counts zero");
    assert.ok(withPrompt.dropped.includes("lab5-teeth"), "empty folder goes to dropped with evidence");
    const legacy = reconcileCreatedFiles(["lab5-teeth"], wt);
    assert.deepEqual(legacy.kept, ["lab5-teeth"], "no-prompt behavior unchanged");
  } finally {
    rmTmp(wt);
  }
});

test("bundle PASS: late-write chain (fail → late → retry → Review) tracks the file", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-pass-");
  try {
    writeLateFile(wt);
    const jobDir = path.join(wt, ".agents", "factory", "job-f5teeth01");
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: "job-f5teeth01",
      status: "Complete",
      createdFiles: [EXPECTED_REL],
      timeline: [
        { message: "verification failed (H-012)", actor: "runner" },
        {
          message: "verify-retry pass → Review (re-verificación desde Triage)",
          actor: "runner",
          meta: { reconciledLateFiles: [EXPECTED_REL] },
        },
        { message: "review accept intento 1: entrega con archivo trackeado", actor: "system" },
      ],
    };
    const verification = {
      steps: [{ name: "test", command: "pnpm test", exitCode: 0, durationMs: 1, status: "pass", logPath: "logs/build.log" }],
      overall: "pass",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(
      path.join(jobDir, "result.json"),
      JSON.stringify({ createdFiles: [EXPECTED_REL], verification }, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(jobDir, "verify.json"),
      JSON.stringify({ workItemId: "job-f5teeth01", verification, createdFiles: [EXPECTED_REL] }, null, 2),
      "utf-8",
    );
    const bundle = readF5DiskBundle(jobDir);
    assert.ok(bundle.job !== null);
    assert.equal(hasVerifyRetryTransition(bundle.timeline), true);
    assert.equal(hasReconciledLateFilesNote(bundle.timeline).ok, true);
    const verdict = assertF5TeethDisk(bundle, {
      worktree: wt,
      expectedRelPath: EXPECTED_REL,
      lateWriteExpected: true,
    });
    assert.equal(verdict.ok, true, verdict.detail);
  } finally {
    rmTmp(wt);
  }
});

test("bundle FAIL: ghost Complete (H-013) and missing late note", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-ghost-");
  try {
    writeLateFile(wt);
    const jobDir = path.join(wt, ".agents", "factory", "job-f5ghost01");
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: "job-f5ghost01",
      status: "Complete",
      createdFiles: [],
      timeline: [
        { message: "verify-retry pass → Review (re-verificación desde Triage)", actor: "runner" },
        { message: "review accept intento 1: ok", actor: "system" },
      ],
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(
      path.join(jobDir, "verify.json"),
      JSON.stringify({ workItemId: "job-f5ghost01", verification: { overall: "pass", steps: [] }, createdFiles: [] }, null, 2),
      "utf-8",
    );
    const bundle = readF5DiskBundle(jobDir);
    const verdict = assertF5TeethDisk(bundle, {
      worktree: wt,
      expectedRelPath: EXPECTED_REL,
      lateWriteExpected: true,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ghost, true, "empty createdFiles on terminal delivery is the ghost");
    assert.equal(verdict.lateNote, false, "late write without the note fails");
  } finally {
    rmTmp(wt);
  }
});

test("bundle FAIL: literal folder suspect (H-001) and failing verify", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-lit-");
  try {
    writeLateFile(wt);
    fs.mkdirSync(path.join(wt, "lab5-teeth con un archivo leemetxt"), { recursive: true });
    const jobDir = path.join(wt, ".agents", "factory", "job-f5lit01");
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: "job-f5lit01",
      status: "Review",
      createdFiles: ["lab5-teeth con un archivo leemetxt"],
      timeline: [{ message: "verify-retry pass → Review (re-verificación desde Triage)", actor: "runner" }],
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(
      path.join(jobDir, "verify.json"),
      JSON.stringify({ workItemId: "job-f5lit01", verification: { overall: "fail", steps: [] }, createdFiles: [] }, null, 2),
      "utf-8",
    );
    const bundle = readF5DiskBundle(jobDir);
    const verdict = assertF5TeethDisk(bundle, {
      worktree: wt,
      expectedRelPath: EXPECTED_REL,
      lateWriteExpected: false,
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.literalSuspects.includes("lab5-teeth con un archivo leemetxt"));
    assert.equal(verdict.verifyPass, false);
    const missing = readF5DiskBundle(path.join(wt, ".agents", "factory", "job-f5nope01"));
    assert.equal(missing.job, null);
  } finally {
    rmTmp(wt);
  }
});

test("bundle on-time: no late note required when nothing landed late", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = mkTmp("f5-ontime-");
  try {
    writeLateFile(wt);
    const jobDir = path.join(wt, ".agents", "factory", "job-f5ontime01");
    fs.mkdirSync(jobDir, { recursive: true });
    const job = {
      id: "job-f5ontime01",
      status: "Complete",
      createdFiles: [EXPECTED_REL],
      timeline: [
        { message: "verification passed → Review", actor: "runner" },
        { message: "review accept intento 1: ok", actor: "system" },
      ],
    };
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(
      path.join(jobDir, "verify.json"),
      JSON.stringify({ workItemId: "job-f5ontime01", verification: { overall: "pass", steps: [] }, createdFiles: [EXPECTED_REL] }, null, 2),
      "utf-8",
    );
    const bundle = readF5DiskBundle(jobDir);
    assert.equal(hasVerifyRetryTransition(bundle.timeline), false);
    const verdict = assertF5TeethDisk(bundle, {
      worktree: wt,
      expectedRelPath: EXPECTED_REL,
      lateWriteExpected: false,
    });
    // No retry transition in this synthetic on-time bundle: the live E2E-05
    // case always goes through verify-retry, so this stays FAIL here while
    // lateNote itself passes (nothing late → no note required).
    assert.equal(verdict.lateNote, true);
    assert.equal(verdict.retryTransition, false);
    assert.equal(verdict.ok, false);
  } finally {
    rmTmp(wt);
  }
});
