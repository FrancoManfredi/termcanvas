# OpenCode TUI Wheel-Scroll Fallback Design

## Decision

Install an xterm-owned custom wheel callback with the public
`xterm.attachCustomWheelEventHandler` API immediately after `xterm.open()`.
The callback runs inside xterm's own wheel path, so it can decide whether xterm
continues processing the original event. It must not be implemented as an
ancestor or host listener that waits for xterm to change `defaultPrevented`.

For an OpenCode alternate-screen TUI with no effective xterm viewport range,
the callback sends one deterministic application sequence through
`xterm.input(sequence, false)`, prevents and stops the original event, and
returns `false` to suppress xterm's duplicate application-input path. In every
other case, it returns `true` so xterm remains authoritative. The implementation
must not redispatch, clone, or replay wheel events.

## Verified Evidence

The investigation established the following facts in the current application:

- Canvas diagnostics show the wheel event reaches the terminal path:
  `target=CANVAS.xterm-link-layer`, the target is inside a React Flow terminal
  node and xterm host, and `handleWheelCapture` logs `PASSTHROUGH to terminal`.
- The xterm DOM exists at the event target boundary. Both `.xterm` and
  `.xterm-viewport` are present.
- The observed xterm viewport has no browser-scrollable range:
  `scrollHeight === clientHeight` (the captured values were both `874`).
- The current wheel logger produced no `[tc:wheel-input]` output for the
  failing OpenCode wheel path.
- xterm 6 can call `preventDefault()` and `stopPropagation()` from its own
  wheel path. An ancestor cannot reliably observe a post-xterm
  `defaultPrevented` handoff, and a host listener may never run.
- xterm owns mouse-report wheel behavior when the xterm root has the
  `enable-mouse-events` marker. That path must remain xterm-owned.

Therefore, the canvas capture boundary is no longer the failing boundary, and
CSS/browser scrollback cannot provide movement for this event.

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
an up or down sequence to reach the application through the live terminal input
bridge so its TUI can move its own view. The problem is therefore downstream of
canvas passthrough and is not solved by changing `overflow`, scrolling
`.xterm-viewport`, or redispatching the wheel event.

## Proposed Design

### Xterm-owned callback

After the renderer calls `xterm.open()`, register exactly one callback with
`xterm.attachCustomWheelEventHandler`. Keep the disposable returned by that
registration in the same renderer/host lifecycle owner that manages the xterm
instance. Do not add a second native `wheel` listener on the host, an ancestor,
the document, or the canvas.

The callback must evaluate the current event and current runtime state in this
order:

| Condition | Callback action |
| --- | --- |
| `terminal.type !== "opencode"` | Return `true`; preserve normal xterm behavior. |
| `ctrlKey` or `metaKey` | Do not call `xterm.input`; return `true` so the existing canvas pinch contract remains intact. |
| `deltaY === 0` (including horizontal-only wheel input) | Do not call `xterm.input`; return `true`. |
| `event.defaultPrevented === true` before this callback | Do not add input; return `true`. This is only a pre-existing guard, never a post-xterm ancestor handoff. |
| xterm root has `enable-mouse-events` | Do not call `xterm.input`; return `true` and let xterm emit its mouse report and cancel the event. |
| xterm is not in the OpenCode alternate-screen/no-effective-viewport state | Return `true`; xterm owns normal scrollback or its own alternate-screen behavior. |
| no live runtime/input bridge | Do not call `xterm.input`; return `true` and do not capture a stale PTY reference. |
| eligible negative `deltaY` | Call `xterm.input("\\x1b[A", false)`, prevent/stop the original event, then return `false`. |
| eligible positive `deltaY` | Call `xterm.input("\\x1b[B", false)`, prevent/stop the original event, then return `false`. |

The pure decision helper should receive the terminal type, active buffer/state,
effective viewport state, event flags/deltas, mouse-report marker, and current
live-input availability. It should return either `xterm` or one fallback
direction. The callback owns the event effects and calls `xterm.input` only for
a fallback decision.

The no-effective-viewport check must use the live xterm state, including the
active alternate buffer and the current `.xterm-viewport` range. The captured
`scrollHeight === clientHeight` values are evidence for this boundary, not a
reason to bypass xterm for every wheel event.

