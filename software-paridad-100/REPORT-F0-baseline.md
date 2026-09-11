# F0 Report — Baseline freeze

- Date (UTC): 2026-09-05 · Engineers: E1 (Kou, software-engineer) · QA: pending (F0-T2) · buildId: 15fece3e · HEAD: 15fece3e (full 15fece3ed22ff7a7ceeaf0d3dd15f6c7dfb6acf9)
- Preconditions: (1) repo state noted — working tree has pre-existing modifications/unrelated untracked files, no F0 code change made, read-only probes only — PASS with note · (2) HEAD hash noted (15fece3e) — PASS · (3) daemon state unknown-is-fine, probed read-only — PASS (daemon reachable)
- Steps executed:
  1. `git rev-parse --short HEAD` → `15fece3e`; `git rev-parse HEAD` → `15fece3ed22ff7a7ceeaf0d3dd15f6c7dfb6acf9`. `git status --short` shows pre-existing modified/untracked files unrelated to F0; F0 wrote zero code, only the two new files under `software-paridad-100/`.
  2. `(Get-Content -Encoding utf8 headless-runtime/factory/factoryServer.ts).Count` → `3581`. God check: expected 3581, measured 3581 — PASS, delta 0.
  3. `(Get-Content -Encoding utf8 headless-runtime/factory/routing/routeTable.ts).Count` → `285`. `Select-String -Path routeTable.ts -Pattern '^\s*\{ method:' | Measure` → `40` rows. Comment header also states 40 rows / 39 domains. R1–R4 automations/integrations rows present at lines 121–124 (`automations-list`, `automations-tick`, `integrations-status`, `integrations-test-post`) — PASS.
  4. `Get-ChildItem -LiteralPath "headless-runtime/factory" -Directory` → 14 names: `automations, definition, health, intake, integrations, jobs, loaders, measure, notifications, review, routing, startup, triageSpec, verify` — PASS.
  5. `Select-String -Path "src/lib/factoryClient.ts" -Pattern "^export async function" | Measure` → `36` ops (list verified line by line, from `getFactoryHealth` to `postFactoryIntegrationTestPost`) — PASS.
  6. `Select-String -Path "factory/factory.yaml" -Pattern "^[a-zA-Z][a-zA-Z0-9]*:"` → 15 raw top-level keys; 13 logical sections per plan convention (costTracking+costRates = one Costo section; notificationsEnabled+osNotifications = one Notificaciones section; 15 − 2 = 13). Keys: ports, timeouts, defaultModels, reviewerPairs, scorers, runners, costTracking, costRates, agentSessions, reviewerReverify, improveProposalCooldown, notificationsEnabled, osNotifications, automations, integrations — PASS.
  7. Live probes, GET only, 15 s timeout each (no restart/taskkill/pnpm dev/build — never touched):
     - `GET /factory/health` → 200. buildId `15fece3e` == HEAD short — PASS. factoryPort 17680, opencode healthy (127.0.0.1:24844), queue pending 29 / running 2.
     - `GET /factory/definition/status` → 200. `valid:true`, `issues:[]`, buildId `15fece3e` — PASS.
     - `GET /factory/automations` → 200. `enabled:true, tickMs:30000, triggers:[], recent:[]` — matches plan starting point (yaml defines 2 triggers, daemon reports empty active list) — PASS.
     - `GET /factory/integrations/status` → 200. `enabled:true, mode:mock-local, provider:linear, count:2, lastAckedAt:null`, 2 mock posts for `qa-live-t05-smoke` — matches plan starting point — PASS.
  8. `node scripts/factory.mjs validate` (≤30 s) → `[factory] definition válida: 0 errores, 0 warnings (buildId=15fece3e)`, exit 0 — PASS.
  9. `npx tsc --noEmit -p tsconfig.json` (≤180 s, covers `src`+`shared` only) → exit 0, zero errors — PASS. Separate headless project `npx tsc --noEmit -p tsconfig.headless.json` → exit 2 with 8 pre-existing errors outside factory scope: electron/memory-service.ts (2), electron/opencode-session.ts (1), electron/telemetry-service.ts (3), headless-runtime/subprocess-worker.ts (2). Zero errors inside `headless-runtime/factory`. Recorded as known-apart, not F0 scope.
- DONE criteria results: BASELINE-100.json written with all required keys {head, godTotal, routeRows, domains, yamlSections, clientOps, health, definition, automations, integrations, validateExit, tscErrors} — DONE. God == 3581 (±0) confirmed before any F1 work — DONE. No code changed (God delta +0, zero new intervals) — DONE. Daemon reachable so no BLOQUEADO-infra — DONE.
- Live evidence: daemon 127.0.0.1:17680 live at 2026-09-05T06:10:49Z (health ts). buildId 15fece3e == HEAD on all probes. No job ids created (read-only phase). Full probe bodies frozen in `software-paridad-100/BASELINE-100.json` (health/definition/automations/integrations). No screenshots (no UI step in F0).
- FAILs/rollbacks: none. Nothing to roll back (no code touched). No FAIL items.
- New LOOPS rows + meta-test: +0-note. F0 adds no loops, no intervals, no retries — `docs/LOOPS.md` and `tests/no-unbounded-loops.test.ts` untouched by design (§0.1 F0 budget +0/+0/+0).
- Quota spent: 0 LLM calls against the model server (all steps local file reads + daemon GETs + validate + tsc).
- Carry-over: (1) working tree was already dirty before F0 (modified electron/src/vite/tsconfig files + many untracked scaffolds) — F1 owner must confirm scope-freeze diff discipline per §0.1 before writing code; (2) daemon reports `automations.triggers:[]` while yaml defines 2 triggers — F1 live steps should re-confirm expected trigger loading semantics, no action in F0; (3) 8 headless tsc errors are pre-existing and out of scope — F1–F5 must keep `tsconfig.json` at 0 and not grow `tsconfig.headless.json` beyond 8 without an explicit migration note.
- QA verdict: PASS (F0-T2 independent cross-check 2026-09-05Z — all numbers match §Starting point, zero drift).
- QA cross-check (F0-T2, independent, read-only, explicit timeouts, -Encoding utf8, no restart/taskkill/pnpm dev|build, GETs 15s + validate 30s + tsc 180s):
  - HEAD `15fece3e` / full `15fece3ed22ff7a7ceeaf0d3dd15f6c7dfb6acf9` — PASS.
  - God `3581` (expected 3581, delta 0) — PASS.
  - routeTable `285` lines / `40` rows — PASS.
  - domains `14` (automations, definition, health, intake, integrations, jobs, loaders, measure, notifications, review, routing, startup, triageSpec, verify) — PASS.
  - clientOps `36` — PASS.
  - yaml `13` logical sections (15 raw keys − 2 merged) — PASS.
  - `GET /factory/health` 200, buildId `15fece3e` == HEAD — PASS.
  - `GET /factory/definition/status` 200, valid:true, buildId `15fece3e` — PASS.
  - `GET /factory/integrations/status` 200, ok:true — PASS.
  - `node scripts/factory.mjs validate` exit 0 — PASS.
  - `npx tsc --noEmit -p tsconfig.json` exit 0 — PASS.
  - `BASELINE-100.json` parses via `ConvertFrom-Json`; head/godTotal/routeRows/domainsCount/clientOps match §Starting point — PASS.
  - Routing decision: NoOne. F0 DONE, F1 may open on user order.
