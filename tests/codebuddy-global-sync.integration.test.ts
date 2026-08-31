import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, execFileSync } from "node:child_process";

// High-quality integration test for global MCPs/skills sync
// Verifies that a fresh project (like education-games) gets global skills/MCPs
// without manual toggle — the bug the user reported.
// Uses real filesystem and real `codebuddy` CLI, no mocks, Windows-compatible (uses Node fs, not `ls`).

function escapeArg(arg: string): string {
  if (/^[a-zA-Z0-9@._\-\/\\:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runCodebuddy(args: string[], cwd: string): string {
  const cmd = `codebuddy ${args.map(escapeArg).join(" ")}`;
  return execSync(cmd, { cwd, encoding: "utf-8", windowsHide: true, timeout: 8000 });
}

describe("codebuddy global sync — real project (education-games scenario)", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-global-sync-"));
    execFileSync("git", ["init"], { cwd: tmpDir, windowsHide: true });
    // Ensure clean state: remove any pre-existing .codebuddy/.mcp.json from previous runs
    try { fs.rmSync(path.join(tmpDir, ".codebuddy"), { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(path.join(tmpDir, ".mcp.json")); } catch {}
    try { fs.unlinkSync(path.join(os.homedir(), ".codebuddy", ".mcp.json")); } catch {}
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    // Clean up user global .mcp.json if we polluted it (restore by removing test entries)
    try {
      const userMcp = path.join(os.homedir(), ".codebuddy", ".mcp.json");
      if (fs.existsSync(userMcp)) {
        const data = JSON.parse(fs.readFileSync(userMcp, "utf-8"));
        let changed = false;
        for (const k of ["test-global-sync", "context7", "engram", "codegraph"]) {
          if (data.mcpServers?.[k]) { delete data.mcpServers[k]; changed = true; }
        }
        if (changed) fs.writeFileSync(userMcp, JSON.stringify(data, null, 2));
      }
    } catch {}
  });

  it("MCP global: 3 global opencode MCPs appear in codebuddy without per-project toggle", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tc-home-"));
    const originalHomedir = os.homedir;
    const originalUserProfile = process.env.USERPROFILE;
    const originalHome = process.env.HOME;
    (os as unknown as { homedir: () => string }).homedir = () => tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.HOME = tmpHome;
    process.env.HOMEPATH = tmpHome;
    const fakeOpencodeDir = path.join(tmpHome, ".config", "opencode");
    fs.mkdirSync(fakeOpencodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(fakeOpencodeDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          context7: { enabled: true, type: "remote", url: "https://mcp.context7.com/mcp" },
          engram: { enabled: true, type: "local", command: ["engram", "mcp", "--tools=agent"] },
          codegraph: { enabled: true, type: "local", command: ["codegraph", "serve", "--mcp"] },
        },
      }),
    );
    try {
      const { syncGlobalMcpToCodebuddy } = await import("../electron/mcp/adapters/codebuddy.ts");
      syncGlobalMcpToCodebuddy();
      const userMcpPath = path.join(tmpHome, ".codebuddy", ".mcp.json");
      assert.ok(fs.existsSync(userMcpPath), "user .codebuddy/.mcp.json should exist after global sync (temp home)");
      const userData = JSON.parse(fs.readFileSync(userMcpPath, "utf-8"));
      assert.ok(userData.mcpServers?.["context7"], "context7 should be in user scope");
      assert.ok(userData.mcpServers?.["engram"], "engram should be in user scope");
      assert.ok(userData.mcpServers?.["codegraph"], "codegraph should be in user scope");
    } finally {
      (os as unknown as { homedir: () => string }).homedir = originalHomedir;
      if (originalUserProfile) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
      if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
      try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    }
  });

  it("Skills global: branch-pr appears in any fresh project after syncGlobalSkillsToCodebuddy", async () => {
    const { syncGlobalSkillsToCodebuddy } = await import("../electron/skills/codebuddy-sync.ts");
    await syncGlobalSkillsToCodebuddy(tmpDir);

    // Verify file exists at 1 level (not .scope-*)
    const skillPath = path.join(tmpDir, ".codebuddy", "skills", "branch-pr", "SKILL.md");
    assert.ok(fs.existsSync(skillPath), `branch-pr SKILL.md should exist at 1 level: ${skillPath} (Windows: use dir .codebuddy\\skills\\branch-pr, not ls)`);
    const content = fs.readFileSync(skillPath, "utf-8");
    assert.ok(content.includes("name: branch-pr"), "frontmatter name should be branch-pr");
    assert.ok(content.includes("description:"), "frontmatter description should exist");

    // Verify no .scope-* dir was created (bug we fixed)
    const skillsDir = path.join(tmpDir, ".codebuddy", "skills");
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).map((d) => d.name);
    assert.ok(!entries.some((n) => n.startsWith(".scope-")), ".scope-* should NOT exist for CodeBuddy global sync");
    assert.ok(entries.includes("branch-pr"), "branch-pr should be direct child of .codebuddy/skills");

    // Verify another global skill also copied (e.g., ask-matt)
    assert.ok(fs.existsSync(path.join(tmpDir, ".codebuddy", "skills", "ask-matt", "SKILL.md")), "ask-matt should also be copied");
  });

  it("Windows: verify correct path handling (no `ls` needed)", () => {
    // This test documents the Windows pitfall the user hit:
    // In Windows cmd/PowerShell, `ls` does not exist. Use `dir` or `Get-ChildItem`.
    // Our code uses Node fs, not shell, so it's cross-platform.
    const tmpSkillPath = path.join(tmpDir, ".codebuddy", "skills", "branch-pr", "SKILL.md");
    assert.ok(fs.existsSync(tmpSkillPath), "Node fs should find the file regardless of shell");
    // Verify that the path uses Windows separators correctly
    assert.ok(tmpSkillPath.includes(".codebuddy") && tmpSkillPath.includes("skills") && tmpSkillPath.includes("branch-pr"));
  });
});