### Live input path

Do not capture a PTY id, PTY object, or direct PTY writer in the wheel callback.
The callback must call the public `xterm.input(sequence, false)` API. xterm's
existing `onData` wiring then forwards the sequence to the currently live PTY
runtime. Runtime and PTY validity must be checked dynamically through that
xterm input/onData bridge, so renderer parking, runtime replacement, PTY exit,
or disposal cannot send input to an old process.

If the live input bridge is unavailable, the callback must not call
`xterm.input` and must not throw.

### Exact mapping and bounded behavior

Use this deterministic mapping for now:

- Negative `deltaY`: exactly one `\x1b[A` sequence per wheel event.
- Positive `deltaY`: exactly one `\x1b[B` sequence per wheel event.

Do not normalize large deltas, repeat sequences, or batch multiple application
inputs yet. One bounded sequence per event keeps the behavior deterministic and
avoids making trackpad delta units part of this change.

This deliberately does not reimplement application cursor-key mode. xterm may
normally choose `ESC OA` instead of `ESC [A`/`ESC [B` when application cursor
keys are enabled; this fallback always uses the specified CSI sequences. Mouse
report mode is a separate explicit non-goal: when `enable-mouse-events` is
present, xterm remains authoritative and the fallback sends no sequence.

### Event ownership and duplicate prevention

The existing canvas capture behavior remains the first outer boundary:

- Pinch/canvas zoom continues to be handled before terminal passthrough.
- Non-pinch wheel events over terminal descendants continue past the canvas
  instead of panning the canvas.
- Wheel events over empty canvas continue to pan the canvas.

The custom xterm callback is the only component that may add this OpenCode
fallback. It runs before xterm's built-in wheel processing, so a fallback must
call `xterm.input`, prevent the original event, stop propagation as appropriate,
and return `false`. Returning `false` suppresses xterm's duplicate path for the
same event. Existing `defaultPrevented` state is only a no-fallback guard; no
ancestor is allowed to infer that xterm already handled the event.

### Why there is no event redispatch

Redispatching would re-enter xterm's same wheel listener and could repeat the
custom callback, generate duplicate PTY input, or re-trigger mouse reporting.
`xterm.input` is the direct application-input API and already fires xterm's
existing `onData` event. Returning `false` prevents the built-in xterm wheel
path for the original event, so no second DOM event is needed.

## Preserved Behavior

### Normal xterm scrollback

When xterm has an effective scrollback range, the callback returns `true` and
xterm remains authoritative. Its normal wheel handling and viewport movement
are unchanged, and this fallback sends no input.

### Pinch and canvas behavior

`ctrlKey`/`metaKey` wheel input continues to use the canvas pinch-zoom path,
including when the pointer is over a terminal. The callback ignores these
events. Non-terminal wheel input continues to pan the canvas, and terminal
passthrough continues to prevent terminal wheels from becoming canvas pans.

### Mouse-report mode

When the xterm root has `enable-mouse-events`, the callback returns `true` and
does not call `xterm.input`. xterm remains responsible for mouse-protocol
encoding, cancellation, and propagation behavior. This prevents the fallback
from replacing or duplicating application mouse reports.

### wterm

The wterm renderer remains on its existing path. Its `.tc-wterm-host` behavior,
`onData` input bridge, and native scrollback handling must not be routed through
the xterm-specific callback. Registration is scoped to xterm instances and
`terminal.type === "opencode"`; wterm receives no callback and no fallback.

### Lifecycle cleanup

The disposable returned by `attachCustomWheelEventHandler` must be owned by the
same runtime lifecycle that owns the xterm host binding. Dispose it when:

- the renderer is disposed;
- the host is detached, parked, or replaced;
- a terminal switches renderer or runtime mode; or
- the terminal tile unmounts.

After disposal, the callback must not send input. Reattaching a parked host
must dispose the previous registration before installing another, leaving at
most one active callback. The callback must not retain a PTY/runtime reference;
the xterm `input` to `onData` bridge performs the live lookup at send time.
Existing renderer and terminal lifecycle disposers in
`terminalRuntimeStore.ts` remain the single ownership boundary.

