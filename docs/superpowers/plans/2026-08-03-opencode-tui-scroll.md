# OpenCode TUI Wheel-Scroll Fallback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrowly scoped xterm-owned wheel fallback that sends one CSI cursor sequence to a live OpenCode alternate-screen TUI only when xterm has no effective viewport scroll range.

**Architecture:** Keep the canvas capture boundary unchanged. Add a pure decision helper in a focused terminal module, then register one xterm custom-wheel callback after `xterm.open()` in the existing runtime store. The callback reads the current runtime, host, buffer, viewport, mouse-report marker, and PTY availability on every event, sends input through public `xterm.input(sequence, false)`, and relies on the existing `onData` bridge for the current PTY.

**Tech Stack:** TypeScript, `@xterm/xterm` 6.0.0, Node test runner through `tsx`, `pnpm`, existing terminal runtime store and lifecycle tests.

---

## Scope And Existing Boundaries

The approved design is `docs/superpowers/specs/2026-08-03-opencode-tui-scroll-design.md`.

### Existing runtime binding and lifecycle

- `src/canvas/XyFlowCanvas.tsx:749-841` handles pinch first, passes non-pinch terminal wheel events through, and pans only for empty-canvas wheel events. Do not move PTY or xterm logic into this component.
- `src/terminal/TerminalTile.tsx:1211-1245` selects wterm versus xterm rendering and mounts the live xterm container with `tc-xterm-host nopan nodrag nowheel` markers. Preserve this distinction and its pinch/terminal event behavior.
- `src/terminal/terminalRuntimeStore.ts:1001-1014` wires xterm `onData` to `window.termcanvas.terminal.input(runtime.ptyId, data)` using the current `runtime.ptyId`; this is the live input bridge the fallback must reuse.
- `src/terminal/terminalRuntimeStore.ts:1134-1220` creates the xterm renderer, attaches the host, calls `xterm.open(host)`, and wires renderer bindings.
- `src/terminal/terminalRuntimeStore.ts:977-999` parks an existing xterm without disposing it; parking removes interactive bindings and detaches the host, so the callback must remain installed but fail its live predicate.
- `src/terminal/terminalRuntimeStore.ts:2015-2049` reattaches the same xterm instance and rewires live bindings; it must not register another custom-wheel callback.
- `src/terminal/terminalRuntimeStore.ts:948-975` and `:2139-2204` dispose the xterm renderer on eviction, renderer destruction, and terminal destruction. `xterm.dispose()` is the cleanup boundary because `attachCustomWheelEventHandler` returns `void` in xterm 6.0.0.
- The exact integration seam is `export function registerXtermWheelFallback(terminalId: string, xterm: XtermTerminal): void` in `src/terminal/terminalRuntimeStore.ts`. `createTerminalRenderer` calls it immediately after `xterm.open(host)`, and focused tests import and call this seam directly.
- `tests/terminal-runtime-store.test.ts:317-451` already verifies park, reattach, binding disposal, host reuse, and final xterm disposal. Extend this lifecycle surface instead of creating a second runtime harness.
- `tests/xterm-mouse-scale-patch.test.ts` and `tests/terminal-runtime-policy.test.ts` show the repository convention for focused pure-helper tests: `node:test`, `node:assert/strict`, direct TypeScript imports, and no test framework mocks unless needed.

### Baseline before implementation

Run these commands before changing implementation code and preserve the results in the implementation PR:

```bash
pnpm exec tsx --test tests/xterm-mouse-scale-patch.test.ts tests/terminal-runtime-policy.test.ts tests/terminal-runtime-store.test.ts
pnpm typecheck
pnpm test
```

Observed baseline on 2026-08-03:

- Focused terminal tests: 24 passed, 0 failed.
- `pnpm typecheck`: passed.
- Full suite: 526 passed, 3 failed, 3 skipped.
- Pre-existing full-suite failures: `tests/memory-service.test.ts` (`getMemoryDirForWorktree derives correct Claude Code memory path`), `tests/pty-launch.test.ts` (`shell terminal extra PATH entries put agent shims after cliDir for launch prepending`), and `tests/session-watcher.test.ts` (`codex resolveSessionFile prefers rollout_path from state db before the file exists`). Do not attribute these failures to the scroll implementation unless their failure signatures change.

