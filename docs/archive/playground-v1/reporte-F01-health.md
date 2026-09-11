# Reporte F01 — Servidor único + health

> **F:** F01 — Ola 1 — Servidor único + health (backend)  
> **Plan:** `factory-local-simple.md` §6 Ola 1  
> **Estado:** Implementado — Playground disponible (mock + real si el daemon corre)  
> **Fecha:** 2026-08-31  
> **Trazabilidad:** `src/lib/factory/playgroundCriteria.json` → F01 (`reportPath: docs/wiki Warp/reporte-F01-health.md`) — source of truth (ver `src/lib/factory/playgroundData.ts` re-export)

---

## 1. Objetivo

Reemplazar el arranque efímero de `opencode serve` por fase (30 s, puerto random, 2 retries) por **un solo daemon persistente** en `127.0.0.1:17680` que arranca con TermCanvas.

| Concepto | Hoy (sin F01) | Con F01 |
|---|---|---|
| Arranque | Por fase, random 20k–45k, 30 s | Una vez al iniciar la app |
| Puerto | Aleatorio | Fijo `17680` (con fallback si está ocupado) |
| Observabilidad | Ninguna | `GET /factory/health → { queue: { pending, running } }` |

Inspirado en Warp: `GET /api/v1/factory?search=` y `GET /api/v1/factory/{uid}` (ver `REPORTE-TermCanvas-Factory-Local.md` §3.9).

---

## 2. Qué se le pasa / qué devuelve

- **Request:** `GET http://127.0.0.1:17680/factory/health`
- **Qué se le pasa:** Nada. Equivale a Warp `GET /api/v1/factory` sin `search`. — Tip PowerShell: `Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json` o `curl.exe --silent http://127.0.0.1:17680/factory/health` (`curl` sin `.exe` es alias a Invoke-WebRequest)
- **Qué devuelve (Local):** `200` + `{"queue":{"pending":0,"running":0}}`
- **Qué devuelve (Warp análogo):** `{"factories":[{"uid","name","alias"}]}`
- **Contrato:** JSON parseable en < 500 ms. Criterio PASS: `status 200 && queue.pending/running && <500 ms`. Si no hay servidor → `ECONNREFUSED` y la UI lo reporta sin romper.

**Cómo verificar (determinístico):**

```powershell
# PowerShell (recomendado)
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json
# alternativa (cmd / git-bash / PowerShell con binario real)
curl.exe --silent http://127.0.0.1:17680/factory/health
# ⚠️ curl sin .exe en PowerShell es alias a Invoke-WebRequest → muestra StatusCode/RawContent
```

---

## 3. Reporte humano — pasos que ejecutó el tester

1. Abrí TermCanvas (o `pnpm dev`) para levantar el daemon Factory en `127.0.0.1:17680`.
2. PowerShell (recomendado): `Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json` — debe responder `{"queue":{"pending":0,"running":0}}` en <500 ms. Alternativa: `curl.exe --silent http://127.0.0.1:17680/factory/health`
3. ⚠️ En PowerShell `curl` solo (sin `.exe`) es alias a Invoke-WebRequest y muestra StatusCode/RawContent en vez de JSON — usá `curl.exe` o `Invoke-RestMethod`. Si ves JSON con queue.pending/running, F01 verde; si da ECONNREFUSED, falló.

**Evidencia en Playground (F01):** botón **Probar health** hace `fetch` real; si el daemon no está, muestra payload mock y marca `Simulado` para no bloquear. El bloque de código muestra el JSON.

---

## 4. Evidencia

- Playground: `FactoryPlayground` → F01 → **Probar health** → bloque `GET /factory/health → real|simulado`.
- Código: `src/lib/factory/playgroundMock.ts` → `mockHealthPayload()` lee `factory-playground-mock-jobs` de localStorage para `pending/running`.
- Criterio source: `src/lib/factory/playgroundCriteria.json` → F01 `humanSteps` (actualizado para distinguir curl vs curl.exe)

---

## 5. Veredicto

Pendiente de tester. Usar el selector **Tu veredicto** en el Playground (F01) y guardar `Aprobado / Falló / Pendiente` + notas. Persiste en `localStorage: factory-playground-verdicts`.

---

## 6. Links trazables

- Plan: `.opencode/plan/factory-local-simple.md` §6 Ola 1
- Criterio (source of truth): `src/lib/factory/playgroundCriteria.json` → F01 (`humanSteps` + `whatToTest.criterio`)
- Data re-export: `src/lib/factory/playgroundData.ts` — `PLAYGROUND_FS[0]` (`F01`)
- UI: `src/components/factory/PlaygroundRightPanel.tsx` → `F01TestZone` (ahora con bloque PowerShell / curl.exe determinístico)
- Server: `headless-runtime/factory/factoryServer.ts` → `GET /factory/health`
- Script CI: `scripts/verify-F01.mjs` (ahora con tip PowerShell al final)
- Reporte (este archivo): `docs/wiki Warp/reporte-F01-health.md`

---

## 7. Errores vistos y fix

**Síntoma (flaky):** En PowerShell `curl http://127.0.0.1:17680/factory/health` mostraba un objeto PowerShell con `StatusCode, StatusDescription, Content, RawContent, Headers...` y warning `Invoke-WebRequest analiza el contenido...` en vez del JSON pretty que devuelve el botón `fetch` en la UI. El veredicto quedó `APROBADO_CON_RESERVAS` / `FLAKY` por esta confusión.

