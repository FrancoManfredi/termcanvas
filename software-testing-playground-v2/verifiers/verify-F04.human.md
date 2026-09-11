# F04 — Panel Factory — Verificación Human (hybrid) — Ola Cancel

> **Ola 5 + Ola Cancel — hybrid Pact + human** — `software-testing-playground-v2/criteria/F04.json` define `verifier.kind: "pact-hybrid"`
> Parte Pact (Ola Cancel, 2 interactions): `pact/consumer/F04.consumer.spec.ts` → `pacts/playground-F04-FactoryProvider.json` valida:
>   - `GET /factory/jobs` (listado panel) con providerState "factory has jobs"
>   - `POST /factory/jobs/:id/cancel` → 200 `{ok:true, state:"error"}` con providerState "a cancellable job exists" (asegura queued, no 409 flaky, body {} y Content-Type plain)
> Parte Human: este checklist valida UI del Panel Factory sin abrir terminal, filtros Queued/Running/Done y tail vivo SSE/logs. **Cancelar ya no es human** — está pacteado.
> Ver arquitectura: `software-testing-playground-v2/docs/architecture-pact-v2.md` §3.3 (F03 hybrid aplica igual) + `factoryServer.ts` POST /cancel handler.

## Precondiciones

- Factory daemon corriendo en `127.0.0.1:17680-17690` (`pnpm dev` en otra PowerShell)
- Commit limpio (`git status --porcelain` vacío) o `dirty-` si es dev
- Pacts generados (`pnpm p:consumer` → `Get-ChildItem software-testing-playground-v2\pacts\ | Format-Table`) — F04 debe tener 2 interactions (lista + cancel)
- Lint PASS (`pnpm p:lint`) — F04 espera exactamente 2 interactions, con POST /cancel y sin 409

## Checklist human (Ola Cancel — sin Cancelar, ahora pacteado)

> **Cambio Ola Cancel:** Antes este checklist tenía 3 pasos incluyendo "Probar Ver logs + Cancelar sin abrir terminal". Ahora Cancel está pacteado (POST /cancel con providerState que asegura queued), por lo que el paso humano se reduce a filtros + tail vivo. Cancel se valida automáticamente via `pnpm p:verify -- F04`.

### 1. Encolar issue #1 (POST real) → Ver en lista Queued (Pact lista)

```
# En UI:
- Abrir FactoryPlayground (App → Playground)
- Ir a F04TestZone (Panel Factory) — o FeatureCard F04 en PlaygroundPage
- Click "Encolar issue #1" (usa POST /factory/jobs real, no PTY, no localStorage)
- Verificar: nuevo job aparece en columna/lista "Queued" con id job-... y prompt visible
- Pact lo valida: GET /factory/jobs → 200 { jobs: [...] } con providerState "factory has jobs"
```

```powershell
# PowerShell equivalente (para comparar sin UI):
$body = @{ prompt="playground-F04-$(Get-Random)"; worktree="C:\tmp\playground-F04-test"; phase="diagnosisLlm"} | ConvertTo-Json
Invoke-RestMethod -UseBasicParsing -Uri http://127.0.0.1:17680/factory/jobs -Method Post -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 5
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/jobs | ConvertTo-Json -Depth 6
```

**Criterio pass:** job aparece en GET /factory/jobs con `state: "queued"` y en panel Queued.

### 2. Esperar transición queued → running → done (ver logs tail real)

```
# En UI:
- Tras encolar, observar que job pasa a Running en ~700ms y a Done en ~2200ms (stub timings de factoryServer.ts)
- Abrir "Ver logs" → debe mostrar tail vivo (append cada ~700ms, no datos inventados)
- FeatureCard F04 ahora muestra contrato de cancel pacteado en azul, pero tail vivo sigue siendo human
```

```powershell
# PowerShell — polling hasta done (ver sseHelper.ts):
$id = "job-xxx"  # copiar id del paso 1
for ($i=0; $i -lt 20; $i++) {
  $j = Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/jobs/$id
  Write-Host "$($j.state) logs=$($j.logs.Count)"
  if ($j.state -eq "done") { break }
  Start-Sleep -Milliseconds 400
}
# Logs en disco:
Get-Content C:\tmp\playground-F04-test\.agents\factory\$id\logs.ndjson
Get-Content C:\tmp\playground-F04-test\.agents\factory\$id\logs.ndjson -Wait  # tail vivo (Ctrl+C para salir)

# SSE vivo (Pact solo valida handshake en F03; F04 human valida tail):
curl.exe --silent -H "Accept: text/event-stream" http://127.0.0.1:17680/factory/jobs/$id/events --max-time 5
```

