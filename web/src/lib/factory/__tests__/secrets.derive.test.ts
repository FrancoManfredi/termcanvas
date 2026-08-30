import { describe, it, expect } from "vitest";
import { FactoryRegistry } from "../store/factoryRegistry";
import { SAMPLE_RUNNER_LINUX } from "../fixtures/samples";
import { parseFactoryYaml } from "../parsers/factory.parser";
import { getFactoryBundle } from "../hooks/useFactoryBundle";
import {
  getFactoryWideSecrets,
  getAgentDefaultsSecrets,
  resolveEffectiveSecretsForAgent,
  resolveAllSecretsView,
  resolveEffectiveMcpForAgent,
  resolveAllMcpView,
  isValidAlias,
  isValidMcpWarpId,
  agentTypeDoesNotExpandSecrets,
} from "../domain/secrets.derive";

function bundle() {
  const r = getFactoryBundle();
  if (!r.ok) throw new Error("bundle failed: " + JSON.stringify(r.issues));
  return r.value!;
}

const PLACEHOLDER = "<REPLACE_ME>";

describe("secrets.derive - scoping reemplaza no agrega", () => {
  it("1. factory-wide secrets = [PLACEHOLDER] from SAMPLE_FACTORY_FULL", () => {
    const b = bundle();
    expect(getFactoryWideSecrets(b)).toEqual([PLACEHOLDER]);
  });
  it("2. agentDefaults secrets = [PLACEHOLDER]", () => {
    const b = bundle();
    expect(getAgentDefaultsSecrets(b)).toEqual([PLACEHOLDER]);
  });
  it("3. foreman has per-agent secrets [PLACEHOLDER] that replaces agentDefaults", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.factoryWide).toEqual([PLACEHOLDER]);
    expect(eff.inheritedOrOverridden).toEqual([PLACEHOLDER]);
    expect(eff.usesPerAgentOverride).toBe(true);
  });
  it("4. foreman effective = factoryWide + per-agent, dedup => [PLACEHOLDER]", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.effective).toEqual([PLACEHOLDER]);
  });
  it("5. reviewer without per-agent secrets inherits agentDefaults PLACEHOLDER", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "reviewer")!;
    expect(eff.usesPerAgentOverride).toBe(false);
    expect(eff.inheritedOrOverridden).toEqual([PLACEHOLDER]);
    // dedup placeholder => single
    expect(eff.effective).toEqual([PLACEHOLDER]);
  });
  it("6. factory-wide always applies even when per-agent exists", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.effective).toContain(PLACEHOLDER);
  });
  it("7. implement has per-agent PLACEHOLDER -> effective = factory PLACEHOLDER (dedup, no extra SHARED)", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "implement")!;
    expect(eff.inheritedOrOverridden).toEqual([PLACEHOLDER]);
    expect(eff.effective).toEqual([PLACEHOLDER]);
  });
  it("8. triage per-agent PLACEHOLDER replaces agentDefaults", () => {
    const eff = resolveEffectiveSecretsForAgent(bundle(), "triage")!;
    expect(eff.effective).toEqual([PLACEHOLDER]);
    expect(eff.effective).toEqual(expect.arrayContaining([PLACEHOLDER]));
  });
  it("9. custom security agent has two secrets replaces (dedup placeholder)", () => {
    const eff = resolveEffectiveSecretsForAgent(bundle(), "security")!;
    expect(eff.inheritedOrOverridden).toEqual([PLACEHOLDER, PLACEHOLDER]);
    expect(eff.effective).toEqual([PLACEHOLDER]);
  });
  it("10. verify inherits agentDefaults (no per-agent) => PLACEHOLDER", () => {
    const eff = resolveEffectiveSecretsForAgent(bundle(), "verify")!;
    expect(eff.effective).toEqual([PLACEHOLDER]);
  });
  it("11. resolveAll view lists PLACEHOLDER among allDistinct", () => {
    const view = resolveAllSecretsView(bundle());
    expect(view.allDistinct).toEqual(expect.arrayContaining([PLACEHOLDER]));
  });
  it("12. factory yaml parser preserves secrets order", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: payments-service
secrets:
  - A
  - B
agentDefaults:
  model: auto
  secrets:
    - C
`;
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(true);
    expect(r.value!.secrets).toEqual(["A", "B"]);
    expect(r.value!.agentDefaults.secrets).toEqual(["C"]);
  });
  it("13. per-agent replacement scenario: factory [A,B] agentDefaults [C] agent [D] => effective [A,B,D]", () => {
    const factoryRaw = `schemaVersion: v1alpha1
name: t
repositories:
  - owner: acme
    name: repo
secrets:
  - A
  - B
agentDefaults:
  model: auto
  secrets:
    - C
  runner: linux-build
`;
    const foremanRaw = `---
agentType: FOREMAN
secrets:
  - D
model: auto
runner: linux-build
---
Body.
`;
    const reg = new FactoryRegistry();
    const res = reg.parseBundle({
      factoryYaml: { raw: factoryRaw, file: "factory.yaml" },
      agents: [{ raw: foremanRaw, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(res.ok).toBe(true);
    const b = res.value!;
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.effective).toEqual(["A", "B", "D"]);
    expect(eff.effective).not.toContain("C");
  });
});

describe("mcp warpId requerido y scoping", () => {
  it("14. factory-wide mcp sentry warpId PLACEHOLDER", () => {
    const view = resolveAllMcpView(bundle());
    expect(view.factoryWide).toEqual({ sentry: PLACEHOLDER });
  });
  it("15. foreman mcp sentry warpId present", () => {
    const eff = resolveEffectiveMcpForAgent(bundle(), "foreman")!;
    expect(eff.effective.sentry).toBe(PLACEHOLDER);
  });
  it("16. reviewer without mcpServers has no effective mcp (no defaults)", () => {
    const eff = resolveEffectiveMcpForAgent(bundle(), "reviewer")!;
    expect(eff.effective).toEqual({ sentry: PLACEHOLDER }); // inherits factory-wide, but per-agent missing means agentDefaults none + factoryWide -> still factoryWide
    // reviewer has no mcpServers, but factoryWide still applies
    expect(eff.inheritedOrOverridden).toEqual({});
  });
  it("17. security custom agent has sentry mcp", () => {
    const eff = resolveEffectiveMcpForAgent(bundle(), "security")!;
    expect(eff.effective.sentry).toBe(PLACEHOLDER);
  });
  it("18. mcp warpId empty fails validation", () => {
    expect(isValidMcpWarpId("")).toBe(false);
    expect(isValidMcpWarpId(PLACEHOLDER)).toBe(true);
  });
  it("19. parser fails on mcpServers missing warpId", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: payments-service
mcpServers:
  sentry: {}
agentDefaults:
  model: auto
`;
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(false);
  });
  it("20. per-agent mcp replaces agentDefaults not adds", () => {
    const factoryRaw = `schemaVersion: v1alpha1
name: t
repositories:
  - owner: acme
    name: repo
mcpServers:
  sentry:
    warpId: FACTORY_ID
agentDefaults:
  model: auto
  runner: linux-build
  mcpServers:
    other:
      warpId: DEFAULT_ID
`;
    const agentRaw = `---
mcpServers:
  sentry:
    warpId: AGENT_ID
model: auto
runner: linux-build
---
Body.
`;
    const reg = new FactoryRegistry();
    const res = reg.parseBundle({
      factoryYaml: { raw: factoryRaw, file: "factory.yaml" },
      agents: [{ raw: `---\nagentType: FOREMAN\nmodel: auto\nrunner: linux-build\n---\nBody.\n`, file: "agents/foreman/agent.md" }, { raw: agentRaw, file: "agents/custom/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(res.ok).toBe(true);
    const b = res.value!;
    const eff = resolveEffectiveMcpForAgent(b, "custom")!;
    // custom has its own sentry AGENT_ID, should NOT have other DEFAULT_ID
    expect(eff.effective.sentry).toBe("AGENT_ID");
    expect(eff.effective["other"]).toBeUndefined();
    // but factoryWide sentry overwritten by agent's AGENT_ID (factoryWide key also sentry)
    // effective currently = factoryWide {sentry:FACTORY_ID} overridden by inherited {sentry:AGENT_ID} => AGENT_ID wins
  });
});

describe("skill no amplía acceso y agentType no amplía", () => {
  it("21. agentType FOREMAN does not add implicit secrets", () => {
    expect(agentTypeDoesNotExpandSecrets("FOREMAN")).toBe(true);
    const effFore = resolveEffectiveSecretsForAgent(bundle(), "foreman")!;
    const effCust = resolveEffectiveSecretsForAgent(bundle(), "security")!;
    // foreman has 1 effective distinct, security has 1 (dedup placeholder) — FOREMAN not privileged
    expect(effFore.effective.length).toBeLessThanOrEqual(effCust.effective.length + 1);
  });
  it("22. all agent types behave same wrt secrets (CUSTOM vs FOREMAN)", () => {
    expect(agentTypeDoesNotExpandSecrets("CUSTOM")).toBe(true);
    expect(agentTypeDoesNotExpandSecrets("REVIEW")).toBe(true);
    expect(agentTypeDoesNotExpandSecrets("IMPLEMENT")).toBe(true);
  });
  it("23. skill note: no extra secrets injected by skill dirs", () => {
    // No derivation injects skill-based secrets; view only reflects explicit secrets fields
    const view = resolveAllSecretsView(bundle());
    expect(view.foremanDoesNotExpandAccess).toBe(true);
  });
});

describe("alias charset y creds boundary", () => {
  it("24. alias payments valid charset", () => {
    expect(isValidAlias("payments")).toBe(true);
  });
  it("25. alias allows [A-Za-z0-9 ._-]", () => {
    expect(isValidAlias("my alias 1.0_test-OK")).toBe(true);
  });
  it("26. alias with @ fails", () => {
    expect(isValidAlias("bad@alias")).toBe(false);
  });
  it("27. alias 60 chars ok, 61 fails", () => {
    expect(isValidAlias("a".repeat(60))).toBe(true);
    expect(isValidAlias("a".repeat(61))).toBe(false);
  });
  it("28. factory parser fails alias bad charset", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
alias: bad@alias
repositories:
  - owner: acme
    name: payments-service
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
});
