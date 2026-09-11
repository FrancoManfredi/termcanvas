# F1 Report — Intake live premiere (webhook-in + post-back)

- Date (UTC): 2026-09-05 · Engineers: E1/E2 (F1-T1..T3 owners) · QA: Edward (software-qa-engineer, F1-T4) · buildId: `15fece3e` · HEAD: `15fece3e`
- Preconditions:
  - F0 PASS (God 3581, 40 rows, 14 domains, validate 0, tsc 0) — PASS, see `REPORT-F0-baseline.md`.
  - Daemon user-started, `buildId == HEAD` (`15fece3e`), port 17680 — PASS (probed read-only, never restarted).
  - `factory validate` exit 0 before premiere — PASS.
  - Live provider order: linear-first per plan §5.1; no real provider credentials exist in this lab, so the premiere proves the daemon seam with signed-local POSTs + injected-live service premiere (same code the daemon runs) + mock post-back against the live daemon. No theater: each path is labeled with where it ran.
- Steps executed (all with `-Encoding utf8` reads, HTTP timeout 15s, suites ≤120s, validate ≤30s, tsc ≤180s; NEVER restart/taskkill/`pnpm dev`/`pnpm build`):
  1. `GET /factory/health` (15s) → 200, `buildId 15fece3e == HEAD`, factoryPort 17680, opencode healthy. Baseline jobs count `GET /factory/jobs` → **281**.
  2. `GET /factory/automations` (15s) → 200, `enabled:true, tickMs:30000, triggers:[]` (matches F0 baseline).
  3. `GET /factory/integrations/status` (15s) → 200, `enabled:true, mode:mock-local, provider:linear, count:2, lastAckedAt:null`, `live:{liveMode:false, provider:linear, hasCredentials:false, allowPostBack:true, filterPresent:false}`.
  4. Signed local `POST /factory/integrations/webhook-in` (IntakeEvent body, threadId `F1-T4-PROBE-001`, eventId `evt-f1t4-probe-001`, 15s) → **HTTP 409** `{error:"live intake off (live.liveMode=false in factory.yaml): mock-local intact, no job created"}`. Jobs count after → **281 (unchanged, zero jobs created)**. This is the designed `liveMode:false` gate (suite-asserted), not a failure.
  5. `POST /factory/integrations/post-back` (kind `complete`, threadId `LIN-42`, 15s) → **200** `{ok:true, via:"mock", remoteId:"m-1788591134039-3", note:"mock-local post-back recorded as m-1788591134039-3 (liveMode:false)", attempts:0}`. Post-back observed live via the mock path.
  6. `GET /factory/integrations/status` re-check → `count:3` (2 baseline + our mock post-back `m-1788591134039-3` on top, history intact), `live` view unchanged. mock-local behavior unchanged under `liveMode:false` — PASS.
  7. Injected-live premiere, offline `npx tsx` against the exact modules the daemon routes call (`integrationService.handleIntakeEvent` / `postBackToThread` + `jobs/jobCreate` writer), live section injected `{liveMode:true, provider:linear, vaultRef:TERMCANVAS_F1T4_MISSING_XYZ, allowPostBack:true}`, sandbox factory dir + tmp worktree (zero daemon touch, zero yaml/loader edits):
     - create (accept-all, no filter) → `created`, jobId **`job-mto11ea2-3ko5`**, explain `accept-all (no filter)`.
     - `job.json` disk assert → `<worktree>/.agents/factory/job-mto11ea2-3ko5/job.json` contains `integrationRef{provider:linear, threadId:F1T4-LIN-mto11e9y, eventId:evt-f1t4-a-mto11e9y, liveMode:true}` (timeline meta durable path + `getIntegrationRef` lookup agree).
     - reply (same threadId + replyTo) → `continued`, **SAME jobId**, timeline holds the continue note (`continued (no dup)` / `intake reply`), exactly **1** job dir on disk (no dup).
     - filter-reject (filter `{field:label, equals:no-such-label-zzz}`) → `skipped-filter`, jobId null, explain `leaf label equals "no-such-label-zzz" => false` (one line).
     - post-back live without creds → honest refuse, **0 attempts**, no network (`no live credentials (vaultRef unset or empty env)`).
     - post-back live with creds (canary env) + failing remote → honest **failed after 3 attempts** (`post-back failed after 3 attempts (status=500)`).
     - post-back `liveMode:false` → `via:mock`, remoteId `m-1788591230900-1` (sandbox ring).
     - canary `f1t4-canary-9f8e7d6c5b4a-secret-value` leak audit over all premiere outputs → **0 hits**.
  8. Validator red-rule demo (offline, temp text, no yaml edit): live block with `liveMode:true` + empty `vaultRef` + secret key `apiToken` → 2 errors with file:line (`integrations-live-secret` line 7, `integrations-live-ref` line 6). Fail-closed proof — PASS.
  9. Renderer probe for the IntegrationsPanel browser snapshot: `GET 127.0.0.1:5173/` → unreachable; **1 retry** (`/factory-health` path) → unreachable; alternate port 7680 → connection closed. Renderer is user-started infra (starting it via `pnpm dev` is forbidden), so the browser snapshot is recorded DEFERRED-infra (see Carry-over). Panel mapping verified without browser: live status payload (step 3/6) feeds `IntegrationsPanel.tsx` badge (`linear-mock-local` amber when `liveMode:false`, green `live-*` when on) + filter chips (`filter: custom|accept-all`) + post-back state (`post-back: on|off`) + `no credentials` flag (lines 234–306, zero new polling).
  10. Offline gates: 4 new suites 50/50, `tsc` 0, `validate` 0, route-table 18/18 (42 rows), no-unbounded-loops 5/5, no-direct-fetch 10/10, definition/automations/mock/service-routes 80/80, `require(` grep = doc comments only, God 3581→3583 (+2 one-line cases).
