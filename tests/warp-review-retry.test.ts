/**
 * warp-review-retry — T1 (renderer): cuando el review NUNCA corrió por fallo
 * de infra/proveedor, Accept se deshabilita con motivo honesto y la acción
 * primaria es reintentar solo el review.
 *
 * Contrato bajo test (offline: cero red, fakes inyectados):
 * - `readFactoryJobHumanNeed`: Review + lastReview ask_human con
 *   `isInfraError: true` → gate ask-human con `reviewInfraError: true;
 *   sin flag → el campo ausente (forma intacta).
 * - `describeActivityActions`: con infra → Accept deshabilitado con título
 *   que manda a reintentar + Retry review habilitado; sin infra → Accept
 *   habilitado (régimen de siempre) y Retry también.
 * - `invokeActivityAction("review-retry")`: seam ok → notify de reintento;
 *   seam en fallo → notify honesto con el error; id inválido / kind
 *   mismatch / busy / doble clic → silencio sin llamadas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFactoryJobHumanNeed } from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import {
  describeActivityActions,
  invokeActivityAction,
  type DescribeActivityActionsArgs,
  type FactoryHumanActionResult,
} from "../src/features/warpPanel/components/activityActions.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const JOB_ID = "job-retry-1";
const ISSUE_URL = "https://github.com/org/termcanvas/issues/7";

function issueRefMeta() {
  return {
    id: "job-7-t1",
    from: "Intake",
    to: "Triage",
    at: new Date().toISOString(),
    actor: "system",
    message: "resolve link github#7 (org/termcanvas)",
    meta: {
      issueRef: { provider: "github", issueNumber: 7, repo: "org/termcanvas", url: ISSUE_URL },
    },
  };
}

function reviewJob(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB_ID,
    prompt: "Resolve issue #7",
    worktree: "C:/repos/wt-7",
    phase: "diagnosisLlm",
    status: "Review",
    state: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [issueRefMeta()],
    lastReview: {
      workItemId: JOB_ID,
      reviewerModel: { providerID: "a", modelID: "b" },
      verdict: "ask_human",
      confidence: 0.5,
      summary: "Ambiguous scope",
      findings: [],
      reviewAttempt: 3,
      reviewedAt: new Date().toISOString(),
    },
    ...patch,
  };
}

function infraReviewJob(): Record<string, unknown> {
  const job = reviewJob();
  (job.lastReview as Record<string, unknown>).isInfraError = true;
  (job.lastReview as Record<string, unknown>).summary =
    "review prompt fallo: Error from provider (Console): Rate limit exceeded. Please try again later.";
  return job;
}

function baseArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return {
    issueNumber: 7,
    prNumber: null,
    prState: "unknown",
    effective: null,
    conflicted: false,
    gateStatus: "idle",
    busy: {
      resolving: false,
      reviewing: false,
      fixing: false,
      merging: false,
      resolvingConflict: false,
      anyActive: false,
    },
    ...patch,
  };
}

function byKind(defs: ReturnType<typeof describeActivityActions>) {
  return new Map(defs.map((d) => [d.kind, d]));
}

function okSeam(calls: { count: number }): (jobId: string) => Promise<FactoryHumanActionResult> {
  return async () => {
    calls.count += 1;
    return { ok: true, error: "" };
  };
}

function failSeam(
  calls: { count: number },
  error = "review never ran (infra error)",
): (jobId: string) => Promise<FactoryHumanActionResult> {
  return async () => {
    calls.count += 1;
    return { ok: false, error };
  };
}

// ─── adapter: flag infra ───

test("need: ask-human con lastReview de infra trae reviewInfraError", () => {
  const need = readFactoryJobHumanNeed(infraReviewJob());
  assert.ok(need !== null);
  assert.equal(need.kind, "ask-human");
  assert.equal(need.jobId, JOB_ID);
  assert.equal(need.reviewInfraError, true);
});

test("need: ask-human legítimo no trae el flag (forma intacta)", () => {
  const need = readFactoryJobHumanNeed(reviewJob());
  assert.ok(need !== null);
  assert.equal(need.kind, "ask-human");
  assert.equal("reviewInfraError" in need, false);
});

// ─── describe: Accept bloqueado + Retry ───

test("describe: con infra Accept se deshabilita y Retry review habilita", () => {
  const defs = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "ask-human", jobId: JOB_ID, reviewInfraError: true },
      }),
    ),
  );
  assert.equal(defs.get("review-accept")?.enabled, false);
  assert.match(defs.get("review-accept")?.title ?? "", /retry the review/);
  assert.equal(defs.get("review-retry")?.label, "Retry review");
  assert.equal(defs.get("review-retry")?.enabled, true);
  assert.ok((defs.get("review-retry")?.title ?? "").length > 0);
});

test("describe: sin infra Accept y Retry habilitan (régimen de siempre)", () => {
  const defs = byKind(
    describeActivityActions(
      baseArgs({ factoryAwaiting: { kind: "ask-human", jobId: JOB_ID } }),
    ),
  );
  assert.equal(defs.get("review-accept")?.enabled, true);
  assert.equal(defs.get("review-retry")?.enabled, true);
});

test("describe: Retry review refusa sin gate, sin id o con busy", () => {
  const absent = byKind(describeActivityActions(baseArgs()));
  assert.equal(absent.get("review-retry")?.enabled, false);
  const noId = byKind(
    describeActivityActions(
      baseArgs({ factoryAwaiting: { kind: "ask-human", jobId: "  " } }),
    ),
  );
  assert.equal(noId.get("review-retry")?.enabled, false);
  const busy = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "ask-human", jobId: JOB_ID },
        busy: {
          resolving: false,
          reviewing: true,
          fixing: false,
          merging: false,
          resolvingConflict: false,
          anyActive: true,
        },
      }),
    ),
  );
  assert.equal(busy.get("review-retry")?.enabled, false);
});

// ─── invoke: review-retry ───

test("invoke: review-retry notifica reintento; el fallo del daemon sale honesto", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("review-retry", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    retryReviewJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(JOB_ID));
  assert.match(notices[0], /stays in Review/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("review-retry", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    retryReviewJob: failSeam(failCalls),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not retry/);
  assert.match(failNotices[0], /infra error/);
});

test("invoke: review-retry con guards refusa en silencio", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  const deps = {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    retryReviewJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  };
  await invokeActivityAction("review-retry", -3, undefined, deps);
  await invokeActivityAction("review-retry", 7, undefined, {
    ...deps,
    factoryJobId: "  ",
  });
  await invokeActivityAction("review-retry", 7, undefined, {
    ...deps,
    factoryAwaitingKind: "spec-approval",
  });
  await invokeActivityAction("review-retry", 7, undefined, {
    ...deps,
    busy: { anyActive: true } as never,
  });
  assert.equal(calls.count, 0);
  assert.equal(notices.length, 0);
});
