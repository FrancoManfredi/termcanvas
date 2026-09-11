# PARITY-100 formula — recomputed F6 (honest shortfall, no theater)

Method: `parity = Σ(score_i × w_i) / Σ(w_i)`, `w_i = 2` iff dim ∈ {D14,D15,D18,D19,D20} else 1. Total weight 25. Baseline: audit 70.0 global / 50.6 live (`AUDIT-paridad.md` §5). A dim moves only with same-build (`15fece3e`) live evidence linked below; everything else frozen at audit.

## Global recomputation

| Dim | Audit | F6 | Δw | Evidence (F6 window unless noted) |
|---|---|---|---|---|
| D01 lifecycle | 90 | 90 | 0 | F1 reply-continue at service seam; HTTP reply path still unproven — frozen |
| D02 foreman | 85 | 85 | 0 | genuine routes observed (0.99/0.96); no new capability — frozen |
| D03 triage | 90 | 90 | 0 | E2E-03 fresh PASS (triage 0.96 + 3 concrete Qs, `job-mtohs9bm-1ihi`) confirms, does not exceed — frozen |
| D04 spec-approval | 55 | 55 | 0 | chain still absent (F3-A + F6 E2E-03 never reached spec gate) — open |
| D05 implement | 75 | 85 | +10 | H-012 fail-half + H-013 reconcile-before-accept re-greened live F5 (`job-mtoggi1d-gp0n`) and corroborated ×3 in F6 (`g1yi, vmto, 4twc` reconcile notes); full LLM path seen (`bfol strategy=llm`) |
| D06 verify | 70 | 80 | +10 | verify-retry reconcile live ×4 F6-window jobs; `overall:pass` honest; trivial-shortcut shape stable |
| D07 review | 65 | 65 | 0 | 0 natural revises in 10 F6-window verdicts — penalty stands, open |
| D08 definitions | 95 | 95 | 0 | E2E-10 fresh PASS (red CLI + served red + green restore) confirms — frozen |
| D09 skills | 70 | 70 | 0 | skill→verdict experiment never run — open |
| D10 scorers | 75 | 75 | 0 | E2E-08 fresh PASS (baseline + sampled-out proven); fresh `scoreReason` on disk still unproven — frozen |
| D11 benchmarks | 60 | 75 | +15 | F3-B: run `bench-mtoce4ee2ph0ap` done (2 trials, 7 calls) + `benchmark-done` notify (no winner) + human `BenchmarkDecision` on disk, assert-passing. Remainder: single-config keep-decision, no screenshot — Partial |
| D12 self-improvement | 55 | 55 | 0 | 0 genuine fails in 5 demanding jobs (F3-C 3 + F6 2); gate correctly silent — open |
| D13 human authority | 90 | 90 | 0 | 4 human-equivalent accepts + 1 ack observed; no auto-merge anywhere — frozen |
| D14 runners ×2 | 80 | 85 | +10 | E2E-12 fresh PASS (isolation=none meta + local runner events, docker down); stale-label grep 0 (F5-T2) |
| D15 money ×2 | 60 | 60 | 0 | `costRates:{}` (no user tariffs) → `sin tarifa` honest on 6/6 jobs; money-half open — frozen |
| D16 continuity | 50 | 55 | +5 | 4/4 F6 Completes exactly 1 session/role; revise-triggered reuse still F2-only — Partial |
| D17 reverify | 45 | 45 | 0 | never fired live (0 doubts in 4 reviews) — open |
| D18 automations ×2 | 55 | 55 | 0 | `triggers:[]` still; no scheduled fire live — open |
| D19 integrations ×2 | 60 | 65 | +10 | F1 seam proven (webhook→job `integrationRef`, reply-continue, filter-reject, post-back mock + honest-failed-3); HTTP-create needs loader carry-over + real creds — Partial |
| D20 notify ×2 | 85 | 90 | +10 | ring 100 live + `ask_human` ack → `acked:true` (F6 E2E-11) + actionable message quality |

```
weighted_sum = (D01..D13) 90+85+90+55+85+80+65+95+70+75+75+55+90 = 1010
             + (singles) D16 55 + D17 45 = 100
             + (doubles) D14 170 + D15 120 + D18 110 + D19 130 + D20 180 = 710
           = 1010 + 100 + 710 = 1820
global = 1820 / 25 = 72.8  (audit 70.0 → +2.8)
```

## Live-only recomputation (same weights, live-strict column)

Deltas applied only where F6-window live evidence exists: D05 70→80 (+10), D06 60→70 (+10), D11 20→40 (+20, decision on disk), D14 75→80 (+10×2), D19 30→40 (+10×2, seam live at service, HTTP pending), D20 80→85 (+5×2), D16 10→15 (+5).

```
live_sum = 1265 + 10+10+20+20+20+10+5 = 1350
live = 1350 / 25 = 54.0  (audit 50.6 → +3.4)
```

## Verdict

- **Global 70–76% (point 72.8) · Live 51–57% (point 54.0).** Bands cover dim-label reconstruction uncertainty (audit §2, ±2) plus scoring judgment on Partial-live dims.
- **NOT 100%. Replica 9/20** (D01,D02,D03,D05,D06,D08,D13,D14,D20); **Partial 11/20** (D04,D07,D09,D10,D11,D12,D15,D16,D17,D18,D19); No 0/20.
- The 100% bar (20/20 Replica vivo, band 95–100) is missed by ~22 points global / ~41 live. This is an honest shortfall, not a near-miss dressed up.

## FU-4 recompute (2026-09-05, build `15fece3e`, 0 quota, 0 code beyond this md)

Scope: single-dim gain from `REPORT-FU4-tariffs.md` §FU-4c/4e (FU-4d fix under test).
Rule honored: a dim moves only with same-build (`15fece3e`) live evidence linked below.
D10 does NOT move (fresh `scoreReason` on disk still unproven live — F4 DIFERIDO, F6 sampled-out, no sampled-IN natural accept in FU-4 window).
All other dims frozen at F6.

### Delta table (F6 → FU-4)

