import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCycleLabel,
  applyReviewLabel,
  findPrsForIssue,
  getConflictFiles,
  getPrComments,
  getPrReviewDecision,
  syncIssueReviewLabel,
  type GhExecFn,
} from "../headless-runtime/github-lookups.ts";
import { parseOwnerRepoFromRemote } from "../shared/github-remote.ts";

interface RecordedCall {
  file: string;
  args: string[];
  timeout: number;
  maxBuffer: number;
}

function stubExec(
  handler: (file: string, args: string[]) => string,
): { exec: GhExecFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const exec: GhExecFn = async (file, args, options) => {
    calls.push({
      file,
      args,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
    });
    return { stdout: handler(file, args), stderr: "" };
  };
  return { exec, calls };
}

test("owner/repo parses https/ssh/.git and rejects non-github remotes", () => {
  assert.deepEqual(parseOwnerRepoFromRemote("https://github.com/o/r.git\n"), {
    owner: "o",
    repo: "r",
  });
  assert.deepEqual(parseOwnerRepoFromRemote("git@github.com:o/r.git"), {
    owner: "o",
    repo: "r",
  });
  assert.deepEqual(parseOwnerRepoFromRemote("https://github.com/o/r"), {
    owner: "o",
    repo: "r",
  });
  assert.equal(parseOwnerRepoFromRemote("https://gitlab.com/o/r.git"), null);
  assert.equal(parseOwnerRepoFromRemote(null), null);
});

test("findPrsForIssue prefers OPEN and keeps plan timeout/buffer", async () => {
  const { exec, calls } = stubExec((file, args) => {
    if (file === "git") return "https://github.com/acme/repo.git\n";
    assert.ok(args.includes("graphql"));
    return JSON.stringify({
      data: {
        repository: {
          issue: {
            closedByPullRequestsReferences: {
              nodes: [
                { number: 11, title: "old", url: "u11", state: "MERGED", headRefName: "b", headRefOid: "h1" },
                { number: 12, title: "new", url: "u12", state: "OPEN", headRefName: "c", headRefOid: "h2" },
              ],
            },
          },
        },
      },
    });
  });

  const result = await findPrsForIssue("/repo", 5, exec);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.prs.length, 2);
  // Parity with the bridge: OPEN wins over the first node.
  assert.equal(result.preferred?.number, 12);

  const ghCall = calls.find((c) => c.file === "gh");
  assert.ok(ghCall);
  assert.equal(ghCall.timeout, 30_000);
  assert.equal(ghCall.maxBuffer, 50 * 1024 * 1024);
});

test("findPrsForIssue surfaces graphql errors and missing remotes honestly", async () => {
  const badGraphql = stubExec((file) =>
    file === "git"
      ? "https://github.com/acme/repo.git\n"
      : JSON.stringify({ errors: [{ message: "boom" }] }),
  );
  assert.deepEqual(await findPrsForIssue("/repo", 5, badGraphql.exec), {
    ok: false,
    error: "GitHub GraphQL: boom",
  });

  const noRemote = stubExec(() => {
    throw new Error("exit code 128");
  });
  const missing = await findPrsForIssue("/repo", 5, noRemote.exec);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.error, /origin/);
  }
});

test("review decision: newest verdict wins, fix-applied fold matches bridge", async () => {
  const { exec } = stubExec((file) => {
    if (file === "git") return "https://github.com/acme/repo.git\n";
    return JSON.stringify({
      decision: "CHANGES_REQUESTED",
      headRefOid: "head-new",
      reviews: [
        {
          state: "CHANGES_REQUESTED",
          body: "VEREDICTO: CAMBIOS_PEDIDOS.\nold feedback",
          submittedAt: "2026-01-01T00:00:00Z",
          commitOid: "c1",
        },
        {
          state: "APPROVED",
          body: "VEREDICTO: APROBADO.\nre-review after fix",
          submittedAt: "2026-01-02T00:00:00Z",
          commitOid: "c1",
        },
      ],
      labels: ["review:comentado"],
    });
  });

  const result = await getPrReviewDecision("/repo", 12, exec);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Newest verdict line (APROBADO) beats the stale CHANGES_REQUESTED…
  assert.equal(result.bodyVerdict, "APROBADO");
  // …but the head moved past the reviewed commit, so FIX_APPLIED folds in.
  assert.equal(result.reviewDecision, "FIX_APPLIED");
  assert.deepEqual(result.labels, ["review:comentado"]);
  assert.equal(result.lastReviewCommitId, "c1");
});

