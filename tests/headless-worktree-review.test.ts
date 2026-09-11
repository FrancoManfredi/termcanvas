import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { HeadlessApiServer } from "../headless-runtime/api-server.ts";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import { ProjectScanner } from "../electron/project-scanner.ts";
import { TelemetryService } from "../electron/telemetry-service.ts";
import { PtyManager } from "../electron/pty-manager.ts";

function initRealRepo(): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-wtrev-")),
  );
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  execFileSync("git", ["branch", "feat-x"], { cwd: dir });
  return dir;
}

async function startRealServer(repo: string) {
  const telemetry = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const server = new HeadlessApiServer({
    projectStore: new ProjectStore(),
    ptyManager: new PtyManager(),
    projectScanner: new ProjectScanner(),
    telemetryService: telemetry,
    workspaceDir: repo,
  });
  const port = await server.start(0, "127.0.0.1");
  return {
    port,
    stop: () => {
      server.stop();
      telemetry.dispose();
    },
  };
}

test("review worktree: detached copy ida y vuelta contra repo real", async () => {
  const repo = initRealRepo();
  const { port, stop } = await startRealServer(repo);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/worktree/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, baseName: "feat-x", branch: "feat-x" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      path: string;
      worktrees: Array<{ path: string }>;
    };
    const reviewPath = body.path;
    assert.ok(reviewPath.endsWith("-review"));

    // Ida: detached (sin branch propia) + marker del bridge.
    assert.ok(fs.existsSync(reviewPath));
    let headRef = "";
    try {
      headRef = (
        execFileSync("git", ["symbolic-ref", "-q", "HEAD"], {
          cwd: reviewPath,
          encoding: "utf-8",
        }) as string
      ).trim();
    } catch {
      // Exit 1 + stdout vacío = detached. Cualquier branch atada falla el test.
    }
    assert.equal(headRef, "");
    const marker = path.join(
      repo,
      ".git",
      "worktrees",
      path.basename(reviewPath),
      "review-source-branch",
    );
    assert.equal(fs.readFileSync(marker, "utf-8"), "feat-x");

    // Vuelta: DELETE lo remueve.
    const del = await fetch(
      `http://127.0.0.1:${port}/worktree?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(reviewPath)}&force=1`,
      { method: "DELETE" },
    );
    assert.equal(del.status, 200);
    assert.ok(!fs.existsSync(reviewPath));
  } finally {
    stop();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("review worktree: valida nombres sin tocar git", async () => {
  const repo = initRealRepo();
  const { port, stop } = await startRealServer(repo);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/worktree/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, baseName: "a/b", branch: "feat-x" }),
    });
    assert.equal(res.status, 400);
  } finally {
    stop();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
