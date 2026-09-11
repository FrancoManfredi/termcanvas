# F6 Report — Final run E2E-01..E2E-14 + parity verdict

- Date (UTC): 2026-09-05 · QA: Edward (software-qa-engineer) · buildId: `15fece3e` · HEAD: `15fece3e`
- Scope: F6-T1 (full run 01..14, in order, one case at a time) + F6-T2 (formula re-run + verdict + index). Zero code changed.
- Gate (once, explicit timeouts, `-Encoding utf8`, never restart/taskkill/pnpm dev|build): `validate` exit 0 · `tsc --noEmit -p tsconfig.json` exit 0 ($? True) · `GET /factory/health` 200, `buildId 15fece3e == HEAD` (first probe `opencode not_started` transient post-restart, recovered healthy on re-probe 14:26:43Z port 35007 — infra note, not a case verdict) · God 3583 (F1 value, +0) · routeTable 308 lines / 42 rows (suite 18/18).
- Observation layer: Playwright MCP browser-singleton lock persists (12th consecutive session-wide probe, `Browser is already in use ... use --isolated`) + renderer 127.0.0.1:5173 unreachable (connection refused; harness GET fails). Per F6 task order: every case documents BLOQUEADO-obs and proceeds on GETs (15s) + disk asserts; 0-quota browser retry pending. Snapshots replaced by GET-status + timeline + disk asserts (F3/F4/F5 precedent). Screenshots: 0 captured / 14 cases.
- Verdict legend (no grays): PASS · FAIL · BLOQUEADO-infra (infra down) · BLOQUEADO-obs (browser/renderer observation only) · BLOQUEADO-buena-infra (E2E-04 plan-prescribed: server healthy, nothing to observe) · BLOQUEADO-ausencia (bounded attempts exhausted, phenomenon honestly absent, system behaved correctly — maps F2/F3 DIFERIDO-honest into the no-gray scheme; NOT a system fail, carried as parity shortfall).

## Verdict table 14/14

| Case | Verdict | Job(s) / evidence | Quota |
|---|---|---|---|
| E2E-01 Trivial happy path | PASS | `job-mtoh92oh-g1yi` Complete 14:32:10Z, `review accept intento 1 (0 findings)`, file `lab6-final/leeme.txt` 38B 2 exact lines, `costSummary llmCalls:5`, 4 agentSessions, `estimatedUSD null basis estimated-chars/4`, screenshot BLOQUEADO-obs | 5 |
| E2E-02 Bug → revise → rebuild → accept | PASS-direct | attempt1 `job-mtohgjp0-9jlu` Triage via `implement sin parse confiable` (test-prompt gap, QA self, delivery-safe fallback, 2 calls); retry `job-mtohjzq0-vmto` Complete 14:40:16Z accept-1, reviewCount 1, `lab6-rev2/dato.txt` 52B 3 exact lines, 0 literals. No natural revise (reviewer correct, 0 findings) — revise loop carried | 2+4 |
| E2E-03 Ambiguous → Triage + questions | PASS | `job-mtohs9bm-1ihi` Triage, `triage (complex) conf=0.96`, `triage.json decision:triage openQuestions:3` (area / criterion+s metric / scope, worktree-aware) | 2 |
| E2E-04 Reviewer-infra → honest ask_human | BLOQUEADO-buena-infra | 0 review failures in F6 window (4/4 reviews healthy accepts). Honest path ref corrida 2 same buildId (E2E-04 PASS). Forcing a failure = theater, refused | 0 |
| E2E-05 Intent-parser strict | PASS (strict-with-note) | same job as E2E-01: `createdFiles [lab6-final/leeme.txt, lab6-final]` real paths, zero literal dirs, F5 folder-co-entry precision note stands (P2, asserts owner) | 0 extra |
| E2E-06 Same session on rebuild | PASS (consolidated) | F2 same-session proof same buildId + fresh corroboration: 4/4 F6 Completes hold exactly 1 session per role (`foreman,implement,review,triage`), zero silent extra sessions | 0 extra |
| E2E-07 Reverify with evidence | BLOQUEADO-ausencia | 0 reviewer doubts in 4 F6 reviews (all accept-1, 0 findings) → no `reverify:` event. Absence is not FAIL (plan §E2E-07). F2 same-build ref stands | 0 |
| E2E-08 Scorers + baseline + accept | PASS | `GET /scores/summary` live `{1/1/0 per scorer}`; both fresh Completes `{}` + offline `shouldSampleJob(…,25)=false` both → sampled-out by design (deterministic FNV-1a), documented with evidence | 0 |
| E2E-09 Auto-proposal on real fails | BLOQUEADO-ausencia (rodaje-sin-fails) | probe1 `job-mtohvo0i-bfol` Complete accept-1 via full LLM path (`strategy=llm`, 4 calls); probe2 `job-mtohz20a-4twc` Complete accept-1 via late-write + verify-retry (4 calls); `failures[review-formato-valido]=[]`, `proposals=[]` → gate correctly silent. No manual scores/proposals fabricated | 4+4 |
| E2E-10 Definition red → green | PASS | backup → `samplingRate:999` → CLI exit 1 `scorer.md:7 scorers-sampling-rate [error]` + served `valid:false` same file:line (daemon alive during red = flow-alive) → restore → exit 0 + `valid:true`, `samplingRate:25`, no `.bak` | 0 |
| E2E-11 Notifications + bell + ack | PASS (server-side) | ring serving 100; `ask_human n-1788617595863-437` (F5 job, actionable H-005 message) → `POST ack {ok:true}` → `acked:true` live. Panel pixels BLOQUEADO-obs (render PASS carried corrida 3 same buildId) | 0 |
| E2E-12 Declared isolation | PASS (with P2 note) | `docker info` hung (15s timeout, 1 attempt) → no responsive daemon → `none` is reality; runner `prepared/accepted/setup pass` local in timelines, zero docker claims; verify-retry transition meta carries `isolation=none` on all steps+evidence. P2 note: trivial-shortcut `verify.json` steps omit the `isolation` key (authoritative record is the transition meta) — display-input nit, no false claim anywhere | 0 |
| E2E-13 Cost streak | PASS | 6/6 F6 jobs `llmCalls>0` (2–5), timeline grep `USD 0.00|~USD` = 0 hits, `estimatedUSD null + basis estimated-chars/4` everywhere | 0 |
| E2E-14 Exit gate | PASS | `tsc` 0 · `validate` 0 · `no-unbounded-loops` 5/5 · `route-table` 18/18 (42 rows) · reconcile+empty-folder+literal 23/23 · money/trace/measure asserts 79/79 · pacts F01–F14 covered in-suite (no dedicated runner, corrida 4/8 precedent) · God 3583→3583 | 0 |