## Task 1: Add The Pure Wheel Decision Helper

**Files:**
- Create: `tests/xterm-wheel-fallback.test.ts`
- Modify: `tests/terminal-runtime-store.test.ts`

- [ ] **Step 1: Define the smallest decision contract in the test.**

Import the not-yet-existing `decideXtermWheelFallback` from `src/terminal/xtermWheelFallback.ts`. Use a state object containing only the decision inputs:

```ts
type XtermWheelFallbackDecision = "xterm" | "up" | "down";

type XtermWheelFallbackState = {
  terminalType: TerminalType;
  activeBuffer: "normal" | "alternate" | null;
  viewport: { scrollHeight: number; clientHeight: number } | null;
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
  mouseEventsEnabled: boolean;
  liveInputAvailable: boolean;
};
```

The helper returns `"xterm"`, `"up"`, or `"down"`; event cancellation and `defaultPrevented` handling remain callback responsibilities.

- [ ] **Step 2: Define the fake xterm and runtime test helpers before implementation.**

In `tests/xterm-wheel-fallback.test.ts`, define a `createFakeXterm()` helper with these fields and behaviors:

- `open(host)` records the host and appends an `"open"` entry to an ordered call log.
- `attachCustomWheelEventHandler(handler)` stores the callback in `wheelHandler` and records an `"attachCustomWheelEventHandler"` entry.
- `input(data, wasUserInput)` records both arguments in `inputCalls`.
- `dispose()` increments `disposeCalls` and records a `"dispose"` entry.
- `element` exposes `classList.contains(name)` and `querySelector(selector)`; `querySelector(".xterm-viewport")` returns the configured viewport.
- `buffer.active.type` is mutable between `"normal"` and `"alternate"`.
- `onData(listener)` stores `dataHandler` and returns a disposable whose call is observable.
- The helper returns `host`, `attachedContainer`, and `viewport` objects with the parent/containment behavior needed by the live-host predicate, plus `wheelHandler`, `dataHandler`, `inputCalls`, `callOrder`, and disposal counters.

Define `createWheelEvent()` to return a `WheelEvent`-shaped object with `defaultPrevented`, `deltaY`, `ctrlKey`, and `metaKey`, where `preventDefault()` sets `defaultPrevented` and `prevented = true`, and `stopPropagation()` sets `stopped = true`. Define a runtime setup helper that seeds the current terminal registry entry with `mode`, `ptyId`, `meta.terminal.type`, `xterm`, `hostElement`, `attachedContainer`, and a live `onData` capture. Tests must invoke the captured `dataHandler` after changing the runtime PTY id to prove the bridge reads current state.

Mirror these fake xterm fields and captures in the existing `createMockXterm()` helper in `tests/terminal-runtime-store.test.ts`, or extract the same helper into a shared test-only module if that avoids duplication; do not leave the lifecycle test mock without `open`, wheel-handler capture, DOM lookup, `dispose`, or `onData` capture.

- [ ] **Step 3: Write every failing test before implementation.**

Cover each exact predicate with one clear test or a small table of cases:

- `opencode`, alternate buffer, live input available, and `scrollHeight <= clientHeight` returns `"up"` for negative `deltaY` and `"down"` for positive `deltaY`.
- Large positive and negative deltas still return one direction, proving no normalization, repetition, or batching is encoded in the decision.
- Non-OpenCode type returns `"xterm"`.
- `ctrlKey` or `metaKey` returns `"xterm"`.
- `deltaY === 0` returns `"xterm"`, including horizontal-only input represented by `deltaX` outside the helper.
- `mouseEventsEnabled` returns `"xterm"`.
- Missing registry/live state, `liveInputAvailable === false`, `activeBuffer !== "alternate"`, missing viewport, and `scrollHeight > clientHeight` each return `"xterm"`.
- `scrollHeight === clientHeight` and `scrollHeight < clientHeight` both remain eligible.

Also write the callback and lifecycle assertions now, before implementing either the helper or registration seam:

