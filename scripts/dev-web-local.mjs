#!/usr/bin/env node
/**
 * scripts/dev-web-local.mjs — TermCanvas 100% local en el browser (F4).
 *
 * Levanta las tres piezas en la misma máquina (todo localhost, sin
 * Electron, sin auth remota):
 *   1. Headless API  (headless-runtime/index.ts vía tsx)
 *      http://127.0.0.1:7080/health  (o TERMCANVAS_PORT)
 *      terminales WS /pty/stream, /state, /github/*, /worktree/*
 *   2. Factory daemon (scripts/start-factory.mjs, singleton 17680-17690)
 *      http://127.0.0.1:17680/factory/health
 *      Si ya hay uno sano, se reutiliza y NO se spawnea otro.
 *   3. Renderer web   (scripts/dev-web.mjs → vite con VITE_NO_ELECTRON=1)
 *      http://localhost:5173  (VITE_HEADLESS_URL apunta al headless)
 *
 * Uso:
 *   node scripts/dev-web-local.mjs
 *   TERMCANVAS_PORT=7081 node scripts/dev-web-local.mjs   # headless alterno
 *
 * Demo manual mínima (ver PLAN-web-local.md ola F4):
 *   1. Registrar el repo una vez (PowerShell):
 *      Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7080/project/add `
 *        -ContentType "application/json" -Body '{"path":"<repo>"}'
 *   (Si el headless se levantó a mano, reiniciarlo con
 *   TERMCANVAS_CORS_ORIGINS=http://localhost:5173 o el browser bloquea
 *   los fetch aunque respondan 200.)
 *   2. Abrir http://localhost:5173 → el canvas espeja /state (solo lectura).
 *   3. Crear un tile shell → corre sobre /pty/stream (F1).
 *   4. Medición:  curl "http://127.0.0.1:17680/factory/jobs?view=summary"
 * Ctrl+C detiene todo lo spawneado por este script (el factory
 * preexistente se deja corriendo).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const HEADLESS_PORT = Number(process.env.TERMCANVAS_PORT ?? "7080");
const RENDERER_PORT = Number(process.env.VITE_PORT ?? process.env.PORT ?? "5173");

async function probe(url, timeoutMs = 1000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

const children = [];
function launch(name, cmd, args, env) {
  console.log(`[dev-web-local] starting ${name}: ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    console.log(
      `[dev-web-local] ${name} exited (code=${code} signal=${signal}) — stopping the rest`,
    );
    shutdown(1);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, child } of children) {
    try {
      console.log(`[dev-web-local] stopping ${name}`);
      child.kill();
    } catch {
      // Already dead.
    }
  }
  setTimeout(() => process.exit(code), 500).unref?.();
  process.exitCode = code;
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// 1. Headless API (propio; si el puerto ya responde, se reutiliza).
const headlessHealth = `http://127.0.0.1:${HEADLESS_PORT}/health`;
const rendererOrigin = `http://localhost:${RENDERER_PORT}`;
async function probeCors() {
  try {
    const res = await fetch(headlessHealth, {
      headers: { Origin: rendererOrigin },
    });
    const acao = res.headers.get("access-control-allow-origin");
    return acao === rendererOrigin || acao === "*";
  } catch {
    return false;
  }
}
if (await probe(headlessHealth)) {
  console.log(`[dev-web-local] headless already healthy at ${headlessHealth} — reusing`);
  if (!(await probeCors())) {
    console.warn(
      `[dev-web-local] WARNING: ese headless NO habilita CORS para ${rendererOrigin}.`,
    );
    console.warn(
      "[dev-web-local] Reinicialo con TERMCANVAS_CORS_ORIGINS=" +
        `${rendererOrigin} o el browser bloquea los fetch (aunque respondan 200).`,
    );
  }
} else {
  launch(
    "headless",
    process.execPath,
    ["--import", "tsx", "headless-runtime/index.ts"],
    {
      TERMCANVAS_PORT: String(HEADLESS_PORT),
      TERMCANVAS_HOST: "127.0.0.1",
      WORKSPACE_DIR: process.env.WORKSPACE_DIR ?? root,
      // Sin esto el browser bloquea fetch al headless (CORS) aunque
      // responda 200: el server solo emite ACAO a orígenes listados.
      TERMCANVAS_CORS_ORIGINS:
        process.env.TERMCANVAS_CORS_ORIGINS ??
        `http://localhost:${RENDERER_PORT},http://127.0.0.1:${RENDERER_PORT}`,
    },
  );
  for (let i = 0; i < 50 && !(await probe(headlessHealth, 500)); i += 1) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (await probe(headlessHealth, 1000)) {
    console.log(`[dev-web-local] headless healthy at ${headlessHealth}`);
  } else {
    console.warn("[dev-web-local] headless did not become healthy in time — check the logs above");
  }
}

// 2. Factory daemon (singleton: start-factory.mjs reutiliza si ya hay uno).
launch("factory", process.execPath, ["scripts/start-factory.mjs"], {});

// 3. Renderer web (dev-web.mjs ya setea VITE_NO_ELECTRON=1;
// acá solo le apuntamos el headless).
launch("renderer", process.execPath, ["scripts/dev-web.mjs"], {
  VITE_TERMCANVAS_HEADLESS_URL: `http://127.0.0.1:${HEADLESS_PORT}`,
  PORT: String(RENDERER_PORT),
});

console.log("[dev-web-local] up:");
console.log(`  renderer  http://localhost:${RENDERER_PORT}`);
console.log(`  headless  http://127.0.0.1:${HEADLESS_PORT}/health`);
console.log("  factory   http://127.0.0.1:17680/factory/health");
console.log("[dev-web-local] Ctrl+C stops everything spawned here");
