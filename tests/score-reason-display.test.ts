/**
 * F4-T2 — score reason display-only trace (offline, zero network).
 *
 * Covers (PLAN-100 PARIDAD section 4.4, F4-T2):
 * - ScoreReason schema: the 5 additive values parse; missing input defaults
 *   to "unscored-legacy"; unknown values are rejected.
 * - Backward compatibility: pre-F4 ScoreResult entries without scoreReason
 *   still validate and resolve to "unscored-legacy" in memory.
 * - scoreReasonDisplay: "sampled-out (25%)" vs "judge-down" vs
 *   "not-applicable" strings (plus honest "unscored-legacy" fallback).
 * - scoreReasonForOutcome: sampled-out (skippedBySampling) vs judge-down
 *   (plain unscored) vs not-applicable vs scored, display-only.
 * - Live engine paths: a fresh judged score persists scoreReason "scored";
 *   sampled-out / judge-down / not-applicable persist NOTHING.
 * - Display-only history rule (P1.7 intact): raw scores.json bytes are
 *   unchanged after readScores + threshold recompute + reason rollout;
 *   legacy entries read as "unscored-legacy" in memory only.
 *
 * Offline: judge via injected mock, jobs in real tmpdirs, never touches
 * factory/ or productive jobs. Every test declares an explicit timeout.
 * ESM, no CommonJS calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ScoreReasonSchema,
  ScoreReasonValueSchema,
  ScoreResultSchema,
  isScoreReason,
  resolveScoreReason,
  scoreReasonDisplay,
} from "../shared/types/scorer.ts";
import { shouldSampleJob } from "../headless-runtime/measure/sampler.ts";
import {
  SCORES_JSON_FILE,
  getScoresSummary,
  isNotApplicable,
  isUnscored,
  readScores,
  scoreJob,
  scoreReasonForOutcome,
  setScorerPromptMock,
} from "../headless-runtime/measure/scorerEngine.ts";
import { resetScorerCache } from "../headless-runtime/measure/scorerLoader.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

const IMPL_SCORER = "implement-scope-1-3";
const IMPL_PASS_LABEL = "en-scope";

const trackedJobs: Array<{ id: string; dir: string }> = [];
let jobSeq = 0;

function nextJobId(prefix: string): string {
  jobSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${jobSeq}`.toLowerCase().replace(/[^a-z0-9-]/g, "x");
}

function makeJobWithId(id: string, prompt = "trace job for score reason"): string {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "reason-job-"));
  workItemStore.create({ id, prompt: `${prompt} ${id}`, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  return id;
}

function jobDir(id: string): string {
  const wi = workItemStore.get(id);
  const dir = wi?.dir as string | null | undefined;
  assert.ok(typeof dir === "string" && dir.length > 0, `job ${id} must have a dir`);
  return dir as string;
}

function addEvidence(
  id: string,
  createdFiles: string[] = ["src/a.ts"],
  overall: "pass" | "fail" = "pass",
): void {
  const now = new Date().toISOString();
  workItemStore.appendEvent(id, "runner", `verification ${overall}`, {
    verification: {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: overall === "pass" ? 0 : 1,
          durationMs: 5,
          status: overall === "pass" ? "pass" : "fail",
          logPath: "logs/build.log",
        },
      ],
      overall,
      startedAt: now,
      finishedAt: now,
      durationMs: 5,
    },
    createdFiles,
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
}

/** Find a deterministic sampling-OUT id for rate 25 (bounded search). */
function findSampledOutId(): string {
  for (let i = 0; i < 500; i++) {
    const candidate = `job-f4-sample-out-${i}`;
    if (!shouldSampleJob(candidate, 25)) return candidate;
  }
  throw new Error("no sampled-out id found in 500 tries (sampler drift?)");
}

