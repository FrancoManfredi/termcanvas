# Warp vs Local Parity Audit — Honest Replica Assessment

- **Date (UTC):** 2026-09-05
- **Auditor:** Gao (software-architect)
- **Repo:** `termcanvas` @ `15fece3e` (`git rev-parse --short HEAD` = `15fece3e`)
- **Scope:** Warp Factories vs local factory after Waves 1–13 + 15–20 + 14 (automations + integrations mock-local) + modularity F1–F4 + anti-God batches
- **Method:** per-dimension verdict (Replica / Partial / No) with file:line + test count + live E2E run + finding reference; each verdict tagged **Live** vs **Unit-only** vs **Mock**. Honest penalties applied. No magic single number: a range with an explicit formula.
- **Language:** neutral English (audit artifact).

## 0. Mandatory inputs read

- `docs/MASTER-PLAN-FACTORY.md` (Waves 1–13 + rules 1–6)
- `docs/MASTER-PLAN-PARIDAD.md` (Waves 15–20, dims 14/15/16/17/20 + P0/P1, rules 7–8; Wave 14 + integrations deferred at that time)
- `docs/MASTER-PLAN-E2E.md` §6 (run log through run 8) + `docs/E2E-HALLAZGOS.md` H-001..H-013
- `docs/MASTER-PLAN-MODULARIDAD.md` §6 (F1–F4 + batches 1–3/C, single dispatch) + `docs/LOOPS.md` (50 + 9 rows)
- `software-ola14-integrations/PRD-ola14-incremental.md` + `DESIGN-ola14-incremental.md` + `QA-ola14-report.md` (216/216) + `REPORT-ola14.md` (live T05)
- Warp sources: `docs/wiki Warp/WarpFactories.md` + `docs/wiki Warp/REPORTE-TermCanvas-Factory-Local.md` (§2–§3: entities, SDLC, agents, skills, automations, as-code, runners, scorers/benchmarks/self-improvement, MCP/API, measure). The live `docs.warp.dev` pages cited in the parity plan (agents, skills, as-code, automations, measure-and-improve, how-factories-work) were not fetched live; the content quoted in the plans and wiki (verified against `warp-factory-examples` reviewer shape) is used instead. This limitation is disclosed, not hidden.
- Live state probed read-only (GETs, 15 s timeout each; daemon 17680 never restarted/killed; no `pnpm dev/build`, no `taskkill`).

## 1. Live baselines measured 2026-09-05

| Signal | Value | How measured |
|---|---|---|
| `factoryServer.ts` total lines | **3581** | `(Get-Content -Encoding utf8 headless-runtime/factory/factoryServer.ts).Count` |
| God budget | 3575 baseline (Tanda C: 2803 code) → **3581 now (+6)** | QA-ola14 §God-server: 2 imports + 4 one-line `case` L2332–2335, zero business logic in new handlers |
| Route table | **40 declared rows** (`tests/route-table.test.ts` 17/17 green; R1–R4 `automations-list`, `automations-tick`, `integrations-status`, `integrations-test-post` at `routeTable.ts:72-75,121-124`) | `routeTable.ts` (285 lines). Raw `method:` grep = 42 hits because helper return-type lines also match; the authoritative count is the test's 40 rows |
| Factory domains | **14** | `automations, definition, health, intake, integrations, jobs, loaders, measure, notifications, review, routing, startup, triageSpec, verify` |
| `factory.yaml` top-level sections | **13** | `ports, timeouts, defaultModels, reviewerPairs, scorers, runners, costTracking/costRates, agentSessions, reviewerReverify, improveProposalCooldown, notificationsEnabled/osNotifications, automations, integrations` |
| `factoryClient` ops | **36 exported ops** + `factoryUrl` helper, 32 named timeouts (incl. 4 new Ola-14: `FACTORY_AUTOMATIONS_TIMEOUT_MS=3000`, `FACTORY_AUTOMATIONS_TICK_TIMEOUT_MS=5000`, `FACTORY_INTEGRATIONS_TIMEOUT_MS=3000`, `FACTORY_INTEGRATION_POST_TIMEOUT_MS=3000`) | `src/lib/factoryClient.ts:77-80` + function list |
| Daemon health (live) | `200 OK`, `buildId=15fece3e == HEAD`, `factoryPort=17680`, `queue pending:29 running:2`, `opencodeStatus=healthy` (`http://127.0.0.1:24844`, uptime 1549703) | `GET /factory/health` 15 s |
| Definition status (live) | `valid:true`, `issues:[]`, `buildId=15fece3e` | `GET /factory/definition/status` 15 s |
| Automations (live) | `enabled:true, tickMs:30000, triggers:[], recent:[]` | `GET /factory/automations` 15 s |
| Integrations (live) | `enabled:true, mode:mock-local, provider:linear, count:2, lastAckedAt:null` (posts `m-1788585432993-1`, `m-1788585438968-2`, both `acked:false`) | `GET /factory/integrations/status` + `factory/.integrations-mock.json` (642 B) on disk |
| Automations disk | `factory/.automations.json` **absent** (expected: store appends only on fires) | `Test-Path` = False |
| Notifications (live) | 100-ring serving (oldest visible `n-1788570943011-317`); kinds `benchmark-done` + `ask_human`; many unacked | `GET /factory/notifications` |
| Node | `v20.20.2` | `node --version` (H-011/Node-22 context below) |

