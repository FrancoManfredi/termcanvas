# REPORT-FU7-observacion — Observation debt retry (0 quota)

Date (UTC): 2026-09-05T17:12:00Z (retry; prior attempt 2026-09-05T16:01:15Z kept below for traceability)
Follow-up: FU7 of PARITY-100-formula.md item 7 — Observation debt (0 quota, no code): 14 screenshots + badge/panel pixels when browser singleton frees + renderer 5173 up.
Build: `15fece3e` (unchanged, no rebuild per constraint)
Constraints honored: 0 LLM calls for evidence, one panel at a time, explicit timeouts (15s scroll / 30s screenshot / 0.5-0.8s settle), no restart/taskkill/dev/build, `-Encoding utf8` discipline.

## 1. Renderer check (retry)

- Probe: Playwright MCP `browser_navigate http://localhost:5173/factory-harness.html` + `browser_snapshot`.
- Result: `200 OK`, title `Factory Harness`, snapshot captured (302 Work Items table, heavy page ~336KB snapshot).
- Verdict: renderer UP. Pixel half unblocked.

## 2. Browser check (retry)

- Probe: Playwright MCP `browser_tabs list`
- Result: `0: (current) [](about:blank)` — singleton FREE (prior round was LOCKED with `Browser is already in use`).
- Verdict: browser FREE. Snapshot + screenshots permitted, one panel at a time.

Snapshot asserts (all via `browser_find` + `browser_evaluate`, no LLM):
- AutomationsPanel: `region "Automations"` with heading + `Tick now` + `Refresh` + `No triggers configured` note.
- IntegrationsPanel: `region "Integrations"` with status `linear-mock-local` + `Refresh`.
- BenchmarksPanel: `heading "Benchmarks (3 runs)"` + `sin ganador automatico` note.
- ScorersPanel: `heading "Scorers — job-mtom6yrb… (3 scorers)"` + filter group `todos (3) / implement (1) / review (1)` + reason strings (`stub Ola 1 - always building`, `Prompt claro y ejecutable`, Foreman Log `decision + reason + confidence`).
- CostBadge: `sin tarifa` cells (e.g. `4 llamadas · ~7,510 tokens · sin tarifa`) confirming costRates:{} honest rendering.
- NotificationsBell: `button[aria-label*="Notific"]` — initial snapshot `Notificaciones, 99 sin leer`; at capture time `aria-label="Notificaciones, sin pendientes"` (live polling changed state; both states recorded).

## 3. Captured this round (retry)

- Captured: 6/6 panels. 0 quota spent (0 LLM calls).
- Method: `scrollIntoView` via `browser_evaluate` + settle 500-800ms + screenshot via `run_code_unsafe` with explicit 15s/30s timeouts. Element screenshot used where stable (automations, integrations); viewport-centered screenshot used where live polling made element-unstable (benchmarks, scorers, cost, notify). Standard `browser_take_screenshot` (5s default) timed out on this heavy page, hence the explicit-timeout path.

| # | Panel | Snapshot assert | Screenshot path (created) | Bytes |
|---|---|---|---|---|
| 1 | AutomationsPanel | triggers table + Tick now | `software-paridad-100/fu7-automations.png` | 12869 |
| 2 | IntegrationsPanel | badge linear-mock-local + posts + Ack | `software-paridad-100/fu7-integrations.png` | 63705 |
| 3 | BenchmarksPanel | decision (3 runs, no auto winner) | `software-paridad-100/fu7-benchmarks.png` | 96784 |
| 4 | ScorersPanel | reason strings (3 scorers) | `software-paridad-100/fu7-scorers.png` | 116547 |
| 5 | CostBadge | sin tarifa (costRates:{} honest) | `software-paridad-100/fu7-cost.png` | 135086 |
| 6 | NotificationsBell | ring/ack state (99 unread -> sin pendientes) | `software-paridad-100/fu7-notify.png` | 85972 |

Remaining debt beyond these 6: 8 older pixels remain referenced in EVIDENCE-INDEX `BLOQUEADO-obs` (the FU7 6-slice is now complete; total formula item 7 was 14).

## 4. Still blocked / remaining

- FU7 6-slice: complete (6/6 on disk, verified non-zero sizes via `Get-ChildItem`).
- Remaining: 8 prior pixels referenced in EVIDENCE-INDEX `BLOQUEADO-obs` (outside FU7 slice, need separate window).
- No code change, no tariff, no trigger fire claimed. Dims frozen per PARITY-100-formula.md.

Prior round note (2026-09-05T16:01:15Z): renderer UP via GET, browser LOCKED (`Browser is already in use`), 0/6 captured. Superseded by this retry.

## Verdict

- FU7 slice COMPLETE at 2026-09-05T17:12:00Z. Captured 6/6. Quota spent: 0.
- Renderer UP, browser was FREE for the full 6-panel sequence.
