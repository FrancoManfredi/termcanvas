/**
 * OpencodeServerManager — Singleton dueño del lifecycle del server opencode efímero.
 * Gao Ola 3 Real: levanta createOpencodeServer con encontrarPuertoServidor(20000,45000,12)
 * hint 20274 (OPENCODE_EPHEMERAL_HINT), health-check GET /provider 800ms x2,
 * si falla cierra zombie CLOSE_WAIT y resortea.
 * Expone getClient() / getUrl() para Factory, Foreman e ImplementAgent.
 * Mantiene compatibilidad con setTestClient para tests (mock injection).
 *
 * Puerto 20274 es hint documentado dentro de [20000,45000]; si libre se usa,
 * si ocupado se sortea. Nunca hardcode 4096. Tools Implement: read/write/edit/bash/glob/grep/webfetch.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { exec, spawn } from "node:child_process";
import { daemonGuardrailPermission } from "../shared/agentGuardrails.ts";
import { buildFactoryAgentsConfig, resolveFactorySkillsDir } from "./factory/opencodeAgentSync";
import { getAgentDefsFingerprint, getAgentDefsRevision } from "./factory/agentLoader";
import { markAgentsDirty } from "./factory/agents/agentDirty";
import { encontrarPuertoServidor, OPENCODE_EPHEMERAL_HINT } from "./interview/puerto-libre.ts";

const SERVER_START_TIMEOUT_MS = 30_000;
// Health generoso: un server recién creado bajo carga puede tardar segundos en
// servir /provider (5MB+). Matarlo por "lento" crea espiral de spawns. Solo se
// considera zombie si NO responde tras varios intentos largos.
const HEALTH_TIMEOUT_MS = 3000;
const HEALTH_RETRIES = 3;
const HEALTHY_CACHE_MS = 30_000;
const SERVER_START_RETRIES = 3;

interface ServerHandle {
  url: string;
  close: () => void;
  /** PID del proceso lanzado (wrapper). Útil para cleanup externo. */
  pid?: number;
}

let runningServer: ServerHandle | null = null;
let runningClient: OpencodeClient | null = null;
let runningUrl: string | null = null;
let runningPort: number | null = null;
let startedAt: number | null = null;
/**
 * Revisión de agentes con la que nació el singleton (`agentDefsRevision` al
 * spawnear). Los turnos de agente la comparan con la vigente: si cambió,
 * corren en un server scopeado fresco en vez del singleton stale (fix
 * PLATANO: la config de agentes aplica al próximo turno aunque la cola esté
 * ocupada). null = sin singleton (sin comparación posible).
 */
let runningAgentsRevision: number | null = null;

/**
 * Huella de disco de los agentes al spawnear el singleton (mtime+size de
 * `factory/agents/<name>/agent.md`). Cubre ediciones a mano que no pasan por la
 * API (sin bump de revisión). null = sin singleton.
 */
let runningAgentsFingerprint: number | null = null;

// Test seam: permite inyectar cliente mock sin levantar server real (igual que harness)
let testClientOverride: OpencodeClient | null = null;
let testUrlOverride: string | null = null;

// Guarda anti-spawn: concurrentes comparten el mismo ensure en curso
let pendingEnsure: Promise<OpencodeClient> | null = null;
// Último error de ensure (visible en GET /factory/health → opencode.error)
let lastError: string | null = null;
// Última vez que el server pasó health-check (evita re-chequear en cada job)
let lastHealthyAt = 0;

export function setTestClient(client: OpencodeClient | null, url?: string | null): void {
  if (runningServer) {
    try {
      runningServer.close();
    } catch {}
    runningServer = null;
  }
  testClientOverride = client;
  testUrlOverride = url ?? null;
  if (client) {
    runningClient = client;
    runningUrl = url ?? "http://127.0.0.1:4096";
    runningPort = null;
    startedAt = Date.now();
    runningAgentsRevision = null;
    runningAgentsFingerprint = null;
  } else {
    runningClient = null;
    runningUrl = null;
    runningPort = null;
    startedAt = null;
    runningAgentsRevision = null;
    runningAgentsFingerprint = null;
  }
}

