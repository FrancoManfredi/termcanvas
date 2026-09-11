---
name: ui-verification
description: Visual-proof standard for UI changes, applied only with visual surface.
---

# UI Verification

This skill applies ONLY when the change has visual surface: UI file
extensions or assets under `public/`, as flagged by the verification
evidence (`visual/pending-human`) or the created-files list. Changes
without visual surface ignore this skill entirely.

## What counts as proof (at least one is required)

- **Capture**: a screenshot or snapshot of the affected route showing the
  changed state. The route and the state must be named, not implied.
- **Route**: which route was exercised and how to reach it from a fresh
  load.
- **State**: loading, error, empty and loaded states considered; when the
  change touches layout or interaction, responsive behavior and keyboard
  basics are part of the proof.

A capture without route and state is a weak proof: note it as `minor`
instead of treating the change as verified.

## Verdict mapping

- Visual surface + proof attached and consistent with the change → no
  finding on this count.
- Visual surface + `pending-human` evidence without proof → finding
  `axis: tests` severity `major`, or verdict `ask_human` when only a human
  eye can judge (taste, brand, fine layout). Missing proof is blocking:
  never ignore it in silence.
- Never invent evidence: without a capture there is no "looks fine".
  Say what is missing and who must provide it.

## Available tooling (honest)

- `playwright-verify.mjs` at the repo root exists for local directed
  visual checks (route snapshot, console output, basic flows). Reference it
  when a directed check would close the gap.
- Do not promise computer-use or autonomous visual judgment we do not
  have. When a directed check cannot settle it, verdict `ask_human` with
  the exact route and state a human must look at.
