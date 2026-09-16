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
  cleanDetailUrl,
  decideWorktreeDelete,
  effectiveWorktreeFor,
  extractDispositions,
  extractNotVerified,
  extractReportSection,
  isPactIsolationJob,
  parseIssueTitleFromPrompt,
  parseWorktreeDeletePath,
  prGuard,
  readIsolationFromTimeline,
  readPrFromTimeline,
  reportIntro,
  sanitizeIsolationIssueRef,
  shouldIsolate,
  slugifyIssueTitle,
} from "../headless-runtime/factory/isolation/isolationStore.ts";
import { buildPrDetailsFromJob } from "../headless-runtime/factory/isolation/gitHubPr.ts";
import {
  ensureIsolatedWorktree,
  isWorkingTreeDirty,
  removeIsolatedWorktree,
  GIT_PROBE_TIMEOUT_MS,
  GIT_WORKTREE_ADD_TIMEOUT_MS,
} from "../headless-runtime/factory/isolation/gitWorktree.ts";
import {
  checkReviewStale,
  commitWorktreeChanges,
  countBranchCommitsVsBase,
  gateAcceptOnBranchDiff,
  maybePublishReviewReportForJob,
  openPrForJob,
  publishReviewReport,
  readPrHead,
  readPrState,
  readReviewReportFromTimeline,
  readWorktreeStatusPorcelain,
  verifyCreatedPr,
  GIT_COMMIT_TIMEOUT_MS,
  GIT_PUSH_TIMEOUT_MS,
  GIT_REV_LIST_TIMEOUT_MS,
  GIT_STATUS_TIMEOUT_MS,
  GH_PR_CREATE_TIMEOUT_MS,
  GH_PR_VIEW_TIMEOUT_MS,
} from "../headless-runtime/factory/isolation/gitHubPr.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { buildReviewReport } from "../headless-runtime/review/reviewReport.ts";

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

// ── PR estilo guía de review (secciones Wirasm) ──

const IMPL_REPORT = [
  "Arreglado el parseo corrupto en `js/store.js`: try/catch + backup.",
  "Archivos: `js/store.js`, `tests/store.corrupt.test.js`.",
  "",
  "## Review guidance",
  "- Empezar por: `js/store.js:41` — el parseo con try/catch.",
  "- Orden de revisión sugerido: store, luego tests.",
  "- Zonas de baja atención: test de humo.",
  "- Riesgo conocido o incertidumbre: ninguno.",
  "- No verificado: nada pendiente.",
  "",
  "## Otro",
  "ruido posterior",
].join("\n");

test("extractReportSection: bloque por heading, case-insensitive, corta en el próximo", () => {
  const got = extractReportSection(IMPL_REPORT, ["review guidance"]);
  assert.ok(got.includes("js/store.js:41"), "contenido de la sección");
  assert.ok(!got.includes("ruido posterior"), "corta en el próximo heading");
  assert.equal(
    extractReportSection(IMPL_REPORT, ["guía de revisión"]),
    "",
    "sin alias inventados",
  );
  assert.equal(extractReportSection(IMPL_REPORT, []), "");
  assert.equal(extractReportSection(null, ["review guidance"]), "");
  assert.equal(extractReportSection("sin headings", ["review guidance"]), "");
});

test("reportIntro: solo lo previo al primer heading, recortado", () => {
  const intro = reportIntro(IMPL_REPORT, 1200);
  assert.ok(intro.includes("Arreglado el parseo"), "intro presente");
  assert.ok(!intro.includes("Empezar por"), "sin secciones");
  assert.equal(reportIntro(null), "");
});

test("extractNotVerified: línea explícita o Nothing material", () => {
  assert.equal(
    extractNotVerified("- No verificado: el edge del backup.\n- Otro: x"),
    "el edge del backup.",
  );
  assert.equal(
    extractNotVerified("- No verificado: nada pendiente."),
    "Nothing material.",
  );
  assert.equal(extractNotVerified("sin línea"), "");
  assert.equal(extractNotVerified(""), "");
});

