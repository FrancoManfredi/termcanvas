/**
 * T01 — Factory jobs isolation (daemon core), offline unit suite.
 *
 * Covers §9 Eng A: branch parity vs the canvas convention (incl. unicode /
 * long / symbols), the `shouldIsolate` gate (incl. pact exclusion + junk
 * `issueRef`), `effectiveWorktreeFor` (fallback / prefer-isolated /
 * timeline rehydrate), PR body `Closes #N`, the `prGuard` once-per-job
 * rule (incl. restart-from-disk), the DELETE guard matrix (incl.
 * dirty/force/non-terminal), plus schema + exec-level honesty (single
 * attempt, no auto-merge primitive, branch never deleted).
 *
 * All offline (`node:test`, injected fakes, zero network/daemon). Pact
 * jobs never touch git/gh: the gate short-circuits before any spawn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildIssueBranchName } from "../src/canvas/issueWorktreeNaming.ts";
import {
  IsolationSchema,
  type WorkItem,
} from "../shared/types/workItem.ts";
import {
  buildIsolationBranchName,
  buildPrBody,
  buildPrTitle,
  decideWorktreeDelete,
  effectiveWorktreeFor,
  isPactIsolationJob,
  parseIssueTitleFromPrompt,
  parseWorktreeDeletePath,
  prGuard,
  readIsolationFromTimeline,
  readPrFromTimeline,
  sanitizeIsolationIssueRef,
  shouldIsolate,
  slugifyIssueTitle,
} from "../headless-runtime/factory/isolation/isolationStore.ts";
import {
  ensureIsolatedWorktree,
  isWorkingTreeDirty,
  removeIsolatedWorktree,
  GIT_PROBE_TIMEOUT_MS,
  GIT_WORKTREE_ADD_TIMEOUT_MS,
} from "../headless-runtime/factory/isolation/gitWorktree.ts";
import {
  commitWorktreeChanges,
  countBranchCommitsVsBase,
  gateAcceptOnBranchDiff,
  openPrForJob,
  readPrState,
  readWorktreeStatusPorcelain,
  GIT_COMMIT_TIMEOUT_MS,
  GIT_PUSH_TIMEOUT_MS,
  GIT_REV_LIST_TIMEOUT_MS,
  GIT_STATUS_TIMEOUT_MS,
  GH_PR_CREATE_TIMEOUT_MS,
  GH_PR_VIEW_TIMEOUT_MS,
} from "../headless-runtime/factory/isolation/gitHubPr.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// ── Branch parity (mirror of buildIssueBranchName) ──

test("parity: standard title matches the canvas convention", () => {
  assert.equal(
    buildIsolationBranchName({ issueNumber: 42, title: "Fix login bug" }),
    buildIssueBranchName({ issueNumber: 42, title: "Fix login bug" }),
  );
});

test("parity: unicode + long + symbols titles match over a generated sweep", () => {
  const titles = [
    "Añadir cañón Ñandú → déjà vu",
    "Fix 100% — coverage!!! (urgent) @team #42",
    "; rm -rf / && echo pwned",
    "Ünïcödé snowman ☃ emoji 😀 arrow →",
    "  --Hello   World--  ",
    "",
    "---",
    "x".repeat(200),
    "ś".repeat(200),
    "-".repeat(60),
    "Trailing dash after slice-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-",
    "UPPER CASE WITH MiXeD 123 NUMBERS",
    "tab\tseparated\nnewline title",
    "dot.separated/slashed\\back title",
  ];
  for (let i = 0; i < 110; i += 1) {
    titles.push(`Generated sweep title number ${i} — with noise @#%`);
  }
  for (const title of titles) {
    assert.equal(
      buildIsolationBranchName({ issueNumber: 412, title }),
      buildIssueBranchName({ issueNumber: 412, title }),
      `parity miss for ${JSON.stringify(title).slice(0, 80)}`,
    );
  }
});

test("parity: empty slug falls back to issue-N on both sides", () => {
  assert.equal(buildIsolationBranchName({ issueNumber: 3, title: "" }), "issue-3");
  assert.equal(
    buildIsolationBranchName({ issueNumber: 3, title: "" }),
    buildIssueBranchName({ issueNumber: 3, title: "" }),
  );
});

test("parity: slug truncates to 40 chars with no trailing hyphen", () => {
  const slug = slugifyIssueTitle(
    "This is an extremely long issue title that definitely exceeds the forty character slug limit",
  );
  assert.ok(slug.length <= 40);
  assert.ok(!slug.endsWith("-"));
  assert.equal(
    buildIsolationBranchName({ issueNumber: 10, title: "x".repeat(200) }),
    buildIssueBranchName({ issueNumber: 10, title: "x".repeat(200) }),
  );
});

test("parity: issue number prefixes match across numbers", () => {
  for (const n of [1, 7, 99, 412, 99999]) {
    assert.equal(
      buildIsolationBranchName({ issueNumber: n, title: "Fix kanban count" }),
      buildIssueBranchName({ issueNumber: n, title: "Fix kanban count" }),
    );
  }
});

// ── shouldIsolate gate (pacts excluded, junk ignored) ──

const VALID_REF = {
  provider: "github",
  issueNumber: 412,
  repo: "owner/repo",
  url: "https://github.com/owner/repo/issues/412",
};

test("gate: valid issueRef on a real job isolates", () => {
  assert.equal(
    shouldIsolate({
      id: "job-mtk7x2ab-1a2b",
      prompt: "# Resolve issue #412 — Fix kanban count",
      worktree: "C:/repo/termcanvas",
      issueRef: { ...VALID_REF },
    }),
    true,
  );
});

test("gate: minimal ref (no repo/url) still isolates", () => {
  assert.equal(
    shouldIsolate({
      prompt: "do things",
      worktree: "/repo",
      issueRef: { provider: "github", issueNumber: 1 },
    }),
    true,
  );
});

test("gate: missing issueRef never isolates (legacy path)", () => {
  assert.equal(
    shouldIsolate({ prompt: "do things", worktree: "/repo" }),
    false,
  );
});

test("gate: junk refs never isolate and never throw", () => {
  const junks: unknown[] = [
    null,
    undefined,
    42,
    "github#412",
    [],
    { provider: "github" },
    { provider: "github", issueNumber: 0 },
    { provider: "github", issueNumber: -3 },
    { provider: "github", issueNumber: 1.5 },
    { provider: "github", issueNumber: "412" },
    { provider: "gitlab", issueNumber: 412 },
    { provider: "github", issueNumber: NaN },
  ];
  for (const issueRef of junks) {
    assert.equal(
      shouldIsolate({ prompt: "x", worktree: "/r", issueRef }),
      false,
      `junk accepted: ${JSON.stringify(issueRef)}`,
    );
  }
  assert.equal(sanitizeIsolationIssueRef({ provider: "github" }), null);
});

test("gate: pact ids are excluded even with a valid ref", () => {
  for (const id of [
    "job-abc123",
    "job-abc123-e2e",
    "job-f10-1",
    "job-f11-x",
    "job-f13-a",
    "job-f14-b",
    "job-f04-cancel01",
    "job-f03-z",
    "playground-1",
  ]) {
    assert.equal(
      shouldIsolate({ id, prompt: "p", worktree: "/r", issueRef: { ...VALID_REF } }),
      false,
      `pact id isolated: ${id}`,
    );
    assert.equal(isPactIsolationJob({ id }), true);
  }
});

test("gate: playground prompt/worktree excluded even with a valid ref", () => {
  assert.equal(
    shouldIsolate({
      id: "job-mtk1",
      prompt: "playground-do things",
      worktree: "/r",
      issueRef: { ...VALID_REF },
    }),
    false,
  );
  assert.equal(
    shouldIsolate({
      id: "job-mtk1",
      prompt: "p",
      worktree: "/x/playground-abc",
      issueRef: { ...VALID_REF },
    }),
    false,
  );
});

test("gate: real mtk ids are not pact-shaped", () => {
  assert.equal(isPactIsolationJob({ id: "job-mtk7x2ab-1a2b" }), false);
  assert.equal(
    shouldIsolate({
      id: "job-mtk7x2ab-1a2b",
      prompt: "real work",
      worktree: "/r",
      issueRef: { ...VALID_REF },
    }),
    true,
  );
});

// ── effectiveWorktreeFor ──

function baseJob(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "job-mtk7x2ab",
    prompt: "p",
    worktree: "/repo/termcanvas",
    status: "Building",
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    timeline: [],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir: null,
    dotDonePath: "",
    runnerId: "linux-build",
    phase: "diagnosisLlm",
    ...over,
  } as WorkItem;
}

test("resolver: no isolation falls back to the resolved anchor", () => {
  assert.equal(
    effectiveWorktreeFor(baseJob()),
    path.resolve("/repo/termcanvas"),
  );
});

test("resolver: memory isolation wins over the anchor", () => {
  const job = baseJob({
    isolation: {
      branch: "issue-412-fix-kanban-count",
      baseBranch: "main",
      worktreePath: "/repo/termcanvas/.worktrees/issue-412-fix-kanban-count",
      repoRoot: "/repo/termcanvas",
      state: "created",
      createdAt: "2026-09-07T12:00:00.000Z",
    },
  });
  assert.equal(
    effectiveWorktreeFor(job),
    "/repo/termcanvas/.worktrees/issue-412-fix-kanban-count",
  );
});

test("resolver: timeline record rehydrates after a restart (memory absent)", () => {
  const job = baseJob({
    timeline: [
      {
        id: "job-mtk7x2ab-t1",
        from: "Intake",
        to: "Intake",
        at: "2026-09-07T12:00:00.000Z",
        actor: "system",
        message: "isolation created branch=issue-412-x",
        meta: {
          isolation: {
            branch: "issue-412-x",
            baseBranch: "main",
            worktreePath: "/r/.worktrees/issue-412-x",
            repoRoot: "/r",
            state: "created",
            createdAt: "2026-09-07T12:00:00.000Z",
          },
        },
      },
    ],
  });
  assert.equal(effectiveWorktreeFor(job), "/r/.worktrees/issue-412-x");
  assert.deepEqual(readIsolationFromTimeline(job.timeline)?.branch, "issue-412-x");
});

test("resolver: memory beats a stale timeline record", () => {
  const job = baseJob({
    isolation: {
      branch: "issue-412-new",
      baseBranch: "main",
      worktreePath: "/r/.worktrees/issue-412-new",
      repoRoot: "/r",
      state: "created",
      createdAt: "2026-09-07T12:00:00.000Z",
    },
    timeline: [
      {
        id: "t",
        from: "Intake",
        to: "Intake",
        at: "2026-09-07T12:00:00.000Z",
        actor: "system",
        message: "old",
        meta: {
          isolation: {
            branch: "issue-412-old",
            baseBranch: "main",
            worktreePath: "/r/.worktrees/issue-412-old",
            repoRoot: "/r",
          },
        },
      },
    ],
  });
  assert.equal(effectiveWorktreeFor(job), "/r/.worktrees/issue-412-new");
});

// ── PR text ──

test("pr body carries Closes #N with title", () => {
  const body = buildPrBody(412, "Fix kanban count");
  assert.ok(body.includes("Closes #412"));
  assert.ok(body.includes("Fix kanban count"));
});

test("pr body carries Closes #N without title", () => {
  const body = buildPrBody(7);
  assert.ok(body.includes("Closes #7"));
  assert.ok(body.includes("Resolve issue #7"));
});

test("pr title shape", () => {
  assert.equal(buildPrTitle(412, "Fix kanban count"), "Resolve issue #412 — Fix kanban count");
  assert.equal(buildPrTitle(412), "Resolve issue #412");
});

// ── prGuard (once per job) ──

test("guard: clean job never opened", () => {
  assert.deepEqual(prGuard(baseJob()), { opened: false });
});

test("guard: timeline pr meta survives a restart (durable path)", () => {
  const job = baseJob({
    timeline: [
      {
        id: "t0",
        from: "Intake",
        to: "Intake",
        at: "2026-09-07T12:00:00.000Z",
        actor: "system",
        message: "created",
      },
      {
        id: "t9",
        from: "Review",
        to: "Complete",
        at: "2026-09-07T13:00:00.000Z",
        actor: "system",
        message: "pr opened #418 https://github.com/o/r/pull/418",
        meta: { pr: { prNumber: 418, prUrl: "https://github.com/o/r/pull/418" } },
      },
    ],
  });
  const got = prGuard(job);
  assert.equal(got.opened, true);
  if (got.opened) {
    assert.equal(got.prNumber, 418);
    assert.equal(got.prUrl, "https://github.com/o/r/pull/418");
  }
  assert.deepEqual(readPrFromTimeline(job.timeline)?.prNumber, 418);
});

test("guard: memory pr-open state short-circuits", () => {
  const job = baseJob({
    isolation: {
      branch: "issue-412-x",
      baseBranch: "main",
      worktreePath: "/r/.worktrees/issue-412-x",
      repoRoot: "/r",
      prNumber: 418,
      prUrl: "https://github.com/o/r/pull/418",
      state: "pr-open",
      createdAt: "2026-09-07T12:00:00.000Z",
    },
  });
  const got = prGuard(job);
  assert.equal(got.opened, true);
});

test("guard: pr error meta does not count as opened", () => {
  const job = baseJob({
    timeline: [
      {
        id: "t9",
        from: "Review",
        to: "Complete",
        at: "2026-09-07T13:00:00.000Z",
        actor: "system",
        message: "pr open failed",
        meta: { pr: { error: "gh not found" } },
      },
    ],
  });
  assert.deepEqual(prGuard(job), { opened: false });
  assert.equal(readPrFromTimeline(job.timeline), null);
});

// ── DELETE guards matrix ──

test("delete guards: non-terminal always refuses (force cannot override)", () => {
  for (const status of ["Intake", "Foreman", "Building", "Review"]) {
    for (const force of [false, true]) {
      const v = decideWorktreeDelete({
        status,
        hasIsolation: true,
        prState: "merged",
        dirty: false,
        force,
      });
      assert.deepEqual(v.ok, false, `${status} force=${force}`);
    }
  }
});

test("delete guards: missing isolation refuses", () => {
  assert.deepEqual(
    decideWorktreeDelete({
      status: "Complete",
      hasIsolation: false,
      prState: "merged",
      dirty: false,
    }).ok,
    false,
  );
});

test("delete guards: merged/closed PR on a terminal job passes when clean", () => {
  for (const prState of ["merged", "closed"] as const) {
    assert.deepEqual(
      decideWorktreeDelete({
        status: "Complete",
        hasIsolation: true,
        prState,
        dirty: false,
      }),
      { ok: true },
    );
  }
  assert.deepEqual(
    decideWorktreeDelete({
      status: "Cancelled",
      hasIsolation: true,
      prState: "closed",
      dirty: false,
    }),
    { ok: true },
  );
});

test("delete guards: open PR refuses without force, passes with force", () => {
  assert.deepEqual(
    decideWorktreeDelete({
      status: "Complete",
      hasIsolation: true,
      prState: "open",
      dirty: false,
    }).ok,
    false,
  );
  assert.deepEqual(
    decideWorktreeDelete({
      status: "Complete",
      hasIsolation: true,
      prState: "open",
      dirty: false,
      force: true,
    }),
    { ok: true },
  );
});

test("delete guards: unknown/absent PR refuses without force, passes with force", () => {
  for (const prState of ["unknown", "none"] as const) {
    assert.deepEqual(
      decideWorktreeDelete({
        status: "Complete",
        hasIsolation: true,
        prState,
        dirty: false,
      }).ok,
      false,
      prState,
    );
    assert.deepEqual(
      decideWorktreeDelete({
        status: "Complete",
        hasIsolation: true,
        prState,
        dirty: false,
        force: true,
      }),
      { ok: true },
      `${prState}+force`,
    );
  }
});

test("delete guards: dirty refuses without force, passes with force", () => {
  assert.deepEqual(
    decideWorktreeDelete({
      status: "Complete",
      hasIsolation: true,
      prState: "merged",
      dirty: true,
    }).ok,
    false,
  );
  assert.deepEqual(
    decideWorktreeDelete({
      status: "Complete",
      hasIsolation: true,
      prState: "merged",
      dirty: true,
      force: true,
    }),
    { ok: true },
  );
});

// ── DELETE path parse ──

test("delete path: canonical shape parses", () => {
  assert.deepEqual(parseWorktreeDeletePath("/factory/jobs/job-mtk1/worktree"), {
    id: "job-mtk1",
  });
});

test("delete path: traversal + malformed shapes rejected", () => {
  const bad = [
    "/factory/jobs/../worktree",
    "/factory/jobs/./worktree",
    "/factory/jobs//worktree",
    "/factory/jobs/job-mtk1",
    "/factory/jobs/job-mtk1/worktree/extra",
    "/work-items/job-mtk1/worktree",
    "/factory/jobs/review/worktree",
    "",
  ];
  for (const p of bad) {
    const got = parseWorktreeDeletePath(p);
    assert.ok("error" in got, `accepted: ${p}`);
  }
});

// ── Prompt title parse ──

test("prompt title: resolve line parses, junk yields null", () => {
  assert.equal(
    parseIssueTitleFromPrompt("# Resolve issue #412 — Fix kanban count", 412),
    "Fix kanban count",
  );
  assert.equal(parseIssueTitleFromPrompt("do things", 412), null);
  assert.equal(
    parseIssueTitleFromPrompt("# Resolve issue #999 — Other", 412),
    null,
  );
  assert.equal(parseIssueTitleFromPrompt(null, 412), null);
});

// ── Isolation schema (frozen §4 contract) ──

test("schema: full record parses", () => {
  const got = IsolationSchema.safeParse({
    branch: "issue-412-fix-kanban-count",
    baseBranch: "main",
    worktreePath: "C:/repo/termcanvas/.worktrees/issue-412-fix-kanban-count",
    repoRoot: "C:/repo/termcanvas",
    prNumber: 418,
    prUrl: "https://github.com/owner/repo/pull/418",
    state: "pr-open",
    createdAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(got.success, true);
});

test("schema: prUrl without prNumber is rejected", () => {
  const got = IsolationSchema.safeParse({
    branch: "issue-412-x",
    baseBranch: "main",
    worktreePath: "/r/.worktrees/issue-412-x",
    repoRoot: "/r",
    prUrl: "https://github.com/o/r/pull/418",
    state: "pr-open",
    createdAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(got.success, false);
});

test("schema: empty branch rejected, minimal created record parses", () => {
  const bad = IsolationSchema.safeParse({
    branch: "",
    baseBranch: "main",
    worktreePath: "/r/.worktrees/x",
    repoRoot: "/r",
    state: "created",
    createdAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(bad.success, false);
  const good = IsolationSchema.safeParse({
    branch: "issue-412-x",
    baseBranch: "main",
    worktreePath: "/r/.worktrees/issue-412-x",
    repoRoot: "/r",
    state: "created",
    createdAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(good.success, true);
});

// ── Exec-level honesty (injected fakes, zero network) ──

type FakeCalls = Array<{ cmd: string; args: readonly string[] }>;

function fakeGit(scenarios: Record<string, { stdout?: string; error?: string }>) {
  const calls: FakeCalls = [];
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    calls.push({ cmd, args });
    const key = `${cmd} ${args[0] as string} ${args[1] as string}`;
    const hit =
      scenarios[key] ??
      scenarios[`${cmd} ${args[0] as string}`] ??
      scenarios[cmd];
    if (!hit || hit.error) throw new Error(hit?.error ?? `unexpected: ${key}`);
    return { stdout: hit.stdout ?? "", stderr: "" };
  };
  return { calls, run };
}

/** Stub de excludes locales: nunca toca el fs real, deja inspeccionar. */
function fakeExcludes(prev: string | null = null) {
  const writes: Array<{ file: string; content: string }> = [];
  return {
    writes,
    readTextFile: (_file: string): string | null => prev,
    writeTextFile: (file: string, content: string): void => {
      writes.push({ file, content });
    },
  };
}

