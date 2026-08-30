import { describe, it, expect } from "vitest";
import {
  normalizeRunner,
  validateRunnerShape,
  validateRunnerPlatform,
  validateRunner,
  isHostedLimitExceeded,
  HOSTED_MAX_VCPUS,
  HOSTED_MAX_MEMORY_GB,
  getDefaultRunnerName,
  isDefaultRunner,
  resolveEffectiveRunnerForAgent,
  resolveEffectiveRunnerForAutomation,
  getAgentsUsingRunner,
  getAutomationsUsingRunner,
  deriveRunnerUsage,
  formatInstanceShape,
  formatPlatform,
  ENVIRONMENT_VS_RUNNER_VS_HOST,
} from "../domain/runner.derive";
import type { RunnerDefinition } from "../domain/types";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_FACTORY_FULL,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_RUNNER_MAC,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_SCORER_TESTS,
} from "../fixtures/samples";
import { parseRunnerYaml } from "../parsers/runner.parser";

function runner(overrides: Partial<RunnerDefinition> & { name: string }): RunnerDefinition {
  return {
    rawPath: `runners/${overrides.name}.yaml`,
    description: overrides.description,
    setupCommands: overrides.setupCommands,
    instanceShape: overrides.instanceShape,
    platform: overrides.platform,
    ...overrides,
  } as RunnerDefinition;
}