test("pr body estilo guía: secciones solo con datos", () => {
  const body = buildPrBody(412, "Fix kanban count", {
    summary: "Review OK: el cambio cumple el issue.",
    reviewer: "opencode/big-pickle",
    implementReport: IMPL_REPORT,
    files: ["js/store.js"],
    verification: {
      overall: "pass",
      steps: [{ name: "test", command: "pnpm test", status: "pass" }],
    },
    branch: "issue-412-x",
    baseBranch: "main",
  });
  assert.ok(body.includes("## Problem and outcome"));
  assert.ok(body.includes("- **Issue:** #412"));
  assert.ok(body.includes("- **Outcome:** Review OK: el cambio cumple el issue."));
  assert.ok(body.includes("## Solution"));
  assert.ok(body.includes("## Review guidance"));
  assert.ok(body.includes("js/store.js:41"));
  assert.ok(body.includes("## Changed files"));
  assert.ok(body.includes("## Validation"));
  assert.ok(body.includes("- **Not verified:** Nothing material."));
  assert.ok(body.includes("## Delivery considerations"));
  assert.ok(body.includes("issue-412-x"));
  assert.ok(body.includes("Reviewed by `opencode/big-pickle`."));
  assert.ok(body.includes("Closes #412"));
});

test("pr body sin datos: solo problema honesto + Closes", () => {
  const body = buildPrBody(7);
  assert.ok(body.includes("## Problem and outcome"));
  assert.ok(body.includes("- **Issue:** #7"));
  assert.ok(!body.includes("## Solution"), "sin solución inventada");
  assert.ok(!body.includes("## Review guidance"));
  assert.ok(!body.includes("## Delivery considerations"));
  assert.ok(!body.includes("Nothing material"), "sin cobertura que no existe");
});

test("buildPrDetailsFromJob: implementReport alimenta solution/guidance", () => {
  const { details } = buildPrDetailsFromJob({
    lastReview: { summary: "Review OK", reviewerModel: "opencode/big-pickle" },
    timeline: [
      { meta: { implementReport: IMPL_REPORT } },
      { meta: { createdFiles: ["js/store.js"] } },
    ],
    isolation: { branch: "issue-412-x", baseBranch: "main" },
  });
  assert.equal(details.implementReport, IMPL_REPORT);
  assert.equal(details.branch, "issue-412-x");
  assert.equal(details.baseBranch, "main");
  const body = buildPrBody(412, "Fix", details);
  assert.ok(body.includes("## Review guidance"));
  assert.ok(body.includes("js/store.js:41"));
  assert.ok(body.includes("## Solution"));
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
  // el PR de factory nace etiquetado para que el panel lo derive sin watcher)
  // + best-effort lookups `pr view` (anti-duplicado previo y verificación
  // post-create P1: con este fake no-JSON fallan en parseo y se sigue).
  const sub = (c: { args: readonly string[] }): string =>
    String(c.args[1] ?? "");
  assert.equal(creates.filter((c) => sub(c) === "create").length, 1);
  const ghArgs = [...(creates.find((c) => sub(c) === "create")?.args ?? [])];
  assert.deepEqual(ghArgs.slice(0, 2), ["pr", "create"]);
  assert.ok(!ghArgs.some((a) => a.includes("merge")));
  const labelCall = creates.find((c) => sub(c) === "edit");
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
  // Only read-only probes ran (rev-list + status + best-effort gh view
  // anti-duplicado P1, que falla en este fake y sigue) — no push, no gh create.
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.cmd, "git");
  assert.ok((calls[0]?.args ?? []).includes("rev-list"));
  assert.equal(calls[1]?.cmd, "git");
  assert.ok((calls[1]?.args ?? []).includes("status"));
  assert.ok(!calls.some((c) => c.cmd === "git" && c.args[0] === "push"));
  assert.ok(!calls.some((c) => c.cmd === "gh" && c.args[1] === "create"));
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
    "gh pr",
    "git add",
    "git commit",
    "git push",
    "gh pr",
    "gh pr",
    "gh pr",
  ]);
  const commit = calls.find((c) => c.args[0] === "-c");
  assert.ok(commit !== undefined);
  const cargs = [...(commit?.args ?? [])];
  assert.ok(cargs.includes("factory: implement issue #9 (handoff)"));
  assert.ok(cargs.includes("user.name=termcanvas-factory"));
});

