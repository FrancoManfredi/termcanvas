# D18 — Event bridge live premiere (PASS): announce-ask-human fires on real infra ask_human

- Date (UTC): 2026-09-05 · QA: Yan (software-qa-engineer)
- Daemon: live, no restart / taskkill / dev / build by QA. Playwright not needed (API + disk evidence suffices; browser was not required for this seam).
- All reads: 15s timeouts, utf8. One action at a time. Zero writes to daemon state (GETs + disk reads only).

## 1. Health: live on D18 build

`GET /factory/health` 200:

- `buildId 15fece3e` (D18 event-bridge code), `factoryPort 17680`
- `startedAt 1788640826306` (~2026-09-05T20:40:26Z; uptime ~18.8 min at read 20:59:17Z)
- `queue pending 50, running 5`; `opencode healthy` (port 39696)

Stale-daemon suspect excluded: buildId matches the D18 HEAD.

## 2. Automations: bridge ARMED, 4 live event fires (recent non-empty, no job mint needed)

`GET /factory/automations` 200 — `enabled true`, 2 seed triggers:

| Trigger | Kind | Config | State |
|---|---|---|---|
| `nightly-trivial` | schedule | intervalMs 86400000, maxFires 5, cooldownMs 3600000 | `fires 1`, lastFireAt 2026-09-05T18:42:33.809Z |
| `announce-ask-human` | event, on `ask_human`, action `notify-integration` | enabled true, maxFires 20, cooldownMs 60000 | **`fires 4`**, lastFireAt 2026-09-05T20:23:17.037Z, lastEventId `n-1788639797015-452` |

`recent[]` (6 entries: 2 schedule from tick-vivo + 4 event). The 4 event fires are direct evidence — no synthetic job was minted (§6 step 2 skipped honestly: recent was NOT empty):

| seq | triggerName | kind | at (UTC) | action | jobId | eventId (= ask_human notification id) | result |
|---|---|---|---|---|---|---|---|
| 3 | announce-ask-human | event | 2026-09-05T19:49:58.447Z | notify-integration | job-mtosol5a-uzzh | n-1788637798423-445 | notified |
| 4 | announce-ask-human | event | 2026-09-05T19:52:21.387Z | notify-integration | job-mtosol5a-uzzh | n-1788637941347-447 | notified |
| 5 | announce-ask-human | event | 2026-09-05T20:08:56.255Z | notify-integration | job-mtotcs8t-7st4 | n-1788638936251-450 | notified |
| 6 | announce-ask-human | event | 2026-09-05T20:23:17.037Z | notify-integration | job-mtotvec6-pwzc | n-1788639797015-452 | notified |

Honest hypothesis confirmed: the overnight infra `ask_human` flake (H-005, review-prompt `UnknownError … err_*`) ARE real `ask_human` notification events, and the bridge fired on each one by itself.

## 3. Notification chain: each ask_human → exactly one Track-B mock notice

`GET /factory/notifications?limit=50` — every fired eventId pairs 1:1 with a `[integration-mock] [automation]` fallback notice citing the job id:

| ask_human id (jobId) | ask body (truncated) | mock notice id | mock title | mock body cites |
|---|---|---|---|---|
| n-1788637798423-445 (job-mtosol5a-uzzh) | review prompt fallo (20000ms+retry): UnknownError err_0bb0d1c5 | n-1788637798456-446 | [integration-mock] [automation] announce-ask-human — ask_human | event n-…-445 for job job-mtosol5a-uzzh |
| n-1788637941347-447 (job-mtosol5a-uzzh) | review prompt fallo: UnknownError err_12578c69 | n-1788637941407-448 | same pattern | event n-…-447 for job job-mtosol5a-uzzh |
| n-1788638936251-450 (job-mtotcs8t-7st4) | review prompt fallo: UnknownError err_bbf55985 | n-1788638936258-451 | same pattern | event n-…-450 for job job-mtotcs8t-7st4 |
| n-1788639797015-452 (job-mtotvec6-pwzc) | review prompt fallo: UnknownError err_25fa50d8 | n-1788639797042-453 | same pattern | event n-…-452 for job job-mtotvec6-pwzc |

