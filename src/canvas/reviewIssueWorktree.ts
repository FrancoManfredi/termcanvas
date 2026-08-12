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

type FindPrForIssueFn = (
  cwd: string,
  issueNumber: number,
) => Promise<
  | { ok: true; pr: PrInfo | null }
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
  findPrForIssue: FindPrForIssueFn;
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
}

interface ReviewResult {
  ok: boolean;
  terminal?: Terminal;
  worktreeId?: string;
  pr?: PrInfo | null;
  error?: string;
  // The anti-duplicate gate decided there is nothing new to review: the last
  // review already evaluated the current headRefOid, so no worktree or
  // terminal was created.
  skipped?: boolean;
}

// git reports worktree paths with forward slashes even on Windows
// (C:/repo/.worktrees/x), while path.join produces backslashes
// (C:\repo\.worktrees\x). Normalize before comparing so the freshly
// created review worktree is found by path regardless of the separator style.
function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Launch a review session for an issue that already has a linked PR.
 *
 * Flow:
 * 1. Detect the linked PR via the `closedByPullRequestsReferences` field.
 * 2. Create a fresh isolated review worktree as a DETACHED checkout of the
 *    PR branch tip. It reuses the implementer's worktree directory name with
 *    a "-review" suffix so the two checkouts of an issue are visually paired
 *    in the canvas. The reviewer never creates a branch or PR of its own —
 *    the PR branch stays bound to the implementer's worktree, and the review
 *    copy shares its commit as a throwaway detached HEAD.
 * 3. Open an opencode terminal with the review prompt. autoApprove stays
 *    OFF: the reviewer consents to each permission in the live terminal.
 * 4. Draw the same SVG arrow used by RESOLVER ISSUE so the relationship
 *    between the issue card and the review terminal is visible.
 *
 * The terminal is flagged with reviewIssueNumber so the runtime auto-cleans
 * the review worktree when the reviewer process exits, reading the PR's
 * reviewDecision (via reviewPrNumber) before removal so the issue card can
 * show the verdict.
 */
export async function reviewIssueWorktree(
  opts: ReviewIssueWorktreeOptions,
): Promise<ReviewResult> {
  const {
    issue,
    target,
    getProject,
    syncWorktrees,
    createReviewWorktree,
    removeWorktree,
    isReviewWorktreeInUse,
    findPrForIssue,
    getReviewContext,
    createTerminal,
    notify,
    setResolveArrows,
    issueNodeId,
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

    const prResult = await findPrForIssue(project.path, issue.issueNumber);
    if (!prResult.ok) {
      notify("error", `Failed to find PR for issue: ${prResult.error}`);
      return { ok: false, error: prResult.error };
    }
    if (!prResult.pr) {
      notify(
        "warn",
        `Issue #${issue.issueNumber} has no linked PR yet. Resolve the issue first — review only makes sense once there is a solution to look at.`,
      );
      return { ok: false, error: "No linked PR", pr: null };
    }
    const pr = prResult.pr;

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
      return { ok: true, skipped: true, pr };
    }

    // Derive the review copy's directory name from the PR's head branch: the
    // implementer's worktree folder is .worktrees/<branch> (see
    // project:create-worktree), so pairing the review copy with the branch
    // name keeps both checkouts of an issue under the same base name no matter
    // which worktree was focused when the review was launched.
    const baseName = pr.headRefName.replace(/[\\/]+$/, "").replace(/[\\/]/g, "-");

    // Self-healing for abandoned review worktrees. A review copy is created
    // for a single session and removed by the terminal runtime as soon as the
    // reviewer CLI exits — but a crash, a killed app, or a stale snapshot can
    // leave <repo>/.worktrees/<baseName>-review behind. `git worktree add`
    // would then fail with "already exists" (unless --force), so detect the
    // leftover up front and prune it when no live reviewer is attached.
    const expectedReviewPath = normalizePathForCompare(
      `${project.path}/.worktrees/${baseName}-review`,
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
      notify("error", `Failed to create review worktree: ${createResult.error}`);
      return { ok: false, error: createResult.error };
    }
    syncWorktrees(project.path, createResult.worktrees);

    const syncedProject = getProject(target.projectId);
    const reviewWorktree = syncedProject?.worktrees.find(
      (w) =>
        normalizePathForCompare(w.path) ===
        normalizePathForCompare(createResult.path),
    );
    if (!reviewWorktree) {
      return { ok: false, error: "Review worktree not found after sync" };
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
        body: issue.body,
        prNumber: pr.number,
        branch: pr.headRefName,
        commitSha: pr.headRefOid,
        reviewContext,
        reviewTemplateFilePath,
        repoPath: project.path,
      }),
      autoApprove: false,
      position,
      issueNumber: issue.issueNumber,
      reviewIssueNumber: issue.issueNumber,
      reviewPrNumber: pr.number,
    });

    setResolveArrows?.((prev) =>
      prev.some((a) => a.terminalId === terminal.id)
        ? prev
        : [...prev, { issueId: issueNodeId, terminalId: terminal.id }],
    );

    return { ok: true, terminal, worktreeId: reviewWorktree.id, pr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify("error", `Failed to start review: ${message}`);
    return { ok: false, error: message };
  }
}