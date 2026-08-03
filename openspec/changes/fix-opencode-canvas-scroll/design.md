# Design: Fix OpenCode Canvas Terminal Scroll

## Current Implementation

Exact code from `src/canvas/XyFlowCanvas.tsx` lines 787–794:

```ts
      const target = event.target;
      if (target instanceof Element) {
        const xtermHost = target.closest(".tc-xterm-host");
        const tile = xtermHost?.closest("[data-handoff-terminal-id]");
        if (tile?.getAttribute("data-focused") === "true") {
          return;
        }
      }
```

**Why it fails:**
1. `data-focused="true"` is required — unfocused terminals are ignored, so wheel events are consumed by canvas pan.
2. `.tc-xterm-host` is hard-coded as the first `closest` — wterm terminals use `.tc-wterm-host`, so they never match and wheel is consumed.

## Proposed Change

Replace lines 787–794 with:

```ts
      const target = event.target;
      if (target instanceof Element) {
        const isTerminalNode =
          target.closest("[data-handoff-terminal-id]") !== null ||
          target.closest(".react-flow__node-terminal") !== null ||
          target.closest(".tc-wterm-host") !== null ||
          target.closest(".tc-xterm-host") !== null;
        if (isTerminalNode) {
          return;
        }
      }
```

**Line-by-line explanation:**
- **Line 1** — Capture the event target to inspect its DOM ancestry.
- **Line 2** — Type guard; `closest()` only exists on `Element`.
- **Lines 3–6** — Check ancestors for **any** terminal marker:
  - Tile wrapper attribute (`data-handoff-terminal-id`)
  - React Flow node class (`react-flow__node-terminal`)
  - wterm host class (`tc-wterm-host`)
  - xterm host class (`tc-xterm-host`)
- **Line 7** — If any marker is found, return early. The event bubbles naturally to the terminal engine; `preventDefault()` and `stopPropagation()` are **not** called.

## Terminal Detection Logic

```pseudo
function isTerminalDescendant(target: EventTarget):
  if target is not Element: return false
  return closest("[data-handoff-terminal-id]") exists
      OR closest(".react-flow__node-terminal") exists
      OR closest(".tc-wterm-host") exists
      OR closest(".tc-xterm-host") exists
```

## Data Flow

**Before (broken):**
```
User wheel over terminal
    → handleWheelCapture
        → checks .tc-xterm-host + data-focused="true"
        → unfocused or wterm: FAILS check
        → preventDefault() + stopPropagation()
        → canvas pans; terminal never receives event
```

**After (fixed):**
```
User wheel over terminal
    → handleWheelCapture
        → checks ANY terminal marker
        → all terminals: PASSES check
        → early return (no preventDefault/stopPropagation)
        → event bubbles to terminal engine → terminal scrolls
```

**Canvas pan (unchanged):**
```
User wheel over empty canvas
    → handleWheelCapture
        → no terminal markers found
        → preventDefault() + stopPropagation()
        → canvas pans
```

## Component Interaction

| Component | Role | Impact |
|-----------|------|--------|
| `XyFlowCanvas.tsx` (`handleWheelCapture`) | Gatekeeper | Detection logic relaxed; early return for any terminal descendant. |
| xterm.js terminal tiles | Event consumer | Receives wheel events via DOM bubbling (previously blocked when unfocused). |
| wterm terminal tiles | Event consumer | Receives wheel events via DOM bubbling (previously never matched). |
| Tile header / buttons | Boundary | Unaffected; own `onWheel={e => e.stopPropagation()}` still isolates from canvas. |
| React Flow canvas | Pan/zoom engine | Unchanged; only sees wheel events when cursor is outside terminal nodes. |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/canvas/XyFlowCanvas.tsx` | Modify | Replace `handleWheelCapture` lines 787–794 with broader terminal detection. |

**No other files change.**

## Backward Compatibility

- **Focused xterm.js terminals**: still pass the new check (terminal marker present), behavior unchanged.
- **Canvas pan over empty space**: unchanged — no terminal marker, so `preventDefault`/`stopPropagation` still fire.
- **Pinch-to-zoom**: handled earlier in `handleWheelCapture` (lines 751–778) and is unaffected by this change.

## Testing Strategy

All testing is manual for this single-function DOM event fix:

| Scenario | Expected Result |
|----------|-----------------|
| Wheel over **unfocused** xterm.js terminal | Terminal scrollback scrolls; canvas does NOT pan. |
| Wheel over **wterm** terminal | Terminal scrollback scrolls; canvas does NOT pan. |
| Wheel over **focused** xterm.js terminal | Terminal scrollback scrolls; no regression. |
| Wheel over **empty canvas** | Canvas pans vertically/horizontally. |
| Pinch-to-zoom over **terminal** | Canvas zooms; terminal scroll unchanged. |
| Wheel over **tile header** | Canvas pans (header's own `stopPropagation` isolates it). |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Single file change; revert restores previous behavior.

## Open Questions

None.
