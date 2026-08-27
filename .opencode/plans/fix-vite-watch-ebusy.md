# Fix: crash del dev server (EBUSY watch en scripts/.tools)

## Contexto

`npm run dev` muere con `Error: EBUSY: resource busy or locked, watch
'C:\...\scripts\.tools\gitleaks-extract\LICENSE'`. Los scripts
`run-issue-gate.mjs` y `run-diagnostico-tools.mjs` descargan/extraen
herramientas a `scripts/.tools/` mientras el dev server corre; el watcher
chokidar de Vite intenta vigilar los archivos recién extraídos, Windows
responde EBUSY (handle del extractor / escaneo AV), el `'error'` llega sin
handler y Node sale → cae toda la sesión de desarrollo.

Precedente exacto en vite.config.ts: ya se ignoran `**/.hydra/**` y
`**/.worktrees/**` porque son directorios runtime, no código fuente.

## Cambios

### vite.config.ts — ampliar `server.watch.ignored`

```ts
ignored: [
  "**/.hydra/**",
  "**/.worktrees/**",
  "**/.hydra-result-*.md",
  "**/.hydra-task-*.md",
  // Runtime tool caches: issue-gate/diagnostico download & extract
  // binaries here while the dev server runs. Watching freshly extracted
  // files races their locks (Windows EBUSY) and kills the watcher.
  "**/scripts/.tools/**",
  // Local workspace state (pin renders, session artifacts).
  "**/.termcanvas/**",
],
```

## Verificación

- `npm run typecheck`
- Reproducción dirigida: con `npm run dev` activo, borrar
  `scripts/.tools/gitleaks-extract` y dejar que run-issue-gate lo vuelva a
  extraer (o tocar archivos dentro de `.tools`) → el dev server NO debe
  morir ni recargar.
- Confirmar que el HMR sigue funcionando editando un archivo real de `src/`.
