# Warp Factories — Reporte Final de Entrega

**Fecha:** 2026-08-30
**Scope:** `web/` package de TermCanvas (Vite + React 19 + TS 6 + Tailwind v4)
**Rama base:** `main` @ `d64cdf3f` · Worktree `workbuddy/main-c2128e3a`
**Diseño:** `web/docs/INCREMENTAL-DESIGN.md` (1.060 líneas, 5 tareas T-A..T-E en 4 olas)
**Spec:** `WarpFactories.md` (19 secciones) + `WarpFactories-UserStories.md` (155 US) + `WarpFactories-Tickets.md` (16 tickets)

---

## Resumen ejecutivo

Se completó de forma autónoma el cierre de las **4 olas (T-A..T-E)** definidas por el arquitecto y auditadas por el Delivery Director.

- **W0 T-A (13 pts) — Infra, nav única, ErrorBoundary e higiene H1–H21:** ✅ completa. `nav.ts` como única fuente de verdad, `App.tsx` con `switch` exhaustivo + `assertNever`, `ErrorBoundary`, `Sidebar` con lista real de factories y `+ Add factory` activo, `vitest` en `pool: threads`, `.oxlintrc.json` limpios, tema claro coherente, `ActivityBoard` con `includeTerminals` vivo (US-102).
- **W1 T-B (13 pts) — Factory CRUD + alias + una policy + persistencia:** ✅ completa. Dominio puro `factory.record.ts`/`factory.policy.ts`, puerto `storage.port.ts` (DIP), store `factoryWorkspace.store.ts` con seed idéntico a `WorkItemStore`, hooks `useFactories.ts`, diálogo `NewFactoryDialog` (1 campo obligatorio + disclosure de alias), glosario `FactoryGlossary`, `addKnownFactories()` aditivo (R3), `toSummaries()` para G2.
- **W2 T-C (8 pts) — GitHub dual-label routing ∥ T-D (8 pts) — Factory API + Agent API:** ✅ completas en paralelo. `github.routing.ts` (5 checks, sin tocar `automation.engine.ts` por OCP) + `github.routing.derive.ts` (20 eventos, 12 filtros “Appears on”) + `GitHubRoutingPage` con traza por check. `factoryApi.types.ts`/`factoryApi.router.ts`/`factoryApi.routes.ts`/`factoryApi.snippets.ts` + `FactoryApiPage` (curl + OzAPI Python, mismos paths que Warp).
- **W3 T-E (8 pts) — Quickstart wizard 7 pasos + cierre documental:** ✅ completa. `quickstart.wizard.ts` (reducer puro, `implement` ON, máx 2 repos, alias sigue a name) + `quickstart.data.ts` (verbatim 186 chars) + `useQuickstart.ts` (orquesta `workspace.create` → `select` → `addKnownFactories` → `workItemStore.create` → navega a `Activity`) + `QuickstartWizard.tsx` con reseña viva.

Las **slices locales** de los 16 tickets están demoables y verificadas. Las partes marcadas **Parcial** corresponden a integraciones live que requieren credenciales externas y están bloqueadas por diseño (ver Bloqueantes).

---

## Validación global — recibo verificable

Ejecutado en `web/` sin mocks de red, sin `Math.random`, con reloj/ID inyectables donde aplica:

```
tsc --noEmit              → 0 errores
vitest run --pool=threads → 33 archivos / 847 tests verdes (Duration ~15–20s)
oxlint                    → 0 warnings / 0 errores (158 archivos, ignorePatterns dist-verify/**, dist/**, node_modules/**)
vite build                → verde (chunks: index ~54 kB, vendor ~182 kB, anim ~133 kB, parse ~183 kB)
```

- Antes del trabajo: 804 tests (76s, colgado en `forks`). Con `pool: threads` y la higiene aplicada: **847 tests** con 44 nuevos (factoryWorkspace, github.routing, factoryApi, quickstart, y corrección de `run.derive` para misma-ms).
- Corrección aplicada en esta sesión: `run.derive.test.ts:17` era flaky si `create` y `transition` caían en el mismo ms (sort por `at` intercambiaba `evt_<timestamp>` vs `evt_wi_<timestamp>`); ahora verifica `history` directamente y aserciones agnósticas al orden.
- `WarpFactories.md §17` corregido: Factory MCP 19 tools y Benchmarks v1 ya estaban hechos (447 + 392 LOC y 278 LOC de tests respectivamente) y ahora figuran como `[x]`; el conteo pasó de 501 a **847 tests**.

