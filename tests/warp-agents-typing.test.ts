/**
 * warp-agents-typing — perf Ola 3 (typing jank in AgentConfig).
 *
 * Root cause: `AgentConfig` computed
 * `JSON.stringify(config) !== JSON.stringify(saved)` on EVERY render —
 * two serializations of the full multi-KB agent.md prompt per keystroke —
 * plus `getFactoryAgentBody` refetched the daemon on every visit to an
 * agent, and `AgentCard` rows re-rendered on every parent render (inline
 * per-row closures).
 *
 * Fix (3 files):
 * - `AgentConfig.tsx`: field-level `isAgentConfigDirty` (same semantics,
 *   no serialization) + in-memory per-agent body cache.
 * - `useAgents.ts`: stable `selectAgent`/`getConfig`/`saveConfig` refs.
 * - `AgentsPanel.tsx`: memoized `AgentCard` + stable id-based `onSelect`.
 * Offline: pure, zero network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isAgentConfigDirty } from "../src/features/warpPanel/components/AgentConfig.tsx";
import type { AgentConfigData } from "../src/features/warpPanel/types.ts";

function config(overrides: Partial<AgentConfigData> = {}): AgentConfigData {
  return {
    description: "Foreman agent",
    mcps: [{ id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" }],
    secrets: [{ id: "secret-1", key: "GITHUB_TOKEN", masked: "ghp_•••" }],
    harness: "Warp",
    model: "claude-sonnet-5 (high)",
    runner: "default",
    host: "Warp hosted",
    prompt: "# Prompt\n\nBody.",
    automations: [
      { id: "a1", trigger: "on-issue", description: "d", enabled: true },
    ],
    ...overrides,
  };
}

test("identical configs are clean (same ref and rebuilt copy)", () => {
  const c = config();
  assert.equal(isAgentConfigDirty(c, c), false);
  assert.equal(isAgentConfigDirty(c, config()), false);
});

test("scalar edits are dirty", () => {
  assert.equal(
    isAgentConfigDirty(config(), config({ prompt: "# Changed" })),
    true,
  );
  assert.equal(
    isAgentConfigDirty(config(), config({ description: "x" })),
    true,
  );
  assert.equal(isAgentConfigDirty(config(), config({ model: "x" })), true);
  assert.equal(isAgentConfigDirty(config(), config({ harness: "x" })), true);
  assert.equal(isAgentConfigDirty(config(), config({ runner: "x" })), true);
  assert.equal(isAgentConfigDirty(config(), config({ host: "x" })), true);
});

test("list add/remove/toggle is dirty", () => {
  assert.equal(isAgentConfigDirty(config(), config({ mcps: [] })), true);
  assert.equal(isAgentConfigDirty(config(), config({ secrets: [] })), true);
  assert.equal(
    isAgentConfigDirty(
      config(),
      config({
        automations: [
          { id: "a1", trigger: "on-issue", description: "d", enabled: false },
        ],
      }),
    ),
    true,
  );
});

test("junk never throws (degrades to dirty so edits are never hidden)", () => {
  assert.equal(
    isAgentConfigDirty(config(), null as unknown as AgentConfigData),
    true,
  );
  assert.equal(
    isAgentConfigDirty(null as unknown as AgentConfigData, config()),
    true,
  );
  assert.equal(
    isAgentConfigDirty(config(), config({ mcps: 42 as never })),
    true,
  );
});
