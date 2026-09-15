/**
 * Workflows canvas (WarpPanel section) — pure helpers of the read-only view.
 *
 * Covers normalization (YAML → canvas domain), depends_on/loop edges, unit
 * layers + layout determinism and the phase accent palette. Offline: zero
 * network, zero DOM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEdges,
  computeUnitLayers,
  layoutWorkflow,
  normalizeWorkflowDef,
  phaseColor,
  PHASE_COLORS,
  resolveCanvas,
} from "../src/features/warpPanel/workflows/derive.ts";
import {
  MOCK_RAW_WORKFLOWS,
  MOCK_WORKFLOW_DEFS,
} from "../src/features/warpPanel/workflows/mockWorkflows.ts";
import type { WorkflowDefinition } from "../src/features/warpPanel/workflows/types.ts";

const factoryDefault = MOCK_WORKFLOW_DEFS.find((def) => def.name === "factory-default");
assert.ok(factoryDefault, "factory-default mock def must normalize");

test("normalizeWorkflowDef: factory-default mirrors the YAML", () => {
  const def = factoryDefault as WorkflowDefinition;
  assert.deepEqual(
    def.nodes.map((node) => node.id),
    ["triage", "spec", "approve", "implement", "verify", "review"],
  );
  assert.equal(def.nodes.find((node) => node.id === "approve")?.kind, "approval");
  assert.equal(def.nodes.find((node) => node.id === "approve")?.approval?.maxAttempts, 2);
  assert.equal(def.nodes.find((node) => node.id === "verify")?.subWorkflow, "verify-runner");
  assert.equal(def.nodes.find((node) => node.id === "implement")?.groupId, "build");
  assert.equal(def.groups.length, 1);
  assert.deepEqual(def.groups[0].nodeIds, ["implement", "verify", "review"]);
  assert.deepEqual(def.groups[0].externalDeps, ["approve"]);
  assert.equal(def.groups[0].maxIterations, 4);
  assert.equal(def.returns, "build");
  assert.equal(def.inputs.find((input) => input.name === "request")?.required, true);
  assert.equal(
    def.inputs.find((input) => input.name === "issue_ref")?.defaultLabel,
    "(sin issue vinculado)",
  );
  assert.equal(
    def.inputs.find((input) => input.name === "issue_body")?.defaultLabel,
    "(sin cuerpo disponible)",
  );
});

test("normalizeWorkflowDef tolerates junk without throwing", () => {
  assert.equal(normalizeWorkflowDef(null, { scope: "repo", filePath: "" }), null);
  assert.equal(normalizeWorkflowDef("junk", { scope: "repo", filePath: "" }), null);
  assert.equal(normalizeWorkflowDef({}, { scope: "repo", filePath: "" }), null);
  const partial = normalizeWorkflowDef(
    { name: "x", nodes: [{ id: "a" }, { nope: true }, null, 42] },
    { scope: "repo", filePath: "x.yaml" },
  );
  assert.ok(partial);
  assert.deepEqual(
    partial.nodes.map((node) => node.id),
    ["a"],
  );
  assert.equal(partial.nodes[0].kind, "unknown");
  assert.equal(MOCK_RAW_WORKFLOWS.length, MOCK_WORKFLOW_DEFS.length);
});

test("buildEdges: depends_on chain plus labeled loop-back", () => {
  const def = factoryDefault as WorkflowDefinition;
  const edges = buildEdges(def.nodes, def.groups);
  assert.deepEqual([...edges.map((edge) => edge.id)].sort(), [
    "approve->implement",
    "implement->verify",
    "review->implement",
    "spec->approve",
    "triage->spec",
    "verify->review",
  ]);
  const loop = edges.find((edge) => edge.kind === "loop");
  assert.equal(loop?.id, "review->implement");
  assert.equal(loop?.label, "$review.output.green == true");
});

test("computeUnitLayers: diamond, cycle fallback and detached trailing column", () => {
  const diamond = computeUnitLayers(
    ["a", "b", "c", "d"],
    [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ],
  );
  assert.deepEqual([...diamond.entries()].sort(), [
    ["a", 0],
    ["b", 1],
    ["c", 1],
    ["d", 2],
  ]);
  const cycle = computeUnitLayers(
    ["x", "y"],
    [
      { source: "x", target: "y" },
      { source: "y", target: "x" },
    ],
  );
  assert.equal(cycle.get("x"), 0);
  assert.equal(cycle.get("y"), 0, "unresolved cycle units land in the final layer");
  const detached = computeUnitLayers(
    ["a", "b", "free"],
    [{ source: "a", target: "b" }],
  );
  assert.equal(detached.get("a"), 0);
  assert.equal(detached.get("b"), 1);
  assert.equal(detached.get("free"), 2, "detached units land in a trailing column");
  assert.equal(computeUnitLayers([], []).size, 0);
});

test("layoutWorkflow: deterministic, no NaN, loop box wraps its members", () => {
  const def = factoryDefault as WorkflowDefinition;
  const edges = buildEdges(def.nodes, def.groups);
  const first = layoutWorkflow(def.nodes, def.groups, edges);
  const second = layoutWorkflow(def.nodes, def.groups, edges);
  assert.deepEqual(first, second);
  for (const node of first.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  }
  const group = first.groups[0];
  const members = first.nodes.filter((node) => ["implement", "verify", "review"].includes(node.id));
  for (const member of members) {
    assert.ok(member.x >= group.x, `${member.id} inside group box (x)`);
    assert.ok(member.y >= group.y, `${member.id} inside group box (y)`);
    assert.ok(member.x + member.width <= group.x + group.width);
    assert.ok(member.y + member.height <= group.y + group.height);
  }
  assert.ok(first.width > 0 && first.height > 0);
});

test("resolveCanvas: shapes of the bundled workflows", () => {
  const factory = factoryDefault as WorkflowDefinition;
  const resolvedFactory = resolveCanvas(factory);
  assert.equal(resolvedFactory.nodes.length, 6);
  assert.equal(resolvedFactory.edges.length, 6);
  assert.equal(resolvedFactory.groups.length, 1);

  const fixIssue = MOCK_WORKFLOW_DEFS.find((def) => def.name === "fix-issue");
  assert.ok(fixIssue);
  const resolvedFix = resolveCanvas(fixIssue);
  assert.deepEqual(
    resolvedFix.nodes.map((node) => node.id),
    ["triage", "implement", "verify", "review"],
  );
  assert.equal(resolvedFix.edges.length, 4);

  const parallel = MOCK_WORKFLOW_DEFS.find((def) => def.name === "parallel-reviews");
  assert.ok(parallel);
  const resolvedParallel = resolveCanvas(parallel);
  assert.deepEqual(
    resolvedParallel.nodes.map((node) => node.id),
    ["reviews"],
  );
  assert.equal(resolvedParallel.edges.length, 0);
  assert.equal(resolvedParallel.groups.length, 0);
});

test("phaseColor: deterministic, distinct per phase and total for any index", () => {
  for (let index = 0; index < PHASE_COLORS.length; index += 1) {
    assert.equal(phaseColor(index), PHASE_COLORS[index]);
  }
  assert.equal(phaseColor(PHASE_COLORS.length), PHASE_COLORS[0], "wraps around");
  assert.equal(new Set(PHASE_COLORS).size, PHASE_COLORS.length, "palette has no duplicates");
  assert.equal(phaseColor(-1), PHASE_COLORS[0]);
  assert.equal(phaseColor(Number.NaN), PHASE_COLORS[0]);
  assert.equal(phaseColor(2.7), PHASE_COLORS[2]);
});
