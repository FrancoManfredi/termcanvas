# REPORT-FU4 — Real costRates with Weekly Ritual (2026-09-05)

Follow-up 4. The user pasted the full https://opencode.ai/docs/go/ table and
asked how to keep it fresh when it changes every week.

Answer: weekly-manual, zero automation by design. No network fetch in the
daemon, no new intervals (Regla 8). Tariffs live versioned in
`factory/factory.yaml`; a human refreshes them in under 2 minutes; the badge
tooltip shows the tariff date so staleness is visible instead of silent.

## What changed

- `factory/factory.yaml`: 27 user-confirmed tariffs under `costRates` (exact
  live modelKeys `opencode-go/<model-id>`) + `ratesAsOf: "2026-09-05"` +
  `ratesSource: "https://opencode.ai/docs/go/"` + ritual comment block.
- `headless-runtime/factory/agentLoader.ts`: additive optional scalars
  `ratesAsOf` (YYYY-MM-DD) / `ratesSource` (http(s) URL) on `FactoryConfig`
  (absent = null, old yamls still parse). Malformed = parse error (fail-safe
  to code defaults, never an invented date).
- `headless-runtime/factory/definitionValidate.ts`: `yaml-cost-rates` rule
  now also covers malformed seals (existing rule id, no contract change),
  with honest file:line, on both the parse-ok and parse-fail paths.
- `src/features/factoryLab/components/CostBadge.tsx`: optional `ratesAsOf`
  prop, tooltip-only (`... · rates as of 2026-09-05`). Not wired to a data
  source yet (see carry-overs) — prop only, zero behavior change.
- `tests/cost-rates-live.test.ts`: FU-4 pins (spark math, grok base-tier,
  exact 27-key set, seal formats, malformed-seal shouting). Two F4-T1 tests
  that assumed `costRates:{}` were evolved to the tariff reality.
- `tests/runner-cost.test.ts`: additive-sections test evolved (27 rates +
  seals instead of `{}`).

## Tariff policy (no exceptions)

- ONLY the base branch per model: tier `≤` / off-peak / no Peak. Examples:
  Grok 2.00/6.00 (not Peak 4.00/12.00), Luna 0.20/1.20, Qwen Plus 0.40/1.60
  (3.7-plus) and 0.50/3.00 (3.6-plus), DeepSeek off-peak 0.66/1.98 and
  0.22/0.66.
- Cache columns IGNORED: the tracker estimates `floor(chars/4)` with no
  cache split — a cached tariff would invent precision we do not measure.
- "Uso" (subscription) column IGNORED: subscription credit is not marginal
  USD; mixing it in would invent data (Regla 1).
- Discrepancy, documented honestly: the brief said "28 models" but lists 27
  ids. The 27 confirmed entries shipped; NO 28th model or number was
  invented. If the 28th id surfaces, add it via the ritual (3rd step is just
  another keyed entry + test-list update in the same commit).

## Weekly ritual (<2min, manual)

1. Open https://opencode.ai/docs/go/ and compare each pair in `costRates`.
2. Update ONLY the numbers that changed (same keys, same shape — never
   rename keys; the key IS the live modelKey).
3. Bump `ratesAsOf:` to today's `YYYY-MM-DD`. If the source URL ever moves,
   update `ratesSource:` too.
4. Run `node scripts/factory.mjs validate` — exit 0 = green. A bad number
   or date shouts `yaml-cost-rates` with file:line; fix and re-run.

## What the user sees in the badge

- Nothing changes visually yet for existing jobs: with 27 rates,
  `resolveSingleCostRate()` stays honestly null (ambiguous by design), so
  rows keep showing `N llamadas · ~X tokens · sin tarifa` — now with the
  tariff date in the tooltip once wired.
- After wiring (carry-over below), rows with a confirmed model rate show
  `N llamadas · ~X tokens · ~USD Y (est.)`, tooltip:
  `basis=estimated-chars/4 ratesRef=opencode-go/<model> · in=A out=B · rates
  as of 2026-09-05`. Tracking off still shows `—`; zero calls still shows
  `sin datos todavía`; USD `0.00` is never shown as data.

