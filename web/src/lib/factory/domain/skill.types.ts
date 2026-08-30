// Skill domain types — SRP: only shape, no logic
// Follows WarpFactories.md §5 Skills (scoping factory-wide vs per-agent)
// and §7 Definitions as Code (directory identity)

export type SkillScope = "factoryWide" | "perAgent";

export type SkillKind = "builtin" | "custom";

export type BuiltinSkillType = "github" | "slack" | "linear" | "jira";

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  // Warp SKILL.md uses standard frontmatter + argument syntax — keep open for custom keys
  [key: string]: unknown;
}

export interface SkillDefinition {
  /** Directory name — identity from path (e.g. repository-conventions, incident-triage) */
  name: string;
  /** Scoping derived from path location */
  scope: SkillScope;
  /** Only for perAgent scope — the agent that owns it */
  agentName?: string;
  /** Exact file path: skills/<name>/SKILL.md or agents/<agent>/skills/<name>/SKILL.md */
  path: string;
  /** Raw SKILL.md content */
  raw: string;
  /** Parsed YAML frontmatter */
  frontmatter: SkillFrontmatter;
  /** Markdown body after frontmatter (instructions / procedure) */
  body: string;
  /** Built-in vs custom — custom extends baseline (§5 Built-ins) */
  kind: SkillKind;
  /** Only for builtin kind */
  builtinType?: BuiltinSkillType;
}
