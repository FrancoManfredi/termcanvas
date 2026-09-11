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
import {
  createReviewWorktree,
  createWorktree,
  removeWorktree,
  restoreWorktree,
} from "../src/lib/worktreeClient.ts";

function setWindowFor(headlessPort: number | null): void {
  const search = headlessPort === null ? "" : `?headless-port=${headlessPort}`;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search, protocol: "http:", port: "", host: "localhost" },
    },
  });
}

function clearWindow(): void {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
}

function initRealRepo(): string {
  // realpath.native: os.tmpdir() viene en forma corta 8.3 (ESTUDI~1) y git
  // reporta la forma larga — realpathSync común NO expande en este entorno.
  // (Igual que en la app, donde los paths siempre llegan en forma larga.)
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-wt-")),
  );
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
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

test("resolve CTA: createWorktree ida y vuelta contra worktree real", async () => {
  const repo = initRealRepo();
  const { port, stop } = await startRealServer(repo);
  setWindowFor(port);
  try {
    const created = await createWorktree(repo, "feat-f3");
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // Ida: el worktree existe de verdad en disco y en git.
    assert.ok(fs.existsSync(created.path));
    const list = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repo,
      encoding: "utf-8",
    }) as string;
    assert.ok(list.includes("feat-f3"));
    // El scanner reporta con forward slashes (igual que el bridge) —
    // el renderer ya normaliza al comparar (normalizePathForCompare).
    const norm = (p: string) => p.replace(/\\/g, "/");
    assert.ok(
      created.worktrees.some((w) => norm(w.path) === norm(created.path)),
    );

    // Vuelta: DELETE directo del daemon lo remueve (remove dual = CTA-REVIEW).
    const res = await fetch(
      `http://127.0.0.1:${port}/worktree?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(created.path)}&force=1`,
      { method: "DELETE" },
    );
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(created.path));
  } finally {
    clearWindow();
    stop();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("review CTA: createReview + remove ida y vuelta contra repo real", async () => {
  const repo = initRealRepo();
  execFileSync("git", ["branch", "feat-r"], { cwd: repo });
  const { port, stop } = await startRealServer(repo);
  setWindowFor(port);
  try {
    const created = await createReviewWorktree(repo, "feat-r", "feat-r");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.ok(created.path.endsWith("-review"));
    assert.ok(fs.existsSync(created.path));

    const removed = await removeWorktree(repo, created.path, true);
    assert.equal(removed.ok, true);
    assert.ok(!fs.existsSync(created.path));
    const list = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repo,
      encoding: "utf-8",
    }) as string;
    assert.ok(!list.includes("feat-r-review"));
  } finally {
    clearWindow();
    stop();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("fix CTA: restoreWorktree reatacha branch existente (repo real)", async () => {
  const repo = initRealRepo();
  execFileSync("git", ["branch", "feat-fix"], { cwd: repo });
  const { port, stop } = await startRealServer(repo);
  setWindowFor(port);
  try {
    const restored = await restoreWorktree(repo, "feat-fix");
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.ok(fs.existsSync(restored.path));
    const branch = execFileSync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: restored.path, encoding: "utf-8" },
    ).trim();
    assert.equal(branch, "feat-fix");
  } finally {
    clearWindow();
    stop();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("fix CTA: restoreWorktree rechaza branch inexistente", async () => {
  const repo = initRealRepo();
  const { port, stop } = await startRealServer(repo);
  setWindowFor(port);
  try {
    const restored = await restoreWorktree(repo, "no-existe");
    assert.equal(restored.ok, false);
  } finally {
    clearWindow();
    stop();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("resolve CTA: bridge presente delega sin tocar HTTP", async () => {
  const expected = { ok: true as const, path: "/x", worktrees: [] };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "", protocol: "http:", port: "", host: "x" },
      termcanvas: {
        project: {
          createWorktree: async () => expected,
        },
      },
    },
  });
  try {
    assert.equal(await createWorktree("/repo", "b"), expected);
  } finally {
    clearWindow();
  }
});

test("resolve CTA: sin daemon, error honesto", async () => {
  setWindowFor(9);
  try {
    const result = await createWorktree("/repo", "b");
    assert.equal(result.ok, false);
  } finally {
    clearWindow();
  }
});
