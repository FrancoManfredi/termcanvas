/**
 * EngineBridge (F8c): espejo work item ↔ run, gates y acciones del panel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "wf-bridge-"));
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX;
process.env.TERMCANVAS_WORKFLOWS_DIR = path.join(SANDBOX, "global-empty");

const { workItemStore } = await import("../headless-runtime/workItem/workItemStore.ts");
const {
  handleGate,
  handleRunEvent,
  isWorkflowEngineEnabled,
  runIdForItem,
  runWorkflowJob,
  tryHandleWorkflowAction,
} = await import("../headless-runtime/factory/engineBridge.ts");
const { VerifyJsonSchema } = await import("../headless-runtime/implement/verifyEvidence.ts");
const { ReviewResultSchema } = await import("../shared/types/review.ts");
type WorkflowRuntime = import("../headless-runtime/workflows/runtime.ts").WorkflowRuntime;

interface FakeRuntime {
  runtime: WorkflowRuntime;
  started: Array<{ name: string; params: Record<string, unknown> }>;
  responses: Array<{ runId: string; decision: string; text?: string }>;
  runs: Record<string, unknown>;
  setPending: (
    pending: { runId: string; nodeId: string; message: string; decisions: string[]; attempt: number } | null,
  ) => void;
  setRun: (run: unknown) => void;
  resumed: string[];
  cancelled: string[];
}

function fakeRuntime(runId: string): FakeRuntime {
  const started: FakeRuntime["started"] = [];
  const responses: FakeRuntime["responses"] = [];
  const runs: Record<string, unknown> = {};
  const resumed: string[] = [];
  const cancelled: string[] = [];
  let pending: Parameters<FakeRuntime["setPending"]>[0] = null;
  const runtime = {
    async start(name: string, params: Record<string, unknown>) {
      started.push({ name, params });
      const run = { id: runId, workflow: name, status: "running" };
      runs[runId] = run;
      return run;
    },
    getRun(id: string) {
      return runs[id] ?? null;
    },
    async resume(id: string) {
      resumed.push(id);
      const run = runs[id] as { status?: string } | undefined;
      if (run) run.status = "running";
      return run;
    },
    respond(id: string, response: { decision: string; text?: string }) {
      responses.push({ runId: id, decision: response.decision, text: response.text });
      pending = null;
    },
    cancel(id: string) {
      cancelled.push(id);
      const run = runs[id] as { status?: string } | undefined;
      if (run) run.status = "cancelled";
    },
    getPending() {
      return pending;
    },
  } as unknown as WorkflowRuntime;
  return {
    runtime,
    started,
    responses,
    runs,
    resumed,
    cancelled,
    setPending: (value) => {
      pending = value;
    },
    setRun: (run) => {
      runs[runId] = run;
    },
  };
}

function fakeReq(): http.IncomingMessage {
  return {
    on: (event: string, listener: () => void) => {
      if (event === "end") listener();
    },
    destroy: () => {},
  } as unknown as http.IncomingMessage;
}

function makeItem(id: string): void {
  workItemStore.create({
    id,
    prompt: "arreglar login",
    worktree: path.join(SANDBOX, "wt"),
  });
}

test("runWorkflowJob: Intake→Foreman, lanza factory-default y registra el link", async () => {
  makeItem("job-bridge-1");
  const fake = fakeRuntime("run-bridge-1");
  await runWorkflowJob("job-bridge-1", fake.runtime);
  const item = workItemStore.get("job-bridge-1");
  assert.equal(item?.status, "Foreman");
  assert.equal(runIdForItem("job-bridge-1"), "run-bridge-1");
  assert.equal(fake.started.length, 1);
  assert.equal(fake.started[0].name, "factory-default");
  assert.equal(fake.started[0].params.cwd, path.join(SANDBOX, "wt"));
  assert.deepEqual(
    (fake.started[0].params.inputs as Record<string, unknown>).workItemId,
    "job-bridge-1",
  );
});

test("eventos: node_started→Building, gate→Review, run_completed→Complete", () => {
  const event = (type: string, data?: Record<string, unknown>) =>
    ({ ts: "", type, runId: "run-bridge-1", workflow: "factory-default", nodeId: "triage", ...(data ? { data } : {}) }) as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent;
  handleRunEvent(event("run_started"));
  handleRunEvent(event("node_started", { nodeId: "triage" }));
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Building");
  handleGate({
    runId: "run-bridge-1",
    nodeId: "approve",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Review");
  const gateDir = workItemStore.get("job-bridge-1")?.dir;
  if (gateDir) {
    const gateReview = ReviewResultSchema.parse(
      JSON.parse(fs.readFileSync(path.join(gateDir, "review.json"), "utf-8")),
    );
    assert.equal(gateReview.verdict, "ask_human");
    assert.match(gateReview.summary, /aprobar\?/);
  }
  handleRunEvent(event("run_completed", { status: "completed" }));
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Complete");
});

test("acciones: accept→approve, reject→reject, resume y cancel", async () => {
  const fake = fakeRuntime("run-bridge-1");
  fake.setPending({
    runId: "run-bridge-1",
    nodeId: "approve",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const accepted = await tryHandleWorkflowAction({
    domain: "job-review-accept",
    itemId: "job-bridge-1",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(accepted.handled, true);
  assert.deepEqual(fake.responses.at(-1)?.decision, "approve");

  fake.setPending({
    runId: "run-bridge-1",
    nodeId: "approve",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const rejected = await tryHandleWorkflowAction({
    domain: "job-spec-reject",
    itemId: "job-bridge-1",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(rejected.handled, true);
  assert.deepEqual(fake.responses.at(-1)?.decision, "reject");

  const resumed = await tryHandleWorkflowAction({
    domain: "job-resume",
    itemId: "job-bridge-1",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(resumed.handled, true);
  assert.deepEqual(fake.resumed, ["run-bridge-1"]);

  const cancelled = await tryHandleWorkflowAction({
    domain: "job-cancel",
    itemId: "job-bridge-1",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(cancelled.handled, true);
  assert.deepEqual(fake.cancelled, ["run-bridge-1"]);
});

test("evidencia: run_completed espeja verify.json y review.json válidos", () => {
  if (!workItemStore.get("job-bridge-1")) makeItem("job-bridge-1");
  const fake = fakeRuntime("run-bridge-1");
  fake.setRun({
    id: "run-bridge-1",
    workflow: "factory-default",
    status: "completed",
    startedAt: "2026-09-11T00:00:00Z",
    finishedAt: "2026-09-11T00:01:00Z",
    nodes: {
      verify: {
        id: "verify",
        status: "completed",
        attempts: 1,
        output: "PASS: pnpm typecheck ok",
      },
      review: {
        id: "review",
        status: "completed",
        attempts: 1,
        output: '{"green":true,"findings":""}',
        outputJson: { green: true, findings: "" },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-1",
      workflow: "factory-default",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const dir = workItemStore.get("job-bridge-1")?.dir;
  assert.ok(dir, "el job debe tener dir");
  const verifyRaw = JSON.parse(
    fs.readFileSync(path.join(dir!, "verify.json"), "utf-8"),
  ) as unknown;
  const verify = VerifyJsonSchema.parse(verifyRaw);
  assert.equal(verify.workItemId, "job-bridge-1");
  assert.equal(verify.verification.overall, "pass");
  assert.match(verify.verification.steps[0].logSnippet ?? "", /PASS/);

  const reviewRaw = JSON.parse(
    fs.readFileSync(path.join(dir!, "review.json"), "utf-8"),
  ) as unknown;
  const review = ReviewResultSchema.parse(reviewRaw);
  assert.equal(review.verdict, "accept");
  assert.equal(review.workItemId, "job-bridge-1");
});

test("jobs legacy (sin run) no son interceptados", async () => {
  makeItem("job-bridge-legacy");
  const fake = fakeRuntime("run-x");
  const result = await tryHandleWorkflowAction({
    domain: "job-review-accept",
    itemId: "job-bridge-legacy",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(result.handled, false);
});

test("isWorkflowEngineEnabled: default workflow, legacy por env", () => {
  delete process.env.TERMCANVAS_FACTORY_ENGINE;
  assert.equal(isWorkflowEngineEnabled(), true);
  process.env.TERMCANVAS_FACTORY_ENGINE = "legacy";
  assert.equal(isWorkflowEngineEnabled(), false);
  delete process.env.TERMCANVAS_FACTORY_ENGINE;
});
