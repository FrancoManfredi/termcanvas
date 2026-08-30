// SRP: pure derive of factory definition files from FactoryBundle — no I/O, no React
// DIP: reads from FactoryBundle (produced by FactoryRegistry), not concrete storage
// OCP: adding new file kind does not touch page — extend derive + viewer

import type { FactoryBundle } from "../store/factoryRegistry";

export type DefinitionMode = "warp-managed" | "github-backed" | "live-managed";

export interface DefinitionFile {
  path: string;
  kind: "factory" | "agent" | "automation" | "runner" | "scorer" | "skill";
  raw: string;
  language: "yaml" | "markdown";
}

export interface WarpFactoryConfigIssue {
  file: string;
  line: number;
  message: string;
  code: string;
}

export interface DefinitionVisibility {
  visible: boolean;
  readOnly: boolean;
  editable: boolean;
  banner?: string;
  linkLabel?: string;
}

export function getDefinitionVisibility(mode: DefinitionMode): DefinitionVisibility {
  switch (mode) {
    case "warp-managed":
      return { visible: true, readOnly: false, editable: true };
    case "github-backed":
      return {
        visible: false,
        readOnly: true,
        editable: false,
        banner: "managed in GitHub, edit via PR",
        linkLabel: "Open in GitHub",
      };
    case "live-managed":
      return { visible: false, readOnly: true, editable: false, banner: "Live-managed — no definition files (API)" };
    default:
      return { visible: true, readOnly: false, editable: true };
  }
}

export function shouldShowFactoryDefinitionTab(mode: DefinitionMode): boolean {
  return getDefinitionVisibility(mode).visible;
}

export function findLineNumber(raw: string, needle: string): number {
  const lines = raw.split("\n");
  const lower = needle.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lower)) return i + 1;
  }
  return 1;
}

export function githubFileUrl(
  owner: string,
  name: string,
  filePath: string,
  line?: number,
  branch = "main"
): string {
  const base = `https://github.com/${owner}/${name}/blob/${branch}/${filePath}`;
  if (line && line > 0) return `${base}#L${line}`;
  return base;
}

function renderFactoryYaml(bundle: FactoryBundle): string {
  const f = bundle.factory;
  const lines: string[] = [];
  lines.push(`schemaVersion: ${f.schemaVersion}`);
  lines.push(`name: ${f.name}`);
  if (f.description) lines.push(`description: ${f.description}`);
  if (f.alias) lines.push(`alias: ${f.alias}`);
  if (f.credentialStrategy) lines.push(`credentialStrategy: ${f.credentialStrategy}`);
  lines.push(`repositories:`);
  for (const r of f.repositories) lines.push(`  - owner: ${r.owner}\n    name: ${r.name}`);
  if (f.secrets?.length) {
    lines.push(`secrets:`);
    for (const s of f.secrets) lines.push(`  - ${s}`);
  }
  if (f.mcpServers) {
    lines.push(`mcpServers:`);
    for (const [k, v] of Object.entries(f.mcpServers)) lines.push(`  ${k}:\n    warpId: ${v.warpId}`);
  }
  if (f.integrations?.length) {
    lines.push(`integrations:`);
    for (const i of f.integrations) lines.push(`  - type: ${i.type}`);
  }
  lines.push(`agentDefaults:`);
  if (f.agentDefaults.model) lines.push(`  model: ${f.agentDefaults.model}`);
  if (f.agentDefaults.harness) {
    lines.push(`  harness:`);
    lines.push(`    type: ${f.agentDefaults.harness.type}`);
    if (f.agentDefaults.harness.model) lines.push(`    model: ${f.agentDefaults.harness.model}`);
    if (f.agentDefaults.harness.reasoningLevel) lines.push(`    reasoningLevel: ${f.agentDefaults.harness.reasoningLevel}`);
    if (f.agentDefaults.harness.auth) {
      lines.push(`    auth:`);
      lines.push(`      source: ${f.agentDefaults.harness.auth.source}`);
      if (f.agentDefaults.harness.auth.secretName) lines.push(`      secretName: ${f.agentDefaults.harness.auth.secretName}`);
    }
  }
  if (f.agentDefaults.runner) lines.push(`  runner: ${f.agentDefaults.runner}`);
  if (f.agentDefaults.environmentId) lines.push(`  environmentId: ${f.agentDefaults.environmentId}`);
  if (f.agentDefaults.workerHost) lines.push(`  workerHost: ${f.agentDefaults.workerHost}`);
  return lines.join("\n") + "\n";
}

