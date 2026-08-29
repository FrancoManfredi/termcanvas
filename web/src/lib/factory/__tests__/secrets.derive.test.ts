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

describe("secrets.derive - scoping reemplaza no agrega", () => {
  it("1. factory-wide secrets = [SENTRY_AUTH_TOKEN] from SAMPLE_FACTORY_FULL", () => {
    const b = bundle();
    expect(getFactoryWideSecrets(b)).toEqual(["SENTRY_AUTH_TOKEN"]);
  });
  it("2. agentDefaults secrets = [SHARED_SECRET]", () => {
    const b = bundle();
    expect(getAgentDefaultsSecrets(b)).toEqual(["SHARED_SECRET"]);
  });
  it("3. foreman has per-agent secrets [SENTRY_AUTH_TOKEN] that replaces agentDefaults", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.factoryWide).toEqual(["SENTRY_AUTH_TOKEN"]);
    expect(eff.inheritedOrOverridden).toEqual(["SENTRY_AUTH_TOKEN"]);
    expect(eff.usesPerAgentOverride).toBe(true);
  });
  it("4. foreman effective = factoryWide + per-agent, dedup => [SENTRY_AUTH_TOKEN]", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.effective).toEqual(["SENTRY_AUTH_TOKEN"]);
  });
  it("5. reviewer without per-agent secrets inherits agentDefaults SHARED_SECRET", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "reviewer")!;
    expect(eff.usesPerAgentOverride).toBe(false);
    expect(eff.inheritedOrOverridden).toEqual(["SHARED_SECRET"]);
    expect(eff.effective).toEqual(["SENTRY_AUTH_TOKEN", "SHARED_SECRET"]);
  });
  it("6. factory-wide always applies even when per-agent exists", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "foreman")!;
    expect(eff.effective).toContain("SENTRY_AUTH_TOKEN");
  });
  it("7. implement has per-agent NPM_TOKEN -> effective = factory SENTRY + NPM_TOKEN (no SHARED_SECRET)", () => {
    const b = bundle();
    const eff = resolveEffectiveSecretsForAgent(b, "implement")!;
    expect(eff.inheritedOrOverridden).toEqual(["NPM_TOKEN"]);
    expect(eff.effective).toEqual(["SENTRY_AUTH_TOKEN", "NPM_TOKEN"]);
    expect(eff.effective).not.toContain("SHARED_SECRET");
  });
  it("8. triage per-agent TRIAGE_TOKEN replaces SHARED_SECRET", () => {
    const eff = resolveEffectiveSecretsForAgent(bundle(), "triage")!;
    expect(eff.effective).not.toContain("SHARED_SECRET");
    expect(eff.effective).toEqual(expect.arrayContaining(["SENTRY_AUTH_TOKEN", "TRIAGE_TOKEN"]));
  });
  it("9. custom security agent has two secrets replaces", () => {
    const eff = resolveEffectiveSecretsForAgent(bundle(), "security")!;
    expect(eff.inheritedOrOverridden).toEqual(["SECURITY_TOKEN", "EXTRA_SECRET"]);
    expect(eff.effective).toEqual(["SENTRY_AUTH_TOKEN", "SECURITY_TOKEN", "EXTRA_SECRET"]);
  });
  it("10. verify inherits agentDefaults (no per-agent) => SENTRY + SHARED", () => {
    const eff = resolveEffectiveSecretsForAgent(bundle(), "verify")!;
    expect(eff.effective).toEqual(["SENTRY_AUTH_TOKEN", "SHARED_SECRET"]);
  });
  it("11. resolveAll view lists SENTRY_AUTH_TOKEN and SHARED_SECRET among allDistinct", () => {
    const view = resolveAllSecretsView(bundle());
    expect(view.allDistinct).toEqual(expect.arrayContaining(["SENTRY_AUTH_TOKEN", "SHARED_SECRET"]));
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
  it("14. factory-wide mcp sentry warpId SENTRY_MCP_SERVER_ID", () => {
    const view = resolveAllMcpView(bundle());
    expect(view.factoryWide).toEqual({ sentry: "SENTRY_MCP_SERVER_ID" });
  });
  it("15. foreman mcp sentry warpId present", () => {
    const eff = resolveEffectiveMcpForAgent(bundle(), "foreman")!;
    expect(eff.effective.sentry).toBe("SENTRY_MCP_SERVER_ID");
  });
  it("16. reviewer without mcpServers has no effective mcp (no defaults)", () => {
    const eff = resolveEffectiveMcpForAgent(bundle(), "reviewer")!;
    expect(eff.effective).toEqual({ sentry: "SENTRY_MCP_SERVER_ID" }); // inherits factory-wide, but per-agent missing means agentDefaults none + factoryWide -> still factoryWide
    // reviewer has no mcpServers, but factoryWide still applies
    expect(eff.inheritedOrOverridden).toEqual({});
  });
  it("17. security custom agent has sentry mcp", () => {
    const eff = resolveEffectiveMcpForAgent(bundle(), "security")!;
    expect(eff.effective.sentry).toBe("SENTRY_MCP_SERVER_ID");
  });
  it("18. mcp warpId empty fails validation", () => {
    expect(isValidMcpWarpId("")).toBe(false);
    expect(isValidMcpWarpId("SENTRY_MCP_SERVER_ID")).toBe(true);
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
    // foreman has 1 effective distinct, security has 3 — FOREMAN not privileged
    expect(effFore.effective.length).toBeLessThanOrEqual(effCust.effective.length);
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