**Limitación de herramientas registrada:** Playwright MCP y debugger MCP no estuvieron disponibles en esta sesión. La validación web se hizo con `jsdom` + `vitest` + smoke manual de navegación; se consigna como limitación, no como bloqueante de producto.

---

## Tickets T01–T16 — estado, entrega y validación

| Ticket | Puntos | Estado final | Entrega demoable (evidencia) | US cubiertas | Validación |
|---|---|---|---|---|---|
| **T01** Prefactor | 8 | **Complete** | `vite.config.ts`, `src/main.tsx` (StrictMode → WorkItemStoreProvider → FactoryWorkspaceProvider → App), `src/nav.ts`, `src/components/ErrorBoundary.tsx`, `src/index.css` tokens, 33 tests green | Infra transversal | `tsc` + `oxlint` 0 + `build` |
| **T02** Factory Core | 8 | **Complete** | `factory.record.ts`, `factory.policy.ts`, `storage.port.ts`, `factoryWorkspace.store.ts` + `FactoryWorkspaceProvider`, `useFactories.ts`, `NewFactoryDialog`, `FactoryGlossary`, `Sidebar` con lista real, `+ Add factory` → Dashboard | US-001, 002, 005, 006, 048, 052 | `factoryWorkspace.test.ts` (Gherkin alias, duplicado case-insensitive, longitud, two_policies) + persistencia |
| **T03** Work Item lifecycle | 13 | **Complete (slice)** | `workItem.machine.ts`, `workItem.rules.ts`, `workItem.store.ts` (`addKnownFactories`), `ActivityBoard/Card/Detail` con `Stop task` sin confirmación y `includeTerminals` toggle (US-102) | US-003, 007–016 | `workItem.machine.test.ts`, `workItem.store.test.ts`, `workItem.rules.test.ts` (skip logic, gates) |
| **T04** Agentes | 8 | **Partial** | `schemas/agent.schema.ts`, `parsers/agent.parser.ts`, `store/factoryRegistry.ts` (exactly-one-foreman), `components/agents/*`, `hooks/useFactoryBundle.ts` (7 agentes) | US-017–027 | Superficie presente; harness/provider workflows requieren credenciales (ver Bloqueantes) |
| **T05** Skills | 5 | **Complete (registry)** | `domain/skill.registry.ts` (251 LOC), `skill.registry.test.ts`, `SkillsPage` | US-028–033 | Registry global vs per-agent verificado |
| **T06** Definitions as Code | 13 | **Partial** | 6 schemas `.strict()`+`superRefine`, 5 parsers, `factoryRegistry.parseBundle`, `validation.derive`, `ValidationPage` | US-046–059 | Parsers/schemas green; PR check atómico `warp/factory-config` es mock (sin GitHub) |
| **T07** Automations Engine | 13 | **Complete (slice)** | `automation.engine.ts` (AND filtros / OR valores, `in`/`not_in`, schedule), 3 presets, `AutomationsPage` | US-034–045, 074–075 | `automation.engine.test.ts` (393 LOC) intacto por OCP |
| **T08** Runners | 5 | **Complete (slice)** | `runner.derive.ts` (32 vCPU/64 GiB, `ALLOWED_MAC_VERSIONS`, `validateRunner*`), `RunnersPage/RunnerDetail` | US-055, 060–066 | 350 LOC tests runners + Env vs Runner vs Host |
| **T09** GitHub dual-routing | 13 | **Complete (local)** | `github.routing.ts` (5 checks, `isRoutable`/`evaluateGitHubEvent`), `github.routing.derive.ts` (20 eventos, 12 filtros), `GitHubRoutingPage` con traza | US-073–080, 074–077 | `github.routing.test.ts` (mention sin label ✗, label sin mention ✗, code block ✗, edit/bot ✗, handle customizable, label removible) |
| **T10** Slack | 8 | **Partial** | `integrations.deep.ts` (SLACK_EVENTS…), `SlackPage` + deep dives navegables (G5) | US-067–072 | Superficie/UI presente; OAuth/Home tab live bloqueados |
| **T11** Linear/Jira/Schedule/Factory/GitLab | 8 | **Partial** | `integrations.deep.ts` (LINEAR/JIRA/GITLAB), `GitLabPage/SlackPage/LinearPage/JiraPage` ahora alcanzables | US-081–093 | Mocks locales; provider calls live bloqueados |
| **T12** Dashboard | 13 | **Partial** | `dashboard.derive.ts` (8 métricas + disclaimers, 563 LOC tests), `DashboardPage/MetricCard`, `ActivityBoard`, `RunsPage`, `SettingsPage`, `FactoryDefinitionPage`, `SecretsPage`, `IntegrationsPage`, `McpsPage` | US-094–108 | Slices demoables; paridad completa de definition/settings pendiente |
| **T13** Measure and Improve | 13 | **Partial (slice)** | `scorer.derive.ts`, `benchmark.derive.ts` + `BenchmarksPage`, `SelfImprovementPage` + `mockSelfImprovementPRs` | US-109–120 | Scorers/benchmarks locales green; benchmark execution real no implementado |
| **T14** MCP + Factory API | 8 | **Complete (stub local)** | `mcp.stub.ts` 19 tools + `mcp.stub.test.ts` + `McpStubPage` (ahora route `MCP tools`), `factoryApi.types/router/routes/snippets` + `FactoryApiPage` + `factoryApi.test.ts` | US-121–130, 149–155 | 19 tools, `GET /api/v1/factory?search` case-insensitive, `POST /runs` title derivado, `ticket_ref` regex, Agent API followups/cancel |
| **T15** Infra/Sizing/Governance + Quickstart | 5 | **Complete (Quickstart slice)** | `infra.derive.ts` (3 patterns, 3 choices, 4 boundaries, ZDR, checklist 7 pasos) + `InfraPage`, `quickstart.wizard.ts/data.ts`, `useQuickstart.ts`, `QuickstartWizard.tsx` | US-131–144 | `infra.test.ts` 216 LOC, `quickstart.test.ts` (7 pasos, 1–2 repos, Implement ON, verbatim) |
| **T16** Troubleshooting | 3 | **Complete** | `troubleshooting.data.ts` (SETUP_ROWS 4 + WORK_NOT_STARTING + TWO_RUNS_WARNING + RUNS_ROWS 3) + `TroubleshootingPage` + `HelpSection` (366 LOC tests), navegable vía `Help`, deep dives | US-145–148 | Help center linkeado |