test("exec: attach when the worktree is already registered (no add call)", async () => {
  const root = path.join(path.sep, "repo", "termcanvas");
  const wt = path.join(root, ".worktrees", "issue-7-x");
  const { calls, run } = fakeGit({
    "git rev-parse": { stdout: `${root}\n` },
    "git worktree": { stdout: `worktree ${wt}\n\nbranch refs/heads/issue-7-x\n` },
  });
  const excl = fakeExcludes();
  const got = await ensureIsolatedWorktree({
    repoAnchor: root,
    issueNumber: 7,
    title: "X",
    jobId: "job-attach-1",
    run,
    readTextFile: excl.readTextFile,
    writeTextFile: excl.writeTextFile,
  });
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.attached, true);
    assert.equal(got.worktreePath, wt);
  }
  assert.ok(
    calls.every((c) => !(c.args.includes("add") && c.args[0] === "worktree")),
    "no worktree add on attach",
  );
  // Los excludes locales también se aseguran al anexar (idempotente).
  assert.equal(excl.writes.length, 1);
  assert.ok(excl.writes[0]?.file.endsWith(`${path.sep}info${path.sep}exclude`));
  assert.ok(excl.writes[0]?.content.includes(".agents/"));
});

test("exec: creates with -b on the base branch when nothing exists", async () => {
  const root = path.join(path.sep, "repo", "termcanvas");
  const { calls, run } = fakeGit({
    "git rev-parse": { stdout: `${root}\n` },
    "git worktree": { stdout: "worktree /other\n" },
  });
  // rev-parse --verify probes throw (branch absent) then add succeeds.
  const probing = async (
    cmd: string,
    args: readonly string[],
    opts: { cwd: string; timeoutMs: number },
  ) => {
    if (args.includes("--verify")) throw new Error("unknown revision");
    return run(cmd, args, opts);
  };
  const got = await ensureIsolatedWorktree({
    repoAnchor: root,
    issueNumber: 9,
    title: "New thing",
    baseBranch: "main",
    jobId: "job-create-1",
    run: probing,
    readTextFile: () => null,
    writeTextFile: () => {},
  });
  assert.equal(got.ok, true);
  const adds = calls.filter((c) => c.args[0] === "worktree" && c.args[1] === "add");
  assert.equal(adds.length, 1);
  assert.ok(adds[0]?.args.includes("-b"));
  assert.ok(adds[0]?.args.includes("main"));
});

