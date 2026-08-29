/**
 * Opencode skill adapter — preserves exact current behavior.
 *
 * This is a thin wrapper around src/skills/scopedSession.ts so the
 * neutral layer can call it via HarnessSkillAdapter without importing
 * opencode-specific env var names.
 *
 * Opencode contract:
 *   - scope dir: <repo>/.agents/planning/.scope-<runId>/
 *     - <skill>/SKILL.md (+ vendor)
 *     - opencode-scope.json  { skills: {paths:[scopeDir]}, permission:{skill:{"*":"deny", ...allow}} }
 *   - env: { OPENCODE_CONFIG: "<scopeDir>/opencode-scope.json" }
 *   - lifecycle: release() deletes scope dir; stale sweep 24h
 */

import type { HarnessSkillAdapter } from "../../../shared/neutral/skills.ts";
import { prepareSkillScope as opencodePrepare, OPENCODE_CONFIG_ENV } from "../scopedSession.ts";
import type { VendorSkill } from "../vendorSkills.ts";

export const opencodeSkillAdapter: HarnessSkillAdapter = {
  harnessId: "opencode",

  async prepareScope(options) {
    // Delegate directly to existing implementation — zero behavior change.
    // prepareSkillScope already handles empty allowlist -> null, missing bridge -> null, stale sweep, etc.
    const res = await opencodePrepare({
      repoPath: options.repoPath,
      allow: options.allow,
      vendorSkills: options.vendorSkills as VendorSkill[] | undefined,
    });
    return res;
  },
};

export { OPENCODE_CONFIG_ENV };
