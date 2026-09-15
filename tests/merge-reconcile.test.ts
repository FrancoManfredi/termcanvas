/**
 * Merge reconcile (close-out externo): un PR mergeado en el forge (GitHub UI)
 * sobre un job factory Complete debe registrarse (isolation pr-merged +
 * evento durable) y limpiar el worktree aislado — solo si está limpio.
 * Offline: store en tmp, runner fake, cero red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "merge-rec-"));
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX;

const { workItemStore } = await import(
  "../headless-runtime/workItem/workItemStore.ts"
);
const {
  MERGE_RECONCILE_TTL_MS,
  cleanupMergedJobWorktree,
  reconcileMergedPrsForJobs,
  resetMergeReconcileForTests,
} = await import("../headless-runtime/factory/isolation/mergeReconcile.ts");

type Call = { cmd: string; args: readonly string[] };

function fakeRun(prState: string, porcelain = "") {
  const calls: Call[] = [];
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string }> => {
    calls.push({ cmd, args });
    if (cmd === "gh") {
      return {
        stdout: JSON.stringify({ state: prState, number: 139, url: "u" }),
        stderr: "",
      };
    }
    if (cmd === "git" && args[0] === "status") return { stdout: porcelain, stderr: "" };
    if (cmd === "git" && args[0] === "worktree") return { stdout: "", stderr: "" };
    throw new Error(`unexpected: ${cmd} ${args.join(" ")}`);
  };
  return { calls, run };
}

function makeCompleteJob(
  id: string,
  worktree: string,
  isolation: Record<string, unknown>,
): void {
  workItemStore.create({ id, prompt: "p", worktree });
  for (const status of ["Foreman", "Building", "Review"]) {
    try {
      workItemStore.transition(id, status, "system", `t-${status}`);
    } catch {
      // chain best-effort (mismo patrón que los tests del bridge)
    }
  }
  try {
    workItemStore.transition(id, "Complete", "system", "t-complete");
  } catch {
    // best-effort
  }
  (workItemStore.get(id) as unknown as { isolation?: unknown }).isolation =
    isolation;
}

function projection(
  id: string,
  isolation: Record<string, unknown>,
): Record<string, unknown> {
  return { id, status: "Complete", isolation };
}

test("reconcile: PR mergeado → pr-merged + evento + worktree eliminado (limpio)", async () => {
  resetMergeReconcileForTests();
  const wt = fs.mkdtempSync(path.join(SANDBOX, "wt-clean-"));
  const iso = {
    branch: "issue-123-x",
    baseBranch: "main",
    repoRoot: SANDBOX,
    worktreePath: wt,
    state: "pr-open",
    prNumber: 139,
  };
  makeCompleteJob("job-rec-clean", SANDBOX, iso);
  const { calls, run } = fakeRun("MERGED");
  await reconcileMergedPrsForJobs(
    [projection("job-rec-clean", iso)],
    { run },
  );
  const job = workItemStore.get("job-rec-clean") as unknown as {
    isolation: { state: string };
    timeline: Array<{ message: string }>;
  };
  assert.equal(job.isolation.state, "pr-merged");
  assert.ok(
    job.timeline.some((e) => e.message.includes("pr merged #139")),
    "evento de merge durable",
  );
  assert.ok(
    calls.some(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "remove",
    ),
    "git worktree remove llamado",
  );
  assert.ok(
    job.timeline.some((e) => e.message.includes("worktree eliminado")),
    "evento de cleanup",
  );
});

test("reconcile: worktree sucio → conservado, sin remove y con evento honesto", async () => {
  resetMergeReconcileForTests();
  const wt = fs.mkdtempSync(path.join(SANDBOX, "wt-dirty-"));
  const iso = {
    branch: "issue-124-x",
    baseBranch: "main",
    repoRoot: SANDBOX,
    worktreePath: wt,
    state: "pr-open",
    prNumber: 140,
  };
  makeCompleteJob("job-rec-dirty", SANDBOX, iso);
  const { calls, run } = fakeRun("MERGED", " M js/app.js\n");
  await reconcileMergedPrsForJobs([projection("job-rec-dirty", iso)], { run });
  const job = workItemStore.get("job-rec-dirty") as unknown as {
    isolation: { state: string };
    timeline: Array<{ message: string }>;
  };
  assert.equal(job.isolation.state, "pr-merged", "el merge se registra igual");
  assert.ok(
    !calls.some((c) => c.cmd === "git" && c.args[0] === "worktree"),
    "nunca borra un worktree sucio",
  );
  assert.ok(job.timeline.some((e) => e.message.includes("conservado")));
});

test("reconcile: TTL por job (no golpea gh en cada tick) y PR abierto no marca nada", async () => {
  resetMergeReconcileForTests();
  const iso = {
    branch: "issue-125-x",
    baseBranch: "main",
    repoRoot: SANDBOX,
    worktreePath: fs.mkdtempSync(path.join(SANDBOX, "wt-open-")),
    state: "pr-open",
    prNumber: 141,
  };
  makeCompleteJob("job-rec-open", SANDBOX, iso);
  const { calls, run } = fakeRun("OPEN");
  let now = 1_000_000;
  const seams = { run, now: () => now };
  await reconcileMergedPrsForJobs([projection("job-rec-open", iso)], seams);
  assert.equal(calls.filter((c) => c.cmd === "gh").length, 1);
  await reconcileMergedPrsForJobs([projection("job-rec-open", iso)], seams);
  assert.equal(
    calls.filter((c) => c.cmd === "gh").length,
    1,
    "dentro del TTL no vuelve a chequear",
  );
  now += MERGE_RECONCILE_TTL_MS + 1;
  await reconcileMergedPrsForJobs([projection("job-rec-open", iso)], seams);
  assert.equal(calls.filter((c) => c.cmd === "gh").length, 2);
  const job = workItemStore.get("job-rec-open") as unknown as {
    isolation: { state: string };
  };
  assert.equal(job.isolation.state, "pr-open", "PR abierto no se marca merged");
});

test("cleanup: worktree inexistente es no-op honesto (idempotente)", async () => {
  resetMergeReconcileForTests();
  const iso = {
    branch: "issue-126-x",
    baseBranch: "main",
    repoRoot: SANDBOX,
    worktreePath: path.join(SANDBOX, "no-existe-jamas"),
    state: "pr-open",
    prNumber: 142,
  };
  makeCompleteJob("job-rec-gone", SANDBOX, iso);
  const { run } = fakeRun("MERGED");
  const out = await cleanupMergedJobWorktree("job-rec-gone", { run });
  assert.equal(out.ok, true);
  assert.equal(out.removed, false);
  assert.equal(out.skipped, "already-gone");
});
