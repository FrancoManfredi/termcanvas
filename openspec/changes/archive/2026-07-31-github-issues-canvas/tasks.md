# Tasks: GitHub Issues Canvas

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Review budget (user-set) | 800 changed lines |
| Estimated changed lines | ~1128 (1050–1200) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |
| Decision needed before apply | Yes |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (fallback split if size:exception declined)

| Unit | Scope | Focused test command | Runtime harness | Rollback boundary |
|------|-------|---------------------|-----------------|-------------------|
| PR 1: Foundation | T1–T2 | `npx tsx --test tests/issue-store.test.ts tests/issue-grid-layout.test.ts` | N/A — pure logic, no UI yet | Revert store/types/grid files; no consumers, zero impact |
| PR 2: IPC | T3 | `npx tsx --test tests/github-issues-fetch.test.ts` | N/A — Electron IPC needs app runtime; covered by mocked `execFile` tests | Revert preload.ts/main.ts only |
| PR 3: Render + wiring | T4–T9 | `npx tsx --test tests/node-projection-issue.test.ts tests/scene-issue-persistence.test.ts` + `npm run typecheck` | `npm run dev` → right-click canvas → "Traer issues de GitHub" | Revert canvas files; store/types remain valid |

## Phase 1: Foundation (types, store, layout)

### T1 — Issue types + Zustand store
- **Files**: `src/types/scene.ts` (mod), `src/stores/issueStore.ts` (new), `tests/issue-store.test.ts` (new)
- **Deps**: none
- **Acceptance**: `PersistedIssueNode` interface; optional `issues?: PersistedIssueNode[]` on `SceneDocument` (missing → `[]`). `useIssueStore` with `Map<number, IssueNodeData>` keyed by `issueNumber`: `addIssue` (dedup by number), `removeIssue`, `hasIssue`, `getAllIssues`. Tests: dedup, hasIssue, add-only-new.
- **Est**: 115
- [x] DONE

### T2 — Grid layout
- **Files**: `src/canvas/issueGridLayout.ts` (new), `tests/issue-grid-layout.test.ts` (new)
- **Deps**: none
- **Acceptance**: `computeIssueGridPositions(worktreePos, index)` — 3 columns, 320×120 cards, 30×20 gaps, offset clear of worktree. Parameterized tests: 7 issues → rows at indexes 0–2 / 3–5 / 6; no overlap with worktree node.
- **Est**: 105
- [x] DONE

## Phase 2: Core (IPC, node component, projection)

### T3 — IPC `github:fetch-issues` (RED tests first)
- **Files**: `electron/preload.ts` (mod), `electron/main.ts` (mod), `tests/github-issues-fetch.test.ts` (new)
- **Deps**: T1
- **Acceptance**: RED tests for threat-matrix subprocess row with mocked `execFile`: `ENOENT` → install dialog; auth error → `gh auth login`; network → retry once then toast; valid JSON → parse `number`/`title`/`url` required, `body`/`labels` optional with defaults (`""`, `[]`); `[]` → no nodes. Then GREEN: `ipcMain.handle("github:fetch-issues", cwd)` — validate cwd is a known worktree path, 30s timeout, run `gh issue list --state open --json number,title,body,url,labels`; preload exposes `window.termcanvas.github.fetchIssues(cwd)`.
- **Est**: 195
- [x] DONE

### T4 — IssueNode component
- **Files**: `src/canvas/IssueNode.tsx` (new), `src/canvas/xyflowNodes.tsx` (mod)
- **Deps**: T1
- **Acceptance**: Card shows `#number`, title, label chips with `color` when present, hidden label row when none; no resizer, no PTY. Registered as `issue: IssueNode` in `xyflowNodeTypes`.
- **Est**: 123
- [x] DONE

### T5 — Node projection
- **Files**: `src/canvas/nodeProjection.ts` (mod), `tests/node-projection-issue.test.ts` (new)
- **Deps**: T1, T2
- **Acceptance**: `IssueNodeData` interface; `CanvasFlowNode` union extends with `Node<IssueNodeData, "issue">`; `buildCanvasFlowIssueNodes(issues, projectId, worktreeId)` emits positioned issue nodes (grid via T2).
- **Est**: 155
- [x] DONE

## Phase 3: Integration

### T6 — Persistence
- **Files**: `src/canvas/sceneProjection.ts` (mod), `src/canvas/canvasSceneIO.ts` (mod), `tests/scene-issue-persistence.test.ts` (new)
- **Deps**: T1
- **Acceptance**: `buildSceneDocument` includes `issues` from `getAllIssues()` with x/y; `sceneDocumentToLegacyState` returns issues; `captureLiveCanvasScene` snapshots store; `applyCanvasSceneToLive` hydrates store (missing field → `[]`). Tests: save/load round-trip; v3 doc without `issues` loads clean.
- **Est**: 180
- [x] DONE

### T7 — Context menu + fetch handler
- **Files**: `src/canvas/XyFlowCanvas.tsx` (mod)
- **Deps**: T1, T3, T5
- **Acceptance**: Extract `resolveContextMenuTarget()` from `handleContextMenuPick` with no behavior change; "Traer issues de GitHub" item only when worktree context resolves; `handleIssueContextMenuPick` → resolve → `fetchIssues(cwd)` → parse → skip via `hasIssue` → `addIssue` → `buildCanvasFlowIssueNodes`; empty result → toast "no open issues".
- **Est**: 150
- [x] DONE

### T8 — Handler type guards
- **Files**: `src/canvas/XyFlowCanvas.tsx` (mod)
- **Deps**: T1
- **Acceptance**: `handleNodeClick` on `node.type === "issue"` invokes `shell.openExternal(issue.url)`; `handleNodeDragStop` persists issue position to store; terminal/other node behavior unchanged.
- **Est**: 25
- [x] DONE

## Phase 4: Error handling + verification

### T9 — Error UX
- **Files**: `src/canvas/XyFlowCanvas.tsx` (mod), `electron/main.ts` (mod)
- **Deps**: T1, T3, T7
- **Acceptance**: On fetch failure — toast via existing notify + renderer modal (ConfirmDialog-style, single OK) suggesting install link / `gh auth login` / network check; main classifies ENOENT vs auth vs network; no unhandled rejections.
- **Est**: 80
- [x] DONE

### T10 — Full verification
- **Files**: none
- **Deps**: T1–T9
- **Acceptance**: `npm run typecheck` clean; full `npm test` green; `npm run dev` manual pass of all proposal success criteria (menu, cards, dedup on re-fetch, restart persistence, click opens URL, gh-missing dialog).
- **Est**: 0
- [x] DONE

**Total estimated**: ~1128 changed lines | **Budget**: 800 → exceeds; single PR requires `size:exception`.