Note on drift since REPORT-ola14: `opencodeStatus` is `healthy` now (was `not_started` in T05). Lab traffic (`pending:29 running:2`, ~100 benchmark-done notifications) is unrelated to Ola 14.

## 2. Dimension reconstruction note (honesty)

The 2026-09-03 parity report (dims 1–20 + gaps P0/P1/P2) does **not** exist as a standalone file in the repo. It survives via `MASTER-PLAN-PARIDAD.md` traceability (Ola→dim/gap map), `MASTER-PLAN-FACTORY.md` §1.3/§2, and the Warp wiki (§2–§3). The 20-dimension list below is therefore a **faithful reconstruction**, not a quote:

- D01–D13 = SDLC + agents + as-code + measure core (Waves 5–13).
- D14 = runners, D15 = metrics/cost, D16 = resume/continuity, D17 = review re-validates, D18 = automations, D19 = integrations, D20 = notify requester (Waves 14–20).
- P0 = `P0.1 zero-cost sincerity`, `P0.2 runners sincerity`, `P0.3 human-accept without auto-score`; P1 = `P1.4 selfImprovement auto`, `P1.5 scorers agents`, `P1.6 benchmarks+scorers per trial`, `P1.7 threshold display-only`; P2 = lab cosmetics (H-007 class).

If the original report used slightly different dim labels, scores shift by at most ±2 points globally (bounded in §5).

## 3. Dimension matrix (20)

Legend: **Replica** = Warp behavior reproduced live with evidence. **Partial** = code + unit tests green but live proof missing/weak, or Warp semantics narrowed honestly (e.g. mock-local). **No** = not built. Tag: **Live** (browser + daemon + disk assert), **Unit** (offline suites + `tsc`), **Mock** (pact-gated or mock-local seam, never in the real path).

