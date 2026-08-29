import type { FactoryBundle } from "../store/factoryRegistry";
import type { RunnerDefinition } from "./types";

export const HOSTED_MAX_VCPUS = 32;
export const HOSTED_MAX_MEMORY_GB = 64;
export const ALLOWED_MAC_VERSIONS = ["14", "15", "26", "27"] as const;
export type MacVersion = (typeof ALLOWED_MAC_VERSIONS)[number];

export interface RunnerValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface RunnerValidationResult {
  ok: boolean;
  issues: RunnerValidationIssue[];
}

export interface RunnerUsage {
  runnerName: string;
  agents: string[];
  automations: string[];
  isDefault: boolean;
}

export interface NormalizedRunner extends RunnerDefinition {
  platform: NonNullable<RunnerDefinition["platform"]>;
}

export function normalizeRunner(runner: RunnerDefinition): NormalizedRunner {
  const rawPlatform = runner.platform;
  const os = rawPlatform?.os ?? "linux";
  const arch = rawPlatform?.arch ?? (os === "macos" ? "aarch64" : "x86_64");
  const linux = rawPlatform?.linux;
  const macRaw = rawPlatform?.mac;

  let normalizedPlatform: NormalizedRunner["platform"];

  if (os === "macos") {
    const version = (macRaw?.version ?? "26") as MacVersion;
    normalizedPlatform = {
      os: "macos",
      arch: "aarch64",
      mac: { version },
    };
  } else {
    normalizedPlatform = {
      os: "linux",
      arch: arch as "x86_64" | "aarch64",
      linux: linux ? { dockerImage: linux.dockerImage } : undefined,
    };
  }

  const normalized: NormalizedRunner = {
    ...runner,
    platform: normalizedPlatform,
  };
  return normalized;
}

