# Exploration: GitHub Issues Worktree Isolation

**Change name**: `issue-2-worktree-isolation`
**Issue**: #2 — "Cada 'Resolver issue' debe correr en su propio git worktree aislado"
**Date**: 2026-08-03
**Artifact store**: hybrid (Engram + OpenSpec)

## Current State

The `github-issues-canvas` feature (archived 2026-07-31) lets users right-click on a `IssueNode` to see a "RESOLVER ISSUE" context menu item. The handler currently creates an OpenCode terminal **in the focused worktree** — it does not create a new worktree. This means multiple parallel "resolutions" of different issues all stomp on the same git working tree, and the `initialPrompt` instructs OpenCode to do a full SDD cycle inside that single worktree, which conflicts with the request.

### End-to-end flow today (RESOLVER ISSUE → terminal)

1. **Right-click on IssueNode** → `handleNodeContextMenu` (`src/canvas/XyFlowCanvas.tsx:646-657`) captures the issue number into `issueContextMenu` state. The issue card's `__worktreePath` is **already** set when the issue was added (line 486, 501) but is not consulted by the resolve handler.

2. **Menu renders** — only one item: `RESOLVER ISSUE` (`XyFlowCanvas.tsx:1053`).

3. **On click** (`XyFlowCanvas.tsx:1054-1085`):
   - `resolveContextMenuTarget()` (`XyFlowCanvas.tsx:379-400`) returns `{ projectId, worktreeId, worktree }` for the **focused** worktree, falling back to `projects[0].worktrees[0]` if nothing is focused. **This is the worktree the terminal will be created in — not a new one for the issue.**
   - `issue = issueStore.getIssue(issueContextMenu.issueNumber)` looks up the issue metadata.
   - The issue card's `data-id="issue-<N>"` DOM element is queried and its rect is converted to flow space, then `pickPlacement` will anchor the terminal at the bottom-center of the card via `preferredPosition` (`terminalPlacement.ts:206-207`).
   - `createTerminalInScene({ projectId, worktreeId, type: "opencode", title: "Issue #N", initialPrompt, position, autoApprove: true })` (`XyFlowCanvas.tsx:1072-1080`).
   - `setResolveArrows((prev) => [...prev, { issueId, terminalId }])` for the visual arrow overlay.

4. **`createTerminalInScene`** (`src/actions/terminalSceneActions.ts:107-181`):
   - Calls `createProjectTerminal` (`projectStore.ts:192-239`) to build a `TerminalData` with a fresh `id` from `generateId()` (line 188: `${Date.now()}-${++idCounter}`).
   - Calls `pickPlacement` (`src/canvas/terminalPlacement.ts:201-296`) to resolve final flow coords from `preferredPosition` and snap to a 10px grid; nudges collisions.
   - Calls `addTerminalToScene` → `useProjectStore.getState().addTerminal(projectId, worktreeId, terminal)` (`projectStore.ts:628-660`). The terminal is **appended to the existing worktree's `terminals` array**.

5. **The prompt** includes a long pre-cooked SDD pipeline message that tells OpenCode to:
   - Run explore → propose → spec → design → tasks → apply → verify → archive
   - Use both OpenSpec AND Engram
   - Auto-chain PRs, budget 800 lines, stacked-to-main
   - Close the issue automatically on PR merge via `Closes #N`

### Where the worktree ID is resolved today

`resolveContextMenuTarget()` at `XyFlowCanvas.tsx:379-400` is the **single** place the worktree ID is picked. It is also used by `handleContextMenuPick` (New Shell / Claude / Codex / etc.) and `handleIssueContextMenuPick` (Traer issues de GitHub).

```ts
const resolveContextMenuTarget = useCallback(() => {
  const { focusedProjectId, focusedWorktreeId, projects: currentProjects } = useProjectStore.getState();
  let projectId = focusedProjectId;
  let worktreeId = focusedWorktreeId;
  if (!projectId || !worktreeId) {
    const fallbackProject = currentProjects[0];
    const fallbackWorktree = fallbackProject?.worktrees[0];
    if (!fallbackProject || !fallbackWorktree) return null;
    projectId = fallbackProject.id;
    worktreeId = fallbackWorktree.id;
  }
  // ... return { projectId, worktreeId, worktree }
}, []);
```

It does **not** know about the issue — it is purely focused-worktree-or-fallback.

### How `syncWorktrees` + `syncProjectWorktrees` generate IDs

