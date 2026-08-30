// Skill registry — pure, SOLID: only scope resolution, no rendering
// DIP: consumers inject FactoryDefinition or raw paths; registry does not read I/O

import { ParseResult } from "./result";
import { parseFrontmatter } from "../parsers/frontmatter.utils";
import type { SkillDefinition, SkillFrontmatter, BuiltinSkillType } from "./skill.types";
import type { FactoryDefinition } from "./types";

function inferSkillIdentity(filePath: string): { name: string; scope: SkillDefinition["scope"]; agentName?: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  // per-agent: agents/<agent>/skills/<name>/SKILL.md
  const agentsIdx = parts.indexOf("agents");
  const skillsIdx = parts.indexOf("skills");
  if (agentsIdx !== -1 && skillsIdx !== -1 && skillsIdx > agentsIdx) {
    const agentName = parts[agentsIdx + 1];
    const skillName = parts[skillsIdx + 1];
    if (agentName && skillName) {
      return { name: skillName, scope: "perAgent", agentName };
    }
  }

  // factory-wide: skills/<name>/SKILL.md (no agents segment before skills)
  if (skillsIdx !== -1) {
    const skillName = parts[skillsIdx + 1];
    if (skillName) {
      return { name: skillName, scope: "factoryWide" };
    }
  }

  // fallback: builtin/<name>/SKILL.md
  if (parts[0] === "builtin" && parts[1]) {
    // builtins default to factoryWide unless caller overrides
    return { name: parts[1], scope: "factoryWide" };
  }

  // last resort: file name without extension
  const last = parts[parts.length - 2] ?? parts[parts.length - 1] ?? "skill";
  return { name: last, scope: "factoryWide" };
}

export function parseSkillMd(raw: string, filePath: string): ParseResult<SkillDefinition> {
  if (!raw.trim()) {
    return ParseResult.singleFail(filePath, "empty SKILL.md", "empty_input");
  }

  const fmRes = parseFrontmatter<SkillFrontmatter>(raw, filePath);
  if (!fmRes.ok) {
    return ParseResult.fail(fmRes.issues);
  }

  const data = fmRes.value!.data;
  const body = fmRes.value!.content;

  if (!body || !body.trim()) {
    return ParseResult.singleFail(filePath, "SKILL.md body must not be empty", "missing_body");
  }

  const identity = inferSkillIdentity(filePath);

  // name in frontmatter if present must match path-derived name (case-sensitive) — warn not fail
  // Keep permissive: prefer path name, but expose frontmatter name for preview

  const def: SkillDefinition = {
    name: identity.name,
    scope: identity.scope,
    agentName: identity.agentName,
    path: filePath,
    raw,
    frontmatter: data,
    body: body.trim(),
    kind: "custom",
  };

  return ParseResult.ok(def);
}

// ——— pure scope helpers (no side effects) ———

export function isSkillVisibleToAgent(skill: SkillDefinition, agentName: string): boolean {
  if (skill.scope === "factoryWide") return true;
  return skill.agentName === agentName;
}

export function listSkillsForAgent(skills: SkillDefinition[], agentName: string): SkillDefinition[] {
  return skills.filter((s) => isSkillVisibleToAgent(s, agentName));
}

export function listFactoryWideSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return skills.filter((s) => s.scope === "factoryWide");
}

export function listPerAgentSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return skills.filter((s) => s.scope === "perAgent");
}

export function getSkillByName(
  skills: SkillDefinition[],
  name: string,
  agentName?: string
): SkillDefinition | null {
  const candidates = skills.filter((s) => s.name === name);
  if (agentName) {
    const perAgent = candidates.find((s) => s.scope === "perAgent" && s.agentName === agentName);
    if (perAgent) return perAgent;
    const factoryWide = candidates.find((s) => s.scope === "factoryWide");
    return factoryWide ?? null;
  }
  const factoryWide = candidates.find((s) => s.scope === "factoryWide");
  if (factoryWide) return factoryWide;
  return candidates.length === 1 ? candidates[0] : null;
}

// ——— built-ins (WarpFactories.md §4/§5) ———
// GitHub baseline for all agents, Slack only foreman, tracker if chosen.
// These extend baseline — never replace custom skills.