## Implementation Touchpoints

The implementation should remain narrow and use these existing boundaries:

1. `src/canvas/XyFlowCanvas.tsx`: preserve the current pinch-first and
   terminal-passthrough decisions; do not move PTY logic into the canvas.
2. `src/terminal/TerminalTile.tsx`: preserve the xterm/wterm distinction and
   expose the terminal type needed for the OpenCode-only predicate.
3. `src/terminal/terminalRuntimeStore.ts`: after `xterm.open()`, register the
   custom callback, retain its disposable, use the existing xterm `onData`
   bridge, and dispose it through renderer/host cleanup.

No CSS scroll workaround is part of this design. No wheel event is cloned,
redispatched, or manually replayed.

## Focused Tests

Add focused coverage for the pure decision helper and the xterm callback
contract:

- OpenCode alternate-screen/no-effective-viewport with negative `deltaY`:
  return the up decision and map to exactly `\x1b[A`;
- the corresponding positive `deltaY` case maps to exactly `\x1b[B`;
- large positive and negative deltas still produce one bounded sequence per
  wheel event;
- non-OpenCode xterm terminals produce the xterm decision and no fallback;
- wterm is never registered and receives no fallback input;
- `ctrlKey` or `metaKey` produces no input and preserves the canvas pinch
  contract;
- zero `deltaY` and horizontal-only input produce no fallback input;
- an already `defaultPrevented` event produces no duplicate input;
- an xterm root with `enable-mouse-events` produces no fallback input and lets
  xterm's mouse-report path handle the event;
- a normal xterm effective viewport returns the xterm decision;
- no live runtime/input bridge produces no input and no throw;
- the callback is installed after `xterm.open()` and calls
  `xterm.input(sequence, false)` exactly once for an eligible event;
- returning `false` suppresses xterm's duplicate built-in path;
- the existing xterm `onData` bridge forwards the sequence to the current PTY,
  not a captured stale PTY;
- repeated attachment leaves only one active registration; and
- disposing the registration, parking/detaching the host, switching renderer,
  or unmounting the tile prevents later input.

Regression verification must also cover the existing behavior matrix:

- normal xterm scrollback still moves once, without a PTY fallback;
- OpenCode alternate-screen wheel input moves the TUI through the live input
  bridge;
- xterm mouse-report mode remains xterm-owned;
- wterm scrollback and input remain unchanged;
- terminal wheel does not pan the canvas;
- empty-canvas wheel still pans;
- pinch over a terminal still zooms the canvas; and
- host parking, reattachment, renderer switching, PTY exit, and tile unmount
  do not leave callbacks or send input to an old runtime.

## Risks and Tradeoffs

- The fixed `\x1b[A`/`\x1b[B` mapping intentionally does not reimplement
  application cursor-key mode, so applications expecting `ESC OA` may interpret
  the fallback differently.
- One sequence per wheel event may feel slower or faster than native xterm
  handling for high-resolution trackpads; delta normalization is deferred to a
  separate decision.
- Mouse-report mode remains xterm-owned. Bypassing it would corrupt the
  terminal application's mouse protocol, so the `enable-mouse-events` guard is
  mandatory.
- Runtime parking, reattachment, and PTY replacement can expose stale listener
  bugs if the registration disposable is not tied to renderer cleanup or if the
  callback captures a PTY directly.
- Future xterm changes to custom-wheel ordering or callback semantics require
  revalidating the callback and duplicate-prevention tests.

## Non-Goals

- Replacing xterm's scrollback or alternate-screen implementation.
- Making `.xterm-viewport` CSS-scrollable when the TUI owns the screen.
- Changing OpenCode or any other TUI's internal navigation behavior.
- Sending fallback input for normal xterm scrollback events.
- Reimplementing application cursor-key mode.
- Replacing or duplicating xterm mouse-report mode.
- Changing wterm's renderer, scrollback, or input bridge.
- Changing canvas zoom, canvas pan, React Flow configuration, or terminal focus
  semantics beyond the existing passthrough boundary.
- Redispatching, cloning, or replaying wheel events.
