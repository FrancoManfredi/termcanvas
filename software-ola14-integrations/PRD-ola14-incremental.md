# PRD Incremental — Ola 14 Automations + Integrations (lift explicit deferral)

## 1. Project Info

- **Language:** English (artifacts). Chat summary in Rioplatense Spanish.
- **Programming Language:** TypeScript ESM (existing TermCanvas factory) + Vite + React + MUI + Tailwind CSS for the minimal panel. No new stack.
- **Project Name:** `termcanvas_ola14_automations_integrations`
- **Original requirement (restated):** Lift the explicit deferral of Wave 14 Automations (triggers) + Integrations (Linear/Slack) to reach 100% Warp parity. Current live parity ~65%. Deferred by user decision = automations + integrations. Without external intake there is no 100%.
- **Mandatory inputs read:** `docs/MASTER-PLAN-FACTORY.md` (Waves 1-13, rules 1-6), `docs/MASTER-PLAN-PARIDAD.md` (Waves 15-20 closed, Wave 14 + Integrations explicitly deferred, rules 7-8), `docs/MASTER-PLAN-E2E.md` §6 + `docs/E2E-HALLAZGOS.md` (H-001..H-013), `docs/MASTER-PLAN-MODULARIDAD.md` §6 (F1-F4 + anti-God batches 1-3/A/B/C, God 3575 total / 2803 code, single dispatch), `docs/LOOPS.md`, `factory/factory.yaml`, `headless-runtime/factory/` domain listing (definition, health, intake, jobs, loaders, measure, notifications, review, routing, startup, triageSpec, verify — no `automations/` nor `integrations/` yet).

## 2. Product Definition

### 2.1 Product Goals (3, orthogonal)

1. **Triggers live without risk:** minimal event + schedule triggers run jobs autonomously, every loop bounded (Rule 7) and every automatism has an off-switch in `factory.yaml` (Rule 8).
2. **One integration proven end-to-end with zero secrets:** a single minimal Linear OR Slack integration works against a local mock (no real credentials), with evidence on disk and visible status in UI.
3. **Zero regression on the 65% that already works:** pacts F01-F14, pollings 2.5s/5s/30s, `buildId` = commit hash, God-server budget, and H-001..H-013 fixes stay green.

### 2.2 Users

- **Factory operator (primary):** configures triggers/flags in `factory.yaml`, watches the automations panel, kills anything with one flag.
- **Human approver:** receives `ask_human` / spec-approval / proposal-ready fired by a trigger, acts from the existing notification bell. No new inbox.
- **Future external requester (out of scope for P0):** the Linear/Slack user whose message would become intake. P0 only mocks this side; real 100% parity needs real external intake (explicit non-goal for this increment).

### 2.3 User Stories (with acceptance criteria)

1. **As an operator, I want a schedule trigger that creates a job from a tracked prompt so that routine work starts by itself.**
   - Acceptable when: a cron-like entry in `factory.yaml` fires at most N times (quota), creates ≤1 job per tick with `triggerRef` in `job.json` + timeline event, and setting `automations.enabled: false` stops all future fires (verified by test + one live tick).

2. **As an operator, I want event triggers (job-complete, ask_human, proposal-ready) that chain the next action so that I do not poll the UI.**
   - Acceptable when: each event fires ≤1 action per source event (dedupe by event id), writes evidence (`automations.json` entry + timeline), respects per-trigger `maxFires` + cooldown, and never creates a job from a pact id (pact gate intact).

3. **As an approver, I want the minimal Linear-or-Slack mock to notify me and accept an ack back so that the loop is proven without real credentials.**
   - Acceptable when: `ask_human` on a real job posts to the local mock endpoint (no network, no token), the mock records it on disk, an ack typed in the mock UI/panel marks the notification acked, and the whole path runs with `integrations.mode: "mock-local"`.

4. **As an operator, I want one kill-switch per automatism plus a global one so that any surprise stops in one edit.**
   - Acceptable when: `automations.enabled: false` stops triggers, `integrations.enabled: false` stops outbound posts, each trigger has `enabled: false` respected, and `factory validate` + definition badge go red on invalid trigger/integration config while the daemon keeps serving via fallback (visible degradation, never silent).

## 3. Technical Spec

### 3.1 Requirements Pool

**P0 — Must have (this increment closes the deferral lift, minimal viable):**

