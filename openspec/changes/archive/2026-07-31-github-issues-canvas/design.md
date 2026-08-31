# Design: GitHub Issues Canvas

## Technical Approach

Add a new `issue` node type to the React Flow canvas backed by a dedicated Zustand store. Fetch open issues via `gh` CLI through an Electron IPC bridge, render them as non-resizable cards in a 3-column grid offset from the focused worktree, and persist them through the existing `SceneDocument` pipeline.

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|---|---|---|---|
| Store shape | `Map<number, IssueNodeData>` vs `IssueNodeData[]` | Map gives O(1) dedup by number; array is simpler to persist | `Map<number, IssueNodeData>` in store, array for serialization |
| Union type placement | `nodeProjection.ts` vs new file | nodeProjection already owns `CanvasFlowNode` | Extend `nodeProjection.ts` |
| Error dialog | Main `dialog.showMessageBox` vs renderer modal | Main dialog blocks all windows; renderer modal keeps UX consistent | Renderer `ConfirmDialog`-style modal with single OK button |
| Grid layout origin | Worktree node position vs canvas click position | Worktree position is stable and matches spec | Worktree position from `projectStore` |
| `SceneDocument` version bump | Bump to v3 vs optional field on v2 | Optional field with default `[]` preserves backward compat | Keep v2, add optional `issues` field |

## Data Flow

    ContextMenu ──→ resolveContextMenuTarget() ──→ IPC github:fetch-issues
                                                        │
    Main: execFile("gh", ["issue", "list", ...]) ←──────┘
         │
    JSON parse ──→ renderer ──→ useIssueStore.addIssue() ──→ buildCanvasFlowIssueNodes()
         │                                                            │
    Error ──→ notify() + ErrorDialog                              ReactFlow nodes
         │
    autosave ──→ captureLiveCanvasScene ──→ SceneDocument.issues

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/stores/issueStore.ts` | Create | Zustand store: `issues: Map<number, IssueNodeData>`, `addIssue`, `removeIssue`, `hasIssue`, `getAllIssues` |
| `src/canvas/nodeProjection.ts` | Modify | `IssueNodeData` interface; union `CanvasFlowNode`; `buildCanvasFlowIssueNodes()` builder |
| `src/canvas/IssueNode.tsx` | Create | Visual card: `#number`, title, label chips with colors; no resizer, no PTY |
| `src/canvas/xyflowNodes.tsx` | Modify | Register `issue: IssueNode` in `xyflowNodeTypes` |
| `src/canvas/XyFlowCanvas.tsx` | Modify | Extract `resolveContextMenuTarget()`; add `handleIssueContextMenuPick`; type guards in `handleNodeClick` / `handleNodeDragStop`; add menu item + `ErrorDialog` state |
| `src/canvas/canvasSceneIO.ts` | Modify | Include `useIssueStore.getState().getAllIssues()` in `captureLiveCanvasScene`; hydrate issue store in `applyCanvasSceneToLive` |
| `src/canvas/sceneProjection.ts` | Modify | `buildSceneDocument` accepts `issues`; `sceneDocumentToLegacyState` returns `issues` |
| `src/types/scene.ts` | Modify | `SceneDocument` gets optional `issues?: PersistedIssueNode[]` |
| `electron/preload.ts` | Modify | Expose `window.termcanvas.github.fetchIssues(cwd: string)` |
| `electron/main.ts` | Modify | `ipcMain.handle("github:fetch-issues", ...)` spawns `gh issue list` with JSON output; catches `ENOENT`, auth errors, network errors |
| `src/canvas/issueGridLayout.ts` | Create | `computeIssueGridPositions(worktreePos, index)`: 3 columns, 320×120 cards, 30×20 gaps |

## Interfaces / Contracts

```typescript
export interface IssueNodeData {
  issueId: string;      // generated uuid
  projectId: string;
  worktreeId: string;
  issueNumber: number;
  title: string;
  body: string;
  url: string;
  labels: { name: string; color?: string }[];
}

export interface PersistedIssueNode {
  issueId: string;
  projectId: string;
  worktreeId: string;
  issueNumber: number;
  title: string;
  body: string;
  url: string;
  labels: { name: string; color?: string }[];
  x: number;
  y: number;
}

export type CanvasFlowNode =
  | Node<TerminalNodeData, "terminal">
  | Node<IssueNodeData, "issue">;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `issueStore` dedup, `hasIssue`, `markDirty` | Jest/Zustand store tests |
| Unit | `computeIssueGridPositions` math | Jest with parameterized cases |
| Unit | `gh` JSON parser (empty, missing fields, colors) | Jest |
| Integration | IPC round-trip with mocked `execFile` | Electron test runner or mock |
| E2E | Context menu → cards render → click opens URL | Playwright / Spectron equivalent |

## Threat Matrix

| Boundary | Applicable | Safe Behavior | Failure Mode | RED Test |
|---|---|---|---|---|
| Subprocess (`gh` CLI) | **Yes** | Validate cwd is within a known worktree path before spawning; timeout 30s | `ENOENT` → dialog suggests install; auth error → suggests `gh auth login`; network → retry once then toast | Test each error code path |
| Executable-file classification | N/A | — | — | — |
| Routing / VCS / PR automation | N/A | — | — | — |
| Process integration | N/A | — | — | — |

## Migration / Rollout

No migration required. `SceneDocument` v2 remains valid; missing `issues` defaults to `[]` on load. Rollback: revert commit — old code ignores optional `issues` field without data loss.

## Open Questions

- [ ] Should issue cards support drag-to-new-position persistence? (spec says yes via drag handlers)
- [ ] Should re-fetching update titles/labels of existing issues, or only skip? (spec says skip — dedup only)