| Dim | Warp capability | Verdict | Score /100 | Evidence (file:line, tests, live run, finding) | Live / Unit / Mock |
|---|---|---|---|---|---|
| D01 | Work-item lifecycle + identity (Intake→Triage→Planning→Building→Reviewing→Complete/Cancelled; reply continues same item; no dup) | **Replica** | 90 | Loop `MASTER-PLAN-FACTORY.md` §1.1/§2.1 live; `workItemStore` + `job.json` atomic; E2E-01 PASS (run 1), E2E-04 PASS (run 2, 8); pacts F01–F14 green; H-010 (lateral writes) fixed + verified zero Foreman writes in run 7 | **Live** |
| D02 | Foreman (sole speaker; skips trivial; routes with context; approval gate) | **Replica** | 85 | `foreman/foreman.ts` + `foremanPrompt.ts` + `foremanLog.ts`; Ola-8 wiring `{triage,spec}` into Foreman (188/188); E2E-03 full-loop PASS run 2 (`job-mtma46zk-ma7c`: 4 questions → respond → Foreman); `GET /factory/foreman/logs` | **Live** |
| D03 | Triage agent (evidence/scope/complexity/openQuestions; ambiguous → human Triage) | **Replica** | 90 | `triageAgent.ts` + `triage.json` + `POST /:id/triage/respond` + `TriageQuestions.tsx` (17/17); E2E-03 PASS run 2 (re-greened H-002); H-002 VERIFIED | **Live** |
| D04 | Spec agent (brief + acceptance criteria + target files; human approval gate for non-trivial; trivial auto-skip traced) | **Partial** | 55 | `specAgent.ts` + `spec.md` + `spec/approve` endpoint (Ola-8, 188/188); **live approval never exercised** (no E2E case ever hit `needsSpecApproval` with a real brief; runs 0–8 contain zero spec-approval asserts). Code complete, live unproven | **Unit** |
| D05 | Implement (continues branch, real 1–3 file change, real `pnpm`, never merges; pact-mock gated) | **Partial** | 75 | `implement/*` + `runnerExecutor` + `verification`; H-001 fixed + re-greened live run 2 (`createdFiles` exact equality); H-012 fix (empty-folder → fail, 8/8) pending live re-green with healthy LLM; H-013 fix (late-write reconcile, 7/7) VERIFIED-pending-live; E2E-05 PASS once then FAIL once (H-013) | **Live** (with teeth gaps) |
| D06 | Verify as own stage (per-language tests+build, evidence; visual honest pending-human; re-verify entry; reviewer decides) | **Partial** | 70 | `verify.json` + `GET /verify` + `POST verify-retry` + `VerificationPanel` full→partial→empty (Ola-9, 225/225; H-008 re-greened run 7 full view in Review); visual = `pending-human` honest (no fake computer-use); **teeth gap**: H-013 showed verify-retry pass without reconcile (fixed, not yet re-greened live) | **Live** (partial teeth) |
| D07 | Review adversarial (disjoint model, always; Unambiguous→revise vs Ambiguous→ask_human; advisory, never merges; raw + ladder + fallback + retry-review-only) | **Partial** | 65 | `review/*` + `reviewModelSelector.ts` (builder-aware `fallbackFor`, H-006 fixed) + `review-raw-{N}.txt` 64KB + `GET /:id/review/raw` + `POST /:id/review/retry-review` (Ola-5, 96/96→129/129); E2E-02 accept `big-pickle 0.95` + H-006 re-greened run 8 (disjoint `muse-spark→big-pickle` accept); **penalty: 0 natural revises in 9 runs** (runs 0–8: E2E-02 always PASS-by-equivalence, E2E-06/07 always DIFERIDO); H-005 infra kills most reviews | **Unit-strong, Live-weak** |
| D08 | Definitions as code + validate file:line + visible fallback (agents/yaml/skills/scorers/runners/benchmarks; `validate` + badge, same 30 s tick) | **Replica** | 95 | `factory/agents/*/agent.md` (5) + `factory.yaml` + `factory/skills/*/SKILL.md` (3) + `factory/scorers/*/scorer.md` (3) + `factory/runners/*.yaml` (2) + `definitionValidate.ts` (30 rules) + `GET /factory/definition/status` + `scripts/factory.mjs validate` + `DefinitionBadge` + `docs/LOOPS.md` 50 rows + `no-unbounded-loops` meta-test (Ola-20, 474/474); E2E-10 PASS live (CLI red `scorer.md:7` + red badge + flow alive + byte-identical restore + green badge, run 4) | **Live** |
| D09 | Skills read by agents (factory-wide + per-agent; skill change alters a real verdict traceably) | **Partial** | 70 | `agentLoader` skill load (cap 8 KB, cache, anti-traversal) + reviewer reads `code-review`+`repo-conventions` (+`ui-verification` when visual) + prompt Skills-applied section + timeline meta (Ola-10, 221/221); **live skill→verdict experiment never run** (Ola-10 carry-over: needs a user job) | **Unit** |
| D10 | Scorers (1-question judge, labels, sampling 25%, manual always, re-score replaces, `agents` field, threshold display-only) | **Partial** | 75 | `measure/` engine + sampler (`sampler.ts:38-50`, `shouldSampleJob` FNV-1a) + `scores.json` + 4 endpoints + `ScorersPanel` (Ola-11 288/288; Ola-18 285/285: `agents` closed vocab + 409 honest + display-only recompute); E2E-08 PASS run 8 (H-004 CLOSED as deterministic sampled-out: job1 OUT 56, job2 IN 9 @25%); P0.3 `accept`→`autoScoreCompletedJob` wired; **penalty: sampled-out vs unscored trace still confusing; judge needs healthy LLM** | **Live** (sampling proven; judge flaky) |
| D11 | Benchmarks (fixed tasks × configs × reps, Correctness built-in, per-trial scorers + `scorePassRate`, costed, no auto-winner, human weights cost/quality) | **Partial** | 60 | `benchmarkEngine` cap 50 + 3 endpoints + 4 neutral reference-tasks + `BenchmarksPanel` (Ola-12 331/331; Ola-18 trial `scores` + cost `trials×(1+S)`); **live decision never made** (E2E-09 always DIFERIDO: 0 new fails; rodaje never ran; no benchmark ever decided a model change); trial scorers mock-judged in tests | **Unit (+Mock judge)** |
| D12 | Self-improvement (groups failures → proposes `factory/` diff with `Regressions addressed` links → Adopt/Discard panel; never auto-applies; cooldown) | **Partial** | 55 | `improvementEngine` (collect/analyze/adopt/discard, mock seam, allowlist, backup-before-write) + 6 endpoints + `SelfImprovementPanel` 2-click (Ola-13 367/367; Ola-18 auto-propose on 2 new fails + cooldown default 1); **no live auto-proposal ever** (needs 2 genuine fails of one scorer; runs produced 0); no adopt→metric improvement shown | **Unit** |
| D13 | Human authority + evidence on disk (override Accept-equal/Derive/Adopt-Discard always; every decision in `job.json`/`review.json`/`verify.json`/`scores.json`/timeline/`build.log`; no auto-merge) | **Replica** | 90 | Rules 3–5 enforced; `POST /review/accept` + `POST /cancel` + proposal Adopt/Discard; E2E-04 PASS (honest infra message + 0 invented findings + human accept → Complete); H-004/H-006 honest paths; pacts intact | **Live** |
| D14 | Runners honest + declared isolation (as-code, docker probe fail-open, badge tells the truth) | **Partial** | 80 | `factory/runners/linux-build.yaml` (`node:22-bookworm`, `isolation:docker`) + `windows-local.yaml` (`isolation:none`) + `getRunners/getRunner` + probe `docker info` 5 s/TTL 60 s + `isolation` in evidence + `IsolationBadge` (Ola-15 171/171); E2E-12 PASS run 7 **both halves** (pull-timeout → fail-open local with event; cached-image setup in docker 1991 ms); H-009 re-greened; minor: stale `ubuntu:22.04` labels in logs/header (cosmetic) | **Live** |
| D15 | Real metrics/cost (calls + estimated tokens + USD only with rate, basis visible; never `USD 0.00` as data; kill-switch) | **Partial** | 60 | `costTracker` (`COST_TRACKER_MAX_ENTRIES=10000` FIFO) + `promptWithCost` in all 7 agents + `refreshCostSummary` (no double-count) + `CostBadge` (Ola-15); E2E-13 PASS (all run jobs `llmCalls>0`); **penalties: `costRates:{}` → USD never shown (`sin tarifa` always); basis `chars/4` is an estimate; failed attempts counted honestly but add noise** | **Live** (calls yes; USD no) |
| D16 | Conversational continuity (1 session per job+role reused; lazy renewal with visible event; flag off = old behavior) | **Partial** | 50 | `sessions/agentSessions.ts:257-318` (`promptInAgentSession`: ≤1 create + ≤2 prompt per call, 1 renewal on not-found) + `agentSessions` in types/store/disk + 7 callers migrated + flag `agentSessions` (Ola-16 377/377); **never exercised live** (needs a natural revise; 0 revises in 9 runs; E2E-06 always DIFERIDO); known pre-existing offline hang `agent-sessions-migration.test.ts` (review path, daemon down; no Ola-20 intersection) | **Unit** |
| D17 | Review re-validates (focused re-verification from closed allowlist, executed by the system, 1/review inside budget 2; skill-taught) | **Partial** | 45 | `ReviewFinding.reverify?` + allowlist 5 cmds (fail-closed) + `runFocused` reusing `spawnStep` + `maybeRunReverify` + skill section + flag `reviewerReverify` (Ola-17 299/299; always-asks mock terminates `ask_human reviewCount=2`); **never fired live** (E2E-07 always DIFERIDO; no reviewer ever doubted evidence live) | **Unit** |
| D18 | Automations (schedule + event triggers with quotas + cooldown + dedupe + per-trigger and global kill-switch; evidence ring) | **Partial** | 55 | `automations/{automationTypes,automationStore,triggerEngine,automationService,automationRoutes}` + `AUTOMATION_TICK_DEFAULT_MS=30000` + `maxFires` default 5 + `cooldownMs` default 60000 + `AUTOMATIONS_MAX_TRIGGERS=20` + `AUTOMATIONS_MAX_ENTRIES=200` + R1/R2 + `AutomationsPanel` + `factory.yaml automations:`; offline 193/193 Ola-14 (engine 18/18, service 14/14, routes 12/12, validate 15/15, loops 5/5, route-table 17/17); **live: single `POST /automations/tick` → `fired:0` honest empty pass** (`triggers:[]`, REPORT-ola14 §2); `.automations.json` absent (correct); no schedule ever created a job live; no event ever fired live; pact-id refusal only unit-proven | **Unit + Live-empty-pass** (effect unproven) |
| D19 | Integrations (one provider proven with zero secrets; post on disk; ack reconciled; validator rejects live/secrets) | **Partial** | 60 | `integrations/{integrationTypes,mockAdapter,integrationService,integrationRoutes}` + `INTEGRATION_MOCK_MAX=100` + `TITLE_MAX=200/BODY_MAX=2000` + R3/R4 + `IntegrationsPanel` (`linear-mock-local` amber) + `factory.yaml integrations: {enabled, mock-local, linear}`; offline `integrations-mock` 11/11 + service-routes 15/15 (zero-network asserted); **live: 2 mock posts on disk** (`m-...-1/-2`, 642 B, status `count:2 lastAckedAt:null`, UI list renders both with Ack buttons); **honest gaps: mock ack has no HTTP route** (`POST /notifications/:id/ack` on mock id → honest 404, REPORT-ola14 §4, DESIGN §5 scope-freeze); full `ask_human → post → ack-reconciled → timeline` never exercised live; **real external intake impossible in mock by design** (PRD non-goal) | **Mock-local Live** (not a Warp Linear/Slack replica) |
| D20 | Notify the requester (bell + panel + OS toast; ask_human/spec/proposal/benchmark/daemon-error; human-accept enters baseline) | **Replica** | 85 | `notify/notifications.ts` (`NOTIFICATIONS_MAX=100` ring, dedupe) + `GET /notifications` + `POST /:id/ack` + 5 best-effort emitters + `NotificationsBell` (poll 5 s) + renderer toast (focus+dedupe cap 200) + flags (Ola-19 305/305); E2E-11 PASS run 3 (H-003 re-greened [8,328] both viewports 1280+375; Ack 61→60 `acked:true`); E2E-08 PASS (human accept scores); live ring serving 100 with `ask_human` + `benchmark-done` traffic | **Live** |

