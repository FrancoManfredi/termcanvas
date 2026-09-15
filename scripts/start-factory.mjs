#!/usr/bin/env node
/**
 * scripts/start-factory.mjs — levanta el Factory daemon standalone sin Electron.
 * Uso:
 *   node scripts/start-factory.mjs
 *   # o con tsx si el archivo es .ts:
 *   npx tsx headless-runtime/factory/factoryServer.ts
 *
 * Escuchará en 127.0.0.1:17680 (o 17681-17690 si 17680 ocupado) y servirá
 * GET /factory/health con {queue:{pending,running}, uptime, version:"local"}.
 * Ctrl+C para detener. Escribe ~/.termcanvas/factory-port (o ~/.termcanvas-dev/factory-port en dev).
 *
 * Watch (dev): el daemon corre con `node --watch`, así que cualquier cambio
 * en las fuentes del runtime lo reinicia solo. Sin esto, editar
 * headless-runtime/* y reiniciar la app dejaba sirviendo el proceso viejo
 * (el daemon no tiene hot-reload): el bug "No mergear no borra nada" fue
 * exactamente eso — la app reutilizaba un daemon de horas antes.
 * Desactivar: TERMCANVAS_FACTORY_NO_WATCH=1.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FACTORY_WATCH_EXCLUDES } from "./factory-watch-excludes.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const tsEntry = path.join(root, "headless-runtime", "factory", "factoryServer.ts");

// Singleton check: avoid spawning duplicate factory if one already healthy (with timeout to prevent hang)
async function probeHealth(port, timeoutMs = 800) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/factory/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}
let existingPort = null;
for (let p = 17680; p <= 17690; p++) {
  if (await probeHealth(p, 700)) { existingPort = p; break; }
}
if (existingPort !== null) {
  console.warn(`[start-factory] ya hay Factory en puerto ${existingPort}, reutilizando (singleton) - no se lanza nuevo proceso`);
  console.warn(`[start-factory] verifica: curl http://127.0.0.1:${existingPort}/factory/health`);
  process.exit(0);
}

const watch = process.env.TERMCANVAS_FACTORY_NO_WATCH !== "1";
console.log(
  `[start-factory] launching Factory daemon via tsx${watch ? " (watch: reinicia al cambiar fuentes)" : ""}…`,
);
console.log(`[start-factory] entry: ${tsEntry}`);
console.log("[start-factory] tip: curl http://127.0.0.1:17680/factory/health");

// Watch explícito de tsx (subcomando `watch`): el alias `--watch` lo maneja
// NODE (sin soporte de excludes) y `--exclude` revienta con "bad option".
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const args = watch
  ? [
      tsxCli,
      "watch",
      ...FACTORY_WATCH_EXCLUDES.flatMap((glob) => ["--exclude", glob]),
      tsEntry,
    ]
  : ["--import", "tsx", tsEntry];
// F1b: log persistente del daemon (sin esto un exit/crash no deja rastro).
let stdio = "inherit";
try {
  const logDir = path.join(root, ".agents", "factory");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "daemon-dev.log");
  const fd = fs.openSync(logPath, "a");
  fs.appendFileSync(
    logPath,
    `\n=== daemon start ${new Date().toISOString()} (watch=${watch ? "on" : "off"}) ===\n`,
    "utf-8",
  );
  stdio = ["ignore", fd, fd];
  console.log(`[start-factory] log: ${logPath}`);
} catch {
  stdio = "inherit";
}
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio,
  windowsHide: true,
  env: { ...process.env },
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.log(`[start-factory] daemon stopped by signal ${signal}`);
  } else {
    console.log(`[start-factory] daemon exited with code ${code}`);
  }
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[start-factory] forwarding ${sig} to daemon…`);
    child.kill(sig);
  });
}