- Import the exact `registerXtermWheelFallback` seam from `src/terminal/terminalRuntimeStore.ts` and call it as `registerXtermWheelFallback("terminal-1", xterm)`.
- Assert the registration call is made only after `xterm.open(host)` by checking `callOrder`.
- Assert an eligible negative event calls `xterm.input("\x1b[A", false)` exactly once, sets `prevented` and `stopped`, and returns `false`.
- Assert an eligible positive event calls `xterm.input("\x1b[B", false)` exactly once with `false` and returns `false`.
- Assert an already `defaultPrevented` event returns `false`, calls no input, and does not throw.
- Assert an unavailable live input bridge returns `true` and calls no input.
- Assert the callback reads current registry/runtime state on every event rather than a captured PTY id or runtime snapshot.
- Assert a parked or detached host fails the live predicate without input.
- Assert reattaching the same xterm instance does not attach a second callback, while its `onData` binding can be rewired.
- Assert renderer eviction/disposal calls `xterm.dispose()` before a newly created xterm instance is registered once; do not model a preference switch as replacing the xterm because the current renderer preference path only changes addons on the existing instance.
- Assert changing the runtime PTY id causes the captured `onData` listener to forward to the new id, not a stale id.

Run:

```bash
pnpm exec tsx --test tests/xterm-wheel-fallback.test.ts tests/terminal-runtime-store.test.ts
```

Expected: the command fails because the pure helper, exported registration seam, callback behavior, and lifecycle assertions do not exist yet. Fix only test fixture/import errors if the failure is not an absent implementation.

- [ ] **Step 4: Implement the minimal pure helper.**

In `src/terminal/xtermWheelFallback.ts`, implement the predicates in this order after the callback’s separate `defaultPrevented` guard:

1. Return `"xterm"` unless the terminal type is exactly `"opencode"`.
2. Return `"xterm"` for `ctrlKey` or `metaKey`.
3. Return `"xterm"` for `deltaY === 0`.
4. Return `"xterm"` when mouse-report mode is enabled.
5. Return `"xterm"` when live input is unavailable, the active buffer is not `"alternate"`, the viewport is unavailable, or `scrollHeight > clientHeight`.
6. Return `"up"` for negative `deltaY`; otherwise return `"down"` for positive `deltaY`.

Do not import runtime state, a PTY writer, DOM nodes, React, or xterm into this pure module.

- [ ] **Step 5: Run only the helper assertions to verify their GREEN transition.**

Run:

```bash
pnpm exec tsx --test tests/xterm-wheel-fallback.test.ts --test-name-pattern="decision|predicate|mapping|delta|viewport"
```

Expected: all helper tests pass.

## Task 2: Register The Xterm-Owned Callback

**Files:**
- Create: `src/terminal/xtermWheelFallback.ts`
- Modify: `src/terminal/terminalRuntimeStore.ts:1134-1220`
- Modify: `tests/xterm-wheel-fallback.test.ts`
- Modify: `package.json:22-23`

- [ ] **Step 1: Implement the exact exported registration seam.**

In `src/terminal/terminalRuntimeStore.ts`, implement:

```ts
export function registerXtermWheelFallback(
  terminalId: string,
  xterm: XtermTerminal,
): void
```

Use a module-level `WeakSet<XtermTerminal>` to return without attaching another callback for the same xterm instance. The callback must capture only `terminalId` and `xterm`; it resolves the current registry/runtime/DOM state on every event. Do not add a disposer field because xterm 6 returns `void` from `attachCustomWheelEventHandler`.

- [ ] **Step 2: Implement the callback’s live-state read and event ownership.**

On every wheel event, resolve the registry entry for the captured terminal ID and verify all of these conditions before calling the pure helper:

- The current registry entry exists and is not disposed.
- The current terminal type is exactly `"opencode"`.
- The current runtime mode is `"live"` and `ptyId !== null`.
- The current runtime xterm is the captured xterm instance.
- The current attached container and host still contain the captured xterm element.
- `xterm.buffer.active.type === "alternate"`.
- The live `.xterm-viewport` exists and has `scrollHeight <= clientHeight`.
- The current xterm root does not have the `enable-mouse-events` marker.

If the viewport or either metric is unavailable, pass an unavailable viewport to the helper and leave ownership with xterm. Never capture or directly use a PTY ID, PTY object, direct PTY writer, host reference, or runtime snapshot in the callback.