Gaps P0/P1/P2 (original report language → current standing):

| Gap | Was | Now | Standing |
|---|---|---|---|
| P0.1 zero-cost (`USD 0.00` hardcoded ×12) | Cost theater | `llmCalls` + `chars/4` + `sin tarifa` honest; `costTracking` switch | **Closed-code, open-USD** (D15 60: needs real `costRates` + a live USD badge assert) |
| P0.2 runners theater (`linux-build` without isolation proof) | `ubuntu:22.04` + `corepack` theater | As-code + probe + fail-open + badge (H-009 closed live) | **Closed** (D14 80; remainder is stale-label cosmetics) |
| P0.3 human-accept without auto-score | `scores.json` absent after Accept-equal | Same helper fire-and-forget on both accepts (E2E-08 green) | **Closed** (D10/D20; remainder is sampled-out visibility) |
| P1.4 `selfImprovement` without effect | Flag decorative | Auto-propose on 2 new fails + cooldown (unit) | **Closed-code, open-live** (D12 55) |
| P1.5 scorers without `agents` | No applicability | Closed vocab + 409 honest + 3 scorers tagged (unit + 409 path) | **Closed** (D10) |
| P1.6 benchmarks without per-trial scorers | Correctness only | `trial.scores` + `scorePassRate` + costed (mock-judged tests) | **Closed-code, open-live** (D11 60) |
| P1.7 threshold rewrites history | `passing` frozen at write | Display-only recompute on read (disk untouched) | **Closed** (D10) |
| P2 cosmetics (H-007 model label + fetch, H-003 clamp, stale ubuntu labels) | Mixed | Label fixed + verified live; fetch diagnosed-no-fix by design; clamp fixed + verified; stale runner labels remain | **Closed except stale-label P2** |

