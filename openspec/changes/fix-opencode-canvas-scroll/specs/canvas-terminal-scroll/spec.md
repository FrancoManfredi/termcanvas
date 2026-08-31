# Canvas Terminal Scroll Specification

## Purpose

Wheel events over terminal nodes embedded in the React Flow canvas MUST be forwarded to the terminal engine (xterm.js or wterm) for scrollback scrolling, instead of being consumed by the canvas pan/zoom handler.

## Requirements

### Requirement: Terminal Wheel Passthrough

The canvas wheel handler MUST NOT call `preventDefault()` or `stopPropagation()` when the event target is inside a terminal node. The event MUST bubble naturally to the terminal engine's own wheel handler.

A terminal node is identified by ANY of these markers on the event target or its ancestors:
- `data-handoff-terminal-id` attribute
- `react-flow__node-terminal` class
- `tc-wterm-host` class

#### Scenario: Wheel over unfocused xterm.js terminal

- GIVEN an xterm.js terminal tile exists on the canvas
- AND the tile does NOT have `data-focused="true"`
- WHEN the user scrolls the mouse wheel over the terminal area
- THEN the event reaches the xterm.js host element
- AND the terminal scrollback buffer scrolls

#### Scenario: Wheel over wterm-engine terminal

- GIVEN a wterm-engine terminal tile exists on the canvas
- WHEN the user scrolls the mouse wheel over the terminal area
- THEN the event reaches the wterm host element
- AND the terminal scrollback buffer scrolls

#### Scenario: Wheel over focused xterm.js terminal (no regression)

- GIVEN an xterm.js terminal tile exists on the canvas
- AND the tile has `data-focused="true"`
- WHEN the user scrolls the mouse wheel over the terminal area
- THEN the event reaches the xterm.js host element
- AND the terminal scrollback buffer scrolls (unchanged behavior)

#### Scenario: Wheel over empty canvas

- GIVEN the cursor is over the canvas background (not inside any terminal node)
- WHEN the user scrolls the mouse wheel
- THEN the canvas pans vertically/horizontally
- AND no terminal is affected

### Requirement: Pinch-to-Zoom Preservation

The canvas wheel handler MUST continue to allow pinch-to-zoom gestures. The terminal passthrough logic MUST NOT interfere with multi-touch zoom.

#### Scenario: Pinch-to-zoom over terminal node

- GIVEN a terminal tile exists on the canvas
- WHEN the user performs a pinch-to-zoom gesture over the terminal
- THEN the canvas zooms in/out
- AND the terminal scroll position is unchanged

### Requirement: Terminal Find Overlay Compatibility

When a terminal's find overlay is open, wheel events over the overlay area SHOULD still reach the terminal engine.

#### Scenario: Wheel with find overlay open

- GIVEN a terminal tile has its find overlay visible
- WHEN the user scrolls the mouse wheel over the find overlay area
- THEN the event is not consumed by the canvas handler
- AND the terminal or find overlay handles the scroll naturally

### Requirement: Tile Header Non-Interference

Wheel events over the terminal tile header (title bar, buttons) SHOULD NOT be forwarded to the terminal engine. The tile wrapper's own `stopPropagation` handler remains the boundary.

#### Scenario: Wheel over tile header

- GIVEN a terminal tile with a visible header area
- WHEN the user scrolls the mouse wheel over the header
- THEN the event does NOT reach the terminal engine
- AND the canvas handles the event normally (pan or zoom)

## Non-Requirements

- The system is NOT required to change terminal focus behavior or auto-focus terminals on creation.
- The system is NOT required to modify React Flow's `noWheelClassName` or `zoomOnScroll` configuration.
- The system is NOT required to add new wheel gestures or adjust scroll sensitivity.
- The system is NOT required to affect non-terminal node types.
