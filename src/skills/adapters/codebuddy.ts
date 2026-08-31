/**
 * CodeBuddy skill adapter — neutral -> CodeBuddy.
 *
 * CodeBuddy stores skills as:
 *   .codebuddy/skills/<skill-name>/SKILL.md (+ optional scripts/references/assets)
 * with frontmatter:
 *   ---
 *   name: <skill-name>
 *   description: <one-line trigger>
 *   ---
 * plus markdown body. See https://www.codebuddy.ai/docs/cli/skills & https://www.codebuddy.ai/docs/ide/Features/Skills
 *
 * FIX 2026-08-28: Previous version wrote to .codebuddy/skills/.scope-<runId>/<name>/SKILL.md
 * which CodeBuddy never discovers (only 1-level deep: .codebuddy/skills/<name>/SKILL.md).
 * Correct behavior is to write directly to .codebuddy/skills/<name>/SKILL.md.
 *
 * Unlike opencode, CodeBuddy does NOT use per-session ephemeral scope with
 * OPENCODE_CONFIG + permission.skill deny-all. Skills are project-scoped and
 * discovered via .codebuddy/skills/. For TermCanvas's per-session isolation
 * (diag-* categories), we have two modes:
 *   - project (default): skills persist in .codebuddy/skills/ until explicitly removed.
 *     Isolation is emulated by the caller only writing the allowlist for the
 *     current session and relying on CodeBuddy's progressive disclosure (metadata always,
 *     body on-demand) — cheaper than deny-all. For parallel sessions, last write wins.
 *   - session (future): if CodeBuddy adds --skills-path or session-scoped API,
 *     this adapter will switch to ephemeral .scope-<runId> without touching neutral layer.
 *
 * Vendor skills are copied raw (frontmatter preserved) — same as scopedSession.ts:153 does for opencode.
 */

import type { HarnessSkillAdapter, NeutralSkill } from "../../../shared/neutral/skills.ts";
import { renderSkillMd as renderOpencodeSkillMd } from "../scopedSession.ts";

function fsBridge(): typeof window.termcanvas.fs | null {
  return typeof window !== "undefined" && window.termcanvas?.fs ? window.termcanvas.fs : null;
}

const SCOPE_DIR_PREFIX = ".scope-";
const SCOPE_STALE_MS = 24 * 60 * 60 * 1000;

async function sweepStaleScopes(fs: typeof window.termcanvas.fs, skillsDir: string): Promise<void> {
  try {
    const entries = await fs.listDir(skillsDir);
    const cutoff = Date.now() - SCOPE_STALE_MS;
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const m = new RegExp(`^${SCOPE_DIR_PREFIX}(\\d+)-`).exec(entry.name);
      if (!m) continue;
      if (Number(m[1]) >= cutoff) continue;
      await fs.delete(`${skillsDir}/${entry.name}`);
    }
  } catch {}
}

