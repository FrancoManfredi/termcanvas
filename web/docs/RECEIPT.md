# RECEIPT — TermCanvas Warp Factories Simulator (LOCAL, Ola 5 HARDENING CORE + Olas 6-8 + hotfix valid_routing)

> **Gate canónico Ola 5 (P0-01..P0-04):** `pnpm --filter web check` = `tsc --noEmit && tsc -b && vitest run --pool=threads && vite build && oxlint`
> **Instrucción:** toda afirmación "verde/completo" debe citar `commit · comando · salida` de este receipt. Prohibido "build verde" sin calificar.

## Commit

```
branch: workbuddy/main-c2128e3a
base:   origin/main 2627957509fa0e89d6a424374b83b61a1406fea3
prev:   d64cdf3ff316db7744468fec43685cd0a9ed593b
worktree: C:\Users\Estudiante UCU\WorkBuddy\Worktrees\web\main-c2128e3a
fecha:  2026-08-30 (Ola 5 HARDENING CORE 5pts + Ola 6 persistencia v1→v2 + file:line LineCounter + Ola 7 polish Help ?×5 + presets 5 + Dashboard 9 tooltips + DEMO-5MIN + Ola 8 ADR ports + VITE_FACTORY_BACKEND + trigger 2026-11-01 + hotfix valid_routing preset factory-aware)
commit: HEAD workbuddy/main-c2128e3a feat(web) O5-O8 · base origin/main 2627957509fa0e89d6a424374b83b61a1406fea3 · ver git rev-parse --short HEAD (actual) / git log --oneline -1 · pnpm check 39/902
```

## Comandos y salidas

```bash
# 1 — tsc --noEmit (fast-fail ~1s, bundler mode)
pnpm --filter web exec tsc --noEmit
# → 0 errores

# 2 — tsc -b (project references, gate canónico, 11 → 0 en Ola 5)
pnpm --filter web exec tsc -b
# → 0 errores
# fixes: E1 Sidebar Factory API icon · E2 container ! · E3a [...].sort() · E3b source:direct · E4 makeAutomationStub · E5 children? · E6 children prop · E7 PropertyKey narrow

# 3 — vitest (threads pool, jsdom, Windows-safe)
pnpm --filter web exec vitest run --pool=threads
# → 39 archivos / 902 tests verdes · Duration ~22s (threads pool, jsdom)
# previo: 847/847 base; Ola 5 añade navIcons.test.ts (4 tests exhaustividad NAV_ICONS) → 851; Olas 6-8 + hotfix → 902 (+51 tests: workspace.migration, validation.lineCounter, dashboard.disclaimers, helpLinks, quickstart, ports.contract, valid_routing 5 presets factory-aware)

# 4 — vite build (no typecheck, coincidente con tsc -b)
pnpm --filter web build
# → vite build verde (2319 modules transformed; chunks: vendor ~182kB, anim ~133kB, parse ~183kB, index ~54kB, warn 500kB)

# 5 — oxlint
pnpm --filter web exec oxlint
# → 0 warnings / 0 errors (158 archivos, ignorePatterns dist-verify/**, dist/**, node_modules/**)

# Gate único (atajo)
pnpm --filter web check
# → verde (5 subcomandos: tsc --noEmit && tsc -b && vitest --pool=threads && vite build && oxlint)

pnpm --filter web run check:quick
# → verde (tsc -b && vitest --pool=threads, para pre-commit)
```

## Deuda tsc -b cerrada (11 errores → 7 categorías → 0)

| # | Archivo:línea | Error | Fix OCP |
|---|---|---|---|
| E1 | `Sidebar.tsx:33` | `Property '"Factory API"' missing in Record<NavItemId, LucideIcon>` | `export const NAV_ICONS` + `"Factory API": LayoutGrid` + `navIcons.test.ts` |
| E2 | `agents.page.test.ts:403` | `Variable 'container' used before being assigned` | `let container!: HTMLElement` |
| E3a | `factoryWorkspace.test.ts:213` | `Property 'sort' does not exist on readonly string[]` | `[...getKnownFactories()].sort()` |
| E3b | `factoryWorkspace.test.ts:219,231` | `Property 'source' missing in CreateWorkItemInput` | `source:"direct"` en ambos call sites |
| E4 | `github.routing.test.ts:122,133` | `AutomationDefinition missing agent, prompt, rawPath` | helper `makeAutomationStub(overrides)` con `satisfies AutomationDefinition` |
| E5 | `troubleshooting.test.ts:199,209` | `Property 'children' missing in HelpSectionProps` | `HelpSection.tsx` `children?: ReactNode` |
| E6 | `workItem.store.context.test.tsx:13` | `Property 'children' missing in Provider props` | test `createElement(Provider, { store, children })` |
| E7 | `common.schema.ts:91` | `PropertyKey[] not assignable to (string|number)[]` | `filter((k): k is string|number => typeof k==="string"||typeof k==="number")` sin `as` |

