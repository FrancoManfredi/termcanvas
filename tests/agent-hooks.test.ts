/**
 * AgentHooks — agentes declarativos al pipeline sin tocar código.
 * Descubrimiento por directorio, contrato JSON estricto, advisory nunca
 * frena y blocking sí. Todo offline vía seams (cero LLM, cero red).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolsetFromList } from "../headless-runtime/runner/toolPolicy.ts";
import {
  discoverHookAgents,
  hasBlockingFailure,
  hookStagesExtras,
  listDeclaredHookAgents,
  listDeclaredHookStages,
  parseHookResponse,
  resetHookAgentsCache,
  runStageHooks,
  setHookAgentsDirForTests,
  setHookSeamsForTests,
  type HookAgentDef,
  type HookContext,
} from "../headless-runtime/factory/agents/agentHooks.ts";
import { bumpAgentDefsRevision } from "../headless-runtime/factory/agentLoader.ts";
import { setTestClient } from "../headless-runtime/opencodeServerManager.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";

function mkAgent(over: Partial<HookAgentDef> = {}): HookAgentDef {
  return {
    name: "demo-hook",
    description: "demo",
    tools: { read: true },
    model: null,
    skills: [],
    stage: "post-review",
    blocking: false,
    body: "hace demo",
    ...over,
  };
}

function mkCtx(): HookContext {
  return { workItemId: "job-hooks-01", worktreePath: "/tmp/wt", prompt: "hacer x" };
}

// ── toolsetFromList ──

test("toolsetFromList: otorga conocidas, descarta desconocidas, vacío → {}", () => {
  assert.deepEqual(toolsetFromList(["read", "bash", "webfetch"]), { read: true, bash: true, webfetch: true });
  assert.deepEqual(toolsetFromList(["read", "rayos-x", 42]), { read: true });
  assert.deepEqual(toolsetFromList([]), {});
  assert.deepEqual(toolsetFromList(null), {});
  assert.deepEqual(toolsetFromList({ read: true, glob: true }), { read: true, glob: true });
  const a = toolsetFromList(["read"]);
  const b = toolsetFromList(["read"]);
  assert.notEqual(a, b, "copia fresca");
});

// ── Descubrimiento real ──

test("discoverHookAgents(post-review) encuentra al playwright-tester advisory sin escritura", () => {
  const found = discoverHookAgents("post-review");
  const tester = found.find((a) => a.name === "playwright-tester");
  assert.ok(tester, "el piloto se descubre por directorio");
  assert.equal(tester.stage, "post-review");
  assert.equal(tester.blocking, false, "advisory por default");
  assert.equal(tester.tools.read, true);
  assert.equal(tester.tools.bash, true);
  assert.equal(tester.tools.write, undefined, "sin escritura");
  assert.equal(tester.tools.edit, undefined, "sin escritura");
});

test("discoverHookAgents(pre-build/post-build) vacíos hoy (cero costo)", () => {
  assert.deepEqual(discoverHookAgents("pre-build"), []);
  assert.deepEqual(discoverHookAgents("post-build"), []);
});

// ── Contrato JSON ──

test("parseHookResponse: pass/fail válidos, resto → null sin lanzar", () => {
  const pass = parseHookResponse('```json\n{"verdict":"pass","confidence":0.9,"summary":"verde","findings":[]}\n```');
  assert.equal(pass?.verdict, "pass");
  assert.deepEqual(pass?.findings, []);
  const fail = parseHookResponse('prosa {"verdict":"fail","confidence":0.8,"summary":"roto","findings":[{"message":"x","file":"a.ts"}]} fin');
  assert.equal(fail?.verdict, "fail");
  assert.equal(fail?.findings[0]?.file, "a.ts");
  assert.equal(parseHookResponse("pura prosa"), null);
  assert.equal(parseHookResponse(JSON.stringify({ verdict: "maybe", confidence: 1, summary: "", findings: [] })), null);
  assert.equal(parseHookResponse(null), null);
});

// ── Runner con seams ──

test("runStageHooks: advisory fail anexa evento y no frena; blocking fail frena", async () => {
  const id = "job-hooks-02";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  const advisory = mkAgent({ name: "a-advisory", blocking: false });
  const blocking = mkAgent({ name: "b-blocking", blocking: true });
  try {
    const res = await runStageHooks("post-review", { ...mkCtx(), workItemId: id }, {
      listHookAgents: () => [advisory, blocking],
      runHookOnce: async (agent) => ({
        name: agent.name,
        stage: agent.stage,
        blocking: agent.blocking,
        status: "fail",
        summary: "falló el chequeo",
        findings: [{ message: "hallazgo demo" }],
        durationMs: 1,
      }),
    });
    assert.equal(res.length, 2);
    assert.equal(hasBlockingFailure(res), true, "el blocking en fail frena");
    const tl = (workItemStore.get(id)?.timeline ?? []).filter((e) => e.message.startsWith("hook:"));
    assert.equal(tl.length, 2, "un evento por hook");
    assert.ok(tl[0]?.message.includes("(advisory)"));
    assert.ok(tl[1]?.message.includes("(blocking)"));
  } finally {
    workItemStore.clear();
  }
});

test("runStageHooks: todo pass/advisory → hasBlockingFailure false", async () => {
  const res = await runStageHooks("post-review", mkCtx(), {
    listHookAgents: () => [mkAgent()],
    runHookOnce: async (agent) => ({
      name: agent.name, stage: agent.stage, blocking: agent.blocking,
      status: "pass", summary: "verde", findings: [], durationMs: 1,
    }),
  });
  assert.equal(hasBlockingFailure(res), false);
});

test("runStageHooks: runHookOnce que lanza → error sin romper el pipeline", async () => {
  const id = "job-hooks-03";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  try {
    const res = await runStageHooks("post-review", { ...mkCtx(), workItemId: id }, {
      listHookAgents: () => [mkAgent({ name: "roto", blocking: true })],
      runHookOnce: async () => { throw new Error("boom"); },
    });
    assert.equal(res.length, 1);
    assert.equal(res[0]?.status, "error");
    assert.equal(hasBlockingFailure(res), true, "blocking+error frena (fail-closed)");
  } finally {
    workItemStore.clear();
  }
});

test("runStageHooks: sin agentes → [] sin eventos ni costo", async () => {
  const res = await runStageHooks("pre-build", mkCtx(), { listHookAgents: () => [] });
  assert.deepEqual(res, []);
});

test("recordHookRun: una entrada por hook, cap y nunca lanza", async () => {
  const id = "job-hooks-store01";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  try {
    workItemStore.recordHookRun(id, { name: "tester", stage: "post-review", status: "fail", blocking: false, sessionId: "ses_1" });
    workItemStore.recordHookRun(id, { name: "tester", stage: "post-review", status: "pass", blocking: false, sessionId: "ses_2" });
    const stored = workItemStore.get(id) as unknown as { hookRuns?: Array<{ name: string; status: string; sessionId?: string }> };
    assert.equal(stored.hookRuns?.length, 1, "la nueva reemplaza a la anterior");
    assert.equal(stored.hookRuns?.[0]?.status, "pass");
    assert.equal(stored.hookRuns?.[0]?.sessionId, "ses_2");
    workItemStore.recordHookRun("no-existe", { name: "x", stage: "y", status: "pass" });
    workItemStore.recordHookRun(id, { name: "", stage: "", status: "" });
    assert.equal((workItemStore.get(id) as unknown as { hookRuns?: unknown[] }).hookRuns?.length, 1, "basura no entra");
  } finally {
    workItemStore.clear();
  }
});

test("runStageHooks registra hookRuns con sessionId del turno", async () => {
  const id = "job-hooks-store02";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  try {
    await runStageHooks("post-review", { ...mkCtx(), workItemId: id }, {
      listHookAgents: () => [mkAgent({ name: "tester" })],
      runHookOnce: async (agent) => ({
        name: agent.name, stage: agent.stage, blocking: agent.blocking,
        status: "pass", summary: "ok", findings: [], durationMs: 1, sessionId: "ses_hook_9",
      }),
    });
    const stored = workItemStore.get(id) as unknown as { hookRuns?: Array<{ name: string; sessionId?: string }> };
    assert.equal(stored.hookRuns?.length, 1);
    assert.equal(stored.hookRuns?.[0]?.name, "tester");
    assert.equal(stored.hookRuns?.[0]?.sessionId, "ses_hook_9");
  } finally {
    workItemStore.clear();
  }
});

test("setHookSeamsForTests: override global y reset", async () => {
  setHookSeamsForTests({
    listHookAgents: () => [mkAgent({ name: "global" })],
    runHookOnce: async (agent) => ({
      name: agent.name, stage: agent.stage, blocking: agent.blocking,
      status: "pass", summary: "ok", findings: [], durationMs: 1,
    }),
  });
  try {
    const res = await runStageHooks("post-review", mkCtx());
    assert.equal(res.length, 1);
    assert.equal(res[0]?.name, "global");
  } finally {
    setHookSeamsForTests(null);
  }
  // Tras el reset vuelve el descubrimiento real (pre-build vacío en disco).
  const rediscovered = await runStageHooks("pre-build", mkCtx());
  assert.deepEqual(rediscovered, [], "reset: sin override, pre-build vacío real");
});

// ── Camino LLM real con cliente falso (sin red, sin daemon) ──

type TestClientParam = Parameters<typeof setTestClient>[0];

function installHookClient(promptImpl: (n: number) => Promise<unknown>): { prompts: () => number } {
  let prompts = 0;
  const client = {
    session: {
      create: async () => ({ id: "ses_hook_test" }),
      prompt: async () => {
        prompts += 1;
        return promptImpl(prompts);
      },
    },
  };
  setTestClient(client as unknown as TestClientParam);
  return { prompts: () => prompts };
}

function hookPassText(): string {
  return JSON.stringify({ verdict: "pass", confidence: 0.9, summary: "verde", findings: [] });
}

test("camino LLM: reintenta 1 vez ante error de transporte y luego pasa", async () => {
  const id = "job-hooks-live01";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  const calls = installHookClient(async (n) => {
    if (n === 1) throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:9999");
    return { data: { text: hookPassText() } };
  });
  try {
    const agent = mkAgent({ name: "vivo", blocking: false });
    const res = await runStageHooks("post-review", { ...mkCtx(), workItemId: id }, {
      listHookAgents: () => [agent],
    });
    assert.equal(res.length, 1);
    assert.equal(res[0]?.status, "pass", "el reintento salva el hipo de transporte");
    assert.equal(calls.prompts(), 2, "exactamente 1 reintento");
    assert.equal(res[0]?.detail, undefined, "sin detail en éxito");
    assert.equal(res[0]?.sessionId, "ses_hook_test");
  } finally {
    try {
      setTestClient(null);
    } catch {}
    workItemStore.clear();
  }
});

test("camino LLM: timeout NO se reintenta y el error trae detail con la causa", async () => {
  const id = "job-hooks-live02";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  const calls = installHookClient(async () => {
    throw new Error("timeout 600000ms hook vivo session.prompt");
  });
  try {
    const agent = mkAgent({ name: "colgado", blocking: false });
    const res = await runStageHooks("post-review", { ...mkCtx(), workItemId: id }, {
      listHookAgents: () => [agent],
    });
    assert.equal(res.length, 1);
    assert.equal(res[0]?.status, "error");
    assert.equal(calls.prompts(), 1, "timeout jamás se reenvía");
    assert.match(res[0]?.detail ?? "", /timeout/, "detail con la causa (no más 'sin JSON' a ciegas)");
    const tl = (workItemStore.get(id)?.timeline ?? []).find((e) => e.message.startsWith("hook:"));
    const meta = (tl?.meta ?? {}) as { hook?: { detail?: string } };
    assert.match(meta.hook?.detail ?? "", /timeout/, "la meta del evento lleva el detail");
  } finally {
    try {
      setTestClient(null);
    } catch {}
    workItemStore.clear();
  }
});

test("camino LLM: respuesta sin JSON trae raw head en detail", async () => {
  const id = "job-hooks-live03";
  workItemStore.clear();
  workItemStore.create({ id, prompt: "x", worktree: "/tmp/wt" });
  installHookClient(async () => ({ data: { text: "pura prosa sin bloque" } }));
  try {
    const res = await runStageHooks("post-review", { ...mkCtx(), workItemId: id }, {
      listHookAgents: () => [mkAgent({ name: "parlanchin" })],
    });
    assert.equal(res[0]?.status, "error");
    assert.match(res[0]?.detail ?? "", /pura prosa sin bloque/, "raw head en detail");
  } finally {
    try {
      setTestClient(null);
    } catch {}
    workItemStore.clear();
  }
});

test("hookStagesExtras + listDeclaredHookStages: stages reales del disco", () => {
  const stages = listDeclaredHookStages();
  assert.ok(stages.includes("post-review"), "el piloto declara post-review");
  const extras = hookStagesExtras() as {
    hookStages?: string[];
    hookAgents?: Array<{ name: string; stage: string; blocking?: boolean }>;
  };
  assert.ok(Array.isArray(extras.hookStages), "forma {hookStages}");
  assert.ok((extras.hookStages ?? []).includes("post-review"));
  assert.ok(Array.isArray(extras.hookAgents), "forma {hookAgents} (nombre visible)");
  const pilot = (extras.hookAgents ?? []).find((a) => a.name === "playwright-tester");
  assert.ok(pilot, "el roster incluye playwright-tester");
  assert.equal(pilot?.stage, "post-review");
  assert.equal(pilot?.blocking, false);
});

test("roster hook: agente nuevo y cambio de stage en tiempo real (revisión)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-roster-"));
  const writeProbe = (stage: string, blocking: string): void => {
    fs.mkdirSync(path.join(dir, "qa-probe"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "qa-probe", "agent.md"),
      [
        "---",
        'description: "probe de roster"',
        "agentType: VERIFY",
        `stage: ${stage}`,
        `blocking: ${blocking}`,
        "---",
        "",
        "Body del probe.",
        "",
      ].join("\n"),
      "utf-8",
    );
  };
  try {
    setHookAgentsDirForTests(dir);
    resetHookAgentsCache();
    assert.deepEqual(listDeclaredHookAgents(), [], "sandbox vacío = sin roster");
    // Alta (lo que hace el POST /factory/agents + bump de revisión).
    writeProbe("post-review", "false");
    bumpAgentDefsRevision();
    assert.deepEqual(listDeclaredHookAgents(), [
      { name: "qa-probe", stage: "post-review", blocking: false },
    ]);
    // Editar el stage de un agente existente (PUT + bump): el roster se
    // mueve al instante — el bug era depender del mtime del dir padre.
    writeProbe("pre-build", "true");
    bumpAgentDefsRevision();
    assert.deepEqual(listDeclaredHookAgents(), [
      { name: "qa-probe", stage: "pre-build", blocking: true },
    ]);
  } finally {
    setHookAgentsDirForTests(null);
    resetHookAgentsCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Cableado en reviewService ──

function mkTmpWorktree(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("accept + hook blocking en fail → Building con findings del hook", async () => {
  const worktree = mkTmpWorktree("hooks-wiring-");
  const id = "job-hooks-w01";
  workItemStore.clear();
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] }),
  );
  const hook = mkAgent({ name: "gate", blocking: true });
  setHookSeamsForTests({
    listHookAgents: () => [hook],
    runHookOnce: async (agent) => ({
      name: agent.name, stage: agent.stage, blocking: agent.blocking,
      status: "fail", summary: "e2e roto", findings: [{ message: "el checkout no avanza", file: "web/cart.ts" }],
      durationMs: 1,
    }),
  });
  try {
    workItemStore.create({ id, prompt: "hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const after = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(after?.status, "Building", "blocking fail frena el Complete");
    const meta = (after?.timeline ?? []).find((e) => e.message.includes("hook blocking"));
    assert.ok(meta, "timeline traza el freno del hook");
  } finally {
    setReviewPromptMock(null);
    setHookSeamsForTests(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("accept + hook advisory en fail → Complete igual con evidencia", async () => {
  const worktree = mkTmpWorktree("hooks-wiring-");
  const id = "job-hooks-w02";
  workItemStore.clear();
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] }),
  );
  setHookSeamsForTests({
    listHookAgents: () => [mkAgent({ name: "tester", blocking: false })],
    runHookOnce: async (agent) => ({
      name: agent.name, stage: agent.stage, blocking: agent.blocking,
      status: "fail", summary: "smoke con ruido", findings: [{ message: "ruido" }],
      durationMs: 1,
    }),
  });
  try {
    workItemStore.create({ id, prompt: "hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const after = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(after?.status, "Complete", "advisory nunca frena");
    const evt = (after?.timeline ?? []).find((e) => e.message.startsWith("hook:post-review:tester:fail"));
    assert.ok(evt, "la evidencia advisory queda en timeline");
  } finally {
    setReviewPromptMock(null);
    setHookSeamsForTests(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});
