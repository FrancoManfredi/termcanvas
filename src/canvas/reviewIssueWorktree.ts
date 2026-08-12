import type { TerminalType } from "../types";
import type { IssueNodeData } from "../stores/issueStore";
import { buildIssueReviewPrompt } from "./issueReviewPrompt";

interface ReviewTarget {
  projectId: string;
  worktreeId: string;
  worktree: { path: string };
}

interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName: string;
  headRefOid: string;
}

type CreateReviewWorktreeFn = (
  repoPath: string,
  baseName: string,
  branch: string,
) => Promise<
  | {
      ok: true;
      path: string;
      worktrees: { path: string; branch: string; isPrimary: boolean }[];
    }
  | { ok: false; error: string }
>;

// The review flow runs on EVERY open PR of the issue (not just one), so the
// lookup returns the full OPEN list from the `closedByPullRequestsReferences`
// field. An empty list means the issue has no open linked PR; ok:false means
// the GitHub query itself failed (auth, no remote, GraphQL error).
type FindOpenPrsForIssueFn = (
  cwd: string,
  issueNumber: number,
) => Promise<
  | { ok: true; prs: PrInfo[] }
  | { ok: false; error: string }
>;

type RemoveWorktreeFn = (
  repoPath: string,
  worktreePath: string,
  force?: boolean,
) => Promise<
  | {
      ok: true;
      worktrees: { path: string; branch: string; isPrimary: boolean }[];
    }
  | { ok: false; error: string; dirty?: boolean }
>;

// Optional so snapshot-style embedders (tests) can skip the stale cleanup;
// the module only prunes when the embedder can both inspect and remove.
type IsReviewWorktreeInUseFn = (worktreeId: string) => boolean;

// Prefetch PR facts (headRefOid, last review, latest inline batch, diff file
// and the fixed JSON skeleton) so the agent gets them from the app instead of
// re-deriving them with gh. targetDir may be empty for the anti-duplicate
// gate probe, which must not write any file before the review is committed to.
type GetReviewContextFn = (
  cwd: string,
  prNumber: number,
  targetDir: string,
) => Promise<
  | {
      ok: true;
      context: string;
      diffFilePath: string | null;
      templateFilePath: string | null;
      headRefOid: string | null;
      lastReviewCommitId: string | null;
    }
  | { ok: false; error: string }
>;

interface ProjectWorktreeForLookup {
  id: string;
  name?: string;
  path: string;
}

interface ProjectForLookup {
  id: string;
  path: string;
  worktrees: ProjectWorktreeForLookup[];
}

interface Terminal {
  id: string;
}

interface ReviewIssueWorktreeOptions {
  issue: IssueNodeData | undefined;
  target: ReviewTarget;
  // Live lookup, not a snapshot: the store replaces its state object on
  // every sync, so a captured array would never see the freshly created
  // worktree and the follow-up lookup would fail.
  getProject: (projectId: string) => ProjectForLookup | undefined;
  syncWorktrees: (
    projectPath: string,
    worktrees: { path: string; branch: string; isPrimary: boolean }[],
  ) => void;
  createReviewWorktree: CreateReviewWorktreeFn;
  // Optional so the anti-stale cleanup can degrade to the old behavior (create
  // fails with "already exists") when an embedder has no worktree removal.
  removeWorktree?: RemoveWorktreeFn;
  // Optional guard against pruning a worktree that a live review terminal is
  // still attached to (single-use review worktrees are removed on exit, so a
  // leftover copy without a live reviewer is always stale).
  isReviewWorktreeInUse?: IsReviewWorktreeInUseFn;
  findOpenPrsForIssue: FindOpenPrsForIssueFn;
  getReviewContext?: GetReviewContextFn;
  createTerminal: (opts: {
    projectId: string;
    worktreeId: string;
    type: TerminalType;
    title: string;
    initialPrompt: string;
    autoApprove: boolean;
    position: { x: number; y: number };
    issueNumber?: number;
    reviewIssueNumber?: number;
    reviewPrNumber?: number;
  }) => Terminal;
  notify: (type: "error" | "warn" | "info", message: string) => void;
  setResolveArrows?: React.Dispatch<
    React.SetStateAction<Array<{ issueId: string; terminalId: string }>>
  >;
  issueNodeId: string;
  position: { x: number; y: number };
  // When set, review ONLY this open PR of the issue (re-review after a fix).
  // Without it every open PR is reviewed.
  onlyPrNumber?: number;
}