> **Corrección documental aplicada en esta sesión:** `WarpFactories.md §17` listaba Factory MCP 19 tools y Benchmarks v1 como pendientes (heredado del commit `c1fc80c1` con 501 tests). Ahora figuran correctamente como **Hechos** (ver §17 actualizado).

---

## Historias de Usuario 155 — cobertura por épica

| Épica | US | Estado local | Evidencia / límite |
|---|---|---|---|
| **E01 Factory Core** | US-001→006 | **Completa** | CRUD/persistencia, alias `≤60 [A-Za-z0-9 ._-]` único case-insensitive, glosario triada, una policy |
| **E02 Work Item lifecycle** | US-007→016 | **Completa (slice)** | Máquina, skip logic (triage/planning), gates humanos, terminales, `Event history` |
| **E03 Agentes** | US-017→027 | **Parcial** | Modelos/defaults/UI presentes; harness/reasoningLevel/auth workflows requieren credenciales |
| **E04 Skills** | US-028→033 | **Completa** | Registry global/per-agent, preview, self-improvement surface |
| **E05 Automations** | US-034→045 | **Completa (slice)** | Catálogo, matching AND/OR, `in`/`not_in`, schedule/factory, overlapping warning |
| **E06 Definitions as Code** | US-046→058 | **Parcial** | Parsers/schemas green; PR check atómico y schemas unauthenticated son mock |
| **E07 Runners** | US-059→066 | **Completa (slice)** | `platform` + `instanceShape` juntos, `mac.version` quoted, 32/64, per-agent override |
| **E08 Slack** | US-067→072 | **Parcial** | Surfaces/deep dives; `Add to Slack` + invite + Home tab live bloqueados |
| **E09 GitHub** | US-073→080 | **Completa (routing local)** | Dual `factory:<alias>`+`@warp-factory` con exclusiones edit/code block/bot, 12 filtros “Appears on”, simulator |
| **E10 GitLab** | US-081→085 | **Parcial** | Surface/mock; Premium + manager token 1y + bot `*-warp-*` bloqueados |
| **E11 Linear/Jira/Schedule/Factory** | US-086→093 | **Parcial** | Surfaces + primitivas; OAuth/Cloud calls bloqueados |
| **E12 Dashboard** | US-094→108 | **Parcial** | Dashboard/Activity/Runs/Settings slices; Factory definition completo pendiente |
| **E13 Measure and Improve** | US-109→120 | **Parcial** | Scorers/self-improvement slices; benchmark execution completo pendiente |
| **E14 Factory MCP** | US-121→130 | **Completa (stub)** | 19 tools locales, onboarding prompt, worktree guidance |
| **E15 Infra/Governance** | US-131→139 | **Parcial** | Tablas y páginas locales; hosting/retention/enterprise controls bloqueados |
| **E16 Sizing/Quickstart** | US-140→144 | **Completa (slice)** | 7 pasos, 1–2 repos, verbatim first work item, MCP alternative |
| **E17 Troubleshooting** | US-145→148 | **Completa** | Help center y navegación |
| **E18 Factory API** | US-149→155 | **Completa (stub)** | `GET ?search`, `POST /runs`, `ticket_ref`, followups/cancel, curl+OzAPI |

