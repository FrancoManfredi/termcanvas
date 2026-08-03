# OpenCode TUI Wheel-Scroll Fallback Design

## Decision

Add a native terminal-host fallback for OpenCode alternate-screen TUIs. The
native host must let xterm handle the wheel event first. Only when xterm does
not consume the event will the host send an equivalent up/down escape sequence
to the terminal's PTY. This preserves xterm scrollback while giving
alternate-screen applications the input they require.

The implementation must not redispatch wheel events.

## Verified Evidence

The investigation established the following facts in the current application:

- Canvas diagnostics show the wheel event reaches the terminal path:
  `target=CANVAS.xterm-link-layer`, the target is inside a React Flow terminal
  node and xterm host, and `handleWheelCapture` logs `PASSTHROUGH to terminal`.
- The xterm DOM exists at the event target boundary. Both `.xterm` and
  `.xterm-viewport` are present.
- The observed xterm viewport has no browser-scrollable range:
  `scrollHeight === clientHeight` (the captured values were both `874`).
- Therefore, the canvas capture boundary is no longer the failing boundary,
  and CSS/browser scrollback cannot provide movement for this event.

Relevant source paths:

- `src/canvas/XyFlowCanvas.tsx` — canvas capture, pinch zoom, terminal
  passthrough, and empty-canvas pan behavior.
- `src/terminal/TerminalTile.tsx` — terminal tile ownership, renderer host
  mounting, and xterm/wterm host markers.
- `src/terminal/terminalRuntimeStore.ts` — PTY identity, xterm renderer
  creation, host attachment, renderer disposal, and lifecycle bindings.

## Root Cause Boundary

OpenCode's alternate-screen TUI does not expose scrollback through a CSS
scroll container. The xterm viewport can exist while
`scrollHeight === clientHeight`, because the application is rendering a fixed
alternate-screen buffer rather than accumulating terminal scrollback.

In this state, scrolling must be represented as terminal input. OpenCode needs
the PTY to receive an up or down sequence so its TUI can move its own view.
The problem is therefore downstream of canvas passthrough and is not solved by
changing `overflow`, scrolling `.xterm-viewport`, or redispatching the wheel
event.

## Proposed Design

### Native host handoff

Install one non-passive native `wheel` listener on the live xterm host, after
the xterm renderer is attached. The listener must run after xterm's own wheel
handling for the originating event. The decision is:

| Condition | Action |
| --- | --- |
| Pinch/modifier wheel (`ctrlKey` or `metaKey`) | Do not send PTY input; preserve canvas pinch zoom. |
| `event.defaultPrevented === true` after xterm handling | Treat the event as consumed by xterm; do not send PTY input. |
| Unconsumed vertical wheel over the xterm host with a live PTY | Prevent the browser's default, then send the equivalent direction sequence to that PTY. |
| No live PTY or no usable vertical delta | Do nothing beyond existing event handling. |

The listener must inspect `event.defaultPrevented` rather than attempting to
infer consumption from DOM dimensions. The equal `scrollHeight` and
`clientHeight` values establish the root cause boundary; they are not a reason
to bypass xterm for every wheel event.

### PTY input mapping

Use the wheel direction to select the smallest equivalent application input:

- Negative vertical delta: send the up sequence `\x1b[A`.
- Positive vertical delta: send the down sequence `\x1b[B`.

For a large wheel delta, normalize the event into a bounded repeat count and
send the selected sequence that many times, or use the repository's established
terminal input batching path. The mapping must remain deterministic and must
not synthesize a second DOM event.

The PTY must be resolved from the live runtime associated with the host. A
stale or disposed runtime must not receive input.

### Event ownership and duplicate prevention

The existing canvas capture behavior remains the first outer boundary:

- Pinch/canvas zoom continues to be handled before terminal passthrough.
- Non-pinch wheel events over terminal descendants continue past the canvas
  instead of panning the canvas.
- Wheel events over empty canvas continue to pan the canvas.

The native host fallback is the only component that may add the PTY fallback.
It must check `event.defaultPrevented` before sending. This prevents duplicate
movement when xterm has already handled normal scrollback. After the fallback
sends a sequence, it should prevent the browser default so the event cannot
produce an unrelated page or container scroll. It must not redispatch the
wheel event to make xterm run again.

## Preserved Behavior

### Normal xterm scrollback

