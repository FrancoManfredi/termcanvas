/**
 * DAG: capas topológicas, `when` y `trigger_rule` (Fase 0).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildLayers, evaluateTriggerRule, evaluateWhen } from "../headless-runtime/workflows/graph.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";
import type { NodeState } from "../headless-runtime/workflows/types.ts";

function graphFrom(yaml: string) {
  const def = parseWorkflowDefinition(yaml, "test.yaml");
  return buildLayers(def.nodes);
}

const diamond = `name: diamond
description: d
nodes:
  - id: a
    bash: echo a
  - id: b
    depends_on: [a]
    bash: echo b
  - id: c
    depends_on: [a]
    bash: echo c
  - id: d
    depends_on: [b, c]
    bash: echo d
`;

test("capas topológicas de un diamante", () => {
  const graph = graphFrom(diamond);
  assert.deepEqual(graph.layers, [["a"], ["b", "c"], ["d"]]);
  assert.deepEqual(graph.directDeps.get("d"), ["b", "c"]);
  assert.deepEqual(graph.dependents.get("a"), ["b", "c"]);
});

test("evaluateWhen compara strings, números y combina && / ||", () => {
  const values: Record<string, unknown> = {
    "$a.output": "yes",
    "$b.output": "3",
    "$c.output": "true",
  };
  const ctx = { resolveExpression: (expr: string) => values[expr] };
  assert.equal(evaluateWhen("$a.output == 'yes'", ctx), true);
  assert.equal(evaluateWhen("$a.output != 'no'", ctx), true);
  assert.equal(evaluateWhen("$b.output > 2", ctx), true);
  assert.equal(evaluateWhen("$b.output <= 2", ctx), false);
  assert.equal(evaluateWhen("$a.output == 'yes' && $b.output == '3'", ctx), true);
  assert.equal(evaluateWhen("$a.output == 'no' || $b.output == '3'", ctx), true);
  assert.equal(evaluateWhen("$a.output == 'no' && $b.output == '3'", ctx), false);
  assert.equal(evaluateWhen("$missing.output == 'x'", ctx), false);
});

function states(entries: Record<string, NodeState["status"]>): Record<string, NodeState> {
  const out: Record<string, NodeState> = {};
  for (const [id, status] of Object.entries(entries)) {
    out[id] = { id, status, attempts: 1 };
  }
  return out;
}

test("trigger_rule all_success exige todas completadas", () => {
  assert.equal(
    evaluateTriggerRule("all_success", ["a", "b"], states({ a: "completed", b: "completed" })).run,
    true,
  );
  assert.equal(
    evaluateTriggerRule("all_success", ["a", "b"], states({ a: "completed", b: "failed" })).run,
    false,
  );
});

test("trigger_rule one_success corre con al menos una completada", () => {
  assert.equal(
    evaluateTriggerRule("one_success", ["a", "b"], states({ a: "failed", b: "completed" })).run,
    true,
  );
  assert.equal(
    evaluateTriggerRule("one_success", ["a", "b"], states({ a: "failed", b: "failed" })).run,
    false,
  );
});

test("trigger_rule none_failed_min_one_success no corre con fallas", () => {
  assert.equal(
    evaluateTriggerRule(
      "none_failed_min_one_success",
      ["a", "b"],
      states({ a: "completed", b: "skipped" }),
    ).run,
    true,
  );
  assert.equal(
    evaluateTriggerRule(
      "none_failed_min_one_success",
      ["a", "b"],
      states({ a: "completed", b: "failed" }),
    ).run,
    false,
  );
});

test("trigger_rule all_done corre aunque haya fallas", () => {
  assert.equal(
    evaluateTriggerRule("all_done", ["a"], states({ a: "failed" })).run,
    true,
  );
  assert.equal(
    evaluateTriggerRule("all_done", ["a"], states({ a: "running" })).run,
    false,
  );
});

test("sin dependencias siempre corre", () => {
  assert.equal(evaluateTriggerRule("all_success", [], {}).run, true);
});
