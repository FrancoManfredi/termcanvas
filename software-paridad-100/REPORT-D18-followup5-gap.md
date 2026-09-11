# D18 Follow-up 5 — First live fire attempt (honest gap, no theater)

- Date (UTC): 2026-09-05 · Engineer: Alex (software-engineer) · buildId: `15fece3e` · HEAD: `15fece3e`
- God `headless-runtime/factory/factoryServer.ts`: **3583 lines (unchanged, freeze held)**
- Scope: read-only investigation + live GETs (15s) + one bounded `POST /factory/automations/tick` manual pass. NEVER restart / taskkill / `pnpm dev` / `pnpm build`. No edits to `server` / `routeTable`. No yaml edits. No code edits.

## 1. Live probes (all 15s timeout, `-Encoding utf8` reads)

| Probe | Result |
|---|---|
| `GET /factory/health` | 200, `buildId 15fece3e`, factoryPort 17680, opencode healthy |
| `GET /factory/automations` | 200, `{enabled:true, tickMs:30000, triggers:[], recent:[]}` |
| `POST /factory/automations/tick` (empty body, one bounded manual pass) | 200, `{ok:true, at:2026-09-05T16:02:10Z, fired:0, skipped:[], fires:[]}` |
| `factory/.automations.json` on disk | absent (correct for zero fires) |
| `factory/prompts/nightly.md` on disk | **absent** (secondary gap, see §3) |
| Offline `getFactoryConfig()` keys | `ports, timeouts, defaultModels, reviewerPairs, scorers, runners, costTracking, costRates, agentSessions, reviewerReverify, improveProposalCooldown, notificationsEnabled, osNotifications` — `hasAutomations:false` |
| Offline `getEffectiveAutomationsConfig()` | `{enabled:true, tickMs:30000, triggers:[]}` — `TRIGGERS:0` |

## 2. Root cause of `triggers:[]` (loader gap, three file:line links)

The yaml content is fine. The daemon never sees it. Chain:

1. `headless-runtime/factory/agentLoader.ts:587-589` — `parseFactoryYaml` treats `automations` / `integrations` bodies as opaque and skips them (`if (section === "automations" || section === "integrations") continue;`).
2. `headless-runtime/factory/agentLoader.ts:304-337` + `748-762` — `FactoryConfig` has no `automations` field and the returned object never includes one.
3. `headless-runtime/factory/automations/automationService.ts:214-226` — `getEffectiveAutomationsConfig()` reads `(getFactoryConfig() as unknown as { automations?: unknown })?.automations`, always `undefined`, validates nothing, and falls back to `{ enabled:true, tickMs:30000, triggers:[] }`.

So `GET /factory/automations` pairs an empty definition list with empty runtime states, and `POST /factory/automations/tick` evaluates zero schedules, returning the honest empty pass `fired:0, skipped:[], fires:[]` (no schedules exist even to classify as `not-due`).

The `integrations` domain does NOT share this fate: it re-reads `factory.yaml` fresh text via `sliceTopSection` + schema (`headless-runtime/factory/integrations/integrationService.ts:92-284`). Automations never got the equivalent reader (DESIGN Ola14 §2.5 left `agentLoader` automation parsing as optional T04 work, and `automationService.ts:18-21` still waits on it: "when T04 teaches it the typed section this service picks it up with zero changes").

## 3. Why no live fire is possible this window (two independent blocks, both restart-gated)

