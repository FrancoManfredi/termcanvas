/**
 * factory-watch-excludes — Patrones de runtime que NUNCA deben reiniciar al
 * daemon standalone de dev (`tsx --watch`).
 *
 * Por qué: el daemon escribe estos archivos MIENTRAS corre (job-index en cada
 * Resolve, notificaciones, runs, agentes espejo…). Sin excludes, `tsx watch`
 * ve sus propias escrituras, mata el daemon y lo relanza: el boot nuevo
 * reclama ownership y parkea los jobs vivos ("daemon reiniciado: turno
 * interrumpido"). Incidente real: #125 parkeado 2s después del Resolve.
 *
 * Espejo de `server.watch.ignored` de vite.config.ts (mismo bug class para el
 * watcher del renderer) + los directorios de runtime/build del daemon.
 * Fuente única: la importan `vite.config.ts` y `scripts/start-factory.mjs`.
 * Se SIGUE vigilando `headless-runtime/**` (el objetivo del watch).
 */

export const FACTORY_WATCH_EXCLUDES = [
  "**/.agents/**",
  "**/.worktrees/**",
  "**/.hydra/**",
  "**/factory/.job-index.json*",
  "**/factory/.notifications.json*",
  "**/factory/.automations.json*",
  "**/factory/.integrations-mock.json*",
  "**/factory/.proposals/**",
  "**/factory/.benchmark-results/**",
  "**/factory/agents/**/agent.md*",
  "**/.opencode/agents/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/dist-cli/**",
  "**/dist-headless/**",
  "**/logs/**",
];
