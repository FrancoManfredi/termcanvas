# Reporte F05 — Planning/Tools vía Factory + gate de modelo

> **F:** F05 — Ola 5 — Planning/Tools también vía Factory + gate de modelo  
> **Plan:** `factory-local-simple.md` §6 Ola 5  
> **Estado:** Implementado — Playground simula gate + 2 jobs (tools + diagnosisLlm)  
> **Fecha:** 2026-08-31  
> **Trazabilidad:** `src/lib/factory/playgroundData.ts` → F05 (`reportPath: docs/wiki Warp/reporte-F05-planning-tools.md`)

---

## 1. Objetivo

Migrar `launchToolsSession` y `launchPlanningSession` a `POST /factory/jobs` y validar modelo **antes** de encolar (`validatePhaseAgainstCatalog` → fail fast, no se gastan tokens).

Hoy `gateModeloDeFase` corre después de elegir; con F05 corre **antes** de `POST` y si el modelo no existe devuelve `400` con alternativas. Disparás Diagnóstico → Tools y ves **2 jobs** en Factory (tools + diagnosisLlm) en vez de PTYs dispersos.

Warp análogo: validación de `factory.yaml` antes de schedule + runner por agente (§3.7, §2.7).

---

## 2. Qué se le pasa / qué devuelve

- **Trigger:** Diagnóstico → Tools en plugin del canvas o botón Factory → `2× POST /factory/jobs`
- **Qué se le pasa:** `phase` (`tactics`/`diagnosisLlm`), `modelRef`, `cli` (`opencode`/`codebuddy`/`claude`), `allowedSkills`, `repoPath`.
- **Gate OK:** `201 { id, phase } ×2` — jobs en `Queued`, visibles en Factory.
- **Gate FAIL:** `400 { error: "model not in catalog", alternatives: [...] }` — no se encola, no se gastan tokens.
- **Señal de éxito:** 2 jobs en Factory, cero PTYs, gate rechaza modelo inventado antes de `POST`.

---

## 3. Reporte humano — pasos

1. Con un repo de prueba, dispará Diagnóstico → Tools (vía Factory o comando existente).
2. Verificá en Factory que aparecen 2 jobs (`tools` + `diagnosisLlm`) y ninguno abrió terminal.
3. Intentá encolar con modelo inexistente (ej `gpt-99`) y verificá que el gate lo rechaza con alternativas, sin crear job.

**En Playground (F05):**

- **Gate:** selects Phase / CLI / Modelo (input libre) → **Validar contra catálogo** → badge verde (ok, se puede encolar) o rojo (rechazado + alternativas). Catálogo mock: `opencode: [auto, claude-4-sonnet, claude-4-opus, gpt-5, gemini-2.5-pro]`, `codebuddy: [fast-model, gpt-5, auto]`, `claude: [sonnet, opus, haiku, auto]`.
- **Flujo:** **Disparar Diagnóstico + Tools (2 jobs)** → crea 2 jobs → a 600 ms pasan a `running` con log `gate passed, no PTY`.

---

## 4. Evidencia

- Gate mock: `knownByCli` dict en `F05TestZone` (igual forma que `shared/phaseModels.ts` + `fetchModelCatalog`).
- Jobs: `createMockJob` ×2 en `playgroundMock.ts`.
- UI: `F05TestZone` — dos tarjetas (gate + flujo) con estados y logs.

---

## 5. Veredicto

Pendiente de tester. Guardar en Playground F05 → **Tu veredicto**.

---

## 6. Links trazables

- Plan: `.opencode/plan/factory-local-simple.md` §6 Ola 5
- Data: `src/lib/factory/playgroundData.ts` — `F05`
- UI: `src/components/factory/PlaygroundRightPanel.tsx` → `F05TestZone`
- Reporte (este archivo): `docs/wiki Warp/reporte-F05-planning-tools.md`
