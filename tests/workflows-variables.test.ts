/**
 * Interpolación de variables: resolución estricta y preservación de tipos (Fase 0).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveTemplate, resolveValue, type VarContext } from "../headless-runtime/workflows/variables.ts";
import type { NodeState } from "../headless-runtime/workflows/types.ts";

function node(id: string, output: string, outputJson?: unknown): NodeState {
  return { id, status: "completed", attempts: 1, output, outputJson };
}

function ctx(): VarContext {
  return {
    args: "arreglar el bug",
    inputs: { spec: "spec.md", limit: 3, flags: { dry: true } },
    nodes: {
      plan: node("plan", "plan listo"),
      review: node("review", '{"green":true}', { green: true }),
    },
    artifactsDir: "C:/tmp/artifacts",
    stateDir: "C:/tmp/state",
    workflowName: "demo",
    runId: "run-1",
  };
}

test("resuelve variables base y de nodos", () => {
  const resolved = resolveTemplate(
    "args=$ARGUMENTS spec=$INPUTS.spec last=$plan.output dir=$ARTIFACTS_DIR wf=$WORKFLOW_ID run=$RUN_ID",
    ctx(),
  );
  assert.equal(
    resolved,
    "args=arreglar el bug spec=spec.md last=plan listo dir=C:/tmp/artifacts wf=demo run=run-1",
  );
});

test("resuelve campos de salidas estructuradas", () => {
  assert.equal(resolveTemplate("green=$review.output.green", ctx()), "green=true");
});

test("falla con variable desconocida", () => {
  assert.throws(() => resolveTemplate("$ghost.output", ctx()), /variable desconocida/);
});

test("falla con campo inexistente en salida estructurada", () => {
  assert.throws(() => resolveTemplate("$review.output.red", ctx()), /campo inexistente/);
});

test("falla con input no declarado", () => {
  assert.throws(() => resolveTemplate("$INPUTS.otro", ctx()), /input "otro" no declarado/);
});

test("falla al pedir campo sobre salida no estructurada", () => {
  assert.throws(() => resolveTemplate("$plan.output.x", ctx()), /no es estructurado/);
});

test("resolveValue preserva tipos en referencias exactas", () => {
  assert.equal(resolveValue("$INPUTS.limit", ctx()), 3);
  assert.deepEqual(resolveValue("$INPUTS.flags", ctx()), { dry: true });
  assert.equal(
    resolveValue("limite=$INPUTS.limit", ctx()),
    "limite=3",
  );
});

test("$node.outputJson renderiza el bloque legible sin cambiar $node.output", () => {
  const pretty = resolveTemplate("ev=$review.outputJson", ctx());
  assert.equal(pretty, `ev=${JSON.stringify({ green: true }, null, 2)}`);
  assert.equal(
    resolveTemplate("crudo=$review.output", ctx()),
    'crudo={"green":true}',
    "$node.output sigue siendo el texto crudo",
  );
});

test("$node.outputJson falla honesto sin estructurado o con subpath", () => {
  assert.throws(() => resolveTemplate("$plan.outputJson", ctx()), /no es estructurado/);
  assert.throws(() => resolveTemplate("$review.outputJson.green", ctx()), /no tiene campos/);
});