- **P0-1 Triggers minimal (2 kinds only):** `schedule` (interval/cron-like with `maxFires` + `cooldownMs`) + `event` (allowlist: `job-complete`, `ask_human`, `proposal-ready`). MUST support `enabled`, `maxFires`, `cooldownMs` per trigger. MUST write `triggerRef` + evidence to `job.json`/timeline/`automations.json`.
- **P0-2 Interruptor + quotas (Rules 7-8):** global `automations.enabled`, per-trigger `enabled`, `0 = off` semantics. Every timer/retry/dedupe has an explicit numeric bound registered in `docs/LOOPS.md` + covered by `tests/no-unbounded-loops.test.ts`. Reuse existing pollings only (2.5s jobs / 5s notifications / 30s health); zero new daemon intervals except ONE trigger ticker with fixed period + test.
- **P0-3 One minimal integration with local mock, zero real credentials:** either Linear OR Slack (not both). `integrations.enabled` + `integrations.mode: "mock-local"` only. Outbound = local mock adapter behind an interface (`postNotification`, `ackNotification`); no tokens, no network, no SDK. Inbound ack reconciles with `POST /:id/ack`. Secrets fields MUST NOT exist in P0 schema (rejected by `definitionValidate` if present).
- **P0-4 Cohesion / God-minimal:** all new logic lives in `headless-runtime/factory/automations/` and `headless-runtime/factory/integrations/`. `factoryServer.ts` gets ONLY 1-line delegation per new route via existing `routeTable` + single `matchRoute` dispatch. No business logic in the server. Server total MUST NOT grow beyond the God budget (3575 total / 2803 code baseline; delta documented in the wave report).
- **P0-5 Contracts intact:** ESM with zero `require()`, zod 4 + `superRefine` for new schemas, pacts F01-F14 green, pollings 2.5s/5s/30s unchanged, `buildId` = commit hash surfaced in `/factory/health` + UI, PowerShell with `-Encoding utf8` only. `factory validate` + `GET /factory/definition/status` cover the new `automations`/`integrations` sections (bad file:line on error, fallback visible).
- **P0-6 Evidence + tests:** `automations.json` per job (or central ring with cap, decided at build, documented), `.notifications.json` reuse for trigger-fired notices, `result.json` enrichment only via the single writer. New suites: trigger schedule/event, kill-switch off, quota/dedupe termination, mock-integration post+ack, definition-validate new rules, loops meta-test extension. `tsc` 0.

**P1 — Should have (next increment):**

- **P1-1 Second integration:** the one not chosen in P0 (Slack if P0 was Linear, or vice versa), same mock-local contract, same flags, cards grouped by provider in UI.
- **P1-2 Trigger run history UI:** filterable list (trigger, fires, last result, next tick) reading the existing projection; no new polling.
- **P1-3 Real-secret seam (design only, no keys):** interface for a future `mode: "live"` with vault/env refs + redacted logs; explicitly NOT wired in P1.

**P2 — Nice to have (later):**

- More triggers (webhook-in, file-watch, benchmark-done chaining), richer field mapping, bidirectional sync (status back to Linear/Slack), per-kind toast flags, cost attribution per trigger (`llmCalls` rollup), live-mode hardening (retries with backoff + redaction audit).

### 3.2 UI Design Draft (minimal)

- **FactoryLab section `Automations` (one collapsible card, no new page):** table of triggers (`name | kind | enabled | fires/maxFires | last result | next tick`), global toggle state mirrored from `factory.yaml` (read-only display + "edit factory.yaml" hint, never inline secrets), link from each fired row to its `jobId`.
- **FactoryLab section `Integrations` (one card next to Notifications):** provider badge (`linear-mock-local` amber / `slack-mock-local` amber; green reserved for future live), last post + ack state, button `Send test post` (writes to mock only) + `Ack` reusing the existing notification ack path.
- **Config surface = `factory.yaml` only (no new config file):**
  ```yaml
  automations:
    enabled: true
    tickMs: 30000          # the ONE new ticker; 0 = off
    triggers:
      - name: "nightly-trivial"
        kind: "schedule"   # schedule | event
        enabled: true
        cron: "0 3 * * *"  # or intervalMs; one of the two required
        promptRef: "factory/prompts/nightly.md"
        maxFires: 5
        cooldownMs: 3600000
      - name: "announce-ask-human"
        kind: "event"
        enabled: true
        on: "ask_human"    # allowlist: job-complete | ask_human | proposal-ready
        action: "notify-integration"
        maxFires: 20
        cooldownMs: 60000
  integrations:
    enabled: true
    mode: "mock-local"     # mock-local ONLY in P0; live rejected by validator
    provider: "linear"     # linear | slack (exactly one in P0)
  ```
- **Definition badge reuse:** invalid trigger/integration config = red badge with `file:line rule` (same tick 30s, zero new polling).

### 3.3 Open Questions

1. **Which exact triggers seed P0?** Proposal above is schedule + 3 events. Confirm the event allowlist and whether `schedule` means cron string or plain `intervalMs` (or both with exactly-one validation).
2. **Which integration goes first?** Linear-first or Slack-first? P0 builds exactly one; the choice fixes the mock shape (issue-create vs message-post).
3. **Fake credentials vs pure mock?** Proposal is pure `mock-local` with NO secret fields at all (validator rejects them). Confirm: no `.env` tokens, no fake-token fixtures in P0 — real-secret seam comes only in P1 as design.
