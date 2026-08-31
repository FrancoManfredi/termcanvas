/**
 * Neutral Skills layer — source of truth for all harnesses.
 *
 * A NeutralSkill is just name + description + body. No harness-specific
 * permission model, no file layout, no env var. Each harness adapter
 * decides how to materialize it:
 *   - opencode:  .agents/planning/.scope-<runId>/<name>/SKILL.md + opencode-scope.json { permission.skill: {"*":"deny", [name]:"allow"} } + OPENCODE_CONFIG env
 *   - codebuddy: .codebuddy/skills/<name>/SKILL.md (+ scripts/references/assets) — see https://www.codebuddy.ai/docs/cli/skills & https://www.codebuddy.ai/docs/ide/Features/Skills
 *
 * Vendor skills (user-provided, <repo>/.agents/diagnosis-skills/...) and
 * specialized skills (src/skills/registry.ts diag-*) are both represented
 * as NeutralSkill. The distinction is only for discovery; at runtime they
 * are indistinguishable.
 */

export interface NeutralSkill {
  /** Slug [a-z0-9-] — stable identifier across harnesses. diag-* reserved for internal. */
  name: string;
  /** One-line, ~100 chars, always in context. */
  description: string;
  /** Full markdown body (without frontmatter duplication). May include frontmatter already. */
  body: string;
  /** Raw SKILL.md if source was file-based (vendor). Undefined for registry skills. */
  raw?: string;
  /** Source for diagnostics/UI, not for harness logic. */
  source?: "registry" | "vendor:shared" | "vendor:private" | "vendor:repo" | "custom";
  /** Category it belongs to, if any (diagnosis-*, etc). */
  categoryId?: string | null;
}

/**
 * Neutral allowlist — what the session should see. No harness semantics.
 * The session launcher decides which harness to use and which adapter
 * will enforce this allowlist.
 */
export interface NeutralSkillAllowlist {
  /** Exact skill names to expose. Order not significant. */
  allow: string[];
  /** Optional vendor skills already resolved (so adapter doesn't re-discover). */
  vendorSkills?: NeutralSkill[];
}

/**
 * Contract every harness skill adapter must implement.
 */
export interface HarnessSkillAdapter {
  readonly harnessId: string;

  /**
   * Materialize the allowlist for a single session.
   * Returns harness-specific env vars to inject into the PTY and a release() to clean up.
   * If harness needs no per-session isolation (e.g. global skills dir), release may be no-op.
   */
  prepareScope(options: {
    repoPath: string;
    allow: string[];
    vendorSkills?: NeutralSkill[];
    /** Resolved NeutralSkills for `allow` (so adapter doesn't need registry). */
    resolvedSkills?: NeutralSkill[];
  }): Promise<{ env: Record<string, string>; release: () => Promise<void> } | null>;

  /** Render helper for testing — pure, no IO. */
  renderSkillMd?(skill: NeutralSkill): string;
  buildScopeConfig?(scopeDir: string, allow: string[]): unknown;
}

/**
 * Validation helpers — harness-agnostic.
 */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function isValidSkillName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function isReservedSkillName(name: string): boolean {
  return name.startsWith("diag-");
}

export function sanitizeSkillName(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  if (!isValidSkillName(trimmed)) return null;
  return trimmed;
}

export function toNeutralSkillFromRegistry(reg: {
  name: string;
  title: string;
  description: string;
  categoryId: string | null;
  body: string;
}): NeutralSkill {
  return {
    name: reg.name,
    description: reg.description,
    body: reg.body,
    source: "registry",
    categoryId: reg.categoryId,
  };
}

export function toNeutralSkillFromVendor(vendor: {
  name: string;
  description: string;
  raw: string;
  source?: string;
  dirPath?: string;
}): NeutralSkill {
  return {
    name: vendor.name,
    description: vendor.description,
    body: vendor.raw,
    raw: vendor.raw,
    source: (vendor.source as NeutralSkill["source"]) ?? "vendor:repo",
  };
}