## Live verification (no new jobs)

- `npx tsx --test tests/cost-rates-live.test.ts tests/measure-cost.test.ts
  tests/runner-cost.test.ts tests/definition-validate.test.ts` — all green.
- `npx tsc --noEmit` (and headless project) — 0 errors.
- `node scripts/factory.mjs validate` — exit 0, zero `yaml-cost-rates`.
- Live read: `lookupCostRate("opencode-go/muse-spark-1.2-contributor")`
  against the real yaml returns `{0.10, 0.20}` (covered by the spark pin);
  no job was created for this FU (per instructions, QA owns live jobs).

## Carry-overs (NOT done here, on purpose)

1. Per-job USD wiring: `incrementCost`/`refreshCostSummary` use
   `resolveSingleCostRate()` (null unless exactly 1 rate). Threading the
   job's model (`providerID/modelID` → modelKey) into `lookupCostRate` is a
   separate FU — it touches orchestration and needs a cheap live job to
   prove. Until then the table is versioned, validated, and queryable, but
   rows stay "sin tarifa" (honest, not broken).
2. `ratesAsOf` badge wiring: `WorkItemList` has no tariff-date data source;
   exposing one needs a route/table change (explicitly out of scope). The
   `CostBadge` prop is ready; wiring is one line once the source exists.
3. No staleness gate in the validator by design: a "stale after N days"
   rule would eventually turn CI red on its own. Staleness stays a human
   judgment aided by the visible date.

## FU-4c — live badge proof (2026-09-05, QA Edward)

Live minimum: 1 trivial E2E-01-style job, model default
`opencode-go/muse-spark-1.2-contributor` (never gemini).

- Job: `job-mtolopvi-2ffu` — Complete 16:33:14Z, `review accept intento 1
  (0 findings)`, `reviewCount 1`, worktree
  `C:\tmp\fu4c-hola-mundo-20260905-163000` (git + exit-0 test/build).
  File `hola-mundo/leeme.txt` 144B, exactly 2 lines. Zero literal
  folders. Job dir holds `job/result/verify/review/triage.json`,
  `prompt.md`, `logs`, `.done`.
- Job modelRef: `opencode-go/muse-spark-1.2-contributor` (rated
  0.10/0.20). Reviewer: `opencode/big-pickle` (disjoint by design —
  NOT in the 27 `opencode-go/*` tariffs).
- Timeline (GET, 15s): `cost: 1 llamadas ~1050 tokens ~USD 0.0001`,
  `cost: 2 llamadas ~2591 tokens ~USD 0.0003`, `cost: 3 llamadas
  ~3565 tokens ~USD 0.0004` (all `est., estimated-chars/4,
  opencode-go/muse-spark-1.2-contributor`) — then `cost: 4 llamadas
  ~7510 tokens sin tarifa (estimated-chars/4)` after the review call.
- Final `costSummary` (GET == disk `job.json`, identical): `{llmCalls:
  4, estimatedInputTokens: 7264, estimatedOutputTokens: 246,
  estimatedUSD: null, basis: "estimated-chars/4", ratesRef: null}`.
  ASSERT FAIL: expected `estimatedUSD` number + `ratesRef
  opencode-go/*`, got null/null.
- Old/model-less jobs stay honest: `job-mtohz20a-4twc` (Complete, 4
  calls) still `{estimatedUSD: null, ratesRef: null,
  basis: "estimated-chars/4"}` — PASS, untouched.
- Zero-invention: exact-boundary `USD 0.00(?!\d)` = 0 hits, `~USD
  0.0000` = 0 hits. (Naive substring `USD 0.00` = 6 hits, all prefixes
  of the honest 4-decimal `0.0001/0.0003/0.0004` values — grep artifact,
  not data.)
- Playwright: BLOQUEADO-obs (browser-singleton lock, `Browser is
  already in use`, 13th consecutive session-wide; 1 probe, no retry
  loop, 0 quota). Badge pixels replaced by server-composed timeline
  cost strings (exact data the badge renders) + GETs + disk.