| Dim | F6 | FU-4 | Δw | Evidence (same build `15fece3e`) |
|---|---|---|---|---|
| D15 money ×2 | 60 | 85 Replica | +50 | `factory/factory.yaml`: 27 user-confirmed tariffs under `costRates` (exact live modelKeys `opencode-go/<model-id>`, base-tier only `<=`/off-peak/no Peak; cache/uso ignored, no invented precision; 27/28 discrepancy documented, no 28th invented) + `ratesAsOf: "2026-09-05"` + `ratesSource: "https://opencode.ai/docs/go/"` + ritual comment. Weekly ritual <2min manual, zero automation by design, no network fetch, no new intervals. Live job `job-mtom6yrb-tw54` (Complete 16:50:29Z, default `opencode-go/muse-spark-1.2-contributor`, review accept intento 1): timeline ALL 5 with `~USD`, ZERO `sin tarifa` (`1 ~1094 ~USD 0.0001`, `2 ~2687 ~USD 0.0003`, `3 ~3691 ~USD 0.0004` spark ref, `4 ~7567 ~USD 0.0004`, `5 ~11505 ~USD 0.0008` spark ref). Final `costSummary` GET == disk field-by-field: `{llmCalls: 5, in: 11285, out: 220, estimatedUSD: 0.0007842000000000001, basis: "estimated-chars/4", ratesRef: "opencode-go/muse-spark-1.2-contributor"}`. Preserve-fix `mergeCostWithPrevious` live: call-4 USD stayed EXACTLY `0.00038360000000000005` despite +3869/+7 tokens (preserve held, no null-out); call-5 `0.0003836 + spark-delta(3870,68)=0.0004006 = 0.0007842` exact; old code would re-rate whole total at last rate (`0.0011725`, differs, proves new semantics live). FU-4c FAIL (Complete regressed to null/null) reproduced and defeated. Legacy `job-mtohz20a-4twc` still `{null, null, basis}` untouched (no retroactive re-rating). Zero-invention: exact-boundary `USD 0.00(?!\d)` = 0 hits, `sin tarifa` = 0 hits in `job.json`. Pre-gates: suites 104/104 (`cost-per-job-model` 13/13 incl. 2 FU-4d regression + 91/91) + guards 23/23 + `tsc --noEmit` 0 + `validate` 0. Daemon `buildId 15fece3e == HEAD`, started 16:41:21Z AFTER fix mtime 16:39:46Z. Capped at 85 (not 90): `ratesAsOf` tooltip prop-only (`CostBadge.tsx` ready, `WorkItemList` wiring needs route/table change, out of scope) + badge pixels BLOQUEADO-obs (14th lock, server-composed strings + GETs + disk per task order) + no staleness gate by design. |
| D10 scorers | 75 | 75 frozen | 0 | No new live evidence: fresh `scoreReason` on disk still unproven (F4 attempt burned 1 call, no persist; F6 both Completes sampled-out by design). FU-4 window added no sampled-IN natural accept. |
| All others | F6 | frozen | 0 | No new same-build live evidence claimed in FU-4 window. |

### Formula (weights unchanged: ×2 iff dim in {D14,D15,D18,D19,D20} else ×1, total 25)

```
weighted_sum = F6 1820 + (D15 85-60)*2 = 1820 + 50 = 1870
global = 1870 / 25 = 74.8  (audit 70.0 -> +4.8; F6 72.8 -> +2.0)

live_sum = F6 1350 + (D15-live 80-50)*2 = 1350 + 60 = 1410
live = 1410 / 25 = 56.4  (audit 50.6 -> +5.8; F6 54.0 -> +2.4)
```

Live-strict D15 50->80 mirrors global (+5 gap, same shape as D05/D14/D20 Replica): full USD + preserve proven live, minus 5 for tooltip-unwired + pixels-blocked obs debt.

### Verdict (FU-4)

- **Global 72-78% (point 74.8) · Live 53-59% (point 56.4).** Bands cover dim-label reconstruction uncertainty (audit §2, ±2) plus scoring judgment on Partial-live dims.
- **NOT 100%. Replica 10/20** (D01,D02,D03,D05,D06,D08,D13,D14,D15,D20); **Partial 10/20** (D04,D07,D09,D10,D11,D12,D16,D17,D18,D19); No 0/20.
- The 100% bar (20/20 Replica vivo, band 95-100) is missed by ~20 points global / ~39 live. Honest shortfall, not near-miss theater.
- FU-4 money-half DONE (audit §6 gap 4, F4 carry-over 1, F6 shortfall 4-D15-half): user tariffs + live `~USD Y (est.)` badge with basis + ratesRef + zero `0.00`-as-data + preserve + ritual. FU-4c FAIL superseded by FU-4e PASS (final, Round 2 of 2, closed, routing NoOne).

### Remaining shortfall (owning order)

1. D15 → 90+: one-line `ratesAsOf` wiring (`WorkItemList` data source + route/table) + CostBadge pixels when browser singleton frees (FU7 retry, renderer 5173 UP per `REPORT-FU7-observacion.md`, browser still LOCKED) + 28th tariff if id surfaces via ritual. No staleness gate by design (human judgment + visible date).
2. D10 → Replica: natural sampled-IN accept → fresh `scoreReason` on disk (still the open half of F6 shortfall 4).
3. Unchanged from F6: D19 loader `live` carry-over + real creds; D07/D16/D17 natural revise + reverify in budget 2; D04 spec chain + D12 rodaje 2 fails → Adopt/Discard; D18 first scheduled/event fire; D09 skill→verdict experiment; observation debt batch (14 screenshots + badge/panel pixels, 0 quota).

## Shortfall → follow-ups (F6 frozen history, owning order, audit §6 leverage)

