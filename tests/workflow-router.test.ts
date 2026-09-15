/**
 * WorkflowRouter (F7): el Resolve elige workflow vía LLM con fallback total
 * a factory-default. Offline: runner fake, cero red, cero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_WORKFLOW,
  ROUTABLE_WORKFLOWS,
  listRoutableWorkflows,
  selectWorkflowForItem,
} from "../headless-runtime/workflows/workflowRouter.ts";
import type { AiNodeRunner } from "../headless-runtime/workflows/nodes/ai.ts";
import { resolveAgentModel } from "../headless-runtime/factory/opencodeAgentSync.ts";
import { getDefaultModels } from "../headless-runtime/factory/agentLoader.ts";

const REPO_ROOT = process.cwd();

function runnerReturning(output: string): AiNodeRunner {
  return (async () => ({ output })) as AiNodeRunner;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "job-router-1",
    prompt: "Arreglar el bug del filtro",
    worktree: REPO_ROOT,
    repoRoot: REPO_ROOT,
    timeoutMs: 200,
    ...overrides,
  };
}

test("router: elección LLM válida (JSON directo y con fences)", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const direct = await selectWorkflowForItem(
    baseInput({
      runner: (async (req: unknown) => {
        requests.push(req as Record<string, unknown>);
        return {
          output: '{"workflow":"fix-issue","reason":"chico y claro"}',
          sessionId: "ses-router-1",
        };
      }) as unknown as AiNodeRunner,
    }),
  );
  assert.equal(direct.workflow, "fix-issue");
  assert.equal(direct.routedBy, "llm");
  assert.equal(direct.reason, "chico y claro");
  assert.equal(direct.sessionId, "ses-router-1");
  assert.equal(
    requests[0]?.agent,
    "foreman",
    "el router corre con la identidad del agente foreman",
  );

  const fenced = await selectWorkflowForItem(
    baseInput({
      runner: runnerReturning(
        '```json\n{"workflow":"plan-approve-implement","reason":"plan"}\n```',
      ),
    }),
  );
  assert.equal(fenced.workflow, "plan-approve-implement");
  assert.equal(fenced.routedBy, "llm");
});

test("router: nombre desconocido / JSON roto / throw → fallback", async () => {
  const unknown = await selectWorkflowForItem(
    baseInput({ runner: runnerReturning('{"workflow":"no-existe","reason":"x"}') }),
  );
  assert.equal(unknown.workflow, FALLBACK_WORKFLOW);
  assert.equal(unknown.routedBy, "fallback");

  const junk = await selectWorkflowForItem(
    baseInput({ runner: runnerReturning("no soy json") }),
  );
  assert.equal(junk.workflow, FALLBACK_WORKFLOW);
  assert.equal(junk.routedBy, "fallback");

  const throwing = await selectWorkflowForItem(
    baseInput({
      runner: (async () => {
        throw new Error("boom");
      }) as AiNodeRunner,
    }),
  );
  assert.equal(throwing.workflow, FALLBACK_WORKFLOW);
  assert.match(throwing.reason, /boom/);
});

test("router: timeout → fallback sin colgarse", async () => {
  const hanging = (() => new Promise(() => {})) as unknown as AiNodeRunner;
  const t0 = Date.now();
  const out = await selectWorkflowForItem(
    baseInput({ runner: hanging, timeoutMs: 100 }),
  );
  assert.equal(out.workflow, FALLBACK_WORKFLOW);
  assert.ok(Date.now() - t0 < 5_000, "corta por timeout, no cuelga");
});

test("router: apagado por env → fallback", async () => {
  process.env.TERMCANVAS_WORKFLOW_ROUTER = "off";
  try {
    const out = await selectWorkflowForItem(
      baseInput({
        runner: runnerReturning('{"workflow":"fix-issue","reason":"x"}'),
      }),
    );
    assert.equal(out.workflow, FALLBACK_WORKFLOW);
    assert.match(out.reason, /router off/);
  } finally {
    delete process.env.TERMCANVAS_WORKFLOW_ROUTER;
  }
});

test("router: catálogo estable de workflows resolubles", () => {
  assert.deepEqual([...ROUTABLE_WORKFLOWS].sort(), [
    "factory-default",
    "fix-issue",
    "plan-approve-implement",
  ]);
});

test("router: el catálogo sale del tag `routable` (smoke/lentes afuera)", () => {
  const names = listRoutableWorkflows(process.cwd());
  assert.ok(names.includes("factory-default"));
  assert.ok(names.includes("fix-issue"));
  assert.ok(names.includes("plan-approve-implement"));
  assert.ok(!names.includes("smoke"), "smoke no es resoluble desde Resolve");
  assert.ok(
    !names.includes("parallel-reviews"),
    "parallel-reviews es manual (Workflow Lab)",
  );
});

test("router: el modelo del agente foreman manda sobre el default del yaml", async () => {
  const requests: Array<Record<string, unknown>> = [];
  await selectWorkflowForItem(
    baseInput({
      runner: (async (req: unknown) => {
        requests.push(req as Record<string, unknown>);
        return { output: '{"workflow":"fix-issue","reason":"chico y claro"}' };
      }) as unknown as AiNodeRunner,
    }),
  );
  const agentModel = resolveAgentModel("foreman");
  const expected = agentModel ?? getDefaultModels().foreman;
  assert.equal(
    requests[0]?.model,
    expected,
    "el turno del foreman usa su modelo configurado, no siempre el del yaml",
  );
});