At the top of the callback, if `event.defaultPrevented` is already `true`, add no input and return `false`. Otherwise call the pure helper. For `"xterm"`, return `true` without event effects. For `"up"` or `"down"`, call exactly:

```ts
xterm.input(decision === "up" ? "\x1b[A" : "\x1b[B", false);
event.preventDefault();
event.stopPropagation();
return false;
```

Do not redispatch, clone, replay, or manually dispatch a wheel event. Returning `false` is the duplicate-prevention boundary for xterm’s built-in wheel path.

- [ ] **Step 3: Register immediately after `xterm.open()`.**

In `createTerminalRenderer`, call `xterm.open(host)`, then immediately call `registerXtermWheelFallback(runtime.meta.terminal.id, xterm)`. Keep the existing addon and renderer-binding order otherwise unchanged. This seam is the only place production code invokes registration; tests invoke the exported seam directly.

- [ ] **Step 4: Add the new test file to the explicit package script.**

Modify the root `package.json` `"test"` script to include `tests/xterm-wheel-fallback.test.ts`, alongside the other terminal-focused tests. The command remains the repository’s explicit `tsx --test` file list; do not rely on glob discovery.

- [ ] **Step 5: Run callback assertions to verify GREEN.**

Run:

```bash
pnpm exec tsx --test tests/xterm-wheel-fallback.test.ts --test-name-pattern="callback|registration|input|mouse|scrollback|pinch|wterm"
```

Expected: helper and callback contract tests pass.

## Task 3: Make Runtime Lifecycle Assertions GREEN

**Files:**
- Modify: `src/terminal/terminalRuntimeStore.ts:948-999, 2015-2049, 2139-2204`
- Modify: `tests/terminal-runtime-store.test.ts`
- Modify: `tests/xterm-wheel-fallback.test.ts`
- Read-only regression references: `src/canvas/XyFlowCanvas.tsx`, `src/terminal/TerminalTile.tsx`, `tests/canvas-xyflow-rewrite.test.ts`

- [ ] **Step 1: Implement the existing park, reattach, and disposal lifecycle against the RED tests.**

Keep the callback attached while parking and reattaching the same xterm. Let `parkTerminalRenderer` remove only the existing renderer bindings, and let `detachTerminalRenderer` continue to call `xterm.dispose()` before nulling `runtime.xterm`. A parked or detached host must fail the live predicate without sending fallback input. Reattachment may rewire `onData` but must not attach a second custom-wheel handler.

- [ ] **Step 2: Verify actual renderer replacement behavior.**

Exercise eviction/disposal of the old xterm instance through the existing `detachTerminalRenderer`/`destroyTerminalRuntime` lifecycle, assert its `dispose()` call, then attach a new container so `createTerminalRenderer` creates a new xterm instance and registers exactly once on that new instance. Do not claim that a terminal renderer preference switch replaces xterm: the current `setTerminalRenderer` path changes WebGL/DOM addon state on the existing xterm.

- [ ] **Step 3: Verify the live onData bridge uses the current PTY.**

Invoke the fake xterm’s captured `dataHandler`, change the runtime `ptyId`, invoke it again, and assert `window.termcanvas.terminal.input` receives the current id. A PTY exit or replacement must not route fallback input to a stale process.

- [ ] **Step 4: Verify preserved behavior and lifecycle GREEN.**

Assert that:

- Normal xterm scrollback with an effective viewport returns `true` and sends no fallback input.
- `enable-mouse-events` leaves mouse-report behavior xterm-owned and sends no fallback input.
- wterm has no xterm callback and receives no OpenCode fallback input.
- `ctrlKey`/`metaKey` remains owned by the canvas pinch boundary; if a defensive callback invocation occurs, it sends no input.
- Horizontal-only/zero-vertical wheel input sends no fallback.
- Non-terminal wheel remains outside this xterm callback, so empty-canvas pan behavior is untouched.
- Tile unmount and terminal destruction leave no active old xterm instance.

Do not change `XyFlowCanvas.tsx`, `TerminalTile.tsx`, React Flow configuration, CSS overflow, or wterm implementation to satisfy these tests.

Run:

```bash
pnpm exec tsx --test tests/xterm-wheel-fallback.test.ts tests/terminal-runtime-store.test.ts tests/terminal-runtime-policy.test.ts tests/xterm-mouse-scale-patch.test.ts tests/canvas-xyflow-rewrite.test.ts
```