test("exec: fresh worktree gets local excludes (.agents/logs/*.log, never committed)", async () => {
  const root = path.join(path.sep, "repo", "termcanvas");
  const { run } = fakeGit({
    "git rev-parse": { stdout: `${root}\n` },
    "git worktree": { stdout: "worktree /other\n" },
  });
  const probing = async (
    cmd: string,
    args: readonly string[],
    opts: { cwd: string; timeoutMs: number },
  ) => {
    if (args.includes("--verify")) throw new Error("unknown revision");
    return run(cmd, args, opts);
  };
  const excl = fakeExcludes();
  const got = await ensureIsolatedWorktree({
    repoAnchor: root,
    issueNumber: 10,
    title: "Thing",
    baseBranch: "main",
    jobId: "job-create-excl",
    run: probing,
    readTextFile: excl.readTextFile,
    writeTextFile: excl.writeTextFile,
  });
  assert.equal(got.ok, true);
  assert.equal(excl.writes.length, 1);
  const content = excl.writes[0]?.content ?? "";
  assert.ok(content.includes("termcanvas-factory local excludes"));
  assert.ok(content.includes(".agents/"));
  assert.ok(content.includes("logs/"));
  assert.ok(content.includes("*.log"));
});

test("exec: local excludes are idempotent (marker present → no write)", async () => {
  const root = path.join(path.sep, "repo", "termcanvas");
  const { run } = fakeGit({
    "git rev-parse": { stdout: `${root}\n` },
    "git worktree": { stdout: "worktree /other\n" },
  });
  const probing = async (
    cmd: string,
    args: readonly string[],
    opts: { cwd: string; timeoutMs: number },
  ) => {
    if (args.includes("--verify")) throw new Error("unknown revision");
    return run(cmd, args, opts);
  };
  const excl = fakeExcludes("# termcanvas-factory local excludes\n.agents/\n");
  const got = await ensureIsolatedWorktree({
    repoAnchor: root,
    issueNumber: 11,
    title: "Thing",
    baseBranch: "main",
    jobId: "job-create-excl-idem",
    run: probing,
    readTextFile: excl.readTextFile,
    writeTextFile: excl.writeTextFile,
  });
  assert.equal(got.ok, true);
  assert.equal(excl.writes.length, 0);
});

