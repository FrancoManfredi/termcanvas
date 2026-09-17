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
  autoResumeParkedEngineJobs,
  factoryDefaultRunInputs,
  handleGate,
  handleRunEvent,
  isWorkflowEngineEnabled,
  mirrorRunEvidence,
  reconcileFromAnyCaller,
  runIdForItem,
  runInputsForWorkflowDef,
  runWorkflowJob,
  setWorkflowRouterForTests,
  setWorkflowRuntimeProvider,
  startBotReconcileRun,
  tryHandleWorkflowAction,
} = await import("../headless-runtime/factory/engineBridge.ts");
const {
  ALLOWED_TRANSITIONS,
  BOOT_INTERRUPTED_AT_META_KEY,
  BOOT_INTERRUPTED_META_KEY,
  RESUMED_META_KEY,
  canTransition,
  needsResume,
} = await import("../shared/types/workItem.ts");
const { VerifyJsonSchema } = await import("../headless-runtime/implement/verifyEvidence.ts");
const { ReviewResultSchema } = await import("../shared/types/review.ts");
const { loadWorkflow } = await import("../headless-runtime/workflows/loader.ts");
const { runWorkflow } = await import("../headless-runtime/workflows/executor.ts");
type WorkflowRuntime = import("../headless-runtime/workflows/runtime.ts").WorkflowRuntime;
type AiNodeRunner = import("../headless-runtime/workflows/nodes/ai.ts").AiNodeRunner;

// Router determinista en tests: el LLM real JAMÁS corre acá. El test del
// router del engine lo pisa temporalmente y lo restaura.
function setSafeRouter(): void {
  setWorkflowRouterForTests(async () => ({
    workflow: "factory-default",
    reason: "test",
    routedBy: "fallback",
  }));
}
setSafeRouter();

// El juez LLM del scorer corre en run_completed (autoScoreCompletedJob) y
// crearía el server opencode real, dejando el proceso de test vivo. Mismo
// criterio que el router: el LLM nunca corre acá. Respuesta null = unscored.
const { setScorerPromptMock } = await import(
  "../headless-runtime/measure/scorerEngine.ts"
);
const { setAnalysisPromptMock } = await import(
  "../headless-runtime/measure/improvementEngine.ts"
);
const { opencodeServerManager, setTestClient } = await import(
  "../headless-runtime/opencodeServerManager.ts"
);
setScorerPromptMock(async () => null);
setAnalysisPromptMock(async () => null);
// Cliente falso: si algún camino diferido llega a ensureClient, devuelve este
// stub en vez de crear el server opencode real (que deja el proceso vivo).
setTestClient({
  session: {
    create: async () => ({ id: "ses-engine-bridge-test" }),
    prompt: async () => ({}),
  },
} as unknown as Parameters<typeof setTestClient>[0]);
test.after(() => {
  // Los mocks NO se limpian: el scorer corre fire-and-forget (void import)
  // y puede ejecutarse después de este hook — limpiarlos acá resucita el
  // juez real y deja el server opencode vivo. El close() es la red final.
  try {
    opencodeServerManager.close();
  } catch {}
});

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
    getWorkflowNodeIds() {
      return ["triage", "spec", "approve", "implement", "verify", "review"];
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

function fakeReq(body?: string): http.IncomingMessage {
  return {
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === "data" && body !== undefined) {
        listener(Buffer.from(body));
      }
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
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineRun?.runId,
    "run-bridge-1",
  );
  assert.equal(workItemStore.get("job-bridge-1")?.engineRun?.status, "running");
  assert.deepEqual(workItemStore.get("job-bridge-1")?.engineRun?.nodes, [
    "triage",
    "spec",
    "approve",
    "implement",
    "verify",
    "review",
  ]);
});

test("runWorkflowJob: con isolation el run corre en el jail, no en el anchor (run #125)", async () => {
  const id = "job-bridge-iso";
  makeItem(id);
  const item = workItemStore.get(id)!;
  const jail = path.join(SANDBOX, "wt", ".worktrees", "issue-125-ux");
  item.isolation = {
    branch: "issue-125-ux",
    baseBranch: "main",
    worktreePath: jail,
    repoRoot: path.join(SANDBOX, "wt"),
    state: "created",
    createdAt: new Date().toISOString(),
  };
  const fake = fakeRuntime("run-bridge-iso");
  await runWorkflowJob(id, fake.runtime);
  assert.equal(fake.started.length, 1);
  assert.equal(
    fake.started[0].params.cwd,
    jail,
    "cwd = worktree de aislamiento, nunca el anchor del canvas",
  );
});

test("eventos: node_started→Building, gate→Review, run_completed→Complete", () => {
  const event = (type: string, data?: Record<string, unknown>) =>
    ({ ts: "", type, runId: "run-bridge-1", workflow: "factory-default", nodeId: "triage", ...(data ? { data } : {}) }) as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent;
  handleRunEvent(event("run_started"));
  handleRunEvent(event("node_started", { nodeId: "triage" }));
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Building");
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineRun?.currentNodeId,
    "triage",
  );
  handleGate({
    runId: "run-bridge-1",
    nodeId: "approve",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Review");
  const bridgeGate = workItemStore.get("job-bridge-1")?.engineGate;
  assert.equal(bridgeGate?.kind, "spec-approval");
  assert.equal(bridgeGate?.nodeId, "approve");
  assert.match(bridgeGate?.message ?? "", /aprobar\?/);
  const gateDir = workItemStore.get("job-bridge-1")?.dir;
  if (gateDir) {
    const gateReview = ReviewResultSchema.parse(
      JSON.parse(fs.readFileSync(path.join(gateDir, "review.json"), "utf-8")),
    );
    assert.equal(gateReview.verdict, "ask_human");
    assert.match(gateReview.summary, /aprobar\?/);
  }
  // Gate respondido + nodo de agente arrancando: Review vuelve a Building
  // (si no, la fila queda "Review" mientras implement).
  workItemStore.setEngineGate("job-bridge-1", null);
  handleRunEvent({
    ts: "",
    type: "node_started",
    runId: "run-bridge-1",
    workflow: "factory-default",
    nodeId: "implement",
  } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent);
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Building");
  handleRunEvent(event("run_completed", { status: "completed" }));
  assert.equal(workItemStore.get("job-bridge-1")?.status, "Complete");
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineGate,
    null,
    "run terminal limpia el gate",
  );
});