- **Block A (config):** even a yaml test trigger (`maxFires:1`, `cooldownMs:0`) would be invisible to the running daemon. `getFactoryConfig()` is cached in memory (`agentLoader.ts:767,774-803`) and no production route calls `resetFactoryConfigCache()` (only tests reference it). Editing yaml without restart = theater: disk changes with zero live effect. Therefore no yaml edit was made (backup question moot; `validate` stays `0 errores, 0 warnings` on the untouched file).
- **Block B (code / event path):** fixing the reader inside `automationService.ts` (yaml-fresh slice, integrations-style) would still need a daemon restart to take effect: the daemon runs as a single load via `node --loader tsx headless-runtime/factory/factoryServer.ts` (`factoryServer.ts:3557-3572`, no watch mode), so on-disk TS changes are not picked up live. Restart is forbidden. Additionally, the event trigger `announce-ask-human` has no HTTP route and `fireEvent()` has zero production callers (only `tests/automations-service.test.ts`); the route table carries only `automations-list` / `automations-tick` (`routing/routeTable.ts:91-92,142-143`, `factoryServer.ts:2332-2333`), and the God freeze forbids new routes here.
- **Secondary gap (evidence quality, not blocking):** `factory/prompts/nightly.md` does not exist. `readPromptText` (`automationService.ts:281-297`) would fall back to a synthetic `[automation nightly-trivial] scheduled fire ...` prompt, so a future first fire works but cites a missing promptRef. The owning phase should either add the prompt file or point the seed trigger at an existing one. `validate` does not check promptRef existence today (shape/traversal only).

Conclusion: **no live fire this window, by design of the constraints, not by lack of trying.** `POST /factory/automations/tick` was attempted live and honestly returned `fired:0`. No job with `triggerRef`, no `.automations.json` entry, no timeline event was fabricated offline to pretend otherwise.

## 4. Verdict and carry-over

- **D18 stays Partial (55). No movement.** No theater.
- **Owning fix (needs its own phase + user sign-off, never smuggled into a follow-up):**
  1. Teach the automations effective-config reader to parse the `automations:` block from fresh yaml text (integrations-style `sliceTopSection` + `AutomationsSectionSchema` + per-trigger `TriggerSchema`), or extend `FactoryConfig` + `parseFactoryYaml` with a typed section; keep `validate` parity (`definitionValidate.ts:1676-1774` already parses the block for validation — reuse its parser, do not duplicate a third one per C7).
  2. Add the missing prompt file (`factory/prompts/nightly.md`) or repoint the seed `promptRef`.
  3. Decide the event-path seam (notify-hook calling `fireEvent`, or a new `automations-fire-event` route with its own God-budget line) — currently `announce-ask-human` can only fire in tests.
  4. Premiere live after a user-authorized daemon restart: `POST /factory/automations/tick` → `fired:1` with `job-auto-*` carrying the `trigger-fired` timeline meta (`automationService.ts:319-329`), one ring entry in `factory/.automations.json` (`automationStore.ts:232-280`), and the job.json link.
- Offline engine health is proven and stays green (see §5); the gap is purely wiring + process lifetime, not trigger logic.

## 5. Gates (explicit timeouts, ESM, utf8)

- `npx tsc --noEmit -p tsconfig.json` (≤180s) → exit **0**.
- `node scripts/factory.mjs validate` (≤30s) → `0 errores, 0 warnings`, exit **0** (untouched yaml).
- `npx tsx --test tests/automations-trigger-engine.test.ts` (≤120s) → **18/18**.
- `npx tsx --test tests/automations-service.test.ts` (≤120s) → **14/14**.
- `npx tsx --test tests/automations-routes.test.ts` (≤120s) → **12/12**.
- Core automations: **44/44**. With `tests/definition-validate-automations.test.ts`: **59/59**.
- `require\s*\(` grep over `headless-runtime/factory/automations/*.ts` → doc-comment mentions only, zero real calls (ESM clean).
- God: 3583 → 3583 (+0). Route table untouched (42 rows from F1, not re-counted here; no diff).

## 6. Disk evidences touched

- Read: `factory/factory.yaml` (lines 106-123: seed triggers present), `headless-runtime/factory/agentLoader.ts`, `headless-runtime/factory/automations/*`, `headless-runtime/factory/routing/routeTable.ts`, `headless-runtime/factory/factoryServer.ts:2332-2333,3557-3572`.
- Written: this report only. Zero code / yaml / server / route diffs (`git status` shows only this file plus prior untracked factory work, per F0/F1 dirty-tree notes).

## 7. Quota spent

- **0** LLM calls against the model server (local reads + daemon GETs/POST + `validate` + `tsc` + offline `tsx` suites; the tick created zero jobs by honest empty pass).