export function getBuiltinSkills(factory?: FactoryDefinition): SkillDefinition[] {
  const builtins: SkillDefinition[] = [];

  const githubSkill: SkillDefinition = {
    name: "github",
    scope: "factoryWide",
    path: "builtin/github/SKILL.md",
    raw: `---
name: github
description: Baseline GitHub skill for all agents — read issues, open PRs, follow repo conventions
builtin: true
---
# GitHub Skill (builtin)

Available to all agents. Handles issues, PRs and repository conventions via the connected GitHub App.`,
    frontmatter: { name: "github", description: "Baseline GitHub skill for all agents", builtin: true },
    body: "Available to all agents. Handles issues, PRs and repository conventions via the connected GitHub App.",
    kind: "builtin",
    builtinType: "github" as BuiltinSkillType,
  };
  builtins.push(githubSkill);

  const slackSkill: SkillDefinition = {
    name: "slack",
    scope: "perAgent",
    agentName: "foreman",
    path: "agents/foreman/skills/slack/SKILL.md",
    raw: `---
name: slack
description: Slack skill — only foreman responds in threads and DMs
builtin: true
---
# Slack Skill (builtin)

Only foreman. Responds in threads/DMs when the Slack App is mentioned and the account is linked to the factory's Warp team.`,
    frontmatter: { name: "slack", description: "Slack skill — only foreman", builtin: true },
    body: "Only foreman. Responds in threads/DMs when the Slack App is mentioned.",
    kind: "builtin",
    builtinType: "slack" as BuiltinSkillType,
  };
  builtins.push(slackSkill);

  const integrations = factory?.integrations ?? [];
  const hasLinear = integrations.some((i) => i.type === "linear");
  const hasJira = integrations.some((i) => i.type === "jira");

  if (hasLinear) {
    builtins.push({
      name: "linear",
      scope: "factoryWide",
      path: "builtin/linear/SKILL.md",
      raw: `---
name: linear
description: Tracker skill for Linear — added when Linear is selected
builtin: true
---
# Linear Skill (builtin)

Added when Linear is selected as tracker. Provides issue context to agents that use it.`,
      frontmatter: { name: "linear", description: "Tracker skill for Linear", builtin: true },
      body: "Added when Linear is selected as tracker.",
      kind: "builtin",
      builtinType: "linear" as BuiltinSkillType,
    });
  }

  if (hasJira) {
    builtins.push({
      name: "jira",
      scope: "factoryWide",
      path: "builtin/jira/SKILL.md",
      raw: `---
name: jira
description: Tracker skill for Jira — added when Jira is selected
builtin: true
---
# Jira Skill (builtin)

Added when Jira is selected as tracker. Maps Jira Cloud issues via Rovo agent.`,
      frontmatter: { name: "jira", description: "Tracker skill for Jira", builtin: true },
      body: "Added when Jira is selected as tracker.",
      kind: "builtin",
      builtinType: "jira" as BuiltinSkillType,
    });
  }

  return builtins;
}

/**
 * Merges custom skills with builtins for a given agent.
 * Invariant §5: customs extend baseline, do not replace it.
 * No skill ever amplía acceso (secrets/MCPs stay on agent config, not skill).
 */
export function resolveSkillsForAgent(
  customSkills: SkillDefinition[],
  factory: FactoryDefinition | undefined,
  agentName: string
): SkillDefinition[] {
  const builtins = getBuiltinSkills(factory);
  const visibleCustom = listSkillsForAgent(customSkills, agentName);
  const visibleBuiltins = listSkillsForAgent(builtins, agentName);
  // Preserve order: builtins first (baseline), then customs
  return [...visibleBuiltins, ...visibleCustom];
}

/** Returns full catalog separated by scope for registry view */
export function categorizeSkills(skills: SkillDefinition[]): {
  factoryWide: SkillDefinition[];
  perAgent: Map<string, SkillDefinition[]>;
} {
  const factoryWide = listFactoryWideSkills(skills);
  const perAgentMap = new Map<string, SkillDefinition[]>();
  for (const s of listPerAgentSkills(skills)) {
    const key = s.agentName ?? "unknown";
    const arr = perAgentMap.get(key) ?? [];
    arr.push(s);
    perAgentMap.set(key, arr);
  }
  return { factoryWide, perAgent: perAgentMap };
}
