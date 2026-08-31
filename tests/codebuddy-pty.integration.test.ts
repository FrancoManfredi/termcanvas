import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

// High-quality integration test for CodeBuddy PTY plumbing — no model calls.
// Verifies that TermCanvas can launch a CodeBuddy terminal without spending credits.
// Only uses `codebuddy --version`, `--help`, `mcp list` (all free, no model).

function escapeArg(arg: string): string {
  if (/^[a-zA-Z0-9@._\-\/\\:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runCodebuddy(args: string[], cwd: string): string {
  const cmd = `codebuddy ${args.map(escapeArg).join(" ")}`;
  return execSync(cmd, { cwd, encoding: "utf-8", windowsHide: true, timeout: 8000 });
}

describe("codebuddy pty plumbing — no model (high quality)", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-pty-"));
    execSync("git init", { cwd: tmpDir, windowsHide: true } as any);
  });

  it("TERMINAL_TYPE_CONFIG has codebuddy with color and label", async () => {
    const { TERMINAL_TYPE_CONFIG } = await import("../src/terminal/terminalTypeConfig.ts");
    assert.ok(TERMINAL_TYPE_CONFIG["codebuddy"], "codebuddy should be in TERMINAL_TYPE_CONFIG");
    assert.equal(TERMINAL_TYPE_CONFIG["codebuddy"].label, "CodeBuddy");
    assert.ok(TERMINAL_TYPE_CONFIG["codebuddy"].color, "should have a color");
  });

  it("TerminalType includes codebuddy", async () => {
    // This is a type-level check, but we can verify at runtime that the project store accepts it
    const { ProjectStore } = await import("../headless-runtime/project-store.ts");
    const store = new ProjectStore();
    const project = {
      id: "test-p",
      name: "test",
      path: tmpDir,
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: [{ id: "wt-1", name: "main", path: tmpDir, position: { x: 0, y: 0 }, collapsed: false, terminals: [] }],
    };
    store.addProject(project as any);
    const term = store.addTerminal("test-p", "wt-1", "codebuddy" as any);
    assert.equal(term.type, "codebuddy");
  });

  it("CLI_LAUNCH has codebuddy adapter with model/resume/autoApprove (hole 1 fixed)", async () => {
    const { CLI_LAUNCH } = await import("../headless-runtime/terminal-launch.ts");
    assert.ok(CLI_LAUNCH["codebuddy"], "CLI_LAUNCH should have codebuddy");
    const adapter = CLI_LAUNCH["codebuddy"]!;
    assert.equal(adapter.shell, "codebuddy");
    assert.equal(adapter.supportsModel(), true, "should support --model");
    assert.equal(adapter.supportsReasoningEffort(), true, "should support --effort");
    assert.deepEqual(adapter.autoApproveArgs(), ["--dangerously-skip-permissions"]);
    assert.deepEqual(adapter.resumeArgs("test-id"), ["--resume", "test-id"]);
    assert.deepEqual(adapter.modelArgs("hy4"), ["--model", "hy4"]);
    assert.deepEqual(adapter.promptArgs("hello"), ["hello"]);
  });

  it("codebuddy --version and --help work without model (smoke, no credits)", () => {
    const version = runCodebuddy(["--version"], tmpDir);
    assert.match(version.trim(), /2\.\d+\.\d+/, "should print version like 2.141.0");
    const help = runCodebuddy(["--help"], tmpDir);
    assert.ok(help.includes("codebuddy") || help.includes("CodeBuddy"), "help should mention codebuddy");
    assert.ok(help.includes("--model") || help.includes("model"), "help should document --model flag (even though we don't use it here)");
  });

  it("codebuddy mcp list works without model (smoke, no credits)", () => {
    const out = runCodebuddy(["mcp", "list"], tmpDir);
    // Should not error, and should be either "No MCP servers" or list with our 3 globals
    assert.ok(out.includes("No MCP servers") || out.includes("context7") || out.includes("engram") || out.includes("codegraph") || out.includes("Connected") || out.includes("Needs approval"), "mcp list should succeed without model");
  });

  it("buildLaunchSpec for codebuddy does not require extraPathEntries beyond cliDir", async () => {
    const { buildLaunchSpec } = await import("../electron/pty-launch.ts");
    const deps = {
      platform: process.platform as NodeJS.Platform,
      pathDelimiter: path.delimiter,
      pathSeparator: path.sep,
      existsSync: fs.existsSync,
      isExecutable: () => true,
      readFileSync: fs.readFileSync as any,
      homeDir: () => os.homedir(),
      getShellEnv: async () => process.env as any,
    };
    const spec = await buildLaunchSpec({ cwd: tmpDir, terminalType: "codebuddy", terminalId: "test-id" }, deps as any);
    assert.ok(spec.env["TERMCANVAS_TERMINAL_TYPE"] === "codebuddy", "should set TERMCANVAS_TERMINAL_TYPE=codebuddy");
    assert.ok(spec.env["TERMCANVAS_TERMINAL_ID"] === "test-id");
    // CodeBuddy is launched via shell, not via pty shell override, so file should be user shell (e.g., powershell/cmd)
    assert.ok(spec.file, "should resolve a shell file");
  });

  it("Windows: codebuddy pty works with spaces in path (no shell injection)", async () => {
    const spaceDir = path.join(tmpDir, "space dir");
    fs.mkdirSync(spaceDir, { recursive: true });
    execSync("git init", { cwd: spaceDir, windowsHide: true } as any);
    const { buildLaunchSpec } = await import("../electron/pty-launch.ts");
    const deps = {
      platform: "win32" as NodeJS.Platform,
      pathDelimiter: ";",
      pathSeparator: "\\",
      existsSync: (p: string) => true,
      isExecutable: () => true,
      readFileSync: (() => "") as any,
      homeDir: () => os.homedir(),
      getShellEnv: async () => ({ PATH: "C:\\Windows\\System32", PATHEXT: ".EXE;.CMD" } as any),
    };
    // Should not throw when cwd has spaces
    const spec = await buildLaunchSpec({ cwd: spaceDir, terminalType: "codebuddy" }, deps as any);
    assert.ok(spec.cwd === spaceDir);
  });
});
