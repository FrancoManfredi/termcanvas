# D18 — Live tick proves fire (PASS)

- Date (UTC): 2026-09-05 · QA: Yan (software-qa-engineer)
- Daemon: fresh user restart, fresh loader fix active. No restart / taskkill / dev / build by QA.
- Health: `GET /factory/health` 200, `buildId 15fece3e` == HEAD `15fece3e`, factoryPort 17680.
- All reads/writes: 15s timeouts, utf8. One action at a time.

## 1. Triggers visible: YES

`GET /factory/automations` (pre-probe) listed 2 triggers, no longer `triggers:[]`:

- `nightly-trivial` (schedule, intervalMs 86400000, promptRef factory/prompts/nightly.md, maxFires 5, cooldownMs 3600000)
- `announce-ask-human` (event, on ask_human, maxFires 20, cooldownMs 60000)

Fix confirmed live. Probe phase entered.

## 2. Probe setup

- Backup: `factory/factory.yaml` -> `factory/factory.yaml.bak` (restored identical afterwards, `.bak` removed).
- `factory/prompts/nightly.md` was absent -> created minimal 1-line file (`Run the nightly trivial check and report ok.`). Kept: the seed trigger references it.
- Added `qa-probe` (schedule, enabled, intervalMs 60000, promptRef factory/prompts/nightly.md, maxFires 1, cooldownMs 0).
- `node scripts/factory.mjs validate` -> `0 errores, 0 warnings`, exit 0.
- `GET /factory/automations` showed `qa-probe` live with zero restart (fresh-read loader confirmed).

## 3. Tick 1: FIRED 2 (not 1 — honest deviation, stronger proof)

`POST /factory/automations/tick` `{}` -> 200:

```json
{"ok":true,"at":"2026-09-05T18:42:33.809Z","fired":2,"skipped":[],"fires":[
 {"seq":1,"triggerName":"nightly-trivial","jobId":"job-auto-mtoqct7a-14cx","result":"created"},
 {"seq":2,"triggerName":"qa-probe","jobId":"job-auto-mtoqct8g-18ij","result":"created"}]}
```

Why 2: first live tick after restart, both due schedule triggers fire (seed never fired, `lastFireAt null`). Expected probe-only `fired:1`; got seed + probe. No theater: both jobs are real.

Evidence per job (both verified on disk):

- `.agents/factory/job-auto-mtoqct8g-18ij/job.json`: timeline `t1` actor system, message `trigger-fired qa-probe`, `meta.triggerRef {triggerName qa-probe, firedAt 2026-09-05T18:42:33.809Z, eventId null}`. Prompt resolved from the real `nightly.md`, not the synthetic fallback.
- `.agents/factory/job-auto-mtoqct7a-14cx/job.json`: same shape with `trigger-fired nightly-trivial`.
- `factory/.automations.json`: ring entries seq 1 (nightly-trivial) + seq 2 (qa-probe), both `result created`.

## 4. Tick 2: quota gate holds

`POST /factory/automations/tick` `{}` -> 200:

```json
{"ok":true,"at":"2026-09-05T18:42:52.605Z","fired":0,
 "skipped":[{"triggerName":"nightly-trivial","reason":"cooldown"},{"triggerName":"qa-probe","reason":"quota"}]}
```

`qa-probe` `maxFires:1` exhausted -> `quota` skip. `nightly-trivial` -> `cooldown` (1h). No runaway firing.

## 5. Cleanup and final state

- Probe removed from `factory.yaml`; file byte-identical to pre-probe `.bak`; `.bak` deleted.
- `validate` after restore -> `0 errores, 0 warnings`, exit 0.
- Final `GET /factory/automations`: 2 seed triggers (`nightly-trivial` fires:1, `announce-ask-human` fires:0); `recent` ring still shows both live fires including `qa-probe/job-auto-mtoqct8g-18ij`.

## 6. Jobs left running

- `job-auto-mtoqct8g-18ij` (qa-probe): state `queued`, phase `diagnosisLlm`, `.done` absent at check time. Runner queue was deep (pending 44, running 3 at health check).
- `job-auto-mtoqct7a-14cx` (nightly-trivial): same queued state.
- Result/calls: pending — jobs run async outside this window. Per instruction, FIRE already proves D18; job outcome (even Triage/H-005) does not affect the verdict.
- LLM calls spent by QA in-window: 0 (local GETs/POST + validate + file ops only). Queued jobs will add calls when the runner picks them up.

## Verdict: D18 PASS

First live `POST /factory/automations/tick` -> real `job-auto-*` jobs carrying `triggerRef` timeline meta + `.automations.json` ring entries, plus `maxFires:1` quota enforcement on the second tick. Loader fix verified live with zero restart for yaml pickup.

## Quota

- Spent this window: 0 LLM calls. Acumulado: 94 + 0 = 94 (2 jobs queued, calls attach when they run).
