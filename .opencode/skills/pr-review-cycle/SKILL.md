---
name: pr-review-cycle
description: Run the full PR review cycle the way high-quality agent PRs do it -- frozen scope contract, review rounds with verdicts posted as PR comments, red/green validation proof, and discoveries tracked as follow-up issues. Use when driving a fix or feature from issue to merged PR, or when asked for "review rounds", "scope contract", or "Wirasm-style PRs".
---

# PR Review Cycle

One issue -- one branch -- review rounds -- merge. Every round is posted as a
PR comment so humans (and future agents) see the whole trail. Nothing
outside the accepted scope lands silently: adjacent findings become
`discoveries.json` entries and, when accepted, new GitHub issues.

## Phase 0 -- Branch and frozen scope

- Branch from `main`: `fix/issue-<N>-<kebab>` or `feat/issue-<N>-<kebab>`.
- Write `artifacts/scope.md` in the worktree BEFORE implementing and freeze
  it. **Gate: no source change lands before `scope.md` exists.** It lives
  in the worktree on purpose (agents have no permission outside it); the
  engine excludes review-aids at commit so it never ships. The reviewer's
  first check in every round is "scope present and frozen"; a round
  without it is invalid. The reviewer verifies against this contract,
  never against an imagined ideal change:

```markdown
# Scope -- issue #<N>: <title>

## Required outcome
- R1: <observable, testable requirement>
- R2: ...

## Invariants (must stay true in any acceptable implementation)
- ...

## Explicit non-goals
- ...

## Validation planned
- `<command>` -- proves <R?> (<pass count> expected)
```

### Amendments

When implementation proves a frozen item cannot hold as written, do NOT
edit `scope.md` in place: append an `## Amendments` block (the only
section allowed to move after the freeze), one line per change:

- `A1: <what changed> — <reason> (round k)`

An amendment is mandatory when the diff changes anything frozen: an
invariant, an explicit non-goal, or an existing test that pinned the old
behavior. The reviewer enforces it: a change to pinned behavior with no
amendment is a `major` finding on `requirements`.

## Phase 1 -- Implement

- Conventional commits with bodies that explain WHY, not what. Splitting
  follows the implement report's `## Commit units` section: one line per
  work unit (`- <type>: <subject> — <path1>, <path2>`, conventional type,
  backticked paths). One work unit = one commit; every touched file
  appears exactly once. A missing or invalid section falls back to a
  single legacy commit -- never a guess.
- PR body follows `.github/PULL_REQUEST_TEMPLATE.md` (Problem/outcome,
  Invariant, Scope boundary, Review guidance with `Start here: path:line`,
  Solution, Changed seams table with `path:line` evidence, Validation,
  Links with `Closes #`). Its "Outcome" states the resulting behavior --
  never compliance phrasing ("the fix satisfies the issue/contract").
- Open the PR early (draft ok). Bot review (Pullfrog/CodeRabbit) is the
  fast first pass, not the verdict.
- Titles and branch names are engine-owned (branch `issue-N-slug`, PR
  title mirrors the issue title, never the review prose): write
  conventional issue titles so PRs inherit them.

## Phase 2 -- Review round (post as PR comment)

Review the diff against `scope.md` at the exact head SHA. Post this report
as a PR comment:

```markdown
# Review report -- PR #<N> (round <k>)
## Verdict
**<Ready|Not ready>. Action: `<none|fix list>`.**
<One sentence: why.>
## Accepted contract
From scope.md: R1..Rn required, boundaries restated in one line.
## Reviewed head SHA
`<sha>` -- later commits invalidate every line callout below.
## Findings
### Important (blockers)
- R<n> -- <claim>. Status: <fixed|open>. Evidence: `path:line` + command output.
### Suggestions (non-blocking, optional)
- ...
## Prior findings
| ID | Severity | Claim | Status | Evidence |
## Bot review
Every bot finding reconciled as Taken (fix commit) or Dropped (one-line
reason). An open bot finding degrades the report header to
`verdict: REVIEW INCOMPLETE` / `readiness: blocked` (section 1 turns
"Not ready" and cites "bot finding `bot-1` open: ..." as the blocker); a
`READY TO MERGE` verdict never coexists with a non-`ready` readiness.
## Discoveries (out of scope, do NOT block)
- D<n> -- <title>. Recorded in discoveries.json. <New issue #M | dropped: reason>.
## Review coverage
Lenses run, commands with pass counts, what could NOT be verified.
```