## Hotfix — Caso válido factory-aware (2026-08-30)

- **Preset `valid_routing` — Caso válido — Enruta (factory-aware):** 5 presets totales (`valid_routing` + 4 negativos). `valid_routing` es el único `"✓ Enruta"` y siempre fuerza `factory:<alias>` de la factory seleccionada (`applyPreset` adapta label hardcodeado `factory:payments` al `foremanName` actual) para que enrute sin mismatch; los 4 negativos preservan su razón de "No enruta". Tests: `valid_routing preset routes with default policy` + `valid_routing preset is first and distinguishable` (GITHUB_ROUTING_PRESETS[0] === valid_routing, length 5).

## Archivos tocados en Ola 5 (ver PLAN §7 tabla)

- `web/package.json` — `scripts.check` + `scripts.check:quick`
- `web/src/components/Sidebar.tsx` — `Factory API` icon + `export NAV_ICONS`
- `web/src/lib/factory/schemas/common.schema.ts` — narrow PropertyKey
- `web/src/components/help/HelpSection.tsx` — `children?`
- `web/src/lib/factory/__tests__/agents.page.test.ts` — E2
- `web/src/lib/factory/__tests__/factoryWorkspace.test.ts` — E3a+E3b
- `web/src/lib/factory/__tests__/github.routing.test.ts` — makeAutomationStub
- `web/src/lib/factory/__tests__/troubleshooting.test.ts` — (indirecto E5 via componente)
- `web/src/lib/factory/__tests__/workItem.store.context.test.tsx` — E6
- `web/src/lib/factory/__tests__/navIcons.test.ts` — nuevo (4 tests)
- `web/WarpFactories-Tickets.md` — closure matrix Ola 5 + receipt versionado
- `web/report.md` — validación global con tsc -b 0 + commit hash
- `web/docs/RECEIPT.md` — este archivo
- `web/README.md` — documenta `pnpm check`

## Olas 6-8 — resumen (LOCAL-hardened + backend-ready spike)

- **Ola 6 — PERSISTENCIA + VALIDATION (P0-05 + P1-01):** `workspace.migration.ts` v1→v2 no destructiva + `workspace.export.ts` export/import validado + `storage.port.ts` WORKSPACE_STORAGE_KEY_V2 + quota handling; `validation.lineCounter.ts` con `yaml` LineCounter → `factory.yaml:12` file:line real en ValidationPage; tests `workspace.migration.test.ts` + `validation.lineCounter.test.ts`.
- **Ola 7 — POLISH DEMO (P0-06 + P1-02..P1-05):** `HelpLinks.tsx` `?`×5 (Activity/Runs/Automations/Factory API/GitHub routing → Troubleshooting anchors) + `FactoryListActions.tsx` Export/Import + `GitHubRoutingPage` 4→5 presets con valid_routing factory-aware + continuationKey copiable + `QuickstartWizard` límite 2 repos feedback + `DashboardPage` 9 tooltips disclaimers + `DEMO-5MIN.md` 5min guion; tests `helpLinks`, `dashboard.disclaimers`, `quickstart`.
- **Ola 8 — BACKEND-READY SPIKE (P2-01..P2-04):** `docs/ADR-001-ports-backend.md` 4 ports (FactoryRepositoryPort, WorkItemRepositoryPort, FactoryApiTransportPort handle→ApiResponse, McpTransportPort) + `src/lib/factory/ports/*.ts` solo tipos + `config/featureFlags.ts` VITE_FACTORY_BACKEND local|remote + `docs/BACKEND-TRIGGER.md` trigger 2026-11-01 + `docs/ENV-MAP.md` B1–B8 tabla; test `ports.contract.test.ts`; `tsc -b 0`.
- Hotfix local: `github.routing.derive.ts` factory-aware 5 presets + `github.routing.test.ts` valid_routing.
- **Total: 39 archivos / 902 tests, tsc --noEmit 0, tsc -b 0, vite 2319 modules, oxlint 0.**

## Validez

- OCP estricto: ninguna firma/semántica de export existente mutada; 847 tests previos siguen verdes (+4 navIcons + 51 Olas 6-8/hotfix).
- Sin deps nuevas; stack congelado Vite 8.2 + React 19.2 + TS 6.0 + Tailwind 4.1 + zod + yaml.
- Código en inglés; copia ES donde toca (HelpSection, Sidebar aria, RECEIPT en inglés técnico).
- `tsc -b` es gate canónico por `references` (`tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`, `erasableSyntaxOnly`, `verbatimModuleSyntax`).

---

*Generado Ola 5 HARDENING CORE + Olas 6-8 backend-ready + hotfix valid_routing — gate que desbloquea olas 6-8. Pegar este bloque como receipt en tickets/report/docs. Commit·pnpm check·39/902*
