#!/usr/bin/env node
/**
 * scripts/dev-web.mjs — `pnpm dev:web`: renderer solo, sin Electron.
 *
 * El build de electron/main (3.6MB/22s) domina el arranque de `pnpm dev`.
 * Para trabajo solo-UI, este lanzador corre el MISMO `vite serve` con
 * `VITE_NO_ELECTRON=1` (vite.config salta el plugin de electron): ~1-2s.
 * Cross-platform sin dependencias (los flags CLI desconocidos los rechaza
 * vite; `VAR=1 cmd` no anda en cmd.exe — por eso existe este script).
 * Sin daemon ni app: el panel muestra estados honest-empty donde falte.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
let viteBin = null;
try {
  // Vía package.json (el mapa exports de vite puede no exponer bin/).
  const pkgPath = require.resolve("vite/package.json");
  viteBin = path.join(path.dirname(pkgPath), "bin", "vite.js");
} catch {
  console.error("[dev:web] no se encontró vite en node_modules (corré pnpm install)");
  process.exit(2);
}

const child = spawn(process.execPath, [viteBin], {
  stdio: "inherit",
  env: { ...process.env, VITE_NO_ELECTRON: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(`[dev:web] ${String(err?.message ?? err)}`);
  process.exit(1);
});
