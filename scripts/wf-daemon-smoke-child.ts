/**
 * Hijo del smoke de daemon: levanta el daemon factory y queda vivo.
 * Lo lanza `scripts/wf-daemon-smoke.ts` (supervisor) con stdio redirigido a
 * un archivo, para que NINGÚN descendiente herede los pipes de la shell.
 */

import fs from "node:fs";

const HARD_TIMEOUT_MS = 120_000;
setTimeout(() => {
  console.error("[wf-daemon-smoke-child] watchdog: salida forzada");
  process.exit(2);
}, HARD_TIMEOUT_MS).unref();

async function main(): Promise<void> {
  const portFile = process.env.WF_SMOKE_PORT_FILE;
  // F2: antes de ensure, detectar si YA hay un factory healthy (app/standalone
  // de dev). Si existe, este smoke es observador: NO bindea, NO lo mata el
  // supervisor (reporta "existing:<port>").
  let existing: number | null = null;
  for (let port = 17680; port <= 17690; port += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 700);
      const res = await fetch(`http://127.0.0.1:${port}/factory/health`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        existing = port;
        break;
      }
    } catch {
      // sigue probando
    }
  }
  if (existing !== null) {
    if (portFile) {
      try {
        fs.writeFileSync(portFile, `existing:${existing}`, "utf-8");
      } catch {
        // el supervisor también puede descubrir el puerto por health
      }
    }
    console.log(`[wf-daemon-smoke-child] factory preexistente port=${existing}`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  const { ensureFactoryServer } = await import(
    "../headless-runtime/factory/factoryServer"
  );
  const port = await ensureFactoryServer();
  if (portFile) {
    try {
      fs.writeFileSync(portFile, String(port), "utf-8");
    } catch {
      // el supervisor también puede descubrir el puerto por health
    }
  }
  console.log(`[wf-daemon-smoke-child] ready port=${port}`);
  // Queda vivo hasta que el supervisor mate el árbol.
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error(
    "[wf-daemon-smoke-child] FAIL",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
