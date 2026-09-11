# MASTER PLAN — Modularización definitiva (alta cohesión / bajo acoplamiento)
### Despiezar el God server + cerrar las 5 fricciones + todo el sistema modular

> **Estado:** guía vigente desde 2026-09-04. Complementa los planes Factory/Paridad/E2E; no los reemplaza.
> **Origen:** auditoría de modificabilidad (6 escenarios medidos) + re-auditoría post-refactor ①+③. Diseño del arquitecto, ejecución por fases con QA.
> **Objetivo:** que cambiar algo sea muchísimo más fácil: un concepto un registro, un artefacto un escritor, una vista una proyección, un cliente una red.
> **Reglas que rigen:** las 8 de los master plans + contrato de contribución de 10 reglas (C1 ESM/cotas, C2 funciones puras fail-safe, C3 un escritor validado+atómico, C4 disco best-effort, C5 aditivo, C6 vocabulario único, C7 nada duplicado, C8 rutas en tabla, C9 builders puros testeables, C10 trazabilidad + test antes de borrar). Si una fase viola una, QA da FAIL.

---

## 1. Mapa target (lista cerrada + lista blanca por módulo)

Nada fuera de esta lista se crea. Import fuera de la lista blanca = violación (test de barrido).

- `shared/roles.ts` (NUEVO): única fuente de roles (agente/sesión/tools/scorer) + predicados puros. Solo importa tipos de `shared/`. Lo importan: agentLoader, agentSessions, toolPolicy, workItemStore, scorerLoader/Engine, definitionValidate, types/scorer+workItem. Nadie más.
- Dominios bajo `headless-runtime/factory/`: `jobs/` (ciclo de vida + job.json/prompt.md), `review/` (humano+auto), `triageSpec/` (respond/approve), `verify/` (get/retry + verify.json), `measure/` (scorers/benchmarks/improvement, jamás auto-adopta), `notifications/` (centro+ack), `definition/` (status para badge), `health/` (buildId/contadores), `intake/` (MVP ping inocuo + allowlist, jamás prompt crudo), `routing/` (tabla + parsers puros, cero negocio), `loaders/` (loadSpec genérico + runners + validación).
- El `factoryServer.ts` queda cascarón: arranque, bind, tabla, delegación, CORS/SSE. Cero negocio nuevo tras F2.
- `review/reviewModelSelector.ts`: única tabla proveedor→revisor + fallback builder-aware (H-006 imposible por construcción). Nadie elige revisor a mano.
- `src/lib/factoryClient.ts` (NUEVO): único cliente HTTP del renderer (discovery, timeouts, formas defensivas). Espejos `*Ui.ts` importan tipos de `shared/`, no redefinen.
- Fin del Map dual: una tienda `workItemStore`, una proyección `jobView`, un escritor `resultStore`. Muerte del Map `jobs`, `writeJobJson`-escritor, ramas legacy, `ensureResultJson`, `resultWriter` público, variante C, `tools:{}` restantes, espejos renderer, stales `ubuntu`, fallback legacy (cada uno con test de uso-cero + rollback por `git revert`).
- UI consume vista única: se borra la reconciliación cliente solo cuando el server demuestre vista única en los 4 estados (completo, Review, Triage-setup-fail, sin result.json).

## 2. Fases

### FASE 1 — Tabla de rutas + roles único + cliente esqueleto + fricciones chicas
- Crea: `shared/roles.ts`, `factory/routing/routeTable.ts`, `routeParsers.ts`, `src/lib/factoryClient.ts`, suites `route-table`, `shared-roles-single-source`, `import-sweep-roles`, `factory-client-contract`.
- E1: roles + routing + bloques nombrados de rutas en server. E2: factoryClient + delegaciones de rol (toolPolicy, agentSessions, types/scorer, agentLoader, definitionValidate, workItemStore) + quitar allowlist `linux-build` de RunnerService (delega en `getRunner` genérico).
- DONE: tests + tsc 0 + QA PASS + vivo (E2E-14, E2E-11, E2E-10) tras restart usuario.