**Criterio pass:** logs.ndjson crece, result.json y .done existen al llegar a done, SSE emite `data: { line, ts }`.

### 3. Probar filtro Queued/Running/Done y Ver logs sin abrir terminal (Cancel ya pacteado)

```
# En UI:
- Cambiar filtro a Queued / Running / Done → lista filtra correctamente (no muestra running en Queued, etc.)
- En un job Done, click "Ver logs" → GET /factory/jobs/:id/logs real, no mock localStorage
- Verificar cero PTYs abiertos (no se ejecuta powershell/bash, solo fetch HTTP)
- Nota Ola Cancel: El botón "Cancelar" ahora está cubierto por Pact (POST /factory/jobs/:id/cancel → 200 error).
#  No hace falta checklist humano para Cancelar — se verifica vía `pnpm p:verify -- F04`.
#  El viejo botón Cancelar en UI archivada (docs/archive/playground-v1) ya no existe;
#  el nuevo FeatureCard F04 muestra explícitamente el contrato POST /cancel en la card (panel azul).
```

```powershell
# PowerShell — Cancelar ahora pacteado (no human, validado por Verifier con stateHandler "a cancellable job exists"):
Invoke-RestMethod -UseBasicParsing -Uri http://127.0.0.1:17680/factory/jobs/job-f04-cancel01/cancel -Method Post -ContentType "application/json" -Body "{}" | ConvertTo-Json
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/jobs/job-f04-cancel01 | ConvertTo-Json -Depth 5
# Debe responder 200 { ok:true, state:"error" } — si responde 409 ya done/error es flaky y el stateHandler debe asegurar queued

# Verificar cero PTY: no debe haber node-pty spawn para este flujo (revisar logs de Factory, no debe haber "pty")
```

**Criterio pass:** Filtros funcionan, Ver logs trae logs reales del daemon, cero PTYs. Cancel se considera pass si `pnpm p:verify -- F04` pasa (2 interactions OK).

## Evidencia para verdict

- Si todo pasa, ejecutar: `pnpm p:verify -- F04` (valida Pact HTTP lista+cancel) + marcar este checklist como pass manualmente en HumanVerdictForm (3 checks, pero el tercero ya aclara "Cancel ya pacteado")
- Verdict se escribe en `verdicts/F04/<ulid>.json` con `providerResult.pass` + `humanChecklist: pass` (el formulario pide evidencia ≥10 chars, ej `GET /jobs → 200 + POST /cancel 200 + tail -Wait`)
- `state.json` derivará `F04: verified` solo si Pact + human pass; si solo Pact pass sin human queda `mock_only` (ámbar rayado)
- Lint: `pnpm p:lint` debe PASS — F04 con 2 interactions, headers plain, sin 409

## Pact relacionado (Ola Cancel)

- `pacts/playground-F04-FactoryProvider.json` — contrato `GET /factory/jobs` (lista) + `POST /factory/jobs/:id/cancel` (cancel)
- Provider state handlers:
  - `factory has jobs` (crea job vía POST antes de verificar lista)
  - `a cancellable job exists` (crea job queued vía POST con id determinístico `job-f04-cancel01`, deja en queued sin esperar a done, para evitar 409)
- Request cancel: `POST /factory/jobs/job-[a-z0-9\-]+/cancel` (regex `^/factory/jobs/job-[a-z0-9\-]+/cancel$`), headers `Content-Type: application/json`, body `{}`
- Response cancel: `200 { ok: true, state: "error" }` (MatchersV3: `like(true)` para ok, `regex("^error$")` para state, `regex(jobId)` para id) — nunca 409

## Si falla

- Revisar Factory logs: `Get-Content $HOME/.termcanvas/factory-port` + `Invoke-RestMethod .../factory/health`
- Revisar pacts lint: `pnpm p:lint` — debe mostrar F04 2 interactions OK
- Revisar p:verify output diff: `Get-Content software-testing-playground-v2/verdicts/F04/*.json | ConvertFrom-Json | ConvertTo-Json -Depth 10`
- Si cancel da 409 `job already done/error`, es flaky: el stateHandler no aseguró queued — revisar `ensureCancellableJob` en `pact/provider/verify.ts` (no debe esperar a done)
