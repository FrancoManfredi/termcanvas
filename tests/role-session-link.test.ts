// role-session-link: View Agent opens the session doing the real work.
// Daemon `liveSession` extras (per-role opencode session) win over the MVP
// `dashboardUrl` tracking link; junk degrades to the MVP link, never throws.
// Offline: zero network, zero daemon.
import test from "node:test";
import assert from "node:assert/strict";
import { allSessionsExtras, hookRunsExtras, roleSessionExtras } from "../headless-runtime/workItem/jobView.ts";
import {
  describeFactoryJobForPanel,
  readFactoryJobHookRuns,
  readFactoryJobSessionLink,
  readFactoryJobSessions,
  readRoleSessionLink,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import { buildAgentTimeline } from "../src/features/warpPanel/adapters/agentTimeline.ts";

const URL = "http://127.0.0.1:20274/abc/session/ses_role1";
const MVP_URL = "http://127.0.0.1:20274/def/session/ses_mvp1";

function buildUrl(sessionId: string, directory?: string): string {
  return `http://127.0.0.1:20274/enc/${sessionId}`;
}

test("roleSessionExtras maps status to the working role", () => {
  const sessions = {
    foreman: "ses_f1",
    triage: "ses_t1",
    implement: "ses_i1",
    review: "ses_r1",
  };
  const cases: Array<[unknown, string]> = [
    ["Foreman", "foreman"],
    ["Triage", "triage"],
    ["Building", "implement"],
    ["Review", "review"],
  ];
  for (const [status, role] of cases) {
    const out = roleSessionExtras(
      { status, agentSessions: sessions, worktree: "C:/r" },
      buildUrl,
    ) as { liveSession?: { role: string; sessionId: string; sessionUrl: string } };
    assert.ok(out.liveSession, `status ${String(status)} must link`);
    assert.equal(out.liveSession && out.liveSession.role, role);
    assert.ok(
      (out.liveSession && out.liveSession.sessionUrl.endsWith(
        (sessions as Record<string, string>)[role],
      )) === true,
    );
  }
});

test("roleSessionExtras degrades honestly (no role session, terminal, junk)", () => {
  assert.deepEqual(
    roleSessionExtras({ status: "Building", agentSessions: {}, worktree: "C:/r" }, buildUrl),
    {},
  );
  assert.deepEqual(
    roleSessionExtras({ status: "Complete", agentSessions: { implement: "ses_i1" } }, buildUrl),
    {},
  );
  assert.deepEqual(
    roleSessionExtras({ status: "Intake", agentSessions: { foreman: "ses_f1" } }, buildUrl),
    {},
  );
  assert.deepEqual(roleSessionExtras(null, buildUrl), {});
  assert.deepEqual(roleSessionExtras({ status: "Review", agentSessions: "junk" }, buildUrl), {});
  assert.deepEqual(
    roleSessionExtras({ status: "Review", agentSessions: { review: "  " } }, buildUrl),
    {},
  );
  assert.deepEqual(
    roleSessionExtras({ status: "Review", agentSessions: { review: "ses_r1" } }, () => {
      throw new Error("builder boom");
    }),
    {},
  );
});

test("panel prefers the role link over the MVP tracking link", () => {
  const job = {
    id: "job-1",
    status: "Building",
    liveSession: { role: "implement", sessionId: "ses_role1", sessionUrl: URL },
    dashboardUrl: MVP_URL,
  };
  const role = readRoleSessionLink(job);
  assert.ok(role);
  assert.equal(role && role.sessionUrl, URL);
  const mvp = readFactoryJobSessionLink(job);
  assert.ok(mvp);
  assert.equal(mvp && mvp.sessionUrl, MVP_URL);
  const described = describeFactoryJobForPanel(job);
  assert.ok(described);
  assert.equal(described && described.sessionUrl, URL);
});

test("panel falls back to the MVP link without liveSession", () => {
  const job = { id: "job-1", status: "Building", dashboardUrl: MVP_URL };
  assert.equal(readRoleSessionLink(job), null);
  const described = describeFactoryJobForPanel(job);
  assert.ok(described);
  assert.equal(described && described.sessionUrl, MVP_URL);
});

test("allSessionsExtras lista una entrada por rol con sesion, en orden de fase", () => {
  const out = allSessionsExtras(
    {
      worktree: "C:/repo",
      agentSessions: {
        review: "ses_rev",
        implement: "ses_imp",
        triage: "ses_tri",
        junk: 42,
      },
    },
    (sid: string) => `http://127.0.0.1:1/x/session/${sid}`,
  );
  const links = out.sessions as Array<{ role: string; sessionId: string; sessionUrl: string }>;
  assert.deepEqual(
    links.map((l) => l.role),
    ["triage", "implement", "review"],
  );
  assert.ok(links.every((l) => l.sessionUrl.includes(l.sessionId)));
});

test("loop_group F16: el nodo namespaced no duplica la fila canónica en Agent Sessions", () => {
  // Wire del daemon: `build.implement` ya cubierto por el alias canónico
  // `implement` (mismo sessionId) → manda el nodeId exacto, una sola entrada.
  const extras = allSessionsExtras(
    {
      worktree: "C:/repo",
      agentSessions: { foreman: "ses-f", triage: "ses-t", implement: "ses-i" },
      engineRun: {
        nodes: ["triage", "build.implement", "build.review"],
        nodeSessions: { "build.implement": "ses-i" },
      },
    },
    buildUrl,
  );
  const links = extras.sessions as Array<{ role: string; sessionUrl: string }>;
  assert.deepEqual(
    links.map((l) => l.role),
    ["foreman", "triage", "build.implement"],
  );

  const described = describeFactoryJobForPanel({
    id: "job-1",
    status: "Building",
    sessions: links,
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
    },
  });
  assert.ok(described);
  assert.deepEqual(
    buildAgentTimeline(described).stages.map(
      (s) => `${s.id}:${s.state}:${s.sessionUrl ?? "—"}`,
    ),
    [
      `foreman:completed:${buildUrl("ses-f")}`,
      `triage:completed:${buildUrl("ses-t")}`,
      `build.implement:running:${buildUrl("ses-i")}`,
      "build.review:pending:—",
    ],
  );
});

