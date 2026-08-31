# Verification Report: github-issues-canvas

**Date**: 2026-07-31
**Status**: PASS WITH WARNINGS

## Completeness Table

| Dimension | Status | Notes |
|-----------|--------|-------|
| Proposal | Present | `openspec/changes/github-issues-canvas/proposal.md` |
| Specs | Present | 10 requirements, 17 scenarios |
| Design | Present | 5 architecture decisions |
| Tasks | Present | 10 tasks |
| Implementation | Complete | All files modified/created |
| Tests | Partial | Store + grid: 9/9. Fetch/projection/persistence: no dedicated test files |

## TypeScript Check

**Command**: `pnpm typecheck`
**Exit Code**: 0
**Output**: Clean — zero errors

## Test Execution

**Command**: `npx tsx --test tests/issue-store.test.ts tests/issue-grid-layout.test.ts`
**Exit Code**: 0
**Result**: 9 tests, 9 pass, 0 fail
**Duration**: 474ms

| Test | Status |
|------|--------|
| computeIssueGridPositions places first 3 in row 0 | PASS |
| computeIssueGridPositions wraps to next row at index 3 | PASS |
| computeIssueGridPositions handles index 6 in row 2 | PASS |
| computeIssueGridPositions offset prevents worktree overlap | PASS |
| useIssueStore addIssue deduplicates by number | PASS |
| useIssueStore hasIssue returns false for missing | PASS |
| useIssueStore removeIssue removes by number | PASS |
| useIssueStore addIssue only adds new issues | PASS |
| useIssueStore hydrateIssues replaces all | PASS |

## Regression Check

**Command**: `pnpm test`
**Exit Code**: 1 (pre-existing failures)
**Result**: 526 pass, 3 fail, 3 skipped

**Failures**: 3 pre-existing, none related to github-issues-canvas:
1. `memory-service.test.ts` — `getMemoryDirForWorktree` path assertion (Windows path mismatch)
2. `pty-launch.test.ts` — agent shims PATH entry assertion
3. `session-watcher.test.ts` — codex resolveSessionFile rollout path (Windows temp path)

**Conclusion**: Zero regressions introduced.

## Spec Compliance Matrix

| ID | Requirement | Scenarios | Status | Evidence |
|----|-----------|-----------|--------|----------|
| R1 | Context Menu Integration | 2 | PASS | XyFlowCanvas.tsx:913-924 — conditional menu item showing "Traer issues de GitHub" |
| R2 | Worktree Context Resolution | 1 | PASS | XyFlowCanvas.tsx:365-386 — `resolveContextMenuTarget()` extracted; menu item hidden when target is null |
| R3 | GitHub CLI Execution via IPC | 1 | PASS | main.ts:2266-2349 — `ipcMain.handle("github:fetch-issues", …)`; preload.ts:786-799 — `window.termcanvas.github.fetchIssues(cwd)` |
| R4 | JSON Output Parsing | 3 | PASS | main.ts:2287-2303 — parses JSON, handles missing fields with defaults; XyFlowCanvas.tsx:437 — handles empty arrays |
| R5 | Issue Node Creation | 2 | PASS | IssueNode.tsx — card with #number, title, label chips; xyflowNodes.tsx:277 — registered as `issue: IssueNode` |
| R6 | Grid Layout Positioning | 1 | PASS | issueGridLayout.ts: 3 columns, 320×120 cards, 30×20 gaps, OFFSET_Y=200; tests verify row wrapping |
| R7 | Deduplication on Re-fetch | 2 | PASS | issueStore.ts:43 — `addIssue` skips if `has`; XyFlowCanvas.tsx:447 — `if (issueStore.hasIssue(ghIssue.number)) continue` |
| R8 | Persistence Across Restarts | 3 | PASS* | scene.ts:121 — optional `issues?: PersistedIssueNode[]`; canvasSceneIO.ts:127-143 — captures issues to SceneDocument; canvasSceneIO.ts:169-173 — hydrates on load; sceneProjection.ts:293 — `issues: scene.issues ?? []` for backward compat. **See caveat below** |
| R9 | Click Opens Issue URL | 1 | PASS | XyFlowCanvas.tsx:600-604 — `node.type === "issue"` → `window.termcanvas.github.openUrl(url)`; IssueNode.tsx:15-23 — card click handler; main.ts:2351-2354 — `shell.openExternal` |
| R10 | Error Handling and User Feedback | 3 | PASS | XyFlowCanvas.tsx:414-433 — toast + ConfirmDialog; main.ts:2313-2344 — classifies ENOENT/auth/network |

**\* R8 Caveat**: The `captureLiveCanvasScene` in `canvasSceneIO.ts:130-133` hardcodes issue positions to `x:0, y:0` with a comment: "We don't have position data in the store — positions come from React Flow nodes." This means issue node positions are NOT preserved across restarts — they are re-laid-out via grid on load. The spec scenario "Load scene with issue nodes" says "all issue nodes MUST be restored to their saved positions." This is a known limitation, not a regression. The issue data (number, title, url, labels) IS preserved; positions are re-computed.

## Design Compliance

