# Proposal: GitHub Issues Canvas

## Intent

Let users visualize open GitHub issues as interactive cards on the TermCanvas infinite canvas, sourced from the focused worktree's repository. Fetch via `gh` CLI, display as nodes, persist across sessions. Resolve/link actions deferred.

## Scope

### In Scope
- Context menu item "Traer issues de GitHub" in canvas right-click menu
- IPC bridge (`github:fetch-issues`) from renderer to Electron main process running `gh issue list --state open --json number,title,body,url,labels`
- Parse `gh` JSON; handle empty repos gracefully
- New `issue` node type: visual card showing `#number`, title, labels (colored if available)
- Grid layout: offset from focused worktree position, 3 columns, wrap to next row
- Deduplicate by issue number on re-fetch (skip existing)
- Persist issue nodes via SceneDocument (add `issues` field, backward-compat with v3)
- Click opens issue URL in default browser
- Toast + dialog on `gh` CLI failure (not installed, no auth, no network)

### Out of Scope
- Resolve/close/comment on issues
- Terminal creation from issue cards
- Pin system interaction
- Real-time sync (polling/webhooks)
- Filtering, search, detail view
- Changes to existing terminal/worktree behavior

## Capabilities

### New Capabilities
- `github-issues-canvas`: fetch, display, persist interactive GitHub issue cards on the canvas

### Modified Capabilities
- None — no existing `openspec/specs/` to modify.

## Approach

1. Extract `resolveContextMenuTarget()` from `handleContextMenuPick` in XyFlowCanvas.tsx
2. New `useIssueStore` (Zustand): `issues`, `addIssue`, `removeIssue`, `hasIssue(number)`
3. New `IssueNodeData` interface + union type in `nodeProjection.ts`, new `buildCanvasFlowIssueNodes()` builder
4. New `IssueNode` component in `xyflowNodes.tsx`, registered in `nodeTypes` map
5. New IPC channel `github:fetch-issues` in Electron preload + main handler
6. Hook issue store into persistence chain: `captureLiveCanvasScene`, `applyCanvasSceneToLive`, `SceneDocument`
7. New `handleIssueContextMenuPick` in XyFlowCanvas.tsx
8. Type guards for `node.type === "issue"` in `handleNodeClick`, `handleNodeDragStop`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/canvas/nodeProjection.ts` | Modified | Union type + new builder |
| `src/canvas/xyflowNodes.tsx` | Modified | IssueNode component + nodeTypes |
| `src/canvas/XyFlowCanvas.tsx` | Modified | Refactor context menu + new handler |
| `src/canvas/canvasSceneIO.ts` | Modified | Persistence for issue nodes |
| `src/canvas/sceneProjection.ts` | Modified | SceneDocument shape |
| `src/stores/issueStore.ts` | New | Issue node store |
| `src/electron/preload.ts` | Modified | New IPC channel |
| `src/electron/main.ts` | Modified | `gh` CLI handler |
| `src/canvas/IssueNode.tsx` | New | Visual card component |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `gh` CLI output format changes between versions | Low | Parse defensively; JSON schema validation on the known fields |
| Issue nodes collide with terminal nodes | Low | Fixed grid offset from worktree; collision resolver can be extended later |
| SceneDocument v3 backward-compat breaks on `issues` field | Low | Add optional `issues?: IssueNode[]` — missing = empty array |

## Rollback Plan

Revert commit. Scene documents saved with `issues` field remain valid (optional field, ignored by older code). No data loss risk.

## Dependencies

- `gh` CLI installed and authenticated on user's machine (runtime dependency, not build)

## Success Criteria

- [ ] Right-click canvas → "Traer issues de GitHub" appears and is interactive
- [ ] Issues render as cards with number, title, labels in a 3-column grid
- [ ] Re-fetching only adds new issues (no duplicates)
- [ ] Issue cards survive app restart
- [ ] Click opens browser to GitHub issue URL
- [ ] `gh` not installed → toast + dialog with actionable fix instructions
