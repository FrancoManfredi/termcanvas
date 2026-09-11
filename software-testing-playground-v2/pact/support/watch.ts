#!/usr/bin/env tsx
/**
 * Watch — fs.watch pacts y pact/consumer que re-ejecuta p:consumer si cambia
 *
 * Uso PowerShell:
 *   pnpm p:watch                 # observa pact/consumer (specs) y pacts/*.json
 *   pnpm playground:watch        # alias
 *   tsx software-testing-playground-v2/pact/support/watch.ts
 *   tsx software-testing-playground-v2/pact/support/watch.ts --once  # solo verifica una vez y sale
 *
 * Implementa debounce 400ms para no spamear con save múltiples.
 * En cada cambio, ejecuta `pnpm p:consumer` (vitest consumer) y loguea resultado.
 *
 * Windows only — usa fs.watch con recursive:true
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const CONSUMER_DIR = path.resolve("software-testing-playground-v2/pact/consumer");
const PACTS_DIR = path.resolve("software-testing-playground-v2/pacts");
const DEBOUNCE_MS = 400;

interface WatchOptions {
  once: boolean;
  verbose: boolean;
}

function parseArgs(): WatchOptions {
  const args = process.argv.slice(2);
  return {
    once: args.includes("--once"),
    verbose: args.includes("--verbose") || args.includes("-v"),
  };
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pending = false;

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[watch ${ts}] ${msg}`);
}

async function runConsumer(): Promise<void> {
  if (running) {
    pending = true;
    log("consumer ya corriendo — encolando re-run tras terminar");
    return;
  }
  running = true;
  pending = false;
  log("▶ pnpm p:consumer (cambio detectado)");
  const start = Date.now();
  const isWin = process.platform === "win32";
  const cmd = "pnpm";
  const args = ["p:consumer"];

  await new Promise<void>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: path.resolve("."),
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: isWin,
      stdio: "inherit",
    });
    child.on("close", (code) => {
      const dur = Date.now() - start;
      if (code === 0) log(`✓ p:consumer PASS (${dur}ms)`);
      else log(`✗ p:consumer FAIL exit=${code} (${dur}ms) — revisar spec`);
      resolve();
    });
    child.on("error", (err) => {
      log(`✗ spawn p:consumer failed: ${String(err)}`);
      resolve();
    });
  });

  running = false;
  if (pending) {
    pending = false;
    log("re-ejecutando pendiente...");
    void runConsumer();
  }
}

function scheduleRun(reason: string): void {
  log(`cambio: ${reason} — debounce ${DEBOUNCE_MS}ms`);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runConsumer();
  }, DEBOUNCE_MS);
}

function watchDir(dir: string, label: string, includeFilter?: (file: string) => boolean): fs.FSWatcher | null {
  if (!fs.existsSync(dir)) {
    log(`⚠ dir no existe, skip watch: ${dir} (${label})`);
    return null;
  }
  try {
    const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
      const file = filename ? String(filename) : "";
      if (includeFilter && file && !includeFilter(file)) return;
      // Ignore .tmp pacts being written partially? But we debounce so okay
      if (file.endsWith(".tmp") || file.includes(".tmp-")) return;
      scheduleRun(`${label}/${file || eventType}`);
    });
    log(`👁 watching ${label}: ${dir} (recursive)`);
    watcher.on("error", (err) => {
      log(`watch error ${label}: ${String(err)}`);
    });
    return watcher;
  } catch (e) {
    log(`Failed to watch ${dir}: ${String(e)}`);
    return null;
  }
}

function main(): void {
  const opts = parseArgs();
  console.log(`[watch] Playground Pact Watch — fs.watch pacts + consumer`);
  console.log(`[watch] consumer: ${CONSUMER_DIR}`);
  console.log(`[watch] pacts: ${PACTS_DIR}`);
  console.log(`[watch] Presiona Ctrl+C para salir. PowerShell: pnpm p:watch`);

  if (opts.once) {
    log("modo --once — verificando que watch puede iniciar y saliendo");
    const cExists = fs.existsSync(CONSUMER_DIR);
    const pExists = fs.existsSync(PACTS_DIR);
    log(`consumer dir exists: ${cExists}, pacts dir exists: ${pExists}`);
    process.exit(0);
  }

  const watchers: fs.FSWatcher[] = [];

  // Watch consumer specs — solo .ts/.js
  const w1 = watchDir(CONSUMER_DIR, "pact/consumer", (f) => f.endsWith(".spec.ts") || f.endsWith(".spec.js") || f.endsWith(".ts"));
  if (w1) watchers.push(w1);

  // Watch pacts — solo .json (para mostrar que se regeneró, no para re-ejecutar consumer infinito)
  // Si pact JSON cambia sin spec (ej manual edit), warn pero no re-run consumer automáticamente para evitar loop.
  // Solo logueamos, no scheduleRun, a menos que sea .json editado a mano y quieras re-verificar.
  // Para Ola 5: p:watch re-ejecuta p:consumer si cambia consumer (no si cambia pact JSON, para evitar loop consumer→pact→consumer)
  // Así que pacts watch es informativo.
  if (fs.existsSync(PACTS_DIR)) {
    try {
      const w2 = fs.watch(PACTS_DIR, { recursive: false }, (eventType, filename) => {
        const file = filename ? String(filename) : "";
        if (!file.endsWith(".json")) return;
        log(`pact file ${eventType}: ${file} — regenerado por p:consumer (no re-ejecuta para evitar loop)`);
        // Opcional: si quieres que watch de pacts también dispare verify, descomentar:
        // scheduleRun(`pacts/${file}`);
      });
      log(`👁 watching pacts (informativo): ${PACTS_DIR}`);
      w2.on("error", (err) => log(`watch pacts error: ${String(err)}`));
      watchers.push(w2);
    } catch (e) {
      log(`Failed to watch pacts: ${String(e)}`);
    }
  }

  // También watch criteria por si alguien edita Fxx.json metadata
  const criteriaDir = path.resolve("software-testing-playground-v2/criteria");
  if (fs.existsSync(criteriaDir)) {
    const w3 = watchDir(criteriaDir, "criteria", (f) => f.endsWith(".json"));
    if (w3) {
      // criteria changes don't trigger consumer, just log
      // Remove from watchers that trigger runConsumer
      // We'll keep w3 but override its callback to not schedule — actually watchDir already schedules, so we close and make informative
      w3.close();
      const w3info = fs.watch(criteriaDir, { recursive: false }, (_e, filename) => {
        if (filename && String(filename).endsWith(".json")) log(`criteria changed: ${filename} — considera pnpm p:lint`);
      });
      log(`👁 watching criteria (informativo): ${criteriaDir}`);
      watchers.push(w3info);
    }
  }

  log(`✓ watch iniciado — ${watchers.length} watchers activos. Editá un spec en pact/consumer/ para probar.`);

  const shutdown = () => {
    log("cerrando watchers...");
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    log("watch terminado");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].replace(/\\/g, "/").endsWith("watch.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("watch.js") ||
    process.argv[1].replace(/\\/g, "/").endsWith("watch.mjs"));

if (isDirect) {
  main();
}

export { watchDir, runConsumer };
