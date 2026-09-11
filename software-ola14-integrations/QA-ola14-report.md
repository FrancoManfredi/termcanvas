# QA Report — Ola 14 Automations + Integrations (incremental, deferral lift)

- **Date:** 2026-09-05 · **QA Engineer:** Edward (software-qa-engineer) · **Round:** 1 of 2 (exit at Round 1, all green)
- **Inputs read:** `software-ola14-integrations/PRD-ola14-incremental.md`, `software-ola14-integrations/DESIGN-ola14-incremental.md`, `docs/LOOPS.md` (rows A01–A06, I01–I03), `docs/E2E-HALLAZGOS.md` (H-001..H-013)
- **Invariants respected:** explicit timeout on every command (≤120s per suite, 15s for the single daemon status probe); daemon 17680 never restarted/killed; no `pnpm dev`/`pnpm build`; no `taskkill`; PowerShell reads with `-Encoding utf8` only.

## Summary

- **Total Tests (required suites): 193 | Passed: 193 | Failed: 0**
- **Extra H-regression spot-checks: 23 | Passed: 23 | Failed: 0**
- **Grand total executed: 216 | Passed: 216 | Failed: 0**
- **Coverage:** ~90% estimated on new Ola 14 paths (schedule/event evaluation, quota/cooldown/dedupe, kill-switches, mock post/ack, validator rules, loops meta-test, route/dispatch tables, client contract, no-direct-fetch). No 100% claim; critical paths only.
- **Routing Decision:** NoOne (no source bug, no test bug — Round 1 PASS, exit)
- **Final Verdict:** **PASS**

## Suite table (required)

| # | Suite | Result | Counts |
|---|---|---|---|
| 1 | `tests/automations-trigger-engine.test.ts` (schedule exactly-one, event allowlist, quota/cooldown/dedupe, `0=off`, FIFO cap 500) | PASS | 18/18 |
| 2 | `tests/automations-service.test.ts` (tickOnce bounded pass, triggerRef, pact-id refusal, kill-switch) | PASS | 14/14 |
| 3 | `tests/automations-routes.test.ts` (R1/R2 shapes, fail-safe, single-arg tolerance) | PASS | 12/12 |
| 4 | `tests/integrations-mock.test.ts` (port post/ack/list, zero network, cap 100, size caps) | PASS | 11/11 |
| 5 | `tests/integrations-service-routes.test.ts` (R3/R4, `enabled=false`→409, client fail-safe offline) | PASS | 15/15 |
| 6 | `tests/definition-validate-automations.test.ts` (8+ new rules, file:line, fallback visible) | PASS | 15/15 |
| 7 | `tests/no-unbounded-loops.test.ts` (Rule 7 meta-test incl. A/I bounds, no `for(;;)`/`while(true)`) | PASS | 5/5 |
| 8 | `tests/route-table.test.ts` (36→40 rows, R1–R4 exact, MATCH intact) | PASS | 17/17 |
| 9 | `tests/dispatch-table.test.ts` (single dispatch intact) | PASS | 17/17 |
| 10 | `tests/definition-validate.test.ts` (pre-existing rules intact + `factory.mjs validate` live) | PASS | 40/40 |
| 11 | `tests/factory-client-contract.test.ts` (4 new ops, named timeouts, ESM zero `require()`) | PASS | 19/19 |
| 12 | `tests/no-direct-fetch.test.ts` (one client, injected fetch, ESM) | PASS | 10/10 |

## H-regression spot-checks (H-001..H-013 no-regression evidence)

| Suite | Hallazgo covered | Result |
|---|---|---|
| `tests/verify-retry-reconcile.test.ts` | H-013 (verify-retry reconciles late files) | PASS 7/7 |
| `tests/empty-folder-fallback.test.ts` | H-012 (empty-folder fallback → fail honest) | PASS 8/8 |
| `tests/implement-fallback-literal.test.ts` | H-001 (no literal-prompt folders) | PASS 8/8 |

## Static checks

