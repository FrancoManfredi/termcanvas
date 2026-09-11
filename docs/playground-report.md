# Playground Report — Pact v2

> Generado: 2026-09-01T18:29:45.257Z
> Commit: `15fece3ed22ff7a7ceeaf0d3dd15f6c7dfb6acf9` (dirty — hay cambios sin commitear)
> Fuente: `software-testing-playground-v2/pacts/*.json` + `verdicts/Fxx/*.json` + `state.json`
> Comandos PowerShell: `pnpm p:consumer` → `pnpm p:verify` → `pnpm p:report --md`

## Resumen F01..F12

| Feature | Título | Wave | Estado | Pact | Commit | Verdict | Duración | Actualizado |
|---------|--------|------|--------|------|--------|---------|----------|-------------|
| F01 | Servidor único + health | Ola 1 — Servidor único + health (backend) | ✓ verified | `software-testing-playground-v2/pacts/playground-F01-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03W6…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F02 | Job en disco | Ola 2 — Job en disco (backend) | ✓ verified | `software-testing-playground-v2/pacts/playground-F02-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03WG…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F03 | Worker + logs vivos (SSE) | Ola 3 — Worker + logs vivos + SSE (hybrid) | ✓ verified | `software-testing-playground-v2/pacts/playground-F03-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03WS…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F04 | Panel Factory — lista Queued/Running/Done + Cancel | Ola 4 — UI Panel Factory (hybrid pact+human) — Ola Cancel pacteada | ✓ verified | `software-testing-playground-v2/pacts/playground-F04-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03X4…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F05 | Planning/Tools vía Factory — gate de modelo (pact gate) | Ola 5 — Planning/Tools gate + encolado (pact gate 201 vs 400) | ✓ verified | `software-testing-playground-v2/pacts/playground-F05-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03XG…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F06 | Logs y result.json | Ola 6 — Logs y result.json (dedicated endpoint) | ✓ verified | `software-testing-playground-v2/pacts/playground-F06-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03XR…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F07 | Manejo de errores 400/404 | Ola 7 — Manejo de errores 400/404 (DX) | ✓ verified | `software-testing-playground-v2/pacts/playground-F07-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03Y8…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F08 | Cola y concurrencia (múltiples jobs) | Ola 8 — Cola y concurrencia básica | ✓ verified | `software-testing-playground-v2/pacts/playground-F08-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03YJ…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F09 | Body malformado y hint DX | Ola 9 — Robustez: body malformado y hint DX | ✓ verified | `software-testing-playground-v2/pacts/playground-F09-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03YU…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F10 | Prompt largo y persistencia | Ola 10 — Prompt largo y persistencia en disco | ✓ verified | `software-testing-playground-v2/pacts/playground-F10-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03Z5…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F11 | Unicode y espacio en worktree/prompt | Ola 11 — Unicode y espacio en worktree/prompt (Windows robustez) | ✓ verified | `software-testing-playground-v2/pacts/playground-F11-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03ZK…` | 137ms | 1/9/2026, 3:28:56 p. m. |
| F12 | Cancel errores 409 ya done y 404 no existe | Ola 12 — Cancel errores 409/404 | ✓ verified | `software-testing-playground-v2/pacts/playground-F12-FactoryProvider.json` ✓ | `dirty-15` | `0MTJ03ZY…` | 137ms | 1/9/2026, 3:28:56 p. m. |
## Leyenda estados (architecture-pact-v2.md §2.5)

- **verified** (verde) — p:consumer ✓ + p:verify ✓ — desbloquea F dependientes
- **mock_only** (ámbar rayado `⚠ MOCK PACT`) — solo p:consumer ✓, sin p:verify — NO desbloquea
- **failed** (rojo) — p:verify ✗ — diff Expected vs Actual en VerdictDrawer
- **not_generated** (gris) — sin pact JSON — corre `pnpm p:consumer`

## Detalle por Feature

