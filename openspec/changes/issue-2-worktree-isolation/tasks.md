# Tasks: GitHub Issues Worktree Isolation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 (additions + deletions) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (cached; unused at this size) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Naming util + resolver handler + i18n + tests | PR 1 (single) | `npx tsx --test tests/issue-worktree-naming.test.ts tests/issue-resolve-worktree.test.ts` | N/A — unit/integration only; design marks E2E not required (no UI rendering change) | Revert the 5 files; created worktrees are standard git worktrees, removable via `git worktree remove` |

## Phase 1: Naming Utility

- [x] 1.1 RED: `tests/issue-worktree-naming.test.ts` — assert `issue-42-fix-login-bug`, `issue-7-add-auth-quotes-support`, slug truncated to 40 with trailing hyphen trim, injection input (`; rm -rf /`) yields safe kebab-case
- [x] 1.2 GREEN: create `src/canvas/issueWorktreeNaming.ts` — `buildIssueBranchName(issue)` → `issue-<N>-<slug>`; lowercase, non-alnum→`-`, collapse hyphens, trim, truncate 40

## Phase 2: Resolver Handler (Core)

- [x] 2.1 RED: `tests/issue-resolve-worktree.test.ts` — happy path (createWorktree→syncWorktrees→terminal), reuse skips `createWorktree`, failure toasts+aborts+no terminal, busy guard blocks second resolve, terminal gets new worktreeId
- [x] 2.2 Modify `src/canvas/XyFlowCanvas.tsx` (L1054-1087) — add `isCreatingWorktree` state (mirror `isFetchingIssues`); guard early-return when busy; make handler async
- [x] 2.3 Compute `buildIssueBranchName(issue)`; lookup existing worktree by `name === branchName` in project store; if absent, call `window.termcanvas.project.createWorktree(repoPath, branchName)`
- [x] 2.4 On success: `syncWorktrees(repoPath, result.worktrees)`, resolve worktreeId, `createTerminalInScene({ worktreeId, ... })` with unchanged `initialPrompt` + resolve arrows
- [x] 2.5 On failure: `useNotificationStore.getState().notify("error", ...)` + abort — NO fallback to focused worktree; clear busy state in `finally`

## Phase 3: i18n

- [x] 3.1 `src/i18n/en.ts` — add `issue_resolve_busy`, `issue_resolve_error(err)`, `issue_resolve_worktree_exists(name)`

## Phase 4: Verification

- [x] 4.1 Run `npx tsx --test tests/issue-worktree-naming.test.ts tests/issue-resolve-worktree.test.ts` — all green (13/13 pass)
- [x] 4.2 Typecheck: our code passes clean; pre-existing `react-markdown` module error is unrelated
