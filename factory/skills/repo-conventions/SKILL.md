---
name: repo-conventions
description: Recurring repo conventions the reviewer enforces, with per-project override support.
---

# Repo Conventions

Conventions distilled from real past failures. The reviewer enforces them:
a violation is a finding (usually `axis: requirements`, severity `minor`
or `major` depending on blast radius). Silence about a violated convention
is itself a review miss.

## 1. Verification is real and fail-fast

The pipeline runs the test suite first and the build second; a failing
first step skips the rest. Per-step time caps and ports live in
`factory/factory.yaml` — the reviewer never redefines them, only checks
they were respected. A claim of "tests pass" without its artifacts is not
a pass.

## 2. Generated and locked paths are read-only for changes

Never add, edit or delete through a change under review:

- lockfiles and dependency installs (`pnpm-lock.yaml`, `node_modules`)
- build output (`dist` and equivalents)
- agent internals (`.agents` bookkeeping outside the job dir the
  orchestrator owns)

A diff touching these paths is a finding. Installing or rebuilding is the
job of the pipeline, not of the change.

## 3. Minimal change: 1-3 files plus tests

A change is exactly what the prompt asked: one to three files plus the
tests covering them. Extras, drive-by refactors and unrelated cleanups are
findings (`minor` when harmless, `major` when they widen the blast radius
or break the 1-3 file scope).

## 4. Evidence over narrative

Every verifiable claim must point at an artifact:

- test/build outcomes → `result.json` and `build.log`
- verification detail → `verify.json`
- review history → `review.json`
- visual claims → a capture with route and state (see `ui-verification`)

Missing proof is blocking: finding `axis: tests` severity `major`, or
verdict `ask_human` when only a human can close the gap. Never ignore a
missing proof in silence.

## 5. The worktree is the active project

All paths resolve at runtime under the worktree the orchestrator provides.
Machine-absolute literals do not belong in changes or in reviews; the
reviewer flags them as findings.

## 6. No invented results

Mocks live only in tests behind an explicit gate and never on a real path.
Production code that cannot do something yet must surface `ask_human` (or
the equivalent escape hatch) with the reason visible — never a fabricated
pass, a swallowed error, or a silent skip.

## 7. Behavior changes are versioned files plus tests

Changing behavior means changing a versioned definition plus its test —
never editing generated behavior blindly. Rollback is `git revert`. A TS
behavior change without its definition or test updated is a finding.

## Project override (this section is normative)

If `<worktree>/.agents/skills/repo-conventions.md` exists, its content is
PREPENDED to this factory default and wins on conflict: the reviewer
applies the project override first and this default second. The override
file uses plain markdown (no frontmatter required) and is capped like any
other skill content.