## 4. Honest penalties applied (why no dimension gets 100)

1. **0 natural revises in 9 runs.** E2E-02 always PASS-by-equivalence (no `revise` forced by the system); E2E-06/07 DIFERIDO in every run (1, 2, 4, 6, 7, 8 + rodaje 6 jobs + run 0). D07/D16/D17 are therefore **code-proven, live-unproven**. Any parity claim that counts them as Replica is theater.
2. **Spec-approval live never premiered.** No run ever produced a real brief + human approval + implement-cites-spec chain (D04 55).
3. **Benchmark manual without a decision.** E2E-09 always DIFERIDO (0 new fails; rodaje needs 10–25 calls + separate confirmation). No benchmark ever decided a model change with evidence (D11 60).
4. **`costRates: {}`.** USD has never appeared live; the badge always says `sin tarifa`. Calls/duration are real, money is not (D15 60).
5. **Sampled-out trace.** H-004 was correctly closed as deterministic sampling (FNV-1a OUT 56 / IN 9 @25%), but a missing score is still indistinguishable in UI between sampled-out and judge-down without reading the daemon log (D10 penalty).
6. **Verify teeth.** H-013 (verify-retry pass without reconcile → `createdFiles:[]` Complete) and H-012 (empty-folder + blind pass) were fixed with suites (7/7, 8/8) but neither fix has re-greened live with a late-write (D05/D06 penalty).
7. **Real external intake impossible in mock.** Ola-14 is `mock-local` + `linear`-only by design; secrets/live/slack rejected fail-closed. Warp intake (Slack/Linear/GitHub/Jira event → run → post-back, reply-continues-item, AND/OR filter matching, overlapping-runs warning) has no live counterpart. This is the single largest structural gap (D19 capped at 60).
8. **H-005/H-011 infra.** Model-server `UnknownError` (flaky → 8/8 hard-down in rodaje; `gemini-3-flash` fails identically → server-side, not model-side) conditions every live verdict; `vite-plugin-electron` `taskkill` race kills `pnpm dev` + daemon together (workaround = manual relaunch). Neither is a factory bug, both cap live parity.
9. **Node 20 vs 22 pre-existing fails.** `tsc -p tsconfig.headless.json` shows 8 pre-existing errors outside Ola 14 (`electron/memory-service`, `opencode-session`, `telemetry-service`, `subprocess-worker`); `tsc -p tsconfig.json` (src+shared) is 0. Ola-14 files are 0-error. The 8 are not parity debt but they are CI noise.
10. **Live tick `fired:0` honest.** The Ola-14 live tick is an empty pass (`triggers:[]`, no yaml edit attempted, no `.automations.json` entry — correct). It proves the path does not lie; it does not prove a schedule creates a job or an event chains an action. D18 is scored accordingly.
11. **2 mock posts, 0 mock acks over HTTP.** The duplicate `m-...-2` (`body:dup`) is disclosed QA noise, not product data. Ack-over-HTTP 404 is honest (no route by DESIGN §5) with unit coverage (`integrations-mock` 11/11), but the T05 loop `ask_human → ack-reconciled` remains a Known Issue.