- Suites: `cost-per-job-model` 11/11 + `cost-rates-live` /
  `measure-cost` / `runner-cost` / `definition-validate` 91/91 +
  guards `no-unbounded-loops` / `route-table` 23/23. `tsc --noEmit`
  exit 0. `validate` exit 0. Infra strikes: 0 (no fallback, no
  ask_human).
- Quota: 4 LLM calls this job. Cumulative 69 + 4 = 73.

### Root cause (source bug — Send To: Engineer Alex)

`refreshCostSummary` recomputes the WHOLE-job USD from accumulated
counters with the LAST caller's rate. The review step threads the
disjoint reviewer model (`reviewAgent.ts:627` passes reviewer
`opencode/big-pickle`, unrated) so the 4th persist overwrites the
rated 3-call summary (`USD 0.00037`, spark ref) with null/null.
Every standard job (implement spark → reviewer big-pickle) will end
`sin tarifa`: the badge can never hold `~USD Y (est.)` at Complete.

- Failing assert: final `GET /factory/jobs/job-mtolopvi-2ffu`
  `costSummary.estimatedUSD` expected number, got null
  (`headless-runtime/workItem/workItemStore.ts`
  `persistCostSummary`/`refreshCostSummary` + caller
  `headless-runtime/review/reviewAgent.ts:627`).
- Suggested direction (Engineer owns the fix): accumulate USD
  per-call with each call's own rate (sum, mixed-ref honest), or pin
  the final summary to the job's `modelRef` rate instead of the last
  caller's; at minimum an unrated trailing call must not null out
  previously rated USD. Alternative honest path: tariff
  `opencode/big-pickle` via the weekly ritual — but that papers over
  the overwrite bug for the next unrated model.
- Offline gap: all 11/11 + 91/91 suites use single-model jobs, so no
  suite covers implement-rated → reviewer-unrated in one job. A
  regression test with two models in sequence (rated then unrated,
  assert USD survives) would pin the fix.

### Verdict FU-4: FAIL (superseded by FU-4e below)

Mid-run USD proven live (3 rated cost events with spark ref), but the
Complete badge regresses to `sin tarifa`. FU-4b wiring is NOT
end-to-end: routing to Engineer for the multi-model overwrite fix,
then QA re-runs 1 trivial job (Round 2, ~4-6 calls) to confirm the
final `~USD Y (est.)` + CostBadge snapshot.

## FU-4e — Round 2 re-verification of the FU-4d fix (2026-09-05, QA Edward)

Live minimum: 1 trivial E2E-01-style job, default model
`opencode-go/muse-spark-1.2-contributor` (never gemini), no explicit
modelRef. Engineer fix under test: per-call USD accumulation via
`mergeCostWithPrevious` (`headless-runtime/workItem/workItemStore.ts`).

- Pre-gates (explicit timeouts, `-Encoding utf8`, never
  restart/taskkill/dev/build): `validate` exit 0 ·
  `tsc --noEmit -p tsconfig.json` exit 0 · suites 104/104
  (`cost-per-job-model` 13/13 incl. 2 new FU-4d regression tests +
  `cost-rates-live` / `measure-cost` / `runner-cost` /
  `definition-validate` 91/91) · guards 23/23 (`no-unbounded-loops`
  5/5 + `route-table` 18/18). Daemon `buildId 15fece3e == HEAD`,
  started 16:41:21Z AFTER the fix mtime 16:39:46Z, so the live code
  includes the fix (no restart by QA).
- Job: `job-mtom6yrb-tw54` — Complete 16:50:29Z, `review accept
  intento 1 (0 findings)`, `reviewCount 1`, worktree
  `C:\tmp\fu4e-hola-mundo-20260905-164500` (git + exit-0 test/build).
  File `hola-mundo/leeme.txt` 39B, bytes `HOLA-FU4E linea uno\n
  HOLA-FU4E linea dos` (exactly 2 lines, no trailing newline). Zero
  literal folders. `createdFiles [hola-mundo/leeme.txt, hola-mundo]`
  in `result.json` == `verify.json` == `job.json`. `verify.json`
  `overall: pass`. `.done` exists. `agentSessions` holds exactly 1
  session per role (triage/foreman/implement/review).
