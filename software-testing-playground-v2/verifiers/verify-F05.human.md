# F05 — Planning/Tools vía Factory — Verificación Pact gate + human (gate + 2 jobs, sin PTY)

> **Ola 5 — pact gate (201 vs 400)** — `software-testing-playground-v2/criteria/F05.json` define `version: "1.1.0"`, `pact: "software-testing-playground-v2/pacts/playground-F05-FactoryProvider.json"`, `verifier.kind: "pact"` (antes human slim)
> Motivo: F05 ahora expone validación server-side en `POST /factory/jobs` con `modelRef` opcional: si `modelRef.modelID === "gpt-99"` → 400 {error, alternatives} fail fast, si válido → 201 queued. Antes gate era local `validatePhaseAgainstCatalog`; ahora está pacteado via 2 interactions.

## Contrato Pact (2 interactions)

| # | Given | Request | Response |
|---|-------|---------|----------|
| 1 | `gate allows valid model` | `POST /factory/jobs` con `prompt, worktree, phase, modelRef:{providerID:"openai", modelID:"gpt-4o", variant:"default"}, cli:"claude"` | `201` `{id, path, job:{state:"queued"}}` |
| 2 | `gate rejects invalid model` | `POST /factory/jobs` con `modelRef:{modelID:"gpt-99"}` (inválido) | `400` `{error:"model not in catalog", alternatives:["gpt-4o","claude-sonnet-4","gemini-2.5-pro"]}` |

- `modelRef` y `cli` son opcionales — F02/F04 siguen funcionando sin ellos (compatibilidad).
- Gate invalido responde 400 con alternatives útiles, no gasta tokens, no crea job.
- Precondición: Factory daemon en 17680-17690 (ver `headless-runtime/factory/factoryServer.ts` POST handler).

## Precondiciones

- Factory daemon corriendo (`pnpm dev` o `npx tsx headless-runtime/factory/factoryServer.ts`)
- `pnpm p:consumer` ya generó 5 pacts (F01 1 + F02 1 + F03 2 + F04 2 + F05 2 = 8 interactions)
- `pnpm p:lint` PASS (F05 permite 2 interactions, valida 201+400 + alternatives)

## Checklist Pact + human (3 pasos — el pact cubre gate, human cubre cero PTY)

### 1. Gate valida antes de encolar (fail fast si modelo no existe) — **pacteado**

```powershell
# PowerShell — gate pacteado: POST con modelRef válido vs inválido
$base = "http://127.0.0.1:17680"

# Valid: gpt-4o → 201 queued
$valid = @{prompt="F05-valid-$(Get-Random)"; worktree="C:\tmp\playground-F05-valid"; phase="diagnosisLlm"; modelRef=@{providerID="openai"; modelID="gpt-4o"; variant="default"}; cli="claude"} | ConvertTo-Json -Depth 5
Invoke-RestMethod -UseBasicParsing -Uri $base/factory/jobs -Method Post -ContentType "application/json" -Body $valid | ConvertTo-Json -Depth 6

# Invalid: gpt-99 → 400 {error, alternatives} fail fast
$invalid = @{prompt="F05-invalid-$(Get-Random)"; worktree="C:\tmp\playground-F05-invalid"; phase="diagnosisLlm"; modelRef=@{providerID="openai"; modelID="gpt-99"; variant="default"}; cli="claude"} | ConvertTo-Json -Depth 5
try { Invoke-RestMethod -UseBasicParsing -Uri $base/factory/jobs -Method Post -ContentType "application/json" -Body $invalid } catch { $_.ErrorDetails.Message | ConvertFrom-Json | ConvertTo-Json -Depth 5 }

# Alternativa curl.exe (siempre con .exe, nunca curl solo):
# curl.exe --silent -X POST $base/factory/jobs -H "Content-Type: application/json" -d "{\"prompt\":\"F05-valid\",\"worktree\":\"C:\\\\tmp\\\\playground-F05-valid\",\"phase\":\"diagnosisLlm\",\"modelRef\":{\"providerID\":\"openai\",\"modelID\":\"gpt-99\",\"variant\":\"default\"},\"cli\":\"claude\"}"

# Verificar alternativas útiles:
# $err = (Invoke-RestMethod error).alternatives — debe contener gpt-4o, claude-sonnet-4, gemini-2.5-pro
```

**Criterio pass:** Pact F05 verifica ambos casos: válido 201 + inválido 400 con alternatives. Human verifica que UI muestra alternatives y no gasta tokens.

### 2. Con gate válido, disparar Diagnóstico + Tools (2× POST reales) — **pacteado + human**

