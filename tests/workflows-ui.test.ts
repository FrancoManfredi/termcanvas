/**
 * UI de workflows (Fase 4c): helpers puros de la VM + cliente con fetch inyectado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDagLayers,
  formatTotals,
  nodeBodyOf,
  parseInputsJson,
  runTotals,
} from "../src/features/workflowLab/workflowVm.ts";
import {
  getFactoryWorkflows,
  postFactoryWorkflowDecision,
  postFactoryWorkflowRun,
  type FactoryFetch,
  type WorkflowRunInfo,
} from "../src/lib/factoryClient.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

test("buildDagLayers: diamante, ciclo y vacío", () => {
  const diamond = buildDagLayers([
    { id: "a" },
    { id: "b", depends_on: ["a"] },
    { id: "c", depends_on: ["a"] },
    { id: "d", depends_on: ["b", "c"] },
  ]);
  assert.deepEqual(diamond, [["a"], ["b", "c"], ["d"]]);

  const cycle = buildDagLayers([
    { id: "x", depends_on: ["y"] },
    { id: "y", depends_on: ["x"] },
  ]);
  assert.deepEqual(cycle, [["x", "y"]]);

  assert.deepEqual(buildDagLayers([]), []);
});

test("parseInputsJson: vacío, objeto, array e inválido", () => {
  assert.deepEqual(parseInputsJson(""), { ok: true });
  assert.deepEqual(parseInputsJson('{"a": 1}'), { ok: true, value: { a: 1 } });
  const array = parseInputsJson("[1,2]");
  assert.equal(array.ok, false);
  const invalid = parseInputsJson("{no json");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /JSON inválido/);
});

test("totales y tonos de estado", () => {
  const run = {
    id: "run-1",
    workflow: "quick",
    description: "",
    status: "completed",
    startedAt: "",
    nodes: {
      a: { id: "a", status: "completed", attempts: 1, costUsd: 0.25 },
      b: { id: "b", status: "failed", attempts: 2 },
      c: { id: "c", status: "skipped", attempts: 1 },
    },
  } as unknown as WorkflowRunInfo;
  const totals = runTotals(run);
  assert.equal(totals.completed, 1);
  assert.equal(totals.failed, 1);
  assert.equal(totals.skipped, 1);
  assert.equal(totals.costUsd, 0.25);
  assert.match(formatTotals(run), /1\/3 ok · 1 fail · 1 skip · \$0\.2500/);
});

test("nodeBodyOf detecta el body del nodo", () => {
  assert.equal(nodeBodyOf({ id: "a", bash: "echo" }), "bash");
  assert.equal(nodeBodyOf({ id: "b", loop: {} }), "loop");
  assert.equal(nodeBodyOf({ id: "c" }), "?");
  assert.equal(nodeBodyOf(undefined), "?");
});

test("cliente: lista de workflows parsea el payload", async () => {
  const fetchFn: FactoryFetch = async (url) => {
    assert.match(url, /\/factory\/workflows$/);
    return jsonResponse({
      workflows: [
        { name: "quick", description: "rápido", tags: ["ci"], scope: "bundled", filePath: "/x" },
        { bad: true },
      ],
    });
  };
  const result = await getFactoryWorkflows({ fetchFn, port: 17680 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].name, "quick");
    assert.deepEqual(result.data[0].tags, ["ci"]);
  }
});

test("cliente: run envía name/args/inputs y parsea el run", async () => {
  const calls: string[] = [];
  const fetchFn: FactoryFetch = async (url, init) => {
    calls.push(`${init?.method} ${url}`);
    return jsonResponse({
      ok: true,
      run: {
        id: "run-abc",
        workflow: "quick",
        description: "",
        status: "running",
        startedAt: "2026-09-11T00:00:00Z",
        nodes: {},
      },
    });
  };
  const result = await postFactoryWorkflowRun(
    { name: "quick", args: "hola", inputs: { tema: "auth" } },
    { fetchFn, port: 17680 },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.id, "run-abc");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /POST .*\/factory\/workflows\/run/);
});

test("cliente: decisión custom viaja por path y error de transporte no lanza", async () => {
  const calls: string[] = [];
  const fetchFn: FactoryFetch = async (url) => {
    calls.push(url);
    return jsonResponse({ ok: true });
  };
  const decision = await postFactoryWorkflowDecision("run-abc", "ship", "a prod", {
    fetchFn,
    port: 17680,
  });
  assert.equal(decision.ok, true);
  assert.match(calls[0], /\/factory\/workflows\/runs\/run-abc\/ship$/);

  const failing: FactoryFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const failed = await getFactoryWorkflows({ fetchFn: failing, port: 17680 });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, null);
});