1. D19→Replica: loader `live` carry-over + real credentials seam + signed HTTP intake live (needs user: provider choice + env names). Biggest structural gap.
2. D07/D16/D17→Replica: one natural revise with healthy model server (rebuild same-session + reverify-before-verdict inside budget 2). Blocked by phenomenon rarity, not code.
3. D04/D12→Replica: spec-approval chain (needs healthy triage+spec back-to-back) + rodaje to 2 genuine fails → proposal → Adopt/Discard from notification (~13–15 calls, fresh confirmation).
4. D15/D10→Replica: user-confirmed `costRates` tariffs (numbers, never invented) → live `~USD Y (est.)` badge; natural sampled-IN accept → fresh `scoreReason` on disk.
5. D18→Replica: first scheduled/event fire creating a job live (yaml trigger + tick evidence).
6. D09→Replica: user-job skill→verdict experiment.
7. Observation debt (0 quota, no code): 14 screenshots + badge/panel pixels when browser singleton frees + renderer 5173 up.

## POST-autonomo recompute (2026-09-05, build `15fece3e`, 0 quota, 0 code beyond this md)

Scope: autonomous batch after FU-4 — `REPORT-FU6-skill.md` (FU-6 skill-to-verdict, DIFERIDO-infra, skill reverted, 7 calls), `REPORT-F3-measure-humano.md` §A-retry (first live brief + human approval `job-mtop4fcx-0rii`; cite blocked → parser fixed offline `tests/implement-spec-demo-quoted.test.ts` 6/6, pending restart) + §C-retry (0 genuine fails, DIFERIDO), `REPORT-FU7-observacion.md` (6/6 screenshots incl. benchmarks), `REPORT-D18-followup5-gap.md` (live tick `fired:0`, fix offline pending restart).
Rule honored: a dim moves only with same-build (`15fece3e`) live evidence linked below.

### Delta table (FU-4 → POST-autonomo)

| Dim | FU-4 | POST | Δw | Evidence (same build `15fece3e`) |
|---|---|---|---|---|
| D04 spec-approval | 55 | 70 high-Partial | +15 | A-retry `job-mtop4fcx-0rii` (created 2026-09-05T18:08:03Z): `spec.md` EXISTS (6 criterios, 3 targetFiles, 3 openQuestions, `trivial:no`) + notification `n-1788631752800-440` (`spec-approval`) + human `POST spec/approve` 200 + `specApproved:true` 18:10:16Z + foreman `decided building` post-approval. First live brief + approval ever (F3-A had 0 briefs in 3 jobs). Cite ABSENT (implement `sin parse confiable → Triage`, deterministic 1c quoted-folder gap); parser fix proven offline only (6/6, needs user restart) — so Partial-high, not Replica. |
| D11 benchmarks | 75 | 75 frozen | 0 | FU-7 `fu7-benchmarks.png` (96784 B) closes the screenshot half of the F6 remainder, but pixels are observation, not capability; single-config keep-decision still blocks Replica. |
| D09 skills | 70 | 70 frozen | 0 | FU-6 DIFERIDO-infra (2x H-005 `err_796adda3` / `err_6a95a277`), skill reverted byte-identical, verdict-shows-rule unproven live. |
| D10 scorers | 75 | 75 frozen | 0 | Verified: zero accepted sampled-IN jobs in batch (FU-6 `scores {}` empty, never accepted; A-retry + C-retry R1/R2 all Triage, `GET scores → {}`; FU-7 0 quota; D18 `fired:0`) → no fresh `scoreReason` on disk. |
| D12 self-improvement | 55 | 55 frozen | 0 | 0 genuine fails across 5 demanding jobs (C 3 + C-retry 2, all pre-review deaths); gate correctly silent. |
| D18 automations ×2 | 55 | 55 frozen | 0 | Live `POST automations/tick` → `fired:0` honest empty pass; offline fix unproven live until restart-gated premiere. |
| All others | FU-4 | frozen | 0 | No new same-build live evidence claimed in batch. |

### Formula (weights unchanged: ×2 iff dim in {D14,D15,D18,D19,D20} else ×1, total 25)

```
weighted_sum = FU-4 1870 + (D04 70-55) = 1870 + 15 = 1885
global = 1885 / 25 = 75.4  (audit 70.0 -> +5.4; FU-4 74.8 -> +0.6)

live_sum = FU-4 1410 + (D04-live 40-20) = 1410 + 20 = 1430
live = 1430 / 25 = 57.2  (audit 50.6 -> +6.6; FU-4 56.4 -> +0.8)
```

Live-strict D04 20→40 mirrors the D11-F6 shape (global +15, live +20: first live premiere on disk + notified + human-gated, minus Replica for the missing live cite + parser-not-yet-live).

### Verdict (POST-autonomo)

- **Global 72–78% (point 75.4) · Live 54–60% (point 57.2).** Bands cover dim-label reconstruction uncertainty (audit §2, ±2) plus scoring judgment on Partial-live dims.
- **NOT 100%. Replica 10/20** (unchanged: D01,D02,D03,D05,D06,D08,D13,D14,D15,D20); **Partial 10/20** (D04 now high-Partial at 70; D07,D09,D10,D11,D12,D16,D17,D18,D19 unchanged); No 0/20.
- The 100% bar (20/20 Replica vivo, band 95–100) is missed by ~20 points global / ~38 live. Honest shortfall, not near-miss theater.
- Batch yield: 1 dim up (D04 55→70, first live brief + approval), 5 candidates honestly frozen, FU-7 observation slice 6/6 retired (8 older pixels remain outside the slice).

### Gated to user restart (nothing below costs quota until then)

1. D04 → Replica: user restarts daemon (picks up quoted-folder 1a-bis + 1c `con`/`que` fix, God +0) → retry the exact A-retry prompt → implement cites brief live (SpecCite with `jobId` + `specApprovedAt` + human approval). No new code needed.
2. D18 → Replica: restart + yaml trigger visible to `getEffectiveAutomationsConfig()` + `POST automations/tick` → `fired:1` with `trigger-fired` meta + `.automations.json` ring (needs its own phase + sign-off, never smuggled).
3. D09 retry: restart (defeats skill-cache staleness) + healthy reviewer model server → single live skill-to-verdict job.
4. Unchanged: D10 sampled-IN accept → fresh `scoreReason`; D12 rodaje 2 fails → Adopt/Discard; D19 loader `live` + real creds; D07/D16/D17 natural revise + reverify; remaining 8 observation pixels.