test("allSessionsExtras honesto sin sesiones ({} sin inventar)", () => {
  assert.deepEqual(allSessionsExtras({ worktree: "C:/repo" }, () => "http://x"), {});
  assert.deepEqual(allSessionsExtras({ worktree: "C:/repo", agentSessions: {} }, () => "http://x"), {});
});

test("panel expone sessions en el describe para el desplegable", () => {
  const job = {
    id: "job-1",
    status: "Review",
    liveSession: { role: "review", sessionId: "ses_r", sessionUrl: URL },
    sessions: [
      { role: "implement", sessionId: "ses_i", sessionUrl: "http://127.0.0.1:1/i" },
      { role: "review", sessionId: "ses_r", sessionUrl: URL },
    ],
  };
  const described = describeFactoryJobForPanel(job);
  assert.ok(described);
  assert.deepEqual(
    (described && described.sessions) ?? [],
    [
      { role: "implement", sessionUrl: "http://127.0.0.1:1/i" },
      { role: "review", sessionUrl: URL },
    ],
  );
});

test("readFactoryJobSessions ignora entradas rotas y ausentes", () => {
  assert.equal(readFactoryJobSessions(null), null);
  assert.equal(readFactoryJobSessions({ id: "x" }), null);
  assert.equal(readFactoryJobSessions({ sessions: [] }), null);
  const mixed = readFactoryJobSessions({
    sessions: [{ role: "implement", sessionUrl: URL }, { role: "", sessionUrl: URL }, null, 42],
  });
  assert.deepEqual(mixed, [{ role: "implement", sessionUrl: URL }]);
});

// ── Hooks declarativos: progreso + sesiones ──