test.after(() => {
  try {
    setScorerPromptMock(null);
  } catch {}
  try {
    resetScorerCache();
  } catch {}
  for (const { id, dir } of trackedJobs) {
    try {
      workItemStore.delete(id);
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  trackedJobs.length = 0;
});

// ── Schema: additive enum ──

test("ScoreReasonSchema: 5 additive values parse, missing defaults to unscored-legacy", { timeout: 15000 }, () => {
  for (const v of ["scored", "sampled-out", "judge-down", "not-applicable", "unscored-legacy"]) {
    assert.equal(ScoreReasonValueSchema.safeParse(v).success, true, `${v} must parse`);
    assert.equal(isScoreReason(v), true);
  }
  assert.equal(ScoreReasonValueSchema.safeParse("bogus").success, false);
  assert.equal(isScoreReason("bogus"), false);
  assert.equal(isScoreReason(undefined), false);
  assert.equal(ScoreReasonSchema.parse(undefined), "unscored-legacy");
});

test("ScoreResultSchema: legacy entry without scoreReason still validates; resolve is unscored-legacy", { timeout: 15000 }, () => {
  const legacy = {
    scorer: IMPL_SCORER,
    workItemId: "job-f4-legacy-x1",
    label: IMPL_PASS_LABEL,
    score: 1,
    passing: true,
    reason: "cited evidence",
    model: "prov/model",
    origin: "sampled",
    at: new Date().toISOString(),
  };
  assert.equal(ScoreResultSchema.safeParse(legacy).success, true, "old entries must keep validating");
  assert.equal(resolveScoreReason((legacy as Record<string, unknown>).scoreReason), "unscored-legacy");
  const fresh = { ...legacy, scoreReason: "scored" };
  assert.equal(ScoreResultSchema.safeParse(fresh).success, true);
  assert.equal(ScoreResultSchema.safeParse({ ...legacy, scoreReason: "bogus" }).success, false);
});

// ── Display strings ──

test("scoreReasonDisplay: sampled-out (25%) vs judge-down vs not-applicable", { timeout: 15000 }, () => {
  assert.equal(scoreReasonDisplay("sampled-out", { samplingRate: 25 }), "sampled-out (25%)");
  assert.equal(scoreReasonDisplay("sampled-out"), "sampled-out (25%)");
  assert.equal(scoreReasonDisplay("judge-down"), "judge-down");
  assert.equal(scoreReasonDisplay("not-applicable"), "not-applicable");
  assert.equal(scoreReasonDisplay("scored"), "scored");
  assert.equal(scoreReasonDisplay(undefined), "unscored-legacy");
  assert.equal(scoreReasonDisplay("bogus"), "unscored-legacy");
});

test("scoreReasonForOutcome: maps the engine union without touching disk", { timeout: 15000 }, () => {
  assert.equal(
    scoreReasonForOutcome({ unscored: true, reason: "x", scorer: "s", workItemId: "job-f4-x", skippedBySampling: true }),
    "sampled-out",
  );
  assert.equal(
    scoreReasonForOutcome({ unscored: true, reason: "judge fell", scorer: "s", workItemId: "job-f4-x" }),
    "judge-down",
  );
  assert.equal(
    scoreReasonForOutcome({
      unscored: true,
      notApplicable: true,
      status: "not-applicable",
      requiredStages: ["implement"],
      reason: "needs stage",
      scorer: "s",
      workItemId: "job-f4-x",
    }),
    "not-applicable",
  );
  assert.equal(
    scoreReasonForOutcome({
      scorer: IMPL_SCORER,
      workItemId: "job-f4-x",
      label: IMPL_PASS_LABEL,
      score: 1,
      passing: true,
      reason: "r",
      model: "prov/model",
      origin: "manual",
      at: new Date().toISOString(),
      scoreReason: "scored",
    }),
    "scored",
  );
  assert.equal(
    scoreReasonForOutcome({
      scorer: IMPL_SCORER,
      workItemId: "job-f4-x",
      label: IMPL_PASS_LABEL,
      score: 1,
      passing: true,
      reason: "r",
      model: "prov/model",
      origin: "sampled",
      at: new Date().toISOString(),
    }),
    "unscored-legacy",
  );
});

// ── Live engine: scored persists reason ──

test("engine persists scoreReason scored on a fresh judged score", { timeout: 30000 }, async () => {
  const id = makeJobWithId(nextJobId("job-f4-scored"));
  addEvidence(id, ["src/a.ts"], "pass");
  setScorerPromptMock(async () => JSON.stringify({ label: IMPL_PASS_LABEL, reason: "one file touched, justified" }));
  try {
    const outcome = await scoreJob(id, IMPL_SCORER, { manual: true });
    assert.equal(isUnscored(outcome), false, "mock judge must score");
    assert.equal(isNotApplicable(outcome), false);
    if (!isUnscored(outcome)) {
      assert.equal(outcome.scoreReason, "scored");
      assert.equal(scoreReasonForOutcome(outcome), "scored");
    }
    const mem = readScores(id)[IMPL_SCORER];
    assert.ok(mem, "score must be readable");
    assert.equal(mem?.scoreReason, "scored");
    const raw = JSON.parse(fs.readFileSync(path.join(jobDir(id), SCORES_JSON_FILE), "utf-8")) as Record<
      string,
      { scoreReason?: unknown }
    >;
    assert.equal(raw[IMPL_SCORER]?.scoreReason, "scored", "new entries carry the reason on disk");
  } finally {
    setScorerPromptMock(null);
  }
});

// ── Live engine: the three absent paths persist nothing ──

test("sampled-out: eligible OUT job skips the judge and persists nothing", { timeout: 30000 }, async () => {
  const wanted = findSampledOutId();
  const id = makeJobWithId(wanted);
  addEvidence(id, ["src/a.ts"], "pass");
  setScorerPromptMock(async () => {
    throw new Error("must not call the judge when sampled-out");
  });
  try {
    const outcome = await scoreJob(id, IMPL_SCORER);
    assert.equal(isUnscored(outcome), true);
    assert.equal(isNotApplicable(outcome), false);
    if (isUnscored(outcome) && !isNotApplicable(outcome)) {
      assert.equal(outcome.skippedBySampling, true);
    }
    assert.equal(scoreReasonForOutcome(outcome), "sampled-out");
    assert.equal(
      scoreReasonDisplay(scoreReasonForOutcome(outcome), { samplingRate: 25 }),
      "sampled-out (25%)",
    );
    assert.deepEqual(readScores(id), {}, "sampled-out persists nothing");
    assert.equal(fs.existsSync(path.join(jobDir(id), SCORES_JSON_FILE)), false);
  } finally {
    setScorerPromptMock(null);
  }
});

test("judge-down: judge failure is unscored, visible, and persists nothing", { timeout: 30000 }, async () => {
  const id = makeJobWithId(nextJobId("job-f4-judgedown"));
  addEvidence(id, ["src/a.ts"], "pass");
  setScorerPromptMock(async () => null);
  try {
    const outcome = await scoreJob(id, IMPL_SCORER, { manual: true });
    assert.equal(isUnscored(outcome), true);
    assert.equal(isNotApplicable(outcome), false);
    if (isUnscored(outcome) && !isNotApplicable(outcome)) {
      assert.equal(outcome.skippedBySampling, undefined);
    }
    assert.equal(scoreReasonForOutcome(outcome), "judge-down");
    assert.equal(scoreReasonDisplay(scoreReasonForOutcome(outcome)), "judge-down");
    assert.deepEqual(readScores(id), {}, "judge-down persists nothing");
  } finally {
    setScorerPromptMock(null);
  }
});

test("not-applicable: job below the scorer stage persists nothing", { timeout: 30000 }, async () => {
  const id = makeJobWithId(nextJobId("job-f4-notapp"));
  // Verification only, zero createdFiles: implement-stage gate must refuse.
  addEvidence(id, [], "pass");
  setScorerPromptMock(async () => {
    throw new Error("must not call the judge when not-applicable");
  });
  try {
    const outcome = await scoreJob(id, IMPL_SCORER, { manual: true });
    assert.equal(isNotApplicable(outcome), true, "implement scorer on a file-less job must refuse");
    assert.equal(scoreReasonForOutcome(outcome), "not-applicable");
    assert.equal(scoreReasonDisplay(scoreReasonForOutcome(outcome)), "not-applicable");
    assert.deepEqual(readScores(id), {}, "not-applicable persists nothing");
  } finally {
    setScorerPromptMock(null);
  }
});

// ── Display-only history rule: raw bytes unchanged ──

test("display-only: legacy disk bytes unchanged after reason + threshold rollout", { timeout: 30000 }, () => {
  const id = makeJobWithId(nextJobId("job-f4-legacy"));
  const dir = jobDir(id);
  // Old-style entry: no scoreReason key at all, stale passing (score 1 but
  // passing false; threshold 0.5 must recompute to true in memory only).
  const legacyEntry = {
    scorer: IMPL_SCORER,
    workItemId: id,
    label: IMPL_PASS_LABEL,
    score: 1,
    passing: false,
    reason: "legacy reason",
    model: "prov/model",
    origin: "sampled",
    at: "2026-01-01T00:00:00.000Z",
  };
  fs.writeFileSync(path.join(dir, SCORES_JSON_FILE), JSON.stringify({ [IMPL_SCORER]: legacyEntry }, null, 2), "utf-8");
  const before = fs.readFileSync(path.join(dir, SCORES_JSON_FILE), "utf-8");
  assert.ok(!before.includes("scoreReason"), "seed must look pre-F4 (no reason key)");

  const first = readScores(id)[IMPL_SCORER];
  assert.ok(first, "legacy entry must be readable");
  assert.equal(
    resolveScoreReason(first?.scoreReason),
    "unscored-legacy",
    "old entries read honest in memory (stored shape untouched)",
  );
  assert.equal(first?.passing, true, "P1.7 recompute intact (stale false -> true in memory)");

  const second = readScores(id)[IMPL_SCORER];
  assert.equal(resolveScoreReason(second?.scoreReason), "unscored-legacy");
  void getScoresSummary();

  const after = fs.readFileSync(path.join(dir, SCORES_JSON_FILE), "utf-8");
  assert.equal(after, before, "raw disk bytes unchanged after rollout reads");
  const rawAfter = JSON.parse(after) as Record<string, Record<string, unknown>>;
  assert.equal("scoreReason" in (rawAfter[IMPL_SCORER] ?? {}), false, "resolution never written back");
  assert.equal(rawAfter[IMPL_SCORER]?.passing, false, "stale passing untouched on disk");
});