/**
 * Health-check activo: GET /provider 800ms x2, fallback a /session.
 * Considera healthy si fetch no lanza network error (incluso 404), porque indica
 * que el server está escuchando y no es zombie CLOSE_WAIT. Solo network/timeout/abort
 * indican zombie y deben resortea. Cumple spec 800ms x2 como mínimo.
 */
async function healthCheck(url: string): Promise<boolean> {
  // Dar 800ms al server recién creado para que termine de bindear antes del primer probe (cold start)
  await new Promise((r) => setTimeout(r, 800));
  for (let attempt = 0; attempt < HEALTH_RETRIES; attempt++) {
    // Intento 1: /provider
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      const r = await fetch(`${url}/provider`, {
        signal: ctrl.signal as unknown as AbortSignal,
        headers: { Accept: "application/json" },
      }).catch(() => null);
      clearTimeout(t);
      if (r) return true;
    } catch {}
    // Intento 2: /session (algunas versiones no exponen /provider)
    try {
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), HEALTH_TIMEOUT_MS);
      const r2 = await fetch(`${url}/session`, {
        signal: ctrl2.signal as unknown as AbortSignal,
        headers: { Accept: "application/json" },
      }).catch(() => null);
      clearTimeout(t2);
      if (r2) return true;
    } catch {}
    if (attempt < HEALTH_RETRIES - 1) {
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  return false;
}

/**
 * Config base del server efímero de TermCanvas: guardrails de permiso +
 * agentes factory INLINE (`Config.agent`), nunca a disco — el opencode del
 * usuario no los ve en ninguna carpeta. `TERMCANVAS_DAEMON_ASK_PERMISSIONS=1`
 * restaura los prompts de permiso. Nunca lanza.
 */
export function buildBaseServerConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  try {
    if ((process.env.TERMCANVAS_DAEMON_ASK_PERMISSIONS ?? "") !== "1") {
      config.permission = daemonGuardrailPermission();
    }
  } catch {
    // sin permission: opencode usa su default
  }
  try {
    const agents = buildFactoryAgentsConfig();
    if (Object.keys(agents).length > 0) config.agent = agents;
  } catch {
    // sin agentes: la identidad estricta del engine fallará el nodo con error claro
  }
  try {
    const skillsDir = resolveFactorySkillsDir();
    if (skillsDir !== null) config.skills = { paths: [skillsDir] };
  } catch {
    // sin skills: los agentes corren sin skills nativas
  }
  return config;
}

/**
 * Une `skills.paths` de base + scope (dedup, solo strings no vacíos). El
 * scope AGREGA su scopeDir; sin esto, un nodo con skills propias dejaba
 * invisibles las skills de `factory/skills` que el agente tiene allowadas.
 * Pura, nunca lanza.
 */
function mergeSkillsPaths(
  baseSkills: unknown,
  scopeSkills: unknown,
): Record<string, unknown> | undefined {
  try {
    const asRecord = (v: unknown): Record<string, unknown> =>
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
    const b = asRecord(baseSkills);
    const s = asRecord(scopeSkills);
    const collect = (v: unknown): string[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [];
    const paths = [...new Set([...collect(s.paths), ...collect(b.paths)])];
    if (paths.length === 0) return undefined;
    return { ...b, ...s, paths };
  } catch {
    return undefined;
  }
}

/**
 * Merge config base + config scopeada por nodo (skills/mcp): `permission` se
 * FUSIONA (el scope agrega su allow de skill, no pisa los guardrails),
 * `skills.paths` se UNE (scopeDir + factory/skills) y el resto del scope pisa
 * la base. Los agentes inline SIEMPRE viajan. Pura.
 */
export function mergeServerConfig(
  scope: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const base = buildBaseServerConfig();
    const asRecord = (v: unknown): Record<string, unknown> =>
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = {
      ...base,
      ...scope,
      permission: { ...asRecord(base.permission), ...asRecord(scope.permission) },
    };
    const skills = mergeSkillsPaths(base.skills, scope.skills);
    if (skills) merged.skills = skills;
    return merged;
  } catch {
    return { ...scope };
  }
}

