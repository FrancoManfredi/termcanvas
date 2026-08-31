/**
 * Global skills sync for CodeBuddy — Node-only (Electron main).
 * Mirrors electron/mcp/adapters/codebuddy.ts syncGlobalMcpToCodebuddy but for skills.
 * Copies global opencode skills (~/.config/opencode/skills, ~/.agents/skills)
 * to a project's .codebuddy/skills/<name>/SKILL.md so `codebuddy` in that
 * project sees them. Idempotent, best-effort, never throws.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function syncGlobalSkillsToCodebuddy(projectPath: string): Promise<void> {
  if (!projectPath) return;
  try {
    const globalRoots = [
      path.join(os.homedir(), ".config", "opencode", "skills"),
      path.join(os.homedir(), ".agents", "skills"),
    ];
    const destSkillsDir = path.join(projectPath, ".codebuddy", "skills");
    fs.mkdirSync(destSkillsDir, { recursive: true });
    for (const root of globalRoots) {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillName = entry.name;
        const destSkillDir = path.join(destSkillsDir, skillName);
        if (fs.existsSync(destSkillDir)) continue; // project override wins
        const srcSkillMd = path.join(root, skillName, "SKILL.md");
        if (!fs.existsSync(srcSkillMd)) continue;
        const raw = fs.readFileSync(srcSkillMd, "utf-8");
        if (!raw.includes("name:") || !raw.includes("description:")) continue;
        fs.mkdirSync(destSkillDir, { recursive: true });
        fs.writeFileSync(path.join(destSkillDir, "SKILL.md"), raw, "utf-8");
        for (const sub of ["scripts", "references", "assets"] as const) {
          const srcSub = path.join(root, skillName, sub);
          if (!fs.existsSync(srcSub)) continue;
          const destSub = path.join(destSkillDir, sub);
          try {
            fs.cpSync(srcSub, destSub, { recursive: true, force: true });
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("[skills:codebuddy] syncGlobalSkillsToCodebuddy failed:", err);
  }
}

/**
 * Sync global skills to all tracked TermCanvas projects.
 * Reads the list of project paths from the state file or from a provided list.
 */
export async function syncGlobalSkillsToAllProjects(projectPaths: string[]): Promise<void> {
  for (const p of projectPaths) {
    await syncGlobalSkillsToCodebuddy(p);
  }
}