test("hookRunsExtras: resume con URL solo ante sessionId válida", () => {
  assert.deepEqual(hookRunsExtras({ worktree: "C:/r" }, buildUrl), {});
  assert.deepEqual(hookRunsExtras({ hookRuns: [] }, buildUrl), {});
  const out = hookRunsExtras(
    {
      worktree: "C:/r",
      hookRuns: [
        { name: "playwright-tester", stage: "post-review", status: "fail", blocking: false, sessionId: "ses_h1" },
        { name: "roto" },
        null,
      ],
    },
    buildUrl,
  ) as { hookRuns?: Array<{ name: string; stage: string; status: string; sessionId: string | null; sessionUrl: string | null }> };
  assert.equal(out.hookRuns?.length, 1);
  assert.equal(out.hookRuns?.[0]?.name, "playwright-tester");
  assert.equal(out.hookRuns?.[0]?.stage, "post-review");
  assert.equal(out.hookRuns?.[0]?.sessionId, "ses_h1");
  assert.ok((out.hookRuns?.[0]?.sessionUrl ?? "").endsWith("ses_h1"));
  const sinSesion = hookRunsExtras(
    { hookRuns: [{ name: "x", stage: "pre-build", status: "pass" }] },
    buildUrl,
  ) as { hookRuns?: Array<{ sessionId: string | null; sessionUrl: string | null }> };
  assert.equal(sinSesion.hookRuns?.[0]?.sessionId, null);
  assert.equal(sinSesion.hookRuns?.[0]?.sessionUrl, null);
});

test("readFactoryJobHookRuns: valida y acota, roto → null", () => {
  assert.equal(readFactoryJobHookRuns(null), null);
  assert.equal(readFactoryJobHookRuns({ hookRuns: [] }), null);
  const mixed = readFactoryJobHookRuns({
    hookRuns: [
      { name: "playwright-tester", stage: "post-review", status: "fail", sessionUrl: URL },
      { name: "", stage: "x", status: "y" },
      { name: "x", stage: "", status: "y" },
      null,
    ],
  });
  assert.deepEqual(mixed, [
    { name: "playwright-tester", stage: "post-review", status: "fail", sessionUrl: URL },
  ]);
});

test("panel anexa hooks: info.hooks + filas hook: en sessions", () => {
  const job = {
    id: "job-1",
    status: "Review",
    sessions: [{ role: "review", sessionId: "ses_r", sessionUrl: URL }],
    hookRuns: [
      { name: "playwright-tester", stage: "post-review", status: "fail", blocking: false, sessionId: "ses_h", sessionUrl: URL },
    ],
  };
  const described = describeFactoryJobForPanel(job);
  assert.ok(described);
  assert.deepEqual(described?.hooks, [{ name: "playwright-tester", stage: "post-review", status: "fail" }]);
  assert.deepEqual(described?.sessions, [
    { role: "review", sessionUrl: URL },
    { role: "hook:playwright-tester", sessionUrl: URL },
  ]);
});

test("panel sin hooks: sin info.hooks ni filas extra", () => {
  const job = { id: "job-1", status: "Review", sessions: [{ role: "review", sessionId: "s", sessionUrl: URL }] };
  const described = describeFactoryJobForPanel(job);
  assert.ok(described);
  assert.equal(described?.hooks, undefined);
  assert.deepEqual(described?.sessions, [{ role: "review", sessionUrl: URL }]);
});

// ── Rondas de loop (VIEW AGENT por ronda) ──

function roundsJob() {
  return {
    worktree: "C:/repo",
    agentSessions: { implement: "ses-i2", review: "ses-r2" },
    engineRun: {
      nodes: ["triage", "build.implement", "build.review"],
      nodeSessions: { "build.implement": "ses-i2", "build.review": "ses-r2" },
      nodeSessionRounds: [
        { nodeId: "build.implement", iteration: 1, sessionId: "ses-i1" },
        { nodeId: "build.review", iteration: 1, sessionId: "ses-r1" },
        { nodeId: "build.implement", iteration: 2, sessionId: "ses-i2" },
        { nodeId: "build.review", iteration: 2, sessionId: "ses-r2" },
      ],
    },
  };
}