test("exec: failure is honest (ok:false, sliced error, never throws)", async () => {
  const run = async () => {
    throw new Error("git: command not found ".padEnd(500, "x"));
  };
  const got = await ensureIsolatedWorktree({
    repoAnchor: "/nope",
    issueNumber: 3,
    jobId: "job-fail-1",
    run,
  });
  assert.equal(got.ok, false);
  if (!got.ok) {
    assert.ok(got.error.length > 0);
    assert.ok(got.error.length <= 200);
  }
});

test("exec: concurrent ensure per job id collapses (1 worktree/job)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const run = async (
    cmd: string,
    _args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    if (cmd === "git") await gate;
    return { stdout: "/r\n", stderr: "" };
  };
  const first = ensureIsolatedWorktree({
    repoAnchor: "/r",
    issueNumber: 11,
    jobId: "job-dupe-1",
    run,
    readTextFile: () => null,
    writeTextFile: () => {},
  });
  const second = await ensureIsolatedWorktree({
    repoAnchor: "/r",
    issueNumber: 11,
    jobId: "job-dupe-1",
    run,
    readTextFile: () => null,
    writeTextFile: () => {},
  });
  assert.equal(second.ok, false);
  release();
  const done = await first;
  assert.equal(done.ok, true);
});

test("exec: remove drops the folder only (branch never deleted)", async () => {
  const { calls, run } = fakeGit({ git: { stdout: "" } });
  const got = await removeIsolatedWorktree({
    worktreePath: "/r/.worktrees/issue-5-x",
    run,
  });
  assert.deepEqual(got, { ok: true, path: "/r/.worktrees/issue-5-x" });
  const flat = calls.flatMap((c) => [...c.args]);
  assert.ok(!flat.includes("branch"));
  assert.ok(!flat.some((a) => a === "-D" || a === "--delete"));
});