```powershell
# PowerShell — simular 2× POST reales con gate válido (lo que hace F05 en UI):
$base = "http://127.0.0.1:17680"
$w1 = "C:\tmp\playground-F05-diag-$(Get-Random)"
$w2 = "C:\tmp\playground-F05-tools-$(Get-Random)"
# Ambos con modelRef válido gpt-4o para pasar gate
$j1 = Invoke-RestMethod -UseBasicParsing -Uri $base/factory/jobs -Method Post -ContentType "application/json" -Body (@{prompt="F05-diag-$(Get-Random)"; worktree=$w1; phase="diagnosisLlm"; modelRef=@{providerID="openai"; modelID="gpt-4o"; variant="default"}; cli="claude"} | ConvertTo-Json -Depth 5)
$j2 = Invoke-RestMethod -UseBasicParsing -Uri $base/factory/jobs -Method Post -ContentType "application/json" -Body (@{prompt="F05-tools-$(Get-Random)"; worktree=$w2; phase="tools"; modelRef=@{providerID="openai"; modelID="gpt-4o"; variant="default"}; cli="claude"} | ConvertTo-Json -Depth 5)
$j1; $j2 | ConvertTo-Json -Depth 5
# Ver ambos:
Invoke-RestMethod -UseBasicParsing $base/factory/jobs | Select-Object -ExpandProperty jobs | Where-Object { $_.id -in @($j1.id, $j2.id) } | Format-Table id, state, phase
```

**Criterio pass:** 2 jobs creados con 201, ids distintos, phases correctas, no se reutiliza mismo id. Gate no bloquea válidos.

### 3. Verificar cero PTYs y cero localStorage en flujo — **human**

```
# En UI:
- Durante todo F05 (gate 201 + gate 400 + 2 jobs) no debe abrirse terminal xterm/node-pty
- DevTools → Application → Local Storage → no debe crecer "factory-playground-mock-jobs" (si existe es bug — debe ser cero tras migrar a daemon real)
- Network tab → debe verse 1× POST 201 + 1× POST 400 (gate) + 2× POST 201 (diag+tools), no WebSocket a pty
```

```powershell
# PowerShell — verificar disco, no localStorage:
Get-ChildItem C:\tmp\playground-F05-* -Recurse -Filter job.json -ErrorAction SilentlyContinue | Format-Table FullName
Get-Content C:\tmp\playground-F05-valid\ .agents\factory\*\job.json -ErrorAction SilentlyContinue | ConvertFrom-Json | ConvertTo-Json -Depth 5

# Verificar que no hay PTY:
Get-Content $env:APPDATA\termcanvas\logs\*.log -ErrorAction SilentlyContinue | Select-String "pty" | Select-Object -First 10
```

**Criterio pass:** cero `node-pty` spawn, cero `localStorage` mock, jobs reales en disco + daemon. 400 no crea job.

## Por qué ahora hay pact para F05

- Antes: `POST /factory/jobs` ya estaba pacteado en F02 (single) y F04 (lista) — gate era validación **local** `src/lib/model-catalog`, no HTTP → no pacteable con PactV3
- Ahora: Factory `POST /factory/jobs` valida server-side `modelRef` (simula `validatePhaseAgainstCatalog`): si `modelID === "gpt-99"` → 400 con alternatives — ya es contrato HTTP pacteable con 2 interactions (201 valid + 400 invalid)
- Si en futuro se expone `GET /factory/models` o `POST /factory/planning` con gate más complejo, extender F05 a 3 interactions, pero por ahora 2 es suficiente

## Evidencia para verdict

- **Pact:** `pnpm p:consumer` genera `pacts/playground-F05-FactoryProvider.json` (2 interactions), `pnpm p:verify -- F05` verifica contra Factory real (stateHandlers: "gate allows valid model" y "gate rejects invalid model" aseguran worktree), `pnpm p:lint` PASS con 5 pacts 8 interactions
- **Human:** tras checklist pass, crear `verdicts/F05/<ulid>.json` con `conclusion: pass` + `humanChecklist` + evidencia `Invoke-RestMethod` output (ó dejar pact verified como fuente, human checklist complementa cero PTY)
- `state.json` derivará `F05: verified` (verde) si pact PASS, o `mock_only` si solo consumer, o `failed` si gate rompe
- `p:ci` no bloquea si F05 mock_only/not_generated, solo failed bloquea (ver `pact/support/ci.ts`)

## Referencias

- `software-testing-playground-v2/criteria/F05.json` (v1.1.0 pact gate)
- `software-testing-playground-v2/pact/consumer/F05.consumer.spec.ts` (2 interactions, MatchersV3 regex/type, headers plain)
- `headless-runtime/factory/factoryServer.ts` POST handler (valida modelRef gpt-99 → 400 alternatives)
- `software-testing-playground-v2/pact/provider/verify.ts` stateHandlers F05 (no-op + worktree)
- `software-testing-playground-v2/pact/support/lintPacts.mjs` (F05 2 interactions, valida 201+400)
- `docs/playground-report.md` tabla muestra F05 como `verified` tras p:verify (antes not_generated)