function renderAgentMd(agent: FactoryBundle["agents"][number]): string {
  const fm: string[] = ["---"];
  if (agent.description) fm.push(`description: ${agent.description}`);
  fm.push(`agentType: ${agent.agentType}`);
  if (agent.credentialStrategy) fm.push(`credentialStrategy: ${agent.credentialStrategy}`);
  if (agent.model) fm.push(`model: ${agent.model}`);
  if (agent.harness) {
    fm.push(`harness:`);
    fm.push(`  type: ${agent.harness.type}`);
    if (agent.harness.model) fm.push(`  model: ${agent.harness.model}`);
    if (agent.harness.reasoningLevel) fm.push(`  reasoningLevel: ${agent.harness.reasoningLevel}`);
    if (agent.harness.auth) {
      fm.push(`  auth:`);
      fm.push(`    source: ${agent.harness.auth.source}`);
      if (agent.harness.auth.secretName) fm.push(`    secretName: ${agent.harness.auth.secretName}`);
    }
  }
  if (agent.runner) fm.push(`runner: ${agent.runner}`);
  if (agent.environmentId) fm.push(`environmentId: ${agent.environmentId}`);
  if (agent.workerHost) fm.push(`workerHost: ${agent.workerHost}`);
  if (agent.secrets?.length) {
    fm.push(`secrets:`);
    for (const s of agent.secrets) fm.push(`  - ${s}`);
  }
  if (agent.mcpServers) {
    fm.push(`mcpServers:`);
    for (const [k, v] of Object.entries(agent.mcpServers)) fm.push(`  ${k}:\n    warpId: ${v.warpId}`);
  }
  fm.push("---", "", agent.instructions.trim(), "");
  return fm.join("\n");
}

function renderAutomationMd(auto: FactoryBundle["automations"][number]): string {
  const fm: string[] = ["---"];
  fm.push(`enabled: ${auto.enabled}`);
  fm.push(`agent: ${auto.agent}`);
  fm.push(`triggers:`);
  for (const t of auto.triggers) {
    fm.push(`  - provider: ${t.provider}`);
    fm.push(`    event: ${t.event}`);
    if (t.filter) {
      fm.push(`    filter:`);
      for (const [k, v] of Object.entries(t.filter)) {
        if (Array.isArray(v)) fm.push(`      ${k}: [${v.join(", ")}]`);
        else if (v && typeof v === "object") fm.push(`      ${k}: ${JSON.stringify(v)}`);
        else fm.push(`      ${k}: ${String(v)}`);
      }
    }
    if (t.schedule) fm.push(`    schedule: ${JSON.stringify(t.schedule)}`);
  }
  if (auto.runner) fm.push(`runner: ${auto.runner}`);
  if (auto.model) fm.push(`model: ${auto.model}`);
  fm.push("---", "", auto.prompt.trim(), "");
  return fm.join("\n");
}

function renderRunnerYaml(runner: FactoryBundle["runners"][number]): string {
  const lines: string[] = [];
  if (runner.description) lines.push(`description: ${runner.description}`);
  if (runner.setupCommands?.length) {
    lines.push(`setupCommands:`);
    for (const c of runner.setupCommands) lines.push(`  - ${c}`);
  }
  if (runner.instanceShape) {
    lines.push(`instanceShape:`);
    lines.push(`  vcpus: ${runner.instanceShape.vcpus}`);
    lines.push(`  memoryGb: ${runner.instanceShape.memoryGb}`);
  }
  if (runner.platform) {
    lines.push(`platform:`);
    lines.push(`  os: ${runner.platform.os}`);
    lines.push(`  arch: ${runner.platform.arch}`);
    if (runner.platform.linux) lines.push(`  linux:\n    dockerImage: ${runner.platform.linux.dockerImage}`);
    if (runner.platform.mac) lines.push(`  mac:\n    version: "${runner.platform.mac.version}"`);
  }
  return lines.join("\n") + "\n";
}

