# Reporte F03 — Worker + logs vivos (SSE)

> **F:** F03 — Ola 3 — Worker que ejecuta + logs vivos (backend + SSE)  
> **Plan:** `factory-local-simple.md` §6 Ola 3  
> **Estado:** Implementado — Playground simula worker + tail + contrato result.json/.done  
> **Fecha:** 2026-08-31  
> **Trazabilidad:** `src/lib/factory/playgroundData.ts` → F03 (`reportPath: docs/wiki Warp/reporte-F03-worker-logs.md`)

---

## 1. Objetivo

Un worker desencola (máx 2 en paralelo), invoca el daemon OpenCode, escribe `logs.ndjson` en streaming y al terminar deja `result.json + .done`. La UI hace `tail -f` vía `GET /factory/jobs/:id/events` (SSE).

Warp análogo: `GET /api/v1/agent/runs/{runId}` (timeline + cost) + followups (§3.9).

---

## 2. Qué se le pasa / qué devuelve

- **Crear:** `POST /factory/jobs { prompt: "escribí hola en result.json", worktree, phase }`
- **Tail vivo:** `GET /factory/jobs/:id/events` → `text/event-stream` con `data: { line, ts }`
- **Qué se le pasa (tail):** `jobId`. El worker ya conoce prompt/worktree del job en disco.
- **Qué devuelve (Warp):** `{ status, cost, timeline, outputs: { prUrl } }`
- **Qué devuelve (Local):** SSE líneas + al final `result.json` parseable + archivo vacío `.done`.
- **Contrato:** Sin `.done`, no pasó (igual que Warp `harness-design-essay.md`).

---

## 3. Reporte humano — pasos

1. Crear job como en F02 con prompt que pide "escribí hola en result.json".
2. `Get-Content C:\tmp\repo-prueba\.agents\factory\<id>\logs.ndjson -Wait` — ver líneas aparecer en vivo.
3. Al terminar verificar `result.json` parseable y `.done` existe. Si ambos + logs crecieron → F03 verde.

**En Playground (F03):** selector de job (viene de F02) → **Iniciar tail en vivo** → panel negro `logs.ndjson` con líneas animadas cada 650 ms → `result.json` preview + indicador `.done`.

---

## 4. Evidencia

- Mock: `appendMockLog()`, `getMockLogs()`, `updateMockJobState()` en `playgroundMock.ts`.
- UI: `F03TestZone` con `setInterval` 650 ms + auto-scroll + estado `running→done`.
- Contrato visible: badge `.done existe ✓` vs `.done aún no existe`.

---

## 5. Veredicto

Pendiente de tester. Guardar en Playground F03 → **Tu veredicto**.

---

## 6. Links trazables

- Plan: `.opencode/plan/factory-local-simple.md` §6 Ola 3
- Data: `src/lib/factory/playgroundData.ts` — `F03`
- UI: `src/components/factory/PlaygroundRightPanel.tsx` → `F03TestZone`
- Reporte (este archivo): `docs/wiki Warp/reporte-F03-worker-logs.md`

## Trazabilidad — Veredictos del tester

> Último veredicto: **FALLO** — 1/9/2026, 01:19:21 — v2 — Commit: `15fece3` — Probar: humano
> Notas: "Mal explicado como ejecutarlo, tenes que aclarar a donde ir y mas detalles que parecen obvios pero no"
> Criterio snapshot: "Tras crear un job, Get-Content logs.ndjson -Wait debe mostrar líneas apareciendo en vivo; al terminar debe existir result.json parseable y archivo .done vacío."
> timeoutMs: 3000
> Tester: humano (localStorage) — Commit: `15fece3`
> Historial:
> - v1 — 2026-09-01 04:18:13 — FALLO — `15fece3` [humano] — "Mal explicado como ejecutarlo, tenes que aclarar a donde ir y mas detalles que parecen obvios pero no" — criterio: "Tras crear un job, Get-Content logs.ndjson -Wait debe mostra…"
> - v2 — 2026-09-01 04:19:21 — FALLO — `15fece3` [humano] — "Mal explicado como ejecutarlo, tenes que aclarar a donde ir y mas detalles que parecen obvios pero no" — criterio: "Tras crear un job, Get-Content logs.ndjson -Wait debe mostra…"