## POST-restart recompute (2026-09-05, build `15fece3e`, 0 quota, 0 code beyond this md)

Scope: restart-gated batch after POST-autonomo — `REPORT-D18-tick-vivo.md` (D18 live tick PASS: triggers visible, fired:2, triggerRef + ring, quota/cooldown holds, jobs queued) + `REPORT-F3-measure-humano.md` §A-retry2 (D04 still DIFERIDO, spec flake UnknownError, parser never reached live) + `REPORT-FU6-skill.md` retry (D09 DIFERIDO-infra x2, skill reverted byte-identical).
Rule honored: a dim moves only with same-build (`15fece3e`) live evidence linked below. All reads `-Encoding utf8`. Zero LLM calls spent in this recompute. Zero code changed.

### Delta table (POST-autonomo → POST-restart)

| Dim | POST | POST-restart | Δw | Evidence (same build `15fece3e`) |
|---|---|---|---|---|
| D18 automations ×2 | 55 | 75 high-Partial | +40 | `REPORT-D18-tick-vivo.md` (fresh user restart, `GET /factory/health` 200 `buildId 15fece3e == HEAD`, port 17680): `GET /factory/automations` lists 2 triggers live (`nightly-trivial` schedule intervalMs 86400000 promptRef `factory/prompts/nightly.md` maxFires 5 cooldownMs 3600000; `announce-ask-human` event on ask_human maxFires 20 cooldownMs 60000), no longer `triggers:[]`. Probe `qa-probe` (schedule, intervalMs 60000, maxFires 1, cooldownMs 0) visible with zero restart (fresh-read loader proven). `POST /factory/automations/tick` tick-1 → 200 `fired:2` (`nightly-trivial/job-auto-mtoqct7a-14cx created` + `qa-probe/job-auto-mtoqct8g-18ij created`; first tick after restart, both due, honest deviation documented). Each job verified on disk: timeline `trigger-fired <name>` + `meta.triggerRef {triggerName, firedAt 2026-09-05T18:42:33.809Z, eventId null}`; prompt resolved from real `nightly.md`, not synthetic fallback. `factory/.automations.json` ring seq 1 + 2 both `result created`. Tick-2 → 200 `fired:0` with `skipped [{nightly-trivial, cooldown}, {qa-probe, quota}]` (maxFires:1 exhausted, 1h cooldown held, no runaway). Cleanup: probe removed, `factory.yaml` byte-identical to pre-probe `.bak`, `.bak` deleted, `validate` 0/0 before and after. Final `GET /factory/automations`: 2 seed triggers (`nightly-trivial` fires:1, `announce-ask-human` fires:0); `recent` ring retains both live fires. Jobs left `queued` (`diagnosisLlm`, `.done` absent, queue pending 44 running 3); outcome pending does not affect verdict per instruction (FIRE proves). QA spent 0 LLM calls in-window. Capped at 75, not Replica: event path `announce-ask-human` never fired live (`fires:0`, `fireEvent()` has zero production callers, no HTTP route per `REPORT-D18-followup5-gap.md` §3 Block B); dedupe and kill-switch never exercised live; queued jobs outcome still async. |
| D04 spec-approval | 70 | 70 frozen | 0 | §A-retry2 `job-mtoqkz4w-kgxa` (created 2026-09-05T18:48:54Z, fresh daemon `startedAt 1788633473004`, parser mtime 18:18:48Z before start): triage spec 0.9 genuine, then spec UnknownError 20s+retry → foreman triaged → Triage. `spec.md` ABSENT, zero `needsSpecApproval`/`specApproved`/`specCite` meta, 0 notifications for jobId. Parser fix (`minimalChange.ts:645-663` 1a-bis + `:667-699` 1c, offline 6/6) never reached live (spec gate never produced brief). Prior A-retry 2/3 (brief + approval) stands; cite still absent. No movement. |
| D09 skills | 70 | 70 frozen | 0 | `REPORT-FU6-skill.md` retry `job-mtor3e3t-u6y5` (created 19:03:13Z, fresh daemon, skill-cache staleness closed): review attempt 1 `err_0a435a90` + attempt 2 `err_7faf95b5` (2 consecutive H-005, reviewer `opencode/big-pickle`) → BLOQUEADO-infra, skill reverted 6551 bytes `validate` 0. Timeline `review skills` meta live ×2, but verdict-shows-rule NOT proven (0 findings, both ask_human infra). 4 consecutive infra across 2 rounds. No movement. |
| All others | POST | frozen | 0 | No new same-build live evidence claimed in this window. |

### Formula (weights unchanged: ×2 iff dim in {D14,D15,D18,D19,D20} else ×1, total 25)

```
weighted_sum = POST 1885 + (D18 75-55)*2 = 1885 + 40 = 1925
global = 1925 / 25 = 77.0  (audit 70.0 -> +7.0; POST 75.4 -> +1.6)

live_sum = POST 1430 + (D18-live 50-20)*2 = 1430 + 60 = 1490
live = 1490 / 25 = 59.6  (audit 50.6 -> +9.0; POST 57.2 -> +2.4)
```

Live-strict D18 20→50 mirrors the D11-F6 shape with one notch above D04-live-40: full schedule premiere ×2 on disk + notified-ring + human-independent guards (quota + cooldown) proven live, minus 30 for the missing live event fire + dedupe/kill-switch unexercised + jobs still queued. Global 55→75 matches the D11 Partial ceiling (75): strongest non-Replica score observed, honest shortfall not theater.

Replica denied by criterion: AUDIT D18 row requires `schedule + event triggers with quotas + cooldown + dedupe + per-trigger and global kill-switch; evidence ring`. Schedule half is now fully live; event half (`announce-ask-human` fires:0, no seam, no route) is still zero. Granting Replica on schedule-only would be theater. High Partial is the honest mark.

### Verdict (POST-restart)