function renderScorerMd(scorer: FactoryBundle["scorers"][number]): string {
  const fm: string[] = ["---"];
  fm.push(`name: ${scorer.name}`);
  if (scorer.description) fm.push(`description: ${scorer.description}`);
  fm.push(`agents:`);
  for (const a of scorer.agents) fm.push(`  - ${a}`);
  if (scorer.output) fm.push(`output: ${scorer.output}`);
  fm.push(`labels:`);
  for (const l of scorer.labels) {
    fm.push(`  - value: ${l.value}`);
    if (l.description) fm.push(`    description: ${l.description}`);
    fm.push(`    score: ${l.score}`);
  }
  fm.push(`passingScore: ${scorer.passingScore}`);
  if (scorer.samplingRate !== undefined) fm.push(`samplingRate: ${scorer.samplingRate}`);
  fm.push(`model: ${scorer.model}`);
  if (scorer.selfImprovement !== undefined) fm.push(`selfImprovement: ${scorer.selfImprovement}`);
  fm.push("---", "", scorer.rubric.trim(), "");
  return fm.join("\n");
}

/**
 * Derive list of DefinitionFile from a FactoryBundle. Pure function.
 * If rawMap provided, uses exact raw strings per path; otherwise reconstructs from parsed objects.
 * OCP: add new kind by extending this function — page doesn't change.
 */
export function deriveDefinitionFiles(
  bundle: FactoryBundle,
  rawMap?: Record<string, string>
): DefinitionFile[] {
  const files: DefinitionFile[] = [];

  const factoryRaw = rawMap?.["factory.yaml"] ?? renderFactoryYaml(bundle);
  files.push({ path: "factory.yaml", kind: "factory", raw: factoryRaw, language: "yaml" });

  for (const agent of bundle.agents) {
    const p = agent.rawPath || `agents/${agent.name}/agent.md`;
    const raw = rawMap?.[p] ?? renderAgentMd(agent);
    files.push({ path: p, kind: "agent", raw, language: "markdown" });
  }

  for (const auto of bundle.automations) {
    const p = auto.rawPath || `automations/${auto.name}/automation.md`;
    const raw = rawMap?.[p] ?? renderAutomationMd(auto);
    files.push({ path: p, kind: "automation", raw, language: "markdown" });
  }

  for (const runner of bundle.runners) {
    const p = runner.rawPath || `runners/${runner.name}.yaml`;
    const raw = rawMap?.[p] ?? renderRunnerYaml(runner);
    files.push({ path: p, kind: "runner", raw, language: "yaml" });
  }

  for (const scorer of bundle.scorers) {
    const p = scorer.rawPath || `scorers/${scorer.slug}/scorer.md`;
    const raw = rawMap?.[p] ?? renderScorerMd(scorer);
    files.push({ path: p, kind: "scorer", raw, language: "markdown" });
  }

  // Skills are not in FactoryBundle (separate registry); derive placeholder if rawMap has skills
  if (rawMap) {
    for (const [path, raw] of Object.entries(rawMap)) {
      if (path.includes("SKILL.md") || path.startsWith("skills/") || path.includes("/skills/")) {
        files.push({ path, kind: "skill", raw, language: "markdown" });
      }
    }
  } else {
    // Provide at least one example skill placeholder when bundle has factory-wide skill convention
    // Static viewer always shows skills/ directory even if empty — represents §7 Skills
  }

  // Stable sort by kind order then path
  const order: Record<string, number> = { factory: 0, agent: 1, automation: 2, runner: 3, scorer: 4, skill: 5 };
  files.sort((a, b) => (order[a.kind] - order[b.kind]) || a.path.localeCompare(b.path));
  return files;
}