### F01 — Servidor único + health
- **Wave:** Ola 1 — Servidor único + health (backend)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F01-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03W697566ED9809` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F02 — Job en disco
- **Wave:** Ola 2 — Job en disco (backend)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F02-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03WGL588397D6DE` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F03 — Worker + logs vivos (SSE)
- **Wave:** Ola 3 — Worker + logs vivos + SSE (hybrid)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F03-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03WSW0EE3682680` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F04 — Panel Factory — lista Queued/Running/Done + Cancel
- **Wave:** Ola 4 — UI Panel Factory (hybrid pact+human) — Ola Cancel pacteada
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F04-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03X4Z49C2B5D6B0` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F05 — Planning/Tools vía Factory — gate de modelo (pact gate)
- **Wave:** Ola 5 — Planning/Tools gate + encolado (pact gate 201 vs 400)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F05-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03XG22F99DFA6E1` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F06 — Logs y result.json
- **Wave:** Ola 6 — Logs y result.json (dedicated endpoint)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F06-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03XRJEA5B933C51` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F07 — Manejo de errores 400/404
- **Wave:** Ola 7 — Manejo de errores 400/404 (DX)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F07-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03Y8DDB6BA156B7` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F08 — Cola y concurrencia (múltiples jobs)
- **Wave:** Ola 8 — Cola y concurrencia básica
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F08-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03YJ04E4DEA0EC9` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F09 — Body malformado y hint DX
- **Wave:** Ola 9 — Robustez: body malformado y hint DX
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F09-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03YU2FC067F0DEB` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F10 — Prompt largo y persistencia
- **Wave:** Ola 10 — Prompt largo y persistencia en disco
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F10-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03Z57F20D5104F8` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F11 — Unicode y espacio en worktree/prompt
- **Wave:** Ola 11 — Unicode y espacio en worktree/prompt (Windows robustez)
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F11-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03ZKK9C5C52DD9B` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681

### F12 — Cancel errores 409 ya done y 404 no existe
- **Wave:** Ola 12 — Cancel errores 409/404
- **Estado:** `verified`
- **Pact:** `software-testing-playground-v2/pacts/playground-F12-FactoryProvider.json` ✓ existe
- **Commit:** `dirty-15fece3e`
- **Verdict:** `0MTJ03ZYA58DED4899D` — 2026-09-01T18:28:56.863Z
- **Provider:** http://127.0.0.1:17681


## PowerShell — Verificación manual

```powershell
# Ver pacts generados
Get-ChildItem software-testing-playground-v2\pacts\ | Format-Table Name, Length, LastWriteTime
Get-Content software-testing-playground-v2\pacts\playground-F01-FactoryProvider.json | ConvertFrom-Json | ConvertTo-Json -Depth 10

# Ver state derivado
Get-Content software-testing-playground-v2\state.json | ConvertFrom-Json | ConvertTo-Json -Depth 8

# Ver verdicts
Get-ChildItem software-testing-playground-v2\verdicts\F01\ | Sort-Object LastWriteTime -Descending | Select-Object -First 5
Get-Content software-testing-playground-v2\verdicts\F01\*.json | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Select-Object -First 80

# GC dry-run
pnpm p:gc --dry-run
pnpm playground:gc --dry-run

