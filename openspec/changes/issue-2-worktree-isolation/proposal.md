# Proposal: GitHub Issues Worktree Isolation

## Intent

Each "RESOLVER ISSUE" session currently creates a terminal in the focused worktree — multiple parallel issue resolutions stomp on the same git working tree. This change ensures each issue gets its own isolated worktree, preventing cross-issue file conflicts and protecting against work loss.

## Scope

### In Scope
- Create a new git worktree (`issue-<N>-<slug>`) before launching the resolve terminal
- Use the new worktree's path as the terminal's working directory
- Idempotent: reuse existing worktree for the same issue if already created
- Abort on worktree creation failure — no fallback to focused worktree
- Busy state UI while creating the worktree

### Out of Scope
- Any changes beyond the RESOLVER ISSUE flow
- Cross-project worktree isolation
- Automatic worktree cleanup after resolution

## Capabilities

### New Capabilities
- `issue-worktree-naming`: Sanitization utility converting issue number + title to a kebab-case branch name (`issue-<N>-<slug>`)

### Modified Capabilities
- `github-issues-canvas`: RESOLVER ISSUE handler changes from focused-worktree terminal creation to isolated-worktree-first terminal creation

## Approach

Replace the synchronous `resolveContextMenuTarget()` + `createTerminalInScene()` chain (XyFlowCanvas.tsx:1054-1085) with an async handler that:

1. Reads issue from `useIssueStore`
2. Builds branch name via `buildIssueBranchName(issue)` (new utility)
3. Checks `createWorktree` result — if worktree for branch already exists, reuse its ID
4. Calls `syncWorktrees` to pick up the new worktree's generated ID
5. Creates terminal with the new worktree ID; on failure, toasts error and aborts
6. Sets busy state (`isCreatingWorktree`) mirroring existing `isFetchingIssues` pattern

New utility file: `src/canvas/issueWorktreeNaming.ts` (~20 lines). New test file: `tests/issue-worktree-naming.test.ts` + `tests/issue-resolve-worktree.test.ts`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/canvas/XyFlowCanvas.tsx` | Modified | RESOLVER ISSUE handler (L1054-1085): async, worktree-first |
| `src/canvas/issueWorktreeNaming.ts` | New | `buildIssueBranchName(issue)` sanitizer |
| `src/i18n/en.ts` (+ locales) | Modified | 3 new strings for progress/error/success |
| `tests/issue-worktree-naming.test.ts` | New | Sanitization edge cases |
| `tests/issue-resolve-worktree.test.ts` | New | Handler integration: success + failure paths |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `git worktree add` fails (branch exists, dirty repo) | Medium | Catch and toast — abort, no fallback |
| Long-running `git worktree add` blocks UI | Low | Already async via IPC; surface via busy state |
| Branch naming collision | Low | Reuse existing worktree on match; slug + number is unique per issue |
| Issue card's `__worktreePath` is a worktree, not repo root | High | Pass `__worktreePath` directly — valid git working tree; `createWorktree` handles nested paths |

## Rollback Plan

Revert the handler to use `resolveContextMenuTarget()` directly. No data migration needed — worktrees created by this feature are standard git worktrees.

## Dependencies

- `window.termcanvas.project.createWorktree(repoPath, branch)` — already exists
- `useProjectStore.syncWorktrees(projectPath, worktrees)` — already exists
- `createTerminalInScene` — already exists

## Success Criteria

- [ ] Right-click "RESOLVER ISSUE" creates an isolated worktree before launching the terminal
- [ ] Same issue resolved twice reuses the existing worktree (no duplicate)
- [ ] Worktree creation failure shows error toast and does NOT create a terminal
- [ ] Existing terminals in other worktrees are unaffected
- [ ] `initialPrompt` is unchanged from current behavior
