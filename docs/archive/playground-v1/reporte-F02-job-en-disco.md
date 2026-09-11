# Reporte F02 — Job en disco

> **F:** F02 — Ola 2 — Job en disco (backend)  
> **Plan:** `factory-local-simple.md` §6 Ola 2  
> **Estado:** Implementado — Playground mock operativo (simula carpeta en localStorage)  
> **Fecha:** 2026-08-31  
> **Trazabilidad:** `src/lib/factory/playgroundCriteria.json` → F02 (`reportPath: docs/wiki Warp/reporte-F02-job-en-disco.md`) — source of truth (ver `src/lib/factory/playgroundData.ts` re-export)

---

## 1. Objetivo

Que `POST /factory/jobs` cree en disco `<repo>/.agents/factory/<id>/` con `job.json + prompt.md + logs.ndjson`. Antes el prompt viajaba por `argv` (cap 28 K, `MAX_PROMPT_ARG_CHARS`) y se truncaba; ahora vive en archivo.

Warp análogo: `POST /factory/{uid}/runs { prompt, ticket_ref } → { runId, taskId }` (§3.9 del reporte Warp).

---

## 2. Qué se le pasa / qué devuelve

- **Request:** `POST http://127.0.0.1:17680/factory/jobs`
- **Body:** `{ "prompt": "hola", "worktree": "C:\\tmp\\repo-prueba", "phase": "diagnosisLlm" }`
- **Qué se le pasa (detalle):** `prompt` (requerido, sin cap), `worktree` (path repo), `phase` (ej `diagnosisLlm`). Equivale a Warp `prompt` + `ticket_ref`. — En PowerShell usa `Invoke-RestMethod -UseBasicParsing -Body '{"prompt":"hola",...}'` o `curl.exe` con `-d "{\\\"prompt\\\":...}"`; no uses `curl` sin `.exe` (alias a Invoke-WebRequest) porque el `-d` con \\\" escapa mal y llega malformado → 400 prompt is required (ver hint en response)
- **Qué devuelve (Warp):** `{ runId, taskId, status: queued|running }`
- **Qué devuelve (Local):** `201` + `{ id, path: "<repo>/.agents/factory/<id>", job: { id, prompt, phase, state: queued } }`
- **Efecto en disco:** carpeta con `job.json` (metadata), `prompt.md` (prompt exacto), `logs.ndjson` (vacío).

**Cómo verificar (determinístico):**

```powershell
# PowerShell (recomendado)
Invoke-RestMethod -UseBasicParsing -Uri http://127.0.0.1:17680/factory/jobs -Method Post -ContentType "application/json" -Body '{"prompt":"hola","worktree":"C:\\tmp\\repo-prueba","phase":"diagnosisLlm"}' | ConvertTo-Json -Depth 5
```

```bash
# cmd / git-bash / curl.exe (doble \\ en worktree para JSON)
curl.exe -X POST http://127.0.0.1:17680/factory/jobs -H "Content-Type: application/json" -d "{\"prompt\":\"hola\",\"worktree\":\"C:\\\\tmp\\\\repo-prueba\",\"phase\":\"diagnosisLlm\"}"
# bash alternative con single quotes:
curl.exe -X POST http://127.0.0.1:17680/factory/jobs -H "Content-Type: application/json" -d '{"prompt":"hola","worktree":"C:\\tmp\\repo-prueba","phase":"diagnosisLlm"}'
# ⚠️ curl sin .exe en PowerShell es alias a Invoke-WebRequest y falla con 400 prompt is required
```

---

## 3. Reporte humano — pasos