## 5. Formula + final percentages (weighted; P0 counts double)

**Weights:** P0 dims (D14, D15, D18, D19, D20) ×2; all others ×1. Total weight = 5×2 + 15×1 = **25**.

**Scores used** (§3, 0–100 per dim):

```
D01 90, D02 85, D03 90, D04 55, D05 75, D06 70, D07 65, D08 95,
D09 70, D10 75, D11 60, D12 55, D13 90,
D14 80×2, D15 60×2, D16 50, D17 45, D18 55×2, D19 60×2, D20 85×2
```

**Computation:**

```
weighted_sum = 90+85+90+55+75+70+65+95+70+75+60+55+90
             + 160+120+50+45+110+120+170
           = 1750
global = 1750 / 25 = 70.0
```

**Live-only recomputation** (same weights, live-strict scores: D01 85, D02 80, D03 85, D04 20, D05 70, D06 60, D07 35, D08 90, D09 30, D10 60, D11 20, D12 15, D13 85, D14 75×2, D15 50×2, D16 10, D17 10, D18 20×2, D19 30×2, D20 80×2):

```
live_sum = 735 + 150+100+10+10+40+60+160 = 1265
live = 1265 / 25 = 50.6
```

**Reported result (ranges, not magic numbers):**

- **Global parity (code + live, P0-weighted): 68–74%** (point 70.0; ±3 covers dim-label reconstruction uncertainty §2 and ±5 scoring judgment on the five Partial-live dims).
- **Live-only parity (must show in browser + daemon + disk): 48–54%** (point 50.6).
- **Code-only parity (suites + `tsc` + contracts, mocks included): 68–74%** (same point as global; the gap between code and live is the honest story: ~20 points of built-but-unpremiered behavior).
- **Starting point comparison:** the 65% baseline cited in PRD-ola14 (pre-Wave-14 deferral lift) sits inside the code-only band and above the live band — consistent: Ola 14 added real code (+6 God lines, +4 routes, +9 LOOPS rows, 216/216) but its live effect is still an honest empty pass + 2 mock posts.

