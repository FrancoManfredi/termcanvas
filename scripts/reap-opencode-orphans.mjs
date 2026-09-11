#!/usr/bin/env node
/**
 * scripts/reap-opencode-orphans.mjs — higiene anti-recaída (Ola E).
 *
 * Los TUIs `opencode.exe` de terminales ya cerradas quedan huérfanos
 * reteniendo GB de RAM sin hacer nada (11 huérfanos ≈ 3 GB medidos
 * 2026-09-09) y el daemon no puede matarlos (ni debe: son procesos del
 * usuario). Este script los detecta por WMI (padre muerto) y:
 * - default: SOLO LISTA (read-only, cero riesgo).
 * - `--kill`: los termina, re-verificando orfandad+nombre justo antes
 *   (nunca toca procesos con padre vivo).
 *
 * Solo-Windows. Uso:
 *   node scripts/reap-opencode-orphans.mjs
 *   node scripts/reap-opencode-orphans.mjs --kill
 */
import { execFileSync } from "node:child_process";

const KILL = process.argv.includes("--kill");

function ps(command) {
  return execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 30000 },
  );
}

function listOpencode() {
  let raw = "";
  try {
    raw = ps(
      `Get-CimInstance Win32_Process -Filter "Name='opencode.exe'" | ` +
        `Select-Object ProcessId,ParentProcessId,WorkingSetSize | ` +
        `ConvertTo-Json -Compress`,
    ).trim();
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || parsed === undefined) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parentAlive(pid) {
  try {
    ps(`Get-Process -Id ${pid} -ErrorAction Stop | Out-Null`);
    return true;
  } catch {
    return false;
  }
}

function isOpencode(pid) {
  try {
    const name = ps(
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").Name`,
    ).trim();
    return name === "opencode.exe";
  } catch {
    return false;
  }
}

function main() {
  if (process.platform !== "win32") {
    console.error("Solo-Windows (usa WMI).");
    process.exit(2);
  }
  const orphans = [];
  let freed = 0;
  for (const proc of listOpencode()) {
    try {
      const pid = proc.ProcessId;
      if (typeof pid !== "number") continue;
      if (parentAlive(proc.ParentProcessId)) continue;
      const ram = typeof proc.WorkingSetSize === "number" ? proc.WorkingSetSize : 0;
      orphans.push({ ...proc, RAM: ram });
      freed += ram;
    } catch {
      // una fila rota no aborta el barrido
    }
  }
  if (orphans.length === 0) {
    console.log("Sin huérfanos: todo opencode tiene padre vivo.");
    return;
  }
  for (const o of orphans) {
    console.log(
      `orphan pid=${o.ProcessId} ram=${Math.round((o.RAM ?? 0) / 1048576)}MB parent=${o.ParentProcessId} DEAD`,
    );
  }
  console.log(
    `total: ${orphans.length} huérfano(s), ${(freed / 1073741824).toFixed(1)}GB retenidos`,
  );
  if (!KILL) {
    console.log("Solo lista (read-only). Para matarlos: node scripts/reap-opencode-orphans.mjs --kill");
    return;
  }
  let killed = 0;
  for (const o of orphans) {
    try {
      // Re-verificación justo antes: mismo PID, mismo binario, padre muerto.
      if (!isOpencode(o.ProcessId)) {
        console.log(`skip pid=${o.ProcessId}: ya no es opencode (PID reciclado)`);
        continue;
      }
      if (parentAlive(o.ParentProcessId)) {
        console.log(`skip pid=${o.ProcessId}: el padre revivió`);
        continue;
      }
      process.kill(o.ProcessId);
      killed += 1;
      console.log(`killed pid=${o.ProcessId}`);
    } catch (err) {
      console.log(`skip pid=${o.ProcessId}: ${String(err?.message ?? err).slice(0, 120)}`);
    }
  }
  console.log(`listo: ${killed}/${orphans.length} terminados`);
}

main();