- `useProjectStore.getState().syncWorktrees(projectPath, worktrees)` (`projectStore.ts:586-626`): top-level method, looks up the project by `projectPath` and delegates to `syncProjectWorktrees`.
- `syncProjectWorktrees(project, worktrees)` (`projectStore.ts:271-312`): the per-project worker.
  - Builds `existingByPath = new Map(project.worktrees.map(w => [w.path, w]))`.
  - For each scanned worktree, if path is new: `id: generateId(), name: branch, path, isPrimary, terminals: []`.
  - If path exists, reuses the existing `id` (preserves terminal state across re-scans).
  - Guarantees the main worktree (path === `project.path`) is preserved.
  - If nothing changed, returns the input reference (so React's referential equality short-circuits).
- After `syncWorktrees` returns, the `syncWorktrees` action also calls `cleanupRemovedTerminalIds` for any worktree that disappeared from the scan, and `markDirty()` (projectStore.ts:625).

`generateId()` (`projectStore.ts:188-190`):

```ts
let idCounter = 0;
export function generateId(): string {
  return `${Date.now()}-${++idCounter}`;
}
```

Stable enough for a single-process store; identical-pattern usage in `createTerminal`.

### How the `createWorktree` API works (preload bridge)

Type contract (`src/types/index.ts:644-654`):

```ts
createWorktree: (
  repoPath: string,
  branch: string,
) => Promise<
  | { ok: true; path: string; worktrees: { path: string; branch: string; isPrimary: boolean }[] }
  | { ok: false; error: string }
>;
```

Renderer side (`src/components/ProjectTree.tsx:86-121`, `NewWorktreeInput.submit`):

```ts
const result = await window.termcanvas.project.createWorktree(projectPath, branch);
if (result.ok) {
  useProjectStore.getState().syncWorktrees(projectPath, result.worktrees);
  useNotificationStore.getState().notify("info", t.panel_worktree_created(branch));
} else {
  useNotificationStore.getState().notify("error", t.panel_worktree_create_failed(result.error));
}
```

Backend (`headless-runtime/worktree-control.ts:62-101`):

- `createWorktreeControl` returns `{ list, create, remove }` — the `create` method runs `git worktree add` via `execFileSync`.
- It uses `buildGitWorktreeAddArgs(branch, resolvedWorktree, base)` from `hydra/src/spawn.ts` and `validateWorktreePath` for safety.
- If `worktreePath` is omitted, default is `<repoPath>/.worktrees/<branch-with-slashes-replaced>` (line 54-60). Storage convention: `<repo>/.worktrees/<branch>`.
- After creation, calls `ensureProjectTracked(...)` to refresh the project, and returns the full worktree list (`{path, branch, isPrimary}` per worktree).
- If `baseBranch` is omitted, `getCurrentBranch(repoPath)` is used.

Agent-side HTTP tool (`agent/src/tools/worktree.ts`): same contract, `POST /worktree/create` with `{repo, branch, path?, baseBranch?}`.

### Existing error handling for terminal creation

`createTerminalInScene` has **no internal error handling** — it is expected to succeed synchronously. It will throw if `useProjectStore.getState().addTerminal` does not find the `projectId`/`worktreeId` (no try/catch upstream either).

The `RESOLVER ISSUE` handler (`XyFlowCanvas.tsx:1054-1085`) has no try/catch around `createTerminalInScene` either. By contrast, the `Traer issues de GitHub` handler at line 417 wraps its whole body in try/finally and has full toast + dialog error reporting.

The `NewWorktreeInput.submit` (the existing UI pattern for creating a worktree) DOES have full error handling: try/catch around the IPC call, sets `busy` to disable the input, surfaces failures through the notification store. This is the pattern the new handler should mirror.

### Existing test coverage

| Test file | What it covers |
|-----------|----------------|
| `tests/terminal-scene-actions.test.ts` | `createTerminalInScene` (adds a terminal, focus), `buildWorktreeGroupMove`, `commitWorktreeGroupMove`. 4 tests, 426 lines. |
| `tests/project-store-sync-worktrees.test.ts` | `syncWorktrees` no-op, renamed branch, add/remove, preserve main, focus normalization, `addTerminal` auto-tags, `removeTerminal` focus handling. 7 tests, 236 lines. |
| `tests/issue-store.test.ts` | dedup by issue number, `hasIssue`, `removeIssue`, `addIssue` only-new, `hydrateIssues` replaces all. 5 tests, 155 lines. |
| `tests/issue-grid-layout.test.ts` | `computeIssueGridPositions` math. 3 tests, 42 lines. |
| `tests/headless-worktree-control.test.ts` | End-to-end HTTP `/worktree/create` + `/list` + `?DELETE` against a real temp git repo. 1 test, 89 lines. |

**Gaps** relevant to this change:

- No tests for `handleIssueContextMenuPick` or the `RESOLVER ISSUE` handler (the entire flow is uncovered in `XyFlowCanvas.tsx`).
- No tests for the combined `createWorktree` → `syncWorktrees` → `createTerminalInScene` chain as the new handler will perform.
- No tests for `pickPlacement` on a new empty worktree (all 4 anchor strategies fall through).

### `pickPlacement` (`src/canvas/terminalPlacement.ts:201-296`) — how it behaves for a new empty worktree

Order of anchors when `preferredPosition` is set (it IS set in the RESOLVER handler):

1. `preferredPosition` wins — `anchor = preferredPosition` (line 207). So the terminal lands under the issue card, as today.
2. `collectRects` + `resolveCollisions` then nudge OTHER visible tiles out of the way. The placeholder is added at `(x, y, w, h)` and the collision resolver is called with the placeholder as the **anchor** (i.e. it can move the placeholder, but won't if there's no collision).
3. Result: a new terminal in a new empty worktree with `preferredPosition` lands **exactly at the issue card's bottom-center**, with existing terminals in OTHER worktrees nudged if they overlap.

This is the right behavior for this feature — the user wants the new terminal visually attached to the issue card regardless of which worktree it lives in.

### Existing branch naming conventions

There is **no** existing convention for "issue worktree branches" — this change must define one. Existing patterns in the codebase:

- `NewWorktreeInput` placeholder: `"branch name"` (`src/i18n/en.ts:680`).
- Test fixtures use `feature/cloud`, `feature/new-name`, `feature/x` (arbitrary).
- The agent tool accepts any string.
- Worktree paths default to `<repoPath>/.worktrees/<branch>` with `/` replaced by `-`.

**Recommended new convention** (proposal-only, not decided):

- Branch: `issue-<N>-<slug>` (e.g. `issue-2-worktree-isolation`).
- Slug: lowercase, kebab-case, max 50 chars from the issue title; truncate at word boundary; strip trailing non-alphanumerics.
- Sanitization: replace any char not matching `[a-z0-9-]` with `-`, collapse repeated dashes, strip leading/trailing dashes.
- Worktree path: `<repoPath>/.worktrees/issue-<N>-<slug>` (reuses the default path).

### Existing visual / state artifacts tied to the current behavior

- `resolveArrows` (`XyFlowCanvas.tsx:358-360, 944-996`): a local `useState` of `{ issueId, terminalId }` pairs that renders an SVG arrow from issue card to terminal. The new worktree changes nothing here, but the terminal lives in a different worktree, so the arrow still works because it only knows the `terminalId`.
- `setResolveArrows` is never reset on success — arrows accumulate over the session. Not the new feature's problem but worth noting.

## What Needs to Change

The new handler for the `RESOLVER ISSUE` context-menu click must, **in order**:

1. Read the issue from `useIssueStore.getState().getIssue(issueNumber)`.
2. Build a sanitized branch name from the issue number + title (`issue-<N>-<slug>`).
3. Determine the base path: `target.worktree.path` (from `resolveContextMenuTarget()`, which gives the focused worktree — same repo).
4. Call `window.termcanvas.project.createWorktree(target.worktree.path, branch)` (where `target.worktree.path` is the worktree on which the issue was fetched, and which is a valid git repo dir).
5. On `result.ok`:
   - `useProjectStore.getState().syncWorktrees(projectPath, result.worktrees)` to pick up the new entry with a fresh `id`.
   - Find the freshly created worktree in the synced list (`result.worktrees.find(w => w.branch === branch)` → locate its `id` from the post-sync store).
   - Compute the flow position from the issue card's DOM rect (same as today).
   - Call `createTerminalInScene({ projectId: target.projectId, worktreeId: NEW_WORKTREE_ID, type: "opencode", title: "Issue #N — <title>", initialPrompt, position, autoApprove: true })`.
   - Append a `resolveArrows` entry as today.
   - Optionally `setFocusedWorktree(projectId, NEW_WORKTREE_ID)` so subsequent `cmd+t` targets the new worktree.
   - Toast `panel_worktree_created(branch)` on success and a follow-up info "Terminal started in new worktree".
6. On `result.ok === false`:
   - Toast `panel_worktree_create_failed(error)`.
   - Optional: still create the terminal in the focused worktree as a fallback, OR abort entirely. Recommendation: **abort** — the whole point of the feature is the isolation.
7. On thrown exception from the IPC call:
   - Toast the error message; do NOT create the terminal.

**Status / busy state** is needed because `git worktree add` may take a few seconds for large repos. Mirror the `isFetchingIssues` pattern (`XyFlowCanvas.tsx:350`): a `useState<boolean>` like `isCreatingWorktree`, and disable the menu item label or show a spinner.

**i18n keys** to add (likely to `src/i18n/en.ts` and the other locales):

- `issue_resolve_creating_worktree: "Creating worktree…"` — shown while busy.
- `issue_resolve_worktree_failed: (err: string) => `Failed to create worktree for issue: ${err}``.
- `issue_resolve_terminal_started: (branch: string) => `Terminal started in new worktree "${branch}"``.
- (Optional) `issue_resolve_fallback_to_focused: "Falling back to current worktree…"` — only if we decide to support fallback.

## Affected Areas

| File | Action | Why |
|------|--------|-----|
| `src/canvas/XyFlowCanvas.tsx` | Modify | The `RESOLVER ISSUE` handler at lines 1054-1085; add `isCreatingWorktree` state, async handler, error path. |
| `src/canvas/issueWorktreeNaming.ts` (new) | Create | `buildIssueBranchName(issue)` returning `{ branch, path, slug }` with sanitization. |
| `tests/issue-worktree-naming.test.ts` (new) | Create | Sanitization edge cases: empty title, very long title, unicode, special chars, leading/trailing dashes, slug length cap. |
| `tests/issue-resolve-worktree.test.ts` (new) | Create | Mock `window.termcanvas.project.createWorktree` and `useProjectStore.syncWorktrees` and assert: (a) success path picks up the new worktree ID and calls `createTerminalInScene` with it; (b) failure path does NOT call `createTerminalInScene`; (c) the `initialPrompt` is unchanged. |
| `src/i18n/en.ts` (+ other locales) | Modify | Add the 3-4 new strings above. |

## Edge Cases and Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `git worktree add` fails (branch exists, dirty main, no space, no .worktrees dir) | Medium | Mirror the existing `NewWorktreeInput` error path: catch and toast; do NOT create a terminal. |
| Long-running `git worktree add` blocks the UI thread | Medium | Already async via `window.termcanvas.project.createWorktree`; the IPC handler is the headless server which does `execFileSync` — could block the entire headless process. For most repos it is fast (<1s). Document this and consider a future enhancement to use async `execFile`. |
| Sanitization produces a colliding branch name (e.g. very short titles) | Low | If `createWorktree` returns `ok: false` due to existing branch, retry with `-2`, `-3` suffix. The `defaultWorktreePath` from `worktree-control.ts:54-60` only sanitizes `/` and `\`, so collisions are possible. |
| `pickPlacement` with the new empty worktree may place the terminal at the project-wide rightmost sibling's `x` if `preferredPosition` is somehow missing — current code always sets it. | Low | Belt-and-suspenders: always set `preferredPosition`. |
| `useProjectStore.syncWorktrees` returns the same reference when nothing changed (`projectStore.ts:304-309`). If the new worktree was created but the worktree scan ran first against the new state, the new branch IS present and the id is generated. Verified. | Low | None. |
| `resolveArrows` accumulates across issues and across the session. | Low | Pre-existing, not this change's problem. |
| The issue store's `issue.worktreeId` becomes stale (still points at the original worktree, but the resolution lives in a new one). | Low | Decide: leave the issue's `worktreeId` as the **source worktree** (where `gh` was run), because that is what `__worktreePath` already encodes. The new worktree is a transient container for the resolution. Document this in the spec. |
| The `__worktreePath` on the issue is the original worktree, not the project root. Calling `createWorktree` with `repoPath = __worktreePath` works (it is a valid git working tree) and the new worktree will be created at `__worktreePath/.worktrees/<branch>`. | High | This is the correct path — pass `__worktreePath` as `repoPath`, not `target.worktree.path` (which may equal `__worktreePath` anyway, but be explicit). |
| `createWorktree` from a non-primary worktree creates a worktree nested under the non-primary. Subsequent `git worktree list` from the repo root sees it correctly. | Low | Behavior matches the existing `NewWorktreeInput` which uses `projectPath`. We pass the worktree's own path. This is correct. |
| `setFocusedWorktree` may steal focus from the issue the user just right-clicked. | Low | Defer this call; only set focus if the user did not refocus another worktree in the meantime. Simpler: just leave the focus as-is and let the user click on the new worktree in the panel if they want. |
| The OpenCode `initialPrompt` instructs OpenCode to auto-merge via `Closes #N`. If the worktree isolation is silently bypassed (fallback), the PR creation will use the focused worktree's branch as the base, which is wrong. | Low | Spec must say: on worktree-creation failure, ABORT (do not fall back). The whole point of this issue is isolation. |
| Idempotency: user right-clicks the same issue twice → second click creates a second worktree. | Medium | Either: (a) check `useIssueStore.getIssue(N)` and refuse if a previous resolution terminal is already in the store (need to track this); (b) check if a worktree with the issue branch already exists in `syncWorktrees` and reuse it; (c) accept the second worktree and call it `issue-2-2`. **Recommendation: (b) — look up by branch in `result.worktrees`; if the branch already exists, reuse its worktree ID. Avoids duplicates and is idempotent.** |
| `useProjectStore.getState().projects` may not have the new project entry if the `ensureProjectTracked` call inside the headless backend created a new project (it shouldn't, because the repo is already tracked, but the IPC flow runs `ensureProjectTracked` per request). | Low | Confirmed by `tests/headless-worktree-control.test.ts:63-64`: the project is already tracked. No risk. |
| `addTerminal` auto-tags with `worktree:<name>` (projectStore.ts:632-643). The tag will say `worktree:issue-2-worktree-isolation` which is fine. | None | None. |

## Dependencies on Other Systems

- **Electron IPC**: `window.termcanvas.project.createWorktree(repoPath, branch)` — already exists, returns the new path + the full worktree list. No new bridge work needed.
- **Headless HTTP API**: `POST /worktree/create` with `{repo, branch}` — already implemented in `headless-runtime/worktree-control.ts:72-101`. No new endpoint needed.
- **Zustand stores**: `useProjectStore` (sync, addTerminal, setFocusedWorktree), `useNotificationStore` (toast), `useIssueStore` (read issue) — all already exist. No new store.
- **Existing test harness**: `installActionGlobals` in `tests/terminal-scene-actions.test.ts:17-61` is the standard pattern for unit-testing scene actions; reuse for the new test.
- **Branch sanitization**: no library — implement a small `slugify` (10-20 lines) that mirrors the conventions of `slugify` npm packages but without taking a dependency.
- **`hydra/src/spawn.ts` `buildGitWorktreeAddArgs` and `validateWorktreePath`**: used by the backend, no need to touch.

## Open Questions for the Proposal Phase

1. **Branch naming**: `issue-<N>-<slug>` confirmed? Or include the repo name to avoid cross-project collisions in monorepos? (Single-repo per project today, so probably not needed.)
2. **Idempotency**: should the handler reuse an existing `issue-<N>-<slug>` worktree if one already exists, or always create a new one? Recommendation: **reuse**.
3. **Should the issue card's `worktreeId` be updated to point at the new worktree, or left pointing at the source?** Recommendation: **leave it** — the issue's `__worktreePath` is the source repo where `gh` was invoked; the new worktree is a transient container.
4. **Should we set `setFocusedWorktree` to the new worktree on success?** Recommendation: **yes**, so subsequent `cmd+t` creates a new terminal in the same isolation context.
5. **Should the prompt mention the worktree path explicitly** (e.g. "you are now in `<path>`")? The agent discovers the worktree via `git rev-parse --show-toplevel`, so probably not needed.
6. **Should there be a `ConfirmDialog` confirmation** before creating the worktree (analogous to the remove dialog)? Or fire-and-forget like today? Recommendation: **fire-and-forget** with a busy label — matches the existing `NewWorktreeInput` UX (which only fails gracefully via toast).

## Ready for Proposal

**Yes.** All inputs are mapped, the change is well-scoped (one handler, one new helper, one new test file, 3-4 new i18n keys), the API contracts exist, and the risks are well-understood. The change can be delivered in a single PR well under the 400-line budget (estimated ~150-220 lines including tests).