1. PowerShell (recomendado): `Invoke-RestMethod -UseBasicParsing -Uri http://127.0.0.1:17680/factory/jobs -Method Post -ContentType "application/json" -Body '{"prompt":"hola","worktree":"C:\\tmp\\repo-prueba","phase":"diagnosisLlm"}' | ConvertTo-Json -Depth 5` — debe responder 201 con `{ id, path, job }`
2. Alternativa cmd / git-bash / curl.exe: `curl.exe -X POST http://127.0.0.1:17680/factory/jobs -H "Content-Type: application/json" -d "{\\\"prompt\\\":\\\"hola\\\",\\\"worktree\\\":\\\"C:\\\\tmp\\\\repo-prueba\\\",\\\"phase\\\":\\\"diagnosisLlm\\\"}"` — en bash podés usar single quotes: `-d '{"prompt":"hola","worktree":"C:\\tmp\\repo-prueba","phase":"diagnosisLlm"}'`. ⚠️ `curl` sin `.exe` en PowerShell es alias a Invoke-WebRequest y falla con 400 prompt is required.
3. Ir a `C:\tmp\repo-prueba\.agents\factory\` y verificar que aparece carpeta con `job.json` y `prompt.md` que contiene "hola".
4. Si ambos existen y el JSON es parseable → F02 verde.

**En Playground (F02):** formulario Prompt / Worktree / Phase → **Crear job de prueba** → muestra `job.json` y `prompt.md` simulados + ruta. Hint arriba del formulario: "En PowerShell usa Invoke-RestMethod (curl es alias). Ver ejemplos en 'Qué se le pasa'." Persiste en `localStorage: factory-playground-mock-jobs`.

---

## 4. Evidencia

- Mock: `src/lib/factory/playgroundMock.ts` → `createMockJob()` + `getMockJobs()`.
- UI: `PlaygroundRightPanel.tsx` → `F02TestZone` (ahora con hint PowerShell + error 400 con hint).
- Server: `headless-runtime/factory/factoryServer.ts` → `POST /factory/jobs` ahora devuelve `{error, hint, received}` si body no es JSON válido o prompt vacío — no más `prompt is required` silencioso.
- Ver `factory-playground-mock-jobs` en DevTools → Application → Local Storage.

---

## 5. Veredicto

Pendiente de tester. Guardar en Playground F02 → **Tu veredicto**.

---

## 6. Links trazables

- Plan: `.opencode/plan/factory-local-simple.md` §6 Ola 2
- Criterio (source of truth): `src/lib/factory/playgroundCriteria.json` → F02 (`humanSteps` + `whatToTest.criterio` + `inputsOutputs`)
- Data re-export: `src/lib/factory/playgroundData.ts` — `F02`
- UI: `src/components/factory/PlaygroundRightPanel.tsx` → `F02TestZone` (hint PowerShell + 400 hint)
- Server: `headless-runtime/factory/factoryServer.ts` → `POST /factory/jobs` (hint + received)
- Reporte (este archivo): `docs/wiki Warp/reporte-F02-job-en-disco.md`

---

## 7. Errores vistos y fix

**Síntoma (flaky):** `curl -X POST http://127.0.0.1:17680/factory/jobs -H "Content-Type: application/json" -d "{\"prompt\":\"hola\",...}"` ejecutado en PowerShell fallaba con `400 {"error":"prompt is required"}` mientras el botón `Crear Job (POST real)` vía `fetch` + `JSON.stringify` sí creaba carpetas en disco (ver tree con 2 jobs). Veredicto quedó `FLAKY` (v2) y antes `FALLO` (v1) con mismo tree.

**Causa:** En PowerShell `curl` es alias a `Invoke-WebRequest`; el `-d "{\"prompt\":...}"` escapa mal — las \\\" no llegan como JSON válido, el body llega malformado, `readBody` hacía `JSON.parse` → catch silencioso → `{}` → validación `prompt is required` genérico sin hint.

**Fix:**

