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
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const args = ["--import", "tsx"];
if (watch) args.push("--watch");
args.push(tsEntry);
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
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