test("exec: dirty check reads porcelain", async () => {
  const { run: cleanRun } = fakeGit({ git: { stdout: "\n" } });
  assert.deepEqual(await isWorkingTreeDirty({ worktreePath: "/r/wt", run: cleanRun }), {
    ok: true,
    dirty: false,
  });
  const { run: dirtyRun } = fakeGit({ git: { stdout: " M file.ts\n" } });
  assert.deepEqual(await isWorkingTreeDirty({ worktreePath: "/r/wt", run: dirtyRun }), {
    ok: true,
    dirty: true,
  });
});

test("exec: openPr pushes once then creates with Closes body (no merge primitive)", async () => {
  const { calls, run } = fakeGit({
    git: { stdout: "" },
    gh: { stdout: "https://github.com/owner/repo/pull/418\n" },
  });
  const written: Array<{ file: string; body: string }> = [];
  const got = await openPrForJob({
    repoPath: "/r/.worktrees/issue-412-x",
    branch: "issue-412-x",
    baseBranch: "main",
    issueNumber: 412,
    title: "Fix kanban count",
    run,
    writeBodyFile: (file, body) => {
      written.push({ file, body });
    },
    unlinkBodyFile: () => {},
  });
  assert.deepEqual(got, {
    ok: true,
    prNumber: 418,
    prUrl: "https://github.com/owner/repo/pull/418",
  });
  // Empty-branch pre-check runs first (`git rev-list --count main..branch`;
  // the generic `git` fake returns "" → unparseable → null → fail-open to
  // the push/PR attempt below).
  const probes = calls.filter((c) => c.cmd === "git" && c.args[0] === "rev-list");
  assert.equal(probes.length, 1);
  const pushes = calls.filter((c) => c.cmd === "git" && c.args[0] === "push");
  assert.equal(pushes.length, 1);
  assert.deepEqual([...(pushes[0]?.args ?? [])], ["push", "-u", "origin", "issue-412-x"]);
  const creates = calls.filter((c) => c.cmd === "gh");
  // PR create + best-effort `pr edit --add-label review:pendiente` (fix #69:
  // el PR de factory nace etiquetado para que el panel lo derive sin watcher).
  assert.equal(creates.length, 2);
  const ghArgs = [...(creates[0]?.args ?? [])];
  assert.deepEqual(ghArgs.slice(0, 2), ["pr", "create"]);
  assert.ok(!ghArgs.some((a) => a.includes("merge")));
  const labelCall = creates[1];
  assert.deepEqual([...(labelCall?.args ?? [])].slice(0, 2), ["pr", "edit"]);
  assert.ok((labelCall?.args ?? []).some((a) => String(a).includes("review:pendiente")));
  assert.equal(written.length, 1);
  assert.ok(written[0]?.body.includes("Closes #412"));
  const bodyIdx = ghArgs.indexOf("--body-file");
  assert.ok(bodyIdx >= 0 && ghArgs[bodyIdx + 1] === written[0]?.file);
});

