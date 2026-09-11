# QA Isolation Report — T02 Panel Surface (DESIGN-isolation §10)

Date: 2026-09-07. Engineer: Yan (software-qa-engineer, T02 Eng B).
Daemon: user-raised, `http://127.0.0.1:17680`, version `local`, T01 code
present (pre-probe: `DELETE /factory/jobs/probe123/worktree` answered
`404 {"error":"job not found: probe123"}` — route exists, NOT the
`not found: DELETE ...` of an old daemon; no restart was performed).
Renderer: not clicked headless; the panel Resolve path was executed with
the byte-identical call the panel makes (`POST /factory/jobs`
`{prompt, worktree, phase:"diagnosisLlm", issueRef}`, cf.
`activityActions.ts:997-1012`, `FACTORY_RESOLVE_PHASE="diagnosisLlm"`).

## Flag: issue #60 was NOT usable

The brief allowed #60 absent an obvious disposable issue. `gh issue view
60` returns **a MERGED pull request** (`fix(usage): Codex cached token
double-counting`, `blueberrycongee/termcanvas#60`, state MERGED), not an
issue. Touching it would violate "no user issues". A fresh disposable
issue was created instead and closed after the run:

- Issue: `blueberrycongee/termcanvas#192` — `[disposable] isolation
  probe T02` (created 2026-09-07, closed 2026-09-07 post-run).
- Base branch: `main` (`15fece3e`). Remotes: `origin` =
  `FrancoManfredi/termcanvas`, `upstream` = `blueberrycongee/termcanvas`.

## Offline gates (Round 1 — all green, no source bugs)

- `npx tsc --noEmit --pretty false` → exit 0, zero errors.
- `tests/warp-isolation-panel.test.ts` → **17/17 pass** (bar was ≥12).
- Siblings unbroken: `warp-live-activity` + `factory-isolation` → 84/84.
- D4/D5: timeout const `FACTORY_WORKTREE_DELETE_TIMEOUT_MS=5000` present;
  zero `setInterval`, zero `pr merge|merge-pr|--merge` in T02 files.
- D6: touched paths are exactly the §3 T02 list (all show `??` because
  this checkout's index tracks almost nothing — pre-existing condition,
  verified against the pre-run `git status`; no `package.json`, configs,
  `electron/*`, or `src/canvas/*` touched).

## Live run — one job only: `job-mtqlrumy-gitl` (no duplicates created)

| # | Bar | Result |
|---|---|---|
| Q1 Resolve | isolation event + worktree + `isolation.state=created` | **PASS**. `POST` → 201 `job-mtqlrumy-gitl` (Intake, `issueRef` stamped `github#192`). Timeline: `isolation created branch=issue-192-disposable-isolation-probe-t02` with meta `{branch, baseBranch:main, worktreePath:<root>/.worktrees/issue-192-disposable-isolation-probe-t02, repoRoot, state:created, createdAt}`. Branch slug parity confirmed (`[disposable] isolation probe T02` → `disposable-isolation-probe-t02`, 40-char cap respected). |
| Q2 Implement jailed | main stays clean; files only in worktree | **PASS**. `implement:changed 1 files strategy=llm` (3 LLM calls, ~USD 0.0004). `isolation-probe.txt` exists ONLY under `.worktrees/issue-192-.../`; repo root has no probe file; `verify.json` `cwd` = the isolated worktree. |
| Q2b Verify | pipeline runs to Review/Complete | **FAIL (environmental, not T02)**. `verification failed: pnpm test exit ?` — the full-repo `pnpm test` exceeded the daemon `IMPLEMENT_VERIFY_TIMEOUT_MS=120s` (`durationMs:120544`, `exitCode:null`, build skipped fail-fast). Any job in this repo currently ends this way; the one-line probe change is unrelated. Standard Building→Triage path; triage `decision:building`, `openQuestions:[]` (parked, not awaiting a human). Worktree left intact for forensics per §5.3. |
| Q3 PR on Complete | exactly 1 PR, head=`issue-192-*`, body `Closes #192`, state OPEN, no merge | **NOT OBSERVED** — unreachable: the PR hook fires only on first `Complete`, and no job can reach `Complete` while repo-wide verify always times out (see Q2b). No PR was opened, and **no merge happened anywhere** (`git branch -r` shows no `issue-192` branch — nothing was ever pushed). The panel PR-link path (`readFactoryJobPrLink` → `IssueFactoryJob.prUrl` → ActivityPanel anchor) is proven by the 17 offline tests instead. |
| Q4 Manual merge | PR MERGED, issue auto-closes | **N/A** (no PR exists). No auto-merge observed at any point. |
| Q5 Cleanup | `DELETE .../worktree` → folder gone, branch kept, `state=cleaned` | **PASS** (via terminal-state path). After user-cancel (`POST .../cancel` → `Cancelled`), `DELETE` with `{"force":true}` (required: `prState=none` refuses without force — guard verified live) → `200 {"ok":true,"id":"job-mtqlrumy-gitl","path":".../.worktrees/issue-192-disposable-isolation-probe-t02","state":"cleaned"}` — exact §4 contract shape. Timeline: `isolation worktree removed (...) — branch kept`. `git worktree list` clean, local branch `issue-192-...` retained by design, no remote branch, main probe-free. |
| Q6 Disposable closed | issue closed iff auto-close did not fire; base branch never deleted | **PASS**. `gh issue close 192` (auto-close never fired — no PR). Base `main` untouched. |

## Notes for the record

- Live GET `/factory/jobs/:id` detail exposes isolation ONLY via the
  timeline `isolation`/`pr` meta keys (no top-level memory object in this
  shape) — consistent with the §4 contract and exactly why the panel
  readers try memory first, then the timeline durable path.
- Daemon queue at run time: 340 jobs total (252 Complete historic);
  live set was Foreman=3/Building=3/Review=6/Triage=58 — the 58 Triage
  are pre-existing parked jobs, none created by this QA run.
- Budget: 11 live calls used of 15 (probe, create-issue, create-job,
  status checks, 1 long poll, cancel, cleanup, verify). One job total.
  Zero restarts, zero `taskkill`, zero dev/build invocations, zero
  Playwright, all timeouts explicit, UTF-8 throughout.

## Verdict

- T02 panel surface: **DONE and verified** (offline 17/17 + live Q1/Q2/Q5).
- T01 daemon isolation: **core verified live** (create→jail→jailed
  implement→explicit cleanup); **PR-on-Complete hook NOT verifiable
  live** until the systemic verify-timeout Triage sink is addressed by
  the implement track (repo-wide `pnpm test` > 120s cap). No T02 source
  or test bugs found → no Round 2 needed; the gap is documented above,
  not debugged further (2-round rule).
- Routing: **NoOne**. Known issue carried: Q3/Q4 unobserved (environmental).
