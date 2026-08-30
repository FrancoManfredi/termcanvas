import { describe, it, expect } from "vitest";
import {
  SCHEMA_URLS,
  SCHEMA_AUTH,
  SCHEMA_VERSION,
  VALIDATE_TOOL,
  GET_SCHEMA_TOOL,
  FACTORY_MCP_ENDPOINT,
  WARP_FACTORY_EXAMPLES,
  COPYABLE_EXAMPLES,
  EXAMPLE_01_SINGLE_REPO_QUICKSTART,
  EXAMPLE_02_SDLC_ISSUE_TO_PR,
  validateFactoryYamlLive,
  validateWithParser,
  hasFixtureForExample,
  allFixturesPresent,
  getExampleById,
} from "../domain/validation.derive";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_FACTORY_MINIMAL,
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_SCORER_TESTS,
} from "../fixtures/samples";

describe("validation.derive — WarpFactories.md §7 Machine-readable schema + §16 Referencias + E06 US-059", () => {
  describe("JSON Schema unauthenticated — nombres exactos", () => {
    it("base schema URL exacto del doc", () => {
      expect(SCHEMA_URLS.base).toBe("https://app.warp.dev/api/v1/factory-files/schemas");
    });
    it("v1alpha1 schema URL exacto", () => {
      expect(SCHEMA_URLS.v1alpha1).toBe("https://app.warp.dev/api/v1/factory-files/schemas/v1alpha1");
    });
    it("auth is unauthenticated", () => {
      expect(SCHEMA_AUTH).toBe("unauthenticated");
    });
    it("schema version is v1alpha1", () => {
      expect(SCHEMA_VERSION).toBe("v1alpha1");
    });
    it("validate tool name exacto validate_factory_files", () => {
      expect(VALIDATE_TOOL).toBe("validate_factory_files");
    });
    it("get schema tool name exacto", () => {
      expect(GET_SCHEMA_TOOL).toBe("get_factory_file_schema");
    });
    it("MCP endpoint exacto", () => {
      expect(FACTORY_MCP_ENDPOINT).toBe("https://app.warp.dev/api/v1/mcp/factory");
    });
  });

  describe("warp-factory-examples fixtures 00/01/02/03/04/06/07 §16", () => {
    it("has exactly 7 fixtures (00/01/02/03/04/06/07 — 05 missing intentional)", () => {
      expect(WARP_FACTORY_EXAMPLES).toHaveLength(7);
    });
    it("ids are exact set from spec", () => {
      expect(WARP_FACTORY_EXAMPLES.map((e) => e.id)).toEqual([
        "00-warp-default-agents",
        "01-single-repo-quickstart",
        "02-sdlc-issue-to-pr",
        "03-multi-harness",
        "04-code-review-only",
        "06-common-automations",
        "07-self-hosted-worker",
      ]);
    });
    it("each has githubUrl pointing to warpdotdev/warp-factory-examples", () => {
      for (const ex of WARP_FACTORY_EXAMPLES) {
        expect(ex.githubUrl).toMatch(/warpdotdev\/warp-factory-examples/);
        expect(ex.githubUrl).toContain(ex.path);
      }
    });
    it("each reports hasLocalFixture true (SAMPLE_* present)", () => {
      for (const ex of WARP_FACTORY_EXAMPLES) {
        expect(ex.hasLocalFixture).toBe(true);
      }
      expect(allFixturesPresent()).toBe(true);
    });
    it("helpers work", () => {
      expect(getExampleById("01-single-repo-quickstart")?.path).toBe("01-single-repo-quickstart");
      expect(hasFixtureForExample("02-sdlc-issue-to-pr")).toBe(true);
      expect(hasFixtureForExample("unknown")).toBe(false);
    });
  });

  describe("ejemplos copiables 01-single-repo-quickstart y 02-sdlc-issue-to-pr", () => {
    it("COPYABLE_EXAMPLES contains 01 and 02", () => {
      expect(COPYABLE_EXAMPLES.map((e) => e.id)).toEqual(["01-single-repo-quickstart", "02-sdlc-issue-to-pr"]);
    });
    it("01 has factory.yaml + agents/foreman/agent.md + automation + runner", () => {
      const paths = EXAMPLE_01_SINGLE_REPO_QUICKSTART.files.map((f) => f.path);
      expect(paths).toContain("factory.yaml");
      expect(paths).toContain("agents/foreman/agent.md");
      expect(paths.some((p) => p.includes("automation"))).toBe(true);
      expect(paths.some((p) => p.includes("runners"))).toBe(true);
    });
    it("01 factory.yaml contains schemaVersion v1alpha1 and agentDefaults model", () => {
      const fy = EXAMPLE_01_SINGLE_REPO_QUICKSTART.files.find((f) => f.path === "factory.yaml")!.raw;
      expect(fy).toMatch(/schemaVersion: v1alpha1/);
      expect(fy).toMatch(/agentDefaults:/);
    });
    it("02 has at least factory.yaml + agent + scorer + skill", () => {
      const paths = EXAMPLE_02_SDLC_ISSUE_TO_PR.files.map((f) => f.path);
      expect(paths).toContain("factory.yaml");
      expect(paths.filter((p) => p.includes("agents/")).length).toBeGreaterThanOrEqual(1);
      expect(paths.some((p) => p.includes("scorers/"))).toBe(true);
      expect(paths.some((p) => p.includes("skills/"))).toBe(true);
    });
    it("02 mentions harness auth managedSecret for multi-harness awareness", () => {
      const raw = EXAMPLE_02_SDLC_ISSUE_TO_PR.files.map((f) => f.raw).join("\n");
      expect(raw).toMatch(/managedSecret/);
    });
    it("examples are copyable: raw non-empty and valid yaml/markdown", () => {
      for (const ex of COPYABLE_EXAMPLES) {
        for (const f of ex.files) {
          expect(f.raw.trim().length).toBeGreaterThan(10);
          expect(["yaml", "markdown"]).toContain(f.language);
        }
      }
    });
  });

  describe("validación live con FactoryRegistry / FactoryParser — DIP", () => {
    it("valid minimal factory.yaml passes via validateFactoryYamlLive", () => {
      const res = validateFactoryYamlLive(SAMPLE_FACTORY_MINIMAL);
      expect(res.ok).toBe(true);
    });
    it("validateWithParser returns ok true for valid", () => {
      const r = validateWithParser(SAMPLE_FACTORY_MINIMAL);
      expect(r.ok).toBe(true);
      expect(r.issues).toHaveLength(0);
    });
    it("invalid factory.yaml (bad alias) fails with issues", () => {
      const bad = SAMPLE_FACTORY_MINIMAL.replace("termcanvas", "bad@alias!!!");
      // force alias bad char: inject alias line with bad chars
      const withBadAlias = `schemaVersion: v1alpha1\nname: test\nrepositories:\n  - owner: acme\n    name: repo\nalias: bad@alias!!!\nagentDefaults:\n  model: auto\n`;
      const r = validateWithParser(withBadAlias);
      expect(r.ok).toBe(false);
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.issues[0].message.length).toBeGreaterThan(5);
      void bad;
    });
    it("full bundle via FactoryRegistry validates (minimal factory+foreman+runner)", () => {
      const reg = new FactoryRegistry();
      const res = reg.parseBundle({
        factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
        agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
        runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
        automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
        scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
      });
      expect(res.ok).toBe(true);
      expect(res.value?.factory.name).toBe("termcanvas-factory");
    });
    it("missing schemaVersion fails live validation", () => {
      const raw = `name: test\nrepositories:\n  - owner: acme\n    name: repo\nagentDefaults:\n  model: auto\n`;
      const r = validateFactoryYamlLive(raw);
      expect(r.ok).toBe(false);
    });
    it("valid 01 example factory.yaml passes live validation", () => {
      const fy = EXAMPLE_01_SINGLE_REPO_QUICKSTART.files.find((f) => f.path === "factory.yaml")!.raw;
      expect(validateWithParser(fy).ok).toBe(true);
    });
  });
});
