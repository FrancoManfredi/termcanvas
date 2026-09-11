#!/usr/bin/env node
/**
 * scripts/factory.mjs — operativa del Factory daemon (Ola 5).
 *
 * El daemon es un proceso suelto `node --import tsx headless-runtime/factory/factoryServer.ts`
 * en 17680-17690 y `pnpm dev` NO lo reinicia. Este script lo gestiona sin Electron.
 *
 * Uso (funciona en Windows PowerShell/cmd y en Unix):
 *   node scripts/factory.mjs status   — muestra puerto sano + buildId/startedAt
 *   node scripts/factory.mjs restart  — mata PID en 17680-17690 y levanta detached
 *                                       con logs en os.tmpdir()/factory-daemon*.log
 *   node scripts/factory.mjs validate — valida factory/ en disco (NO toca
 *                                       procesos: si hay daemon sano usa su
 *                                       GET /factory/definition/status, si no
 *                                       corre el validador local vía tsx).
 *                                       Imprime `file:line rule message` por
 *                                       línea + resumen. Exit 1 si !valid
 *                                       (solo los error bloquean; los warn no),
 *                                       0 si valid, 2 si no pudo validar.
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TS_ENTRY = path.join(ROOT, "headless-runtime", "factory", "factoryServer.ts");
const RANGE_START = 17680;
const RANGE_END = 17690;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeHealth(port, timeoutMs = 900) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/factory/health`, { signal: ctrl.signal });
      if (!res.ok) return null;
      try {
        return await res.json();
      } catch {
        return {};
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

async function findHealthyPort() {
  for (let p = RANGE_START; p <= RANGE_END; p++) {
    const body = await probeHealth(p, 700);
    if (body !== null) return { port: p, body };
  }
  return null;
}

/**
 * Detecta PIDs escuchando en 17680-17690.
 * Windows: `netstat -ano` + parse de la columna PID en líneas LISTENING.
 * Unix: best-effort con `lsof` o `/proc` fallback a vacío (no rompe Windows).
 * Nunca lanza: devuelve [] si no puede detectar.
 */
function findListeningPids() {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano", { encoding: "utf-8", timeout: 8000 });
      for (const line of out.split(/\r?\n/)) {
        // Ejemplo: `  TCP    127.0.0.1:17680    0.0.0.0:0    LISTENING    1234`
        if (!/LISTENING/i.test(line)) continue;
        const m = line.match(/127\.0\.0\.1:(1768\d|17690)\b.*?(\d+)\s*$/);
        const mAny = m ?? line.match(/0\.0\.0\.0:(1768\d|17690)\b.*?(\d+)\s*$/);
        const hit = m ?? mAny;
        if (!hit) continue;
        const port = Number(hit[1]);
        const pid = Number(hit[2]);
        if (port >= RANGE_START && port <= RANGE_END && Number.isInteger(pid) && pid > 0) {
          if (pid !== process.pid) pids.add(pid);
        }
      }
    } else {
      try {
        const out = execSync(`lsof -tiTCP:${RANGE_START}-${RANGE_END} -sTCP:LISTEN`, {
          encoding: "utf-8",
          timeout: 8000,
        });
        for (const tok of out.split(/\s+/)) {
          const pid = Number(tok.trim());
          if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
        }
      } catch {
        // lsof ausente o sin resultados → vacío, no es error
      }
    }
  } catch {
    // netstat falló → vacío
  }
  return [...pids];
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore", timeout: 8000 });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

async function cmdStatus() {
  const found = await findHealthyPort();
  if (found) {
    const { port, body } = found;
    const b = body && typeof body === "object" ? body : {};
    const buildId = typeof b.buildId === "string" ? b.buildId : "?";
    const uptime = typeof b.uptime === "number" ? `${b.uptime}ms` : "?";
    const startedAt = b.startedAt !== undefined ? String(b.startedAt) : "?";
    console.log(`[factory] OK http://127.0.0.1:${port}/factory/health buildId=${buildId} uptime=${uptime} startedAt=${startedAt}`);
    return 0;
  }
  console.log(`[factory] sin daemon sano en ${RANGE_START}-${RANGE_END}`);
  return 1;
}

/**
 * Lanza el daemon escapando del árbol de procesos llamador.
 * Por qué: en Windows, un hijo spawneado (aunque sea detached+unref) sigue en el
 * mismo job object que la terminal que corre este script, y esa terminal espera
 * para siempre (el comando "se tranca" con todo el output ya impreso).
 * Fix: crearlo vía WMI (proceso dueño = servicio winmgmt, fuera del job) con
 * fallback al spawn clásico si WMI no existe. Retorna true si se lanzó.
 */