Formula for reproduction: `parity = Σ(score_i × w_i) / Σ(w_i)`, `w_i = 2` iff dim ∈ {D14,D15,D18,D19,D20} else 1. Live and code variants reuse the same weights with the two score columns above.

## 6. Top 5 gaps to 100% (ordered by parity leverage)

1. **Real external intake + post-back (D19 → Replica).** Wire one live provider (Linear *or* Slack, not both) with real credentials seam (P1-design-only today), AND/OR filter matching, reply-continues-item, and post-back to the thread/issue. Mock-local can never exceed Partial by definition. Requires a secrets/vault decision + redacted-log audit (explicit P1 non-goal today).
2. **A live revise→rebuild→reverify loop (D07/D16/D17 → Replica).** Needs one natural `revise` with a healthy model server: rebuild in the *same* session (timeline proof), reviewer-requested `reverify` evidence before the final verdict, all within `REVIEW_MAX_COUNT=2`. Closes three dims at once; blocked today by H-005, not by code.
3. **Human-in-the-measure loop live (D04/D11/D12 → Replica).** One spec-approval gate premiered live (brief → approve → implement cites it) + one benchmark that actually decides a model/config change (human weights cost/quality, no auto-winner) + one auto-proposal born from 2 genuine fails and Adopted/Discarded from the notification. All three are code-complete.
4. **Real money + clear sampling trace (D15/D10 → Replica).** Fill `costRates` for the models actually used and assert a live `~USD Y (est.)` badge with basis; add a UI string distinguishing `sampled-out (25%)` from `judge-down (unscored)` without reading daemon logs (H-004 follow-up P2).
5. **Verify teeth + daemon stability (D05/D06 + infra).** Re-green H-012/H-013 fixes live with a late-write case; clear stale `ubuntu:22.04` labels; separate the daemon from `pnpm dev` (H-011 workaround → real fix or documented standalone-only mode); keep `agent-sessions-migration` hang owned (Ola-16 owner + re-check with live daemon). No new features until the live loop is flake-free for 10 consecutive jobs without infra `ask_human` (E2E-perfect §5.4).

