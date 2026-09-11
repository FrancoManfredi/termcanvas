/**
 * Roles fuente única (FASE 1 E1 — C6 vocabulario único, C7 nada duplicado).
 * Listas canónicas + predicados puros + fail-closed. Offline, cero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FACTORY_AGENT_ROLES,
  SESSION_AGENT_ROLES,
  TOOL_ROLES,
  SCORER_ROLES,
  ROLE_TO_TOOLSET_NAME,
  isFactoryAgentRole,
  isSessionAgentRole,
  isToolRole,
  isScorerRole,
  isKnownRole,
  toolsetNameFor,
} from "../shared/roles.ts";

// ── 1. Listas canónicas (levantadas por lectura, no inventadas) ──

test("FACTORY_AGENT_ROLES: 7 mayúsculas espejo de agentLoader AGENT_TYPES (CUSTOM = hooks de usuario)", () => {
  assert.deepEqual([...FACTORY_AGENT_ROLES], ["FOREMAN", "TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "VERIFY", "CUSTOM"]);
});

test("SESSION_AGENT_ROLES: 5 minúsculas espejo de agentSessions/workItemStore", () => {
  assert.deepEqual([...SESSION_AGENT_ROLES], ["foreman", "triage", "spec", "implement", "review"]);
});

test("TOOL_ROLES: 7 espejo de toolPolicy ToolRole", () => {
  assert.deepEqual([...TOOL_ROLES], ["triage", "spec", "review", "foreman", "mvp-tracking", "interview", "implement"]);
});

test("SCORER_ROLES: 6 en orden original de shared/types/scorer.ts", () => {
  assert.deepEqual([...SCORER_ROLES], ["implement", "review", "verification", "triage", "spec", "foreman"]);
});

// ── 2. Predicados por lista ──

test("predicados: aceptan su lista y rechazan las vecinas (case-sensitive)", () => {
  assert.equal(isFactoryAgentRole("FOREMAN"), true);
  assert.equal(isFactoryAgentRole("foreman"), false);
  assert.equal(isSessionAgentRole("foreman"), true);
  assert.equal(isSessionAgentRole("FOREMAN"), false);
  assert.equal(isToolRole("mvp-tracking"), true);
  assert.equal(isToolRole("FOREMAN"), false);
  assert.equal(isScorerRole("verification"), true);
  assert.equal(isScorerRole("VERIFY"), false);
  assert.equal(isScorerRole("verify"), false);
});

test("isKnownRole: unión fail-closed (conocido en cualquiera → true)", () => {
  for (const r of ["FOREMAN", "VERIFY", "foreman", "implement", "mvp-tracking", "interview", "verification", "spec"]) {
    assert.equal(isKnownRole(r), true, r);
  }
  for (const bad of ["", "unknown-role", "IMPLEMENT ", " implement", null, undefined, 42, {}, [], "REVIEW ", "verify"]) {
    assert.equal(isKnownRole(bad), false, JSON.stringify(bad));
  }
});

test("predicados nunca lanzan ante basura", () => {
  assert.doesNotThrow(() => {
    isFactoryAgentRole(null);
    isSessionAgentRole(undefined);
    isToolRole(42);
    isScorerRole({});
    isKnownRole(Object.create(null));
    toolsetNameFor(null);
  });
});

// ── 3. Mapeo a toolset-nombre (canónico, misma semántica que toolPolicy) ──

test("ROLE_TO_TOOLSET_NAME: solo implement escribe", () => {
  assert.equal(ROLE_TO_TOOLSET_NAME["implement"], "implement");
  for (const r of ["triage", "spec", "review", "foreman", "mvp-tracking", "interview"]) {
    assert.equal(ROLE_TO_TOOLSET_NAME[r], "readonly", r);
  }
});

test("toolsetNameFor: implement case-insensitive; resto incl. basura → readonly", () => {
  assert.equal(toolsetNameFor("implement"), "implement");
  assert.equal(toolsetNameFor("IMPLEMENT"), "implement");
  assert.equal(toolsetNameFor(" Implement "), "implement");
  for (const role of ["triage", "spec", "review", "foreman", "mvp-tracking", "interview", "verification", "", "foreman ", null, undefined, 42, {}]) {
    assert.equal(toolsetNameFor(role), "readonly", JSON.stringify(role));
  }
});
