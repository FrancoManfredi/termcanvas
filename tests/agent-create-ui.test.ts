/**
 * Alta de agentes en la UI (pura, sin DOM): validación del modal,
 * conversión a input del POST y dirty-check de los campos frontmatter.
 * Los componentes TSX se importan por sus exports puros (cero render).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_STAGE_OPTIONS,
  AGENT_TOOL_OPTIONS,
  AGENT_TYPE_OPTIONS,
  EMPTY_NEW_AGENT_FORM,
  newAgentFormToInput,
  validateNewAgentInput,
  type NewAgentForm,
} from "../src/features/warpPanel/components/newAgentForm.ts";
import { isAgentConfigDirty } from "../src/features/warpPanel/components/AgentConfig.tsx";
import type { AgentConfigData } from "../src/features/warpPanel/types.ts";

function form(over: Partial<NewAgentForm> = {}): NewAgentForm {
  return { ...EMPTY_NEW_AGENT_FORM, tools: [...EMPTY_NEW_AGENT_FORM.tools], ...over };
}

test("vocabularios UI espejan el backend (tools + stages)", () => {
  assert.deepEqual([...AGENT_TOOL_OPTIONS].sort(), ["bash", "edit", "glob", "grep", "read", "webfetch", "write"]);
  assert.deepEqual([...AGENT_STAGE_OPTIONS].sort(), ["none", "post-build", "post-review", "pre-build"]);
});

test("validate: vacío pide nombre+descripción+prompt", () => {
  const errors = validateNewAgentInput(form({ tools: [] }));
  assert.ok(errors.some((e) => e.includes("Name is required")));
  assert.ok(errors.some((e) => e.includes("Description is required")));
  assert.ok(errors.some((e) => e.includes("Prompt is required")));
  assert.ok(errors.some((e) => e.includes("at least one tool")));
});

test("validate: nombre con espacios/slash y model sin barra fallan", () => {
  const bad = validateNewAgentInput(
    form({ name: "mi agente", description: "d", body: "b", model: "sinbarra" }),
  );
  assert.ok(bad.some((e) => e.includes("Name must be")));
  assert.ok(bad.some((e) => e.includes("provider/model")));
  assert.deepEqual(
    validateNewAgentInput(form({ name: "playwright-tester", description: "d", body: "b" })),
    [],
    "form válido pasa limpio",
  );
});

test("validate: tools desconocidas y stage inválido fallan", () => {
  const bad = validateNewAgentInput(
    form({ name: "t", description: "d", body: "b", tools: ["read", "rayos-x"], stage: "al-espacio" }),
  );
  assert.ok(bad.some((e) => e.includes("Unknown tools")));
  assert.ok(bad.some((e) => e.includes("Invalid stage")));
});

test("tipos elegibles: VERIFY y CUSTOM (core singletons fuera)", () => {
  assert.deepEqual([...AGENT_TYPE_OPTIONS], ["VERIFY", "CUSTOM"]);
});

test("newAgentFormToInput: VERIFY + advisory por default, blocking solo con stage", () => {
  const input = newAgentFormToInput(form({ name: " tester ", description: "d", body: "b" }));
  assert.equal(input.name, "tester");
  assert.equal((input.frontmatter as Record<string, unknown>).agentType, "VERIFY");
  assert.equal((input.frontmatter as Record<string, unknown>).blocking, false);
  assert.ok(!("model" in (input.frontmatter as Record<string, unknown>)), "model vacío no viaja");
  const blocking = newAgentFormToInput(
    form({ name: "t", description: "d", body: "b", stage: "post-review", blocking: true, model: "x/y" }),
  );
  assert.equal((blocking.frontmatter as Record<string, unknown>).blocking, true);
  assert.equal((blocking.frontmatter as Record<string, unknown>).model, "x/y");
  const none = newAgentFormToInput(
    form({ name: "t", description: "d", body: "b", stage: "none", blocking: true }),
  );
  assert.equal((none.frontmatter as Record<string, unknown>).blocking, false, "sin stage no hay blocking");
  const custom = newAgentFormToInput(
    form({ name: "t", description: "d", body: "b", agentType: "CUSTOM" }),
  );
  assert.equal((custom.frontmatter as Record<string, unknown>).agentType, "CUSTOM");
  assert.deepEqual(validateNewAgentInput(form({ name: "t", description: "d", body: "b", agentType: "JEFECITO" })).some((e) => e.includes("agent type")), true);
});

function config(overrides: Partial<AgentConfigData> = {}): AgentConfigData {
  return {
    description: "d",
    mcps: [],
    secrets: [],
    harness: "Warp",
    model: "m",
    runner: "default",
    host: "Warp hosted",
    prompt: "p",
    automations: [],
    ...overrides,
  };
}

test("isAgentConfigDirty: campos frontmatter nuevos participan", () => {
  assert.equal(isAgentConfigDirty(config(), config()), false);
  assert.equal(isAgentConfigDirty(config(), config({ tools: ["read"] })), true);
  assert.equal(isAgentConfigDirty(config({ tools: ["read", "bash"] }), config({ tools: ["bash", "read"] })), false, "orden no ensucia");
  assert.equal(isAgentConfigDirty(config(), config({ stage: "post-review" })), true);
  assert.equal(isAgentConfigDirty(config(), config({ blocking: true })), true);
  assert.equal(isAgentConfigDirty(config(), config({ mode: "subagent" })), true);
});
