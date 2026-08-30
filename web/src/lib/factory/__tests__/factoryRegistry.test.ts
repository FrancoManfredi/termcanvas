import { describe, it, expect } from "vitest";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_AGENT_REVIEWER,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_FACTORY_FULL,
  SAMPLE_FACTORY_MINIMAL,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_RUNNER_MAC,
  SAMPLE_SCORER_TESTS,
} from "../fixtures/samples";


describe("FactoryRegistry", () => {
  it("parses minimal bundle", () => {
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(true);
    expect(r.value?.factory.name).toBe("termcanvas-factory");
  });

  it("parses full bundle with all types", () => {
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
        { raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" },
      ],
      runners: [
        { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
        { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
      ],
      automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
      scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
    });
    expect(r.ok).toBe(true);
    expect(r.value?.agents).toHaveLength(2);
    expect(r.value?.runners).toHaveLength(2);
  });

  it("fails when no foreman", () => {
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/FOREMAN/);
  });

  it("fails when two foremans", () => {
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
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

  it("fails when referenced runner missing", () => {
    const factoryWithMissingRunner = SAMPLE_FACTORY_MINIMAL.replace("linux-build", "missing-runner");
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: factoryWithMissingRunner, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/missing-runner/);
  });

  it("fails when factory yaml invalid", () => {
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: "bad: yaml: :", file: "factory.yaml" },
      agents: [],
      runners: [],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
  });

  it("collects multiple issues", () => {
    const r = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [{ raw: "", file: "agents/foreman/agent.md" }],
      runners: [{ raw: "", file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(1);
  });
});