Detalles de cada US (INVEST + Gherkin) permanecen trazables en `WarpFactories-UserStories.md`. Los estados `Parcial` no indican trabajo faltante en la slice local, sino integración live bloqueada por credenciales.

---

## Cambios principales — qué se tocó y por qué

### Dominio puro (SOLID: SRP puro / React separado, OCP estricto, DIP por puertos)

- `src/lib/factory/domain/factory.record.ts` — `FactoryRecord`/`CreateFactoryInput`, `defaultAliasFor`/`slugifyUid`/`validateFactoryCreate`/`renameFactory` (reusa `settings.derive`).
- `src/lib/factory/domain/factory.policy.ts` — `DEFAULT_POLICY` + `enforceSinglePolicy` (`two_policies`).
- `src/lib/factory/store/storage.port.ts` — `KeyValuePort` + `createMemoryPort`/`createLocalStoragePort` (`WORKSPACE_STORAGE_KEY`).
- `src/lib/factory/store/factoryWorkspace.store.ts` — Observer `Map` + `Set<listener>` + `version`, `list/getByUid/getByName/select/create/update/setPolicy/remove/togglePinned/toSummaries`, hidratación desde `KeyValuePort`, seed idéntico a `WorkItemStore` (R4).
- `src/lib/factory/domain/github.routing.ts` + `github.routing.derive.ts` — `factoryLabel`, `stripCodeBlocks`, `findMention`, `hasFactoryLabel`, `continuationKey`, `isRoutable`/`routeGitHubEvent` (5 checks siempre evaluados para traza completa), `evaluateGitHubEvent` delega a `findMatchingAutomations` si routable.
- `src/lib/factory/domain/factoryApi.types.ts`/`factoryApi.router.ts`/`factoryApi.routes.ts`/`factoryApi.snippets.ts` — `FACTORY_API_PREFIX`, `TICKET_REF_PATTERN`, `FactoryApiDeps`/`RouteDef`, `createFactoryApi`/`deriveRunTitle`/`validateDispatchBody`/`matchRoute`, `toCurl`/`toOzApiSnippet`.
- `src/lib/factory/domain/quickstart.wizard.ts` + `quickstart.data.ts` — `QUICKSTART_STEPS` 7, `quickstartReducer` (alias sigue a name si no tocado, máx 2 repos, `implement` inmutable ON, min 1 agente), `validateStep`/`toCreateFactoryInput`/`toFirstWorkItemInput` (verbatim), `progressLabel`.

### Stores y hooks (DIP: persistencia y reloj inyectados, Observer consistente)

