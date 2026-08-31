/**
 * Setup fixtures to test the automated review-cycle labels in TermCanvas.
 *
 * Usage: node scripts/setup-review-labels-test.mjs [scenario] [repoPath]
 *   scenario  pending | fix | approve  (default: fix)
 *   repoPath  git repo where the fixture PR/issue will be created
 *             (default: test-orquestador on the Desktop)
 *
 * Each scenario creates an issue, a branch with a fixture file, and a PR that
 * closes the issue ("Closes #N" contract). It never touches labels — the
 * TermCanvas checkLinkedPr path is what must materialize them.
 *
 *   pending  PR without review -> expect "review:pendiente" after refresh
 *   fix      review with blocking observations, then a new push (the "fix") ->
 *            expect "review:fix-aplicado" (head moved past the reviewed commit)
 *   approve  review with approved verdict -> expect "review:aprobado"
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);
const GIT_OPTS = { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 };
const GH_OPTS = { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 };

function fail(message) {
  // Throwing (not process.exit) keeps the try/finally cleanup running.
  throw new Error(`[setup] ERROR: ${message}`);
}

async function run(cmd, args, opts = {}) {
  // execFile rejects on non-zero exit codes; stderr is informational for
  // git/gh (progress, remote messages) and must not abort the flow.
  const { stdout } = await execFileAsync(cmd, args, {
    ...GIT_OPTS,
    ...opts,
  });
  return stdout.trim();
}

async function gh(args, opts = {}) {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      ...GH_OPTS,
      ...opts,
    });
    return stdout.trim();
  } catch (err) {
    fail(err.message);
  }
}

// Accept either `[scenario] [repoPath]` or `[repoPath] [scenario]`: the
// first argument wins as scenario when it matches one of the known names.
const argv = process.argv.slice(2);
const firstArgIsScenario = ["pending", "fix", "approve"].includes(argv[0]?.toLowerCase());
const scenario = (firstArgIsScenario ? argv[0] : argv[1] ?? "fix").toLowerCase();
const repoArg = firstArgIsScenario ? argv[1] : argv[0];
const repoPath = resolve(
  repoArg ??
    join(homedir(), "OneDrive", "Escritorio", "test-orquestador"),
);

if (!["pending", "fix", "approve"].includes(scenario)) {
  fail(`unknown scenario "${scenario}" (expected pending | fix | approve)`);
}
if (!existsSync(join(repoPath, ".git"))) {
  fail(`"${repoPath}" is not a git repository`);
}

console.log(`[setup] scenario=${scenario} repo=${repoPath}`);

await gh(["auth", "status"], {
  tolerateStderr: true,
  windowsHide: true,
});

// gh needs "OWNER/REPO", not a local path: resolve it from the git remote.
const remoteUrl = await run(
  "git",
  ["-C", repoPath, "remote", "get-url", "origin"],
  { windowsHide: true },
);
const repoArgMatch = remoteUrl.match(/(?:github\.com[:/])([^/]+\/[^/.]+?)(?:\.git)?$/);
if (!repoArgMatch) {
  fail(`could not resolve OWNER/REPO from remote "${remoteUrl}"`);
}
const ghRepo = repoArgMatch[1];

await run("git", ["-C", repoPath, "fetch", "origin"], { windowsHide: true });
const defaultBranch = (
  await run(
    "git",
    ["-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    { windowsHide: true },
  ).catch(() => "main")
).replace(/^origin\//, "");
const branch = `label-test/${scenario}-${Date.now().toString(36)}`;
const worktreeDir = mkdtempSync(join(tmpdir(), "label-test-"));
let issueNumber = null;
let branchPushed = false;
let prNumber = null;

try {
  // Create the issue FIRST: if anything below fails, the rollback can close
  // it without leaving orphan branches behind in "compare & pull request".
  const issueUrl = await gh([
    "issue", "create",
    "--repo", ghRepo,
    "--title", `Label test: ${scenario}`,
    "--body",
    `Fixture para validar la automatización de labels (escenario: ${scenario}).\nNo tocar labels a mano: TermCanvas debe materializarlos.`,
  ]);
  issueNumber = issueUrl.match(/\/issues\/(\d+)$/)?.[1];
  if (!issueNumber) {
    fail(`could not parse issue number from: ${issueUrl}`);
  }

  await run(
    "git",
    ["-C", repoPath, "worktree", "add", "-b", branch, worktreeDir, `origin/${defaultBranch}`],
    { windowsHide: true },
  );

  const fixtureFile = join(worktreeDir, `fixture-${scenario}.txt`);
  writeFileSync(
    fixtureFile,
    `Fixture for label scenario "${scenario}" created at ${new Date().toISOString()}\n`,
  );
  await run("git", ["-C", worktreeDir, "add", "."], { windowsHide: true });
  await run(
    "git",
    ["-C", worktreeDir, "commit", "-m", `chore: label test fixture (${scenario})`],
    { windowsHide: true },
  );
  await run("git", ["-C", worktreeDir, "push", "-u", "origin", branch], {
    windowsHide: true,
  });
  branchPushed = true;

  const prUrl = await gh([
    "pr", "create",
    "--repo", ghRepo,
    "--base", defaultBranch,
    "--head", branch,
    "--title", `Label test: ${scenario} (fix #${issueNumber})`,
    "--body", `Closes #${issueNumber}\n\nFixture del escenario ${scenario}.`,
  ]);
  prNumber = prUrl.match(/\/pull\/(\d+)$/)?.[1];
  if (!prNumber) {
    fail(`could not parse PR number from: ${prUrl}`);
  }

  // The "Closes #N" line is the contract that links the PR to the issue;
  // verify it survived creation instead of trusting it silently.
  const prBody = await gh([
    "pr", "view", prNumber,
    "--repo", ghRepo,
    "--json", "body",
    "--jq", ".body",
  ]);
  if (!prBody.includes(`Closes #${issueNumber}`)) {
    fail(`PR #${prNumber} is missing the "Closes #${issueNumber}" contract`);
  }

  if (scenario === "fix" || scenario === "approve") {
    const verdict = scenario === "fix" ? "CAMBIOS_PEDIDOS" : "APROBADO";
    const observations =
      scenario === "fix"
        ? "El fixture no cubre el caso de reentrada: falta validar que el segundo push no rompe el estado previo."
        : "Fixture sin observaciones: cobertura mínima suficiente.";
    await gh([
      "pr", "review", prNumber,
      "--repo", ghRepo,
      "--comment",
      "--body", `VEREDICTO: ${verdict}\n${observations}`,
    ]);
  }

  if (scenario === "fix") {
    writeFileSync(fixtureFile, "Fixed after review\n", { flag: "a" });
    await run("git", ["-C", worktreeDir, "add", "."], { windowsHide: true });
    await run(
      "git",
      ["-C", worktreeDir, "commit", "-m", "chore: apply fix after review"],
      { windowsHide: true },
    );
    await run("git", ["-C", worktreeDir, "push"], { windowsHide: true });
  }

  console.log("[setup] ok");
  console.log(`  issue #${issueNumber}  -> ${issueUrl}`);
  console.log(`  pr    #${prNumber} -> ${prUrl}`);
  console.log(`  branch ${branch}  (worktree: ${worktreeDir})`);
  console.log("");
  console.log("Verificación (dentro de TermCanvas: refrescar issues / revisar la tarjeta):");
  console.log("  gh pr view <PR> --json labels --jq '.labels[].name'");
  console.log("  gh issue view <ISSUE> --json labels --jq '.labels[].name'");
  console.log(`Esperado: ${scenario === "pending" ? "review:pendiente" : scenario === "fix" ? "review:fix-aplicado" : "review:aprobado"}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  // Rollback: undo everything already published, so a failed run never
  // leaves orphan branches (the "compare & pull request" mess) or issues.
  if (prNumber) {
    try {
      await gh(["pr", "close", prNumber, "--repo", ghRepo, "--delete-branch"], {
        windowsHide: true,
      });
      console.error(`[setup] rollback: closed PR #${prNumber} and deleted branch ${branch}`);
    } catch {
      // The PR or branch may not exist yet; nothing else to undo here.
    }
  } else if (branchPushed) {
    try {
      await run("git", ["-C", repoPath, "push", "origin", "--delete", branch], {
        windowsHide: true,
      });
      console.error(`[setup] rollback: deleted orphan branch ${branch}`);
    } catch {
      // Best-effort: the remote branch may have been cleaned up already.
    }
  }
  if (issueNumber) {
    try {
      await gh(["issue", "close", issueNumber, "--repo", ghRepo], {
        windowsHide: true,
      });
      console.error(`[setup] rollback: closed issue #${issueNumber}`);
    } catch {
      // Best-effort: the issue may have been closed already.
    }
  }
  process.exitCode = 1;
} finally {
  try {
    await run("git", ["-C", repoPath, "worktree", "remove", worktreeDir, "--force"], {
      windowsHide: true,
    });
  } catch {
    // The worktree is a temp dir on disk; removal is best-effort.
  }
  try {
    rmSync(worktreeDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup of the temp fixture directory.
  }
}
