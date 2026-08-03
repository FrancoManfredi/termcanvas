# Proposal: Fix OpenCode Canvas Terminal Scroll

## Intent

When an embedded terminal (xterm.js or wterm) sits inside a React Flow canvas node, the mouse wheel must scroll the terminal's scrollback buffer — not pan/zoom the canvas. Currently, `handleWheelCapture` in `XyFlowCanvas.tsx` only passes wheel events through when the cursor is over a `.tc-xterm-host` element AND its ancestor tile has `data-focused="true"`. New terminals (including OpenCode sessions launched from the context menu) start unfocused, so the handler calls `stopPropagation()` and the wheel never reaches xterm.js. wterm-engine terminals (class `tc-wterm-host`) are permanently excluded by the class check.

This is a narrow bug fix affecting one function, ~5–15 lines.

## Scope

### In Scope
- Modify `handleWheelCapture` to pass wheel events to any terminal descendant, regardless of focus state or engine class.
- Ensure both xterm.js (`tc-xterm-host`) and wterm (`tc-wterm-host`) terminals receive wheel events.
- Preserve existing pinch-to-zoom behavior (unchanged).
- Preserve canvas pan when the cursor is NOT over a terminal node.

### Out of Scope
- Changing terminal focus behavior or auto-focus on creation.
- Modifying React Flow's own `noWheelClassName` / `zoomOnScroll` logic.
- Adding new wheel gestures or scroll sensitivity tuning.
- Affecting non-terminal node types.

## Capabilities

### New Capabilities
- `canvas-terminal-scroll`: Wheel events over terminal nodes in the canvas must be forwarded to the terminal engine (xterm.js or wterm) instead of being consumed by the canvas pan/zoom handler.

### Modified Capabilities
None — no existing spec covers canvas wheel dispatch behavior.

## Approach

**Approach 1 (selected from exploration)**: Remove the `data-focused` and class-restrictive checks from `handleWheelCapture`. Detect whether the wheel target is inside any terminal node by checking for `data-handoff-terminal-id`, `react-flow__node-terminal`, or `tc-wterm-host` on the event path. If any of these markers are present, return early without calling `preventDefault()` or `stopPropagation()`, letting the event bubble to the terminal's own wheel handler.

The fix is localized to `src/canvas/XyFlowCanvas.tsx`, lines ~787–794. No other files change.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/canvas/XyFlowCanvas.tsx` | Modified | `handleWheelCapture` early-return condition relaxed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wheel events reach xterm AND canvas simultaneously (double-handling) | Low | `nowheel` class on terminal containers already tells React Flow to ignore them; our handler is the sole gatekeeper. Returning early prevents canvas action; terminal handles it naturally. |
| Terminal tile header/buttons area now passes wheel through when it shouldn't | Low | The terminal host div is the innermost element; the tile wrapper already has its own `onWheel={e => e.stopPropagation()}`. If needed, restrict to only the `.tc-xterm-host` / `.tc-wterm-host` descendants rather than the full tile. |

## Rollback Plan

Revert the single function change in `XyFlowCanvas.tsx`. No data migration, no state changes.

## Dependencies

None.

## Success Criteria

- [ ] Mouse wheel over an unfocused xterm.js terminal node scrolls its scrollback buffer.
- [ ] Mouse wheel over a wterm-engine terminal node scrolls its buffer.
- [ ] Mouse wheel over empty canvas still pans the canvas.
- [ ] Pinch-to-zoom on canvas still works.
- [ ] Existing focused-terminal wheel behavior is unchanged (no regression).