export function validateRunnerShape(
  runner: RunnerDefinition,
  opts: { isSelfHosted?: boolean } = {}
): RunnerValidationResult {
  const issues: RunnerValidationIssue[] = [];
  const shape = runner.instanceShape;

  if (shape) {
    if (shape.vcpus === undefined || shape.memoryGb === undefined) {
      issues.push({
        path: `${runner.rawPath}.instanceShape`,
        message: "instanceShape: vcpus and memoryGb must be set together",
        code: "shape_incomplete",
      });
    }
    if (shape.vcpus !== undefined && (!Number.isInteger(shape.vcpus) || shape.vcpus <= 0)) {
      issues.push({
        path: `${runner.rawPath}.instanceShape.vcpus`,
        message: "vcpus must be positive integer",
        code: "invalid_vcpus",
      });
    }
    if (shape.memoryGb !== undefined && (typeof shape.memoryGb !== "number" || shape.memoryGb <= 0)) {
      issues.push({
        path: `${runner.rawPath}.instanceShape.memoryGb`,
        message: "memoryGb must be positive number",
        code: "invalid_memory",
      });
    }
    if (!opts.isSelfHosted) {
      if (shape.vcpus !== undefined && shape.vcpus > HOSTED_MAX_VCPUS) {
        issues.push({
          path: `${runner.rawPath}.instanceShape.vcpus`,
          message: `exceeds hosted max ${HOSTED_MAX_VCPUS} vCPU — contact support or use self-hosted`,
          code: "exceeds_max_vcpu",
        });
      }
      if (shape.memoryGb !== undefined && shape.memoryGb > HOSTED_MAX_MEMORY_GB) {
        issues.push({
          path: `${runner.rawPath}.instanceShape.memoryGb`,
          message: `exceeds hosted max ${HOSTED_MAX_MEMORY_GB} GiB — contact support or use self-hosted`,
          code: "exceeds_max_memory",
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function validateRunnerPlatform(runner: RunnerDefinition): RunnerValidationResult {
  const issues: RunnerValidationIssue[] = [];
  const normalized = normalizeRunner(runner);
  const platform = normalized.platform;
  const os = platform.os;
  const arch = platform.arch;

  if (os === "linux") {
    if (!platform.linux?.dockerImage || platform.linux.dockerImage.trim().length === 0) {
      issues.push({
        path: `${runner.rawPath}.platform.linux.dockerImage`,
        message: "platform.linux.dockerImage required when os is linux",
        code: "missing_docker_image",
      });
    }
    if ((platform as unknown as Record<string, unknown>).mac !== undefined) {
      issues.push({
        path: `${runner.rawPath}.platform.mac`,
        message: "linux runner must not have platform.mac",
        code: "unexpected_mac",
      });
    }
  }

  if (os === "macos") {
    if (arch !== "aarch64") {
      issues.push({
        path: `${runner.rawPath}.platform.arch`,
        message: "macOS runners must be aarch64",
        code: "invalid_mac_arch",
      });
    }
    if ((platform as unknown as Record<string, unknown>).linux !== undefined) {
      issues.push({
        path: `${runner.rawPath}.platform.linux`,
        message: "macOS runner must not have platform.linux",
        code: "unexpected_linux",
      });
    }
    const version = platform.mac?.version ?? "26";
    if (!ALLOWED_MAC_VERSIONS.includes(version as MacVersion)) {
      issues.push({
        path: `${runner.rawPath}.platform.mac.version`,
        message: `mac.version must be one of ${ALLOWED_MAC_VERSIONS.join(", ")} — default "26" quoted`,
        code: "invalid_mac_version",
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function validateRunner(
  runner: RunnerDefinition,
  opts: { isSelfHosted?: boolean } = {}
): RunnerValidationResult {
  const shapeRes = validateRunnerShape(runner, opts);
  const platformRes = validateRunnerPlatform(runner);
  const all = [...shapeRes.issues, ...platformRes.issues];
  return { ok: all.length === 0, issues: all };
}

export function isHostedLimitExceeded(shape: { vcpus: number; memoryGb: number } | undefined, isSelfHosted: boolean): boolean {
  if (!shape) return false;
  if (isSelfHosted) return false;
  return shape.vcpus > HOSTED_MAX_VCPUS || shape.memoryGb > HOSTED_MAX_MEMORY_GB;
}

export function getDefaultRunnerName(bundle: FactoryBundle): string | null {
  return bundle.factory.agentDefaults.runner ?? null;
}

export function isDefaultRunner(runnerName: string, bundle: FactoryBundle): boolean {
  return getDefaultRunnerName(bundle) === runnerName;
}

export function resolveEffectiveRunnerForAgent(agentName: string, bundle: FactoryBundle): string | null {
  const agent = bundle.agents.find((a) => a.name === agentName);
  if (!agent) return null;
  if (agent.runner) return agent.runner;
  return bundle.factory.agentDefaults.runner ?? null;
}

export function resolveEffectiveRunnerForAutomation(automationName: string, bundle: FactoryBundle): string | null {
  const automation = bundle.automations.find((a) => a.name === automationName);
  if (!automation) return null;
  if (automation.runner) return automation.runner;
  const targetAgentName = automation.agent;
  const agentRunner = resolveEffectiveRunnerForAgent(targetAgentName, bundle);
  return agentRunner;
}

export function getAgentsUsingRunner(runnerName: string, bundle: FactoryBundle): string[] {
  const result: string[] = [];
  for (const agent of bundle.agents) {
    const effective = resolveEffectiveRunnerForAgent(agent.name, bundle);
    if (effective === runnerName) {
      result.push(agent.name);
    }
  }
  return result.sort();
}

export function getAutomationsUsingRunner(runnerName: string, bundle: FactoryBundle): string[] {
  const result: string[] = [];
  for (const automation of bundle.automations) {
    if (automation.runner === runnerName) {
      result.push(automation.name);
    }
  }
  return result.sort();
}

export function deriveRunnerUsage(bundle: FactoryBundle): RunnerUsage[] {
  return bundle.runners.map((runner) => {
    const agents = getAgentsUsingRunner(runner.name, bundle);
    const automations = getAutomationsUsingRunner(runner.name, bundle);
    const isDefault = isDefaultRunner(runner.name, bundle);
    return {
      runnerName: runner.name,
      agents,
      automations,
      isDefault,
    };
  });
}

export function formatInstanceShape(shape: RunnerDefinition["instanceShape"]): string {
  if (!shape) return "default (workspace)";
  return `${shape.vcpus} vCPU / ${shape.memoryGb} GiB`;
}

export function formatPlatform(platform: RunnerDefinition["platform"]): string {
  if (!platform) return "linux / x86_64";
  const normalized = normalizeRunner({ name: "_tmp", rawPath: "_tmp", platform } as RunnerDefinition).platform;
  if (normalized.os === "macos") {
    return `macos / aarch64 · macOS ${normalized.mac?.version ?? "26"}`;
  }
  return `linux / ${normalized.arch} · ${normalized.linux?.dockerImage ?? "—"}`;
}

export const ENVIRONMENT_VS_RUNNER_VS_HOST = [
  {
    concept: "Environment",
    what: "Workspace: repos, setupCommands, secrets, image",
    where: "factory.yaml (repositories, secrets, agentDefaults.environmentId) + repo",
  },
  {
    concept: "Runner",
    what: "Compute: OS/arch, instanceShape, dockerImage / mac.version",
    where: "runners/<name>.yaml",
  },
  {
    concept: "Host",
    what: "Where it executes: warp (hosted) vs SELF_HOSTED_WORKER_ID",
    where: "agentDefaults.workerHost / per-agent / per-automation",
  },
] as const;