**Causa:** En PowerShell `curl` es alias a `Invoke-WebRequest`, no al binario curl real. El output es un objeto, no texto crudo.

**Fix:**

- `playgroundCriteria.json` F01.humanSteps ahora distingue: PowerShell recomendado `Invoke-RestMethod -UseBasicParsing ... | ConvertTo-Json` y alternativa `curl.exe --silent ...`, y advierte que `curl` solo es alias.
- `PlaygroundRightPanel.tsx` F01TestZone ahora muestra bloque CodeBlock con ambas variantes (PASS visible: `status 200 && queue.pending/running && <500`) tanto en éxito como en error / waiting.
- `scripts/verify-F01.mjs` ahora loggea al final `Tip PowerShell: curl es alias — usa curl.exe --silent ... o Invoke-RestMethod ...`.

**Cómo validar que F01 ya no es flaky:**

- `node scripts/verify-F01.mjs` → PASS con tip.
- `curl.exe --silent http://127.0.0.1:17680/factory/health` → JSON parseable.
- `Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json` → mismo JSON.

---

## Trazabilidad — Veredictos del tester

> Último veredicto: **APROBADO_CON_RESERVAS** — 31/8/2026, 22:23:54 — v2 — Commit: `15fece3` — Probar: humano
> Notas: "Pasa si pero me parece raro que cuando ejecuto el curl http://127.0.0.1:17680/factory/health en powershell me da algo diferente al output que devuelve el probar health"
> Output crudo:
> ```
> PS C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas> node scripts/verify-F01.mjs
> [verify-F01] Criterio: GET /factory/health debe responder JSON con { queue: { pending, running } } en < 500 ms. Si devuelve ECONNREFUSED, la ola falló.
> [verify-F01] timeoutMs=500 — expected {queue:{pending:number, running:number}} — leyendo C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas\src\lib\factory\playgroundCriteria.json
> [verify-F01] GET http://127.0.0.1:17680/factory/health
> [verify-F01] Intento 1/3: HTTP 200 OK — 74ms — queue valid: true — <500 PASS — {"queue":{"pending":0,"running":0},"uptime":17892909,"version":"local","ts":"2026-09-01T01:21:25.873Z"}
> [verify-F01] ✅ PASS — HTTP 200 — 74ms < 500ms — queue pending=0 running=0 — intentos 1/3
> PS C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas> curl http://127.0.0.1:17680/factory/health
> 
> Advertencia de seguridad: riesgo de ejecución de script
> Invoke-WebRequest analiza el contenido de la página web. El código de script de la página web se puede ejecutar cuando se analiza la página.
>       ACCIÓN RECOMENDADA:
>       Usa el modificador -UseBasicParsing para evitar la ejecución de código de script.
> 
>       ¿Quieres continuar?
> 
> [S] Sí  [O] Sí a todo  [N] No  [T] No a todo  [U] Suspender  [?] Ayuda (el valor predeterminado es "N"): O
> 
> 
> StatusCode        : 200
> StatusDescription : OK
> Content           : {"queue":{"pending":0,"running":0},"uptime":17931341,"version":"local","ts":"2026-09-01T01:22:04.305Z"}
> RawContent        : HTTP/1.1 200 OK
>                     Access-Control-Allow-Origin: *
>                     Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
>                     Access-Control-Allow-Headers: Content-Type
>                     Connection: keep-alive
>                     Keep-Alive: timeout=5
>                     T...
> Forms             : {}
> Headers           : {[Access-Control-Allow-Origin, *], [Access-Control-Allow-Methods, GET,POST,PUT,DELETE,OPTIONS], [Access-Control-Allow-Headers,
> ```
> Veredicto: "Pasa si pero me parece raro que cuando ejecuto el curl http://127.0.0.1:17680/factory/health en powershell me da algo diferente al output que devuelve el probar health"
> Criterio snapshot: "GET /factory/health debe responder JSON con { queue: { pending, running } } en < 500 ms. Si devuelve ECONNREFUSED, la ola falló."
> timeoutMs: 500
> Tester: humano (localStorage) — Commit: `15fece3`
> Historial:
> - v1 — 2026-08-31 20:24:45 — APROBADO — "Ahora mismo da el siguiente resultado cuando ejecuto el comnado:  PS C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas> curl http://127.0.0.1:17680/factory/health  Advertencia de seguridad: riesgo de ejecución de script Invoke-WebRequest analiza el contenido de la página web. El código de script de la página web se puede ejecutar cuando se analiza la página.       ACCIÓN RECOMENDADA:       Usa el modificador -UseBasicParsing para evitar la ejecución de código de script.        ¿Quieres continuar?  [S] Sí  [O] Sí a todo  [N] No  [T] No a todo  [U] Suspender  [?] Ayuda (el valor predeterminado es \"N\"): S   StatusCode        : 200 StatusDescription : OK Content           : {\"queue\":{\"pending\":0,\"running\":0},\"uptime\":49157,\"version\":\"local\",\"ts\":\"2026-08-31T20:24:02.121Z\"
> - v2 — 2026-09-01 01:23:54 — APROBADO_CON_RESERVAS — `15fece3` [humano] — "Pasa si pero me parece raro que cuando ejecuto el curl http://127.0.0.1:17680/factory/health en powershell me da algo diferente al output que devuelve el probar health" — criterio: "GET /factory/health debe responder JSON con { queue: { pendi…"
>   Output crudo: `PS C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas> node scripts/verify-F01.mjs`