function launchDaemonBreakaway(logPath) {
  if (process.platform === "win32") {
    try {
      // wmic: las comillas internas van con backslash (`\"`). El estilo
      // `""x""` es de cmd, no de wmic — con espacios en el path (p. ej.
      // "Estudiante UCU") el parse se rompía en el primer espacio.
      const inner = `cd /d "${ROOT}" && "${process.execPath}" --import tsx "${TS_ENTRY}" >> "${logPath}" 2>&1`;
      const wmic = `wmic process call create "cmd /c ${inner.replace(/"/g, '\\"')}"`;
      const out = execSync(wmic, { encoding: "utf-8", timeout: 15000 });
      if (/ProcessId\s*=\s*(\d+)/i.test(out)) return true;
      console.warn(`[factory] wmic no devolvió ProcessId, usando spawn clásico`);
    } catch (e) {
      console.warn(`[factory] wmic falló (${e instanceof Error ? e.message.slice(0, 80) : String(e)}), usando spawn clásico`);
    }
  }
  try {
    const outFd = fs.openSync(logPath, "a");
    const errFd = fs.openSync(logPath, "a");
    const child = spawn(process.execPath, ["--import", "tsx", TS_ENTRY], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      env: { ...process.env },
      windowsHide: true,
    });
    child.unref();
    try {
      fs.closeSync(outFd);
    } catch {}
    try {
      fs.closeSync(errFd);
    } catch {}
    return true;
  } catch {
    return false;
  }
}

async function cmdRestart() {
  const pids = findListeningPids();
  if (pids.length === 0) {
    console.log(`[factory] no se detectó PID escuchando en ${RANGE_START}-${RANGE_END} (netstat vacío o ya caído)`);
  } else {
    console.log(`[factory] matando PID(s): ${pids.join(", ")}`);
    for (const pid of pids) {
      const ok = killPid(pid);
      console.log(`[factory] ${ok ? "killed" : "no se pudo matar"} PID ${pid}`);
    }
  }
  // Espera a que el health caiga (máx ~5s) para no duplicar instancia.
  for (let i = 0; i < 10; i++) {
    const found = await findHealthyPort();
    if (!found) break;
    await sleep(500);
  }
  await sleep(1000);

  const logPath = path.join(os.tmpdir(), `factory-daemon-${Date.now()}.log`);
  console.log(`[factory] levantando daemon detached (logs: ${logPath})…`);
  const launched = launchDaemonBreakaway(logPath);
  if (!launched) {
    console.error(`[factory] no se pudo lanzar el daemon (revisá ${logPath})`);
    return 1;
  }

  // Espera a que el health vuelva (máx ~20s).
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const found = await findHealthyPort();
    if (found) {
      const b = found.body && typeof found.body === "object" ? found.body : {};
      console.log(
        `[factory] OK http://127.0.0.1:${found.port}/factory/health buildId=${String(b.buildId ?? "?")} (logs: ${logPath})`,
      );
      return 0;
    }
  }
  console.error(`[factory] el daemon no respondió en ${RANGE_START}-${RANGE_END} tras reiniciar (revisá ${logPath})`);
  return 1;
}

/**
 * Ola 20 (E1): `validate` — valida factory/ en disco SIN tocar procesos.
 * 1) Si hay daemon sano, usa su GET /factory/definition/status ( trae buildId).
 * 2) Si no (daemon caído = caso normal en dev), corre el validador TS local
 *    en un proceso hijo vía tsx (mismo loader que el daemon, sin side-effects:
 *    validar es solo lectura).
 * Imprime `file:line rule message` por línea + resumen. Exit 1 si !valid
 * (solo los `error` bloquean; los `warn` no), 0 si valid, 2 si no pudo validar.
 * Nunca lanza: todo fallo de IO es exit 2 con mensaje.
 */
