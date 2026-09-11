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
  const { ensureFactoryServer } = await import(
    "../headless-runtime/factory/factoryServer"
  );
  const port = await ensureFactoryServer();
  const portFile = process.env.WF_SMOKE_PORT_FILE;
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