### FASE 2 — Despiece del loop: jobs + review + triageSpec + verify
- Crea dominios `jobs/`, `review/`, `triageSpec/`, `verify/` + 5 suites de dominio + barrido. Server de a UN ingeniero por vez (E1 jobs+verify, luego E2 review+triageSpec).
- DONE + vivo (E2E-01, E2E-05, E2E-03, E2E-02, E2E-04 condicional).

### FASE 3 — Medida + soporte + loaders + intake blindado
- Crea `measure/` (3 rutas), `notifications/`, `definition/`, `health/`, `intake/` + `loaders/` + 6 suites + tabla proveedor→revisor única.
- DONE + vivo (E2E-08, E2E-10, E2E-11, E2E-12, E2E-13; H-010 por timestamps).

### FASE 4 — Entierro + vista única + barrido final
- Borra (con test de uso-cero previo cada uno): Map dual, escritor legacy, ramas legacy, jubilados, variante C, `tools:{}` restantes, espejos renderer, stales. Suites `import-sweep-final`, `legacy-zero-use`, `jobview-single`, `resultstore-single-writer`.
- DONE final + vivo completo.

## 3. Reparto sin solape (regla de hierro por fase)
`factoryServer.ts` con bloques nombrados, de a UN ingeniero por vez (el orquestador serializa). E1 = daemon/workItem/implement/server-bloques; E2 = runner/tools/UI/loaders. Contratos entre partes por escrito (firmas en prosa) antes de codificar. Ningún archivo con dos escritores.

## 4. Riesgos
Pacts F01–F14 (gate por id, nunca Review en pact), polling 2.5s/5s/30s (cero intervalos nuevos), ~30 endpoints con formas exactas + alias dual (C8, tests duales), `.done`/`result.json`/`verify.json` (escritor único + predicado rico), restart SOLO por el usuario (H-011: prohibido tocar el daemon), builders MVP sin prompt crudo, roles/runners/providers sin literales nuevos.

## 5. Fuera de alcance
Ola 14, features nuevas, pulido UI, H-005, cambios de producto/semántica (thresholds, budgets, sampling, auto-adopt).

## 6. Bitácora (append-only)
- 2026-09-04 — Plan creado (diseño arquitecto). Fases 1→4. Origen: auditoría modificabilidad + re-auditoría post-①③.
- 2026-09-04 — FASE 1 cerrada (E1 roles+routing + E2 factoryClient+delegaciones+runner genérico + QA PASS 674/674, tsc 0). Conocido: `agent-sessions-migration` cuelga preexistente-ambiental (H-005). Vivo pendiente de restart usuario (E2E-14/11/10).
- 2026-09-04 — FASE 2 cerrada (E1 dominios jobs+verify + E2 review+triageSpec + QA PASS 723/723, tsc 0; micro-fix orquestador routeTable en FOR_EXEMPT + token review-retry). Vivo pendiente (E2E-01/05/03/02/04).
- 2026-09-04 — FASE 3 cerrada (E1 measure+tabla revisor + E2 notify/definition/health/intake/loaders + QA PASS 773/773, tsc 0). Server = tabla+delegación en todos los dominios. Vivo pendiente (E2E-08/10/11/12/13).
- 2026-09-04 - FASE 4 cerrada (E1 entierro parcial + E2 renderer parcial + QA PASS 870/870, tsc 0) - PLAN COMPLETO. Borrado real + devoluciones con evidencia y barridos (Map jobs, writeJobJson, variante C, espejos UI). Deuda explicita.
- 2026-09-04 - TANDAS 1-3 anti-God cerradas (QA PASS 963/963, tsc 0): T1 Map+writeJobJson muertos 55/55 + T2 create/retry/logs a dominios + T3 yaml+1 panel. Server 4010 (-581 vs 4591). writeJobJson = 0, jobs = 0, ubuntu en codigo = 0. Veredicto: el God dejo de decidir.
- 2026-09-04 - TANDA C cerrada (dispatch 29 ramas a 1 matchRoute + switch 35 casos + QA PASS, rojo provider-reviewer-table arreglado por QA como test fragil): punto unico de dispatch, codigo 2820 a 2803 (-17). Server 3575 total. Pendiente Tanda D (sesiones/restore/SSE con daemon vivo).
- _(siguientes acá)_
