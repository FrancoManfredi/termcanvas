/**
 * ownership.ts — Lease de ownership del pipeline factory (F2).
 *
 * Problema real (incidente #125): dos daemons vivos (app in-process y
 * standalone de dev con `tsx --watch`) y un boot que reclama ownership
 * parkea los jobs que el OTRO daemon está corriendo. El lease responde una
 * sola pregunta: ¿hay un dueño vivo del pipeline?
 *
 * - `claimOwnership()` lo llama el boot (`ensureFactoryServer`): si el lock
 *   tiene un dueño VIVO (pid vivo + heartbeat fresco) de otro proceso, NO se
 *   reclama (el daemon arranca pasivo: sin `markPipelineLive`, sin
 *   `parkInterruptedJobs`). Si el dueño está muerto o el lock es basura, se
 *   reclama y se escribe el lock atómico (tmp→rename).
 * - `maybeHeartbeatOwnership()` refresca el heartbeat throttleado (lo llaman
 *   health y los eventos del run). TTL 90s.
 * - `releaseOwnership()` lo llama `closeFactoryServer()` (solo si somos dueños).
 *
 * Tolerante por contrato: nunca lanza, todo best-effort; ante cualquier duda
 * el claim es `true` (comportamiento histórico: parkear si el dueño anterior
 * no dejó rastro). ESM puro.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getTermCanvasDataDir,
  resolveTermCanvasInstance,
} from "../../shared/termcanvas-instance";

/** Heartbeat máximo sin el cual un lock se considera muerto (3 polls de 30s). */
export const OWNERSHIP_TTL_MS = 90_000;

/** Mínimo entre heartbeats escritos (evita un write por evento del run). */
export const OWNERSHIP_HEARTBEAT_MIN_MS = 15_000;

export interface OwnershipLock {
  pid: number;
  instance: string;
  startedAt: string;
  heartbeatAt: string;
}

let lastHeartbeatMs = 0;

/** Path del lease en el data dir de la instancia (dev/prod). Puro. */
export function buildOwnershipLockPath(dataDir?: string): string {
  const dir = dataDir ?? getTermCanvasDataDir(resolveTermCanvasInstance());
  return path.join(dir, "factory.lock");
}

/** Lee y valida el lock. Null si ausente/roto (nunca lanza). */
export function readOwnershipLock(lockPath: string): OwnershipLock | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object") return null;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) return null;
    return {
      pid: parsed.pid,
      instance: typeof parsed.instance === "string" ? parsed.instance : "",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      heartbeatAt: typeof parsed.heartbeatAt === "string" ? parsed.heartbeatAt : "",
    };
  } catch {
    return null;
  }
}

/** ¿El pid está vivo? `EPERM` cuenta como vivo (proceso de otro usuario). */
export function isProcessAlive(pid: unknown): boolean {
  try {
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code === "EPERM";
  }
}

/** ¿Hay un dueño VIVO? pid vivo + heartbeat dentro del TTL. Puro. */
export function isLockHeldByLiveOwner(
  lock: OwnershipLock | null,
  nowMs: number = Date.now(),
  ttlMs: number = OWNERSHIP_TTL_MS,
): boolean {
  try {
    if (lock === null) return false;
    if (!isProcessAlive(lock.pid)) return false;
    const beat = Date.parse(lock.heartbeatAt);
    if (Number.isNaN(beat)) return false;
    return nowMs - beat <= ttlMs;
  } catch {
    return false;
  }
}

function writeLockAtomic(lockPath: string, lock: OwnershipLock): boolean {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const tmp = `${lockPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(lock, null, 2), "utf-8");
    fs.renameSync(tmp, lockPath);
    return true;
  } catch {
    return false;
  }
}

export interface ClaimResult {
  claimed: boolean;
  lock: OwnershipLock | null;
}

/**
 * Reclama el lease: `claimed=false` solo cuando OTRO proceso vivo lo tiene
 * con heartbeat fresco. Si el lock es nuestro, está muerto o es basura,
 * se reclama (y se escribe). Nunca lanza.
 */
export function claimOwnership(
  lockPath: string,
  opts: { pid?: number; instance?: string; nowMs?: number } = {},
): ClaimResult {
  try {
    const pid = opts.pid ?? process.pid;
    const now = opts.nowMs ?? Date.now();
    const current = readOwnershipLock(lockPath);
    if (current !== null && current.pid !== pid && isLockHeldByLiveOwner(current, now)) {
      return { claimed: false, lock: current };
    }
    const lock: OwnershipLock = {
      pid,
      instance: opts.instance ?? resolveTermCanvasInstance(),
      startedAt: new Date(now).toISOString(),
      heartbeatAt: new Date(now).toISOString(),
    };
    if (!writeLockAtomic(lockPath, lock)) {
      // No se pudo escribir: fail-open (mejor pipeline activo que pipeline muerto).
      return { claimed: true, lock };
    }
    lastHeartbeatMs = now;
    return { claimed: true, lock };
  } catch {
    return { claimed: true, lock: null };
  }
}

/**
 * Refresca el heartbeat SOLO si el lock es nuestro. `force` ignora el throttle.
 * Devuelve true si el lock quedó (o ya estaba) a nuestro nombre. Nunca lanza.
 */
export function heartbeatOwnership(
  lockPath: string,
  nowMs: number = Date.now(),
  force = false,
): boolean {
  try {
    if (!force && nowMs - lastHeartbeatMs < OWNERSHIP_HEARTBEAT_MIN_MS) {
      return true;
    }
    const current = readOwnershipLock(lockPath);
    if (current === null || current.pid !== process.pid) return false;
    current.heartbeatAt = new Date(nowMs).toISOString();
    writeLockAtomic(lockPath, current);
    lastHeartbeatMs = nowMs;
    return true;
  } catch {
    return false;
  }
}

/** Refresca con throttle (health + eventos del run). Nunca lanza. */
export function maybeHeartbeatOwnership(
  lockPath: string,
  nowMs: number = Date.now(),
): boolean {
  return heartbeatOwnership(lockPath, nowMs, false);
}

/** Borra el lock SOLO si es nuestro. Nunca lanza. */
export function releaseOwnership(lockPath: string): void {
  try {
    const current = readOwnershipLock(lockPath);
    if (current === null || current.pid !== process.pid) return;
    fs.unlinkSync(lockPath);
  } catch {
    // best-effort
  }
}

/** Solo tests: resetea el throttle del heartbeat. */
export function resetOwnershipThrottleForTests(): void {
  lastHeartbeatMs = 0;
}