/**
 * Mock warp/factory-config validation — pure, returns file+line issues.
 * Uses same rules as schemas: alias, integrations mutual exclusion, runner shape etc.
 * File+line derived via findLineNumber for realism.
 */
export function mockWarpFactoryConfig(bundle: FactoryBundle, rawMap?: Record<string, string>): WarpFactoryConfigIssue[] {
  const issues: WarpFactoryConfigIssue[] = [];
  const files = deriveDefinitionFiles(bundle, rawMap);

  function push(file: string, needle: string, message: string, code: string) {
    const raw = files.find((f) => f.path === file)?.raw ?? "";
    const line = findLineNumber(raw, needle);
    issues.push({ file, line, message, code });
  }

  // alias validation
  const alias = bundle.factory.alias;
  if (alias !== undefined) {
    if (alias.length > 60) push("factory.yaml", "alias", "alias max 60 chars", "alias_length");
    if (!/^[A-Za-z0-9 ._-]+$/.test(alias)) push("factory.yaml", "alias", "alias: allowed [A-Za-z0-9 ._-]", "alias_charset");
  }

  // schemaVersion
  if ((bundle.factory.schemaVersion as string) !== "v1alpha1") {
    push("factory.yaml", "schemaVersion", "schemaVersion must be v1alpha1", "schema_version");
  }

  // integrations mutual exclusion already validated by schema, but mock duplicate detection
  const types = (bundle.factory.integrations ?? []).map((i) => i.type);
  if (types.includes("linear" as never) && types.includes("jira" as never)) {
    push("factory.yaml", "integrations", "integrations: linear and jira are mutually exclusive", "integrations_conflict");
  }

  // foreman uniqueness
  const foremanCount = bundle.agents.filter((a) => a.agentType === "FOREMAN" || a.agentType === "MAIN").length;
  if (foremanCount !== 1) {
    const p = bundle.agents[0]?.rawPath ?? "agents/foreman/agent.md";
    push(p, "agentType", `exactly one FOREMAN required, found ${foremanCount}`, "foreman_count");
  }

  // runner shape hosted limits (assume hosted unless workerHost self-hosted)
  for (const runner of bundle.runners) {
    const isSelfHosted = Boolean(bundle.factory.agentDefaults.workerHost && bundle.factory.agentDefaults.workerHost !== "warp");
    const shape = runner.instanceShape;
    if (shape) {
      if (shape.vcpus !== undefined && shape.memoryGb === undefined) {
        push(runner.rawPath, "instanceShape", "instanceShape: vcpus and memoryGb must be set together", "shape_incomplete");
      }
      if (!isSelfHosted) {
        if (shape.vcpus > 32) push(runner.rawPath, "vcpus", "exceeds hosted max 32 vCPU — contact support or use self-hosted", "exceeds_max_vcpu");
        if (shape.memoryGb > 64) push(runner.rawPath, "memoryGb", "exceeds hosted max 64 GiB — contact support or use self-hosted", "exceeds_max_memory");
      }
    }
    if (runner.platform?.os === "linux" && !runner.platform.linux?.dockerImage) {
      push(runner.rawPath, "dockerImage", "platform.linux.dockerImage required when os is linux", "missing_docker_image");
    }
  }

  // scorer invariants
  for (const scorer of bundle.scorers) {
    const passing = scorer.labels.filter((l) => l.score >= scorer.passingScore).length;
    const failing = scorer.labels.filter((l) => l.score < scorer.passingScore).length;
    if (passing === 0) push(scorer.rawPath, "passingScore", "need at least one label >= passingScore", "scorer_invariant");
    if (failing === 0) push(scorer.rawPath, "passingScore", "need at least one label below passingScore", "scorer_invariant");
  }

  return issues;
}

export function deriveDefinitionSummary(bundle: FactoryBundle): { totalFiles: number; byKind: Record<string, number> } {
  const files = deriveDefinitionFiles(bundle);
  const byKind: Record<string, number> = {};
  for (const f of files) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  return { totalFiles: files.length, byKind };
}
