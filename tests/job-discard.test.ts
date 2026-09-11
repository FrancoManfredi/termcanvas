/**
 * job-discard — NO RETOMAR TRABAJO (flujo simple, sin reintentos).
 *
 * POST /factory/jobs/:id/discard: teardown completo del job parado para
 * que el issue vuelva a pendientes (sin PR abierto la derivación N1/C1 no
 * tiene de qué agarrarse):
 * PR close (sin merge) → worktree remove → rama remota+local (base nunca)
 * → archivos sueltos (untracked borra, tracked revierte) → job borrado
 * total (memoria + dir + índice + sessions).
 * Guards 404/409 (solo Cancelled o en-curso frenan; Complete se acepta).
 *
 * Sandbox: TERMCANVAS_FACTORY_DIR a tmp (el índice real no se toca),
 * git real en tmp, gh/worktree/branch con seam fake. Sin red, sin daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { requestJobDiscard } from "../headless-runtime/factory/jobs/jobDiscard.ts";
import {
  readJobIndexDirs,
  recordJobDirInIndex,
} from "../headless-runtime/workItem/workItemDisk.ts";
import {
  getAgentSession,
  setAgentSession,
} from "../headless-runtime/sessions/agentSessions.ts";

// ── Sandbox factory (el índice real nunca se toca) ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "job-discard-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

const TEST_TIMEOUT_MS = 30_000;

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 15000 });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${String(r.stderr).slice(0, 200)}`);
}

function makeGitRepo(): string {
  const wt = makeTmp("job-discard-");
  git(wt, ["init", "-b", "main"]);
  git(wt, ["config", "user.email", "test@test"]);
  git(wt, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(wt, "base.txt"), "base\n", "utf-8");
  git(wt, ["add", "-A"]);
  git(wt, ["commit", "-m", "base", "--quiet"]);
  return wt;
}

function toBuilding(id: string, worktree: string): void {
  workItemStore.create({ id, prompt: "hacer algo", worktree });
  workItemStore.transition(id, "Foreman", "foreman", "t");
  workItemStore.transition(id, "Building", "foreman", "t");
}

type FakeCall = { cmd: string; args: string; cwd: string };

function fakeRun(calls: FakeCall[], untracked = "") {
  return async (
    cmd: string,
    args: readonly string[],
    opts: { cwd: string; timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string }> => {
    calls.push({ cmd, args: args.join(" "), cwd: opts.cwd });
    if (cmd === "gh") {
      if (args[0] === "pr" && args[1] === "view") {
        return { stdout: JSON.stringify({ state: "OPEN", number: 42, url: "http://x/42" }), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
    if (cmd === "git" && args[0] === "ls-files") {
      return { stdout: untracked, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

// ── Guards ──

test("discard 404 ante id inválido o ausente", { timeout: TEST_TIMEOUT_MS }, async () => {
  workItemStore.clear();
  try {
    assert.deepEqual(await requestJobDiscard(""), { ok: false, code: 404, error: "job not found: " });
    assert.deepEqual(await requestJobDiscard(null), { ok: false, code: 404, error: "job not found: " });
    assert.deepEqual(await requestJobDiscard("job-no-existe-01"), {
      ok: false,
      code: 404,
      error: "job not found: job-no-existe-01",
    });
  } finally {
    workItemStore.clear();
  }
});

test("discard 409 solo si ya está descartado o está en curso", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp("job-discard-guard-");
  workItemStore.clear();
  try {
    const doneId = "job-discard-done01";
    toBuilding(doneId, wt);
    workItemStore.transition(doneId, "Cancelled", "user", "t");
    assert.deepEqual(await requestJobDiscard(doneId), {
      ok: false,
      code: 409,
      error: "job already discarded",
    });

    const lockId = "job-discard-lock01";
    toBuilding(lockId, wt);
    assert.equal(workItemStore.acquireBuildingLock(lockId), true);
    try {
      assert.deepEqual(await requestJobDiscard(lockId), {
        ok: false,
        code: 409,
        error: "job en curso: no se puede descartar mientras corre",
      });
      assert.equal(workItemStore.get(lockId)?.status, "Building");
    } finally {
      workItemStore.releaseBuildingLock(lockId);
    }
  } finally {
    workItemStore.clear();
    rmRf(wt);
  }
});

// ── Teardown completo ──

test("discard cierra PR, borra rama/worktree/job y limpia índice+sessions", { timeout: TEST_TIMEOUT_MS }, async () => {
  const repo = makeGitRepo();
  const wt = path.join(repo, "wt-job-1");
  fs.mkdirSync(wt, { recursive: true });
  // Archivo tracked dentro de la jaula (el worktree efectivo del job).
  fs.writeFileSync(path.join(wt, "tracked.txt"), "orig\n", "utf-8");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "jail file", "--quiet"]);
  workItemStore.clear();
  const id = "job-discard-full01";
  const calls: FakeCall[] = [];
  try {
    toBuilding(id, repo);
    // Aislamiento + PR registrados como el daemon real.
    workItemStore.appendEvent(id, "system", "isolation lista", {
      isolation: {
        branch: "job/job-discard-full01",
        baseBranch: "main",
        worktreePath: wt,
        repoRoot: repo,
      },
    });
    workItemStore.appendEvent(id, "system", "pr abierto", {
      pr: { prNumber: 42, prUrl: "http://x/42" },
    });
    // Archivos del job (relativos a la jaula) + sessions + índice.
    fs.writeFileSync(path.join(wt, "tracked.txt"), "modified\n", "utf-8");
    fs.writeFileSync(path.join(wt, "new.txt"), "new\n", "utf-8");
    const cur = workItemStore.get(id)!;
    (cur as unknown as Record<string, unknown>).createdFiles = ["tracked.txt", "new.txt"];
    setAgentSession(id, "implement", "ses_fake_1");
    assert.equal(getAgentSession(id, "implement"), "ses_fake_1");
    recordJobDirInIndex(id, cur.dir as string);
    assert.ok(readJobIndexDirs().has(path.resolve(cur.dir as string).toLowerCase()));

    const out = await requestJobDiscard(id, { run: fakeRun(calls, "wt-job-1/new.txt") });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.status, "Discarded");

    // PR cerrado por número (no por rama).
    assert.ok(
      calls.some((c) => c.cmd === "gh" && c.args === "pr close 42"),
      `gh pr close 42 esperado, hubo: ${JSON.stringify(calls)}`,
    );
    assert.deepEqual(out.cleaned.prClosed, ["PR #42"]);

    // Worktree removido con force.
    assert.ok(
      calls.some((c) => c.cmd === "git" && c.args.includes("worktree remove --force")),
      "git worktree remove --force esperado",
    );
    assert.deepEqual(out.cleaned.worktreeRemoved, [wt]);

    // Rama remota + local borradas; la base intacta.
    const argStr = calls.map((c) => `${c.cmd} ${c.args}`).join("\n");
    assert.ok(argStr.includes("git push origin --delete job/job-discard-full01"), "push --delete esperado");
    assert.ok(argStr.includes("git branch -D job/job-discard-full01"), "branch -D esperado");
    assert.ok(!argStr.includes("--delete main"), "la base nunca se toca");
    assert.ok(!argStr.includes("-D main"), "la base nunca se toca");
    assert.deepEqual(out.cleaned.branchDeleted, ["job/job-discard-full01"]);

    // Untracked de la jaula borrado, tracked revertido (checkout fakeado ok).
    assert.ok(out.cleaned.deleted.some((f) => f === "new.txt"));
    assert.ok(out.cleaned.restored.includes("tracked.txt"));

    // Job borrado total: memoria + dir + índice + sessions.
    assert.equal(workItemStore.get(id), undefined);
    assert.equal(fs.existsSync(cur.dir as string), false);
    assert.ok(!readJobIndexDirs().has(path.resolve(cur.dir as string).toLowerCase()));
    assert.equal(getAgentSession(id, "implement"), null);
    assert.equal(out.cleaned.jobDeleted, true);
  } finally {
    workItemStore.clear();
    rmRf(repo);
  }
});

test("discard con git real: untracked se borra, tracked se revierte, resto skipped", { timeout: TEST_TIMEOUT_MS }, async () => {
  const repo = makeGitRepo();
  workItemStore.clear();
  const id = "job-discard-git01";
  try {
    toBuilding(id, repo);
    fs.writeFileSync(path.join(repo, "base.txt"), "modified\n", "utf-8");
    fs.mkdirSync(path.join(repo, "newdir"), { recursive: true });
    fs.writeFileSync(path.join(repo, "newdir", "new.txt"), "new\n", "utf-8");
    const cur = workItemStore.get(id)!;
    (cur as unknown as Record<string, unknown>).createdFiles = [
      "base.txt",
      "newdir/new.txt",
      "../evil.txt",
      ".git/hooks/evil",
    ];

    // Sin seam: git real (sin gh; sin PR/rama/worktree registrados → skipped).
    const out = await requestJobDiscard(id);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(fs.readFileSync(path.join(repo, "base.txt"), "utf-8").replace(/\r\n/g, "\n"), "base\n");
    assert.equal(fs.existsSync(path.join(repo, "newdir")), false);
    assert.ok(out.cleaned.restored.includes("base.txt"));
    assert.ok(out.cleaned.deleted.some((f) => f.startsWith("newdir/new.txt")));
    assert.ok(out.cleaned.skipped.some((f) => f.startsWith("../evil.txt")));
    assert.ok(out.cleaned.skipped.some((f) => f.startsWith(".git/hooks/evil")));
    assert.ok(out.cleaned.skipped.some((f) => f.includes("nada para cerrar")));
    assert.equal(workItemStore.get(id), undefined);
    assert.equal(out.cleaned.jobDeleted, true);
  } finally {
    workItemStore.clear();
    rmRf(repo);
  }
});

test("discard no toca la rama base aunque coincida", { timeout: TEST_TIMEOUT_MS }, async () => {
  const repo = makeGitRepo();
  workItemStore.clear();
  const id = "job-discard-base01";
  const calls: FakeCall[] = [];
  try {
    toBuilding(id, repo);
    workItemStore.appendEvent(id, "system", "isolation lista", {
      isolation: {
        branch: "main",
        baseBranch: "main",
        worktreePath: path.join(repo, "wt-x"),
        repoRoot: repo,
      },
    });
    const out = await requestJobDiscard(id, { run: fakeRun(calls) });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.cleaned.branchDeleted, []);
    assert.ok(out.cleaned.skipped.some((f) => f.includes("es la base")));
    const argStr = calls.map((c) => `${c.cmd} ${c.args}`).join("\n");
    assert.ok(!argStr.includes("--delete main"), "la base nunca se borra remoto");
  } finally {
    workItemStore.clear();
    rmRf(repo);
  }
});

test("discard acepta jobs en Complete (caso No mergear)", { timeout: TEST_TIMEOUT_MS }, async () => {
  const repo = makeGitRepo();
  workItemStore.clear();
  const id = "job-discard-done01";
  const calls: FakeCall[] = [];
  try {
    toBuilding(id, repo);
    workItemStore.transition(id, "Review", "runner", "t");
    workItemStore.transition(id, "Complete", "system", "t");
    const out = await requestJobDiscard(id, { run: fakeRun(calls) });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.status, "Discarded");
    assert.equal(workItemStore.get(id), undefined);
  } finally {
    workItemStore.clear();
    rmRf(repo);
  }
});