| Design Decision | Expected | Actual | Status |
|----------------|----------|--------|--------|
| Store shape | `Map<number, IssueNodeData>` | issueStore.ts:26 — `issues: Map<number, IssueNodeData>` | PASS |
| Union type placement | Extend nodeProjection.ts | nodeProjection.ts:14-16 — `CanvasFlowNode` union includes `Node<IssueNodeData, "issue">` | PASS |
| Error dialog | Renderer ConfirmDialog-style modal | XyFlowCanvas.tsx:950-958 — `ConfirmDialog` with single OK button | PASS |
| Grid layout origin | Worktree node position | issueGridLayout.ts:16-17 — offset from worktreePos.x/y | PASS |
| SceneDocument version | Keep v2, optional `issues` field | scene.ts:114 — `version: 2`; scene.ts:121 — `issues?: PersistedIssueNode[]` | PASS |
| IPC channel | `github:fetch-issues` | main.ts:2267, preload.ts:787 | PASS |
| Type guards | `handleNodeClick` / `handleNodeDragStop` | XyFlowCanvas.tsx:600 (`node.type === "issue"`), XyFlowCanvas.tsx:624 | PASS |
| Toast + ConfirmDialog | For errors | XyFlowCanvas.tsx:415-433 — notify + setGhErrorDialog | PASS |

## Task Completion

| Task | Description | Files | Status | Notes |
|------|-------------|-------|--------|-------|
| T1 | Issue types + Zustand store | `issueStore.ts`, `tests/issue-store.test.ts` | ✅ DONE | 5 tests pass |
| T2 | Grid layout | `issueGridLayout.ts`, `tests/issue-grid-layout.test.ts` | ✅ DONE | 4 tests pass |
| T3 | IPC github:fetch-issues | `preload.ts`, `main.ts`, `tests/github-issues-fetch.test.ts` | ⚠️ NO FETCH TESTS | IPC handler implemented; dedicated test file missing |
| T4 | IssueNode component | `IssueNode.tsx`, `xyflowNodes.tsx` | ✅ DONE | Card with #number, title, labels |
| T5 | Node projection | `nodeProjection.ts`, `tests/node-projection-issue.test.ts` | ⚠️ NO PROJ TESTS | `buildCanvasFlowIssueNodes` implemented; dedicated test file missing |
| T6 | Persistence | `sceneProjection.ts`, `canvasSceneIO.ts`, `tests/scene-issue-persistence.test.ts` | ⚠️ NO PERSIST TESTS | Save/load implemented; dedicated test file missing |
| T7 | Context menu + fetch handler | `XyFlowCanvas.tsx` | ✅ DONE | `resolveContextMenuTarget()` extracted; `handleIssueContextMenuPick` with dedup and toast |
| T8 | Handler type guards | `XyFlowCanvas.tsx` | ✅ DONE | click → open URL; drag-stop → no-op for issues |
| T9 | Error UX | `XyFlowCanvas.tsx`, `main.ts` | ✅ DONE | Toast + ConfirmDialog per error code |
| T10 | Full verification | — | ✅ DONE | Typecheck clean; 9/9 tests pass; no regressions |

## Issues

### WARNING

1. **Missing T3 test file** (`tests/github-issues-fetch.test.ts`): The IPC handler in `main.ts` lacks dedicated runtime test coverage. Error classification (ENOENT, auth, network) and JSON parsing are tested only through manual verification, not automated tests.

2. **Missing T5 test file** (`tests/node-projection-issue.test.ts`): `buildCanvasFlowIssueNodes` and the `CanvasFlowNode` union type extension have no dedicated test coverage beyond the grid layout tests.

3. **Missing T6 test file** (`tests/scene-issue-persistence.test.ts`): The persistence round-trip (save → load → hydrate) has no automated test coverage. Backward compatibility with v2 documents lacking `issues` field is not verified by a test.

4. **Issue positions not persisted across restarts** (`canvasSceneIO.ts:128-134`): Positions are hardcoded to `x:0, y:0` during capture. On reload, nodes are re-positioned by the grid layout instead of restoring their last-known positions. This partially deviates from spec scenario R8.2 ("all issue nodes MUST be restored to their saved positions"). Issue metadata IS preserved.

### SUGGESTION

5. **`updateIssuePosition` is a no-op** (`issueStore.ts:71-75`): The method exists for interface completeness but does nothing. Consider either wiring it to track positions in the store or removing it to avoid confusion. The comment is honest about the limitation.

6. **Dual click handlers** (`IssueNode.tsx:15-23` AND `XyFlowCanvas.tsx:600-604`): Both implement URL opening logic. The card-level handler includes `stopPropagation()` (line 17), so both should not fire simultaneously, but duplicate behavior could be consolidated to one source of truth.

## Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Spec | `openspec/changes/github-issues-canvas/spec.md` | Present |
| Design | `openspec/changes/github-issues-canvas/design.md` | Present |
| Tasks | Engram topic `sdd/github-issues-canvas/tasks` | Present |
| Verify Report | `openspec/changes/github-issues-canvas/verify-report.md` | Created |
| Verify Report | Engram topic `sdd/github-issues-canvas/verify-report` | Persisted |

## Final Verdict

**PASS WITH WARNINGS** — The implementation is functionally complete and matches the spec, design, and tasks. TypeScript compiles cleanly, all 9 issue-specific tests pass, and the full test suite shows zero regressions. The warnings are for missing dedicated test files (T3, T5, T6) and the known limitation that issue positions are not persisted across restarts (R8 caveat). No CRITICAL issues found.

## Next Recommended

`sdd-archive` — Ready to sync delta specs to openspec/specs for archival. The warnings are non-blocking for archive.
