import test from "node:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function shortName(p: string): string {
  try {
    return execSync(`cmd /c for %I in ("${p}") do @echo %~sI`, {
      encoding: "utf-8",
    }).trim();
  } catch {
    return p;
  }
}

test("debug short-name canonicalization", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-wt-"));
  try {
    execSync("git init && git commit --allow-empty -m init", {
      cwd: dir,
      stdio: "pipe",
    });
    const wtPath = path.join(dir, ".worktrees", "test-wt");
    execSync(`git worktree add "${wtPath}" -b test-branch`, {
      cwd: dir,
      stdio: "pipe",
    });
    const out = execSync("git worktree list --porcelain", {
      cwd: dir,
      encoding: "utf-8",
    });
    const gitPath = out
      .split("\n")
      .find((l) => l.startsWith("worktree ") && l.includes("test-wt"))!
      .slice("worktree ".length);
    console.log("git  short:", shortName(gitPath));
    console.log("wt   short:", shortName(wtPath));
    console.log(
      "equal:",
      path.resolve(shortName(gitPath)).toLowerCase() ===
        path.resolve(shortName(wtPath)).toLowerCase(),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});