When xterm has scrollback to consume, xterm remains authoritative. Its normal
wheel handling and viewport movement are unchanged, and no PTY sequence is
sent. This is the primary regression guard against double-scrolling.

### Pinch and canvas behavior

`ctrlKey`/`metaKey` wheel input continues to use the canvas pinch-zoom path,
including when the pointer is over a terminal. The fallback must ignore these
events. Non-terminal wheel input continues to pan the canvas, and terminal
passthrough continues to prevent terminal wheels from becoming canvas pans.

### wterm

The wterm renderer remains on its existing path. Its `.tc-wterm-host` behavior,
`onData` input bridge, and native scrollback handling must not be routed through
the xterm-specific fallback. The listener must be installed only for the xterm
host/runtime contract, or otherwise explicitly exclude wterm hosts.

### Lifecycle cleanup

The fallback disposer must be owned by the same runtime lifecycle that owns the
xterm host binding. Cleanup is required when:

- the renderer is disposed;
- the host is detached, parked, or replaced;
- a terminal switches renderer or runtime mode; and
- the terminal tile unmounts.

Cleanup must remove the exact listener that was installed, clear any retained
PTY/runtime reference, and prevent input after disposal. Reattaching a parked
host must install at most one active fallback listener. Existing renderer and
terminal lifecycle disposers in `terminalRuntimeStore.ts` should remain the
single ownership boundary rather than introducing a global document listener.

## Implementation Touchpoints

The implementation should remain narrow and use these existing boundaries:

1. `src/canvas/XyFlowCanvas.tsx`: preserve the current pinch-first and
   terminal-passthrough decisions; do not move PTY logic into the canvas.
2. `src/terminal/TerminalTile.tsx`: preserve the xterm/wterm host distinction
   and the tile's existing event/lifecycle ownership.
3. `src/terminal/terminalRuntimeStore.ts`: attach the native fallback beside
   xterm host/runtime bindings, obtain the live PTY id, and dispose the listener
   through renderer/host cleanup.

No CSS scroll workaround is part of this design. No wheel event is cloned,
redispatched, or manually replayed.

## Focused Tests

Add focused unit-level coverage for the wheel decision and PTY sequence logic,
without requiring a browser to redispatch events:

- xterm consumes the event (`defaultPrevented` is true): no PTY input;
- xterm does not consume an upward wheel: exactly the up sequence is sent;
- xterm does not consume a downward wheel: exactly the down sequence is sent;
- modifier/pinch wheel: no PTY input and the canvas zoom contract remains
  unchanged;
- zero or non-vertical delta: no PTY input;
- missing, stale, or disposed PTY runtime: no input and no throw;
- repeated native attachment: only one listener can send a sequence; and
- cleanup: detached or disposed hosts no longer send input.

Regression verification must also cover the existing behavior matrix:

- normal xterm scrollback still moves once, without a PTY fallback;
- OpenCode alternate-screen wheel input moves the TUI through the PTY;
- wterm scrollback and input remain unchanged;
- terminal wheel does not pan the canvas;
- empty-canvas wheel still pans;
- pinch over a terminal still zooms the canvas; and
- host parking, reattachment, renderer switching, and tile unmount do not
  leave listeners or send input to an old PTY.

## Risks

- Terminal applications may interpret `ESC [ A` and `ESC [ B` differently from
  a physical wheel or may have their own key bindings.
- Wheel delta units and high-resolution trackpads can produce too many or too
  few repeated sequences unless normalization is bounded and tested.
- Listener ordering is part of the design: if the fallback runs before xterm,
  it could send PTY input and cause duplicate movement. The implementation must
  verify the `defaultPrevented` handoff at the native host boundary.
- Renderer parking and reattachment can create duplicate listeners or stale PTY
  references if cleanup is not tied to the existing runtime disposer.
- Future xterm changes to wheel consumption semantics may require updating the
  decision tests and revalidating the native listener ordering.

## Non-Goals

- Replacing xterm's scrollback or alternate-screen implementation.
- Making `.xterm-viewport` CSS-scrollable when the TUI owns the screen.
- Changing OpenCode or any other TUI's internal navigation behavior.
- Sending PTY input for normal xterm scrollback events.
- Changing wterm's renderer, scrollback, or input bridge.
- Changing canvas zoom, canvas pan, React Flow configuration, or terminal focus
  semantics beyond the fallback handoff.
- Redispatching, cloning, or replaying wheel events.