Expected: all focused tests pass. If an existing test fails, compare its exact failure with the baseline before changing implementation code.

## Task 4: Full Verification And Commit

**Files:**
- Verify: `src/terminal/xtermWheelFallback.ts`
- Verify: `src/terminal/terminalRuntimeStore.ts`
- Verify: `tests/xterm-wheel-fallback.test.ts`
- Verify: `tests/terminal-runtime-store.test.ts`
- Verify: `package.json`

- [ ] **Step 1: Run the focused suite after implementation.**

```bash
pnpm exec tsx --test tests/xterm-wheel-fallback.test.ts tests/terminal-runtime-store.test.ts tests/terminal-runtime-policy.test.ts tests/xterm-mouse-scale-patch.test.ts tests/canvas-xyflow-rewrite.test.ts
```

Expected: pass with no new failures.

- [ ] **Step 2: Run the relevant full suite and typechecks.**

```bash
pnpm test
pnpm typecheck
pnpm typecheck:headless
```

Expected: `pnpm typecheck` and `pnpm typecheck:headless` pass. `pnpm test` must not introduce a new failure; document the three baseline failures if they remain unchanged.

- [ ] **Step 3: Check the implementation diff for forbidden behavior.**

```bash
git diff --check
git diff -- src/terminal/xtermWheelFallback.ts src/terminal/terminalRuntimeStore.ts tests/xterm-wheel-fallback.test.ts tests/terminal-runtime-store.test.ts package.json
```

Confirm the diff contains no CSS scroll workaround, PTY capture, direct PTY write, redispatch, second native wheel listener, wterm registration, or canvas behavior change.

- [ ] **Step 4: Stage only the implementation work unit.**

```bash
git add src/terminal/xtermWheelFallback.ts src/terminal/terminalRuntimeStore.ts tests/xterm-wheel-fallback.test.ts tests/terminal-runtime-store.test.ts package.json
git diff --cached --name-only
```

Expected: only the five implementation/test/config paths are staged: `src/terminal/xtermWheelFallback.ts`, `src/terminal/terminalRuntimeStore.ts`, `tests/xterm-wheel-fallback.test.ts`, `tests/terminal-runtime-store.test.ts`, and `package.json`. Do not stage `.atl/.skill-registry.cache.json`, `.atl/skill-registry.md`, `pnpm-lock.yaml`, `.codegraph/`, or `openspec/changes/fix-opencode-canvas-scroll/`.

- [ ] **Step 5: Commit the implementation work unit.**

```bash
git commit -m "fix: add OpenCode TUI wheel fallback"
```

Expected: one conventional implementation commit containing only the five intended paths.

- [ ] **Step 6: Verify the final worktree without touching unrelated changes.**

```bash
git status --short
git show --stat --oneline HEAD
```

Expected: the implementation commit contains only its intended files, while all pre-existing modified/untracked files remain present and unmodified.

## Acceptance Checklist

- [ ] The helper has exact OpenCode, live, alternate-buffer, attached-host, viewport, mouse-report, modifier, delta, and input-bridge predicates.
- [ ] Helper, callback, and lifecycle tests were all written and observed RED before any registration or callback implementation.
- [ ] Registration occurs once per xterm instance after `xterm.open()`.
- [ ] The exact exported seam is `registerXtermWheelFallback(terminalId, xterm)` and tests call it directly.
- [ ] Eligible events call public `xterm.input(sequence, false)` exactly once with `\x1b[A` or `\x1b[B`.
- [ ] The callback prevents/stops and returns `false`; no event is redispatched.
- [ ] Normal scrollback, `enable-mouse-events`, wterm, pinch, canvas pan, and existing `onData` behavior remain unchanged.
- [ ] Parking, detaching, reattachment, actual xterm replacement after eviction/disposal, PTY replacement/exit, disposal, and tile unmount cannot route input to stale runtime state.
- [ ] `package.json` explicitly includes `tests/xterm-wheel-fallback.test.ts` in the root `pnpm test` script.
- [ ] Focused tests, relevant suite, and typechecks are recorded with pre-existing failures separated from regressions.