test("exec: push failure is honest with a manual hint", async () => {
  const run = async (cmd: string) => {
    if (cmd === "git") throw new Error("rejected: no permission");
    return { stdout: "", stderr: "" };
  };
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-1-x",
    baseBranch: "main",
    issueNumber: 1,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.equal(got.ok, false);
  if (!got.ok) {
    assert.ok(got.error.includes("push failed"));
    assert.ok(got.manualHint.includes("git push -u origin issue-1-x"));
  }
});

test("exec: readPrState normalizes gh states", async () => {
  for (const [raw, want] of [
    ["OPEN", "open"],
    ["MERGED", "merged"],
    ["CLOSED", "closed"],
    ["WEIRD", "unknown"],
  ] as const) {
    const { run } = fakeGit({
      gh: { stdout: JSON.stringify({ state: raw, number: 3, url: "u" }) },
    });
    const got = await readPrState({ repoPath: "/r", branch: "issue-3-x", run });
    assert.equal(got.ok, true);
    if (got.ok) assert.equal(got.state, want);
  }
  const { run: badRun } = fakeGit({ gh: { stdout: "not json" } });
  assert.equal((await readPrState({ repoPath: "/r", branch: "b", run: badRun })).ok, false);
});

// ── Timeout constants (§8 / LOOPS.md G01–G04) ──

test("bounds: timeout constants carry the §8 values", () => {
  assert.equal(GIT_WORKTREE_ADD_TIMEOUT_MS, 30000);
  assert.equal(GIT_PROBE_TIMEOUT_MS, 10000);
  assert.equal(GIT_PUSH_TIMEOUT_MS, 30000);
  assert.equal(GIT_REV_LIST_TIMEOUT_MS, 10000);
  assert.equal(GIT_STATUS_TIMEOUT_MS, 10000);
  assert.equal(GIT_COMMIT_TIMEOUT_MS, 15000);
  assert.equal(GH_PR_CREATE_TIMEOUT_MS, 30000);
  assert.equal(GH_PR_VIEW_TIMEOUT_MS, 15000);
});

// ── Empty-branch pre-check (item 3, job-mtqqz1fz-ntis / issue #60) ──
// Live evidence: branch `issue-60-todo-item-disappears-after-page-reload`
// has 0 commits vs `main` (read-only `rev-list --count` = 0, no PR on
// record) because the implement wrote 0 deliverable files (createdFiles
// dropped H-001/H-012). Push succeeded but `gh pr create` failed with the
// cryptic truncated `pr create failed: Command failed: gh pr create …`.
// The honest fix is a pre-check: 0 commits vs base → no push/PR attempt,
// honest `nothing to propose` event + manual CTA, never an invented PR URL.

test("pre-check: zero commits vs base reports nothing-to-propose without push/pr", async () => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    calls.push({ cmd, args });
    if (cmd === "git" && args[0] === "rev-list") {
      return { stdout: "0\n", stderr: "" };
    }
    if (cmd === "git" && args[0] === "status") {
      return { stdout: "", stderr: "" };
    }
    throw new Error(`must not be called: ${cmd} ${args.join(" ")}`);
  };
  const got = await openPrForJob({
    repoPath: "/r/.worktrees/issue-60-x",
    branch: "issue-60-todo-item-disappears-after-page-reload",
    baseBranch: "main",
    issueNumber: 60,
    run,
    writeBodyFile: () => {
      throw new Error("must not write a PR body for an empty branch");
    },
    unlinkBodyFile: () => {},
  });
  assert.equal(got.ok, false);
  if (!got.ok) {
    assert.match(got.error, /nothing to propose/);
    assert.match(got.error, /no commits vs/);
    assert.ok(got.manualHint.includes("git push -u origin"));
    assert.ok(got.manualHint.includes("gh pr create"));
    // No PR URL is ever invented on this path.
    assert.ok(!got.error.includes("http"));
  }
  // Only read-only probes ran (rev-list + status) — no push, no gh.
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.cmd, "git");
  assert.ok((calls[0]?.args ?? []).includes("rev-list"));
  assert.equal(calls[1]?.cmd, "git");
  assert.ok((calls[1]?.args ?? []).includes("status"));
});

test("pre-check: non-empty branch proceeds to push + pr create", async () => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    calls.push({ cmd, args });
    if (cmd === "git" && args[0] === "rev-list") {
      return { stdout: "3\n", stderr: "" };
    }
    if (cmd === "git") return { stdout: "", stderr: "" };
    if (cmd === "gh") {
      return { stdout: "https://github.com/o/r/pull/61\n", stderr: "" };
    }
    throw new Error(`unexpected: ${cmd}`);
  };
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-60-x",
    baseBranch: "main",
    issueNumber: 60,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.deepEqual(got, {
    ok: true,
    prNumber: 61,
    prUrl: "https://github.com/o/r/pull/61",
  });
  assert.ok(calls.some((c) => c.cmd === "git" && c.args[0] === "push"));
  assert.ok(calls.some((c) => c.cmd === "gh"));
});

