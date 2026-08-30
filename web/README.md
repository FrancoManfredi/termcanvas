# TermCanvas Web — Factory Platform

Monorepo workspace `web` (pnpm). Instalación y scripts con **pnpm** (no npm).

```bash
pnpm install
pnpm --filter web dev        # dev server :5174
pnpm --filter web build      # tsc -b && vite build
pnpm --filter web test       # vitest run --pool=threads
pnpm --filter web typecheck  # tsc --noEmit (fast)
pnpm --filter web check      # gate canónico Ola 5+Olas 6-8+hotfix: tsc --noEmit && tsc -b && vitest --pool=threads && vite build && oxlint (39/902)
pnpm --filter web run check:quick  # tsc -b && vitest --pool=threads (pre-commit rápido, ver .husky/pre-commit)
```

Workspace: `pnpm-workspace.yaml` incluye `web`. Lockfile único: `pnpm-lock.yaml` en la raíz.

Stack: React 19 + Vite 8 + Tailwind 4 + motion + zod/yaml, Vitest + jsdom + Testing Library, Oxlint.

## Bundle

`vite.config.ts` usa `manualChunks` (`vendor: react/react-dom`, `anim: motion`, `parse: yaml/zod`) y `lazy()` en `App.tsx`; inicial <250KB (warn 500KB).

## Config

- `vite.config.ts` — solo Vite (plugins + build.manualChunks)
- `vitest.config.ts` — `mergeConfig(viteConfig, { test: ... })`
- `tsconfig.json` — references → `tsconfig.app.json` (DOM, bundler, react-jsx) + `tsconfig.node.json` (nodenext)
- `tsconfig.node.json` incluye `vite.config.ts` y `vitest.config.ts`

Ver `../pnpm-workspace.yaml` y `../pnpm-lock.yaml` para dependencias del monorepo.

## Checks & Receipt (Ola 5 HARDENING CORE)

Gate único para definir "verde" sin drift:

```bash
pnpm --filter web check
# = tsc --noEmit && tsc -b && vitest run --pool=threads && vite build && oxlint
# tsc --noEmit 0 · tsc -b 0 (11→0 Ola 5) · 902 tests (39 archivos) · vite build verde 2319 modules · oxlint 0 · hotfix valid_routing 5 presets factory-aware
```

Receipt versionado canónico: `web/docs/RECEIPT.md` — citar `commit · comando · salida` en docs/tickets/report. Prohibido "build verde" sin calificar. Ver también `web/docs/PLAN-OLAS-WARP-FACTORIES.md` §6-7 (Ola 5) y `web/report.md` Validación global.

Quickstart demo 5 min (sin credenciales): `pnpm --filter web dev` → crear factory → routing dual-label simulator (5 presets factory-aware) → Factory API dispatch → Quickstart 7 pasos → Activity kanban.

## Pre-commit

`check:quick` (`tsc -b && vitest --pool=threads`) es el gate rápido para pre-commit (ver `.husky/pre-commit` en raíz: `pnpm --filter web exec tsc -b && pnpm --filter web exec vitest run --pool=threads`). El gate completo `pnpm --filter web check` se corre antes de PR.