# Report regenerar
pnpm p:report --md
Get-Content docs\playground-report.md
```

## Notas Ola 7

- F04 es **hybrid pact + human** — Pact valida `GET /factory/jobs` (lista panel) + `POST /factory/jobs/:id/cancel` (Ola Cancel 2 interactions), human valida filtros Queued/Running/Done + Ver logs tail vivo (ver `verifiers/verify-F04.human.md`)
- F05 es **pact gate** — Pact valida `POST /factory/jobs` gate: modelo válido (gpt-4o) → 201 queued vs inválido (gpt-99) → 400 `{error:"model not in catalog", alternatives:[...]}` fail fast (2 interactions, 201+400). Cero PTY, alternatives útiles (ver `verifiers/verify-F05.human.md` y `pact/consumer/F05.consumer.spec.ts`)
- F06 es **logs dedicado** — Pact valida `GET /factory/jobs/:id/logs` → 200 `{id, logs}` con `eachLike("opencode: streaming")` + `GET /factory/jobs/:id` → 200 con `resultPreview` valida `result.json`/`logs.ndjson` en disco tras done (2 interactions). Reusa job-abc123 de F03 (ver `pact/consumer/F06.consumer.spec.ts`)
- F07 es **DX 400/404** — Pact valida `POST /factory/jobs` sin prompt → 400 `{error:"prompt is required", hint, received}` + `GET /factory/jobs/job-notexist-99` → 404 `{error:"job not found"}` (2 interactions, DX crítico). Reusa `factory is healthy` + `no job exists` no-op (ver `pact/consumer/F07.consumer.spec.ts`)

## Notas Ola 8

- F08 es **cola y concurrencia básica** — Pact valida `GET /factory/jobs` → 200 `{jobs: eachLike min:2}` con `id regex, phase type, state queued|running|done|error, dir Windows` + `GET /factory/health` → 200 `{queue:{pending:integer, running:integer}, uptime:integer, version like "local", ts regex ISO8601}` (2 interactions). StateHandler "multiple jobs exist" crea 2 jobs si <2 (POST + 200ms), "factory is healthy after jobs" reuse health con providerState distinto (ver `pact/consumer/F08.consumer.spec.ts`). Cierra gap F02/F04 (solo 1 job).

## Notas Ola 9

- F09 es **robustez: body malformado y hint DX** — Pact valida `POST /factory/jobs` con body malformado `text/plain "not-json"` → 400 `{error:"body must be valid JSON", hint, received}` (cubre curl sin .exe — JSON malformado) + `GET /factory/jobs/job-zzz-invalid99` → 404 `{error:"job not found"}` (2 interactions). StateHandler "factory is healthy" reuse + "no job exists" con id job-zzz-invalid99 (ver `pact/consumer/F09.consumer.spec.ts`). Cierra gap F07 (solo cubría prompt missing, no JSON inválido).

## Notas Ola 10

- F10 es **prompt largo y persistencia** — Pact valida `POST /factory/jobs` con prompt `a`.repeat(1500) (regex ^a{1000,}$) → 201 queued (valida que Factory no trunca a 120 — solo resultPreview trunca) + `GET /factory/jobs/job-f10-large01` → 200 con prompt regex ^a{1000,}$ idéntico (persistencia, len 1500, state queued|running|done|error, logs type, dir Windows). StateHandler "a job with large prompt exists" asegura job con prompt large via POST id determinístico o fallback manual (ver `pact/consumer/F10.consumer.spec.ts`). Cierra gap >1K nunca probado.

## Notas Ola 11

- F11 es **unicode y espacio en worktree/prompt** — Pact valida `POST /factory/jobs` con prompt `"línea1\nlínea2 con ñ y → y tildes ó í"` + worktree `"C:\\tmp\\playground F11 ñ test"` → 201 queued (path regex Windows con espacio y \.agents\factory, job.prompt regex "línea1") + `GET /factory/jobs/job-f11-unicode01` → 200 con prompt regex "línea1.*ñ" worktree regex "playground F11 ñ" idénticos sin mojibake (no Ã³). StateHandler "a job with unicode prompt exists" asegura job con prompt unicode via POST id determinístico o fallback manual utf-8 (prompt.md utf-8). Valida headers plain, worktree con espacio, saltos de línea \n y unicode tildes. Cierra gap encoding submitHuman (ver `pact/consumer/F11.consumer.spec.ts`).

## Notas Ola 12

- F12 es **cancel errores 409/404** — Pact valida `POST /factory/jobs/job-f12-done01/cancel` sobre job ya done/error → 409 `{error regex "already (done|error)"}` (Given "a job that is done" con id job-f12-done01, handler deja job en done) + `POST /factory/jobs/job-notexist-99/cancel` sobre inexistente → 404 `{error regex "job not found"}` (Given "no job exists" reuse). Headers plain application/json body {}, Windows only. Complementa F04 (cancel 200) y cierra gap nunca probado POST cancel sobre done y sobre inexistente (ver `pact/consumer/F12.consumer.spec.ts` y factoryServer.ts ~596).
- `p:ci` pasa solo si F01-03 verified y F04-12 no están failed (mock_only/not_generated no bloquea, ver `pact/support/ci.ts`) — total 12 pacts, 22 interactions (F01 1 + F02 1 + F03 2 + F04 2 + F05 2 + F06 2 + F07 2 + F08 2 + F09 2 + F10 2 + F11 2 + F12 2)

---
*Generado por `software-testing-playground-v2/pact/support/report.ts` — no editar a mano, regenerar con `pnpm p:report --md`*