## 7. Quality factor — cohesion/coupling (not parity)

Reported separately per instructions; it does **not** inflate the parity number.

- **God server:** 4591 (pre-modularity) → 4010 (−581, batches 1–3) → 3575 (Tanda C single dispatch) → **3581 (+6 Ola 14: 2 imports + 4 one-line cases)**. The God no longer decides: `matchRoute` in `routing/routeTable.ts` + `switch (routed.domain)` in `factoryServer.ts:2288-2335`; bodies live in domains. Budget respected.
- **Dispersion:** 14 factory domains + 40 route rows + 36 client ops + 15 panels/components. One writer per artifact (C3: jobs→`jobs/jobCreate`, notices→`notify`, `.automations.json`→`automationStore`, `.integrations-mock.json`→`mockAdapter`, rich result→`resultStore`); one client (`factoryClient`); one view projection path (`jobView`); zero new renderer intervals (cards reuse 2.5 s/5 s/30 s); one daemon ticker (`AUTOMATION_TICK` 30 s + `clearInterval`).
- **Anti-loop closure:** `docs/LOOPS.md` 50 + 9 (A01–A06, I01–I03) rows, 0 `SIN COTA`; `no-unbounded-loops` meta-test green (5/5 Ola-14 slice; 474/474 Ola-20 full). Every automatism has a yaml kill-switch (Rule 8: `enabled`, `tickMs:0`, `maxFires:0`, `samplingRate:0`, `costTracking:false`, `agentSessions:false`, `reviewerReverify:false`, `improveProposalCooldown:0`, `notificationsEnabled/osNotifications:false`, `integrations.enabled:false` → honest 409).
- **Verdict on quality:** high cohesion / low coupling achieved and enforced by tests. It makes the remaining parity gaps *cheap to close* (each is a domain-local change + a live run), which is exactly what the score ranges reward and what a God-monolith would not.

## 8. Reproduction commands (all with explicit timeouts; daemon never touched beyond GETs)

```powershell
# baselines (utf8, timeouts explicit)
(Get-Content -Encoding utf8 headless-runtime/factory/factoryServer.ts).Count
(Get-Content -Encoding utf8 headless-runtime/factory/routing/routeTable.ts).Count
Get-ChildItem -LiteralPath "headless-runtime/factory" -Directory | Select-Object -ExpandProperty Name
Get-Content -Encoding utf8 factory/factory.yaml
# live (15 s each, GET only — NEVER restart/taskkill/pnpm dev|build)
Invoke-RestMethod -Uri http://127.0.0.1:17680/factory/health -TimeoutSec 15 | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri http://127.0.0.1:17680/factory/definition/status -TimeoutSec 15 | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri http://127.0.0.1:17680/factory/automations -TimeoutSec 15 | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri http://127.0.0.1:17680/factory/integrations/status -TimeoutSec 15 | ConvertTo-Json -Depth 4
Get-Content -Encoding utf8 factory/.integrations-mock.json
```

## 9. Verdict

**Global 68–74% (point 70.0, P0-weighted) · Live 48–54% (point 50.6) · Code 68–74%.** The system is a faithful local Warp *construction kit* (as-code, measure, guards, evidence) with a live core (intake→triage→build→verify→review→notify→validate) and two honestly-narrowed edges (automations without scheduled fire yet; integrations mock-local without real intake or HTTP ack). The ~20-point code-vs-live gap is the entire story: everything built terminates (Rule 7) and switches off (Rule 8), but the three most Warp-like behaviors — resume, reverify, and self-driven improvement — have never premiered live because no natural revise has occurred in 9 runs under a flaky model server. Close the 5 gaps in §6, in order, with live runs; do not add features.