async function probeDefinitionStatus(port, timeoutMs = 2000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/factory/definition/status`, { signal: ctrl.signal });
      if (!res.ok) return null;
      try {
        const body = await res.json();
        return body && typeof body === "object" ? body : null;
      } catch {
        return null;
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

function printDefinitionReport(payload, buildId) {
  try {
    const issues = payload && Array.isArray(payload.issues) ? payload.issues : [];
    for (const i of issues) {
      const file = i && typeof i.file === "string" && i.file ? i.file : "factory/";
      const line = i && typeof i.line === "number" && Number.isInteger(i.line) ? `:${i.line}` : "";
      const rule = i && typeof i.rule === "string" && i.rule ? i.rule : "?";
      const msg = i && typeof i.message === "string" ? String(i.message).replace(/\s+/g, " ").trim() : "";
      const sev = i && i.severity === "warn" ? "warn" : "error";
      console.log(`${file}${line} ${rule} [${sev}] ${msg}`);
    }
    const errors = issues.filter((i) => i && i.severity !== "warn").length;
    const warns = issues.filter((i) => i && i.severity === "warn").length;
    const valid = payload && payload.valid === true && errors === 0;
    const at = payload && typeof payload.checkedAt === "string" ? payload.checkedAt : "?";
    const bid = typeof buildId === "string" && buildId ? ` buildId=${buildId}` : "";
    if (valid) {
      console.log(`[factory] definition válida: 0 errores, ${warns} warnings (checkedAt=${at}${bid})`);
      return 0;
    }
    console.log(`[factory] definition INVÁLIDA: ${errors} errores, ${warns} warnings (checkedAt=${at}${bid})`);
    return 1;
  } catch (e) {
    console.error(`[factory] no se pudo imprimir el reporte: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

function runLocalValidate() {
  try {
    const entry = path.join(ROOT, "headless-runtime", "factory", "definitionValidate.ts");
    const code =
      `import(${JSON.stringify(pathToFileURL(entry).href)}).then((m) => {` +
      ` const issues = m.validateDefinition();` +
      ` console.log(JSON.stringify({ valid: issues.filter((i) => i && i.severity === "error").length === 0, issues, checkedAt: new Date().toISOString() }));` +
      `}).catch((e) => {` +
      ` console.log(JSON.stringify({ valid: false, issues: [{ file: "factory/", rule: "validate-crashed", message: String((e && e.message) || e).slice(0, 200), severity: "error" }], checkedAt: new Date().toISOString() }));` +
      `});`;
    const r = spawnSync(process.execPath, ["--import", "tsx", "-e", code], {
      cwd: ROOT,
      timeout: 25000,
      encoding: "utf-8",
      windowsHide: true,
    });
    const out = String(r.stdout ?? "").trim();
    if (!out) {
      const err = String(r.stderr ?? "").trim().slice(0, 300) || String(r.error ?? "sin salida del validador");
      console.error(`[factory] validate local sin salida (${err})`);
      return 2;
    }
    let payload = null;
    try {
      payload = JSON.parse(out.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).join("\n") || out);
    } catch {
      console.error(`[factory] validate local devolvió salida no-JSON (${out.slice(0, 200)})`);
      return 2;
    }
    return printDefinitionReport(payload, null);
  } catch (e) {
    console.error(`[factory] validate local falló: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

async function cmdValidate() {
  try {
    const found = await findHealthyPort();
    if (found) {
      const payload = await probeDefinitionStatus(found.port, 2000);
      if (payload && Array.isArray(payload.issues)) {
        const b = typeof payload.buildId === "string" && payload.buildId
          ? payload.buildId
          : (found.body && typeof found.body.buildId === "string" ? found.body.buildId : undefined);
        return printDefinitionReport(payload, b);
      }
    }
  } catch {
    // daemon inalcanzable o respuesta rota → validate local (best-effort)
  }
  return runLocalValidate();
}

const cmd = String(process.argv[2] ?? "status").toLowerCase();

// Deadline duro: el script SIEMPRE termina (éxito o error), nunca cuelga.
// Sin esto, handles abiertos (tsx loader, timers) pueden dejar el loop vivo
// y la terminal llamadora esperando para siempre.
const HARD_DEADLINE_MS = 55000;
const deadline = setTimeout(() => {
  console.error(`[factory] deadline ${HARD_DEADLINE_MS}ms excedido — saliendo a la fuerza`);
  process.exit(1);
}, HARD_DEADLINE_MS);
try {
  if (typeof deadline.unref === "function") deadline.unref();
} catch {}
try {
  if (process.stdin && typeof process.stdin.pause === "function") process.stdin.pause();
} catch {}

let code = 2;
try {
  if (cmd === "status") {
    code = await cmdStatus();
  } else if (cmd === "restart") {
    code = await cmdRestart();
  } else if (cmd === "validate") {
    code = await cmdValidate();
  } else {
    console.error(`[factory] comando desconocido: ${cmd} (usá: status|restart|validate)`);
    code = 2;
  }
} catch (e) {
  console.error(`[factory] error: ${e instanceof Error ? e.message : String(e)}`);
  code = 1;
}
clearTimeout(deadline);
process.exit(code);