- `src/lib/factory/store/workItem.store.ts` — añadido `addKnownFactories()` (R3, aditivo, no pisa `setKnownFactories` que usa `FactoryMcpStub`) + `getKnownFactories()`.
- `src/lib/factory/store/FactoryWorkspaceProvider.tsx` + `src/lib/factory/hooks/useFactories.ts` — `useFactoryWorkspace`/`useSelectedFactory`.
- `src/lib/factory/hooks/useFactoryBundle.ts` — `getFactoryBundle(opts?)` opcional (OCP: sin args idéntico a hoy).
- `src/lib/factory/hooks/useQuickstart.ts` — orquesta `finish()` (create → select → addKnownFactories → create work item → navega).
- `src/main.tsx` — `WorkItemStoreProvider → FactoryWorkspaceProvider(createLocalStoragePort())` (R13).

### Componentes (UX: Nielsen + Fitts, español en copia, inglés en identificadores)

- `src/nav.ts` — `TEAM_NAV_IDS`/`FACTORY_NAV_IDS`/`NAV_ITEMS` (team arriba §10, factory dentro del nodo), `DEFAULT_NAV_ITEM`, `navItemsByScope`/`getNavItem`/`isNavItemId`/`assertNever`.
- `src/App.tsx` — `useState<NavItemId>`, `switch` exhaustivo con `default: assertNever(activeItem)` (OCP: nuevo `NavItemId` sin `case` = fallo de `tsc`), `QuickstartWizard` en `App` + 4 deep dives con `initialTab`.
- `src/components/Sidebar.tsx` — consume `navItemsByScope()` y `useFactoryWorkspace().factories`, `+ Add factory` abre `NewFactoryDialog`, pin real `store.togglePinned`, `Search` inerte eliminado, colapso real a 56px (H21), filas con navegación real.
- `src/components/ErrorBoundary.tsx` — class component con `getDerivedStateFromError` + fallback español + `Recargar` (H2, `erasableSyntaxOnly` sin parameter properties).
- `src/components/factories/NewFactoryDialog.tsx` + `FactoryGlossary.tsx` — 1 campo obligatorio, alias en disclosure, errores inline con literal US-001, repos chips + acción primaria `bg-zinc-900`, política `two_policies` → botón “Crear factory separada”.
- `src/components/routing/GitHubRoutingPage.tsx` — 2 columnas, presets (mention sin label, label sin mention, code block, edit), traza 5 checks con `source: WarpFactories.md §9`.
- `src/components/factory-api/FactoryApiPage.tsx` — selector 7 rutas, editores query/body `Authorization: Bearer`, panel `status/headers/body`, bloques `curl` + OzAPI (Python) copiables.
- `src/components/quickstart/QuickstartWizard.tsx` — barra 7 pasos clicable, 1 control relevante por paso, panel resumen vivo, último paso reseña + “Crear factory y enviar el primer work item”; alternativa `useMcpOnboarding` → `MCP_ONBOARDING_PROMPT` copiable.
- `src/components/activity/ActivityBoard.tsx` — `includeTerminals` con estado real + toggle `Complete/Cancelled` (US-102), derivado `selectedItem` sin `useEffect` (H14), `includeTerminals` en pills.
- `src/components/integrations-deep/IntegrationsDeepDivesPage.tsx` — prop `initialTab` default `gitlab` (G5).

### Higiene G6 (H1–H21 completados en T-A)

H1 `pool: threads`, H2 `ErrorBoundary`, H3 cableado `McpStubPage` → usa `useWorkItemStore()`, H4 borrado `ActivityColumn`/`ActivityFilters`, H5 `yaml.utils.ts` sin stub, H6 borrado `loadDevSamples`, H7 borrado `lib/utils.ts` + `cn.test.ts` ajustado, H8 `ignorePatterns` dist-verify, H9 tokens `--color-*` + `bg-canvas/panel/subsurface`, H10 scrollbar/selection claros, H11 `.grid-pattern` removido, H12–H15 `DashboardPage`/`useWorkItems`/`ActivityBoard` fixes de deps y efecto, H16 `WorkItemStoreContext` split, H17 `no-children-prop`, H18 catch sin param, H19 `no-useless-escape`, H20 `act(...)` en tests, H21 `Search`/toggle arreglados. `tsc` y `oxlint` verdes por construcción.

### Correcciones del Delivery Director incorporadas

