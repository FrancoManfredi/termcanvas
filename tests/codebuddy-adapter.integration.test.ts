import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, execFileSync } from "node:child_process";

// Integration test — hits real filesystem and real `codebuddy` CLI, no mocks.
// This is the quality gate that would have caught the ".codebuddy/mcp.json" bug.
// Uses execSync with string + shell to correctly handle .cmd on Windows without DEP0190
// (execFile with shell:true + args array is deprecated).

function escapeArg(arg: string): string {
  if (/^[a-zA-Z0-9@._\-\/\\:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runCodebuddy(args: string[], cwd: string): string {
  const cmd = `codebuddy ${args.map(escapeArg).join(" ")}`;
  return execSync(cmd, { cwd, encoding: "utf-8", windowsHide: true, timeout: 8000 });
}

function listMcpNames(cwd: string): string[] {
  try {
    const out = execSync(`codebuddy mcp list`, { cwd, encoding: "utf-8", windowsHide: true, timeout: 8000 });
    if (out.includes("No MCP servers configured")) return [];
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

describe("codebuddy adapter integration — real CLI + real FS", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-codebuddy-int-"));
    // Make it a git repo so codebuddy treats it as project
    execFileSync("git", ["init"], { cwd: tmpDir, windowsHide: true });
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), ".mcp.json\n.codebuddy/\n");
  });

  after(() => {
    // Cleanup: remove any test MCPs and the temp dir
    try { runCodebuddy(["mcp", "remove", "--scope", "project", "test-filesystem"], tmpDir); } catch {}
    try { runCodebuddy(["mcp", "remove", "--scope", "project", "test-engram"], tmpDir); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("MCP: codebuddy mcp add --scope project writes <project>/.mcp.json and is listed", () => {
    // This is what our adapter should do — use the correct file and correct arg order
    const res = runCodebuddy(
      ["mcp", "add", "--scope", "project", "--transport", "stdio", "test-filesystem", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", tmpDir],
      tmpDir,
    );
    assert.match(res, /Added stdio MCP server test-filesystem/);

    // Verify the file CodeBuddy actually reads
    const mcpPath = path.join(tmpDir, ".mcp.json");
    assert.ok(fs.existsSync(mcpPath), ".mcp.json should exist in project root (not .codebuddy/mcp.json)");
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    assert.ok(content.mcpServers?.["test-filesystem"], "mcpServers.test-filesystem should exist");
    assert.equal(content.mcpServers["test-filesystem"].command, "npx");
    // Bug we had: .codebuddy/mcp.json should NOT exist
    assert.ok(!fs.existsSync(path.join(tmpDir, ".codebuddy", "mcp.json")), ".codebuddy/mcp.json should NOT exist — CodeBuddy uses .mcp.json");

    // Verify list shows it (if scope is project, plain `mcp list` should show it with Needs approval)
    const listOut = runCodebuddy(["mcp", "list"], tmpDir);
    // When project-scoped, `mcp list` (default local) may still show it as "Needs approval" — at least not "No MCP servers"
    assert.ok(!listOut.includes("No MCP servers configured"), "mcp list should not be empty after add");

    // Cleanup this sub-test's server so next test starts clean
    runCodebuddy(["mcp", "remove", "--scope", "project", "test-filesystem"], tmpDir);
    assert.ok(!JSON.parse(fs.readFileSync(mcpPath, "utf-8")).mcpServers?.["test-filesystem"], "should be removed");
  });

  it("MCP: engram/codegraph stdio commands are correct for CodeBuddy", async () => {
    // Import the actual adapter and call it — this is what TermCanvas will do
    const { codebuddyMcpAdapter } = await import("../electron/mcp/adapters/codebuddy.ts");
    // Use filesystem as proxy for engram (no token needed) but verify the adapter builds correct CLI args
    // For engram, the adapter should use `engram mcp --tools=agent`, not npx
    // We test via a temp custom catalog entry
    const customEngram = { id: "test-engram", name: "Engram", description: "mem", transport: "stdio" as const, defaultCommand: "engram", defaultArgs: ["mcp", "--tools=agent"], auth: null };
    codebuddyMcpAdapter.syncToHarness(tmpDir, "test-engram" as any, true, null, [customEngram as any]);
    const mcpPath = path.join(tmpDir, ".mcp.json");
    assert.ok(fs.existsSync(mcpPath));
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    assert.ok(content.mcpServers?.["test-engram"], "test-engram should be in .mcp.json");
    // On Windows, engram -> engram.exe
    const cmd = content.mcpServers["test-engram"].command;
    assert.ok(cmd === "engram" || cmd === "engram.exe", `engram command should be engram[.exe], got ${cmd}`);
  });

  it("Skills: CodeBuddy discovers .codebuddy/skills/<name>/SKILL.md at 1 level, not .scope-*", async () => {
    const { codebuddySkillAdapter } = await import("../src/skills/adapters/codebuddy.ts");
    // Mock window.termcanvas.fs to use real fs in tmpDir
    const realFs = {
      async listDir(dirPath: string) {
        const p = dirPath.replace(tmpDir, tmpDir); // already absolute
        if (!fs.existsSync(p)) throw new Error("no dir");
        return fs.readdirSync(p, { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
      },
      async readFile(filePath: string) {
        if (!fs.existsSync(filePath)) return { error: "not found" } as any;
        return { type: "text", content: fs.readFileSync(filePath, "utf-8") } as any;
      },
      async mkdir(parent: string, name: string) {
        fs.mkdirSync(path.join(parent, name), { recursive: true });
      },
      async writeFile(filePath: string, content: string) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
      },
      async delete(filePath: string) {
        fs.rmSync(filePath, { recursive: true, force: true });
      },
    };
    (globalThis as any).window = { termcanvas: { fs: realFs } };

    const { toNeutralSkillFromRegistry } = await import("../shared/neutral/skills.ts");
    const neutral = toNeutralSkillFromRegistry({ name: "diag-testskill", title: "Test", description: "Test skill for CodeBuddy", categoryId: "test", body: "# Test Skill\nDo stuff" });

    const result = await codebuddySkillAdapter.prepareScope({
      repoPath: tmpDir,
      allow: ["diag-testskill"],
      vendorSkills: [],
      resolvedSkills: [neutral],
    });
    assert.ok(result, "prepareScope should return env+release");

    // Verify file at 1 level, not 2
    const correctPath = path.join(tmpDir, ".codebuddy", "skills", "diag-testskill", "SKILL.md");
    const wrongPath = path.join(tmpDir, ".codebuddy", "skills", ".scope-");
    assert.ok(fs.existsSync(correctPath), `SKILL.md should exist at 1 level: ${correctPath}`);
    assert.ok(!fs.readdirSync(path.join(tmpDir, ".codebuddy", "skills")).some((n) => n.startsWith(".scope-")), ".scope-* dir should NOT exist for CodeBuddy");

    const content = fs.readFileSync(correctPath, "utf-8");
    assert.ok(content.includes("name: diag-testskill"));
    assert.ok(content.includes("# Test Skill"));

    delete (globalThis as any).window;
  });
});
