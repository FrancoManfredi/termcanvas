# D18 — Notify→event bridge live seam (PASS, offline + premiere-ready)

- Date (UTC): 2026-09-05 · Engineer: Alex (software-engineer)
- God `headless-runtime/factory/factoryServer.ts`: **3583 lines (unchanged, freeze held, +0)**
- Route table: untouched (42 rows, 41 domains). `factory.yaml`: untouched. No daemon restart / taskkill / dev / build by engineering (user daemon auto-restarts and picks the code up on its next boot).
- Scope: D18 event path only — `announce-ask-human` (kind event, on ask_human → notify-integration) had zero productive `fireEvent()` callers (followup5-gap §3 Block B). This phase connects the emission. Schedule path untouched (already PASS vivo, fired:2).

## 1. Decision (§2 of the task: one seam, documented here)

**Generic observer registry in the notify domain + subscriber owned by the automations domain.**

- `headless-runtime/notify/notifications.ts` owns a capped created-listener registry (`NOTIFICATION_LISTENERS_MAX = 8`, fail-closed). It knows NOTHING about automations: zero new imports, zero cycles. Fan-out happens only on real creation (dedupe hits and nulls never emit), synchronously, best-effort, thrower-isolated.
- `headless-runtime/factory/automations/automationService.ts` owns `automationNotifyListener`, which maps a fresh human-born `ask_human`/`proposal-ready` notification to exactly one `fireEvent({id, kind, jobId})` with the notification id as the event id. The automations domain already imports notify, so this adds **zero new import edges** and no cycle.
- The bridge arms at module import (`ensureAutomationNotifyBridge()`, idempotent). The daemon loads this module at boot via `factoryServer.ts:164 → automations/automationRoutes → automationService`, so production needs **no wiring call: God +0, no new route, no timer**.

Rejected alternatives (why this one):
- Static `notify → automations` import: ugly coupling in the wrong direction (owner calling its observer) plus an ESM cycle automations↔notify. Rejected.
- Emission from factoryServer after ask_human routes: misses the real producers (`reviewService`, `improvementEngine`, `benchmarkEngine` call `notify()` directly, not through one route) and would cost God lines. Rejected.
- A manual `automations-fire-event` injection route: serves only manual pokes, costs God +1 for zero production value, and the bridge already covers every producer including future ones. Rejected (routeTable +0 by choice).

## 2. Files changed (3 edits + 1 new test + 2 docs)

| File | Change |
|---|---|
| `headless-runtime/notify/notifications.ts` | Additive only: `NotifyInput.fromAutomation?` (never persisted, never in GET envelope; `z.unknown` so garbage never nukes a notification), `NotificationEmitMeta` + `NotificationCreatedListener` + capped registry (`add/has/remove/count/clear`), sync fan-out on creation only, `resetNotificationsForTests` also frees listener slots |
| `headless-runtime/factory/automations/automationService.ts` | Bridge section: `isBridgedNotifyKind`, `automationNotifyListener`, `ensureAutomationNotifyBridge()` / `isAutomationNotifyBridgeArmed()` (+ disarm inside `resetAutomationServiceForTests`), auto-arm at import; `defaultNotifyTrigger` + `defaultPostIntegration` stamp `fromAutomation: true` |
| `tests/automations-notify-bridge.test.ts` | NEW: 14 offline tests (see §5) |
| `docs/LOOPS.md` | `## D18 — Notify→automations event bridge (+0-note)`: no new timer/loop/retry; fan-out is one `forEach` over ≤8; dedupe/quota/cooldown/kill-switches reuse inventoried caps |
| this report | Premiere instructions for QA (§6) |

## 3. Anti-loop (OBLIGATORY, two layers + engine reuse)

- Layer 1 (authoritative): both trigger-born notify defaults stamp `fromAutomation: true`; the listener returns before any work. Human-born notifications never carry it.
- Layer 2 (spoof-tolerant): `dedupeKey` starting `automation:` or title starting `[automation]` / `[integration-mock]` is skipped even with the flag missing (hand-built or legacy callers).
- Each trigger still enforces its own `enabled` / `maxFires` / `cooldown` inside `fireEvent` (engine reused, zero duplication). Termination is proven, not argued: the suite drives a posting trigger whose mock post re-enters real `notify()` and asserts exactly 1 post, 2 stored notifications, 1 ring entry, 1 seen id — the chain stops at depth 2 by construction.

## 4. Kill-switches and kind map

- `automations.enabled: false` → bridge forwards, `fireEvent` answers `global-disabled`, zero effects (tested).
- Per-trigger `enabled: false` → `trigger-disabled`, zero effects (tested).
- `notificationsEnabled: false` → `notify` returns null before fan-out (existing behavior, untouched).
- Kind map is 1:1 and closed: `ask_human → ask_human`, `proposal-ready → proposal-ready`. `spec-approval` / `benchmark-done` / `daemon-error` never reach the engine (tested: zero posts, zero seen ids, no invalid events). `job-complete` has NO notify producer today (`NotificationKind` is closed and has no such kind) — the engine already accepts it from direct callers, so the seam maps it 1:1 the day a producer appears. No theater claim about it.