- H16 era más fácil: solo `hooks/useWorkItems.ts:3` importa `getDefaultStore`; no se tocó el test que importa `WorkItemStoreProvider`.
- H7 borra un caso de `cn.test.ts` (suite 804 → 803 previo, ahora 847 con los nuevos módulos).
- `addKnownFactories()` aditivo evita que `FactoryMcpStub` borre factories creadas por usuario (R3).
- `automation.engine.ts` y `domain/types.ts` **no se tocaron** (OCP estricto, 393 LOC de engine intactos).

---

## Principios y heurísticas aplicadas

- **SOLID:** SRP por módulo (un dominio = un archivo), OCP (extender vía `opts?` o port, no mutar firmas), LSP (ParseResult), ISP (ports pequeños `KeyValuePort`, `FactoryApiDeps`), DIP (stores reciben puerto/reloj/máquina, componentes reciben hooks).
- **Patrones:** Observer (`Map`+`Set<listener>`+`version`+`useSyncExternalStore`), Strategy (routing checks en `ROUTING_CHECK_ORDER`), Factory (workspace/store), Adapter (ports `createMemoryPort`/`createLocalStoragePort`).
- **UX (Nielsen + Fitts):** 1 campo obligatorio por pantalla, `Enter` = crear, alias auto-derivado en disclosure, acción primaria grande a la izquierda, presets de 1 clic (routing), barra de progreso clicable (wizard), ley alvo vacío. Sin anti-patrones (sin botones inertes, sin “Vista en construcción”, sin rama inalcanzable).

---

## Bloqueantes — requieren tu acción (externos, no de código)

> Siguiendo tu criterio: cuando un ticket requiere información externa o decisión tuya, se marca bloqueante, se continúa con el resto y se reporta.

| # | Qué falta para producción live | Estado local | Bloqueante externo | Acción requerida de tu parte |
|---|---|---|---|---|
| B1 | **GitHub App live** (install, cobertura de repos, routing label `factory:<alias>` auto-creada, CI `workflow_run_completed` re-run) | Slice local ✅ | **Sí** — tokens/config | Instalar Warp GitHub App en org, dar acceso a repos, confirmar 2 automations ON en test issue |
| B2 | **Slack OAuth** (Add to Slack, invite por channel, `reaction_added [ticket]`, Home tab, linked account) | Superficie ✅ | **Sí** — tokens | Conectar workspace con `Add to Slack` + invitar bot a channels + linkear cuentas Warp |
| B3 | **Linear / Jira** (OAuth, `agent_session_created`, `project_keys`/`keywords`, Rovo agent) | Superficie ✅ | **Sí** — credenciales | Proveer Linear OAuth (teams) y Jira Cloud + Rovo API keys; elegir proyectos |
| B4 | **GitLab Premium/Ultimate** (group webhooks, manager token 1y, bot `*-warp-*` Developer) | Surface ✅ | **Sí** — plan + tokens | Proveer GitLab group owner + Premium + manager + bot creds |
| B5 | **Factory MCP live** (`https://app.warp.dev/api/v1/mcp/factory`, headless `Bearer`, scopes) | 19 tools stub ✅ | **Sí** — API key | Proveer `YOUR_API_KEY` y seguir `https://docs.warp.dev/factories/factory-mcp.md` (prompt onboarding ya copiable) |
| B6 | **Factory API live** (`/api/v1/factory`, OzAPI SDK, Mattermost bot) | Stub drop-in ✅ | **Sí** — API key | Proveer `YOUR_API_KEY` para swap `fetch`→ Warp real |
| B7 | **Harness credentials** (`codex`/`claude`/`gemini`, `reasoningLevel`, `auth: managedSecret/workerEnvironment`) | UI/schemas ✅ | **Sí** — secrets | Proveer `ANTHROPIC_API_KEY`/`CODEX_API_KEY` etc. y plan Build (Free solo `oz`) |
| B8 | **Self-hosted runner** (OTel `health/throughput/saturation`, `workerHost`, Docker/K8s/Direct) | Model ✅ | **Sí** — infra | Proveer `SELF_HOSTED_WORKER_ID` y runner `platform`-matched |
| B9 | **Playwright MCP** (smoke browser de nav, routing simulator, API console) | No disponible en sesión | **No bloqueante** producto | Instalar `npx playwright install` + MCP server y correr `web: dev --port 5174` smoke |
| B10 | **Debugger MCP** (step-through, breakpoints) | No disponible en sesión | **No bloqueante** producto | Proveer sesión `mcp-debugger` si se quiere depuración interactiva |

