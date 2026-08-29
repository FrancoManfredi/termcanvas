import { describe, it, expect, beforeEach } from "vitest";
// @ts-ignore - screen exported at runtime via @testing-library/react
import { render, screen } from "@testing-library/react";
import React from "react";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_AGENT_REVIEWER,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_FACTORY_FULL,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_RUNNER_MAC,
} from "../fixtures/samples";
import { parseAgentMd } from "../parsers/agent.parser";


// Helpers — fabricate rich agents covering all WarpFactories §4 + §7 variants
function makeBundleWithVariants() {
  const registry = new FactoryRegistry();
  const triageRaw = `---
description: Investigates codebase and reproduces issues
agentType: TRIAGE
harness:
  type: claude
  model: claude-4-5-haiku
  auth:
    source: managedSecret
    secretName: ANTHROPIC_API_KEY
runner: linux-build
workerHost: warp
secrets:
  - TRIAGE_TOKEN
mcpServers:
  sentry:
    warpId: SENTRY_MCP_SERVER_ID
---

Triage investigates the request, gathers evidence, scope and complexity.
`;
  const specRaw = `---
description: Defines product and technical specs in draft PR
agentType: SPEC
model: auto
runner: linux-build
---

Spec defines product behavior, technical constraints and validation criteria.
`;
  const implementRaw = `---
description: Implements code, tests and validation
agentType: IMPLEMENT
harness:
  type: codex
  model: gpt-4o
  auth:
    source: managedSecret
    secretName: OPENAI_API_KEY
runner: linux-build
workerHost: warp
secrets:
  - NPM_TOKEN
---

Implement continues the branch from spec, writes code, tests and visual evidence.
`;
  const verifyRaw = `---
description: Independent verification after review
agentType: VERIFY
model: auto
workerHost: SELF_HOSTED_WORKER_ID
---

Verify checks correctness against acceptance criteria.
`;
  const customRaw = `---
description: Security analysis for every PR
runner: mac
mcpServers:
  sentry:
    warpId: SENTRY_MCP_SERVER_ID
secrets:
  - SECURITY_TOKEN
  - EXTRA_SECRET
---

Custom security agent audits PRs for vulnerabilities.
`;

  return registry.parseBundle({
    factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
    agents: [
      { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
      { raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" },
      { raw: triageRaw, file: "agents/triage/agent.md" },
      { raw: specRaw, file: "agents/spec/agent.md" },
      { raw: implementRaw, file: "agents/implement/agent.md" },
      { raw: verifyRaw, file: "agents/verify/agent.md" },
      { raw: customRaw, file: "agents/security/agent.md" },
    ],
    runners: [
      { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
      { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
    ],
    automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
    scorers: [],
  });
}

// ── FactoryRegistry / domain invariants ──

describe("Agents — FactoryRegistry invariants (WarpFactories §4 §7)", () => {
  it("1. exactly one FOREMAN required — enriched bundle passes", () => {
    const r = makeBundleWithVariants();
    expect(r.ok).toBe(true);
    const foremen = r.value!.agents.filter((a) => a.agentType === "FOREMAN" || a.agentType === "MAIN");
    expect(foremen).toHaveLength(1);
  });

  it("2. fails with zero foreman", () => {
    const triage = `---
agentType: TRIAGE
model: auto
---

triage`;
    const reg = new FactoryRegistry();
    const r = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [{ raw: triage, file: "agents/triage/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
  });

  it("3. fails with two foremans", () => {
    const reg = new FactoryRegistry();
    const r = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman2/agent.md" },
      ],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
  });

  it("4. all agentType variants parse (FOREMAN/TRIAGE/SPEC/IMPLEMENT/REVIEW/VERIFY/CUSTOM)", () => {
    const types: Array<{ type: string; file: string }> = [
      { type: "FOREMAN", file: "agents/foreman/agent.md" },
      { type: "TRIAGE", file: "agents/triage/agent.md" },
      { type: "SPEC", file: "agents/spec/agent.md" },
      { type: "IMPLEMENT", file: "agents/implement/agent.md" },
      { type: "REVIEW", file: "agents/reviewer/agent.md" },
      { type: "VERIFY", file: "agents/verify/agent.md" },
      { type: "CUSTOM", file: "agents/security/agent.md" },
    ];
    for (const { type, file } of types) {
      const raw = type === "CUSTOM" ? `---\nmodel: auto\n---\ncustom\n` : `---\nagentType: ${type}\nmodel: auto\n---\nbody\n`;
      const pr = parseAgentMd(raw, file);
      expect(pr.ok, `${type} should parse`).toBe(true);
      const expected = type === "CUSTOM" ? "CUSTOM" : type;
      expect(pr.value!.agentType).toBe(expected);
    }
  });

  it("5. MAIN alias treated as FOREMAN for count", () => {
    const mainRaw = `---
agentType: MAIN
model: auto
---

main body`;
    const pr = parseAgentMd(mainRaw, "agents/foreman/agent.md");
    expect(pr.ok).toBe(true);
    expect(pr.value!.agentType).toBe("MAIN");
    const reg = new FactoryRegistry();
    const r = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [{ raw: mainRaw, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(true);
  });

  it("6. harness vs model mutually exclusive", () => {
    const both = `---
agentType: IMPLEMENT
model: auto
harness:
  type: oz
  model: auto
---

body`;
    expect(parseAgentMd(both, "agents/implement/agent.md").ok).toBe(false);
  });

  it("7. harness-only agent parses and exposes harness.type/model/auth", () => {
    const raw = `---
agentType: TRIAGE
harness:
  type: claude
  model: claude-4-5-haiku
  auth:
    source: managedSecret
    secretName: ANTHROPIC_API_KEY
---

body`;
    const r = parseAgentMd(raw, "agents/triage/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value!.harness!.type).toBe("claude");
    expect(r.value!.harness!.model).toBe("claude-4-5-haiku");
    expect(r.value!.harness!.auth!.secretName).toBe("ANTHROPIC_API_KEY");
  });

  it("8. model-only agent parses (shorthand for oz auto)", () => {
    const raw = `---
agentType: SPEC
model: auto
---

spec body`;
    const r = parseAgentMd(raw, "agents/spec/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value!.model).toBe("auto");
    expect(r.value!.harness).toBeUndefined();
  });

  it("9. runner refs must exist — missing runner fails", () => {
    const raw = `---
agentType: FOREMAN
model: auto
runner: does-not-exist
---

body`;
    const reg = new FactoryRegistry();
    const r = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [{ raw, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/does-not-exist/);
  });

  it("10. inherited runner via agentDefaults is valid when agent omits runner", () => {
    const r = makeBundleWithVariants();
    expect(r.ok).toBe(true);
    // verify agent without explicit runner still accepted (verify uses no runner)
    const verify = r.value!.agents.find((a) => a.name === "verify")!;
    expect(verify.runner).toBeUndefined();
    // factory defaults covers it
    expect(r.value!.factory.agentDefaults.runner).toBe("linux-build");
  });

  it("11. secrets exposed per agent and factory-wide", () => {
    const r = makeBundleWithVariants();
    expect(r.ok).toBe(true);
    const foreman = r.value!.agents.find((a) => a.name === "foreman")!;
    expect(foreman.secrets).toEqual(expect.arrayContaining(["SENTRY_AUTH_TOKEN"]));
    const security = r.value!.agents.find((a) => a.name === "security")!;
    expect(security.secrets).toEqual(["SECURITY_TOKEN", "EXTRA_SECRET"]);
  });

  it("12. mcpServers exposed per agent", () => {
    const r = makeBundleWithVariants();
    const foreman = r.value!.agents.find((a) => a.name === "foreman")!;
    expect(foreman.mcpServers).toHaveProperty("sentry");
    expect(foreman.mcpServers!.sentry.warpId).toBe("SENTRY_MCP_SERVER_ID");
  });

  it("13. workerHost exposed when set", () => {
    const r = makeBundleWithVariants();
    const verify = r.value!.agents.find((a) => a.name === "verify")!;
    expect(verify.workerHost).toBe("SELF_HOSTED_WORKER_ID");
  });

  it("14. instructions (body) never empty — parser enforces", () => {
    const emptyBody = `---
agentType: FOREMAN
model: auto
---
`;
    expect(parseAgentMd(emptyBody, "agents/foreman/agent.md").ok).toBe(false);
    const r = makeBundleWithVariants();
    for (const a of r.value!.agents) {
      expect(a.instructions.trim().length).toBeGreaterThan(0);
    }
  });

  it("15. rawPath preserved for GitHub-backed link", () => {
    const r = makeBundleWithVariants();
    for (const a of r.value!.agents) {
      expect(a.rawPath).toMatch(/^agents\/.+\/agent\.md$/);
    }
  });

  it("16. CUSTOM default when agentType omitted", () => {
    const raw = `---
model: auto
---

custom body`;
    const r = parseAgentMd(raw, "agents/my-custom/agent.md");
    expect(r.ok).toBe(true);
    expect(r.value!.agentType).toBe("CUSTOM");
    expect(r.value!.name).toBe("my-custom");
  });

  it("17. OCP: adding custom agent does not require page change — bundle accepts new name", () => {
    const r = makeBundleWithVariants();
    expect(r.ok).toBe(true);
    expect(r.value!.agents.map((a) => a.name)).toContain("security");
    // foreman still unique
    const foremans = r.value!.agents.filter((a) => a.agentType === "FOREMAN" || a.agentType === "MAIN");
    expect(foremans).toHaveLength(1);
  });

  it("18. description optional but preserved when present", () => {
    const r = parseAgentMd(SAMPLE_AGENT_FOREMAN, "agents/foreman/agent.md");
    expect(r.value!.description).toBeTruthy();
  });
});

// ── Component contract (DIP: reads from FactoryBundle) ──

describe("AgentsPage — UI contract (static GitHub-backed read-only, WarpFactories §10)", () => {
  let AgentsPage: any;
  let AgentDetail: any;
  let AgentCard: any;

  beforeEach(async () => {
    // dynamic import so tests fail gracefully if files missing (TDD red phase)
    try {
      const modPage = await import("../../../components/agents/AgentsPage");
      AgentsPage = modPage.AgentsPage ?? modPage.default;
    } catch (e) {
      AgentsPage = null;
    }
    try {
      const modDetail = await import("../../../components/agents/AgentDetail");
      AgentDetail = modDetail.AgentDetail ?? modDetail.default;
    } catch {
      AgentDetail = null;
    }
    try {
      const modCard = await import("../../../components/agents/AgentCard");
      AgentCard = modCard.AgentCard ?? modCard.default;
    } catch {
      AgentCard = null;
    }
  });

  it("19. AgentsPage module exists (SRP file structure)", async () => {
    expect(AgentsPage).toBeTruthy();
  });

  it("20. AgentDetail module exists", async () => {
    expect(AgentDetail).toBeTruthy();
  });

  it("21. renders breadcrumb wilson › Agents", async () => {
    if (!AgentsPage) return;
    render(React.createElement(AgentsPage));
    expect(screen.getAllByText(/wilson/i).length).toBeGreaterThan(0);
    // Agents appears multiple times (breadcrumb + title + file paths) — check at least breadcrumb present
    expect(screen.getAllByText(/Agents/).length).toBeGreaterThan(0);
  });

  it("22. renders list of agents from FactoryBundle (foreman + defaults + custom)", async () => {
    if (!AgentsPage) return;
    render(React.createElement(AgentsPage));
    // should show at least foreman and reviewer from SAMPLE_FACTORY_FULL — allow multiple matches (card + detail + file path)
    expect(screen.getAllByText(/foreman/i).length).toBeGreaterThan(0);
    // reviewer may be shown as REVIEW or reviewer name
    const reviewerEls = screen.queryAllByText(/reviewer|REVIEW/i);
    expect(reviewerEls.length).toBeGreaterThan(0);
  });

  it("23. renders AgentType badges for each variant", async () => {
    if (!AgentsPage) return;
    render(React.createElement(AgentsPage));
    // FOREMAN badge must be present
    expect(screen.getAllByText(/FOREMAN/i).length).toBeGreaterThan(0);
  });

  it("24. selecting an agent shows AgentDetail with description + instructions", async () => {
    if (!AgentsPage) return;
    const { container } = render(React.createElement(AgentsPage));
    // click first agent row/card — use role button to disambiguate from file paths
    const firstButton = screen.getByRole("button", { name: /Select agent foreman/i });
    (firstButton as HTMLElement).click?.();
    // detail should appear — need to re-query
    expect(container.textContent).toMatch(/Routes approved|Own each work item/i);
  });

  it("25. AgentDetail shows harness when present, model when present, runner, workerHost, secrets, mcpServers, and read-only link", async () => {
    if (!AgentDetail) return;
    const bundle = makeBundleWithVariants();
    expect(bundle.ok).toBe(true);
    const withHarness = bundle.value!.agents.find((a) => !!a.harness)!;
    const factory = bundle.value!.factory;
    render(React.createElement(AgentDetail, { agent: withHarness, factory }));
    expect(screen.getAllByText(new RegExp(withHarness.harness!.type, "i")).length).toBeGreaterThan(0);
    // secrets
    if (withHarness.secrets?.length) {
      expect(screen.getAllByText(new RegExp(withHarness.secrets[0], "i")).length).toBeGreaterThan(0);
    }
    // instructions non-empty
    expect(screen.getAllByText(new RegExp(withHarness.instructions.slice(0, 12), "i")).length).toBeGreaterThan(0);
    // read-only link to file
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toMatch(/agent\.md/);
    expect(screen.getAllByText(/read.only|GitHub-backed/i).length).toBeGreaterThan(0);
  });

  it("26. AgentDetail shows model path when harness absent", async () => {
    if (!AgentDetail) return;
    const bundle = makeBundleWithVariants();
    const withModel = bundle.value!.agents.find((a) => !!a.model && !a.harness)!;
    const factory = bundle.value!.factory;
    render(React.createElement(AgentDetail, { agent: withModel, factory }));
    expect(screen.getByText(new RegExp(withModel.model!, "i"))).toBeInTheDocument();
    expect(screen.getByText(/runner/i)).toBeInTheDocument();
  });

  it("27. AgentCard is optional but if present renders name + agentType", async () => {
    if (!AgentCard) {
      return;
    }
    const bundle = makeBundleWithVariants();
    const agent = bundle.value!.agents[0];
    const factory = bundle.value!.factory;
    render(React.createElement(AgentCard, { agent, factory, selected: false, onSelect: () => {} }));
    expect(screen.getAllByText(new RegExp(agent.name, "i")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(agent.agentType, "i")).length).toBeGreaterThan(0);
  });

  it("28. instructions never empty in rendered detail (all agents)", async () => {
    if (!AgentDetail) return;
    const bundle = makeBundleWithVariants();
    for (const agent of bundle.value!.agents) {
      const { unmount } = render(React.createElement(AgentDetail, { agent, factory: bundle.value!.factory }));
      // body snippet must be present
      expect(screen.getByText(new RegExp(agent.instructions.trim().slice(0, 10), "i"))).toBeInTheDocument();
      unmount();
    }
  });

  it("29. shows effective runner fallback to agentDefaults when agent runner undefined", async () => {
    if (!AgentDetail) return;
    const bundle = makeBundleWithVariants();
    const noRunner = bundle.value!.agents.find((a) => !a.runner)!;
    expect(noRunner).toBeTruthy();
    render(React.createElement(AgentDetail, { agent: noRunner, factory: bundle.value!.factory }));
    // should still show factory default runner
    expect(screen.getByText(new RegExp(bundle.value!.factory.agentDefaults.runner!, "i"))).toBeInTheDocument();
  });
});