- `playgroundCriteria.json` F02.humanSteps ahora muestra dos ejemplos que sí funcionan: PowerShell `Invoke-RestMethod -UseBasicParsing ... -Body '{"prompt":"hola",...}'` y cmd/git-bash `curl.exe -X POST ... -d "{\\\"prompt\\\":...}"` (con doble \\\\ en worktree) + single quotes para bash, y advierte que `curl` sin `.exe` es alias.
- `PlaygroundRightPanel.tsx` F02TestZone ahora muestra hint arriba del formulario y el error 400 incluye hint: "En PowerShell usa Invoke-RestMethod ... o curl.exe ..." (viene del server).
- `headless-runtime/factory/factoryServer.ts` `readBody` ahora captura `raw` y si `JSON.parse` falla responde `400 {error:"body must be valid JSON", hint:"En PowerShell usa Invoke-RestMethod o curl.exe ...", received: text.slice(0,300)}`; validación de `prompt` vacío también devuelve `hint` + `received` (OCP: solo agrega campo opcional `hint`).

**Cómo validar que F02 ya no es flaky:**

- `Invoke-RestMethod -UseBasicParsing -Uri http://127.0.0.1:17680/factory/jobs -Method Post -ContentType "application/json" -Body '{"prompt":"hola","worktree":"C:\\tmp\\repo-prueba","phase":"diagnosisLlm"}' | ConvertTo-Json -Depth 5` → 201 + carpeta en `C:\tmp\repo-prueba\.agents\factory\<id>` con job.json/prompt.md.
- `curl.exe -X POST ... -d '{"prompt":"hola",...}'` (bash) → 201.
- `curl -X POST ... -d "{\"prompt\":...}"` (PowerShell alias) → ahora `400 {error:"body must be valid JSON", hint:..., received}` útil en vez de solo prompt required.

---

## Trazabilidad — Veredictos del tester

> Último veredicto: **APROBADO** — 1/9/2026, 00:25:49 — v3 — Commit: `15fece3` — Probar: humano
> Notas: "El botón de crear job (POST real) los crea correctamente"
> Criterio snapshot: "Tras POST /factory/jobs, debe existir una carpeta con job.json y prompt.md que contenga exactamente el prompt enviado."
> timeoutMs: 2000
> Tester: humano (localStorage) — Commit: `15fece3`
> Historial:
> - v1 — 2026-09-01 01:33:57 — FALLO — `15fece3` [humano] — "Al ejecutar curl -X POST http://127.0.0.1:17680/factory/jobs -H \"Content-Type: application/json\" -d \"{\\"prompt\\":\\"hola\\",\\"worktree\\":\\"C:\\tmp\\repo-prueba\\",\\"phase\\":\\"diagnosisLlm\\"}\"   falla.  Pero cuando ejecuto con el botón de Crear Job(POST real) si se crean las carpetas con sus respectivos archivos y formatos:  PS C:\tmp\repo-prueba\.agents\factory> tree /F Listado de rutas de carpetas El número de serie del volumen es 000000E6 E4A2:F5EB C:. ├───job-mthzo1cx-9uhu │       .done │       job.json │       logs.ndjson │       prompt.md │       result.json │ └───job-mthzobnv-47mo         .done         job.json         logs.ndjson         prompt.md         result.json  Igualmente hay un bug en la UI del playground de tests donde por ejemplo yo le doy a Crear Job(POST rea" — criterio: "Tras POST /factory/jobs, debe existir una carpeta con job.js…"
>   Output crudo: `PS C:\Users\Estudiante UCU\OneDrive\Escritorio\termcanvas> curl -X POST http://127.0.0.1:17680/factory/jobs -H "Content-`
> - v2 — 2026-09-01 01:35:00 — FLAKY — `15fece3` [humano] — "Corrijo el anterior veredicto, es flaky" — criterio: "Tras POST /factory/jobs, debe existir una carpeta con job.js…"
> - v3 — 2026-09-01 03:25:49 — APROBADO — `15fece3` [humano] — "El botón de crear job (POST real) los crea correctamente" — criterio: "Tras POST /factory/jobs, debe existir una carpeta con job.js…"

