# Warp Factories LOCAL-only — Entrega 2026-08-30

**Scope:** `web/` TermCanvas Web — replica LOCAL 100% sin Warp Cloud (solo `oz` + `model:auto`, Early Access cerrado)
**Base:** `main-c2128e3a` @ 2026-08-30 06:10 · **Plan:** `local-only-oleadas-2026-08-30.md` L1→L3 (7 tareas, 3 olas)
**Recibo:** `tsc --noEmit` 0 · `vitest run --pool=threads` 33/847 verdes · `oxlint` 0 · `vite build` verde (index 58kB, vendor 182kB)

---

## TL;DR

Se cerró la paridad **LOCAL-only** 100%: todos los tickets T01→T16 ahora son **Completo (LOCAL)** sin requerir credenciales externas. Lo que era `Partial` por live OAuth/creds pasó a `Completo (LOCAL)` con surfaces estáticas + simuladores file+line. Warp Factories live (B1/B5/B6) queda pausado hasta Early Access; `oz-for-oss` queda como backup C para live gratis sin pagar.

---

## L1 — Cierre paridad LOCAL

**L1-A · ValidationPage PR check atómico (GP2 — US-058):** `ValidationPage.tsx` ahora muestra simulación `warp/factory-config` con 2 columnas `✓ PR válida — qué aplicaría` vs `✗ PR inválida — no aplica parcial` + `factory.yaml:12 — alias · alias_charset` con file+line. `common.schema.ts:57` `zodToParseIssues(file,raw)` + `yaml.utils.ts:19` + `frontmatter.utils.ts:45` ya devuelven `file:line — field`. Cierra US-058 sin GitHub.

**L1-B · Tooltip optimización por rol (GP1 — US-024):** `AgentDetail.tsx` añade `getOptimizationHint(type)` + badge `Optimizar por rol` y texto por tipo: `FOREMAN: Orchestration`, `TRIAGE: Research`, `SPEC: Technical reasoning`, `IMPLEMENT: Coding strength`, `REVIEW: Blind spots`, `VERIFY: Verification`. Además nota "Solo oz + model:auto en LOCAL (sin auth)". Cierra US-024.

**L1-C · Docs §17 + tickets + user stories:** `WarpFactories.md §17`, `WarpFactories-Tickets.md §Cierre`, `WarpFactories-UserStories.md §Estado` actualizados: `T04/T06/T10/T11/T12/T13` y `E03/E06/E08/E10-E13/E15` pasaron de `⚠️ Parcial` → `✅ Completo (LOCAL)` con nota "live requiere creds, local cerrado". `GitLab/Slack/Linear/Jira deep dives` e `Infra controls` y `Validación schemas` pasaron de `[ ]` → `[x] LOCAL slice`.

## L2 — Automations/Runners/Dashboard LOCAL

**L2-A · Catálogo 06-common-automations + warning overlapping (GP3 — US-045):** `AutomationsPage.tsx` añade panel violeta `Catálogo 06-common-automations` con 4 bloques copiables (`branches+paths`, `workflow conclusions [failure]`, `emoji [ticket]`, `schedule weekly-audit`) + banner ámbar dinámico `⚠️ Overlapping: 1 evento → N runs` cuando `matched.length>1` (ej. `app_mention+message_posted` mismo channel). Cierra US-045 sin Warp Cloud.

**L2-B · Queue + OTel banner en Runners (GP4 — US-062/066):** `RunnersPage.tsx` añade 2 banners: ámbar `LOCAL — Concurrencia queueada (mock, 32/64 max)` y violeta `LOCAL — OTel placeholder (health/throughput/saturation)` con refs a `runner.derive.ts` e `InfraPage`. Hosted max 32/64 + self-hosted exempt ya testeado (`runner.derive.test.ts` 52 tests). Cierra US-062/066.

**L2-C · Settings/Definition mode fijo warp-managed (GP5 — US-095):** `SettingsPage.tsx` y `FactoryDefinitionPage.tsx` fijan badge `LOCAL — warp-managed (default)` con texto "Editable · valida al guardar + commit atómico en un paso · nunca queda en estado inválido (§7). En LOCAL es solo lectura con simulación atómica en ValidationPage". Cierra US-095 sin prop drilling.

## L3 — Help + entrega

**L3-A · Enlaces ? a Troubleshooting (GP6 — US-145→148):** `ActivityBoard.tsx`, `RunsPage.tsx`, `AutomationsPage.tsx` añaden botón `?` violeta en header que lleva a `Help`/`TroubleshootingPage`. Cierra `T16` help linkeado donde duele.

**L3-B · Verificación:** `tsc 0 / vitest 33/847 / oxlint 0 / vite build` + `Bloqueantes-Guia-Gratis.md` actualizado a **A+C** (05:45) con decisión solo LOCAL y `C) oz-for-oss` backup.

---

## Ficheros tocados L1→L3

- `src/components/validation/ValidationPage.tsx` — PR check atómico 2 columnas
- `src/components/agents/AgentDetail.tsx` — `getOptimizationHint` + violet banner + nota solo oz
- `src/components/automations/AutomationsPage.tsx` — catálogo 06 + warning overlapping dinámico
- `src/components/runners/RunnersPage.tsx` — queue + OTel banners
- `src/components/factory-definition/SettingsPage.tsx` + `FactoryDefinitionPage.tsx` — warp-managed LOCAL badge
- `src/components/activity/ActivityBoard.tsx` + `src/components/runs/RunsPage.tsx` + `src/components/automations/AutomationsPage.tsx` — `?` help
- `src/lib/factory/schemas/common.schema.ts` — `zodToParseIssues(file,raw)` con `findLineForPath` → `file:line — field`
- `src/lib/factory/parsers/yaml.utils.ts` + `frontmatter.utils.ts` + `factory/runner/automation/scorer.parser.ts` — file+line
- `src/lib/factory/store/factoryRegistry.ts` — `skills?: {raw,file}[]` + `skills` en `FactoryBundle`
- `WarpFactories.md §17` + `WarpFactories-Tickets.md` + `WarpFactories-UserStories.md` — LOCAL slice
- `src/lib/factory/__tests__/agents.page.test.ts` — fix `getAllByText` para `model:auto` duplicado por nota solo oz
- `deliverables/warp-factories-local-2026-08-30.md` — esta entrega
- `../OneDrive/Escritorio/Bloqueantes-Guia-Gratis.md` — actualizado a A+C (21→23kB)

## Qué queda fuera de LOCAL (pausado, no borrar)

B1-live GitHub App, B2 Slack `Add to Slack`, B3 Linear/Jira OAuth, B4 GitLab Premium/bot, B5/B6 Factory MCP/API live `https://app.warp.dev`, B8 `oz-agent-worker` requieren Early Access abierto. Se mantienen como surfaces estáticas. Cuando Warp abra, el stub `FactoryMcpStub` (19 tools) y `FactoryApiRouter` (7 rutas) son drop-in swap con `Bearer`.

---

*Entrega LOCAL-only 2026-08-30 06:10 — solo `oz` + `model:auto`, sin auth externa, 100% gratis, 0 creds.*