test("allSessionsExtras: la vigente lleva round y las previas viajan aparte", () => {
  const out = allSessionsExtras(roundsJob(), buildUrl);
  const links = out.sessions as Array<{
    role: string;
    sessionId: string;
    sessionUrl: string;
    round?: number;
  }>;
  const byRole = new Map(links.map((l) => [`${l.role}#${l.sessionId}`, l]));
  const impl = byRole.get("build.implement#ses-i2");
  assert.ok(impl, "la vigente del nodo sigue listada");
  assert.equal(impl && impl.round, 2, "la vigente marca su ronda");
  const implR1 = byRole.get("build.implement#ses-i1");
  assert.ok(implR1, "la R1 viaja como entrada propia");
  assert.equal(implR1 && implR1.round, 1);
  assert.ok((implR1 && implR1.sessionUrl.endsWith("ses-i1")) === true);
  const revR1 = byRole.get("build.review#ses-r1");
  assert.ok(revR1, "el review R1 también viaja");
  assert.equal(revR1 && revR1.round, 1);
  assert.deepEqual(
    links.filter((l) => l.role === "build.implement").map((l) => l.round),
    [2, 1],
    "vigente primero, previas en orden de llegada",
  );
});

test("allSessionsExtras: sin rondas el contrato previo no cambia", () => {
  const out = allSessionsExtras(
    {
      worktree: "C:/repo",
      agentSessions: { implement: "ses-i" },
      engineRun: {
        nodes: ["build.implement"],
        nodeSessions: { "build.implement": "ses-i" },
      },
    },
    buildUrl,
  );
  const links = out.sessions as Array<{
    role: string;
    sessionId: string;
    sessionUrl: string;
    round?: number;
  }>;
  assert.equal(links.length, 1);
  assert.equal(links[0] && links[0].role, "build.implement");
  assert.equal(links[0] && links[0].round, undefined);
});

test("readFactoryJobSessions conserva round y descarta basura", () => {
  const mixed = readFactoryJobSessions({
    sessions: [
      { role: "build.implement", sessionUrl: URL, round: 2 },
      { role: "build.implement", sessionUrl: "http://127.0.0.1:1/i1", round: 1 },
      { role: "build.implement", sessionUrl: "http://127.0.0.1:1/x", round: 0 },
      { role: "build.implement", sessionUrl: "http://127.0.0.1:1/y", round: "2" },
    ],
  });
  assert.deepEqual(mixed, [
    { role: "build.implement", sessionUrl: URL, round: 2 },
    { role: "build.implement", sessionUrl: "http://127.0.0.1:1/i1", round: 1 },
    { role: "build.implement", sessionUrl: "http://127.0.0.1:1/x" },
    { role: "build.implement", sessionUrl: "http://127.0.0.1:1/y" },
  ]);
});

test("buildAgentTimeline: la fila expone rounds y currentRound", () => {
  const extras = allSessionsExtras(roundsJob(), buildUrl);
  const links = extras.sessions as Array<{ role: string; sessionUrl: string; round?: number }>;
  const described = describeFactoryJobForPanel({
    id: "job-1",
    status: "Building",
    sessions: links,
    engineRun: {
      runId: "run-1",
      workflow: "fix-issue",
      status: "running",
      currentNodeId: "build.review",
      completedNodes: ["build.implement"],
      nodes: ["build.implement", "build.review"],
      nodeStates: { "build.implement": "completed", "build.review": "running" },
      nodeAgents: { "build.implement": "implement", "build.review": "review" },
    },
  });
  assert.ok(described);
  const stages = buildAgentTimeline(described).stages;
  const byId = new Map(stages.map((s) => [s.id, s]));
  const implement = byId.get("build.implement");
  assert.ok(implement);
  assert.equal(implement && implement.sessionUrl, buildUrl("ses-i2"));
  assert.equal(implement && implement.currentRound, 2);
  assert.deepEqual(implement && implement.rounds, [
    { round: 1, sessionUrl: buildUrl("ses-i1") },
  ]);
  const review = byId.get("build.review");
  assert.ok(review);
  assert.equal(review && review.currentRound, 2);
  assert.deepEqual(review && review.rounds, [
    { round: 1, sessionUrl: buildUrl("ses-r1") },
  ]);
});