- Worktree: `C:\tmp\demo-e2e-f6-final-20260905-143000` (git + exit-0 test/build). Job dirs: `<worktree>\.agents\factory\job-<id>\{job.json,result.json,verify.json,review.json,triage.json,prompt.md,logs\}`.
- FAILs/rollbacks: none (zero source files touched; nothing to revert). No source bug proven in F6 window. Two infra strikes recovered per rule (implement-fallback → late-write → verify-retry → accept ×3; flaky ask_human 0 this window — F5's ask_human acked here). Never 2 consecutive infra → no BLOQUEADO-infra case.
- New LOOPS rows + meta-test: +0-note (premiere/assert-only run; operator POSTs are one-shot recoveries on production routes, F2/F5 precedent, not mechanisms).
- Quota spent F6: 21 LLM calls (5+2+4+2+4+4, all `sin tarifa`). F6 authorized 15–45 to pass 50 — WITHIN (21). Cumulative F1 0 + F2 19 + F3-A 7 + F3-B 7 + F3-C 8 + F4 1 + F5-T1 6 + F6 21 = 69/50 (authorized overrun, user-confirmed).
- Allowlist: all judges/reviewers `opencode-go/*`; never gemini. Controller model spend is not daemon quota (daemon llmCalls counted above).
- Carry-over: (1) browser/renderer observation debt (12 consecutive locks + 5173 down) — 0-quota re-observation batch when freed: 14 screenshots + badge/panel pixels; (2) revise→rebuild→reverify live premiere still open (0 natural revises in 10 F6-window verdicts); (3) spec-approval chain still open (triage-triage 0.96 reached, no spec gate); (4) rodaje proposal still open (0 genuine fails in 5 demanding jobs); (5) money-half needs user tariffs; (6) fresh `scoreReason` on disk needs a sampled-IN natural accept; (7) E2E-12 P2: trivial-shortcut `verify.json` steps omit `isolation` key (transition meta authoritative); (8) dirty-tree note stands (factory work untracked, `HEAD 15fece3e` predates it; commits are orchestrator call).
- QA verdict: F6-T1 DONE (14/14 rows, no grays, 3 BLOQUEADO-ausencia + 1 BLOQUEADO-buena-infra all evidenced, 0 FAIL). Routing: NoOne (no Engineer action; Known Absences carried to shortfall, not hidden).

# Test Report

## Summary
- Total Tests: 125 run (5 loops + 18 route-table + 7 reconcile + 8 empty-folder + 8 literal + 11 cost-rates + 9 score-reason + 23 decision-record + 12 f3-asserts + 15 f2-asserts + 9 f5-asserts) | Passed: 125 | Failed: 0
- Live: 10/14 PASS (01,02-direct,03,05-note,06-consol,08,10,11-srv,12-note,13,14) · 0 FAIL · 4 BLOQUEADO (04-buena-infra, 07-ausencia, 09-ausencia + obs-layer global)
- Coverage: full lifecycle fail→late-write→retry→accept→Complete ×3 fresh + cost/trace/definition/notification/isolation streaks
- Routing Decision: NoOne
```
