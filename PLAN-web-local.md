# PLAN — TermCanvas 100% local en web (sin Electron)

## Objetivo
Usar el sistema completo en el browser de la misma máquina: renderer web +
daemon factory + headless API + opencode server, todo en localhost.
Sin cambiar el comportamiento de la app Electron.

## Estado de partida (verificado en código)
- Renderer web existe (`pnpm dev:web`, `VITE_NO_ELECTRON=1`); daemon factory
  standalone (`scripts/start-factory.mjs`); headless API con WS `/pty/stream`
  (+ Docker, Bearer opcional, abierto por default en localhost = mismo trust
  que el daemon, que no tiene auth); opencode server en localhost.
- Bloqueadores: (1) terminales solo vía `window.termcanvas.terminal`,
  (2) todo `gh` vive en `electron/main.ts` (no importable: arrastra
  Electron+IPC+PTY), (3) `App.tsx` no monta el canvas sin bridge.
- No se toca: merge de PRs por HTTP (doctrina: el merge es humano),
  `openUrl` (es `window.open`), auth remota/multi-usuario (fuera de
  alcance: todo sigue localhost).

## Prerrequisitos (los verifica el usuario antes de arrancar)
- Daemon corriendo en 17680.
- Repo con ≥1 issue con PR linkeado.
- `gh auth status` en verde.

## Ola F1 — Terminales web
- `headless-runtime/api-server.ts`: extender `/pty/stream` a JSON
  `{create,input,resize,destroy,output,exit}` (hoy crudo, sin
  resize/destroy/multiplex). Sin token en localhost sigue libre.
- Nuevo `headless-runtime/pty-protocol.ts` (tipos),
  `src/terminal/ptyTransport.ts` (interfaz espejo de
  `src/types/index.ts:678-700`), `src/terminal/wsPtyTransport.ts`
  (1 socket/pty; sin auto-reconnect: fail honesto).
- Inyectar en `src/terminal/terminalRuntimeStore.ts` (create 1826,
  input 1145/1330, resize 1153/1170/2436, destroy 2578, onOutput 1976,
  onExit 1986, getPid 468/503, detectCli 1531, theme 1395): bridge si
  existe, WS si no. `getPid/detectCli` degradan honesto sin WS.
- Tests: `tests/ws-pty-transport.test.ts` (mock WS estilo
  `tests/terminal-runtime-store.test.ts:522+`) + suites terminal.
- **Gate F1:** tile abre shell local, escribe, resizea, cierra con exit
  visible + `tsc` + suites terminal verdes.

## Ola F2 — GitHub vía daemon + canvas en web
- Mover a `shared/`: parsers de `src/canvas/reviewVerdict.ts` (puros),
  regex owner/repo, builders de query. Re-exportar desde el origen para no
  romper imports. `getConflictFiles` (git puro) mover/duplicar.
- Nuevas rutas daemon (solo lectura primero): `GET /github/issues/:n/prs`,
  `GET /github/prs/:n/decision`, `GET /github/prs/:n/comments` (spawns `gh`
  duplicados chicos, timeout 30s, maxBuffer 50MB como en main).
- Cliente web + `checkLinkedPr` dual (bridge → fallback web). Montar canvas
  en web (gate `hasHostBridge` en `src/App.tsx`); botones sin handler
  siguen no-op honesto.
- Tests de paridad app-vs-web en lookups/veredictos + suites warp/factory.
- **Gate F2:** pills y veredictos idénticos en ambos modos + suites verdes.

## Ola F3 — Flujos mutantes (resolve/review/fix/conflict)
- Worktree ops contra headless API (`/worktree/*`, `/project/*`
  existentes); writes de labels (`applyReviewLabel/Cycle`) como `POST`
  solo si el panel web los necesita.
- Un CTA por vez, cada uno con test de ida y vuelta contra worktree real.
- **Gate F3:** cada flujo verde + suite completa (solo fallos
  preexistentes conocidos).

## Ola F4 — Empaquetado y cierre
- Script único que levanta renderer+daemon+headless (`dev:web` ya es la
  mitad); documentar en el header del script.
- `tsc`, suite completa, medición `?view=summary` en vivo, prueba manual
  en browser.
- **Gate F4:** todo lo anterior + demo manual navegando el panel en web.

## Reglas de todas las olas
- Cambios mínimos (1-3 archivos + tests por cambio).
- Todo dual-path (bridge si existe, web si no) con degradación honesta.
- Sin mocks en código real; sin resultados inventados.
- Rollback = `git revert`. No commitear sin pedido explícito.
- Si una ola falla su gate, se arregla ahí antes de seguir.