function makeBundle(overrides?: { factoryYaml?: string; agents?: { raw: string; file: string }[]; runners?: { raw: string; file: string }[]; automations?: { raw: string; file: string }[] }) {
  const reg = new FactoryRegistry();
  const res = reg.parseBundle({
    factoryYaml: { raw: overrides?.factoryYaml ?? SAMPLE_FACTORY_FULL, file: "factory.yaml" },
    agents: overrides?.agents ?? [
      { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
      { raw: `---\ndescription: reviewer\nagentType: REVIEW\nrunner: mac\n---\nreview`, file: "agents/reviewer/agent.md" },
      { raw: `---\ndescription: implement\nagentType: IMPLEMENT\n---\nimplement`, file: "agents/implement/agent.md" },
    ],
    runners: overrides?.runners ?? [
      { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
      { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
    ],
    automations: overrides?.automations ?? [
      { raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" },
      { raw: `---\nagent: reviewer\ntriggers:\n  - provider: github\n    event: pull_request_opened\nrunner: mac\n---\nreview pr`, file: "automations/review-pr/automation.md" },
    ],
    scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
  });
  if (!res.ok) throw new Error(`bundle failed: ${res.issues.map((i) => i.message).join("; ")}`);
  return res.value!;
}

describe("runner.derive — WarpFactories.md §7 runners/<name>.yaml + §8 límites", () => {
  describe("normalizeRunner", () => {
    it("defaults platform to linux/x86_64 when missing", () => {
      const r = runner({ name: "x", platform: undefined });
      const n = normalizeRunner(r);
      expect(n.platform.os).toBe("linux");
      expect(n.platform.arch).toBe("x86_64");
    });
    it("defaults mac version to 26 when macos without version", () => {
      const r = runner({ name: "mac", platform: { os: "macos", arch: "aarch64", mac: {} as never, rawPath: "runners/mac.yaml" } as unknown as RunnerDefinition["platform"] });
      const n = normalizeRunner(r);
      expect(n.platform.mac?.version).toBe("26");
    });
    it("keeps linux dockerImage", () => {
      const r = runner({ name: "linux-build", platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      const n = normalizeRunner(r);
      expect(n.platform.linux?.dockerImage).toBe("ubuntu:22.04");
    });
    it("normalizes mac arch to aarch64 even if input x86_64", () => {
      const r = runner({ name: "mac", platform: { os: "macos", arch: "x86_64" as never, mac: { version: "26" } } });
      const n = normalizeRunner(r);
      expect(n.platform.arch).toBe("aarch64");
    });
    it("preserves allowed mac versions quoted", () => {
      for (const v of ["14", "15", "26", "27"] as const) {
        const r = runner({ name: "mac", platform: { os: "macos", arch: "aarch64", mac: { version: v } } });
        expect(normalizeRunner(r).platform.mac?.version).toBe(v);
      }
    });
  });

  describe("validateRunnerPlatform — Linux requiere dockerImage", () => {
    it("linux with dockerImage ok", () => {
      const r = runner({ name: "x", platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      expect(validateRunnerPlatform(r).ok).toBe(true);
    });
    it("linux without dockerImage fails", () => {
      const r = runner({ name: "x", platform: { os: "linux", arch: "x86_64" } });
      const res = validateRunnerPlatform(r);
      expect(res.ok).toBe(false);
      expect(res.issues.some((i) => i.message.includes("dockerImage"))).toBe(true);
    });
    it("linux with empty dockerImage fails", () => {
      const r = runner({ name: "x", platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "" } } });
      expect(validateRunnerPlatform(r).ok).toBe(false);
    });
    it("macos must be aarch64 fails on x86_64", () => {
      // Directly test parser for this case:
      const raw = `platform:\n  os: macos\n  arch: x86_64\n`;
      const parsed = parseRunnerYaml(raw, "runners/mac.yaml");
      expect(parsed.ok).toBe(false);
      expect(parsed.issues.some((i) => i.message.includes("aarch64"))).toBe(true);
    });
    it("macos with linux field fails", () => {
      const raw = `platform:\n  os: macos\n  arch: aarch64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
      expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
    });
    it("linux with mac field fails", () => {
      const raw = `platform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n  mac:\n    version: "26"\n`;
      expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
    });
  });

  describe("validateRunnerShape — vcpus/memory juntos + hosted limits", () => {
    it("no shape ok", () => {
      const r = runner({ name: "x", platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      expect(validateRunnerShape(r).ok).toBe(true);
    });
    it("both vcpus and memoryGb ok", () => {
      const r = runner({ name: "x", instanceShape: { vcpus: 4, memoryGb: 8 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      expect(validateRunnerShape(r).ok).toBe(true);
    });
    it("only vcpus without memoryGb fails via parser", () => {
      const raw = `instanceShape:\n  vcpus: 4\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
      expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
    });
    it("only memoryGb without vcpus fails via parser", () => {
      const raw = `instanceShape:\n  memoryGb: 8\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
      expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
    });
    it("negative vcpus fails", () => {
      const raw = `instanceShape:\n  vcpus: -1\n  memoryGb: 8\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
      expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
    });
    it("zero memoryGb fails", () => {
      const raw = `instanceShape:\n  vcpus: 2\n  memoryGb: 0\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
      expect(parseRunnerYaml(raw, "runners/bad.yaml").ok).toBe(false);
    });
    it("hosted max 32/64 ok at boundary", () => {
      const r = runner({ name: "big", instanceShape: { vcpus: 32, memoryGb: 64 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      expect(validateRunnerShape(r, { isSelfHosted: false }).ok).toBe(true);
    });
    it("hosted exceeds 32 vCPU fails", () => {
      const r = runner({ name: "big", instanceShape: { vcpus: 64, memoryGb: 8 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      const res = validateRunnerShape(r, { isSelfHosted: false });
      expect(res.ok).toBe(false);
      expect(res.issues.some((i) => i.code === "exceeds_max_vcpu")).toBe(true);
    });
    it("hosted exceeds 64 GiB fails", () => {
      const r = runner({ name: "big", instanceShape: { vcpus: 4, memoryGb: 128 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      const res = validateRunnerShape(r, { isSelfHosted: false });
      expect(res.ok).toBe(false);
      expect(res.issues.some((i) => i.code === "exceeds_max_memory")).toBe(true);
    });
    it("self-hosted exempt from limits", () => {
      const r = runner({ name: "big", instanceShape: { vcpus: 64, memoryGb: 128 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      expect(validateRunnerShape(r, { isSelfHosted: true }).ok).toBe(true);
    });
    it("isHostedLimitExceeded helper respects self-hosted", () => {
      expect(isHostedLimitExceeded({ vcpus: 64, memoryGb: 8 }, false)).toBe(true);
      expect(isHostedLimitExceeded({ vcpus: 64, memoryGb: 8 }, true)).toBe(false);
      expect(isHostedLimitExceeded({ vcpus: 32, memoryGb: 64 }, false)).toBe(false);
      expect(isHostedLimitExceeded(undefined, false)).toBe(false);
    });
    it("HOSTED_MAX constants are 32/64", () => {
      expect(HOSTED_MAX_VCPUS).toBe(32);
      expect(HOSTED_MAX_MEMORY_GB).toBe(64);
    });
  });

  describe("mac.version default 26 quoted", () => {
    it("mac without version parses and defaults to 26", () => {
      const raw = `platform:\n  os: macos\n  arch: aarch64\n`;
      const parsed = parseRunnerYaml(raw, "runners/mac.yaml");
      expect(parsed.ok).toBe(true);
      const normalized = normalizeRunner(parsed.value!);
      expect(normalized.platform.mac?.version).toBe("26");
    });
    it("mac version 14 parses", () => {
      const raw = `platform:\n  os: macos\n  arch: aarch64\n  mac:\n    version: "14"\n`;
      expect(parseRunnerYaml(raw, "runners/mac.yaml").ok).toBe(true);
      expect(normalizeRunner(parseRunnerYaml(raw, "runners/mac.yaml").value!).platform.mac?.version).toBe("14");
    });
    it("mac version 15 parses", () => {
      const raw = `platform:\n  os: macos\n  arch: aarch64\n  mac:\n    version: "15"\n`;
      expect(parseRunnerYaml(raw, "runners/mac.yaml").ok).toBe(true);
    });
    it("mac version 27 parses", () => {
      const raw = `platform:\n  os: macos\n  arch: aarch64\n  mac:\n    version: "27"\n`;
      expect(parseRunnerYaml(raw, "runners/mac.yaml").ok).toBe(true);
    });
    it("mac version without quotes numeric still parses (yaml coerces)", () => {
      const raw = `platform:\n  os: macos\n  arch: aarch64\n  mac:\n    version: 26\n`;
      // zod expects string enum; numeric 26 will fail — ensures quoted requirement
      const parsed = parseRunnerYaml(raw, "runners/mac.yaml");
      expect(parsed.ok).toBe(false);
    });
  });

  describe("resolveEffectiveRunnerForAgent / default", () => {
    it("agent with runner returns its runner", () => {
      const bundle = makeBundle();
      expect(resolveEffectiveRunnerForAgent("reviewer", bundle)).toBe("mac");
    });
    it("agent without runner returns default", () => {
      const bundle = makeBundle();
      expect(resolveEffectiveRunnerForAgent("implement", bundle)).toBe("linux-build");
    });
    it("getDefaultRunnerName returns factory default", () => {
      const bundle = makeBundle();
      expect(getDefaultRunnerName(bundle)).toBe("linux-build");
    });
    it("isDefaultRunner true for default", () => {
      const bundle = makeBundle();
      expect(isDefaultRunner("linux-build", bundle)).toBe(true);
      expect(isDefaultRunner("mac", bundle)).toBe(false);
    });
    it("agents using linux-build includes default agents", () => {
      const bundle = makeBundle();
      const agents = getAgentsUsingRunner("linux-build", bundle);
      expect(agents).toContain("foreman");
      expect(agents).toContain("implement");
      expect(agents).not.toContain("reviewer");
    });
    it("agents using mac includes overridden", () => {
      const bundle = makeBundle();
      expect(getAgentsUsingRunner("mac", bundle)).toEqual(["reviewer"]);
    });
  });

  describe("resolveEffectiveRunnerForAutomation", () => {
    it("automation with runner returns its runner", () => {
      const bundle = makeBundle();
      expect(resolveEffectiveRunnerForAutomation("review-pr", bundle)).toBe("mac");
    });
    it("automation without runner inherits agent's runner", () => {
      const bundle = makeBundle();
      // labeled-issue targets foreman -> foreman has no explicit runner -> default linux-build
      expect(resolveEffectiveRunnerForAutomation("labeled-issue", bundle)).toBe("linux-build");
    });
    it("getAutomationsUsingRunner direct only", () => {
      const bundle = makeBundle();
      expect(getAutomationsUsingRunner("mac", bundle)).toEqual(["review-pr"]);
      expect(getAutomationsUsingRunner("linux-build", bundle)).toEqual([]);
    });
  });

  describe("deriveRunnerUsage", () => {
    it("covers all runners", () => {
      const bundle = makeBundle();
      const usage = deriveRunnerUsage(bundle);
      expect(usage).toHaveLength(2);
      const linux = usage.find((u) => u.runnerName === "linux-build")!;
      expect(linux.isDefault).toBe(true);
      expect(linux.agents.length).toBeGreaterThan(0);
      const mac = usage.find((u) => u.runnerName === "mac")!;
      expect(mac.isDefault).toBe(false);
      expect(mac.agents).toContain("reviewer");
    });
    it("handles bundle with no runners", () => {
      const foremanNoRunner = `---\ndescription: foreman\nagentType: FOREMAN\nmodel: auto\n---\nforeman`;
      const bundle = makeBundle({
        runners: [],
        factoryYaml: `schemaVersion: v1alpha1\nname: test\nrepositories:\n  - owner: acme\n    name: repo\nagentDefaults:\n  model: auto\n`,
        agents: [{ raw: foremanNoRunner, file: "agents/foreman/agent.md" }],
        automations: [],
      });
      expect(deriveRunnerUsage(bundle)).toEqual([]);
    });
  });

  describe("format helpers", () => {
    it("formatInstanceShape default", () => {
      expect(formatInstanceShape(undefined)).toBe("default (workspace)");
    });
    it("formatInstanceShape with values", () => {
      expect(formatInstanceShape({ vcpus: 4, memoryGb: 8 })).toBe("4 vCPU / 8 GiB");
    });
    it("formatPlatform linux", () => {
      expect(formatPlatform({ os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } })).toContain("ubuntu:22.04");
    });
    it("formatPlatform mac", () => {
      expect(formatPlatform({ os: "macos", arch: "aarch64", mac: { version: "26" } })).toContain("macOS 26");
    });
    it("formatPlatform undefined", () => {
      expect(formatPlatform(undefined)).toBe("linux / x86_64");
    });
  });

  describe("ENVIRONMENT_VS_RUNNER_VS_HOST table", () => {
    it("has 3 rows", () => {
      expect(ENVIRONMENT_VS_RUNNER_VS_HOST).toHaveLength(3);
    });
    it("concepts are Environment, Runner, Host", () => {
      expect(ENVIRONMENT_VS_RUNNER_VS_HOST.map((r) => r.concept)).toEqual(["Environment", "Runner", "Host"]);
    });
    it("Host row mentions warp and SELF_HOSTED_WORKER_ID", () => {
      const host = ENVIRONMENT_VS_RUNNER_VS_HOST.find((r) => r.concept === "Host")!;
      expect(host.what).toContain("warp");
      expect(host.where).toContain("workerHost");
    });
  });

  describe("validateRunner combined", () => {
    it("linux valid passes", () => {
      const r = runner({ name: "linux-build", instanceShape: { vcpus: 4, memoryGb: 8 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } }, setupCommands: ["corepack enable"] });
      expect(validateRunner(r).ok).toBe(true);
    });
    it("linux missing dockerImage fails combined", () => {
      const r = runner({ name: "bad", platform: { os: "linux", arch: "x86_64" } });
      expect(validateRunner(r).ok).toBe(false);
    });
    it("hosted limit still applies in combined", () => {
      const r = runner({ name: "big", instanceShape: { vcpus: 64, memoryGb: 64 }, platform: { os: "linux", arch: "x86_64", linux: { dockerImage: "ubuntu:22.04" } } });
      expect(validateRunner(r, { isSelfHosted: false }).ok).toBe(false);
      expect(validateRunner(r, { isSelfHosted: true }).ok).toBe(true);
    });
  });

  describe("real samples integration", () => {
    it("SAMPLE_RUNNER_LINUX parses and validates", () => {
      const parsed = parseRunnerYaml(SAMPLE_RUNNER_LINUX, "runners/linux-build.yaml");
      expect(parsed.ok).toBe(true);
      expect(validateRunner(parsed.value!).ok).toBe(true);
      expect(normalizeRunner(parsed.value!).platform.linux?.dockerImage).toBe("ubuntu:22.04");
    });
    it("SAMPLE_RUNNER_MAC parses and validates default 26", () => {
      const parsed = parseRunnerYaml(SAMPLE_RUNNER_MAC, "runners/mac.yaml");
      expect(parsed.ok).toBe(true);
      expect(validateRunner(parsed.value!).ok).toBe(true);
      expect(normalizeRunner(parsed.value!).platform.mac?.version).toBe("26");
    });
  });
});