test("pre-check: probe failure fails open to the push/pr attempt", async () => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    calls.push({ cmd, args });
    if (cmd === "git" && args[0] === "rev-list") {
      throw new Error("unknown revision");
    }
    if (cmd === "git") return { stdout: "", stderr: "" };
    if (cmd === "gh") {
      return { stdout: "https://github.com/o/r/pull/62\n", stderr: "" };
    }
    throw new Error(`unexpected: ${cmd}`);
  };
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-60-x",
    baseBranch: "main",
    issueNumber: 60,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.equal(got.ok, true);
});

test("pre-check: count helper parses bare integers, null on junk/failure", async () => {
  const okRun = async () => ({ stdout: " 12\n", stderr: "" });
  assert.equal(
    await countBranchCommitsVsBase({
      repoPath: "/r",
      branch: "issue-1-x",
      baseBranch: "main",
      run: okRun,
    }),
    12,
  );
  const junkRun = async () => ({ stdout: "abc\n", stderr: "" });
  assert.equal(
    await countBranchCommitsVsBase({
      repoPath: "/r",
      branch: "b",
      baseBranch: "main",
      run: junkRun,
    }),
    null,
  );
  const failRun = async () => {
    throw new Error("nope");
  };
  assert.equal(
    await countBranchCommitsVsBase({
      repoPath: "/r",
      branch: "b",
      baseBranch: "main",
      run: failRun,
    }),
    null,
  );
  assert.equal(
    await countBranchCommitsVsBase({
      repoPath: "",
      branch: "b",
      baseBranch: "main",
      run: okRun,
    }),
    null,
  );
});

// ── Orquestador commitea (ningún prompt LLM pide jamás commit/push/PR) ──

test("exec: dirty worktree → add+commit del sistema antes de push+pr", async () => {
  const { calls, run } = fakeGit({
    "git rev-list": { stdout: "0\n" },
    "git status": { stdout: " M src/a.ts\n" },
    "git add": { stdout: "" },
    "git -c": { stdout: "[issue-9-x abc1234] factory: implement\n" },
    "git push": { stdout: "" },
    gh: { stdout: "https://github.com/o/r/pull/9\n" },
  });
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-9-x",
    baseBranch: "main",
    issueNumber: 9,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.deepEqual(got, {
    ok: true,
    prNumber: 9,
    prUrl: "https://github.com/o/r/pull/9",
  });
  const kinds = calls.map((c) => (c.args[0] === "-c" ? "git commit" : `${c.cmd} ${c.args[0] as string}`));
  assert.deepEqual(kinds, [
    "git rev-list",
    "git status",
    "git add",
    "git commit",
    "git push",
    "gh pr",
    "gh pr",
  ]);
  const commit = calls.find((c) => c.args[0] === "-c");
  assert.ok(commit !== undefined);
  const cargs = [...(commit?.args ?? [])];
  assert.ok(cargs.includes("factory: implement issue #9 (handoff)"));
  assert.ok(cargs.includes("user.name=termcanvas-factory"));
});

// ── Commit selectivo (fix PRs +1M líneas: node_modules/logs/.agents/dist fuera) ──

test("commit: isCommittablePath excluye ruido y acepta código", async () => {
  const { isCommittablePath, parsePorcelainPaths } = await import(
    "../headless-runtime/factory/isolation/gitHubPr.ts"
  );
  for (const junk of [
    "node_modules/react/index.js",
    "node_modules/.package-lock.json",
    "logs/build.log",
    "logs/reverify.log",
    "debug.log",
    ".agents/factory/job-x/logs/build.log",
    ".agents/factory/job-x/job.json",
    "dist/app.js",
    "dist-electron/main.js",
    ".worktrees/issue-1-x/a.ts",
    "package-lock.json",
    "pnpm-lock.yaml",
    "",
    "../escape.ts",
  ]) {
    assert.equal(isCommittablePath(junk), false, junk || "(vacío)");
  }
  for (const ok of ["src/a.ts", "tests/a.test.ts", "package.json", "README.md"]) {
    assert.equal(isCommittablePath(ok), true, ok);
  }
  assert.deepEqual(
    parsePorcelainPaths(' M src/a.ts\n?? node_modules/x.js\nR  old.ts -> new.ts\n'),
    ["src/a.ts", "node_modules/x.js", "new.ts"],
  );
  assert.deepEqual(parsePorcelainPaths(null), []);
});

test("exec: commit selectivo deja fuera node_modules/logs (sin -A ciego)", async () => {
  const { calls, run } = fakeGit({
    "git status": {
      stdout: " M src/a.ts\n?? node_modules/react/index.js\n?? logs/build.log\n?? .agents/factory/job-x/job.json\n",
    },
    "git add": { stdout: "" },
    "git -c": { stdout: "[issue-9-x abc1234] factory: implement\n" },
  });
  const { commitWorktreeChanges } = await import(
    "../headless-runtime/factory/isolation/gitHubPr.ts"
  );
  const got = await commitWorktreeChanges({
    repoPath: "/r/wt",
    issueNumber: 9,
    run,
    knownStatus: " M src/a.ts\n?? node_modules/react/index.js\n?? logs/build.log\n?? .agents/factory/job-x/job.json\n",
  });
  assert.equal(got.ok, true);
  const adds = calls.filter((c) => c.cmd === "git" && c.args[0] === "add");
  assert.equal(adds.length, 1);
  const addArgs = [...(adds[0]?.args ?? [])];
  assert.ok(!addArgs.includes("-A"), "nunca add -A ciego con status conocido");
  assert.ok(addArgs.includes("src/a.ts"));
  assert.ok(!addArgs.some((a) => String(a).includes("node_modules")));
  assert.ok(!addArgs.some((a) => String(a).includes("logs")));
  assert.ok(!addArgs.some((a) => String(a).includes(".agents")));
});