test("exec: PR con ' M js/app.js' commitea el path completo, no 's/app.js' (bug run #125)", async () => {
  const { calls, run } = fakeGit({
    "git rev-list": { stdout: "0\n" },
    "git status": { stdout: " M js/app.js\n" },
    "git add": { stdout: "" },
    "git -c": { stdout: "[issue-125-x abc1234] factory: implement\n" },
    "git push": { stdout: "" },
    gh: { stdout: "https://github.com/o/r/pull/125\n" },
  });
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-125-ux",
    baseBranch: "main",
    issueNumber: 125,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.equal(got.ok, true);
  const add = calls.find((c) => c.cmd === "git" && c.args[0] === "add");
  const addArgs = [...(add?.args ?? [])];
  assert.ok(
    addArgs.includes("js/app.js"),
    `git add con path completo: ${addArgs.join(" ")}`,
  );
  assert.ok(!addArgs.includes("s/app.js"), "nunca el path mutilado");
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
    // Ayudas de review del ciclo: jamás shipean aunque vivan en el worktree.
    "artifacts/scope.md",
    "scope.md",
    "plan.md",
    "triage.md",
    "discoveries.json",
    "discoveries.md",
    "review/report-round-1.md",
    "",
    "../escape.ts",
  ]) {
    assert.equal(isCommittablePath(junk), false, junk || "(vacío)");
  }
  for (const ok of ["src/a.ts", "tests/a.test.ts", "package.json", "README.md"]) {
    assert.equal(isCommittablePath(ok), true, ok);
  }
  // Estrechez: el filtro es raíz-exacta/prefijo review/ — homónimos en
  // subdirectorios de código siguen siendo commiteables.
  for (const ok of ["src/scope.md", "docs/review-guide.md", "src/artifacts/x.ts"]) {
    assert.equal(isCommittablePath(ok), true, ok);
  }
  assert.deepEqual(
    parsePorcelainPaths(' M src/a.ts\n?? node_modules/x.js\nR  old.ts -> new.ts\n'),
    ["src/a.ts", "node_modules/x.js", "new.ts"],
  );
  // Primera línea sin offset XY (trim() aguas arriba: `"M js/app.js"`): el
  // path sale completo, nunca mutilado a `"s/app.js"` (bug run #125).
  assert.deepEqual(
    parsePorcelainPaths("M js/app.js\n?? src/b.ts\n"),
    ["js/app.js", "src/b.ts"],
  );
  assert.deepEqual(parsePorcelainPaths(null), []);
});