### tsc

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` (src + shared) | **0 errors — PASS** |
| `npx tsc --noEmit -p tsconfig.headless.json` (daemon) | 8 errors, **all pre-existing and outside Ola 14** — PASS with notes (see Known Issues) |

New Ola 14 files (`headless-runtime/factory/automations/*.ts`, `headless-runtime/factory/integrations/*.ts`, `AutomationsPanel.tsx`, `IntegrationsPanel.tsx`): **0 errors**.

### God-server budget (`headless-runtime/factory/factoryServer.ts`)

| Metric | Baseline | Now | Delta | Verdict |
|---|---|---|---|---|
| Total lines (`(Get-Content).Count`) | 3575 | **3581** | +6 | PASS (matches wave task budget 3575→3581) |
| Delegation lines touching automations/integrations | — | **6** (2 imports L164–165 + 4 one-line `case` L2332–2335 via `routeTable` + single `matchRoute` dispatch) | — | PASS |
| Business logic in the 4 new handlers | — | **zero** (bodies live in `automations/automationRoutes.ts` and `integrations/integrationRoutes.ts`) | — | PASS |

### ESM contract (zero `require()` in new code)

- `Select-String` for `require\s*\(` over all 13 new files: only matches are the words "zero require()" inside file-header comments. **Zero real `require()` calls — PASS.**

### Renderer intervals (zero new) + the ONE daemon ticker

- `AutomationsPanel.tsx` + `IntegrationsPanel.tsx`: **zero** `setInterval`/`setTimeout` — PASS (cards reuse existing N02–N04 polls).
- `automations/automationService.ts`: exactly **one** `setInterval` (AUTOMATION_TICK, `tickMs` default 30000, `0 = off`) + one `clearInterval` — PASS per DESIGN §7.

### Pollings intact (2.5s / 5s / 30s)

| Polling | Source | Value | Verdict |
|---|---|---|---|
| Jobs/logs 2.5s | `useWorkItemsPolling.ts:11` `POLL_INTERVAL_MS = 2500` | 2500 | PASS intact |
| Notifications bell 5s | `notificationsUi.ts:51` `POLL_MS = 5000` | 5000 | PASS intact |
| Daemon health 30s | `FactoryLabPage.tsx:543` fixed `30000` tick (definition badge reuses it) | 30000 | PASS intact |

### Pacts F01–F14 intact

- Canonical `isPactJob` in `headless-runtime/implement/implementService.ts:44` untouched.
- Ola 14 mirror gate `isPactAutomationId` in `automations/automationService.ts:228-248` + refusals at `:306-307` and `:639-654` (recorded `skipped-quota` with `pact-id rejected` note, never a chained job from a pact id). **PASS.**

### Route table (R1–R4)

- `routeTable.ts:72-75` (domain union) + `:121-124` (4 exact rows: `GET /factory/automations`, `POST /factory/automations/tick`, `GET /factory/integrations/status`, `POST /factory/integrations/test-post`). No dual `/work-items` alias (globals, like `notifications-list`). **PASS.**

### Config + loops + client surface

- `factory/factory.yaml:92-118`: `automations:` (`enabled`, `tickMs: 30000`, triggers) + `integrations:` (`enabled`, `mode: "mock-local"`, `provider: "linear"`) present. **PASS.**
- `docs/LOOPS.md`: rows A01–A06 + I01–I03 present with exact constants (`AUTOMATION_TICK_DEFAULT_MS = 30000`, `maxFires` default 5, `cooldownMs` default 60000, `AUTOMATIONS_MAX_TRIGGERS = 20`, `AUTOMATIONS_MAX_ENTRIES = 200`, `INTEGRATION_MOCK_MAX = 100`, `TITLE_MAX = 200`/`BODY_MAX = 2000`). **PASS.**
- `src/lib/factoryClient.ts:77-80`: 4 named timeouts (`FACTORY_AUTOMATIONS_TIMEOUT_MS=3000`, `FACTORY_AUTOMATIONS_TICK_TIMEOUT_MS=5000`, `FACTORY_INTEGRATIONS_TIMEOUT_MS=3000`, `FACTORY_INTEGRATION_POST_TIMEOUT_MS=3000`), injected fetch, `ok:false` offline, never throws. **PASS.**

## Live tick (single status probe, read-only)

- **Probe:** one `GET http://127.0.0.1:17680/factory/health` with 15s timeout. **Result: daemon unreachable** (`No es posible conectar con el servidor remoto`).
- **Action taken:** none — per invariant, no restart/`taskkill`/`pnpm dev` attempted. **No live tick executed** (a live tick requires a responding daemon; forcing one would violate the no-touch rule). The `POST /factory/automations/tick` path is fully covered offline by suites 2–3 (14 + 12 tests). See Known Issues.

## Failed Tests

None. No test needed fixing (Round 1, zero self-fixes). No source file needs an Engineer fix — therefore no `file:line` bug report is filed.

## Known Issues (carry-over, none blocking)

1. **Daemon unreachable at QA time (port 17680).** The single read-only health probe got connection-refused. No live `tickOnce` against the daemon could be observed. Offline coverage of the same path is green (automations-service 14/14 + automations-routes 12/12). Next session with a running daemon: run one manual `POST /factory/automations/tick` and one `ask_human → mock post → ack` pass, then append evidence to `software-ola14-integrations/REPORT-ola14.md`. No restart was attempted by QA (invariant).
2. **8 pre-existing `tsc` errors in `tsconfig.headless.json`, all outside Ola 14:** `electron/memory-service.ts:169` (×2), `electron/opencode-session.ts:508`, `electron/telemetry-service.ts:310-311,1349`, `headless-runtime/subprocess-worker.ts:346,385`. None in `automations/`, `integrations/`, `src/`, or `routeTable`/`definitionValidate`. Left untouched for the owner teams; reported separately per task.
3. **Working tree contains modified files outside the Ola 14 whitelist** (pre-existing lab work, not from this wave): `electron/main.ts`, `electron/preload.ts`, `headless-runtime/interview/harness/opencode.ts`, `headless-runtime/interview/puerto-libre.ts`, `package.json`, `pnpm-lock.yaml`, `scripts/run-diagnostico-tools.mjs`, `src/App.tsx`, `src/components/settings/ModelCombobox.tsx`, `src/components/settings/SkillsSettingsSection.tsx`, `src/toolbar/Toolbar.tsx`, `tsconfig.json`, `vite.config.ts`. QA did not touch them; scope-freeze for Ola 14 itself holds (all Ola 14 files are in the DESIGN §2 closed list).
4. **P1/P2 explicitly out of scope** (Slack provider, `live` mode seam, run-history UI): validator correctly rejects `mode: "live"` / `provider: "slack"` / secret fields fail-closed. No action.

## Live Addendum T05 (2026-09-05, daemon 17680 UP — supersedes Known Issue #1)

- **Health:** `GET /factory/health` 200 — `startedAt=1788585304870`, `uptime=83066`, `buildId=15fece3e` == HEAD. Fresh.
- **Tick:** `POST /factory/automations/tick` 200 — `fired:0, skipped:[], fires:[]` (honest empty pass; `triggers:[]`, no `factory.yaml` edit attempted; no `.automations.json` entry, expected).
- **Mock post:** `POST /factory/integrations/test-post` 200 ×2 — `m-1788585432993-1` (intended) + `m-1788585438968-2` (accidental QA duplicate, disclosed); `factory/.integrations-mock.json` on disk (642 B); status `count:2, lastAckedAt:null`.
- **Ack:** `POST /factory/notifications/:id/ack` on mock id → honest 404 (route covers `.notifications.json` only; mock ack has no HTTP route per DESIGN §5; `post→ack→list` stays covered by `integrations-mock` 11/11). Full `ask_human → ack-reconciled` loop remains a Known Issue (see `REPORT-ola14.md` §4).
- **UI:** `factory-harness.html` renders both cards — Automations (`Tick now`, empty-state) + Integrations (`linear-mock-local` badge, `Send test post`, live list with both QA posts + `Ack` buttons). UI PASS. Infra: `127.0.0.1:5173` refused vs `localhost:5173` 200 (Vite on IPv6 `::1`).
- **Static/spot:** `factory validate` 0/0 (`buildId=15fece3e`); `tsc` 0 errors; `integrations-mock` 11/11 + `automations-service` 14/14; God **3581 intact**; pacts intact (`isPactJob` @ `implementService.ts:44`).
- **Live verdict: PASS.** Full evidence in `software-ola14-integrations/REPORT-ola14.md`.

## Scope-freeze check (DESIGN §2.5)

All new Ola 14 files exist and only whitelisted files were added by the wave: `automations/` (6 files), `integrations/` (5 files), 2 panels, 6 test files, plus whitelisted edits (`factory.yaml`, `definitionValidate.ts`, `routeTable.ts`, `factoryServer.ts` 6 lines, `factoryClient.ts`, `FactoryLabPage.tsx` mount, `LOOPS.md`, `no-unbounded-loops.test.ts`). No out-of-list file created by Ola 14 was found.