**Continuidad:** ningún bloqueante impide usar las slices locales (creación de factories, routing simulator, Factory API console, Quickstart wizard, dashboard/activity). Las integraciones live quedan como “cablear credenciales y validar en entorno controlado”.

---

## Validaciones realizadas en esta entrega

- `npx tsc --noEmit` — 0 errores (exhaustividad de `nav.ts` protegida por `assertNever`).
- `npx vitest run --pool=threads` — **847/847** verdes: `automation.engine` 393 LOC intactos, `factoryWorkspace` (alias/policy/persistencia), `github.routing` (dual-requirement + code block), `factoryApi` (search, `ticket_ref` regex, followups/cancel), `quickstart` (7 pasos + verbatim), `run.derive` (fix de misma-ms), más los 501 previos.
- `npx oxlint` — 0 warnings/0 errores (158 archivos); `dist-verify/**` ignorado (H8) — de 2004 warnings a 0.
- `npx vite build` — verde; chunks `index`/`vendor`/`parse`/`anim` dentro de presupuesto.
- Smoke de navegación: cada `NavItemId` en `nav.ts` tiene `Sidebar` item visible y renderiza una página (sin rama “Vista en construcción”).
- `ErrorBoundary` con componente que lanza en render muestra fallback español y app permanece navegable.

---

## Próximos pasos recomendados (si buscás paridad 100% producto)

1. Proveer B1–B8 y validar cada integración live en entorno de staging con repos de prueba (test issue con `@warp-factory` + `factory:<alias>`).
2. Añadir suites Playwright para Quickstart (7 pasos con `agentToggles` y `repos` límite), routing simulator y Factory API console (B9).
3. Completar paridad restante de T04/T06/T12/T13 (harnesses reales, PR check `warp/factory-config` atómico en GitHub, benchmark execution real) si es requerida para demo externa.

---

## Apéndice — archivos nuevos/modificados

**Nuevos (dominio puro, sin React):** `factory.record.ts`, `factory.policy.ts`, `storage.port.ts`, `factoryWorkspace.store.ts`, `FactoryWorkspaceProvider.tsx`, `useFactories.ts`, `NewFactoryDialog.tsx`, `FactoryGlossary.tsx`, `github.routing.ts`, `github.routing.derive.ts`, `GitHubRoutingPage.tsx`, `factoryApi.types.ts`, `factoryApi.router.ts`, `factoryApi.routes.ts`, `factoryApi.snippets.ts`, `FactoryApiPage.tsx`, `quickstart.wizard.ts`, `quickstart.data.ts`, `useQuickstart.ts`, `QuickstartWizard.tsx`, `factoryWorkspace.test.ts`, `github.routing.test.ts`, `factoryApi.test.ts`, `quickstart.test.ts`

**Modificados (OCP: solo additive):** `nav.ts`, `App.tsx`, `Sidebar.tsx`, `main.tsx`, `workItem.store.ts` (+`addKnownFactories`), `useFactoryBundle.ts` (+`opts?`), `integrations.deep.ts` (+ sección GitHub), `ActivityBoard.tsx` (US-102), `workItem.store.test.ts`/`run.derive.test.ts` (fix ms)

**Correcciones documentales:** `WarpFactories.md §17` (MCP 19 tools + Benchmarks v1 marcados correctamente, 501 → 847 tests), `WarpFactories-Tickets.md` (matriz de cierre) y `WarpFactories-UserStories.md` (tabla E01–E18 con estados locales) ya reflejan la validación de esta sesión.

---

*Generado autónomamente siguiendo principios SOLID, heurísticas de Nielsen y Ley de Fitts, con prioridad en que todo funcione sin errores antes de cerrar. Sin preocupación por seguridad (proyecto personal, un solo usuario). Herramientas Playwright y debugger no estuvieron disponibles — validación alternativa con `jsdom` + verificación HTTP documentada arriba.*