/**
 * Spec de spawn del binario opencode para una plataforma. En Windows el CLI
 * instalado por npm es un shim (`opencode.cmd`): `spawn("opencode", args)`
 * sin shell da ENOENT porque CreateProcess no resuelve PATHEXT para
 * `.cmd`/`.bat` (bug real: Resolve Issue quedaba en Triage con
 * "spawn opencode ENOENT"). El modo shell usa UN string de comando (sin
 * array de args → sin DEP0190); los args son constantes internas
 * (hostname/port/--version), nunca input de usuario. Pura y testeable.
 */
export function resolveOpencodeCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; shell: boolean } {
  const safeArgs = args
    .filter((arg): arg is string => typeof arg === "string" && arg.length > 0)
    .map((arg) => arg.replace(/"/g, ""));
  if (platform === "win32") {
    return {
      command: ["opencode", ...safeArgs].join(" "),
      args: [],
      shell: true,
    };
  }
  return { command: "opencode", args: safeArgs, shell: false };
}

/**
 * Spawner propio del server opencode (reemplaza al `createOpencodeServer`
 * del SDK): el SDK spawnea vía cross-spawn SIN windowsHide y en Windows con
 * el daemon detached cada arranque abre una consola (PowerShell). Este
 * spawner replica el protocolo (args + env OPENCODE_CONFIG_CONTENT +
 * parseo de "opencode server listening ...URL" en stdout) con
 * `windowsHide: true`. Nunca deja zombies: timeout → kill de árbol.
 * Exportado para el harness de interview (mismo problema, misma solución).
 */
export function spawnOpencodeServer(opts: {
  hostname: string;
  port: number;
  timeout: number;
  config: Record<string, unknown>;
}): Promise<ServerHandle> {
  return new Promise<ServerHandle>((resolve, reject) => {
    let settled = false;
    let proc: ReturnType<typeof spawn> | null = null;
    let output = "";
    // El tsconfig del repo no expone `.on` directo en ChildProcess: mismo
    // patrón de casts que verification.ts/runnerExecutor.ts. Nunca lanza.
    const onProc = (emitter: unknown, ev: string, cb: (...args: never[]) => void): void => {
      try {
        (emitter as { on: (event: string, listener: (...args: never[]) => void) => void }).on(ev, cb);
      } catch {}
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        fn();
      } catch {}
    };
    const killTree = (): void => {
      try {
        if (proc === null || proc.pid === undefined) return;
        if (process.platform === "win32") {
          try {
            const killer = spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
              windowsHide: true,
            });
            onProc(killer, "error", () => {
              try {
                proc?.kill();
              } catch {}
            });
            return;
          } catch {
            // cae al kill directo
          }
        }
        try {
          proc.kill();
        } catch {}
      } catch {}
    };
    try {
      const spec = resolveOpencodeCommand([
        "serve",
        `--hostname=${opts.hostname}`,
        `--port=${String(opts.port)}`,
      ]);
      proc = spawn(spec.command, spec.args, {
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(opts.config ?? {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        ...(spec.shell ? { shell: true } : {}),
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // Bound SERVER_START_TIMEOUT_MS (arranque del spawner propio): timeout
    // de un solo disparo, nunca se re-arma; clearTimeout en cada camino.
    const timer = setTimeout(() => {
      finish(() => {
        killTree();
        reject(new Error(`Timeout waiting for server to start after ${opts.timeout}ms`));
      });
    }, opts.timeout);
    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      try {
        output += chunk.toString();
      } catch {
        return;
      }
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          clearTimeout(timer);
          if (!match) {
            finish(() => {
              killTree();
              reject(new Error(`Failed to parse server url from output: ${line}`));
            });
            return;
          }
          const url = match[1];
          finish(() => {
            resolve({
              url,
              pid: proc?.pid,
              close: () => {
                try {
                  killTree();
                } catch {}
              },
            });
          });
          return;
        }
      }
    };
    try {
      if (proc.stdout) onProc(proc.stdout, "data", (chunk: unknown) => onData(chunk as Buffer | string));
      if (proc.stderr) onProc(proc.stderr, "data", (chunk: unknown) => onData(chunk as Buffer | string));
      onProc(proc, "exit", (code: unknown) => {
        if (settled) return;
        clearTimeout(timer);
        let msg = `Server exited with code ${String(code)}`;
        if (output.trim()) msg += `\nServer output: ${output.slice(0, 2000)}`;
        finish(() => reject(new Error(msg)));
      });
      onProc(proc, "error", (error: unknown) => {
        if (settled) return;
        clearTimeout(timer);
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
    } catch (e) {
      clearTimeout(timer);
      finish(() => {
        killTree();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    }
  });
}

async function createEphemeralServer(): Promise<ServerHandle> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < SERVER_START_RETRIES; attempt++) {
    let port: number | null = null;
    let server: ServerHandle | null = null;
    try {
      // Gao: encontrarPuertoServidor intenta OPENCODE_EPHEMERAL_HINT=20274 primero
      port = await encontrarPuertoServidor(20000, 45000, 12);
      const isHint = port === OPENCODE_EPHEMERAL_HINT;
      server = await spawnOpencodeServer({
        hostname: "127.0.0.1",
        port,
        timeout: SERVER_START_TIMEOUT_MS,
        config: buildBaseServerConfig(),
      });
      const url = (server as unknown as { url: string }).url ?? `http://127.0.0.1:${port}`;
      const healthy = await healthCheck(url);
      if (!healthy) {
        console.warn(`[OpencodeServerManager] health-check falló para ${url}, cerrando zombie CLOSE_WAIT y resorteando`);
        try {
          server.close();
        } catch {}
        lastError = new Error(`health-check failed for ${url}`);
        continue;
      }
      // Versión del BINARIO spawneado (puede divergir del SDK npm y del
      // binario del shell: el skew explica 400s como el de `format`.
      // Best-effort: nunca bloquea ni rompe el arranque. `exec` (shell)
      // porque en Windows `opencode` es un shim `.cmd` (mismo ENOENT del
      // spawner): `execFile` pelado no lo resuelve.
      try {
        exec("opencode --version", { timeout: 8000, windowsHide: true }, (err, stdout) => {
          try {
            if (!err && typeof stdout === "string" && stdout.trim() !== "") {
            }
          } catch {}
        });
      } catch {}
      return server as ServerHandle;
    } catch (err) {
      lastError = err;
      console.warn(`[OpencodeServerManager] createEphemeralServer fallo intento ${attempt + 1}: ${err instanceof Error ? err.message : String(err)}`);
      if (server) {
        try {
          server.close();
        } catch {}
      }
      if (attempt < SERVER_START_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No se pudo crear OpencodeServer tras ${SERVER_START_RETRIES} intentos`);
}

export async function ensureClient(): Promise<OpencodeClient> {
  // Si hay override de test, devolverlo sin crear server
  if (testClientOverride) {
    runningClient = testClientOverride;
    if (testUrlOverride) runningUrl = testUrlOverride;
    return testClientOverride;
  }
  // Deduplicar concurrentes: un solo spawn en curso
  if (pendingEnsure) return pendingEnsure;
  const task = (async (): Promise<OpencodeClient> => {
    if (runningClient && runningServer && runningUrl) {
      // Cache: si pasó health hace poco, no re-chequear (cada job llamaba health 2.4s+)
      if (Date.now() - lastHealthyAt < HEALTHY_CACHE_MS) return runningClient;
      const healthy = await healthCheck(runningUrl);
      if (healthy) {
        lastHealthyAt = Date.now();
        lastError = null;
        return runningClient;
      }
      console.warn(`[OpencodeServerManager] cliente existente no healthy (${runningUrl}), cerrando y recreando...`);
      try {
        runningServer.close();
      } catch {}
      runningServer = null;
      runningClient = null;
      runningUrl = null;
      runningPort = null;
      startedAt = null;
      runningAgentsRevision = null;
      runningAgentsFingerprint = null;
    }
    try {
      const server = await createEphemeralServer();
      const url = (server as unknown as { url: string }).url ?? `http://127.0.0.1:${runningPort ?? 0}`;
      const client = createOpencodeClient({ baseUrl: url } as unknown as Record<string, unknown>) as unknown as OpencodeClient;
      runningServer = server;
      runningClient = client;
      runningUrl = url;
      try {
        const u = new URL(url);
        runningPort = parseInt(u.port, 10) || null;
      } catch {
        runningPort = null;
      }
      startedAt = Date.now();
      lastHealthyAt = Date.now();
      lastError = null;
      try {
        runningAgentsRevision = getAgentDefsRevision();
      } catch {
        runningAgentsRevision = null;
      }
      try {
        runningAgentsFingerprint = getAgentDefsFingerprint();
      } catch {
        runningAgentsFingerprint = null;
      }
      try {
        console.log(
          `[OpencodeServerManager] singleton sellado rev=${String(runningAgentsRevision)} fp=${String(runningAgentsFingerprint)} (${url})`,
        );
      } catch {
        // log best-effort
      }
      return client;
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      throw e;
    }
  })();
  pendingEnsure = task;
  try {
    return await task;
  } finally {
    pendingEnsure = null;
  }
}

export function getLastError(): string | null {
  return lastError;
}

export function getClient(): OpencodeClient | null {
  if (testClientOverride) return testClientOverride;
  return runningClient;
}

export function getUrl(): string | null {
  if (testUrlOverride) return testUrlOverride;
  return runningUrl;
}

export async function getUrlAsync(): Promise<string | null> {
  if (testUrlOverride) return testUrlOverride;
  if (runningUrl && runningClient && runningServer) {
    if (Date.now() - lastHealthyAt < HEALTHY_CACHE_MS) return runningUrl;
    const healthy = await healthCheck(runningUrl);
    if (healthy) {
      lastHealthyAt = Date.now();
      return runningUrl;
    }
    try {
      await ensureClient();
      return runningUrl;
    } catch {
      return null;
    }
  }
  try {
    await ensureClient();
    return runningUrl;
  } catch {
    return null;
  }
}

export async function isHealthy(): Promise<boolean> {
  if (testClientOverride && testUrlOverride) return true;
  if (!runningUrl || !runningServer) return false;
  return healthCheck(runningUrl);
}

export function close(): void {
  if (runningServer) {
    try {
      runningServer.close();
    } catch {}
    runningServer = null;
  }
  runningClient = null;
  runningUrl = null;
  runningPort = null;
  startedAt = null;
  runningAgentsRevision = null;
  runningAgentsFingerprint = null;
}

export function getPort(): number | null {
  return runningPort;
}

export function getStartedAt(): number | null {
  return startedAt;
}

/**
 * Revisión de agentes sellada al spawnear el singleton (null = sin singleton
 * o revisión desconocida). Los nodos IA la comparan con
 * `getAgentDefsRevision()` para decidir server fresco. Nunca lanza.
 */
export function getRunningAgentsRevision(): number | null {
  try {
    return runningAgentsRevision;
  } catch {
    return null;
  }
}

/**
 * Huella de agentes sellada al spawnear el singleton (null = sin singleton).
 * Nunca lanza.
 */
export function getRunningAgentsFingerprint(): number | null {
  try {
    return runningAgentsFingerprint;
  } catch {
    return null;
  }
}

/**
 * True cuando un turno de agente debe correr en un server scopeado recién
 * nacido en vez del singleton: el nodo declara capacidades propias
 * (skills/mcp) o la revisión/huella de agentes vigente cambió desde que el
 * singleton nació (fix PLATANO: la config inline del singleton quedó con el
 * prompt anterior). Sin singleton vivo la revisión es desconocida (null) y no
 * fuerza scope: `ensureClient` bootea fresco de todos modos. Pura, nunca lanza.
 */
export function shouldUseScopedServer(opts: {
  hasNodeScope: boolean;
  currentRevision: unknown;
  singletonRevision: unknown;
  currentFingerprint?: unknown;
  singletonFingerprint?: unknown;
}): boolean {
  try {
    if (opts.hasNodeScope) return true;
    if (
      typeof opts.currentRevision === "number" &&
      typeof opts.singletonRevision === "number" &&
      opts.currentRevision !== opts.singletonRevision
    ) {
      return true;
    }
    if (
      typeof opts.currentFingerprint === "number" &&
      typeof opts.singletonFingerprint === "number" &&
      opts.currentFingerprint !== opts.singletonFingerprint
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Resultado de `ensureAgentTurnClient`: cliente + teardown del turno. */
export interface AgentTurnClient {
  client: OpencodeClient;
  /**
   * Cierra el server efímero del turno. No-op cuando el turno corre en el
   * singleton (nunca se cierra desde acá: mataría sesiones vivas de otros
   * jobs).
   */
  close: () => void;
  /** true = server scopeado recién nacido (el singleton estaba stale). */
  fresh: boolean;
}

/**
 * Cliente para UN turno de agente con config fresca garantizada:
 * - singleton si sigue vigente (revisión y huella de agentes sin cambios);
 * - server scopeado recién nacido (config de disco + scope opcional) si el
 *   singleton quedó stale. En ese caso además marca dirty: el próximo intake
 *   idle recicla el singleton (no se cierra acá porque hay sesiones vivas).
 *
 * Multi-uso: los callers DEBEN llamar `close()` en un `finally`. Nunca deja
 * el server huérfano si el spawn falla (lanza y el caller cae a su fallback).
 */
export async function ensureAgentTurnClient(opts?: {
  hasNodeScope?: boolean;
  scopeConfig?: Record<string, unknown>;
}): Promise<AgentTurnClient> {
  const hasNodeScope = opts?.hasNodeScope === true;
  let currentRevision: number | null = null;
  let currentFingerprint: number | null = null;
  let singletonRevision: number | null = null;
  let singletonFingerprint: number | null = null;
  try {
    currentRevision = getAgentDefsRevision();
  } catch {
    currentRevision = null;
  }
  try {
    currentFingerprint = getAgentDefsFingerprint();
  } catch {
    currentFingerprint = null;
  }
  try {
    singletonRevision = runningAgentsRevision;
  } catch {
    singletonRevision = null;
  }
  try {
    singletonFingerprint = runningAgentsFingerprint;
  } catch {
    singletonFingerprint = null;
  }
  const scoped = shouldUseScopedServer({
    hasNodeScope,
    currentRevision,
    singletonRevision,
    currentFingerprint,
    singletonFingerprint,
  });
  if (!scoped) {
    return { client: await ensureClient(), close: () => {}, fresh: false };
  }
  // Singleton stale (o scope propio del nodo): server recién nacido de disco.
  try {
    console.log(
      `[OpencodeServerManager] turno con server fresco: singleton rev=${String(singletonRevision)}/fp=${String(singletonFingerprint)} → vigente rev=${String(currentRevision)}/fp=${String(currentFingerprint)}`,
    );
  } catch {
    // log best-effort
  }
  try {
    markAgentsDirty();
  } catch {
    // best-effort: sin flag, el reciclado lo cubre el próximo save por API
  }
  const port = await encontrarPuertoServidor(20_000, 45_000, 12);
  const handle = await spawnOpencodeServer({
    hostname: "127.0.0.1",
    port,
    timeout: SERVER_START_TIMEOUT_MS,
    config: mergeServerConfig(opts?.scopeConfig ?? {}),
  });
  const client = createOpencodeClient({
    baseUrl: handle.url,
  } as unknown as Record<string, unknown>) as unknown as OpencodeClient;
  return {
    client,
    close: () => {
      try {
        handle.close();
      } catch {
        // teardown best-effort: el server muere con el proceso si falla
      }
    },
    fresh: true,
  };
}

// Singleton object para uso OO (Factory/Foreman esperan manager.getClient/getUrl)
export const opencodeServerManager = {
  ensureClient,
  ensureAgentTurnClient,
  getClient,
  getUrl,
  getUrlAsync,
  isHealthy,
  close,
  getPort,
  getStartedAt,
  getRunningAgentsRevision,
  getRunningAgentsFingerprint,
  shouldUseScopedServer,
  setTestClient,
  getLastError,
};

export default opencodeServerManager;