interface ReviewResult {
  ok: boolean;
  // One terminal per open PR of the issue; empty when everything was skipped.
  terminals?: Terminal[];
  worktreeIds?: string[];
  prs?: PrInfo[];
  error?: string;
  // The anti-duplicate gate decided there is nothing new to review for ANY
  // open PR: the last reviews already evaluated the current headRefOids, so
  // no worktree or terminal was created.
  skipped?: boolean;
}

// git reports worktree paths with forward slashes even on Windows
// (C:/repo/.worktrees/x), while path.join produces backslashes
// (C:\repo\.worktrees\x). Normalize before comparing so the freshly
// created review worktree is found by path regardless of the separator style.
function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, "/");
}

// The review copy's directory name derives from the PR head branch, mirroring
// the implementer worktree naming (.worktrees/<branch>). Two open PRs of the
// same issue can share a head branch (e.g. re-opened PRs), which would collide
// on the same -review directory; the caller disambiguates with a -pr<N>
// suffix and this helper rebuilds the same expected path for cleanup probes.
function reviewWorktreeDirName(baseName: string): string {
  return `${baseName}-review`;
}

// One review session for a single open PR: anti-duplicate gate, leftover
// cleanup, detached review worktree, prefetched context and the --auto
// terminal. Returns null when the PR was skipped (already reviewed on the
// current head commit) and throws nothing: per-PR failures are reported via
// notify and surfaced in the result so the loop can continue with the rest.
async function reviewOnePr(
  opts: Omit<ReviewIssueWorktreeOptions, "findOpenPrsForIssue"> & {
    pr: PrInfo;
    prIndex: number;
    // Names already bound to a review worktree earlier in this run, so a
    // shared head branch gets a -pr<N> suffix instead of colliding on the
    // same -review directory.
    usedBaseNames: Set<string>;
    absorbCreateError: (message: string) => void;
  },
): Promise<{ terminal?: Terminal; worktreeId?: string } | null> {
  const {
    issue,
    pr,
    prIndex,
    target,
    getProject,
    syncWorktrees,
    createReviewWorktree,
    removeWorktree,
    isReviewWorktreeInUse,
    getReviewContext,
    createTerminal,
    notify,
    setResolveArrows,
    issueNodeId,
    position,
    usedBaseNames,
    absorbCreateError,
  } = opts;

  if (!issue) {
    absorbCreateError("Issue not found");
    return null;
  }

  const project = getProject(target.projectId);
  if (!project) {
    absorbCreateError("Project not found");
    return null;
  }

  // Anti-duplicate gate by commit, not by state: if the last review already
  // evaluated the current headRefOid, there is nothing new to look at, so do
  // NOT create a review worktree or open a terminal at all. This is pure
  // logic the app can do before committing to review — targetDir is passed
  // empty so the probe never writes the diff/template files. A guessed head
  // or a review without a commit id makes the comparison impossible, so the
  // gate yields and lets the review proceed.
  let prefetchedHeadRefOid: string | null = null;
  let prefetchedLastReviewCommitId: string | null = null;
  if (getReviewContext) {
    const probe = await getReviewContext(project.path, pr.number, "");
    if (probe.ok) {
      prefetchedHeadRefOid = probe.headRefOid;
      prefetchedLastReviewCommitId = probe.lastReviewCommitId;
    }
  }
  if (
    prefetchedHeadRefOid &&
    prefetchedLastReviewCommitId &&
    prefetchedHeadRefOid === prefetchedLastReviewCommitId
  ) {
    notify(
      "info",
      `PR #${pr.number} ya fue revisado en el commit actual ${prefetchedHeadRefOid.slice(0, 7)} — no hay commits nuevos desde la última review. No se abre una revisión duplicada.`,
    );
    return null;
  }

  // Derive the review copy's directory name from the PR's head branch: the
  // implementer's worktree folder is .worktrees/<branch> (see
  // project:create-worktree), so pairing the review copy with the branch
  // name keeps both checkouts of an issue under the same base name no matter
  // which worktree was focused when the review was launched.
  const rawBaseName = pr.headRefName
    .replace(/[\\/]+$/, "")
    .replace(/[\\/]/g, "-");
  const baseName = usedBaseNames.has(rawBaseName)
    ? `${rawBaseName}-pr${pr.number}`
    : rawBaseName;
  usedBaseNames.add(baseName);

  // Self-healing for abandoned review worktrees. A review copy is created
  // for a single session and removed by the terminal runtime as soon as the
  // reviewer CLI exits — but a crash, a killed app, or a stale snapshot can
  // leave <repo>/.worktrees/<baseName>-review behind. `git worktree add`
  // would then fail with "already exists" (unless --force), so detect the
  // leftover up front and prune it when no live reviewer is attached.
  const expectedReviewPath = normalizePathForCompare(
    `${project.path}/.worktrees/${reviewWorktreeDirName(baseName)}`,
  );
  const leftover = project.worktrees.find(
    (w) => normalizePathForCompare(w.path) === expectedReviewPath,
  );
  if (leftover) {
    const inUse = isReviewWorktreeInUse?.(leftover.id) ?? false;
    if (!inUse && removeWorktree) {
      const removed = await removeWorktree(project.path, leftover.path, true);
      if (removed.ok) {
        syncWorktrees(project.path, removed.worktrees);
        notify(
          "info",
          `Se detectó un review worktree abandonado en ${leftover.path} y se limpió para crear una revisión fresca.`,
        );
      } else {
        notify(
          "warn",
          `No se pudo limpiar el review worktree anterior en ${leftover.path}: ${removed.error}. Se intentará crear igualmente.`,
        );
      }
    }
  }

  const createResult = await createReviewWorktree(
    project.path,
    baseName,
    pr.headRefName,
  );
  if (!createResult.ok) {
    absorbCreateError(createResult.error);
    return null;
  }
  syncWorktrees(project.path, createResult.worktrees);

  const syncedProject = getProject(target.projectId);
  const reviewWorktree = syncedProject?.worktrees.find(
    (w) =>
      normalizePathForCompare(w.path) ===
      normalizePathForCompare(createResult.path),
  );
  if (!reviewWorktree) {
    absorbCreateError("Review worktree not found after sync");
    return null;
  }

  // Prefetch PR facts for the prompt when the IPC is wired (real app):
  // headRefOid, last review, latest inline batch, a worktree-local diff file
  // and the fixed JSON review skeleton. Optional by design — a snapshot
  // failure must never block the review from starting; the prompt rules
  // still let the agent fetch facts.
  let reviewContext: string | undefined;
  let reviewTemplateFilePath: string | null = null;
  if (getReviewContext) {
    const snapshot = await getReviewContext(
      project.path,
      pr.number,
      reviewWorktree.path,
    );
    if (snapshot.ok && snapshot.context) {
      reviewContext = snapshot.context;
      reviewTemplateFilePath = snapshot.templateFilePath;
    } else {
      notify(
        "warn",
        `No se pudo precargar el contexto del PR #${pr.number} para el review: ${
          snapshot.ok ? "contexto vacío" : snapshot.error
        }. El reviewer obtendrá los datos con gh.`,
      );
    }
  }

  const terminal = createTerminal({
    projectId: target.projectId,
    worktreeId: reviewWorktree.id,
    type: "opencode",
    title: `Review PR #${pr.number} (issue #${issue.issueNumber})`,
    initialPrompt: buildIssueReviewPrompt({
      issueNumber: issue.issueNumber,
      title: issue.title,
      prNumber: pr.number,
      branch: pr.headRefName,
      commitSha: pr.headRefOid,
      reviewContext,
      reviewTemplateFilePath,
      repoPath: project.path,
    }),
    autoApprove: true,
    // Cascade multiple reviews diagonally so their tiles do not stack
    // exactly on top of each other on the canvas.
    position: {
      x: position.x + prIndex * 24,
      y: position.y + prIndex * 24,
    },
    issueNumber: issue.issueNumber,
    reviewIssueNumber: issue.issueNumber,
    reviewPrNumber: pr.number,
  });

  setResolveArrows?.((prev) =>
    prev.some((a) => a.terminalId === terminal.id)
      ? prev
      : [...prev, { issueId: issueNodeId, terminalId: terminal.id }],
  );

  return { terminal, worktreeId: reviewWorktree.id };
}

