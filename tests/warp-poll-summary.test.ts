/**
 * warp-poll-summary — Ola B2 (renderer consume `?view=summary`).
 *
 * El poll del warp pide `GET /factory/jobs?view=summary` (FactoryLab sigue
 * en full). Los items summary traen `timeline: []` + escalares
 * (`timelineCount`/`lastEventAt`) y proyecciones (`issueRef`/`parked`/
 * `triageAnswered`/`pr`); este test congela que:
 * - la firma de cambio trata full y summary del mismo job como iguales
 *   (sin "cambios" fantasma al cambiar de vista) y detecta cambios reales,
 * - los gates H0/H2 y el link PR prefieren la proyección y caen al
 *   timeline-scan en la vista full (paridad exacta).
 * Offline: puro, cero red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { workItemListSignature } from "../src/stores/workItemStore.ts";
import {
  readFactoryJobHumanNeed,
  readFactoryJobIssueRef,
  readFactoryJobPrLink,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";

function fullJob(): Record<string, unknown> {
  return {
    id: "job-sum-1",
    status: "Building",
    state: "running",
    phase: "diagnosisLlm",
    worktree: "C:/repo",
    runnerId: "linux-build",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:05.000Z",
    reviewCount: 0, // la lista full siempre lo trae (`?? 0` en toListItem)
    timeline: [
      { id: "t0", from: "Intake", to: "Intake", at: "2026-09-01T00:00:00.000Z", actor: "user", message: "c" },
      { id: "t1", from: "Intake", to: "Building", at: "2026-09-01T00:00:05.000Z", actor: "foreman", message: "go" },
    ],
    isolation: { branch: "issue-7", worktreePath: "C:/wt" },
  };
}

function summaryOf(full: Record<string, unknown>): Record<string, unknown> {
  const timeline = full.timeline as Array<Record<string, unknown>>;
  return {
    id: full.id,
    status: full.status,
    state: full.state,
    phase: full.phase,
    worktree: full.worktree,
    runnerId: full.runnerId,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
    reviewCount: 0,
    isolation: full.isolation,
    timeline: [],
    timelineCount: timeline.length,
    lastEventAt: timeline[timeline.length - 1].at,
  };
}

test("full and summary of the same job share a signature", () => {
  const full = fullJob();
  const summary = summaryOf(full);
  assert.equal(workItemListSignature([full]), workItemListSignature([summary]));
  assert.equal(
    workItemListSignature([full]),
    workItemListSignature([JSON.parse(JSON.stringify(summary))]),
  );
});

test("summary detects real changes", () => {
  const base = [summaryOf(fullJob())];
  const changedStatus = [summaryOf({ ...fullJob(), status: "Review" })];
  assert.notEqual(workItemListSignature(base), workItemListSignature(changedStatus));
  const changedCount = [summaryOf(fullJob())];
  (changedCount[0] as Record<string, unknown>).timelineCount = 3;
  assert.notEqual(workItemListSignature(base), workItemListSignature(changedCount));
});

test("H0 prefers the parked projection (no timeline needed)", () => {
  const need = readFactoryJobHumanNeed({
    id: "job-sum-park",
    status: "Building",
    timeline: [],
    parked: true,
  });
  assert.deepEqual(need, { kind: "resume", jobId: "job-sum-park" });
});

test("H2 fires without the flag, suppresses with triageAnswered", () => {
  const base = {
    id: "job-sum-tri",
    status: "Triage",
    triage: { openQuestions: ["¿Sigo?"] },
    timeline: [],
  };
  const gate = readFactoryJobHumanNeed({ ...base });
  assert.equal((gate as { kind: string } | null)?.kind, "triage-respond");
  assert.equal(readFactoryJobHumanNeed({ ...base, triageAnswered: true }), null);
});

test("H2 timeline backstop still works in the full view", () => {
  const need = readFactoryJobHumanNeed({
    id: "job-sum-tri2",
    status: "Triage",
    triage: { openQuestions: ["¿Sigo?"] },
    timeline: [{ meta: { triageRespond: { answers: ["sí"] } } }],
  });
  assert.equal(need, null);
});

test("PR link prefers the projected pr when isolation lacks a URL", () => {
  const link = readFactoryJobPrLink({
    id: "job-sum-pr",
    status: "Building",
    isolation: { branch: "issue-7" },
    pr: { prUrl: "https://x/y/pull/61", prNumber: 61 },
    timeline: [],
  });
  assert.deepEqual(link, { prUrl: "https://x/y/pull/61", prNumber: 61 });
});

test("top-level issueRef resolves without a timeline scan", () => {
  const ref = readFactoryJobIssueRef({
    id: "job-sum-ref",
    status: "Building",
    issueRef: { provider: "github", issueNumber: 67, repo: "o/r" },
    timeline: [],
  });
  assert.equal(ref?.issueNumber, 67);
});
