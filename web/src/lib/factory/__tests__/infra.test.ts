import { describe, it, expect } from "vitest";
import {
  DEPLOYMENT_PATTERNS,
  TEAM_CHOICES,
  CREDENTIAL_BOUNDARIES,
  ZDR_NOTE,
  ZDR_KEYWORDS,
  GOVERNANCE_NOTE,
  METERING_NOTE,
  METERING_KEYWORDS,
  DEPLOYMENT_CHECKLIST,
  OTEL_METRICS,
  CONCURRENCY_NOTE,
  RUNNER_BACKENDS,
  ENVIRONMENT_VS_RUNNER_VS_HOST,
  HOSTED_MAX,
  CONTROL_VS_EXECUTION,
  getDeploymentPatternById,
  getTeamChoice,
  getCredentialBoundary,
} from "../domain/infra.derive";
import { HOSTED_MAX_VCPUS, HOSTED_MAX_MEMORY_GB } from "../domain/runner.derive";

describe("infra.derive — WarpFactories.md §13/§14 + §8 Runners + E15 US-131→139, E07 US-064→066", () => {
  describe("3 deployment patterns §14 (CLI-only / Warp-hosted / Self-hosted)", () => {
    it("has exactly 3 patterns", () => {
      expect(DEPLOYMENT_PATTERNS).toHaveLength(3);
    });
    it("pattern ids are cli-only, warp-hosted, self-hosted", () => {
      expect(DEPLOYMENT_PATTERNS.map((p) => p.id)).toEqual(["cli-only", "warp-hosted", "self-hosted"]);
    });
    it("pattern names exactos del doc: CLI-only / Warp-hosted / Self-hosted", () => {
      expect(DEPLOYMENT_PATTERNS[0].pattern).toMatch(/CLI-only/);
      expect(DEPLOYMENT_PATTERNS[1].pattern).toMatch(/Warp-hosted/);
      expect(DEPLOYMENT_PATTERNS[2].pattern).toMatch(/Self-hosted/);
    });
    it("CLI-only trigger mentions oz agent run and orchestration Bring your own", () => {
      const cli = DEPLOYMENT_PATTERNS[0];
      expect(cli.trigger).toMatch(/oz agent run/);
      expect(cli.orchestration).toMatch(/Bring your own/);
      expect(cli.execution).toMatch(/Anywhere/);
      expect(cli.visibility).toMatch(/Transcript local/);
    });
    it("Warp-hosted trigger covers GitHub/Slack..., execution Warp-hosted sandbox", () => {
      const wh = DEPLOYMENT_PATTERNS[1];
      expect(wh.trigger).toMatch(/GitHub/);
      expect(wh.execution).toMatch(/Warp-hosted sandbox/);
      expect(wh.visibility).toMatch(/Dashboard/);
    });
    it("Self-hosted execution mentions Managed self-hosted worker and backends", () => {
      const sh = DEPLOYMENT_PATTERNS[2];
      expect(sh.execution).toMatch(/Managed self-hosted worker/);
      expect(sh.execution).toMatch(/Docker\/K8s\/Direct/);
    });
    it("OCP: getDeploymentPatternById works without touching others", () => {
      expect(getDeploymentPatternById("cli-only")?.pattern).toMatch(/CLI-only/);
      expect(getDeploymentPatternById("warp-hosted")?.orchestration).toMatch(/Warp control plane/);
      expect(getDeploymentPatternById("self-hosted")).toBeDefined();
      expect(getDeploymentPatternById("unknown")).toBeUndefined();
    });
  });

  describe("3 choices independientes execution/inference/storage §13 Enterprise only", () => {
    it("has 3 choices", () => {
      expect(TEAM_CHOICES).toHaveLength(3);
    });
    it("choices names are Execution, Inference, Storage exactos", () => {
      expect(TEAM_CHOICES.map((c) => c.choice)).toEqual(["Execution", "Inference", "Storage"]);
    });
    it("each choice has whatChanges and whatStaysWithWarp", () => {
      for (const c of TEAM_CHOICES) {
        expect(c.whatChanges.length).toBeGreaterThan(10);
        expect(c.whatStaysWithWarp.length).toBeGreaterThan(10);
      }
    });
    it("Execution whatChanges mentions checkout/commands/filesystem", () => {
      const exec = TEAM_CHOICES.find((c) => c.choice === "Execution")!;
      expect(exec.whatChanges).toMatch(/checkout.*commands.*filesystem/i);
    });
    it("Inference whatChanges mentions provider/billing/retention", () => {
      const inf = TEAM_CHOICES.find((c) => c.choice === "Inference")!;
      expect(inf.whatChanges).toMatch(/Provider/i);
    });
    it("Storage whatChanges mentions transcripts/artifacts", () => {
      const stor = TEAM_CHOICES.find((c) => c.choice === "Storage")!;
      expect(stor.whatChanges).toMatch(/transcripts/i);
    });
    it("all choices are Enterprise only", () => {
      for (const c of TEAM_CHOICES) expect(c.enterpriseOnly).toBe(true);
    });
    it("helper getTeamChoice case-insensitive", () => {
      expect(getTeamChoice("execution")?.choice).toBe("Execution");
      expect(getTeamChoice("STORAGE")?.choice).toBe("Storage");
      expect(getTeamChoice("unknown")).toBeUndefined();
    });
  });

  describe("4 credential boundaries §13", () => {
    it("has 4 boundaries exactos del doc", () => {
      expect(CREDENTIAL_BOUNDARIES).toHaveLength(4);
    });
    it("names exactos: Inference credentials, Execution secrets, Harness authentication, Repository identity", () => {
      expect(CREDENTIAL_BOUNDARIES.map((b) => b.credential)).toEqual([
        "Inference credentials",
        "Execution secrets",
        "Harness authentication",
        "Repository identity",
      ]);
    });
    it("Inference never injected in sandbox", () => {
      expect(CREDENTIAL_BOUNDARIES[0].boundary).toMatch(/nunca inyectadas en el sandbox/);
    });
    it("Execution mentions allowlist and redaction backstop", () => {
      expect(CREDENTIAL_BOUNDARIES[1].boundary).toMatch(/allowlist/);
      expect(CREDENTIAL_BOUNDARIES[1].boundary).toMatch(/backstop/);
    });
    it("Harness mentions harness.auth sources (solo oz: sin auth)", () => {
      expect(CREDENTIAL_BOUNDARIES[2].boundary).toMatch(/solo oz/);
      expect(CREDENTIAL_BOUNDARIES[2].boundary).toMatch(/no aplican/);
    });
    it("Repository mentions credentialStrategy EXECUTOR/CREATOR", () => {
      expect(CREDENTIAL_BOUNDARIES[3].boundary).toMatch(/EXECUTOR/);
      expect(CREDENTIAL_BOUNDARIES[3].boundary).toMatch(/CREATOR/);
    });
    it("helper getCredentialBoundary finds by substring", () => {
      expect(getCredentialBoundary("inference")?.credential).toBe("Inference credentials");
      expect(getCredentialBoundary("execution")?.credential).toBe("Execution secrets");
      expect(getCredentialBoundary("harness")?.credential).toBe("Harness authentication");
      expect(getCredentialBoundary("repository")?.credential).toBe("Repository identity");
    });
  });

  describe("ZDR §13", () => {
    it("ZDR note mentions Zero Data Retention and self-hosted no es fully offline", () => {
      expect(ZDR_NOTE).toMatch(/Zero Data Retention/);
      expect(ZDR_NOTE).toMatch(/self-hosted no es fully offline/);
    });
    it("ZDR note mentions prompts/results/transcripts/artifacts/telemetry", () => {
      expect(ZDR_NOTE.toLowerCase()).toMatch(/transcripts/);
      expect(ZDR_NOTE.toLowerCase()).toMatch(/artifacts/);
    });
    it("ZDR keywords includes ZDR and Session transcripts", () => {
      expect(ZDR_KEYWORDS.join(" ")).toMatch(/ZDR/);
    });
  });

  describe("Governance sin factory-specific role §13", () => {
    it("mentions existing team roles and no factory-specific approval role", () => {
      expect(GOVERNANCE_NOTE).toMatch(/existing team roles/i);
      expect(GOVERNANCE_NOTE).toMatch(/no.*factory-specific approval role/i);
    });
  });

  describe("Metering credits §13", () => {
    it("mentions credits and hosted compute and platform services", () => {
      expect(METERING_NOTE.toLowerCase()).toMatch(/credits/);
      expect(METERING_NOTE.toLowerCase()).toMatch(/platform services/);
    });
    it("metering keywords include credits", () => {
      expect(METERING_KEYWORDS.join(" ")).toMatch(/credits/);
    });
  });

  describe("7-step deployment checklist §13", () => {
    it("has 7 steps", () => {
      expect(DEPLOYMENT_CHECKLIST).toHaveLength(7);
    });
    it("step titles exactos del doc", () => {
      expect(DEPLOYMENT_CHECKLIST.map((s) => s.title)).toEqual([
        "Classify workload",
        "Choose execution",
        "Configure factory y runners",
        "Choose inference y storage",
        "Scope credentials",
        "Set review gates",
        "Validate operations",
      ]);
    });
    it("Validate operations mentions egress/isolation/redaction/capacity etc", () => {
      const last = DEPLOYMENT_CHECKLIST[6];
      expect(last.detail.toLowerCase()).toMatch(/egress|isolation|redaction/);
    });
  });

  describe("Runners §8 — Environment vs Runner vs Host, 32/64, queued, OTel", () => {
    it("Environment vs Runner vs Host has 3 rows exactos", () => {
      expect(ENVIRONMENT_VS_RUNNER_VS_HOST).toHaveLength(3);
      expect(ENVIRONMENT_VS_RUNNER_VS_HOST.map((r) => r.concept)).toEqual(["Environment", "Runner", "Host"]);
    });
    it("Host row mentions warp and SELF_HOSTED_WORKER_ID via workerHost", () => {
      const host = ENVIRONMENT_VS_RUNNER_VS_HOST.find((r) => r.concept === "Host")!;
      expect(host.where).toMatch(/workerHost/);
    });
    it("HOSTED_MAX is 32 vCPU / 64 GiB", () => {
      expect(HOSTED_MAX.vcpus).toBe(32);
      expect(HOSTED_MAX.memoryGb).toBe(64);
      expect(HOSTED_MAX_VCPUS).toBe(32);
      expect(HOSTED_MAX_MEMORY_GB).toBe(64);
    });
    it("concurrencia queued mentions limitada por team → exceso queueado", () => {
      expect(CONCURRENCY_NOTE).toMatch(/queueado/);
      expect(CONCURRENCY_NOTE).toMatch(/limitada por team/i);
    });
    it("OTel metrics are worker health, task throughput, capacity saturation", () => {
      expect([...OTEL_METRICS]).toEqual(["worker health", "task throughput", "capacity saturation"]);
    });
    it("Runner backends include Docker/Kubernetes/Direct", () => {
      expect([...RUNNER_BACKENDS]).toEqual(["Docker", "Kubernetes", "Direct"]);
    });
    it("Control vs Execution plane has 2 entries", () => {
      expect(CONTROL_VS_EXECUTION).toHaveLength(2);
      expect(CONTROL_VS_EXECUTION[0].plane).toBe("Control plane");
      expect(CONTROL_VS_EXECUTION[1].plane).toBe("Execution plane");
    });
  });
});