test("review decision: COMMENTED counts as feedback like the bridge", async () => {
  const { exec } = stubExec(() => {
    return JSON.stringify({
      decision: "",
      headRefOid: "h",
      reviews: [
        {
          state: "COMMENTED",
          body: "just some inline notes",
          submittedAt: "2026-01-01T00:00:00Z",
          commitOid: "h",
        },
      ],
      labels: [],
    });
  });

  const result = await getPrReviewDecision("/repo", 12, exec);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.reviewDecision, "COMMENTED");
});

test("conflict check mirrors the bridge dance (fetch/worktree/merge/diff/cleanup)", async () => {
  const seen: string[][] = [];
  const { exec } = stubExec((file, args) => {
    seen.push([file, ...args]);
    if (args[0] === "merge" && !args.includes("--abort")) {
      throw new Error("Auto-merging failed");
    }
    if (args[0] === "diff") return "src/a.ts\nsrc/b.ts\n";
    return "";
  });

  const result = await getConflictFiles("/repo", "feat", 12, exec, (...p) =>
    p.join("/"),
  );
  assert.deepEqual(result, { ok: true, conflictFiles: ["src/a.ts", "src/b.ts"] });

  const sequence = seen.map((s) => s.slice(0, 3).join(" "));
  assert.deepEqual(sequence, [
    "git fetch origin",
    "git fetch origin",
    "git worktree add",
    "git merge origin/main",
    "git diff --name-only",
    "git merge --abort",
    "git worktree remove",
  ]);
});

test("applyReviewLabel ensures labels, edits PR, mirrors issue (bridge parity)", async () => {
  const seen: string[][] = [];
  const { exec } = stubExec((file, args) => {
    seen.push([file, ...args]);
    if (args[0] === "pr") return "Fixes #5\n";
    return "";
  });

  assert.deepEqual(await applyReviewLabel("/repo", 12, "APPROVED", exec), {
    ok: true,
  });
  const ghArgs = seen.filter((s) => s[0] === "gh").map((s) => s.slice(1).join(" "));
  assert.ok(ghArgs[0].startsWith("label create review:aprobado"), "target ensured first");
  assert.ok(ghArgs.some((a) => a.startsWith("label create review:comentado")));
  assert.ok(
    ghArgs.some((a) =>
      a.includes("issue edit 12 --add-label review:aprobado --remove-label review:comentado"),
    ),
  );
  assert.ok(
    ghArgs.some((a) => a.includes("issue edit 5 --add-label review:aprobado")),
    "mirrored onto the Closes-linked issue",
  );
});

test("applyReviewLabel null verdict is a no-op without spawning", async () => {
  const { exec, calls } = stubExec(() => "");
  assert.deepEqual(await applyReviewLabel("/repo", 12, null, exec), { ok: true });
  assert.equal(calls.length, 0);
});

test("applyCycleLabel rejects off-cycle labels before spawning", async () => {
  const { exec, calls } = stubExec(() => "");
  const result = await applyCycleLabel("/repo", 12, 5, "bug", exec);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("syncIssueReviewLabel derives canonical (conflict beats approved)", async () => {
  const seen: string[][] = [];
  const { exec } = stubExec((file, args) => {
    seen.push([file, ...args]);
    return "";
  });

  assert.deepEqual(
    await syncIssueReviewLabel("/repo", 5, ["review:aprobado", "conflicto:main"], exec),
    { ok: true },
  );
  const edits = seen
    .filter((s) => s[1] === "issue")
    .map((s) => s.slice(1).join(" "));
  assert.ok(
    edits.some((a) => a.includes("issue edit 5 --add-label conflicto:main")),
  );
});

test("pr comments truncate exactly like the bridge", async () => {
  const long = stubExec(() => `x`.repeat(6000));
  const truncated = await getPrComments("/repo", 12, long.exec);
  assert.equal(truncated.ok, true);
  if (!truncated.ok) return;
  assert.ok(truncated.text.endsWith("para el resto)"));
  assert.ok(truncated.text.length < 6000);

  const short = stubExec(() => "  hello  ");
  assert.deepEqual(await getPrComments("/repo", 12, short.exec), {
    ok: true,
    text: "hello",
  });
});
