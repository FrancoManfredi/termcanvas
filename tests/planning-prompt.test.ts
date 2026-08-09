import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningPrompt } from "../src/planner/planningPrompt.ts";

const BASE = {
  mode: "roadmap" as const,
  repoPath: "C:/repo",
  outputPath: "C:/repo/.agents/planning/plan-1.json",
};

test("buildPlanningPrompt: schema incluye los campos de deduplicación", () => {
  const prompt = buildPlanningPrompt(BASE);
  assert.match(prompt, /duplicateOf/);
  assert.match(prompt, /existingIssueNumber/);
  assert.match(prompt, /DEDUPLICACIÓN ENTRE ITEMS DEL PLAN/);
  assert.match(prompt, /DEDUPLICACIÓN CONTRA EL REPO/);
});

test("buildPlanningPrompt: la sección de issues abiertos solo aparece cuando hay issues", () => {
  const without = buildPlanningPrompt(BASE);
  assert.doesNotMatch(without, /ISSUES YA ABIERTOS EN EL REPO/);

  const withIssues = buildPlanningPrompt({
    ...BASE,
    openIssues: [
      { number: 41, title: "Sidebar colapsable: el estado se pierde" },
      { number: 42, title: "Crasheo al abrir detalles" },
    ],
  });
  assert.match(withIssues, /ISSUES YA ABIERTOS EN EL REPO/);
  assert.match(withIssues, /#41 Sidebar colapsable: el estado se pierde/);
  assert.match(withIssues, /#42 Crasheo al abrir detalles/);
  assert.match(withIssues, /marcá existingIssueNumber/);
  assert.match(withIssues, /NO lo propongas como tema nuevo/);
});