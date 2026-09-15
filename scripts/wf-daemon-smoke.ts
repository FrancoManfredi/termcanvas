/**
 * Smoke del daemon factory (supervisor).
 *
 * Por qué este diseño: levantar el daemon spawnea el server OpenCode; en
 * Windows esos nietos heredan los pipes de la shell y la dejan esperando
 * aunque Node salga ("comando trancado"). Acá el daemon corre en un proceso
 * DETACHED con stdout/stderr a un archivo: ningún descendiente toca los pipes
 * de la shell. El supervisor verifica por HTTP y después mata el árbol entero.
 *
 * Uso: pnpm smoke:factory
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HARD_TIMEOUT_MS = 90_000;
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wf-daemon-smoke-"));
const LOG_FILE = path.join(WORK_DIR, "daemon.log");
const PORT_FILE = path.join(WORK_DIR, "port.txt");
const FACTORY_DIR = path.join(WORK_DIR, "factory");

const portsToClean = new Set<number>();
let childPid: number | null = null;

function portOwnerPid(port: number): number | null {
  try {
    const out =
      spawnSync("netstat", ["-ano"], { encoding: "utf-8", windowsHide: true })
        .stdout ?? "";
    for (const line of out.split("\n")) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    // sin netstat: queda el taskkill del árbol del hijo
  }
  return null;
}

function killTree(pid: number): void {
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // best-effort
  }
}

function detectOpencodePort(): number | null {
  try {
    const log = fs.readFileSync(LOG_FILE, "utf-8");
    const matches = [...log.matchAll(/port candidato (\d+)/g)];
    const last = matches.at(-1);
    return last ? Number(last[1]) : null;
  } catch {
    return null;
  }
}

function cleanup(): void {
  if (childPid !== null) killTree(childPid);
  for (const port of portsToClean) {
    const pid = portOwnerPid(port);
    // El daemon del smoke es hijo, nunca este proceso: aun así, jamás matarnos.
    if (pid && pid !== process.pid) killTree(pid);
  }
}

function exitWith(code: number): void {
  cleanup();
  process.exit(code);
}

const watchdog = setTimeout(() => {
  console.error("[wf-daemon-smoke] watchdog: forzando salida");
  exitWith(2);
}, HARD_TIMEOUT_MS);
watchdog.unref();

async function waitForHealth(): Promise<{ port: number; names: string[] }> {
  const started = Date.now();
  for (;;) {
    for (let port = 17680; port <= 17690; port += 1) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 800);
        const health = await fetch(`http://127.0.0.1:${port}/factory/health`, {
          signal: ctrl.signal,
        }).catch(() => null);
        clearTimeout(timer);
        if (!health?.ok) continue;
        const list = await fetch(`http://127.0.0.1:${port}/factory/workflows`).catch(
          () => null,
        );
        if (!list?.ok) continue;
        const payload = (await list.json()) as {
          workflows?: Array<{ name: string }>;
        };
        return {
          port,
          names: (payload.workflows ?? []).map((workflow) => workflow.name),
        };
      } catch {
        // sigue probando
      }
    }
    if (Date.now() - started > 45_000) {
      throw new Error("timeout esperando /factory/health");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  // node + cli de tsx directo: sin shell, así el cwd con espacios no rompe.
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const logFd = fs.openSync(LOG_FILE, "w");
  const child = spawn(
    process.execPath,
    [tsxCli, "scripts/wf-daemon-smoke-child.ts"],
    {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        TERMCANVAS_FACTORY_DIR: FACTORY_DIR,
        TERMCANVAS_WORKFLOWS_ROOT: process.cwd(),
        WF_SMOKE_PORT_FILE: PORT_FILE,
      },
    },
  );
  child.unref();
  childPid = child.pid ?? null;

  const { port, names } = await waitForHealth();
  // F2: solo matamos el puerto si lo abrió NUESTRO child. El child escribe
  // el puerto pelado cuando binduéa y `existing:<port>` cuando reutilizó un
  // factory ajeno (app/standalone de dev): en ese caso el smoke es observador
  // y no lo toca. (El port-file solo no alcanza: el child escribía el puerto
  // reusado y el smoke mataba el daemon del usuario — incidente real.)
  let ownPort: number | null = null;
  try {
    const raw = fs.readFileSync(PORT_FILE, "utf-8").trim();
    if (/^\d+$/.test(raw)) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) ownPort = parsed;
    }
  } catch {
    ownPort = null;
  }
  const ownsPort = childPid !== null && ownPort === port;
  if (ownsPort) {
    portsToClean.add(port);
  } else {
    console.log(
      `[wf-daemon-smoke] factory preexistente en ${port} (no es de este smoke) — no se mata al salir`,
    );
  }
  console.log(
    `[wf-daemon-smoke] health=200 workflows=${names.join(",")} port=${port}`,
  );
  if (!names.includes("factory-default")) {
    throw new Error("factory-default no aparece en /factory/workflows");
  }
  if (ownsPort) {
    const opencodePort = detectOpencodePort();
    if (opencodePort !== null) portsToClean.add(opencodePort);
  }
  console.log("[wf-daemon-smoke] OK");
}

main()
  .then(() => exitWith(0))
  .catch((error) => {
    console.error(
      "[wf-daemon-smoke] FAIL",
      error instanceof Error ? error.message : error,
    );
    try {
      const tail = fs.readFileSync(LOG_FILE, "utf-8").split("\n").slice(-12).join("\n");
      if (tail.trim().length > 0) console.error(`--- daemon log ---\n${tail}`);
    } catch {
      // sin log disponible
    }
    exitWith(1);
  });
