# TermCanvas Web — Factory Platform

Monorepo workspace `web` (pnpm). Instalación y scripts con **pnpm** (no npm).

```bash
pnpm install
pnpm --filter web dev        # dev server :5174
pnpm --filter web build      # tsc -b && vite build
pnpm --filter web test       # vitest run
pnpm --filter web typecheck
```

Workspace: `pnpm-workspace.yaml` incluye `web`. Lockfile único: `pnpm-lock.yaml` en la raíz.

Stack: React 19 + Vite 8 + Tailwind 4 + motion + zod/yaml, Vitest + jsdom + Testing Library, Oxlint.

## Bundle

`vite.config.ts` usa `manualChunks` (`vendor: react/react-dom`, `anim: motion`, `parse: yaml/zod`) y `lazy()` en `App.tsx`; inicial <250KB (warn 500KB).

## Config

- `vite.config.ts` — solo Vite (plugins + build.manualChunks)
- `vitest.config.ts` — `mergeConfig(viteConfig, { test: ... })`
- `tsconfig.node.json` incluye `vite.config.ts` y `vitest.config.ts`

Ver `../pnpm-workspace.yaml` y `../pnpm-lock.yaml` para dependencias del monorepo.
