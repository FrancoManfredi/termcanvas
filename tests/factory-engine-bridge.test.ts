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
type WorkflowRuntime = import("../headless-runtime/workflows/runtime.ts").WorkflowRuntime;

interface FakeRuntime {
  runtime: WorkflowRuntime;
  started: Array<{ name: string; params: Record<string, unknown> }>;
  responses: Array<{ runId: string; decision: string; text?: string }>;
  runs: Record<string, { id: string; status: string; workflow: string }>;
  setPending: (
    pending: { runId: string; nodeId: string; message: string; decisions: string[]; attempt: number } | null,
  ) => void;
  resumed: string[];
  cancelled: string[];
}

function fakeRuntime(runId: string): FakeRuntime {
  const started: FakeRuntime["started"] = [];
  const responses: FakeRuntime["responses"] = [];
  const runs: FakeRuntime["runs"] = {};
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
      if (runs[id]) runs[id].status = "running";
      return runs[id];
    },
    respond(id: string, response: { decision: string; text?: string }) {
      responses.push({ runId: id, decision: response.decision, text: response.text });
      pending = null;
    },
    cancel(id: string) {
      cancelled.push(id);
      if (runs[id]) runs[id].status = "cancelled";
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
