# Archive Report: github-issues-canvas

**Date**: 2026-07-31
**Status**: ARCHIVED — PASS WITH WARNINGS
**Change**: `github-issues-canvas`
**Artifact store**: hybrid (Engram + OpenSpec)

## Review Gate

No review infrastructure governs this change: no `reviews/` directory, no review policy/ledger/receipt, and no native review gate was enabled in `openspec/config/config.yaml` (no review kill-switch or delivery config present). Review delivery is therefore `disabled/unmanaged`; archive proceeds without a terminal receipt, consistent with the native gate relaxation. No `reviewGate` structured status was supplied by the orchestrator.

## Final State Summary

The GitHub Issues Canvas capability is implemented, verified, and accepted for archive. Users can fetch open GitHub issues via the `gh` CLI, render them as interactive `issue` cards in a 3-column grid offset from the focused worktree, deduplicate on re-fetch, persist them across restarts, and open the issue URL on click.

### Verification Result

- **Verdict**: PASS WITH WARNINGS
- **Typecheck**: `pnpm typecheck` clean (exit 0)
- **New tests**: 9/9 pass (issue-store 5, issue-grid-layout 4)
- **Full suite**: 526/529 pass — 0 regressions; 3 pre-existing failures unrelated to this change (`memory-service.test.ts` Windows path, `pty-launch.test.ts` PATH entry, `session-watcher.test.ts` temp path)
- **Spec compliance**: All 10 requirements (R1–R10) PASS. R8 has a caveat (positions not persisted).
- **CRITICAL issues**: None.

### Accepted Warnings (non-blocking, user accepted as-is)

1. Missing T3 IPC test file (`tests/github-issues-fetch.test.ts`) — IPC error classification (ENOENT/auth/network) and JSON parsing verified manually, not by automated test.
2. Missing T5 projection test file (`tests/node-projection-issue.test.ts`) — `buildCanvasFlowIssueNodes` / union type covered only via grid tests.
3. Missing T6 persistence test file (`tests/scene-issue-persistence.test.ts`) — save/load round-trip and v2 backward-compat not automated.
4. Issue positions not persisted across restarts (`canvasSceneIO.ts`) — positions captured at `x:0,y:0`; nodes re-laid-out via grid on load. Issue metadata IS preserved; partial deviation from spec scenario R8.2. Known limitation, not a regression.

### Accepted Suggestions

1. `updateIssuePosition` is a no-op (`issueStore.ts`) — kept for interface completeness; comment documents the limitation.
2. Dual click handlers (`IssueNode.tsx` card handler + `XyFlowCanvas.tsx` type guard) both implement URL opening; `stopPropagation()` prevents double-fire. Could be consolidated later.

## Implementation Footprint

**12 files changed (5 new + 7 modified)**, per final-state facts:

| File | Action |
|------|--------|
| `src/stores/issueStore.ts` | New |
| `src/canvas/issueGridLayout.ts` | New |
| `src/canvas/IssueNode.tsx` | New |
| `src/canvas/nodeProjection.ts` | Modified |
| `src/canvas/xyflowNodes.tsx` | Modified |
| `src/canvas/XyFlowCanvas.tsx` | Modified |
| `src/canvas/sceneProjection.ts` | Modified |
| `src/canvas/canvasSceneIO.ts` | Modified |
| `src/types/scene.ts` | Modified |
| `electron/main.ts` | Modified |
| `electron/preload.ts` | Modified |
| `src/types/index.ts` | Modified |

**2 test files (new)**: `tests/issue-store.test.ts` (5 tests), `tests/issue-grid-layout.test.ts` (4 tests).

## Task Completion

All 10 tasks (T1–T10) are checked `[x]` in the persisted `tasks.md`. Task Completion Gate passed. No stale unchecked implementation tasks.

## Spec Sync

- Domain: `github-issues-canvas`
- The delta spec was a **full spec** (new capability; `openspec/specs/` had no prior domain). Copied directly to `openspec/specs/github-issues-canvas/spec.md` — 10 ADDED requirements, 17 scenarios. No MODIFIED/REMOVED/RENAMED sections were present.

## Archived Artifacts (OpenSpec)

Moved to `openspec/changes/archive/2026-07-31-github-issues-canvas/`:
- `proposal.md`
- `spec.md` (delta)
- `design.md`
- `tasks.md`
- `verify-report.md`
- `archive-report.md`

## Engram Traceability (Observation IDs)

| Artifact | Observation ID |
|----------|----------------|
| proposal | #962 |
| spec | #963 |
| design | #964 |
| tasks | #965 |
| apply-progress | #966 |
| verify-report | #967 |
| archive-report | (this save) |

## Rollback / Reversal

Revert the implementation commit. Scene documents saved with the `issues` field remain valid (optional field, ignored by older code). No data loss risk.

## Next Recommended

None — SDD cycle complete.
