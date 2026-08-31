# Design: GitHub Issues Worktree Isolation

## Technical Approach

Replace the synchronous RESOLVER ISSUE handler (`XyFlowCanvas.tsx:1054-1085`) with an async flow that creates an isolated git worktree before launching the terminal.

Algorithm:
1. User triggers "RESOLVER ISSUE" from the issue context menu
2. Set `isCreatingWorktree = true` (busy state)
3. Retrieve issue from `useIssueStore.getState().getIssue(issueNumber)`
4. Compute branch name: `buildIssueBranchName(issue)` → `issue-<N>-<slug>`
5. Check existing worktrees for a match on `branch === branchName`
6. If no match exists, call `window.termcanvas.project.createWorktree(repoPath, branchName)`
7. On success, call `useProjectStore.getState().syncWorktrees(repoPath, result.worktrees)`
8. Find the new/existing worktree ID from the synced project state
9. Create terminal via `createTerminalInScene({ projectId, worktreeId: newWorktreeId, ... })`
10. On any failure, toast error via `useNotificationStore.getState().notify("error", ...)` and abort — no fallback
11. Clear `isCreatingWorktree = false`

The `initialPrompt` text remains unchanged from the current behavior.

## Architecture Decisions

| Decision | Option | Tradeoff | Rationale |
|----------|--------|----------|-----------|
| Branch naming | `issue-<N>-<slug>` kebab-case | Manual branch names are flexible but collide | Issue number guarantees uniqueness; slug is descriptive and truncatable |
| Reuse existing worktree | Skip `createWorktree` if branch match found | Alternative: always call `createWorktree` and let git fail | Avoids unnecessary git operations and preserves in-flight work |
| Failure mode | Abort + toast, no fallback | Fallback to focused worktree would keep the user unblocked | Fallback silently destroys isolation guarantee; explicit failure is safer |
| Busy state | Local `useState` flag `isCreatingWorktree` | Alternative: global store flag | Scope is limited to one canvas interaction; local state matches `isFetchingIssues` pattern |

## Data Flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  IssueContext   │────▶│ buildIssueBranchName │────▶│  ProjectStore   │
│    Menu         │     │  (sanitization)      │     │ worktree lookup │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                              │                              │
                              ▼                              ▼
                    ┌─────────────────┐            ┌─────────────────┐
                    │ createWorktree  │◄───────────│  Branch exists? │
                    │  (IPC → git)    │            │    (reuse)      │
                    └─────────────────┘            └─────────────────┘
                              │                              │
                              ▼                              ▼
                    ┌─────────────────┐            ┌─────────────────┐
                    │  syncWorktrees  │◄───────────│  worktreeId     │
                    │  (update store) │            │  (existing)     │
                    └─────────────────┘            └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ createTerminal  │
                    │   InScene       │
                    └─────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/canvas/XyFlowCanvas.tsx` | Modify | Async RESOLVER ISSUE handler (L1054-1085); add `isCreatingWorktree` state; wire in worktree creation + reuse logic |
| `src/canvas/issueWorktreeNaming.ts` | Create | `buildIssueBranchName(issue): string` utility |
| `src/i18n/en.ts` | Modify | 3 strings: `issue_resolve_busy`, `issue_resolve_error`, `issue_resolve_worktree_exists` |
| `tests/issue-worktree-naming.test.ts` | Create | Unit tests for `buildIssueBranchName` edge cases |
| `tests/issue-resolve-worktree.test.ts` | Create | Integration tests for handler: happy path, reuse, failure, busy state |

## Interfaces / Contracts

```typescript
// src/canvas/issueWorktreeNaming.ts
export function buildIssueBranchName(issue: { issueNumber: number; title: string }): string;

// New local state in XyFlowCanvas.tsx
const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);

// i18n additions (en.ts)
issue_resolve_busy: "Creating worktree…",
issue_resolve_error: (err: string) => `Failed to create issue worktree: ${err}`,
issue_resolve_worktree_exists: (name: string) => `Using existing worktree "${name}"`,
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `buildIssueBranchName` — standard titles, special chars, truncation, hyphen collapse | `node:test` direct assertions |
| Integration | Handler flow — happy path creates worktree + terminal; reuse skips `createWorktree`; failure toasts and aborts; busy state toggles | Mock `window.termcanvas.project.createWorktree`, `useProjectStore`, `useNotificationStore` |
| E2E | Not required | This change is covered by integration tests; no UI rendering changes |

## Threat Matrix

| Boundary | Applicable | Expected Safe Behavior | Planned RED Test |
|----------|-----------|----------------------|------------------|
| Subprocess invocation (`createWorktree` spawns `git worktree add`) | **Yes** | Returns structured error `{ok:false, error}`; does NOT crash renderer; does NOT create terminal on failure | `issue-resolve-worktree.test.ts`: mock reject + assert no terminal created, assert toast fired |
| Shell command injection via branch name | **Yes** | `buildIssueBranchName` strips all non-alphanumeric characters before passing to `createWorktree` | `issue-worktree-naming.test.ts`: input with `; rm -rf /` produces safe kebab-case slug |
| Idempotent re-execution (same issue) | **Yes** | Second invocation reuses existing worktree; no duplicate git worktree created | `issue-resolve-worktree.test.ts`: simulate existing worktree in store, assert `createWorktree` not called |
| Async state race (rapid double-click) | **Yes** | `isCreatingWorktree` guard prevents concurrent `createWorktree` calls | `issue-resolve-worktree.test.ts`: set busy state true, trigger second resolve, assert `createWorktree` called once |
| Process integration (worktree path → terminal cwd) | **Yes** | Terminal receives correct `worktreeId`; existing terminals in other worktrees unaffected | Integration test: assert `createTerminalInScene` receives new worktreeId, not fallback |
| Routing / VCS / PR automation | N/A | No HTTP routing or PR automation in this change | — |
| Executable-file classification | N/A | No new executable files; only `.ts` sources | — |

## Migration / Rollout

No migration required. Worktrees created by this feature are standard git worktrees managed by the existing `syncWorktrees` infrastructure.

## Open Questions

- [ ] Should the busy state disable the entire context menu or only the "RESOLVER ISSUE" item? (Proposal says "disabled context menu or loading indicator")
- [ ] Should we add a success toast when reusing an existing worktree, or remain silent? (i18n string `issue_resolve_worktree_exists` is prepared but can be omitted)