- Path (F5 precedent, production routes only, documented): implement
  fallback 0 files → H-012 honest fail → Triage; late-write
  `leeme.txt` on disk (H-013); operator `POST
  .../review/verify-retry` `{}` → `{ok:true}` (0 LLM) → `verify-retry
  pass → Review` + late-file reconcile → Review → accept.
- Timeline cost events (GET, 15s) — ALL 5 with `~USD`, ZERO
  `sin tarifa`:
  `cost: 1 llamadas ~1094 tokens ~USD 0.0001`,
  `cost: 2 llamadas ~2687 tokens ~USD 0.0003`,
  `cost: 3 llamadas ~3691 tokens ~USD 0.0004` (all spark ref),
  then `cost: 4 llamadas ~7567 tokens ~USD 0.0004` and
  `cost: 5 llamadas ~11505 tokens ~USD 0.0008` (both spark ref).
  ASSERT PASS: no Complete-time `sin tarifa` regression.
- The FU-4c scenario reproduced live and defeated: primary reviewer
  resolved to disjoint `opencode/big-pickle` (unrated) per the pair
  table; its ladder attempt failed (H-005 flaky, infra strike 1,
  recovered in-ladder); fallback `fallbackFor(big-pickle)` → spark
  accepted. `review.json` records the effective model spark
  (`reviewAgent.ts:700`). Proof by arithmetic on persisted metas:
  call-4 persisted USD stayed EXACTLY `0.00038360000000000005`
  despite +3869/+7 new tokens (a spark rating would have added
  `0.0003883`) — the preserve path held, no null-out; call-5
  `0.0003836 + spark-delta(3870, 68)=0.0004006 =
  0.0007842000000000001` exact — accumulation. Old code would have
  re-rated the whole total at the last rate (`0.0011725`) — differs,
  so the new semantics are live, not just tested offline.
- Final `costSummary` (GET == disk, field-by-field equal):
  `{llmCalls: 5, estimatedInputTokens: 11285,
  estimatedOutputTokens: 220, estimatedUSD: 0.0007842000000000001,
  basis: "estimated-chars/4", ratesRef:
  "opencode-go/muse-spark-1.2-contributor"}`. ASSERT PASS: USD is a
  number, ratesRef is the spark tariff (was null/null in FU-4c).
- Old/model-less jobs stay honest and untouched: `job-mtohz20a-4twc`
  (Complete, 4 calls) still `{estimatedUSD: null, ratesRef: null,
  basis: "estimated-chars/4"}` — PASS, no retroactive re-rating.
- Zero-invention: exact-boundary `USD 0.00(?!\d)` = 0 hits over the
  job `*.json`; `sin tarifa` = 0 hits in `job.json`.
- Playwright: BLOQUEADO-obs (browser-singleton lock, `Browser is
  already in use`, 14th consecutive session-wide; 1 probe, no retry
  loop, 0 quota). Badge pixels replaced by server-composed timeline
  cost strings (exact data the badge renders) + GETs + disk.
- Infra strikes: 1 (review primary flaky, recovered via built-in
  ladder fallback, 0 extra operator calls). Never 2 consecutive → no
  stop. No fallback loops, no ask_human.
- Quota: 5 LLM calls this job. Cumulative 73 + 5 = 78.

### Verdict FU-4: PASS (final)

The Complete badge now holds `~USD 0.0008 (est.)` with the spark
tariff ref: mid-run AND final USD proven live, `GET == disk`, legacy
null/null preserved, zero `0.00`-as-data, suites 104/104 + guards
23/23 + tsc 0 + validate 0. Routing decision: NoOne. Round 2 of 2 —
closed, no further rounds.