Rules: no invented defects (a clean review is valid); every Important
finding states the smallest correction; stale callouts (head moved) are
re-checked, never trusted. **Round 1 must contain a "Bot review" section
reconciling EVERY bot finding as Taken (fix commit) or Dropped (one-line
reason); an unaddressed bot finding blocks readiness.** An open bot
finding also forces the verdict to `REVIEW INCOMPLETE` / `Not ready`:
header and readiness can never disagree. Every round header
cites the exact head SHA under review.

## Phase 3 -- Fix loop

- Each Important finding -> minimal fix commit -> new round that verifies
  EVERY prior finding individually (fixed with evidence, or still open).
- Loop until verdict is `Ready` with zero open Important findings.
- Suggestions may ship or stay open by explicit scope decision -- recorded,
  never silent.

## Phase 4 -- Validation bar (mandatory)

- **Red/green proof**: remove/neutralize the fix -> the regression test
  FAILS -> restore -> passes. Quote both outcomes in Validation.
- Exact commands with exact pass counts (`node tests/x.test.js -- 6 pass`).
- Honest `Not verified:` section. `Nothing material` only when the
  result-relevant behavior is covered, with the reason stated.

## Phase 5 -- Discoveries pipeline

```json
{ "id": "D1", "title": "...", "source": "review round 1",
  "relation": "adjacent", "status": "accepted|dropped",
  "issue": 123, "note": "..." }
```

- Agent rule: surface each discovery to the human; never drop one silently.
- Every discovery needs a terminal state: `accepted` with the created issue
  number (`gh issue create`) or `dropped` with a reason. A discovery with
  no disposition blocks green exactly like an undispositioned finding.
- IDs are stable across rounds (`D1`, `D2`, ...); every later round carries a
  prior-discoveries table with current status, like prior findings.
- Accepted discoveries become GitHub issues (small, titled, linked from
  the report). The fix PR never absorbs them (scope discipline).

## Phase 6 -- Merge

Blocking gate -- verify each item with the command shown, on the head SHA.
Any miss aborts the merge:

- Verdict `Ready` in the latest posted round: read the PR comments.
- Bot findings reconciled: every bot review finding addressed
  (Taken/Dropped) in a posted round. Bot reviews land post-PR-open, so
  this check runs at merge time, not inside the loop.
- Zero open Important findings: the latest round's prior-findings table
  shows every Important as Fixed with evidence.
- CI green on the head SHA: `gh pr view <N> --json statusCheckRollup`.
- Branch up to date with base: `git rev-list --count HEAD..origin/main`
  returns `0` (rebase first otherwise).
- Tree clean except intended files: `git status --short`.
- Squash or merge per repo convention. Verify the issue auto-closed
  (`gh issue view <N> --json state`).

**Engine-driven bot reconciliation (optional):** enable it with the
persisted `botReconcile` setting (`GET/POST /factory/settings`, toggle in
Settings) or the `TERMCANVAS_BOT_RECONCILE=1` env override (env wins; it
requires a factory restart, the setting applies live). Open bot findings
then trigger ONE reconciliation round on their own (cap 1 per job): the job
reopens and a fresh `fix-issue` run starts with the findings as the
`bot_findings` input (ids `f1..fn`, each one disposed in
`## Dispositions`). The human only decides whether anything is still open
after that round -- if so, the report stays `REVIEW INCOMPLETE` and no
second automatic round runs. Verify the live gate with
`GET /factory/health` (`botReconcile.enabled/source`); a skipped round
leaves `bot reconcile skipped` and a failed start leaves
`reconciliación post-bot no arrancó: <reason>` in the job timeline, and
missed rounds are recovered on the next factory boot.
