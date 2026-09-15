/**
 * warp-agents-typing — perf del editor de agentes (Agents console).
 *
 * Root cause original: `AgentConfig` serializaba el prompt completo en cada
 * render (`JSON.stringify(config) !== JSON.stringify(saved)`) para detectar
 * cambios. El editor nuevo usa `isAgentDraftDirty` por campo (sin serializar)
 * y cachea el agente full por nombre en `useAgents`.
 *
 * Offline: puro, cero red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isAgentDraftDirty } from "../src/features/warpPanel/agents/agentDraft.ts";
import type { AgentDraft } from "../src/features/warpPanel/types.ts";

function draft(over: Partial<AgentDraft> = {}): AgentDraft {
  return {
    name: "foreman",
    description: "Foreman agent",
    agentType: "FOREMAN",
    model: "opencode-go/muse-spark-1.3-contributor",
    icon: "",
    tools: [],
    skills: [],
    mcps: [],
    prompt: "# Prompt\n\nBody.",
    ...over,
  };
}

test("same ref and rebuilt copy are clean", () => {
  const d = draft();
  assert.equal(isAgentDraftDirty(d, d), false);
  assert.equal(isAgentDraftDirty(d, draft()), false);
});

test("large prompts compare per-field without throwing", () => {
  const large = "x".repeat(200_000);
  assert.equal(isAgentDraftDirty(draft({ prompt: large }), draft({ prompt: large })), false);
  assert.equal(isAgentDraftDirty(draft({ prompt: large }), draft({ prompt: `${large}y` })), true);
});

test("junk never throws (degrades to dirty so edits are never hidden)", () => {
  assert.equal(isAgentDraftDirty(draft(), null as unknown as AgentDraft), true);
  assert.equal(isAgentDraftDirty(null as unknown as AgentDraft, draft()), true);
  assert.equal(isAgentDraftDirty(draft(), draft({ mcps: 42 as never })), true);
});
