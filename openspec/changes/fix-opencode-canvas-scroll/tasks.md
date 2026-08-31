# Tasks: Fix OpenCode Canvas Terminal Scroll

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~12 (8 logic + 4 comment) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Broaden terminal wheel passthrough | PR 1 (single) | `npm run lint && npm run build` | Manual: `npm run dev` + 6 smoke scenarios below | Revert single-file diff of `src/canvas/XyFlowCanvas.tsx` |

## Phase 1: Implementation (file: `src/canvas/XyFlowCanvas.tsx`)

- [ ] 1.1 Replace lines 787-794 detection in `handleWheelCapture` with OR of `closest()` against `[data-handoff-terminal-id]`, `.react-flow__node-terminal`, `.tc-wterm-host`, `.tc-xterm-host`; early `return` on any match (design §Proposed Change). AC: compiles; no `preventDefault`/`stopPropagation` for any terminal descendant.
- [ ] 1.2 Update stale comment (lines 780-786) to state wheel passes through to ANY terminal descendant, not just focused xterm. AC: comment matches new behavior. (after 1.1)

## Phase 2: Verification — manual smoke (design §Testing Strategy, 6 scenarios)

- [ ] 2.1 Unfocused xterm: wheel → scrollback scrolls, canvas does NOT pan.
- [ ] 2.2 wterm terminal: wheel → scrollback scrolls, canvas does NOT pan.
- [ ] 2.3 Focused xterm: wheel → scrollback scrolls (no regression).
- [ ] 2.4 Empty canvas: wheel → canvas pans.
- [ ] 2.5 Pinch-to-zoom over terminal: canvas zooms, terminal scroll unchanged.
- [ ] 2.6 Tile header: wheel → canvas pans (header `stopPropagation` intact). (all after 1.1)

## Phase 3: Commit

- [ ] 3.1 Single work-unit commit; stage only `src/canvas/XyFlowCanvas.tsx`. AC: conventional message below; no other files in diff. (after all 2.x)

## Expected Commit Message

```
fix(canvas): forward wheel events to unfocused and wterm terminals
```