function renderCodebuddySkillMd(skill: NeutralSkill): string {
  // CodeBuddy expects frontmatter name + description, same as opencode.
  // If body already contains frontmatter (vendor raw), use raw directly.
  if (skill.raw && skill.raw.trim().startsWith("---")) {
    return skill.raw;
  }
  // Registry skills: render like opencode but ensure CodeBuddy's progressive disclosure limit (<5k words body) is respected.
  // Reuse existing renderer — identical shape.
  if (skill.body.trim().startsWith("---")) {
    return skill.body;
  }
  return [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description.replace(/\s+/g, " ").slice(0, 300)}`,
    "---",
    "",
    skill.body,
    "",
  ].join("\n");
}

export const codebuddySkillAdapter: HarnessSkillAdapter = {
  harnessId: "codebuddy",

  async prepareScope(options) {
    const allow = options.allow.filter((n) => n && n !== "*");
    const vendorSkills = (options.vendorSkills ?? []).filter((s) => !allow.includes(s.name));
    if (allow.length === 0 && vendorSkills.length === 0) return null;
    const fs = fsBridge();
    if (!fs) return null;

    const repoRoot = options.repoPath.replace(/[\\/]+$/, "");
    // CodeBuddy's canonical skills dir per docs: .codebuddy/skills/
    // Must be 1-level deep: .codebuddy/skills/<name>/SKILL.md
    const skillsDir = `${repoRoot}/.codebuddy/skills`;

    await fs.mkdir(repoRoot, ".codebuddy");
    await fs.mkdir(`${repoRoot}/.codebuddy`, "skills");

    // Clean up any stale .scope-* dirs left by previous buggy version (migration)
    await sweepStaleScopes(fs, skillsDir);

    const resolved: NeutralSkill[] = options.resolvedSkills ?? [];
    const byName = new Map(resolved.map((s) => [s.name, s]));
    const written: string[] = [];

    for (const name of allow) {
      const skill = byName.get(name);
      const toRender: NeutralSkill = skill ?? { name, description: `Skill ${name}`, body: `# ${name}\n\nSee registry for details.` };
      const content = renderCodebuddySkillMd(toRender);
      await fs.mkdir(skillsDir, name);
      await fs.writeFile(`${skillsDir}/${name}/SKILL.md`, content);
      written.push(name);
    }

    for (const vs of vendorSkills) {
      const content = vs.raw ?? renderCodebuddySkillMd(vs);
      await fs.mkdir(skillsDir, vs.name);
      await fs.writeFile(`${skillsDir}/${vs.name}/SKILL.md`, content);
      written.push(vs.name);
    }

    // For CodeBuddy, skills are project-scoped and persist. The previous
    // opencode model used ephemeral .scope-<runId> with OPENCODE_CONFIG and
    // permission.skill deny-all — CodeBuddy has no equivalent, so release is
    // a no-op for the happy path. If per-session isolation becomes needed,
    // we will introduce a .codebuddy/skills/.scope-<runId> + --skills-path flag.
    // For now, we keep written list so a future caller can clean up explicitly
    // if it wants per-session semantics.
    return {
      env: {},
      release: async () => {
        // No-op by default: project-scoped skills persist so `/skill` can list them.
        // If you need per-run isolation, uncomment the cleanup below:
        // for (const n of written) { try { await fs.delete(`${skillsDir}/${n}`); } catch {} }
      },
    };
  },

  renderSkillMd(skill) {
    return renderCodebuddySkillMd(skill);
  },
};

export { renderCodebuddySkillMd };

/**
 * Sync GLOBAL opencode skills (from ~/.config/opencode/skills and ~/.agents/skills)
 * to a CodeBuddy project's .codebuddy/skills/.
 * This mirrors syncGlobalMcpToCodebuddy() for MCPs — global skills are not
 * per-project, so without this `codebuddy skills list` shows empty.
 * Called once per project on app start (non-blocking) and is idempotent.
 *
 * NOTE: This function uses Node fs directly and must only be called from
 * Electron main process (not renderer). The renderer uses prepareScope() with
 * window.termcanvas.fs.
 */
export async function syncGlobalSkillsToCodebuddy(projectPath: string): Promise<void> {
  if (!projectPath) return;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const fsp = fs.default ?? fs;

    const globalRoots = [
      path.join(os.homedir(), ".config", "opencode", "skills"),
      path.join(os.homedir(), ".agents", "skills"),
    ];

    const destSkillsDir = path.join(projectPath, ".codebuddy", "skills");
    fsp.mkdirSync(destSkillsDir, { recursive: true });

    for (const root of globalRoots) {
      if (!fsp.existsSync(root)) continue;
      const entries = fsp.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillName = entry.name;
        const destSkillDir = path.join(destSkillsDir, skillName);
        if (fsp.existsSync(destSkillDir)) continue;
        const srcSkillMd = path.join(root, skillName, "SKILL.md");
        if (!fsp.existsSync(srcSkillMd)) continue;
        const raw = fsp.readFileSync(srcSkillMd, "utf-8");
        if (!raw.includes("name:") || !raw.includes("description:")) continue;
        fsp.mkdirSync(destSkillDir, { recursive: true });
        fsp.writeFileSync(path.join(destSkillDir, "SKILL.md"), raw, "utf-8");
        for (const sub of ["scripts", "references", "assets"]) {
          const srcSub = path.join(root, skillName, sub);
          if (!fsp.existsSync(srcSub)) continue;
          const destSub = path.join(destSkillDir, sub);
          try {
            fsp.cpSync(srcSub, destSub, { recursive: true, force: true });
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("[skills:codebuddy] syncGlobalSkillsToCodebuddy failed:", err);
  }
}