## 5. Gates (explicit timeouts, ESM, utf8)

- NEW `npx tsx --test tests/automations-notify-bridge.test.ts` (≤120s) → **14/14** (arming idempotence, ask_human→1 post + jobId passthrough + ring evidence with `eventId = notification id`, proposal-ready 1:1, dedupe 2×same→1, quota maxFires:1, cooldown 1h, flag anti-loop, end-to-end termination, spoof title+namespace, global kill, trigger kill, non-event kinds silent, thrower isolation, registry cap 8 fail-closed).
- `tests/automations-service|trigger-engine|routes|yaml-reader` (≤120s) → **54/54** (12+14+18+10, unchanged).
- `tests/notifications.test.ts` (≤120s) → **21/21** (runs with the bridge auto-armed in-process via the factoryServer import chain — zero interference, strongest compatibility proof).
- Adjacent: definition-validate-automations + dispatch + route-table + import-sweeps → **65/65**; review-service + measure-improvement + factory-client-contract → **44/44**; guards (prompt-length + writejobjson) green.
- `npx tsc --noEmit -p tsconfig.json` (≤180s) → exit **0**.
- `node scripts/factory.mjs validate` (≤30s) → `0 errores, 0 warnings`, exit **0** (yaml untouched).
- `require\s*\(` over the two edited daemon files + new test → doc-comment mentions only, zero real calls (ESM clean).
- `tests/no-unbounded-loops.test.ts`: my files add ZERO uncovered matches (forEach/slice only, no new `setInterval|setTimeout|while(|for(|retry` tokens). The suite reports ONE red in `headless-runtime/implement/minimalChange.ts:638` (`// FU-3 A-retry …` comment) — a file I never touched, pre-existing in this tree, left alone under PLAN-100 §0.1 scope-freeze (fixing it here would itself be a scope violation; flagged for its owner, not smuggled into D18).
- God: 3583 → 3583 (+0). Route table +0 (no injection route, justified in §1). Quota spent by engineering: **0 LLM calls** (offline suites + tsc + validate only). No jobs created outside sandboxes.

## 6. QA live premiere (after a USER daemon restart — engineering never restarts)

Precondition: user restarts the daemon once so the import-armed bridge loads. Engineering verified the import chain statically (`factoryServer.ts:164 → automationRoutes → automationService → ensure at import`); no code change takes effect before that restart.

1. `GET /factory/health` (15s) → 200, record the new `buildId` (it moves: this phase adds a commit).
2. `GET /factory/automations` (15s) → seed `announce-ask-human` visible with `fires: 0` (event, on `ask_human`, action `notify-integration`, maxFires 20, cooldown 60s).
3. Mint ONE real `ask_human` (no fabrication — writing `.notifications.json` / `.automations.json` by hand proves nothing and is banned as theater). Cheapest honest producer: exhaust a small job's review budget — `revise` ≤ 2 rounds, at `count ≥ 2` the reviewer flips to `ask_human` (LOOPS B01; `decideReviewNext` covered in review-service tests). Concretely: create a trivial job, drive `POST …/review/retry` twice; the next review evaluation stays Review with `ask_human` and `reviewService` notifies `ask_human` with the decision summary. Expected LLM spend: ~2–4 review calls (far below the 50-call confirmation line; still disclose it in the verdict).
4. Assert the chain (all 15s reads):
   - `GET /factory/automations` → `announce-ask-human` `fires: 1`, `recent` holds one `notified` entry whose `eventId` equals the `ask_human` notification id;
   - `GET /factory/notifications` → one `proposal-ready` titled `[integration-mock] [automation] announce-ask-human — ask_human` (default Track-B fallback evidence) whose body cites the job id;
   - disk `factory/.automations.json` → matching ring entry (`triggerName announce-ask-human`, `result notified`).
5. Cooldown proof (no extra setup): a second real `ask_human` within 60s posts NOTHING new (skips leave no ring record by contract — assert `fires` still 1 and no new mock notification).
6. Optional kill-switch proof (zero restart needed — D18 fresh reader picks yaml up on the next event): set `announce-ask-human` `enabled: false`, `validate` (0/0), mint another `ask_human` → no post, no fire; restore the file byte-identical, `validate` again.
7. Cleanup: none required (all evidence is real daemon output; leave the fired job running or cancel per QA judgment).

## 7. Verdict and carry-over

- **D18 event path: code COMPLETE and offline-PASS (14/14 new + 54/54 + 21/21 + 65/65 + 44/44 neighbors, tsc 0, validate 0/0).** Live premiere is restart-gated (user action) with the exact script in §6.
- Carry-over for QA: run §6 after the user restart and append `REPORT-D18-event-vivo.md` with the three evidences (automations recent + notifications GET + `.automations.json` entry) plus the spent LLM count. If the premiere shows `fires: 0` after a real `ask_human`, the first suspect is stale daemon (pre-restart `buildId`), not the bridge — check `buildId` before anything else.
