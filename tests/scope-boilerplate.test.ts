// SCOPE canónico compartido (shared/scope.ts): emite el template, retira el foreman.
// Puro, sin disco ni red.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE_DISCIPLINE_LINE,
  scopeWorktreeLine,
  stripScopeBoilerplate,
} from "../shared/scope.ts";

test("scopeWorktreeLine lleva el número y la regla no-PR", () => {
  const line = scopeWorktreeLine(86);
  assert.ok(line.includes("NEVER open a pull request"));
  assert.ok(line.includes("Closes #86"));
  assert.ok(line.includes("uncommitted"));
  assert.ok(scopeWorktreeLine(0).includes("Closes #0"));
  assert.ok(scopeWorktreeLine(NaN as number).includes("worktree"));
});

test("strip retira duplicado template+body y deja el issue intacto", () => {
  const issue = `# Resolve issue #86 — helper\n\n## ORIGINAL BODY\nMotivation here.\n\n## SCOPE\n${SCOPE_DISCIPLINE_LINE}\n${scopeWorktreeLine(86)}\n\n## SCOPE\n${SCOPE_DISCIPLINE_LINE}\n${scopeWorktreeLine(86)}`;
  const out = stripScopeBoilerplate(issue);
  assert.equal(out.split(SCOPE_DISCIPLINE_LINE).length - 1, 0);
  assert.ok(!out.includes("NEVER open a pull request"));
  assert.ok(!out.match(/^## SCOPE\s*$/m), "sin headers huérfanos");
  assert.ok(out.includes("Motivation here."));
  assert.ok(out.includes("# Resolve issue #86"));
});

test("strip conserva scope CUSTOM y texto normal byte-idéntico", () => {
  const custom = `## SCOPE\nRegla propia: solo tocar todo.ts`;
  assert.ok(stripScopeBoilerplate(custom).includes("Regla propia: solo tocar todo.ts"));
  const plain = "Un prompt normal sin scope.";
  assert.equal(stripScopeBoilerplate(plain), plain);
  assert.equal(stripScopeBoilerplate(""), "");
});

test("strip nunca lanza ante entradas raras", () => {
  assert.doesNotThrow(() => {
    stripScopeBoilerplate(null);
    stripScopeBoilerplate(undefined);
    stripScopeBoilerplate(42);
    stripScopeBoilerplate({});
  });
  assert.equal(stripScopeBoilerplate(null), "");
});
