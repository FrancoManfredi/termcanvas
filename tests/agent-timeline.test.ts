/**
 * Derivación pura de Agent Progress / Agent Sessions (rebuild F2):
 * - Sin run: SOLO Foreman (routing).
 * - Con run: Foreman + nodos exactos del workflow, estado por nodo.
 * - Gate pendiente: nodo en `waiting-gate`.
 * - Sesiones: URL presente = habilitada (se attachea al enviar el mensaje).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { agentSessionSummary, buildAgentTimeline } from "../src/features/warpPanel/adapters/agentTimeline.ts";
import type { IssueFactoryJob } from "../src/features/warpPanel/types.ts";

function baseFactory(overrides: Partial<IssueFactoryJob> = {}): IssueFactoryJob {
  return {
    jobId: "job-1",
    stage: "Building",
    stageLabel: "Building",
    family: "running",
    stepIndex: 3,
    stepCount: 6,
    terminal: false,
    ...overrides,
  };
}

test("sin workflow elegido: solo Foreman (routing)", () => {
  const t = buildAgentTimeline(baseFactory({ stage: "Intake", family: "queued" }));
  assert.equal(t.routing, true);
  assert.equal(t.workflow, null);
  assert.equal(t.stages.length, 1);
  assert.equal(t.stages[0].id, "foreman");
  assert.equal(t.stages[0].state, "running");
});

test("con run: Foreman done + nodos exactos con estados reales", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineRun: {
        runId: "run-1",
        workflow: "factory-default",
        status: "running",
        currentNodeId: "implement",
        completedNodes: ["triage", "spec", "approve"],
        nodes: ["triage", "spec", "approve", "implement", "verify", "review"],
        nodeStates: {
          triage: "completed",
          spec: "completed",
          approve: "completed",
          implement: "running",
          verify: "pending",
          review: "pending",
        },
        nodeSessions: { implement: "ses-1" },
        nodeAgents: { implement: "implement" },
      },
      sessions: [
        { role: "foreman", sessionUrl: "http://127.0.0.1:4096/s/foreman" },
        { role: "implement", sessionUrl: "http://127.0.0.1:4096/s/implement" },
      ],
    }),
  );
  assert.equal(t.routing, false);
  assert.equal(t.workflow, "factory-default");
  assert.deepEqual(
    t.stages.map((s) => `${s.id}:${s.state}`),
    [
      "foreman:completed",
      "triage:completed",
      "spec:completed",
      "approve:completed",
      "implement:running",
      "verify:pending",
      "review:pending",
    ],
  );
  const implement = t.stages.find((s) => s.id === "implement");
  assert.equal(implement?.agent, "implement");
  assert.equal(implement?.sessionUrl, "http://127.0.0.1:4096/s/implement");
  const review = t.stages.find((s) => s.id === "review");
  assert.equal(review?.sessionUrl, null);
});

test("gate pendiente: el nodo del gate queda waiting-gate", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineGateNodeId: "approve",
      engineRun: {
        runId: "run-1",
        workflow: "factory-default",
        status: "running",
        currentNodeId: null,
        nodes: ["triage", "spec", "approve", "implement"],
        nodeStates: {
          triage: "completed",
          spec: "completed",
          approve: "pending",
          implement: "pending",
        },
      },
    }),
  );
  const approve = t.stages.find((s) => s.id === "approve");
  assert.equal(approve?.state, "waiting-gate");
});

test("job terminal legacy sin run: Foreman done + sesiones históricas", () => {
  const t = buildAgentTimeline(
    baseFactory({
      stage: "Complete",
      family: "terminal",
      terminal: true,
      sessions: [
        { role: "triage", sessionUrl: "http://x/1" },
        { role: "implement", sessionUrl: "http://x/2" },
      ],
    }),
  );
  assert.equal(t.routing, false);
  assert.deepEqual(
    t.stages.map((s) => s.id),
    ["foreman", "triage", "implement"],
  );
  assert.ok(t.stages.every((s) => s.state === "completed"));
});

test("nodo failed no aparece como completed", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineRun: {
        runId: "run-1",
        workflow: "factory-default",
        status: "failed",
        currentNodeId: null,
        nodes: ["triage", "implement"],
        nodeStates: { triage: "completed", implement: "failed" },
      },
    }),
  );
  const implement = t.stages.find((s) => s.id === "implement");
  assert.equal(implement?.state, "failed");
});

test("cancelled con run iniciado: Foreman completed (ruteó), el fallo es del nodo", () => {
  const t = buildAgentTimeline(
    baseFactory({
      stage: "Cancelled",
      family: "terminal",
      terminal: true,
      engineRun: {
        runId: "run-1",
        workflow: "plan-approve-implement",
        status: "failed",
        currentNodeId: null,
        nodes: ["plan", "gate", "build.implement"],
        nodeStates: {
          plan: "failed",
          gate: "skipped",
          "build.implement": "pending",
        },
      },
    }),
  );
  assert.equal(
    t.stages.find((s) => s.id === "foreman")?.state,
    "completed",
    "el Foreman ya había ruteado antes de que el run fallara",
  );
  assert.equal(t.stages.find((s) => s.id === "plan")?.state, "failed");
});

test("cancelled sin run: Foreman failed (no llegó a rutear)", () => {
  const t = buildAgentTimeline(
    baseFactory({ stage: "Cancelled", family: "terminal", terminal: true }),
  );
  assert.equal(t.stages.find((s) => s.id === "foreman")?.state, "failed");
});

test("sesión sin nodo en el orden (legacy/resume) se anexa al final", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineRun: {
        runId: "run-1",
        workflow: "factory-default",
        status: "running",
        nodes: ["triage"],
        nodeStates: { triage: "running" },
      },
      sessions: [{ role: "spec", sessionUrl: "http://x/spec" }],
    }),
  );
  const ids = t.stages.map((s) => s.id);
  assert.ok(ids.includes("spec"));
  assert.equal(ids[ids.length - 1], "spec");
});

test("ids namespaced de loop_group: label corto y estado por nodo", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineRun: {
        runId: "run-1",
        workflow: "factory-default",
        status: "running",
        nodes: ["build.implement", "build.verify", "build.review"],
        currentNodeId: "build.verify",
        nodeStates: {
          "build.implement": "completed",
          "build.verify": "running",
          "build.review": "pending",
        },
        nodeSessions: { "build.implement": "ses-1" },
      },
      sessions: [
        { role: "build.implement", sessionUrl: "http://x/implement" },
      ],
    }),
  );
  assert.deepEqual(
    t.stages.map((s) => `${s.id}:${s.label}:${s.state}`),
    [
      "foreman:Foreman:completed",
      "build.implement:implement:completed",
      "build.verify:verify:running",
      "build.review:review:pending",
    ],
  );
  const implement = t.stages.find((s) => s.id === "build.implement");
  assert.equal(implement?.sessionUrl, "http://x/implement");
  assert.ok(
    !t.stages.some((s) => s.id === "implement"),
    "sin fila fantasma del alias canónico por hoja",
  );
});

test("kind: verify system-owned no cuenta como sesión de agente", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineRun: {
        runId: "run-1",
        workflow: "fix-issue",
        status: "running",
        currentNodeId: "build.review",
        completedNodes: ["triage", "build.implement", "build.verify"],
        nodes: ["triage", "build.implement", "build.verify", "build.review"],
        nodeStates: {
          triage: "completed",
          "build.implement": "completed",
          "build.verify": "completed",
          "build.review": "running",
        },
        nodeAgents: { "build.implement": "implement", "build.review": "review" },
        nodeSessions: { "build.implement": "ses-i", "build.review": "ses-r" },
      },
      sessions: [
        { role: "foreman", sessionUrl: "http://x/foreman" },
        { role: "triage", sessionUrl: "http://x/triage" },
        { role: "build.implement", sessionUrl: "http://x/impl" },
        { role: "build.review", sessionUrl: "http://x/rev" },
      ],
    }),
  );
  const byId = new Map(t.stages.map((stage) => [stage.id, stage]));
  assert.equal(byId.get("build.verify")?.kind, "system");
  assert.equal(byId.get("build.verify")?.sessionUrl, null);
  assert.equal(byId.get("triage")?.kind, "agent");
  assert.equal(byId.get("build.implement")?.kind, "agent");
  assert.equal(byId.get("build.review")?.kind, "agent");
  assert.deepEqual(agentSessionSummary(t.stages), {
    available: 4,
    agentTotal: 4,
    systemTotal: 1,
  });
});

test("kind: etapa pendiente sin sesión sigue siendo agent, no system", () => {
  const t = buildAgentTimeline(
    baseFactory({
      engineRun: {
        runId: "run-1",
        workflow: "fix-issue",
        status: "running",
        nodes: ["triage", "build.verify"],
        nodeStates: { triage: "completed", "build.verify": "pending" },
      },
      sessions: [{ role: "triage", sessionUrl: "http://x/t" }],
    }),
  );
  assert.equal(
    t.stages.find((stage) => stage.id === "build.verify")?.kind,
    "agent",
    "pendiente ≠ system (todavía puede adjuntar sesión)",
  );
  assert.deepEqual(agentSessionSummary(t.stages), {
    available: 1,
    agentTotal: 3,
    systemTotal: 0,
  });
});

// ─── Render (WS-UI): sys al costado en el stepper + chip SYSTEM en sesiones ──

function factoryWithVerify(): IssueFactoryJob {
  return baseFactory({
    engineRun: {
      runId: "run-1",
      workflow: "fix-issue",
      status: "running",
      currentNodeId: "build.review",
      completedNodes: ["triage", "build.implement", "build.verify"],
      nodes: ["triage", "build.implement", "build.verify", "build.review"],
      nodeStates: {
        triage: "completed",
        "build.implement": "completed",
        "build.verify": "completed",
        "build.review": "running",
      },
      nodeAgents: { "build.implement": "implement", "build.review": "review" },
      nodeSessions: { "build.implement": "ses-i", "build.review": "ses-r" },
    },
    sessions: [
      { role: "foreman", sessionUrl: "http://x/foreman" },
      { role: "triage", sessionUrl: "http://x/triage" },
      { role: "build.implement", sessionUrl: "http://x/impl" },
      { role: "build.review", sessionUrl: "http://x/rev" },
    ],
  });
}

test("AgentProgressStages: verify system-owned va a un costado, no entre agentes", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { AgentProgressStages } = await import(
    "../src/features/warpPanel/components/AgentProgressStages.tsx"
  );
  const timeline = buildAgentTimeline(factoryWithVerify());
  const html = renderToString(createElement(AgentProgressStages, { timeline }));
  const sideAt = html.indexOf("System-owned stages");
  assert.ok(sideAt > 0, "bloque lateral presente");
  assert.ok(html.indexOf("review") > -1 && html.indexOf("review") < sideAt, "agentes antes del costado");
  assert.ok(html.indexOf("verify") > sideAt, "verify vive en el costado");
});

test("AgentSessionsPanel: fila SYSTEM sin botón y contador solo de agentes", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { AgentSessionsPanel } = await import(
    "../src/features/warpPanel/components/AgentSessionsPanel.tsx"
  );
  const html = renderToString(
    createElement(AgentSessionsPanel, { factory: factoryWithVerify() }),
  );
  assert.match(html, /SYSTEM/);
  assert.match(html, /system check/);
  assert.match(html, /4\/4/);
  assert.match(html, /1 system-owned/);
  assert.equal(
    html.split("VIEW AGENT").length - 1,
    4,
    "solo las 4 etapas de agente ofrecen VIEW AGENT",
  );
});

// ─── Rondas de loop: la fila expone cada ronda sin duplicar VIEW AGENT ──

function factoryWithRounds(): IssueFactoryJob {
  return baseFactory({
    engineRun: {
      runId: "run-1",
      workflow: "fix-issue",
      status: "running",
      currentNodeId: "build.implement",
      completedNodes: ["triage"],
      nodes: ["triage", "build.implement", "build.review"],
      nodeStates: {
        triage: "completed",
        "build.implement": "running",
        "build.review": "pending",
      },
      nodeAgents: { "build.implement": "implement" },
      nodeSessions: { "build.implement": "ses-i2" },
    },
    sessions: [
      { role: "build.implement", sessionUrl: "http://x/impl2", round: 2 },
      { role: "build.implement", sessionUrl: "http://x/impl1", round: 1 },
    ],
  });
}

test("timeline: rounds y currentRound llegan a la etapa", () => {
  const t = buildAgentTimeline(factoryWithRounds());
  const implement = t.stages.find((s) => s.id === "build.implement");
  assert.ok(implement);
  assert.equal(implement && implement.sessionUrl, "http://x/impl2");
  assert.equal(implement && implement.currentRound, 2);
  assert.deepEqual(implement && implement.rounds, [
    { round: 1, sessionUrl: "http://x/impl1" },
  ]);
});

test("timeline: sin rounds la etapa queda como antes (vacío, null)", () => {
  const t = buildAgentTimeline(factoryWithVerify());
  const implement = t.stages.find((s) => s.id === "build.implement");
  assert.ok(implement);
  assert.deepEqual(implement && implement.rounds, []);
  assert.equal(implement && implement.currentRound, null);
});

test("AgentSessionsPanel: selector R1/R2 y VIEW AGENT apunta a la vigente", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { AgentSessionsPanel } = await import(
    "../src/features/warpPanel/components/AgentSessionsPanel.tsx"
  );
  const html = renderToString(
    createElement(AgentSessionsPanel, { factory: factoryWithRounds() }),
  );
  // Segmentos del picker (radiogroup por fila con rondas).
  assert.match(html, /Session rounds for IMPLEMENT/);
  assert.ok(html.includes(">R1<"), "segmento R1 presente");
  assert.ok(html.includes(">R2<"), "segmento R2 presente");
  // Por defecto abre la vigente (R2); un solo botón por fila.
  assert.match(html, /View IMPLEMENT agent session \(R2\)/);
  assert.equal(
    html.split("VIEW AGENT").length - 1,
    3,
    "foreman + implement + review mantienen su botón (el picker no duplica)",
  );
  assert.equal(
    html.split('role="group"').length - 1,
    1,
    "solo la fila con rondas muestra el selector",
  );
});