test("exec: commit todo-excluido es honesto (ok:false, sin commit)", async () => {
  const { calls, run } = fakeGit({ git: { stdout: "" } });
  const { commitWorktreeChanges } = await import(
    "../headless-runtime/factory/isolation/gitHubPr.ts"
  );
  const got = await commitWorktreeChanges({
    repoPath: "/r/wt",
    issueNumber: 9,
    run,
    knownStatus: "?? node_modules/a.js\n?? logs/build.log\n",
  });
  assert.equal(got.ok, false);
  if (!got.ok) assert.ok(got.error.includes("nothing committable"));
  assert.ok(
    calls.every((c) => c.args[0] !== "-c"),
    "sin commit cuando no hay nada commiteable",
  );
});

test("exec: commit fallido es honesto con hint manual (sin push)", async () => {
  const { calls, run } = fakeGit({
    "git rev-list": { stdout: "0\n" },
    "git status": { stdout: " M src/a.ts\n" },
    "git add": { stdout: "" },
    "git -c": { error: "rejected: gpg failed" },
  });
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-9-x",
    baseBranch: "main",
    issueNumber: 9,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.equal(got.ok, false);
  if (!got.ok) {
    assert.match(got.error, /commit failed/);
    assert.ok(got.manualHint.includes("gh pr create"));
  }
  assert.ok(!calls.some((c) => c.args[0] === "push"));
});

test("exec: commitWorktreeChanges valida entradas", async () => {
  const { run } = fakeGit({});
  assert.equal((await commitWorktreeChanges({ repoPath: "", issueNumber: 1, run })).ok, false);
  assert.equal((await commitWorktreeChanges({ repoPath: "/r", issueNumber: 0, run })).ok, false);
  assert.equal(await readWorktreeStatusPorcelain({ repoPath: "", run }), null);
});

function gateJob(id: string, status: string, isolation?: Record<string, unknown>): void {
  try {
    workItemStore.clear();
  } catch {}
  const created = workItemStore.create({ id, prompt: "p", worktree: "C:/tmp/gate" });
  const chain: Array<"Foreman" | "Building" | "Review" | "Complete"> = ["Foreman", "Building", "Review"];
  chain.forEach((s, i) => {
    try {
      workItemStore.transition(created.id, s, "system", `t${i}`);
    } catch {}
  });
  if (status === "Complete") {
    try {
      workItemStore.transition(created.id, "Complete", "system", "t4");
    } catch {}
  }
  if (isolation !== undefined) {
    try {
      (workItemStore.get(id) as unknown as Record<string, unknown>).isolation = isolation;
    } catch {}
  }
}

test("gate: rama vacia + limpio bloquea el accept con evento honesto", async () => {
  gateJob("job-gate-empty01", "Review", {
    branch: "issue-1-x",
    baseBranch: "main",
    worktreePath: "C:/tmp/gate-wt",
    repoRoot: "C:/tmp/gate",
    state: "created",
  });
  const run = async (cmd: string, args: readonly string[]) => {
    if (cmd === "git" && args[0] === "rev-list") return { stdout: "0\n", stderr: "" };
    if (cmd === "git" && args[0] === "status") return { stdout: "", stderr: "" };
    throw new Error(`unexpected: ${cmd}`);
  };
  const got = await gateAcceptOnBranchDiff("job-gate-empty01", run);
  assert.equal(got.ok, false);
  if (!got.ok) assert.match(got.error, /accept bloqueado/);
  const events = workItemStore.get("job-gate-empty01")?.timeline ?? [];
  assert.ok(events.some((e) => e.message.startsWith("accept bloqueado:")));
  assert.equal(workItemStore.get("job-gate-empty01")?.status, "Review");
  workItemStore.clear();
});

test("gate: trabajo sucio o commits permiten el accept (fail-open honesto)", async () => {
  gateJob("job-gate-dirty01", "Review", {
    branch: "issue-2-x",
    baseBranch: "main",
    worktreePath: "C:/tmp/gate-wt",
    repoRoot: "C:/tmp/gate",
    state: "created",
  });
  const dirtyRun = async (cmd: string, args: readonly string[]) => {
    if (cmd === "git" && args[0] === "rev-list") return { stdout: "0\n", stderr: "" };
    if (cmd === "git" && args[0] === "status") return { stdout: " M a.ts\n", stderr: "" };
    throw new Error(`unexpected: ${cmd}`);
  };
  assert.deepEqual(await gateAcceptOnBranchDiff("job-gate-dirty01", dirtyRun), { ok: true });
  gateJob("job-gate-ahead01", "Review", {
    branch: "issue-3-x",
    baseBranch: "main",
    worktreePath: "C:/tmp/gate-wt",
    repoRoot: "C:/tmp/gate",
    state: "created",
  });
  const aheadRun = async (cmd: string, args: readonly string[]) => {
    if (cmd === "git" && args[0] === "rev-list") return { stdout: "2\n", stderr: "" };
    if (cmd === "git" && args[0] === "status") return { stdout: "", stderr: "" };
    throw new Error(`unexpected: ${cmd}`);
  };
  assert.deepEqual(await gateAcceptOnBranchDiff("job-gate-ahead01", aheadRun), { ok: true });
  // Sin aislamiento o fuera de Review: el gate no pisa nada.
  gateJob("job-gate-noiso01", "Review");
  assert.deepEqual(await gateAcceptOnBranchDiff("job-gate-noiso01", dirtyRun), { ok: true });
  gateJob("job-gate-norev01", "Complete", {
    branch: "issue-4-x",
    baseBranch: "main",
    worktreePath: "C:/tmp/gate-wt",
    repoRoot: "C:/tmp/gate",
    state: "created",
  });
  assert.deepEqual(await gateAcceptOnBranchDiff("job-gate-norev01", dirtyRun), { ok: true });
  workItemStore.clear();
});