/**
 * Launch one review session per OPEN PR linked to an issue.
 *
 * Flow:
 * 1. Detect the open PRs via the `closedByPullRequestsReferences` field.
 *    Every open PR gets its own review — the issue may have several
 *    alternative solutions under review at once.
 * 2. For each PR, create a fresh isolated review worktree as a DETACHED
 *    checkout of the PR branch tip. It reuses the implementer's worktree
 *    directory name with a "-review" suffix so the two checkouts of an issue
 *    are visually paired in the canvas (a shared head branch across two PRs
 *    is disambiguated with a "-pr<N>" suffix). The reviewer never creates a
 *    branch or PR of its own — the PR branch stays bound to the
 *    implementer's worktree, and the review copy shares its commit as a
 *    throwaway detached HEAD.
 * 3. Open an opencode terminal per PR with the review prompt. autoApprove is
 *    ON so the review runs unattended (opencode launches with --auto),
 *    mirroring the RESOLVER ISSUE and IMPLEMENTAR FIX codepaths.
 * 4. Draw the same SVG arrow used by RESOLVER ISSUE so the relationship
 *    between the issue card and the review terminals is visible.
 *
 * Each terminal is flagged with reviewIssueNumber so the runtime
 * auto-cleans its review worktree when the reviewer process exits, reading
 * the PR's reviewDecision (via reviewPrNumber) before removal so the issue
 * card can show the verdict.
 */