Each pair lands within ~30 ms (ask `…:015Z` → notice `…:042Z` on seq 6). 4 human ask_human → 4 notices, zero orphans, zero extras.

## 4. Disk ring matches live exactly

`factory/.automations.json` (v1, 6 entries seq 1–6): seq 1–2 schedule `created` (tick-vivo), seq 3–6 `triggerName announce-ask-human, kind event, action notify-integration, result notified` with the same at/jobId/eventId as §2. Byte-level field match with `GET /factory/automations recent[]`.

## 5. Mock-post file: unchanged by design (Track-B), not a gap

`factory/.integrations-mock.json` still holds only the 3 old `qa-live-t05-smoke` posts (m-…-1/2/3, last 2026-09-05T06:52:14Z); `GET /factory/integrations/status` confirms `count 3` on `mock-local/linear`. This is EXPECTED, not missing evidence: `defaultPostIntegration` (`automationService.ts:694-713`) is a notify-based fallback that records evidence in the notification center (the §3 notices) and never touches the mock-post store. `GET /factory/integrations` 404 is also expected (no such route; table carries only `integrations-status/test-post/webhook-in/post-back`).

## 6. Anti-loop + dedup + cooldown hold live

- Anti-loop: the 4 automation-born notices (`fromAutomation: true` per code) produced ZERO additional ring entries — chain stops at depth 2 live, matching the offline termination test.
- Dedup: 4 distinct eventIds → 4 fires; no eventId fires twice. Same-event re-fire never duplicates (offline `2×same→1` suite covers the unit; live shows no counter-example).
- Cooldown (60s): seq 3→4 same job 2m23s apart both fired (correct, outside window); no two fires within 60s exist to test suppression live, and none was fabricated. No violation observed.
- Non-event kinds silent live: `spec-approval` (n-…-449, n-…-440) and `benchmark-done` (~40 entries) produced zero ring entries — kind map holds.

## 7. Pre-arm ask_humans without fires are NOT a bug

Notifications n-…-444/443 (19:06–19:08Z, job-mtor3e3t-u6y5), n-…-439/438 (18:00–18:03Z), n-…-417 etc. have no ring entries. Timeline shows fires start 19:49:58Z — the bridge armed when the user daemon picked up the D18 code on a prior auto-restart; earlier ask_humans predate arming. No post-arm human ask_human is missing its fire (4/4 since 19:49:58Z).

Note: `.agents/factory/` holds 60 job dirs but none for job-mto{vec6,sol5a,tcs8t}-* — those jobs ran under a different factoryDir or were pruned. Linkage is via notification `workItemId` + ring `jobId` + notice body, all consistent.

## 8. Kill-switch: deferred to offline, documented (quota guard)

Per-task option exercised: live `enabled:false` toggle + fresh `ask_human` mint would cost LLM quota for zero new information — the offline suite already proves both layers (`global-disabled`, `trigger-disabled`, 14/14 in REPORT-D18-event-bridge §5). No yaml edit, no validate cycle, no job minted this window. Live kill-switch remains untested against the running daemon; flagged as known-deferred, not as failed.

## Verdict: D18 Replica (schedule + event both vivo, quotas hold)

- Schedule path vivo: REPORT-D18-tick-vivo (fired:2 with triggerRef jobs + ring, second tick `quota`/`cooldown` skips).
- Event path vivo: this report (fires:4, result `notified:4`, 1:1 ask→notice chain, disk ring match, anti-loop/dedup/cooldown clean).
- Both paths live on the same daemon (`15fece3e`) with quota/cooldown enforcement observed. D18 moves from Partial to Replica. Remaining item is only the documented live kill-switch toggle (offline-proven).

## Quota

- Spent this window: **0 LLM calls** (GETs + disk reads only; no job created, no review driven, no tick posted).
- Budget: 8, untouched. Acumulado: 140 + 0 = **140**.

(End of file)