test("status: readWorktreeStatusPorcelain preserva el offset XY de la primera línea", async () => {
  const { run } = fakeGit({
    "git status": { stdout: " M js/app.js\r\n?? src/b.ts\r\n" },
  });
  const status = await readWorktreeStatusPorcelain({ repoPath: "/r/wt", run });
  assert.equal(status, " M js/app.js\n?? src/b.ts");
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

test("exec: commit lleva body del job record; headline intacto sin body", async () => {
  const { calls, run } = fakeGit({
    "git status": { stdout: " M src/a.ts\n" },
    "git add": { stdout: "" },
    "git -c": { stdout: "[issue-9-x abc1234] factory: implement\n" },
  });
  const { commitWorktreeChanges } = await import(
    "../headless-runtime/factory/isolation/gitHubPr.ts"
  );
  const { summarizeDetailsForCommit: summarize } = await import(
    "../headless-runtime/factory/isolation/isolationStore.ts"
  );
  assert.equal(
    summarize({ summary: "Fixes the crash", files: ["src/a.ts"] }),
    "Fixes the crash\nFiles: src/a.ts",
  );
  assert.equal(summarize(null), "");
  const withBody = await commitWorktreeChanges({
    repoPath: "/r/wt",
    issueNumber: 9,
    run,
    knownStatus: " M src/a.ts\n",
    messageBody: "Fixes the crash\nFiles: src/a.ts",
  });
  assert.equal(withBody.ok, true);
  const commits = calls.filter((c) => c.cmd === "git" && c.args[0] === "-c");
  assert.equal(commits.length, 1);
  const mFlags = commits[0]?.args.filter((a) => a === "-m") ?? [];
  assert.equal(mFlags.length, 2);
  assert.ok(commits[0]?.args.includes("factory: implement issue #9 (handoff)"));
  assert.ok(commits[0]?.args.includes("Fixes the crash\nFiles: src/a.ts"));
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

// ── P1: PR estilo prp-pr (título outcome, validación honesta, links, anti-duplicado) ──

test("p1: título outcome-first en lenguaje de comportamiento", () => {
  assert.equal(
    buildPrTitle(412, "Fix kanban count", "El conteo del kanban ya suma bien\nsegunda línea"),
    "Resolve issue #412 — El conteo del kanban ya suma bien",
  );
  assert.equal(
    buildPrTitle(412, "Fix kanban count"),
    "Resolve issue #412 — Fix kanban count",
  );
  assert.equal(buildPrTitle(412, "", ""), "Resolve issue #412");
  assert.equal(buildPrTitle(412, null, null), "Resolve issue #412");
  const long = `x${"y".repeat(300)}`;
  assert.ok((buildPrTitle(1, "t", long).split("— ")[1] ?? "").length <= 120);
});

test("p1: cleanDetailUrl solo acepta http(s)", () => {
  assert.equal(cleanDetailUrl("https://github.com/o/r/issues/1"), "https://github.com/o/r/issues/1");
  assert.equal(cleanDetailUrl("/abs/plans/x.plan.md"), "");
  assert.equal(cleanDetailUrl("C:\\plans\\x.md"), "");
  assert.equal(cleanDetailUrl(""), "");
  assert.equal(cleanDetailUrl(null), "");
});

test("p1: plan URL verificada viaja a ## Links; path local jamás", () => {
  const withUrl = buildPrBody(5, "T", { planUrl: "https://github.com/o/r/issues/5#issuecomment-1" });
  assert.ok(withUrl.includes("## Links"));
  assert.ok(withUrl.includes("- Plan: https://github.com/o/r/issues/5#issuecomment-1"));
  const withPath = buildPrBody(5, "T", { planUrl: "/abs/plans/x.plan.md" });
  assert.ok(!withPath.includes("## Links"));
  assert.ok(!withPath.includes("/abs/plans"));
});

test("p1: validación honesta sin steps corridos (nada pendiente sin cobertura)", () => {
  const report = ["Intro.", "", "## Review guidance", "- No verificado: nada pendiente."].join("\n");
  const body = buildPrBody(9, "T", { implementReport: report });
  assert.ok(body.includes("## Validation"));
  assert.ok(!body.includes("Nothing material."));
  assert.ok(body.includes("no verification steps ran"));
});

test("p1: Nothing material solo con steps reales", () => {
  const body = buildPrBody(9, "T", {
    implementReport: IMPL_REPORT,
    verification: { overall: "pass", steps: [{ name: "test", command: "pnpm test", status: "pass" }] },
  });
  assert.ok(body.includes("- **Not verified:** Nothing material."));
});

test("pr-body: Contract/Seams/Red-green/Follow-ups del reporte van al body; ausentes se omiten", () => {
  const report = [
    "Intro del cambio.",
    "",
    "## Contract",
    "- Invariant: la clave original jamás se pisa",
    "- Scope boundary: solo read path",
    "- Root cause: parse sin validar",
    "",
    "## Changed seams",
    "| `store → app` | guards | `js/store.js:8` |",
    "",
    "## Validation",
    "- `node tests/x.test.js` — 3 pass",
    "- Red/green: falla sin fix con Error x / pasa con fix",
    "",
    "## Discoveries",
    "- D1 — aviso de escritura — accepted: issue #99",
  ].join("\n");
  const body = buildPrBody(9, "T", {
    implementReport: report,
    verification: { overall: "pass", steps: [{ name: "test", command: "node tests/x.test.js", status: "pass" }] },
  });
  assert.ok(body.includes("- **Invariant:** la clave original jamás se pisa"));
  assert.ok(body.includes("- **Scope boundary:** solo read path"));
  assert.ok(body.includes("- **Root cause:** parse sin validar"));
  assert.ok(body.includes("### Changed seams"));
  assert.ok(body.includes("`store → app`"));
  assert.ok(body.includes("Red/green: falla sin fix"));
  assert.ok(body.includes("### Follow-ups"));
  assert.ok(body.includes("issue #99"));
  const bare = buildPrBody(9, "T", { implementReport: "Intro sin secciones." });
  assert.ok(!bare.includes("Invariant:"));
  assert.ok(!bare.includes("Changed seams"));
  assert.ok(!bare.includes("Red/green:"));
  assert.ok(!bare.includes("Follow-ups"));
});

test("p1: buildPrDetailsFromJob recoge planPublication http e ignora paths", () => {
  const { details } = buildPrDetailsFromJob({
    timeline: [
      { meta: { planPublication: "https://github.com/o/r/issues/5#issuecomment-9" } },
    ],
  });
  assert.equal(details.planUrl, "https://github.com/o/r/issues/5#issuecomment-9");
  const local = buildPrDetailsFromJob({ timeline: [{ meta: { planUrl: "./plans/x.md" } }] });
  assert.equal((local.details as Record<string, unknown>).planUrl, undefined);
});

test("p1: PR abierto existente se reutiliza sin push ni create", async () => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    calls.push({ cmd, args });
    if (cmd === "git" && args[0] === "rev-list") return { stdout: "2\n", stderr: "" };
    if (cmd === "git" && args[0] === "status") return { stdout: "", stderr: "" };
    if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
      return {
        stdout: JSON.stringify({ state: "OPEN", number: 77, url: "https://github.com/o/r/pull/77" }),
        stderr: "",
      };
    }
    throw new Error(`must not be called: ${cmd} ${args.join(" ")}`);
  };
  const got = await openPrForJob({
    repoPath: "/r/wt",
    branch: "issue-5-x",
    baseBranch: "main",
    issueNumber: 5,
    run,
    writeBodyFile: () => {
      throw new Error("must not write a body when reusing");
    },
    unlinkBodyFile: () => {},
  });
  assert.deepEqual(got, {
    ok: true,
    prNumber: 77,
    prUrl: "https://github.com/o/r/pull/77",
    duplicate: true,
  });
  assert.ok(!calls.some((c) => c.cmd === "git" && c.args[0] === "push"));
  assert.ok(!calls.some((c) => c.cmd === "gh" && c.args[1] === "create"));
});

test("p1: verifyCreatedPr confirma número/URL/base/head/draft", async () => {  const run = async () => ({
    stdout: JSON.stringify({
      number: 77,
      url: "https://github.com/o/r/pull/77",
      state: "OPEN",
      baseRefName: "main",
      headRefName: "issue-5-x",
      isDraft: false,
    }),
    stderr: "",
  });
  assert.deepEqual(await verifyCreatedPr({ repoPath: "/r", prNumber: 77, run }), {
    state: "open",
    base: "main",
    head: "issue-5-x",
    draft: false,
    url: "https://github.com/o/r/pull/77",
  });
  const junk = async () => ({ stdout: "not json", stderr: "" });
  assert.equal(await verifyCreatedPr({ repoPath: "/r", prNumber: 77, run: junk }), null);
  const mismatch = async () => ({
    stdout: JSON.stringify({ number: 78, url: "https://x/78", state: "OPEN" }),
    stderr: "",
  });
  assert.equal(await verifyCreatedPr({ repoPath: "/r", prNumber: 77, run: mismatch }), null);
});

// ── P2: dispositions del loop (parser + espejo en PR body) ──

const IMPL_REPORT_DISP = [
  "Cambio X en `a.ts`.",
  "",
  "## Review guidance",
  "- Empezar por: `a.ts:1` — el cambio.",
  "- No verificado: nada pendiente.",
  "",
  "## Dispositions",
  "- f1: FIXED — se movió el parseo a try/catch en a.ts:41.",
  "- f2: NOT_A_FINDING — el path ya valida con isSafe en b.ts:12.",
  "- f3: TRACKED_FOLLOW_UP — issue #45 (rate-limit separado).",
  "- f4: DECLINED — preferencia de naming, se mantiene la convención.",
  "- f1: FIXED — duplicado que se ignora.",
  "- f9: deferred pelado que no parsea.",
].join("\n");

test("p2: extractDispositions parsea estados terminales, dedupea e ignora junk", () => {
  const got = extractDispositions(IMPL_REPORT_DISP);
  assert.deepEqual(
    got.map((d) => d.id),
    ["f1", "f2", "f3", "f4"],
  );
  assert.deepEqual(
    got.map((d) => d.disposition),
    ["FIXED", "NOT_A_FINDING", "TRACKED_FOLLOW_UP", "DECLINED"],
  );
  assert.ok(got[0]?.reason.includes("try/catch"));
  assert.equal(extractDispositions("sin secciones").length, 0);
  assert.equal(extractDispositions(IMPL_REPORT).length, 0, "sin sección no hay tabla");
  assert.equal(extractDispositions(null).length, 0);
});

test("p2: PR body espeja ## Review dispositions solo con datos", () => {
  const body = buildPrBody(11, "T", {
    implementReport: IMPL_REPORT_DISP,
    verification: { overall: "pass", steps: [{ name: "test", command: "pnpm test", status: "pass" }] },
  });
  assert.ok(body.includes("## Review dispositions"));
  assert.ok(body.includes("| Finding | Disposition | Reason |"));
  assert.ok(body.includes("`f1` | FIXED"));
  assert.ok(body.includes("`f3` | TRACKED_FOLLOW_UP"));
  const plain = buildPrBody(11, "T", { implementReport: IMPL_REPORT });
  assert.ok(!plain.includes("## Review dispositions"), "sin sección no hay tabla");
});

// ── P3b: publicación del review report (siempre, idempotente por head) ──

const P3B_LOCAL = buildReviewReport({
  pr: 0,
  base: "main",
  head: "issue-5-x",
  verdict: "READY TO MERGE",
  summary: "OK.",
  findings: [],
  validation: [{ command: "pnpm test", result: "PASS", evidence: "12 passed" }],
  scopes: ["tests"],
});

const P3B_URL = "https://github.com/o/r/pull/77#issuecomment-9";

function p3bCommentBody(head: string): string {
  return [
    "<!--",
    "prp-review-id: pr-77",
    "pr: 77",
    "base: main",
    "head: issue-5-x",
    "reviewed: 2026-09-14T00:00:00.000Z",
    `reviewed_head: ${head}`,
    "verdict: READY TO MERGE",
    "open_findings: 0",
    "scopes: [tests]",
    "publication: pending",
    "-->",
    "",
    "## Ready to merge",
  ].join("\n");
}

test("p3b: publica y verifica la URL releyendo comentarios", async () => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const written: Array<{ file: string; body: string }> = [];
  let commented = false;
  const run = async (
    cmd: string,
    args: readonly string[],
    _opts: { cwd: string; timeoutMs: number },
  ) => {
    calls.push({ cmd, args });
    if (cmd === "git") return { stdout: "abc123\n", stderr: "" };
    if (cmd === "gh" && args[1] === "comment") {
      commented = true;
      return { stdout: `${P3B_URL}\n`, stderr: "" };
    }
    if (cmd === "gh" && args[1] === "view") {
      return {
        stdout: JSON.stringify({
          comments: commented ? [{ body: p3bCommentBody("abc123"), url: P3B_URL }] : [],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected: ${cmd} ${args.join(" ")}`);
  };
  const got = await publishReviewReport({
    repoPath: "/r/wt",
    prNumber: 77,
    branch: "issue-5-x",
    body: P3B_LOCAL,
    run,
    writeBodyFile: (file, body) => {
      written.push({ file, body });
    },
    unlinkBodyFile: () => {},
  });
  assert.deepEqual(got, { ok: true, url: P3B_URL, duplicate: false });
  assert.equal(written.length, 1);
  assert.ok(written[0]?.body.includes("prp-review-id: pr-77"));
  assert.ok(written[0]?.body.includes("reviewed_head: abc123"));
  assert.ok(written[0]?.body.includes("pr: 77"));
});

test("p3b: marcador del mismo head se reutiliza sin comentar", async () => {
  let comments = 0;
  const run = async (cmd: string, args: readonly string[]) => {
    if (cmd === "git") return { stdout: "abc123\n", stderr: "" };
    if (cmd === "gh" && args[1] === "view") {
      return {
        stdout: JSON.stringify({
          comments: [{ body: p3bCommentBody("abc123"), url: P3B_URL }],
        }),
        stderr: "",
      };
    }
    if (cmd === "gh" && args[1] === "comment") {
      comments += 1;
      return { stdout: `${P3B_URL}\n`, stderr: "" };
    }
    throw new Error("unexpected");
  };
  const got = await publishReviewReport({
    repoPath: "/r/wt",
    prNumber: 77,
    branch: "issue-5-x",
    body: P3B_LOCAL,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.deepEqual(got, { ok: true, url: P3B_URL, duplicate: true });
  assert.equal(comments, 0);
});

test("p3b: sin confirmación del marcador no se reporta URL", async () => {
  const run = async (cmd: string, args: readonly string[]) => {
    if (cmd === "git") return { stdout: "abc123\n", stderr: "" };
    if (cmd === "gh" && args[1] === "comment") return { stdout: "sin url acá\n", stderr: "" };
    if (cmd === "gh" && args[1] === "view") {
      return { stdout: JSON.stringify({ comments: [] }), stderr: "" };
    }
    throw new Error("unexpected");
  };
  const got = await publishReviewReport({
    repoPath: "/r/wt",
    prNumber: 77,
    branch: "issue-5-x",
    body: P3B_LOCAL,
    run,
    writeBodyFile: () => {},
    unlinkBodyFile: () => {},
  });
  assert.equal(got.ok, false);
  assert.equal((await publishReviewReport({ repoPath: "", prNumber: 77, body: P3B_LOCAL, run })).ok, false);
  assert.equal((await publishReviewReport({ repoPath: "/r", prNumber: 0, body: P3B_LOCAL, run })).ok, false);
});

test("p3b: readReviewReportFromTimeline toma el último con reporte", () => {
  assert.equal(readReviewReportFromTimeline([]), null);
  assert.equal(readReviewReportFromTimeline(null), null);
  const got = readReviewReportFromTimeline([
    { meta: { reviewReport: { verdict: "NEEDS FIXES" } } },
    { meta: { reviewReport: { verdict: "READY TO MERGE", report: P3B_LOCAL } } },
  ]);
  assert.equal(got?.verdict, "READY TO MERGE");
});

function p3bJob(id: string, reportMeta: Record<string, unknown>): void {
  try {
    workItemStore.clear();
  } catch {}
  const created = workItemStore.create({ id, prompt: "p", worktree: "C:/tmp/p3b" });
  try {
    (workItemStore.get(id) as unknown as Record<string, unknown>).isolation = {
      branch: "issue-5-x",
      baseBranch: "main",
      worktreePath: "C:/tmp/p3b-wt",
      repoRoot: "C:/tmp/p3b",
      prNumber: 77,
      prUrl: "https://github.com/o/r/pull/77",
      state: "pr-open",
      createdAt: "2026-09-14T00:00:00.000Z",
    };
  } catch {}
  try {
    workItemStore.appendEvent(created.id, "runner", "review report: READY TO MERGE (0 open)", {
      reviewReport: reportMeta,
    } as unknown as Record<string, unknown>);
  } catch {}
}

test("p3b: hook publica con reporte y salta sin reporte o ya publicado", async () => {
  // Sin reporte → skip honesto, cero spawns.
  p3bJob("job-p3b-noreport01", { verdict: "READY TO MERGE" });
  const noCalls: Array<unknown> = [];
  const noRun = async () => {
    noCalls.push(1);
    return { stdout: "", stderr: "" };
  };
  assert.deepEqual(await maybePublishReviewReportForJob("job-p3b-noreport01", { run: noRun }), {
    published: false,
    skipped: "no-report",
  });
  assert.equal(noCalls.length, 0);

  // Ya publicado para el mismo head → skip sin gh.
  p3bJob("job-p3b-dup01", {
    verdict: "READY TO MERGE",
    publication: P3B_URL,
    publishedHead: "abc123",
    report: P3B_LOCAL,
  });
  const dupCalls: Array<unknown> = [];
  const revRun = async () => {
    dupCalls.push(1);
    return { stdout: "abc123\n", stderr: "" };
  };
  assert.deepEqual(await maybePublishReviewReportForJob("job-p3b-dup01", { run: revRun }), {
    published: false,
    skipped: "already-published",
  });
  assert.ok(dupCalls.length <= 1, "solo el probe de head, sin gh");

  // Head nuevo → publica y deja evento con URL.
  p3bJob("job-p3b-pub01", {
    verdict: "READY TO MERGE",
    publication: "pending",
    report: P3B_LOCAL,
  });
  let commented = false;
  const pubRun = async (cmd: string, args: readonly string[]) => {
    if (cmd === "git") return { stdout: "def456\n", stderr: "" };
    if (cmd === "gh" && args[1] === "comment") {
      commented = true;
      return { stdout: `${P3B_URL}\n`, stderr: "" };
    }
    if (cmd === "gh" && args[1] === "view") {
      return {
        stdout: JSON.stringify({
          comments: commented ? [{ body: p3bCommentBody("def456"), url: P3B_URL }] : [],
        }),
        stderr: "",
      };
    }
    throw new Error("unexpected");
  };
  const pub = await maybePublishReviewReportForJob("job-p3b-pub01", { run: pubRun });
  assert.deepEqual(pub, { published: true, url: P3B_URL, duplicate: false });
  const events = workItemStore.get("job-p3b-pub01")?.timeline ?? [];
  assert.ok(events.some((e) => e.message.includes("review report published")));
  workItemStore.clear();
});

// ── Fix L: stale-check (head actual vs reviewed_head, on-demand) ──

const STALE_HEAD = "abc123def456abc123def456abc123def456abcd";
const STALE_NEW = "def456abc123def456abc123def456abc123abcd";

function staleReport(head: string): string {
  return buildReviewReport({
    pr: 77,
    base: "main",
    head: "issue-5-x",
    reviewedHead: head,
    verdict: "READY TO MERGE",
    summary: "OK.",
    findings: [],
    validation: [],
    scopes: [],
    publication: P3B_URL,
  });
}

function staleJob(id: string, report: unknown): void {
  try {
    workItemStore.clear();
  } catch {}
  const created = workItemStore.create({ id, prompt: "p", worktree: "C:/tmp/stale" });
  try {
    (workItemStore.get(id) as unknown as Record<string, unknown>).isolation = {
      branch: "issue-5-x",
      baseBranch: "main",
      worktreePath: "C:/tmp/stale-wt",
      repoRoot: "C:/tmp/stale",
      prNumber: 77,
      prUrl: "https://github.com/o/r/pull/77",
      state: "pr-open",
      createdAt: "2026-09-14T00:00:00.000Z",
    };
  } catch {}
  try {
    workItemStore.appendEvent(created.id, "runner", "review report: READY TO MERGE (0 open)", {
      reviewReport: { verdict: "READY TO MERGE", openFindings: 0, publication: P3B_URL, report },
    } as unknown as Record<string, unknown>);
  } catch {}
}

test("stale: readPrHead lee headRefOid y valida forma", async () => {
  const run = async () => ({
    stdout: JSON.stringify({ headRefOid: STALE_NEW, number: 77, url: "https://github.com/o/r/pull/77" }),
    stderr: "",
  });
  const got = await readPrHead({ repoPath: "/r", prNumber: 77, run });
  assert.deepEqual(got, {
    ok: true,
    headOid: STALE_NEW,
    prNumber: 77,
    prUrl: "https://github.com/o/r/pull/77",
  });
  const junk = async () => ({ stdout: "not json", stderr: "" });
  assert.equal((await readPrHead({ repoPath: "/r", prNumber: 77, run: junk })).ok, false);
  const noOid = async () => ({ stdout: JSON.stringify({ number: 77 }), stderr: "" });
  assert.equal((await readPrHead({ repoPath: "/r", prNumber: 77, run: noOid })).ok, false);
  assert.equal((await readPrHead({ repoPath: "", prNumber: 77, run })).ok, false);
});

test("stale: mismo head → fresh, sin evento", async () => {
  staleJob("job-stale-fresh01", staleReport(STALE_HEAD));
  const run = async (cmd: string) => {
    if (cmd === "git") return { stdout: `${STALE_HEAD}\n`, stderr: "" };
    return {
      stdout: JSON.stringify({ headRefOid: STALE_HEAD, number: 77 }),
      stderr: "",
    };
  };
  const got = await checkReviewStale("job-stale-fresh01", { run });
  assert.deepEqual(got, {
    checked: true,
    stale: false,
    reviewedHead: STALE_HEAD,
    prNumber: 77,
  });
  const events = workItemStore.get("job-stale-fresh01")?.timeline ?? [];
  assert.ok(!events.some((e) => e.message.includes("review stale")), "fresh no emite evento");
  workItemStore.clear();
});

test("stale: head nuevo → evento durable e idempotente", async () => {
  staleJob("job-stale-old01", staleReport(STALE_HEAD));
  const run = async (cmd: string) => {
    if (cmd === "git") return { stdout: `${STALE_NEW}\n`, stderr: "" };
    return {
      stdout: JSON.stringify({ headRefOid: STALE_NEW, number: 77 }),
      stderr: "",
    };
  };
  const first = await checkReviewStale("job-stale-old01", { run });
  assert.deepEqual(first, {
    checked: true,
    stale: true,
    reviewedHead: STALE_HEAD,
    currentHead: STALE_NEW,
    prNumber: 77,
  });
  const second = await checkReviewStale("job-stale-old01", { run });
  assert.deepEqual(second, first, "segunda llamada no duplica");
  const events = workItemStore.get("job-stale-old01")?.timeline ?? [];
  assert.equal(
    events.filter((e) => e.message.includes("review stale")).length,
    1,
    "un solo evento de stale",
  );
  workItemStore.clear();
});

test("stale: sin reporte, sin publish o gh caído → unchecked honesto", async () => {
  staleJob("job-stale-norep01", { verdict: "x" } as unknown as Record<string, unknown>);
  const run = async () => ({ stdout: "{}", stderr: "" });
  assert.deepEqual(await checkReviewStale("job-stale-norep01", { run }), {
    checked: false,
    reason: "no-report",
  });
  staleJob(
    "job-stale-nopub01",
    buildReviewReport({
      pr: 0, base: "m", head: "h", verdict: "READY TO MERGE",
      summary: "x", findings: [], validation: [], scopes: [],
    }),
  );
  assert.deepEqual(await checkReviewStale("job-stale-nopub01", { run }), {
    checked: false,
    reason: "not-published",
  });
  staleJob("job-stale-nogh01", staleReport(STALE_HEAD));
  const badRun = async () => {
    throw new Error("gh: command not found");
  };
  assert.deepEqual(await checkReviewStale("job-stale-nogh01", { run: badRun }), {
    checked: false,
    reason: "head-unreadable",
  });
  assert.deepEqual(await checkReviewStale("job-no-existe", { run }), {
    checked: false,
    reason: "unknown-job",
  });
  workItemStore.clear();
});
