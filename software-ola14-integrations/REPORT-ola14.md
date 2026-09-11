# Ola 14 Report — Automations + Integrations (live evidence, T05)

- **Date (UTC):** 2026-09-05 · **QA Engineer:** Edward (software-qa-engineer)
- **Scope:** live verification T05 only. Offline suites remain 216/216 PASS per `QA-ola14-report.md`.
- **Invariants respected:** explicit timeout on every probe (15s HTTP, <=30s validate, <=120s suites); daemon 17680 never restarted/killed; no `pnpm dev`/`pnpm build`; no `taskkill`; PowerShell reads with `-Encoding utf8` only.

## 1. Daemon health (LIVE PASS)

- **Probe:** `GET http://127.0.0.1:17680/factory/health` (timeout 15s) → **200 OK**.
- **Payload (2026-09-05T05:16:27Z):**

| Field | Value |
|---|---|
| `startedAt` | `1788585304870` (≈ 2026-09-04, ~23h before probe) |
| `uptime` | `83066` (consistent with `startedAt`, daemon up ~23h) |
| `buildId` | `15fece3e` — **equals HEAD commit** (`15fece3e chore: merge remove-hydra into main`). Fresh. |
| `factoryPort` | `17680` |
| `queue` | `pending: 29, running: 2` (live lab traffic, unrelated to Ola 14) |
| `opencodeStatus` | `not_started` (opencode bridge down; does not affect Ola 14 paths) |

## 2. Automations tick (LIVE PASS, honest empty pass)

- **Probe:** `POST /factory/automations/tick` with `{}` (timeout 15s) → **200 OK**:
  `{"ok":true,"data":{"ok":true,"at":"2026-09-05T05:16:37.087Z","fired":0,"skipped":[],"fires":[]}}`
- **State:** `GET /factory/automations` → `{"enabled":true,"tickMs":30000,"triggers":[],"recent":[]}`.
- **Verdict:** honest empty pass — zero triggers configured, so no job and no `triggerRef` is the correct outcome (forcing a job would require editing `factory/factory.yaml`, out of QA scope). No `skipped-quota/cooldown` entry applies with an empty trigger set.
- **Disk:** `factory/.automations.json` does **not** exist — expected, the store appends only on fires/skips. No entry to record.

## 3. Integrations mock post (LIVE PASS)

- **Probe:** `POST /factory/integrations/test-post` `{title, body, jobId:"qa-live-t05-smoke"}` (timeout 15s) → **200 OK** twice:
  - `m-1788585432993-1` at `2026-09-05T05:17:12.993Z` (first, intended post)
  - `m-1788585438968-2` at `2026-09-05T05:17:18.968Z` (accidental duplicate: QA re-POSTed while re-reading a truncated response; harmless mock data, left as-is and disclosed)
- **Status:** `GET /factory/integrations/status` → `enabled:true, mode:"mock-local", provider:"linear", count:2, lastPostAt set, lastAckedAt:null, configError:null`, both posts listed newest-first with `acked:false`.
- **Disk:** `factory/.integrations-mock.json` (642 bytes, written 05:17 UTC) — mock post persisted on disk, zero network.

## 4. Ack (honest gap, NOT a source bug)

- **Probe:** `POST /factory/notifications/m-1788585432993-1/ack` → **404 `{error:"notification not found"}` (honest)**.
- **Root cause (verified in code):** the canonical ack route only covers the `.notifications.json` store (`ackNotificationById` in `notifications/notificationRoutes.ts:184` never calls the integrations reconciler). `ackIntegrationNotification` (mock ack) is exported from `integrations/index.ts:22` but wired to **no HTTP route** — reachable only from unit tests. This matches DESIGN section 5 ("zero new routes for ack"), so the 404 is expected behavior, not a regression.
- **Coverage standing in:** `tests/integrations-mock.test.ts` 11/11 covers `post→ack→list` with zero network (re-run live, see section 6).
- **Known Issue:** the full T05 loop `ask_human → mock post → ack reconciled → timeline integration-acked` is not exercisable live without a real job firing `ask_human`, and the reconcile half has no HTTP seam. Recommend a follow-up decision (wire best-effort reconcile into the notifications-ack path, or defer to P1). No existing notification was acked by QA (untouched чужое state).

## 5. UI — FactoryLabPage via factory harness (UI PASS)

- **URL:** `http://localhost:5173/factory-harness.html` (title "Factory Harness", page renders; definition badge shows `daemon 15fece3e` + `definition válida`, verified 05:18 UTC).
- **Infra note:** `http://127.0.0.1:5173/` → connection-refused, while `http://localhost:5173/` → 200. Vite dev binds IPv6 (`::1`) only. Main app `/` crashes pre-existing (`XyFlowCanvas.tsx:1165` reading `github`) — unrelated to Ola 14, left untouched.
- **Snapshot asserts (all present):**
  - `region "Automations"`: status kill-switch from `factory.yaml`, `Refresh` + `Tick now` buttons, empty-state `No triggers configured (edit factory.yaml to add some).` — consistent with daemon `triggers:[]`.
  - `region "Integrations"`: badge `linear-mock-local` (amber mock-local per PRD), `Refresh` button, `Title`/`Body` inputs + `Send test post` button.
  - **Live list renders both QA mock posts** (`QA live T05 smoke`, timestamps `05:17:12Z`/`05:17:18Z`, `job qa-live-t05-smoke` links) each with an `Ack` button — proves UI→daemon polling wiring live.
- No screenshot taken (snapshot evidence sufficient).

## 6. Static + spot checks (ALL PASS)

| Check | Result |
|---|---|
| `node scripts/factory.mjs validate` (<=30s) | `definition válida: 0 errores, 0 warnings`, `buildId=15fece3e` — PASS |
| `npx tsc --noEmit -p tsconfig.json` | **0 errors** — PASS |
| `tests/integrations-mock.test.ts` (spot) | **11/11 PASS** |
| `tests/automations-service.test.ts` (spot) | **14/14 PASS** |
| God-server budget `factoryServer.ts` | **3581 lines, intact** (no diff vs QA baseline) |
| Pacts F01–F14 | canonical `isPactJob` gate at `implement/implementService.ts:44` untouched — PASS |
| Route table R1–R4 | unchanged (no new ack route, per scope-freeze) — PASS |

## 7. Live verdict

- **Health:** PASS · **Tick:** PASS (honest empty) · **Mock post:** PASS (disk + status + UI) · **Ack:** honest 404, unit-covered, documented gap · **UI:** PASS · **Static/spot:** PASS
- **Overall live verdict: PASS** (T05 evidence complete except the ask_human→ack-reconciled loop, recorded as Known Issue above).
