# Reporte F04 — Panel Factory + Implementar sin terminal

> **F:** F04 — Ola 4 — Panel Central Factory Jobs + botón Implementar sin terminal (frontend crítico)  
> **Plan:** `factory-local-simple.md` §6 Ola 4 y §7 Panel Central Factory  
> **Estado:** Implementado — Playground simula panel Factory completo sin xyflow  
> **Fecha:** 2026-08-31  
> **Trazabilidad:** `src/lib/factory/playgroundData.ts` → F04 (`reportPath: docs/wiki Warp/reporte-F04-panel-implementar.md`)

---

## 1. Objetivo

El botón **Implementar** deja de hacer `pty spawn` y pasa a `POST /factory/jobs`. Un panel **Factory** (sin xyflow, sin canvas) muestra `Queued / Running / Done` con:

- **Ver logs** (drawer SSE live, grep `tool|error`)
- **Cancelar** (`POST /cancel` sin confirmación, como Warp `Stop task`)
- Preview `result.json` + link al `worktree`

No abre terminal. Es el flujo freelance end-to-end y la base para el Figma futuro.

Warp análogo: Dashboard Activity kanban + detail `View session / Event history / Stop task` (§2.11).

---

## 2. Qué se le pasa / qué devuelve

- **Trigger:** Botón **Implementar** → `POST /factory/jobs { prompt: buildIssueResolvePrompt(issue), worktree, phase: implement }`
- **Qué se le pasa:** Issue local (ej `#1 Add Local development to README`) + worktree path + phase `implement`.
- **Qué devuelve (Warp):** Work Item en `Building` + run timeline + branch `factory/<slug>` + acción `Stop task`.
- **Qué devuelve (Local):** Job `Queued→Running→Done` + `logs.ndjson` SSE + `result.json` preview + `README.md` modificado.
- **Señal de éxito:** No se abrió terminal. Job en Done, JSON válido, README tocado.

---

## 3. Reporte humano — pasos (flujo freelance end-to-end con repo de prueba)

1. En `C:\tmp\repo-prueba` creá un issue local (ej `echo "#1 Add Local development to README" > .agents/issues/1.md` o vía UI Issues).
2. En TermCanvas abrí **Factory** (panel central, no canvas) → ves el issue → botón **Implementar**.
3. **NO debe abrirse ninguna terminal.** En Factory ves el job en `Queued → Running` y el contador sube.
4. Click **Ver logs** → drawer con `logs.ndjson` en vivo (grep `tool|error`).
5. Al terminar, el job pasa a `Done`, ves `result.json` preview y el `README.md` en `C:\tmp\repo-prueba` está modificado como pidió el issue.
6. Si todo eso pasa sin terminal, F04 verde. Si abre terminal o no hay `result.json`, frenamos.

**En Playground (F04):** botón **Simular flujo: Implementar issue #1** → crea job `Queued` → a 700 ms `Running` → a 2.2 s `Done` + `result.json`. Filtros `Todos/queued/running/done`, botón **Ver logs** por job (expande panel negro + preview), botón **Cancelar** (sin confirmación, como Warp — pasa a `error`).

---

## 4. Evidencia

- Mock: `createMockJob` + `updateMockJobState` + `appendMockLog` en `playgroundMock.ts`.
- UI: `F04TestZone` en `PlaygroundRightPanel.tsx` — lista max-h 320 px, estado con `animate-pulse` en running, cancel sin modal.
- Ahorro recursos: Playground no monta `CanvasRoot` (ver `App.tsx` → `playgroundActive ? <FactoryPlayground /> : <CanvasRoot />`).

---

## 5. Veredicto

Pendiente de tester. Guardar en Playground F04 → **Tu veredicto**.

---

## 6. Links trazables

- Plan: `.opencode/plan/factory-local-simple.md` §6 Ola 4 + §7
- Data: `src/lib/factory/playgroundData.ts` — `F04`
- UI: `src/components/factory/PlaygroundRightPanel.tsx` → `F04TestZone`
- App: `src/App.tsx` — condicional `playgroundActive`
- Reporte (este archivo): `docs/wiki Warp/reporte-F04-panel-implementar.md`