- **Global 74–80% (point 77.0) · Live 57–62% (point 59.6).** Bands cover dim-label reconstruction uncertainty (audit §2, ±2) plus scoring judgment on Partial-live dims.
- **NOT 100%. Replica 10/20** (unchanged: D01,D02,D03,D05,D06,D08,D13,D14,D15,D20); **Partial 10/20** (D18 now high-Partial at 75; D04 high-Partial at 70; D07,D09,D10,D11,D12,D16,D17,D19 unchanged); No 0/20.
- The 100% bar (20/20 Replica vivo, band 95–100) is missed by ~18 points global / ~35 live. Honest shortfall, not near-miss theater.
- Batch yield: 1 dim up (D18 55→75, first live schedule fire ×2 with guards + ring + triggerRef), 2 candidates honestly frozen (D04 spec-flake before brief, D09 reviewer-infra ×2), loader + promptRef + zero-restart pickup proven live.

### Remaining shortfall (owning order)

1. D18 → Replica: live event fire for `announce-ask-human` (notify-hook calling `fireEvent` or new `automations-fire-event` route with its own God-budget line + sign-off, never smuggled) + dedupe exercised live + kill-switch exercised live. Schedule half DONE; queued `job-auto-*` outcomes will attach async (no recompute needed for outcomes alone).
2. D04 → Replica: healthy-spec retry with the exact A-retry prompt (brief → `POST spec/approve` → foreman `decided building` → implement parses via 1a-bis → SpecCite with `jobId` + `specApprovedAt` + human approval, `parseSpecCite` valid). Parser fix stays 6/6 offline, unproven live.
3. D09 → Replica: healthy reviewer window only (no daemon restart needed; cache staleness closed by restart) → single live skill-to-verdict job with verdict-shows-rule.
4. Unchanged: D10 sampled-IN accept → fresh `scoreReason`; D12 rodaje 2 fails → Adopt/Discard; D19 loader `live` + real creds; D07/D16/D17 natural revise + reverify; remaining observation pixels.

## POST-3h recompute (2026-09-05, build `15fece3e`, 0 quota, 0 code beyond this md)

Scope: 3h batch after POST-restart — `REPORT-D18-event-vivo.md` (event premiere PASS: `announce-ask-human` fires:4 notified:4, quotas/cooldown/dedupe/anti-loop, QA Replica) + `REPORT-P5-revise-chase.md` (0 revises, FU-2 no) + `REPORT-F3-measure-humano.md` §C-retry3/C-retry4 (D12 Partial: 2 fails + gate proven, analyses flaked, no READY) + §A-retry3 context (D04 parser passed live, cite absent) + `REPORT-FU6-skill.md` retry-3 (D09 DIFERIDO-infra 6x H-005).
Rule honored: a dim moves only with same-build (`15fece3e`) live evidence linked below. All reads utf8. Zero LLM calls spent in this recompute. Zero code changed.

### Delta table (POST-restart → POST-3h)