test("handleGate: mensaje largo de spec llega completo, sin slice (issue #124)", async () => {
  const id = "job-bridge-long-gate";
  makeItem(id);
  const fake = fakeRuntime("run-bridge-long-gate");
  await runWorkflowJob(id, fake.runtime);
  const longMessage = `Aprobar la spec para pasar a implementación?\n\nSpec — Issue #124\n\n**Objetivo:**\n${"Envolver la lectura en manejo defensivo. ".repeat(120)}\n\n**Outcome:**\n${"La página carga lista vacía. ".repeat(80)}\n\nflowchart LR\n  subgraph Before\n    B1[corrupto] --> B2[lanza]\n  end\n`;
  assert.ok(longMessage.length > 5000, "el fixture supera el viejo cap de 2000");
  handleGate({
    runId: "run-bridge-long-gate",
    nodeId: "approve",
    message: longMessage,
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const gate = workItemStore.get(id)?.engineGate;
  assert.equal(gate?.message, longMessage, "engineGate conserva el mensaje íntegro");
  const dir = workItemStore.get(id)?.dir;
  if (dir) {
    const review = ReviewResultSchema.parse(
      JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf-8")),
    );
    assert.match(review.summary, /Issue #124/, "review.json conserva la spec completa");
    assert.ok(review.summary.length > 5000, "review.json sin truncar");
  }
});

test("sessions: node_completed espeja el sessionId del run en el work item", () => {
  if (!workItemStore.get("job-bridge-1")) makeItem("job-bridge-1");
  const fake = fakeRuntime("run-bridge-1");
  // El run persistido todavía NO tiene el sessionId (el executor emite el
  // evento antes de `store.save`): la fuente fresca es `event.data`.
  fake.setRun({
    id: "run-bridge-1",
    workflow: "factory-default",
    status: "running",
    nodes: {
      triage: {
        id: "triage",
        status: "completed",
        attempts: 1,
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "node_completed",
      runId: "run-bridge-1",
      workflow: "factory-default",
      nodeId: "triage",
      data: { sessionId: "ses-triage-1" },
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-1");
  assert.equal(item?.agentSessions?.triage, "ses-triage-1");
  assert.equal(item?.sessionId, "ses-triage-1");
  assert.match(item?.dashboardUrl ?? "", /\/session\/ses-triage-1$/);
  assert.equal(
    item?.engineRun?.nodeSessions?.triage,
    "ses-triage-1",
    "la sesión por nodo queda en engineRun.nodeSessions (fila dinámica)",
  );

  // Un nodo sin rol (el gate no tiene sesión) no inventa ni pisa el link.
  fake.setRun({
    id: "run-bridge-1",
    workflow: "factory-default",
    status: "running",
    nodes: {
      approve: {
        id: "approve",
        status: "completed",
        attempts: 1,
        sessionId: "ses-gate-1",
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "node_completed",
      runId: "run-bridge-1",
      workflow: "factory-default",
      nodeId: "approve",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  // Nodo genérico (el gate real no crea sesión; si la trae, se espeja como
  // sesión de nodo y el primario pasa a ser la última).
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineRun?.nodeSessions?.approve,
    "ses-gate-1",
  );
  assert.equal(workItemStore.get("job-bridge-1")?.sessionId, "ses-gate-1");

  // Nodo salteado en un resume con sesión persistida: también se espeja
  // (los completados del run anterior conservan su sessionId).
  fake.setRun({
    id: "run-bridge-1",
    workflow: "factory-default",
    status: "running",
    nodes: {
      spec: {
        id: "spec",
        status: "skipped",
        attempts: 1,
        sessionId: "ses-spec-1",
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "node_skipped",
      runId: "run-bridge-1",
      workflow: "factory-default",
      nodeId: "spec",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  assert.equal(workItemStore.get("job-bridge-1")?.agentSessions?.spec, "ses-spec-1");
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineRun?.nodeSessions?.spec,
    "ses-spec-1",
  );
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
  handleGate({
    runId: "run-bridge-1",
    nodeId: "approve",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  assert.ok(workItemStore.get("job-bridge-1")?.engineGate);
  const accepted = await tryHandleWorkflowAction({
    domain: "job-review-accept",
    itemId: "job-bridge-1",
    runtime: fake.runtime,
    req: fakeReq('{"text":"respuesta aprobada"}'),
  });
  assert.equal(accepted.handled, true);
  assert.deepEqual(fake.responses.at(-1)?.decision, "approve");
  assert.equal(
    fake.responses.at(-1)?.text,
    "respuesta aprobada",
    "readBodyText lee el body real del request",
  );
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineGate,
    null,
    "responder el gate lo limpia",
  );

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

test("handleGate: el nodo gate (plan) clasifica spec-approval, no ask-human", async () => {
  makeItem("job-bridge-plan-gate");
  const fake = fakeRuntime("run-plan-gate-1");
  await runWorkflowJob("job-bridge-plan-gate", fake.runtime);
  handleGate({
    runId: "run-plan-gate-1",
    nodeId: "gate",
    message: 'Aprobar el plan?\n\n{"summary":"s","steps":["a"]}',
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const gate = workItemStore.get("job-bridge-plan-gate")?.engineGate;
  assert.equal(gate?.kind, "spec-approval", "botones Aprobar/Rechazar, no review");
  assert.equal(gate?.nodeId, "gate");
});

test("G1: Retry review no rechaza un gate de aprobación (409, gate intacto)", async () => {
  makeItem("job-bridge-g1");
  const fake = fakeRuntime("run-g1-1");
  await runWorkflowJob("job-bridge-g1", fake.runtime);
  fake.setPending({
    runId: "run-g1-1",
    nodeId: "gate",
    message: "aprobar el plan?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const blocked = await tryHandleWorkflowAction({
    domain: "job-review-retry",
    itemId: "job-bridge-g1",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(blocked.status, 409, "aprobación ≠ retry review");
  assert.equal(fake.responses.length, 0, "no se envió reject");
  assert.ok(fake.runtime.getPending("run-g1-1"), "el gate sigue pendiente");

  // Gate de review (ask-human): conserva reject + resume.
  fake.setPending({
    runId: "run-g1-1",
    nodeId: "review",
    message: "revisar",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const retry = await tryHandleWorkflowAction({
    domain: "job-review-retry",
    itemId: "job-bridge-g1",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(retry.status, 200);
  assert.equal(fake.responses.at(-1)?.decision, "reject");
});

test("G2: resume, gate y approve reviven un job Cancelled con run vivo", async () => {
  // Resume manual: Cancelled → Building.
  makeItem("job-bridge-g2a");
  const fakeA = fakeRuntime("run-g2a");
  await runWorkflowJob("job-bridge-g2a", fakeA.runtime);
  workItemStore.transition("job-bridge-g2a", "Cancelled", "system", "gate rechazado (test)");
  const resumed = await tryHandleWorkflowAction({
    domain: "job-resume",
    itemId: "job-bridge-g2a",
    runtime: fakeA.runtime,
    req: fakeReq(),
  });
  assert.equal(resumed.status, 200);
  assert.equal(
    workItemStore.get("job-bridge-g2a")?.status,
    "Building",
    "resume re-sincroniza el status",
  );

  // Gate levantado sobre un Cancelled: revive a Review.
  makeItem("job-bridge-g2b");
  const fakeB = fakeRuntime("run-g2b");
  await runWorkflowJob("job-bridge-g2b", fakeB.runtime);
  workItemStore.transition("job-bridge-g2b", "Cancelled", "system", "test");
  handleGate({
    runId: "run-g2b",
    nodeId: "gate",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  const itemB = workItemStore.get("job-bridge-g2b");
  assert.equal(itemB?.status, "Review");
  assert.equal(itemB?.engineGate?.kind, "spec-approval");

  // Approve sobre un Cancelled: revive a Building (el run sigue a implement).
  makeItem("job-bridge-g2c");
  const fakeC = fakeRuntime("run-g2c");
  await runWorkflowJob("job-bridge-g2c", fakeC.runtime);
  fakeC.setPending({
    runId: "run-g2c",
    nodeId: "gate",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  workItemStore.transition("job-bridge-g2c", "Cancelled", "system", "test");
  const approved = await tryHandleWorkflowAction({
    domain: "job-spec-approve",
    itemId: "job-bridge-g2c",
    runtime: fakeC.runtime,
    req: fakeReq(),
  });
  assert.equal(approved.status, 200);
  assert.equal(
    workItemStore.get("job-bridge-g2c")?.status,
    "Building",
    "aprobar revive el status",
  );
});

test("job-resume: job parkeado SIN run se re-despacha (no cae al 410 legacy)", async () => {
  makeItem("job-bridge-redispatch");
  // Parkeado en Foreman ANTES de crear el run (incidente #125: el worker
  // murió en routing, no hay engineRun que reanudar).
  workItemStore.transition(
    "job-bridge-redispatch",
    "Foreman",
    "foreman",
    "foreman review started",
    {},
  );
  workItemStore.appendEvent(
    "job-bridge-redispatch",
    "system",
    "daemon reiniciado: turno interrumpido",
    {
      [BOOT_INTERRUPTED_META_KEY]: true,
      [BOOT_INTERRUPTED_AT_META_KEY]: new Date().toISOString(),
      fromStatus: "Foreman",
    },
  );
  const fake = fakeRuntime("run-redispatch-1");
  const action = await tryHandleWorkflowAction({
    domain: "job-resume",
    itemId: "job-bridge-redispatch",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(action.handled, true, "el engine maneja el resume");
  assert.equal(action.status, 200, "responde al instante (sin timeout del cliente)");
  assert.equal(
    (action.body as { redispatched?: boolean } | undefined)?.redispatched,
    true,
  );
  const parked = workItemStore.get("job-bridge-redispatch");
  assert.ok(parked);
  assert.equal(
    needsResume(parked.status, parked.timeline),
    false,
    "el parqueo queda marcado como reanudado",
  );
  // El dispatch corre en background (setImmediate), como el create.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fake.started.length, 1, "re-despacha por el engine");
  assert.equal(runIdForItem("job-bridge-redispatch"), "run-redispatch-1");

  // Job fresco sin parqueo: el engine NO re-lanza por carrera; sigue legacy.
  makeItem("job-bridge-fresh");
  const fresh = fakeRuntime("run-fresh-1");
  const untouched = await tryHandleWorkflowAction({
    domain: "job-resume",
    itemId: "job-bridge-fresh",
    runtime: fresh.runtime,
    req: fakeReq(),
  });
  assert.equal(untouched.handled, false, "sin parqueo no hay re-dispatch");
  assert.equal(fresh.started.length, 0);
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
    totals: { costUsd: 0.42, tokens: { input: 10, output: 5 } },
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

  const item = workItemStore.get("job-bridge-1");
  assert.equal(item?.costSummary?.estimatedUSD, 0.42);
  assert.equal(item?.costSummary?.estimatedInputTokens, 10);
  assert.equal(item?.costSummary?.actual?.usd, 0.42);
});

test("evidencia: mirrorRunEvidence guarda el reporte del implement en el timeline (PR)", () => {
  if (!workItemStore.get("job-bridge-impl")) makeItem("job-bridge-impl");
  mirrorRunEvidence(
    "job-bridge-impl",
    {
      id: "run-bridge-impl",
      workflow: "fix-issue",
      status: "completed",
      startedAt: "2026-09-11T00:00:00Z",
      finishedAt: "2026-09-11T00:01:00Z",
      inputs: {},
      args: "",
      nodes: {
        "build.implement": {
          id: "build.implement",
          status: "completed",
          attempts: 1,
          output:
            "Fix mínimo en `js/store.js`.\n\n## Review guidance\n- Empezar por: `js/store.js:41`.",
        },
      },
      sourceDigest: "x",
      sourcePath: "y",
      artifactsDir: "z",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowRun,
  );
  const timeline = workItemStore.get("job-bridge-impl")?.timeline ?? [];
  const found = timeline.find(
    (e) =>
      typeof e?.meta === "object" &&
      e.meta !== null &&
      "implementReport" in (e.meta as Record<string, unknown>),
  ) as { meta?: { implementReport?: unknown } } | undefined;
  assert.ok(found, "el reporte del implement queda en el timeline");
  assert.match(String(found?.meta?.implementReport ?? ""), /Review guidance/);
});

test("run_failed: notifica daemon-error y espeja evidencia de fallo", () => {  if (!workItemStore.get("job-bridge-1")) makeItem("job-bridge-1");
  const fake = fakeRuntime("run-bridge-1");
  fake.setRun({
    id: "run-bridge-1",
    workflow: "factory-default",
    status: "failed",
    startedAt: "2026-09-11T00:00:00Z",
    finishedAt: "2026-09-11T00:02:00Z",
    nodes: {
      verify: {
        id: "verify",
        status: "failed",
        attempts: 1,
        output: "FAIL: tests rojos",
      },
    },
  });
  handleGate({
    runId: "run-bridge-1",
    nodeId: "approve",
    message: "gate colgado",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  assert.ok(workItemStore.get("job-bridge-1")?.engineGate);
  handleRunEvent(
    {
      ts: "",
      type: "run_failed",
      runId: "run-bridge-1",
      workflow: "factory-default",
      data: { error: "verify falló" },
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  assert.equal(
    workItemStore.get("job-bridge-1")?.engineGate,
    null,
    "run fallido limpia el gate colgado",
  );
  const dir = workItemStore.get("job-bridge-1")?.dir;
  assert.ok(dir);
  const verify = VerifyJsonSchema.parse(
    JSON.parse(fs.readFileSync(path.join(dir!, "verify.json"), "utf-8")),
  );
  assert.equal(verify.verification.overall, "fail");
  const notificationsRaw = fs.readFileSync(
    path.join(SANDBOX, ".notifications.json"),
    "utf-8",
  );
  assert.match(notificationsRaw, /daemon-error/);
  assert.match(notificationsRaw, /Run falló/);
});

test("run_completed con outcome failed: Review (no Complete) + notificación ask_human", async () => {
  makeItem("job-bridge-red");
  const fake = fakeRuntime("run-bridge-red");
  await runWorkflowJob("job-bridge-red", fake.runtime);
  // Camino realista: un nodo arrancó (Building) y el run terminó en rojo.
  handleRunEvent(
    {
      ts: "",
      type: "node_started",
      runId: "run-bridge-red",
      workflow: "factory-default",
      nodeId: "build.implement",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  fake.setRun({
    id: "run-bridge-red",
    workflow: "factory-default",
    status: "completed",
    startedAt: "2026-09-11T00:00:00Z",
    finishedAt: "2026-09-11T00:03:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: '{"green":false,"findings":"el contador no se actualiza"}',
        outputJson: { green: false, findings: "el contador no se actualiza" },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-red",
      workflow: "factory-default",
      data: {
        status: "completed",
        result: { node: "build", outcome: "failed" },
      },
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-red");
  assert.equal(item?.status, "Review", "rojo final = Review, nunca Complete");
  const dir = item?.dir;
  assert.ok(dir);
  const review = ReviewResultSchema.parse(
    JSON.parse(fs.readFileSync(path.join(dir!, "review.json"), "utf-8")),
  );
  assert.equal(review.verdict, "revise");
  const notificationsRaw = fs.readFileSync(
    path.join(SANDBOX, ".notifications.json"),
    "utf-8",
  );
  assert.match(notificationsRaw, /ask_human/);
  assert.match(notificationsRaw, /Review no aprobó/);
  assert.match(notificationsRaw, /review-rejected:run-bridge-red/);
});

test("review.json: findings estructurados se renderizan legibles (WS2)", async () => {
  makeItem("job-bridge-structured");
  const fake = fakeRuntime("run-bridge-structured");
  await runWorkflowJob("job-bridge-structured", fake.runtime);
  fake.setRun({
    id: "run-bridge-structured",
    workflow: "fix-issue",
    status: "completed",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: false,
          findings: [
            {
              id: "f1",
              axis: "tests",
              severity: "major",
              file: "js/store.js",
              message: "el contador no se actualiza",
            },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-structured",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-structured");
  const dir = item?.dir;
  assert.ok(dir);
  const review = ReviewResultSchema.parse(
    JSON.parse(fs.readFileSync(path.join(dir!, "review.json"), "utf-8")),
  );
  assert.equal(review.verdict, "revise");
  assert.match(
    review.summary,
    /\[major\] f1 \(js\/store\.js\): el contador no se actualiza/,
  );
});

test("verify.json: evidencia real del verify-runner (steps reales + build.log)", async () => {
  makeItem("job-bridge-real-verify");
  const fake = fakeRuntime("run-bridge-real-verify");
  await runWorkflowJob("job-bridge-real-verify", fake.runtime);
  fake.setRun({
    id: "run-bridge-real-verify",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.verify": {
        id: "build.verify",
        status: "completed",
        attempts: 1,
        output: '{"pass":true,"steps":[]}',
        outputJson: {
          pass: true,
          summary: "verificacion: 1 check(s) OK",
          steps: [
            {
              name: "test",
              command: "pnpm test",
              exitCode: 0,
              durationMs: 1234,
              status: "pass",
              logSnippet: "15 passed",
            },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-real-verify",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-real-verify");
  const dir = item?.dir;
  assert.ok(dir);
  const verify = VerifyJsonSchema.parse(
    JSON.parse(fs.readFileSync(path.join(dir!, "verify.json"), "utf-8")),
  );
  assert.equal(verify.verification.overall, "pass");
  assert.equal(verify.verification.steps[0].durationMs, 1234);
  assert.equal(verify.verification.steps[0].logPath, "logs/build.log");
  const buildLog = fs.readFileSync(
    path.join(dir!, "logs", "build.log"),
    "utf-8",
  );
  assert.match(buildLog, /pnpm test/);
  assert.match(buildLog, /15 passed/);
});

test("accept sin gate: fall-through legacy (handled=false) para aceptar igual", async () => {
  makeItem("job-bridge-accept");
  const fake = fakeRuntime("run-bridge-accept");
  await runWorkflowJob("job-bridge-accept", fake.runtime);
  fake.setRun({
    id: "run-bridge-accept",
    workflow: "factory-default",
    status: "completed",
    nodes: {},
  });
  const result = await tryHandleWorkflowAction({
    domain: "job-review-accept",
    itemId: "job-bridge-accept",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(result.handled, false, "sin gate cae a la ruta legacy (Complete + PR)");
});

test("node_session_attached namespaced: rol canónico por hoja y nodeSessions namespaced", async () => {
  makeItem("job-bridge-ns");
  const fake = fakeRuntime("run-bridge-ns");
  await runWorkflowJob("job-bridge-ns", fake.runtime);
  handleRunEvent(
    {
      ts: "",
      type: "node_session_attached",
      runId: "run-bridge-ns",
      workflow: "factory-default",
      nodeId: "build.implement",
      data: { sessionId: "ses-impl-1", agent: "implement" },
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-ns");
  assert.equal(item?.agentSessions?.implement, "ses-impl-1", "rol canónico por hoja");
  assert.equal(
    item?.engineRun?.nodeSessions?.["build.implement"],
    "ses-impl-1",
    "sesión namespaced por nodo del loop",
  );
  assert.equal(
    item?.engineRun?.nodeAgents?.["build.implement"],
    "implement",
    "agente real del nodo",
  );
});

test("node_session_attached por ronda: acumula sesiones sin pisar la vigente", async () => {
  makeItem("job-bridge-rounds");
  const fake = fakeRuntime("run-bridge-rounds");
  await runWorkflowJob("job-bridge-rounds", fake.runtime);
  const attached = (sessionId: string, iteration: number) =>
    handleRunEvent(
      {
        ts: "",
        type: "node_session_attached",
        runId: "run-bridge-rounds",
        workflow: "fix-issue",
        nodeId: "build.implement",
        data: { sessionId, agent: "implement", iteration },
      } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
      fake.runtime,
    );
  attached("ses-r1", 1);
  attached("ses-r2", 2);
  // El complete de la R2 re-espeja la misma sesión: no duplica la ronda.
  handleRunEvent(
    {
      ts: "",
      type: "node_completed",
      runId: "run-bridge-rounds",
      workflow: "fix-issue",
      nodeId: "build.implement",
      data: { sessionId: "ses-r2" },
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-rounds");
  assert.equal(
    item?.engineRun?.nodeSessions?.["build.implement"],
    "ses-r2",
    "la vigente sigue siendo la última ronda",
  );
  assert.equal(item?.agentSessions?.implement, "ses-r2");
  assert.deepEqual(item?.engineRun?.nodeSessionRounds, [
    { nodeId: "build.implement", iteration: 1, sessionId: "ses-r1" },
    { nodeId: "build.implement", iteration: 2, sessionId: "ses-r2" },
  ]);
});

test("contrato: factory-default declara los inputs que envía el bridge", () => {
  const repoRoot = process.cwd();
  const loaded = loadWorkflow("factory-default", {
    repoRoot,
    globalDir: process.env.TERMCANVAS_WORKFLOWS_DIR,
  });
  const inputs = factoryDefaultRunInputs("pedido", "job-contrato");
  for (const key of Object.keys(inputs)) {
    assert.ok(
      key in loaded.def.inputs,
      `factory-default no declara el input "${key}" que envía el bridge`,
    );
  }
});

test("contrato: factory-default corre con los inputs reales del bridge", async () => {
  const repoRoot = process.cwd();
  const runsDir = path.join(SANDBOX, "runs-contrato");
  const cwd = path.join(SANDBOX, "contrato-cwd");
  fs.mkdirSync(cwd, { recursive: true });
  const runner: AiNodeRunner = async (req) => {
    if (req.prompt.includes("Hacé el triage")) return { output: "triaje" };
    if (req.prompt.includes("Escribí una spec")) return { output: "spec" };
    if (req.prompt.includes("Revisá la implementación")) {
      return { output: '{"green":true,"findings":[]}' };
    }
    return { output: "impl" };
  };
  const run = await runWorkflow(
    loadWorkflow("factory-default", {
      repoRoot,
      globalDir: process.env.TERMCANVAS_WORKFLOWS_DIR,
    }),
    {
      cwd,
      runsDir,
      repoRoot,
      inputs: factoryDefaultRunInputs("arreglar login", "job-contrato"),
      aiRunner: runner,
      onApproval: async () => ({ decision: "approve", text: "ok" }),
    },
  );
  assert.equal(run.status, "completed");
  assert.equal(
    run.nodes["build.verify"].outputJson?.pass,
    true,
    "verify system-owned corrió real (skip honesto sin runner)",
  );
});

test("verify-runner: logs por step en el run + snippet corto en el mensaje", async () => {
  const repoRoot = process.cwd();
  const runsDir = path.join(SANDBOX, "runs-verifylogs");
  const cwd = path.join(SANDBOX, "verifylogs-cwd");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ scripts: { test: "node test-big.js" } }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(cwd, "test-big.js"),
    "process.stdout.write('x'.repeat(5000));\n",
    "utf-8",
  );
  const run = await runWorkflow(
    loadWorkflow("verify-runner", {
      repoRoot,
      globalDir: process.env.TERMCANVAS_WORKFLOWS_DIR,
    }),
    { cwd, runsDir, repoRoot },
  );
  assert.equal(run.status, "completed");
  const out = run.nodes.verify.outputJson as {
    pass: boolean;
    steps: Array<{ name: string; status: string; logSnippet: string; logPath?: string }>;
  };
  assert.equal(out.pass, true);
  assert.ok(Array.isArray(out.steps) && out.steps.length > 0);
  for (const step of out.steps) {
    assert.ok(
      (step.logSnippet ?? "").length <= 600,
      "snippet corto: el mensaje no carga el log",
    );
    assert.ok(
      typeof step.logPath === "string" && step.logPath.endsWith(".log"),
      "cada step deja su log auditable",
    );
    assert.ok(
      fs.existsSync(path.join(runsDir, run.id, "artifacts", step.logPath as string)),
      `el log existe en el run: ${step.logPath}`,
    );
  }
});

test("verify-runner: sin package.json pero con tests/ corre node --test como prueba real", async () => {
  const repoRoot = process.cwd();
  const runsDir = path.join(SANDBOX, "runs-verify-nodetest");
  const cwd = path.join(SANDBOX, "verify-nodetest-cwd");
  fs.mkdirSync(path.join(cwd, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "tests", "store.test.js"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('suma', () => { assert.equal(1 + 1, 2); });\n",
    "utf-8",
  );
  const run = await runWorkflow(
    loadWorkflow("verify-runner", {
      repoRoot,
      globalDir: process.env.TERMCANVAS_WORKFLOWS_DIR,
    }),
    { cwd, runsDir, repoRoot },
  );
  assert.equal(run.status, "completed");
  const out = run.nodes.verify.outputJson as {
    pass: boolean;
    steps: Array<{ name: string; command: string; status: string }>;
  };
  assert.equal(out.pass, true);
  const suite = out.steps.find((s) => s.command === "node --test tests/");
  assert.ok(suite, "la suite tests/ corre como step de comportamiento");
  assert.equal(suite?.status, "pass");
});

test("verify-runner: suite roja en tests/ voltea el pass (nada de verde inventado)", async () => {
  const repoRoot = process.cwd();
  const runsDir = path.join(SANDBOX, "runs-verify-nodetest-fail");
  const cwd = path.join(SANDBOX, "verify-nodetest-fail-cwd");
  fs.mkdirSync(path.join(cwd, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "tests", "store.test.js"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('roto', () => { assert.equal(1 + 1, 3); });\n",
    "utf-8",
  );
  const run = await runWorkflow(
    loadWorkflow("verify-runner", {
      repoRoot,
      globalDir: process.env.TERMCANVAS_WORKFLOWS_DIR,
    }),
    { cwd, runsDir, repoRoot },
  );
  assert.equal(run.status, "completed");
  const out = run.nodes.verify.outputJson as {
    pass: boolean;
    steps: Array<{ name: string; command: string; status: string }>;
  };
  assert.equal(out.pass, false, "suite roja = pass false");
  const suite = out.steps.find((s) => s.command === "node --test tests/");
  assert.equal(suite?.status, "fail");
});

test("review-report: el summary estructurado manda sobre la prosa cruda", async () => {
  makeItem("job-bridge-structured-summary");
  const fake = fakeRuntime("run-bridge-structured-summary");
  await runWorkflowJob("job-bridge-structured-summary", fake.runtime);
  fake.setRun({
    id: "run-bridge-structured-summary",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output:
          "Let me analyze this carefully. " +
          "Wait — I should re-read the guidance. ".repeat(40),
        outputJson: {
          green: true,
          summary: "El fix envuelve el parseo en try/catch y la suite pasa.",
          findings: [],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-structured-summary",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-structured-summary");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.ok(
    report.includes("El fix envuelve el parseo en try/catch y la suite pasa."),
    "el summary estructurado es lo que lee el humano",
  );
  assert.ok(!report.includes("Let me analyze"), "la prosa cruda no llega al reporte");
});

test("review-report: sin summary estructurado cae al curador (sin tics ni corte)", async () => {
  makeItem("job-bridge-fallback-summary");
  const fake = fakeRuntime("run-bridge-fallback-summary");
  await runWorkflowJob("job-bridge-fallback-summary", fake.runtime);
  fake.setRun({
    id: "run-bridge-fallback-summary",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: `Let me analyze this carefully. El cambio cumple el issue y no abre scope nuevo. Detalle extra que sobra. `.repeat(30),
        outputJson: { green: true, findings: [] },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-fallback-summary",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-fallback-summary");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.ok(report.includes("El cambio cumple el issue"), "curador preserva el veredicto");
  assert.ok(!report.includes("Let me analyze"), "curador saca el tic inicial");
});

test("review-report WS3: green con finding abierto sin disposición no es READY", async () => {
  makeItem("job-bridge-undispositioned");
  const fake = fakeRuntime("run-bridge-undispositioned");
  await runWorkflowJob("job-bridge-undispositioned", fake.runtime);
  fake.setRun({
    id: "run-bridge-undispositioned",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: false,
          summary: "El fix cierra el issue salvo un detalle de cobertura.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [
            {
              id: "f1",
              axis: "tests",
              severity: "info",
              file: "tests/store.test.ts",
              message: "falta el caso de borde del contador",
            },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-undispositioned",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-undispositioned");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(
    report,
    /verdict: NEEDS FIXES/,
    "un info abierto con green contradice el READY (WS3)",
  );
  assert.match(report, /readiness: blocked/, "el reporte no puede quedar ready");
  assert.match(
    report,
    /finding `f1` open without disposition \(TRACKED_FOLLOW_UP\/DECLINED\)/,
    "el motivo del bloqueo viaja como blocker de readiness",
  );
});

test("review-report WS3: green con todos los findings terminados es READY", async () => {
  makeItem("job-bridge-dispositioned");
  const fake = fakeRuntime("run-bridge-dispositioned");
  await runWorkflowJob("job-bridge-dispositioned", fake.runtime);
  fake.setRun({
    id: "run-bridge-dispositioned",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.implement": {
        id: "build.implement",
        status: "completed",
        attempts: 1,
        output: [
          "Implementación lista.",
          "",
          "## Dispositions",
          "- f1: FIXED — se agregó el caso de borde",
          "- f2: TRACKED_FOLLOW_UP — issue #123",
        ].join("\n"),
      },
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix cierra el issue y no quedan findings abiertos.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [
            { id: "f1", severity: "info", message: "detalle cubierto" },
            { id: "f2", severity: "minor", message: "detalle derivado" },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-dispositioned",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-dispositioned");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(report, /verdict: READY TO MERGE/, "sin abiertos, el verde es READY");
  assert.match(report, /open_findings: 0/, "FIXED/TRACKED_FOLLOW_UP no cuentan como abiertos");
  assert.ok(
    !report.includes("open without disposition"),
    "sin findings sin disposición no hay blocker WS3",
  );
});

test("review-report WS4: contrato que debilita un requisito del issue no es READY", async () => {
  makeItem("job-bridge-contract-weak");
  const fake = fakeRuntime("run-bridge-contract-weak");
  await runWorkflowJob("job-bridge-contract-weak", fake.runtime);
  fake.setRun({
    id: "run-bridge-contract-weak",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix pasa la suite y no quedan findings abiertos.",
          findings: [],
          contractCoverage: [
            {
              requirement: "Rq1: mantiene el estado en memoria",
              coveredBy: "R1",
              status: "weakened",
              note: "el scope lo rewordea a devolver",
            },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-contract-weak",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-contract-weak");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(
    report,
    /verdict: NEEDS FIXES/,
    "un requisito debilitado contradice el READY (WS4)",
  );
  assert.match(report, /readiness: blocked/, "el reporte no puede quedar ready");
  assert.ok(
    report.includes("not covered (weakened)"),
    "el blocker WS4 viaja al reporte",
  );
  assert.ok(
    report.includes("requirement `Rq1: mantiene el estado en memoria`"),
    "el blocker cita el requisito del issue",
  );
  assert.ok(
    report.includes("| Rq1: mantiene el estado en memoria |"),
    "la tabla de coverage muestra el requisito",
  );
  assert.ok(
    report.includes("| `R1` | weakened | el scope lo rewordea a devolver |"),
    "la tabla de coverage muestra coveredBy/status/nota",
  );
});

test("router: el workflow elegido llega a runtime.start con sus inputs", async () => {
  makeItem("job-bridge-routed");
  const fake = fakeRuntime("run-routed-1");
  setWorkflowRouterForTests(async () => ({
    workflow: "fix-issue",
    reason: "issue chico y claro",
    routedBy: "llm",
    sessionId: "ses-foreman-1",
  }));
  try {
    await runWorkflowJob("job-bridge-routed", fake.runtime);
    assert.equal(fake.started.length, 1);
    assert.equal(fake.started[0].name, "fix-issue");
    assert.deepEqual(fake.started[0].params.inputs, {
      request: "arreglar login",
      issue_ref: "(sin issue vinculado)",
      issue_body: "(sin cuerpo disponible)",
      bot_findings: "",
    });
    const item = workItemStore.get("job-bridge-routed");
    assert.equal(item?.engineRun?.workflow, "fix-issue");
    assert.equal(
      item?.agentSessions?.foreman,
      "ses-foreman-1",
      "la sesión del router se attachea como foreman",
    );
    const decisionEntry = (item?.timeline ?? []).find((entry) =>
      entry.message.includes(
        "engine: workflow elegido fix-issue — issue chico y claro",
      ),
    );
    assert.ok(decisionEntry, "el timeline registra la decisión del router");
    assert.deepEqual(
      (decisionEntry?.meta as { foremanDecision?: unknown } | undefined)
        ?.foremanDecision,
      { decision: "fix-issue", reason: "issue chico y claro" },
      "el meta alimenta el chip Routing decisions",
    );
    assert.equal(
      (decisionEntry?.meta as { sessionId?: unknown } | undefined)?.sessionId,
      "ses-foreman-1",
    );
  } finally {
    setSafeRouter();
  }
});

test("contrato: los workflows resolubles aceptan los inputs que arma el panel", () => {
  const repoRoot = process.cwd();
  for (const name of [
    "factory-default",
    "fix-issue",
    "plan-approve-implement",
  ]) {
    const loaded = loadWorkflow(name, {
      repoRoot,
      globalDir: process.env.TERMCANVAS_WORKFLOWS_DIR,
    });
    const inputs = runInputsForWorkflowDef(loaded.def, "pedido", "job-x");
    assert.ok(inputs !== null, `${name}: inputs satisfacibles`);
    for (const key of Object.keys(inputs)) {
      assert.ok(key in loaded.def.inputs, `${name}: input no declarado ${key}`);
    }
    for (const [key, spec] of Object.entries(loaded.def.inputs)) {
      if (spec.required === true && spec.default === undefined) {
        assert.ok(key in inputs, `${name}: required ${key} sin valor`);
      }
    }
  }
});

test("launch failure: el job va a Cancelled y notifica daemon-error", async () => {
  makeItem("job-bridge-launch-fail");
  const runtime = {
    async start() {
      throw new Error('input desconocido "workItemId"');
    },
  } as unknown as WorkflowRuntime;
  await runWorkflowJob("job-bridge-launch-fail", runtime);
  assert.equal(
    workItemStore.get("job-bridge-launch-fail")?.status,
    "Cancelled",
  );
  const notificationsRaw = fs.readFileSync(
    path.join(SANDBOX, ".notifications.json"),
    "utf-8",
  );
  assert.match(notificationsRaw, /launch-failed:job-bridge-launch-fail/);
  assert.match(notificationsRaw, /Run no pudo arrancar/);
});

test("auto-resume: reanuda runs parkeados del engine; kill switch lo apaga", async () => {
  makeItem("job-bridge-parked");
  const runId = "run-parked-1";
  const runs: Record<string, unknown> = {
    [runId]: { id: runId, workflow: "factory-default", status: "running", nodes: {} },
  };
  const resumedInterrupted: string[] = [];
  const runtime = {
    async start(name: string) {
      return {
        id: runId,
        workflow: name,
        status: "running",
        startedAt: "2026-09-12T00:00:00.000Z",
      };
    },
    getRun(id: string) {
      return runs[id] ?? null;
    },
    isActive() {
      return false;
    },
    async resumeInterrupted(id: string) {
      resumedInterrupted.push(id);
      return runs[id];
    },
  } as unknown as WorkflowRuntime;
  await runWorkflowJob("job-bridge-parked", runtime);
  // Gate colgado + marcador de parqueo (mismo que `parkInterruptedJobs`).
  handleGate({
    runId,
    nodeId: "approve",
    message: "aprobar?",
    decisions: ["approve", "reject"],
    attempt: 1,
  });
  assert.ok(workItemStore.get("job-bridge-parked")?.engineGate);
  workItemStore.appendEvent(
    "job-bridge-parked",
    "system",
    "daemon reiniciado: turno interrumpido",
    { [BOOT_INTERRUPTED_META_KEY]: true, fromStatus: "Review" },
  );
  setWorkflowRuntimeProvider(() => runtime);
  autoResumeParkedEngineJobs(0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(resumedInterrupted, [runId]);
  assert.equal(
    workItemStore.get("job-bridge-parked")?.engineGate,
    null,
    "el gate viejo se limpia antes de reanudar (se re-levanta si aplica)",
  );

  resumedInterrupted.length = 0;
  process.env.TERMCANVAS_FACTORY_NO_AUTORESUME = "1";
  autoResumeParkedEngineJobs(0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(resumedInterrupted, [], "kill switch apaga el auto-resume");
  delete process.env.TERMCANVAS_FACTORY_NO_AUTORESUME;
});

test("auto-resume: interrupción vieja (>24h) queda para Retomar manual", async () => {
  const fake = fakeRuntime("run-stale-1");
  makeItem("job-bridge-stale");
  await runWorkflowJob("job-bridge-stale", fake.runtime);
  workItemStore.appendEvent(
    "job-bridge-stale",
    "system",
    "daemon reiniciado: turno interrumpido",
    {
      [BOOT_INTERRUPTED_META_KEY]: true,
      [BOOT_INTERRUPTED_AT_META_KEY]: new Date(
        Date.now() - 48 * 60 * 60 * 1000,
      ).toISOString(),
      fromStatus: "Review",
    },
  );
  setWorkflowRuntimeProvider(() => fake.runtime);
  autoResumeParkedEngineJobs(0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(fake.resumed, [], "una interrupción de 48h no se auto-reanuda");
});

test("auto-resume: tras 3 auto-resumes sin terminal deja de reanudarse solo", async () => {
  const fake = fakeRuntime("run-attempts-1");
  makeItem("job-bridge-attempts");
  await runWorkflowJob("job-bridge-attempts", fake.runtime);
  for (let i = 0; i < 3; i++) {
    workItemStore.appendEvent(
      "job-bridge-attempts",
      "system",
      "engine: run reanudado",
      { [RESUMED_META_KEY]: true },
    );
  }
  workItemStore.appendEvent(
    "job-bridge-attempts",
    "system",
    "daemon reiniciado: turno interrumpido",
    {
      [BOOT_INTERRUPTED_META_KEY]: true,
      [BOOT_INTERRUPTED_AT_META_KEY]: new Date().toISOString(),
      fromStatus: "Review",
    },
  );
  setWorkflowRuntimeProvider(() => fake.runtime);
  autoResumeParkedEngineJobs(0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(fake.resumed, [], "3 intentos previos cortan el auto-resume");
});

test("auto-resume: cap por boot (5) y los más nuevos primero", async () => {
  const ids = Array.from({ length: 6 }, (_, i) => `job-bridge-cap-${i + 1}`);
  const runs: Record<string, unknown> = {};
  const resumed: string[] = [];
  const runtime = {
    async start(name: string, params: Record<string, unknown>) {
      const workItemId = String(
        (params.inputs as Record<string, unknown>).workItemId,
      );
      const runId = `run-cap-${workItemId}`;
      const run = { id: runId, workflow: name, status: "running", nodes: {} };
      runs[runId] = run;
      return run;
    },
    getRun(id: string) {
      return runs[id] ?? null;
    },
    isActive() {
      return false;
    },
    async resumeInterrupted(id: string) {
      resumed.push(id);
      return runs[id];
    },
  } as unknown as WorkflowRuntime;
  for (let i = 0; i < ids.length; i++) {
    makeItem(ids[i]);
    await runWorkflowJob(ids[i], runtime);
    workItemStore.appendEvent(
      ids[i],
      "system",
      "daemon reiniciado: turno interrumpido",
      {
        [BOOT_INTERRUPTED_META_KEY]: true,
        [BOOT_INTERRUPTED_AT_META_KEY]: new Date(
          Date.now() - i * 1000,
        ).toISOString(),
        fromStatus: "Review",
      },
    );
  }
  setWorkflowRuntimeProvider(() => runtime);
  autoResumeParkedEngineJobs(0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(resumed.length, 5, "solo el cap por boot");
  assert.ok(
    resumed.includes("run-cap-job-bridge-cap-1"),
    "el más nuevo entra",
  );
  assert.equal(
    resumed.includes("run-cap-job-bridge-cap-6"),
    false,
    "el más viejo queda para Retomar",
  );
});

test("job-discard con run: teardown completo (el job no resurrecta)", async () => {
  const fake = fakeRuntime("run-discard-1");
  makeItem("job-bridge-discard");
  await runWorkflowJob("job-bridge-discard", fake.runtime);
  assert.ok(workItemStore.get("job-bridge-discard"), "job creado");
  const result = await tryHandleWorkflowAction({
    domain: "job-discard",
    itemId: "job-bridge-discard",
    runtime: fake.runtime,
    req: fakeReq(),
  });
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.equal(
    workItemStore.has("job-bridge-discard"),
    false,
    "el discard borra el job del store (sin teardown resurrecta en el restore)",
  );
  assert.equal(
    runIdForItem("job-bridge-discard"),
    null,
    "el engine-map se desvincula (un run huérfano no revive el job)",
  );
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

test("isWorkflowEngineEnabled: el engine es el pipeline único (legacy retirado)", () => {
  assert.equal(isWorkflowEngineEnabled(), true);
  process.env.TERMCANVAS_FACTORY_ENGINE = "legacy";
  assert.equal(
    isWorkflowEngineEnabled(),
    true,
    "el switch legacy ya no existe — siempre engine",
  );
  delete process.env.TERMCANVAS_FACTORY_ENGINE;
});

// ── WS-D: puerta de discoveries (sin disposición no hay verde) ──

test("review-report WS-D: discovery sin disposición no es READY", async () => {
  makeItem("job-bridge-discovery-untracked");
  const fake = fakeRuntime("run-bridge-discovery-untracked");
  await runWorkflowJob("job-bridge-discovery-untracked", fake.runtime);
  fake.setRun({
    id: "run-bridge-discovery-untracked",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix cierra el issue.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [],
          discoveries: [
            {
              id: "D1",
              title: "el banner de lectura se reusa para el write",
              status: "recorded",
            },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-discovery-untracked",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-discovery-untracked");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(report, /verdict: NEEDS FIXES/, "una discovery sin disponer bloquea el verde");
  assert.match(report, /readiness: blocked/);
  assert.match(
    report,
    /discovery `D1` untracked \(recorded: needs accepted\+issue or dropped\+reason\)/,
    "el motivo viaja como blocker de readiness",
  );
});

test("review-report WS-D: discovery dropped con razón no bloquea", async () => {
  makeItem("job-bridge-discovery-dropped");
  const fake = fakeRuntime("run-bridge-discovery-dropped");
  await runWorkflowJob("job-bridge-discovery-dropped", fake.runtime);
  fake.setRun({
    id: "run-bridge-discovery-dropped",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix cierra el issue y la discovery se descartó con razón.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [],
          discoveries: [
            {
              id: "D1",
              title: "copy de otro estado",
              status: "dropped",
              note: "preferencia, no bug; sin acción",
            },
          ],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-discovery-dropped",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-discovery-dropped");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(report, /verdict: READY TO MERGE/);
  // Pre-PR el bot todavía no llegó: la readiness honesta es pending hasta el publish.
  assert.match(report, /readiness: pending/);
  assert.ok(!report.includes("untracked"), "dropped con razón no bloquea");
});

test("review-report WS-D: accepted con issue en la razón queda tracked", async () => {
  makeItem("job-bridge-discovery-accepted");
  const fake = fakeRuntime("run-bridge-discovery-accepted");
  await runWorkflowJob("job-bridge-discovery-accepted", fake.runtime);
  fake.setRun({
    id: "run-bridge-discovery-accepted",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.implement": {
        id: "build.implement",
        status: "completed",
        attempts: 1,
        output: [
          "Implementación lista.",
          "",
          "## Discoveries",
          "- D1 — reloj sin sincronizar — accepted: issue #163 creado",
        ].join("\n"),
      },
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix cierra el issue; la discovery quedó trackeada.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-discovery-accepted",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-discovery-accepted");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(report, /verdict: READY TO MERGE/);
  assert.ok(!report.includes("untracked"), "accepted con issue en la razón no bloquea");
});

test("review-report WS-D: dropped sin razón no dispone la discovery", async () => {
  makeItem("job-bridge-discovery-empty-drop");
  const fake = fakeRuntime("run-bridge-discovery-empty-drop");
  await runWorkflowJob("job-bridge-discovery-empty-drop", fake.runtime);
  fake.setRun({
    id: "run-bridge-discovery-empty-drop",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix cierra el issue.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [],
          discoveries: [{ id: "D1", title: "algo", status: "dropped" }],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-discovery-empty-drop",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-discovery-empty-drop");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(report, /verdict: NEEDS FIXES/, "dropped sin razón no es terminal");
  assert.match(report, /discovery `D1` untracked \(dropped: needs accepted\+issue or dropped\+reason\)/);
});

test("review-report WS-D: un 'Ningún hallazgo' explícito no es discovery", async () => {
  makeItem("job-bridge-discovery-none");
  const fake = fakeRuntime("run-bridge-discovery-none");
  await runWorkflowJob("job-bridge-discovery-none", fake.runtime);
  fake.setRun({
    id: "run-bridge-discovery-none",
    workflow: "fix-issue",
    status: "completed",
    startedAt: "2026-09-12T00:00:00Z",
    finishedAt: "2026-09-12T00:01:00Z",
    nodes: {
      "build.implement": {
        id: "build.implement",
        status: "completed",
        attempts: 1,
        output: [
          "Implementación lista.",
          "",
          "## Discoveries",
          "- Ningún hallazgo relevante fuera del scope.",
        ].join("\n"),
      },
      "build.review": {
        id: "build.review",
        status: "completed",
        attempts: 1,
        output: "",
        outputJson: {
          green: true,
          dispositionsComplete: true,
          summary: "El fix cierra el issue sin discoveries.",
          contractCoverage: [
            {
              requirement: "Rq1: el fix cierra el issue",
              coveredBy: "R1",
              status: "covered",
            },
          ],
          findings: [],
        },
      },
    },
  });
  handleRunEvent(
    {
      ts: "",
      type: "run_completed",
      runId: "run-bridge-discovery-none",
      workflow: "fix-issue",
    } as unknown as import("../headless-runtime/workflows/types.ts").WorkflowEvent,
    fake.runtime,
  );
  const item = workItemStore.get("job-bridge-discovery-none");
  const report = fs.readFileSync(path.join(item?.dir!, "review-report.md"), "utf-8");
  assert.match(report, /verdict: READY TO MERGE/);
  assert.ok(!report.includes("untracked"), "el negativo explícito no bloquea");
});

// ── WS-1/WS-4: ronda de reconciliación post-bot ──

function makeCompleteIsolatedJob(id: string, withBotRound = true): void {
  workItemStore.create({ id, prompt: "arreglar login", worktree: path.join(SANDBOX, "wt") });
  const item = workItemStore.get(id);
  if (!item) throw new Error("job no creado");
  (item as unknown as { isolation?: unknown }).isolation = {
    branch: "issue-7-login",
    baseBranch: "main",
    worktreePath: path.join(SANDBOX, "wt"),
    repoRoot: SANDBOX,
    state: "pr-open",
    prNumber: 7,
    prUrl: "https://github.com/o/r/pull/7",
  };
  if (withBotRound) {
    workItemStore.appendEvent(id, "system", "bot reconcile: 1 open finding(s) prepared", {
      botReconcile: {
        feedback: {
          verdict: "revise",
          summary: "Bot review sin reconciliar (1 finding).",
          findings: [{ message: "stale comment", file: "js/app.js" }],
        },
        openCount: 1,
      },
    });
  }
  workItemStore.transition(id, "Foreman", "system", "test setup");
  workItemStore.transition(id, "Building", "system", "test setup");
  workItemStore.transition(id, "Complete", "system", "test setup");
}

test("transiciones: Complete → Building habilitado para la reconciliación", () => {
  assert.deepEqual([...ALLOWED_TRANSITIONS.Complete], ["Building"]);
  assert.equal(canTransition("Complete", "Building"), true);
  assert.equal(canTransition("Complete", "Cancelled"), false);
});

test("reconciliación: arranca un run fix-issue con bot_findings (flag on)", async () => {
  const prev = process.env.TERMCANVAS_BOT_RECONCILE;
  process.env.TERMCANVAS_BOT_RECONCILE = "1";
  try {
    makeCompleteIsolatedJob("job-reconcile-ok");
    const fake = fakeRuntime("run-reconcile-1");
    const res = await startBotReconcileRun("job-reconcile-ok", fake.runtime);
    assert.deepEqual(res, { started: true, runId: "run-reconcile-1" });
    assert.equal(fake.started.length, 1);
    assert.equal(fake.started[0]?.name, "fix-issue");
    const inputs = (fake.started[0]?.params.inputs ?? {}) as Record<string, unknown>;
    assert.ok(
      String(inputs.bot_findings).includes("- f1 (js/app.js) — stale comment"),
      "los findings viajan como f1..fn",
    );
    const item = workItemStore.get("job-reconcile-ok");
    assert.equal(item?.status, "Building", "reabre Building");
    assert.equal(item?.engineRun?.reconcile, true, "el run queda marcado reconcile");
    assert.equal(item?.engineRun?.runId, "run-reconcile-1");
    assert.ok(
      (item?.timeline ?? []).some((e) => e.message.includes("engine: run de reconciliación")),
    );
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_BOT_RECONCILE;
    else process.env.TERMCANVAS_BOT_RECONCILE = prev;
  }
});

test("reconciliación: guards (sin evento, flag off) no arrancan ni reabren", async () => {
  const prev = process.env.TERMCANVAS_BOT_RECONCILE;
  process.env.TERMCANVAS_BOT_RECONCILE = "1";
  try {
    makeCompleteIsolatedJob("job-reconcile-noevent", false);
    const fake = fakeRuntime("run-guard-1");
    assert.deepEqual(await startBotReconcileRun("job-reconcile-noevent", fake.runtime), {
      started: false,
      reason: "no-bot-round",
    });
    assert.equal(fake.started.length, 0);
    assert.equal(workItemStore.get("job-reconcile-noevent")?.status, "Complete");
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_BOT_RECONCILE;
    else process.env.TERMCANVAS_BOT_RECONCILE = prev;
  }
  delete process.env.TERMCANVAS_BOT_RECONCILE;
  makeCompleteIsolatedJob("job-reconcile-flagoff");
  const fake2 = fakeRuntime("run-guard-2");
  assert.deepEqual(await startBotReconcileRun("job-reconcile-flagoff", fake2.runtime), {
    started: false,
    reason: "flag-off",
  });
});

test("reconciliación: si el run no arranca, revierte a Complete con evento honesto", async () => {
  const prev = process.env.TERMCANVAS_BOT_RECONCILE;
  process.env.TERMCANVAS_BOT_RECONCILE = "1";
  try {
    makeCompleteIsolatedJob("job-reconcile-fail");
    const fake = fakeRuntime("run-reconcile-fail");
    (fake.runtime as unknown as { start: () => Promise<never> }).start = async () => {
      throw new Error("boom");
    };
    const res = await startBotReconcileRun("job-reconcile-fail", fake.runtime);
    assert.deepEqual(res, { started: false, reason: "start-failed" });
    const item = workItemStore.get("job-reconcile-fail");
    assert.equal(item?.status, "Complete", "vuelve a Complete");
    assert.ok(
      (item?.timeline ?? []).some((e) =>
        e.message.includes("reconciliación post-bot no pudo arrancar"),
      ),
    );
    // Sin marcador `botReconcileRun`, un segundo intento con runtime sano arranca.
    const retry = fakeRuntime("run-reconcile-retry");
    const res2 = await startBotReconcileRun("job-reconcile-fail", retry.runtime);
    assert.deepEqual(res2, { started: true, runId: "run-reconcile-retry" });
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_BOT_RECONCILE;
    else process.env.TERMCANVAS_BOT_RECONCILE = prev;
  }
});

test("reconciliación: cap 1 — un segundo arranque no dispara", async () => {
  const prev = process.env.TERMCANVAS_BOT_RECONCILE;
  process.env.TERMCANVAS_BOT_RECONCILE = "1";
  try {
    makeCompleteIsolatedJob("job-reconcile-cap");
    const fake = fakeRuntime("run-cap-1");
    const first = await startBotReconcileRun("job-reconcile-cap", fake.runtime);
    assert.deepEqual(first, { started: true, runId: "run-cap-1" });
    // El run de reconciliación termina y el job vuelve a Complete.
    workItemStore.transition("job-reconcile-cap", "Complete", "system", "test: run completo");
    const second = fakeRuntime("run-cap-2");
    assert.deepEqual(await startBotReconcileRun("job-reconcile-cap", second.runtime), {
      started: false,
      reason: "already-started",
    });
    assert.equal(second.started.length, 0, "sin segundo run");
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_BOT_RECONCILE;
    else process.env.TERMCANVAS_BOT_RECONCILE = prev;
  }
});

test("reconcileFromAnyCaller: resuelve el runtime del provider (callers humanos)", async () => {
  const prev = process.env.TERMCANVAS_BOT_RECONCILE;
  process.env.TERMCANVAS_BOT_RECONCILE = "1";
  try {
    makeCompleteIsolatedJob("job-reconcile-provider");
    const fake = fakeRuntime("run-provider-1");
    setWorkflowRuntimeProvider(() => fake.runtime);
    reconcileFromAnyCaller("job-reconcile-provider");
    // El arranque es async: esperar a que la transición a Building aterrice.
    let item = workItemStore.get("job-reconcile-provider");
    for (
      let i = 0;
      i < 40 && (fake.started.length === 0 || item?.status !== "Building");
      i += 1
    ) {
      await new Promise((r) => setTimeout(r, 10));
      item = workItemStore.get("job-reconcile-provider");
    }
    assert.equal(fake.started.length, 1, "arrancó vía provider");
    assert.equal(fake.started[0]?.name, "fix-issue");
    assert.equal(item?.status, "Building");
    assert.equal(item?.engineRun?.reconcile, true);

    // Flag off: no-op silencioso aunque el provider exista.
    delete process.env.TERMCANVAS_BOT_RECONCILE;
    makeCompleteIsolatedJob("job-reconcile-provider-off");
    reconcileFromAnyCaller("job-reconcile-provider-off");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fake.started.length, 1, "flag off no arranca");
    assert.equal(workItemStore.get("job-reconcile-provider-off")?.status, "Complete");
  } finally {
    if (prev === undefined) delete process.env.TERMCANVAS_BOT_RECONCILE;
    else process.env.TERMCANVAS_BOT_RECONCILE = prev;
  }
});