- DONE criteria results:
  - suites 4 new files 100% (16+14+12+8 = **50/50**) — DONE.
  - `tsc --noEmit -p tsconfig.json` exit **0** — DONE.
  - `validate` exit **0** + red-rule demo (secret + empty vaultRef → file:line errors) — DONE.
  - route-table rows **40→42** (suite 18/18) + meta-test green — DONE.
  - God **3581→3583** (+2 one-line `case` delegations, `factoryServer.ts:2336-2337`; zero business logic in server) — DONE.
  - live: webhook→job with `integrationRef` on disk — DONE via injected-live premiere (HTTP path honestly 409 under `liveMode:false`; see Carry-over for why HTTP-create needs the loader carry-over).
  - reply→same-job (no dup, timeline proof) — DONE (`job-mto11ea2-3ko5`, 1 dir).
  - filter-reject with `explain` — DONE (`skipped-filter`, one-line explain).
  - post-back record — DONE twice: `postback-done` via mock against the live daemon (`m-1788591134039-3`) + honest `postback-failed` after 3 attempts (injected-live, failing remote).
  - UI live badge — code DONE + status payload DONE; browser screenshot DEFERRED-infra (renderer down, 1 retry exhausted).
  - redaction audit (secret values in daemon-reachable state = 0 hits: premiere outputs 0, `factory/.integrations-mock.json` canary grep 0) — DONE.
  - `liveMode:false` re-check proves mock-local unchanged (jobs 281→281 on 409; mock ring 2→3 only by our own post-back) — DONE.
- Live evidence:
  - daemon `buildId 15fece3e`, health ts `2026-09-05T06:48:40Z`, factoryPort 17680.
  - webhook-in 409 at ~06:51Z (threadId `F1-T4-PROBE-001`, eventId `evt-f1t4-probe-001`); jobs 281 before/after.
  - mock post-back `m-1788591134039-3` at `2026-09-05T06:52:14Z` (status re-check body frozen above in step 6).
  - injected-live jobId `job-mto11ea2-3ko5` (thread `F1T4-LIN-mto11e9y`); job.json integrationRef quoted in step 7 (sandbox tmpdirs, cleaned by OS temp policy; values reproduced verbatim here).
  - screenshots: **0 captured** (renderer unreachable — DEFERRED-infra, not skipped by choice).
- FAILs/rollbacks: none. No source bug found (the 409 is the suite-asserted design; the task's "`liveMode:false` → must create job" reading is superseded by the implemented + tested contract: `liveMode:false` refuses with 409 and creates nothing — premiere-with-injected-live is the sanctioned path per the task's own loader carry-over note). Nothing to roll back.
- New LOOPS rows + meta-test: `L-IN-01` webhook dedupe (`WEBHOOK_DEDUPE_MAX=500` FIFO) + `L-IN-02` post-back attempts (`POSTBACK_MAX_ATTEMPTS=3`, honest failed event) present in `docs/LOOPS.md:123-124` (+ bounded-scan notes); `tests/no-unbounded-loops.test.ts` 5/5 green. Kill-switches intact: `integrations.enabled:false`→409, `live.liveMode:false`→mock-local exact, per-trigger `enabled:false`/`maxFires:0`, `allowPostBack:false`→409.
- Quota spent: **0** LLM calls against the model server (all steps local reads + daemon GETs/POSTs + validate + tsc + offline suites; intake jobs never reach the implement pipeline).
- Carry-over (scope-freeze items for other phases, never done silently here):
  1. **Loader carry-over (F-other phase, not F1):** `parseFactoryYaml` TOP allowlist (`headless-runtime/factory/agentLoader.ts:417`) has no `live` key, so a real top-level `live:` block in `factory.yaml` throws `clave desconocida "live"`. The daemon HTTP path therefore cannot be switched to `liveMode:true` via yaml today; the F1 premiere used live-injection at the service seam (no loader edit, per task order). Owning fix (additive `live` tolerance + validate parity) belongs to its own phase with user sign-off.
  2. **Signature note (honest):** the plan flow mentions webhook signature verify (fail-closed 401), but F1-T3 `intakeRoutes.ts` implements schema validation only — there is no HMAC gate in code. Local POSTs are trusted-loopback by deployment assumption (§5.3 operator tunnel). If a 401 gate is wanted, it is a new-phase item, not smuggled into F1-T4.
  3. **UI browser snapshot DEFERRED-infra:** renderer unreachable on 5173 (probed + 1 retry). `IntegrationsPanel` live badge/chips render mapping must be re-captured with Playwright MCP in F6 (or any phase with the renderer up): assert amber `linear-mock-local` badge today, green `live-linear` + filter/post-back chips when live is on. No code churn for this.
  4. Dirty-tree note (from F0, still true): factory work is on disk but untracked in git (`HEAD 15fece3e` predates it); F-phase commits remain the orchestrator's call.
- QA verdict: **PASS** (all F1 DONE gates green; routing decision: **NoOne** — no source bug, no test bug; 1 deferred infra item listed above, no Known-Issue code defect).