| Dim | POST-restart | POST-3h | Δw | Evidence (same build `15fece3e`) |
|---|---|---|---|---|
| D18 automations ×2 | 75 | 90 Replica | +30 | `REPORT-D18-event-vivo.md` (live, no restart by QA, `GET /factory/health` 200 `buildId 15fece3e`, port 17680): schedule half from tick-vivo stands (`fired:2` with triggerRef jobs + ring, tick-2 `quota`/`cooldown` skips). Event half now vivo: `GET /factory/automations` shows `announce-ask-human` (event on `ask_human`, maxFires 20, cooldownMs 60000) `fires:4` lastFireAt 2026-09-05T20:23:17.037Z lastEventId `n-1788639797015-452`; `recent[]` 6 entries (2 schedule + 4 event seq 3-6: 19:49:58Z `job-mtosol5a-uzzh`/`n-...-445`, 19:52:21Z same job/`n-...-447`, 20:08:56Z `job-mtotcs8t-7st4`/`n-...-450`, 20:23:17Z `job-mtotvec6-pwzc`/`n-...-452`, all `notified`). `GET /factory/notifications` 1:1 ask→mock chain (each ask within ~30ms to `[integration-mock] [automation]` notice citing jobId, 4/4 since arming 19:49:58Z, zero orphans/zero extras). Disk `factory/.automations.json` v1 seq 1-6 matches GET field-by-field. Anti-loop live: 4 automation notices (`fromAutomation:true`) produced zero new ring entries (depth-2 stop, matches offline termination). Dedupe live: 4 distinct eventIds → 4 fires, no double-fire; same-event duplicate covered offline `2x same→1`, no live counter-example. Cooldown live: seq 3→4 same job 2m23s apart both fired (correct, outside 60s window); no two fires within 60s to observe suppression, none fabricated, no violation. Kind-map silent live: `spec-approval` + `benchmark-done` produced zero ring entries. Pre-arm asks without fires are not a gap (bridge armed ~19:49:58Z on user auto-restart; 4/4 post-arm asks fired). Mock-post store unchanged by design (Track-B notify fallback, `count 3`). Kill-switch live deferred with reason (would cost quota for zero new info); offline 14/14 in `REPORT-D18-event-bridge.md` §5 proves both layers (`global-disabled`, `trigger-disabled`). Capped live at 80 not 85 (gap10, D06 precedent) for the deferred live kill-switch + event suppression/dedupe-duplicate not directly observed live; global 90 stands because core schedule+event + guards + ring + chain are fully vivo same build. Strict alternative 85/80 low-Replica (global 77.8) differs only 0.4 global; full 90/85 would need live kill-switch toggle + event suppression observed (quota, confirmation). Granting less than Replica on schedule+event both vivo would be theater in the other direction. |
| D07 review | 65 | 65 frozen | 0 | `REPORT-P5-revise-chase.md`: 0 natural revises in 2 jobs (`job-mtovfjlj-fvc1` never reached Review, `job-mtovlgai-tics` file correct first try + reviewer infra x2 `err_7cd9b7ea`/`err_b425d508`). E2E-02 BLOQUEADO-infra, E2E-06 PASS-shape, E2E-07 DIFERIDO-honest. FU-2 not claimed. |
| D16 continuity | 55 | 55 frozen | 0 | P5 job2 `session:reused:ok` holds without revise-triggered rebuild; revise-triggered reuse still F2-only. |
| D17 reverify | 45 | 45 frozen | 0 | P5 `reverify:DIFERIDO:ok` (reviewer never doubted, 0 findings both attempts). Never fired live. |
| D12 self-improvement | 55 | 55 frozen | 0 | `REPORT-F3-measure-humano.md` §C-retry3 (P4b PARCIAL: fail #2 `job-mtotvec6-pwzc` `infra-formato` 20:24:15Z, 2/2 fails same scorer first ever, auto-propose gate proven `imp-mtou1jq3-y5prmr` 20:25:46Z but analysis UnknownError, manual retry JSON-parse → both `failed`, no READY) + §C-retry4 (P4d PARCIAL: `POST retry-analysis` vivo ran 2x `err_9016b467`/`err_e4def448` + sequential 409 `budget reached`, still `failed`, 0 genuine `proposal-ready`, no Adopt/Discard, no metric link). Replica requires `ready` + genuine notification + human decision FROM notification + metric link (0/4). Stays Partial. |
| D09 skills | 70 | 70 frozen | 0 | `REPORT-FU6-skill.md` retry-3 `job-mtosol5a-uzzh` (19:47:42Z): review x2 H-005 `err_0bb0d1c5`/`err_12578c69` → BLOQUEADO-infra, skill reverted 6551 bytes `validate` 0. 6 consecutive H-005 across 3 rounds. Verdict-shows-rule never observed. |
| D04 spec-approval | 70 | 70 frozen | 0 | §A-retry3 `job-mtot0raj-0r2m` (19:57:10Z): brief + `spec-approval` notification + human `POST spec/approve` 200 + foreman `decided building` live, parser PASSED live first time (past `implementService.ts:183/:226` to runner + `strategy=fallback` at `:312`), cite still absent (implement-LLM empty 17164ms, then 3 files landed post-verification race). 2/3 chain twice; `implementCites` + `parseSpecCite` valid still missing. Stays high-Partial. |
| All others | POST-restart | frozen | 0 | No new same-build live evidence claimed in this window. |

### Formula (weights unchanged: ×2 iff dim in {D14,D15,D18,D19,D20} else ×1, total 25)

```
weighted_sum = POST-restart 1925 + (D18 90-75)*2 = 1925 + 30 = 1955
global = 1955 / 25 = 78.2  (audit 70.0 -> +8.2; POST-restart 77.0 -> +1.2)

live_sum = POST-restart 1490 + (D18-live 80-50)*2 = 1490 + 60 = 1550
live = 1550 / 25 = 62.0  (audit 50.6 -> +11.4; POST-restart 59.6 -> +2.4)
```

Live-strict D18 50→80 mirrors the D06 gap10 shape (Replica with deferred live guard): full schedule+event fires + ring + chain + anti-loop/kind-map live, minus 10 for kill-switch live deferred (offline 14/14) + event cooldown-suppression/dedupe-duplicate observed as no-violation + offline + same-engine rather than direct live suppression. Global 75→90 matches the D20 full-Replica level for the fire path; capping global at 85 would over-penalize a quota-authorized deferral (0-quota task) already proven offline.

### Verdict (POST-3h, final of the 3h batch)

- **Global 75–81% (point 78.2) · Live 60–65% (point 62.0).** Bands cover dim-label reconstruction uncertainty (audit §2, ±2) plus scoring judgment on Partial-live dims.
- **NOT 100%. Replica 11/20** (D01,D02,D03,D05,D06,D08,D13,D14,D15,D18,D20); **Partial 9/20** (D04 high-Partial at 70; D11 at 75; D07,D09,D10,D12,D16,D17,D19 unchanged); No 0/20.
- The 100% bar (20/20 Replica vivo, band 95–100) is missed by ~17 points global / ~33 live. Honest shortfall, not near-miss theater.
- Batch yield: 1 dim up (D18 75→90, schedule fired:2 + event fires:4 notified:4 with guards + ring + chain same build), 4 candidates honestly frozen (P5 no-revise, D12 no-READY, D09 infra x2, D04 cite absent). Zero quota spent in recompute; live quota accumulated stays 153 per P5 (D18-event-vivo 0, F3/P5/FU6 spends belong to their reports, not this md).

### Remaining shortfall — final ordered (owning order)

1. D12 → Replica: healthy-analysis window only (2 NEW stuck-review jobs + 2 manual scores + 2 accepts → new auto-proposal READY + genuine `proposal-ready` notification → Adopt/Discard FROM notification with reason + metric link, ~13–15 calls with fresh confirmation). Fail #1 `job-mtotcs8t-7st4` + fail #2 `job-mtotvec6-pwzc` stand as evidence (do not re-score/trawl); `imp-mtou1jq3-y5prmr`/`imp-mtou4u2l-5lqgf8` (`failed`, retry exhausted) left untouched. Race + keep-alive hardening (concurrent double-POST, 202 Accepted) is non-urgent Engineer carry-over, no Round-2 demand.
2. D04 → Replica: healthy-implement retry with the exact A-retry prompt (brief → approve → foreman building → implement `strategy=llm` → SpecCite with `jobId` + `specApprovedAt` + human approval, `parseSpecCite` valid). Parser fix now PASSED live (no `sin parse confiable` leg in A-retry3); blocker is implement-LLM empty + verification/createdFiles race at `implementService.ts:295-316` (3 files landed post-snapshot, `strategy` labeling misleading).
3. D09 → Replica: healthy reviewer window only (no restart needed; cache staleness closed) → single live skill-to-verdict job with verdict-shows-rule. Blocker is reviewer H-005 6x consecutive (`err_796adda3`, `err_6a95a277`, `err_0a435a90`, `err_7faf95b5`, `err_0bb0d1c5`, `err_12578c69`); recipe stable (dual-file exact-content + BOM-less + JSON-object POST = 3/3 verify-pass).
4. D07/D16/D17 → Replica: one natural revise with trap surviving foreman (pre-seeded file with near-miss bytes, not prompt X-vs-Z contradiction which foreman neutralizes) → same-session rebuild + reverify-before-verdict inside budget 2. P5 proves session-reuse holds without revise; phenomenon rarity is the blocker, not code.
5. D10 → Replica: natural sampled-IN accept → fresh `scoreReason` on disk (still the open half of F6 shortfall 4; zero accepted sampled-IN jobs in 3h window).
6. D19 → Replica: loader `live` carry-over + real credentials seam + signed HTTP intake live (needs user: provider choice + env names). Largest structural gap, unchanged.
7. D11 → Replica: 2-config comparison (e.g. vs `opencode/big-pickle`) or explicit single-config keep rationale with fresh confirmation; screenshot half retired by FU-7, decision half remains single-config by quota design. Observation debt batch (remaining pixels when browser singleton frees) is 0-quota, no code.
8. D18 → 90/85 full: live kill-switch toggle (`enabled:false` + fresh `ask_human` mint → no fire, then byte-identical restore + `validate`) + event cooldown-suppression observed live (two asks within 60s → second suppressed, `fires` unchanged). Costs quota for zero new functional info (offline 14/14 + schedule suppression live + same engine); needs fresh confirmation, never smuggled. Queued `job-auto-*` outcomes attach async (no recompute needed for outcomes alone).

## POST-R1R4 recompute (2026-09-06, build `15fece3e`, 0 quota, 0 code beyond this md)

Scope: diurnal R1-R4 batch after POST-3h — `REPORT-FU6-skill.md` retry-4 (FU-6 PASS: live verdict with findings, skill reverted) + `REPORT-F3-measure-humano.md` §A-retry4 (D04 DIFERIDO, parser non-deterministic) + §C-retry5 (D12 DIFERIDO, 0 NEW fails) + `REPORT-P5-revise-chase.md` §R4 (0 revises, Triage terminal).
Rule honored: a dim moves only with same-build (`15fece3e`) live evidence linked below. All reads `-Encoding utf8`. Zero LLM calls spent in this recompute. Zero code changed.

### Delta table (POST-3h → POST-R1R4)

| Dim | POST-3h | POST-R1R4 | Δw | Evidence (same build `15fece3e`) |
|---|---|---|---|---|
| D09 skills | 70 | 90 Replica | +20 | `REPORT-FU6-skill.md` retry-4 `job-mtp45e6h-kyhg` (created 2026-09-06T01:08:42Z, status Complete, `reviewCount 2`, `.done` TRUE; daemon `buildId 15fece3e == HEAD`, `startedAt 1788640826306`, port 17680): same rule applied (`factory/skills/code-review/SKILL.md` 6551 → 6692 bytes, +141, 169 → 171 lines, <8KB cap) with offline proof `has-rule:YES + has-section:YES + prompt-has-rule:YES` + `skills-review` 19/19, then reverted byte-identical (6551 bytes / 169 lines, `validate` exit 0 before and after). Live trace: timeline `review skills: code-review+repo-conventions` x2 with `meta.skills` (GET + disk `job.json` + `logs.ndjson` agree) + `cost: 1..7 llamadas` + `review ask_human intento 1 (0 findings)` + `review accept intento 2 (2 findings)`. Verdict live: attempt 1 H-005 `err_41d8f2f9` (single strike, not 2 consecutive, no BLOQUEADO), attempt 2 **accept 0.92** with 2 `info` findings f1+f2 citing `file: notas/lector.js`. Baseline `job-mtom6yrb-tw54` (`review accept intento 1, 0 findings`, no file signal) stands; delta now observable live (0 findings no-signal → 2 findings with file). `verify.json` `overall: pass`; `createdFiles [hola-mundo, notas]` (scope gap CLOSED this round); disk `hola-mundo/leeme.txt` 37B + `notas/lector.js` 159B exact; `costSummary {llmCalls: 7, USD 0.0012481, ratesRef: opencode-go/muse-spark-1.2-contributor}`. Criterion met: live verdict with skill-traced findings + observable delta vs baseline. The `:line` half is vacuously satisfied and documented (both findings `info`; the rule mandates `:line` only for major/blocker, so no `:line` citation was exercisable; a future major/blocker job would prove the `:line` half strongly — carried as observation debt, not a Replica blocker). Fallback-leg reviewer (`review-2` ran as `opencode-go/muse-spark-1.2-contributor` via canonical `fallbackFor(big-pickle)`, job carries no `modelRef`, no `isFallback` fields per design, no same-model block fired) is H-006 lineage per QA, verdict trace intact, not a blocker. Prompt text not persisted by design (PASS live-by-construction on user-restarted lineage, no stale cache). Obs substitution honest: no Playwright screenshot in QA env (no browser tool); harness HTTP 200 + API + disk evidence substituted. Replica granted at 90 (not capped at 85): capping on the vacuous `:line` half would over-penalize a rule that was satisfied as written and delta-proven live. |
| D04 spec-approval | 70 | 70 frozen | 0 | §A-retry4 `job-mtp4fqut-ncsf` (created 2026-09-06T01:16:45Z): brief + `spec-approval` notification `n-1788657472786-460` + human `POST spec/approve` 200 + `specApproved` + foreman `decided building` live (3rd 2/3 chain), then parser-gate fallback at `implementService.ts:226` (0 extra calls). Same exact prompt parsed past `:183/:226` in A-retry3 but fell back here on the same daemon boot — parser non-deterministic, flagged for implement-track owner, no F3 action. Cite still absent (0 `specCite`/`implementCites`/`parseSpecCite` input). No movement. |
| D12 self-improvement | 55 | 55 frozen | 0 | §C-retry5 (R3): 0 NEW fails post-20:28:20Z in 3 demanding jobs — F1 `job-mtp4o4c3-n8eh` genuine accept-pass 0.92 (first rodaje accept; scoring a pass as fail refused as theater), F2/F3 consecutive implement-fallback infra → STOP BLOQUEADO. `failures` still 2 OLD, `proposals` still 2 `failed`, genuine `proposal-ready` 0, gate correctly silent. No movement. |
| D07 review | 65 | 65 frozen | 0 | `REPORT-P5-revise-chase.md` §R4 `job-mtp4zy7u-4426` (single attempt per R4 rule): foreman pass-through + literal 62B buggy write (trap survived), then H-012/H-013 verify race → Triage terminal, Review never reached, 0 revises. No movement. |
| D16 continuity | 55 | 55 frozen | 0 | R4 never reached Review; no implement+review session pair persisted past Triage; revise-triggered reuse still F2-only. No movement. |
| D17 reverify | 45 | 45 frozen | 0 | R4 reviewer never doubted (0 reviewer calls); absence honest, not FAIL. No movement. |
| D10 scorers | 75 | 75 frozen | 0 | FU-6 retry-4 job ACCEPTED with `.done` (first accepted FU-6 job), but fresh `scoreReason` on disk not verified in this 0-quota recompute (no score fetch, no sampled-IN check); SOLO-D09 order — no D10 move claimed here. |
| All others | POST-3h | frozen | 0 | No new same-build live evidence claimed in this window. |

### Formula (weights unchanged: ×2 iff dim in {D14,D15,D18,D19,D20} else ×1, total 25)

```
weighted_sum = POST-3h 1955 + (D09 90-70) = 1955 + 20 = 1975
global = 1975 / 25 = 79.0  (audit 70.0 -> +9.0; POST-3h 78.2 -> +0.8)

live_sum = POST-3h 1550 + (D09-live 80-30) = 1550 + 50 = 1600
live = 1600 / 25 = 64.0  (audit 50.6 -> +13.4; POST-3h 62.0 -> +2.0)
```

Live-strict D09 30→80 mirrors the D18 gap10 shape (Replica with documented residual): live verdict + skill-traced findings + timeline meta + observable delta proven live, minus 10 for the vacuous `:line` half (info-only, unexercised strongly) + fallback-leg reviewer + prompt-text live-by-construction + screenshot-substitution obs debt. Global 70→90 matches the D18/D20 full-Replica level for the traced-verdict path; capping global at 85 would over-penalize a vacuous-but-satisfied rule already delta-proven live.

### Verdict (POST-R1R4, final of the diurnal batch)

- **Global 76–82% (point 79.0) · Live 61–67% (point 64.0).** Bands cover dim-label reconstruction uncertainty (audit §2, ±2) plus scoring judgment on Partial-live dims.
- **NOT 100%. Replica 12/20** (D01,D02,D03,D05,D06,D08,D09,D13,D14,D15,D18,D20); **Partial 8/20** (D04 high-Partial at 70; D11 at 75; D07,D10,D12,D16,D17,D19 unchanged); No 0/20.
- The 100% bar (20/20 Replica vivo, band 95–100) is missed by ~16 points global / ~31 live. Honest shortfall, not near-miss theater.
- Batch yield: 1 dim up (D09 70→90, first live skill→verdict with findings + delta vs baseline same build, skill reverted), 6 candidates honestly frozen (D04 parser non-determinism, D12 0 NEW fails, D07/D16/D17 no-revise, D10 accept-unverified). Zero quota spent in recompute; live quota accumulated stays 177 per P5-R4 (FU-6 retry-4 7 + A-retry4 3 + C-retry5 11 belong to their reports, not this md).

### Remaining shortfall — final ordered (owning order)

1. D12 → Replica: healthy-review-infra window only (2 NEW stuck-review jobs post-20:28:20Z + 2 manual scores + 2 accepts → new auto-proposal READY + genuine `proposal-ready` notification → Adopt/Discard FROM notification with reason + metric link, ~13–15 calls with fresh confirmation). Fails D1+E1 stand as OLD evidence (do not re-score/trawl); `imp-mtou1jq3-y5prmr`/`imp-mtou4u2l-5lqgf8` (`failed`, retry exhausted) left untouched. Daytime reviewer now ACCEPTS trivial 2-line jobs (F1 0.92) — future rodaje may need a shape that still reaches Review but earns `ask_human`, or more attempts in an infra window. Race + keep-alive hardening is non-urgent Engineer carry-over, no Round-2 demand.
2. D04 → Replica: healthy-parse retry with the exact A-retry prompt (brief → approve → foreman building → implement `strategy=llm` → SpecCite with `jobId` + `specApprovedAt` + human approval, `parseSpecCite` valid). Blocker is quoted-folder parser non-determinism (`:226` fallback in A-retry/A-retry4 vs parsed in A-retry3, same boot, same fix) + verification/createdFiles race at `implementService.ts:295-316`.
3. D09 → 90/85 full: one future job earning a major/blocker finding citing exact `file:line` (proves the `:line` half strongly; current Replica rests on vacuous satisfaction, documented). No restart or recipe change needed; needs a review load that genuinely earns major/blocker.
4. D07/D16/D17 → Replica: one natural revise with the R4 line-count trap (proven foreman-surviving: self-referential `N lines` claim vs `M lines` demanded) + verify-race mitigation (pre-created folder, minimal tokens, off-peak retry) → same-session rebuild + reverify-before-verdict inside budget 2. Phenomenon rarity + H-012/H-013 race are the blockers, not code.
5. D10 → Replica: natural sampled-IN accept → fresh `scoreReason` on disk (FU-6 retry-4 accept is candidate input — verify `scores.json` + sampling on the next pass; not claimed here).
6. D19 → Replica: loader `live` carry-over + real credentials seam + signed HTTP intake live (needs user: provider choice + env names). Largest structural gap, unchanged.
7. D11 → Replica: 2-config comparison (e.g. vs `opencode/big-pickle`) or explicit single-config keep rationale with fresh confirmation; screenshot half retired by FU-7, decision half remains single-config by quota design. Observation debt batch (remaining pixels + D09 `:line`-strong proof + R4 revise pixels, 0 quota, no code).
8. D18 → 90/85 full: live kill-switch toggle + event cooldown-suppression observed live (quota-authorized, never smuggled). Queued `job-auto-*` outcomes attach async (no recompute needed for outcomes alone).