export async function reviewIssueWorktree(
  opts: ReviewIssueWorktreeOptions,
): Promise<ReviewResult> {
  const {
    issue,
    target,
    getProject,
    findOpenPrsForIssue,
    notify,
    position,
  } = opts;

  if (!issue) {
    return { ok: false, error: "Issue not found" };
  }

  try {
    const project = getProject(target.projectId);
    if (!project) {
      return { ok: false, error: "Project not found" };
    }

    const prsResult = await findOpenPrsForIssue(
      project.path,
      issue.issueNumber,
    );
    if (!prsResult.ok) {
      notify("error", `Failed to find PRs for issue: ${prsResult.error}`);
      return { ok: false, error: prsResult.error };
    }
    const openPrs = prsResult.prs;
    if (openPrs.length === 0) {
      notify(
        "warn",
        `Issue #${issue.issueNumber} has no open linked PR. Resolve the issue first — review only makes sense once there is a solution to look at.`,
      );
      return { ok: false, error: "No linked PR", prs: [] };
    }
    // Re-review of a single PR: filter the open list down to that PR. The
    // anti-duplicate gate still runs on it, so a PR whose head already has a
    // review is skipped like any other.
    const reviewTargets = opts.onlyPrNumber
      ? openPrs.filter((pr) => pr.number === opts.onlyPrNumber)
      : openPrs;
    if (reviewTargets.length === 0) {
      notify(
        "warn",
        `PR #${opts.onlyPrNumber} no es un PR abierto del issue #${issue.issueNumber}.`,
      );
      return { ok: false, error: "PR not found", prs: openPrs };
    }

    const usedBaseNames = new Set<string>();
    const created: { terminal?: Terminal; worktreeId?: string }[] = [];
    const errors: string[] = [];
    const absorbCreateError = (message: string) => {
      errors.push(message);
      notify("error", `Failed to start review: ${message}`);
    };

    for (const [prIndex, pr] of reviewTargets.entries()) {
      const one = await reviewOnePr({
        ...opts,
        pr,
        prIndex,
        usedBaseNames,
        absorbCreateError,
      });
      if (one) created.push(one);
    }

    if (created.length === 0) {
      if (errors.length > 0) {
        // Every open PR failed to launch — report the last fatal error and
        // keep the list of attempted PRs so the caller can react.
        return {
          ok: false,
          error: errors[errors.length - 1],
          prs: openPrs,
        };
      }
      // Anti-duplicate gate skipped every open PR: nothing new to review.
      return { ok: true, skipped: true, prs: openPrs };
    }

    return {
      ok: true,
      terminals: created
        .map((c) => c.terminal)
        .filter((t): t is Terminal => t !== undefined),
      worktreeIds: created
        .map((c) => c.worktreeId)
        .filter((w): w is string => w !== undefined),
      prs: openPrs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify("error", `Failed to start review: ${message}`);
    return { ok: false, error: message };
  }
}