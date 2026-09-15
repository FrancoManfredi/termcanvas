/**
 * AgentSessions — Ola 16 (Paridad Warp: continuidad conversacional, IMPORTANTÍSIMA).
 *
 * UNA sesión por (job, rol) reutilizada entre turnos: el rebuild continúa la
 * conversación del implement, el re-review la del reviewer, el foreman la suya.
 * Ante daemon reiniciado (server efímero nuevo = sesiones viejas muertas):
 * renovación LAZY con evento visible "sesión renovada (la anterior expiró)",
 * nunca masiva ni silenciosa (riesgo §3.5).
 *
 * Semántica (inmovible, ver contrato de la Ola 16):
 * - Flag OFF → `create()` + `promptWith()` directo, sin guardar,
 *   `{renewed:false}` (comportamiento viejo exacto, Regla 8).
 * - Flag ON sin guardada → `create()`, guardar, `promptWith()` (fallo →
 *   lanza, cero reintentos extra: el caller aplica su fallo-sano).
 * - Flag ON con guardada → `promptWith(saved)`; éxito → `{saved,res,false}`;
 *   fallo not-found → `create()`, guardar, evento timeline best-effort,
 *   UN solo `promptWith(new)` → `{new,res,true}`; otro fallo → lanza.
 * - Flag ON con guardada + `expectAgent` (espejo en disco) → UNA lectura
 *   best-effort de identidad; mismatch EXPLÍCITO → renovación por el mismo
 *   canal (1 create, mismo evento); duda → reutilizar como siempre.
 * - Cotas Regla 7: ≤1 create y ≤2 prompts por llamada, siempre. Sin loops,
 *   sin polling, sin TTL, sin reintentos más allá del renewal único.
 *
 * Persistencia: Map en memoria + `WorkItem.agentSessions` vía store
 * (job.json, evidencia en disco Regla 5). Best-effort, nunca lanza.
 *
 * ESM puro, TypeScript estricto, cero require().
 */

import { getFactoryConfig } from "../factory/agentLoader";
import { factoryAgentExists } from "../factory/opencodeAgentSync";
import {
  isSessionAgentRole,
  SESSION_AGENT_ROLES,
  type SessionAgentRole,
} from "../../shared/roles";
import { workItemStore } from "../workItem/workItemStore";

/**
 * Roles con sesión propia por job (espejo de `WorkItem.agentSessions`).
 * FASE 1 E2 (C6/C7): re-export de `shared/roles` (fuente única, valores
 * intactos). Dirección agentSessions→roles, nunca al revés.
 */
export type AgentRole = SessionAgentRole;

/**
 * Predicado de rol (FASE 1 E2: delega en `isSessionAgentRole` de
 * `shared/roles`; semántica intacta: case-sensitive, fail-closed).
 */
function isAgentRole(value: unknown): value is AgentRole {
  try {
    return isSessionAgentRole(value);
  } catch {
    return false;
  }
}

// ── Interruptor (Regla 8) ──

/**
 * Seam SOLO para tests: fuerza el flag sin tocar factory.yaml.
 * `null` = sin override (lee el yaml real). Espejo de
 * `setCostTrackingOverrideForTests` (Ola 15).
 */
let agentSessionsOverride: boolean | null = null;

export function setAgentSessionsOverrideForTests(
  value: boolean | null,
): void {
  agentSessionsOverride = value;
}

export function resetAgentSessionsOverrideForTests(): void {
  agentSessionsOverride = null;
}

/**
 * Flag `agentSessions` de factory.yaml (default true). Apagado =
 * comportamiento viejo exacto (sesión nueva por llamada). Nunca lanza:
 * ante cualquier fallo, default `true` (continuidad encendida).
 */
export function isAgentSessionsEnabled(): boolean {
  try {
    if (agentSessionsOverride !== null) return agentSessionsOverride;
    const cfg = getFactoryConfig();
    return cfg?.agentSessions !== false;
  } catch {
    return true;
  }
}

// ── Memoria en memoria + respaldo en store ──

/** Map en memoria: `${jobId}::${role}` → sessionId. */
const memorySessions = new Map<string, string>();

function memKey(jobId: string, role: AgentRole): string {
  return `${jobId}::${role}`;
}

/** Limpia el Map en memoria (solo tests). Aditivo, no parte del contrato. */
export function resetAgentSessionsMemoryForTests(): void {
  try {
    memorySessions.clear();
  } catch {
    // noop
  }
}

/**
 * Olvida las sesiones de un job en todos los roles (teardown del discard:
 * el job deja de existir, sus conversaciones no se reutilizan más).
 * Solo memoria (el respaldo en store muere con el job.json borrado).
 * Nunca lanza.
 */
export function removeAgentSessionsForJob(jobId: string): void {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return;
    const roles: readonly string[] = [...SESSION_AGENT_ROLES];
    roles.forEach((role) => {
      try {
        memorySessions.delete(`${jobId}::${role}`);
      } catch {
        // una clave rota nunca frena a las demás
      }
    });
  } catch {
    // nunca lanza
  }
}

/**
 * Devuelve el sessionId guardado para (job, rol), o null si no hay.
 * Memoria primero, respaldo en store (hidrata la memoria). Nunca lanza.
 */
export function getAgentSession(
  jobId: string,
  role: AgentRole,
): string | null {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return null;
    if (!isAgentRole(role)) return null;
    const key = memKey(jobId, role);
    try {
      const mem = memorySessions.get(key);
      if (typeof mem === "string" && mem.length > 0) return mem;
    } catch {
      // sigue al respaldo en store
    }
    try {
      const stored = workItemStore.getAgentSession(jobId, role);
      if (typeof stored === "string" && stored.length > 0) {
        try {
          memorySessions.set(key, stored);
        } catch {
          // noop
        }
        return stored;
      }
    } catch {
      // noop: sin respaldo
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Guarda el sessionId para (job, rol). Best-effort: Map en memoria +
 * persiste en `WorkItem.agentSessions` vía store (job inexistente →
 * memoria solo). Nunca lanza.
 */
export function setAgentSession(
  jobId: string,
  role: AgentRole,
  sessionId: string,
): void {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return;
    if (!isAgentRole(role)) return;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    try {
      memorySessions.set(memKey(jobId, role), sessionId);
    } catch {
      // noop
    }
    try {
      workItemStore.setAgentSession(jobId, role, sessionId);
    } catch {
      // best-effort: disco nunca rompe el flujo
    }
  } catch {
    // nunca lanza
  }
}

// ── Detección de sesión muerta ──

/**
 * Patrones del server ante sesión inexistente/expirada (cualquier SDK o
 * forma de error). Comparación case-insensitive por substring.
 */
const SESSION_NOT_FOUND_PATTERNS: readonly string[] = [
  "session not found",
  "session_not_found",
  "unknown session",
  "invalid session",
  "session expired",
  "no such session",
  "session does not exist",
];

/**
 * Extrae texto comparable de un error desconocido (Error, string, objeto
 * SDK con `{error}`, etc.). Nunca lanza.
 */
function extractErrorText(error: unknown): string {
  try {
    if (typeof error === "string") return error;
    if (error instanceof Error) {
      const cause = (error as { cause?: unknown }).cause;
      const extra =
        typeof cause === "string"
          ? ` ${cause}`
          : cause instanceof Error
            ? ` ${cause.message}`
            : "";
      return `${error.message}${extra}`;
    }
    if (error && typeof error === "object") {
      const rec = error as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of ["message", "error", "code", "status"]) {
        const value = rec[key];
        if (typeof value === "string" && value.length > 0) {
          parts.push(value);
        } else if (typeof value === "number") {
          parts.push(String(value));
        } else if (value && typeof value === "object") {
          try {
            parts.push(JSON.stringify(value));
          } catch {
            // noop
          }
        }
      }
      if (parts.length > 0) return parts.join(" ");
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }
    return String(error ?? "");
  } catch {
    return "";
  }
}

/**
 * True si el error indica sesión inexistente/expirada (case-insensitive).
 * Cualquier otro fallo (timeout, red, 500, zod) → false: el caller aplica
 * su fallo-sano sin renovar. Nunca lanza.
 */
export function isSessionNotFoundError(error: unknown): boolean {
  try {
    const text = extractErrorText(error).toLowerCase();
    if (text.length === 0) return false;
    return SESSION_NOT_FOUND_PATTERNS.some((pattern) =>
      text.includes(pattern),
    );
  } catch {
    return false;
  }
}

// ── Lectura de identidad de sesión ──

/**
 * Índice de forma de `session.get` que funcionó (o `"none"` si ninguna):
 * evita repetir RPCs fallidos en cada turno. Solo tests lo resetean.
 */
let getShapeHint: number | "none" | null = null;

/** Reset del hint de forma (solo tests). Nunca lanza. */
export function resetSessionAgentShapeForTests(): void {
  try {
    getShapeHint = null;
  } catch {
    // noop
  }
}

/**
 * Lee el `agent` de una sesión vía duck-typing del objeto session del SDK
 * (prueba formas canónica, plana y posicional; parsea envelope data-or-direct).
 * Nunca lanza: null = desconocido, y ante duda el caller REUTILIZA (jamás se
 * renueva por una lectura fallida). La forma que funciona queda memoizada.
 */
export async function readSessionAgent(sessionObj: unknown, sessionId: string): Promise<string | null> {
  try {
    if (!sessionObj || typeof sessionObj !== "object") return null;
    const sid = String(sessionId ?? "").trim();
    if (!sid) return null;
    const get = (sessionObj as Record<string, unknown>).get;
    if (typeof get !== "function") return null;
    if (getShapeHint === "none") return null;
    const shapes: unknown[] = [{ path: { sessionID: sid } }, { sessionID: sid }, sid];
    const order =
      getShapeHint === null
        ? [0, 1, 2]
        : [getShapeHint, ...[0, 1, 2].filter((i) => i !== getShapeHint)];
    for (const i of order) {
      try {
        const res: unknown = await (get as (a: unknown) => Promise<unknown>).call(sessionObj, shapes[i]);
        const data =
          res !== null && typeof res === "object" && "data" in (res as Record<string, unknown>)
            ? (res as Record<string, unknown>).data
            : res;
        const agent = (data as { agent?: unknown } | null | undefined)?.agent;
        try {
          getShapeHint = i;
        } catch {
          // noop
        }
        return typeof agent === "string" && agent.trim().length > 0 ? agent.trim() : null;
      } catch {
        // probar siguiente forma
      }
    }
    try {
      getShapeHint = "none";
    } catch {
      // noop
    }
    return null;
  } catch {
    return null;
  }
}

// ── Helper principal ──

/**
 * Promptea en la sesión del (job, rol) con renovación lazy ante sesión
 * muerta. Cotas (Regla 7): ≤1 create y ≤2 `promptWith` por llamada,
 * siempre; sin loops (un solo `if` de renewal, cero `while`/`for`/polling).
 *
 * `expectAgent` + `getAgent` (opcionales, aditivos): cuando el rol exige
 * identidad y hay espejo en disco, la sesión guardada se verifica con UNA
 * lectura; mismatch explícito → renovación por el mismo canal. Sin ellos,
 * comportamiento viejo exacto.
 */
export async function promptInAgentSession<T>(opts: {
  jobId: string;
  role: AgentRole;
  create: () => Promise<string>;
  promptWith: (sessionId: string) => Promise<T>;
  expectAgent?: string;
  getAgent?: (sessionId: string) => Promise<string | null>;
  hasMirror?: (name: string) => boolean;
}): Promise<{ sessionId: string; res: T; renewed: boolean }> {
  const { jobId, role, create, promptWith, expectAgent, getAgent } = opts;
  let hasMirrorFn: (name: string) => boolean;
  try {
    hasMirrorFn = typeof opts.hasMirror === "function" ? opts.hasMirror : factoryAgentExists;
  } catch {
    hasMirrorFn = factoryAgentExists;
  }

  let enabled = false;
  try {
    enabled = isAgentSessionsEnabled();
  } catch {
    enabled = false;
  }

  // Flag OFF (Regla 8): comportamiento viejo exacto, sin guardar nada.
  if (!enabled) {
    const sessionId = await create();
    const res = await promptWith(sessionId);
    return { sessionId, res, renewed: false };
  }

  let saved: string | null = null;
  try {
    saved = getAgentSession(jobId, role);
  } catch {
    saved = null;
  }

  // Sin guardada: crear, guardar, promptear (fallo → lanza, cero reintentos).
  if (!saved) {
    const sessionId = await create();
    try {
      setAgentSession(jobId, role, sessionId);
    } catch {
      // best-effort
    }
    const res = await promptWith(sessionId);
    return { sessionId, res, renewed: false };
  }

  // Renovación lazy (UNA sola vez): crea fresco, guarda, evento visible,
  // promptea. Mismo canal para sesión muerta e identidad de rol vieja.
  const renew = async (oldId: string): Promise<{ sessionId: string; res: T; renewed: boolean }> => {
    const fresh = await create();
    try {
      setAgentSession(jobId, role, fresh);
    } catch {
      // best-effort
    }
    try {
      workItemStore.appendAgentSessionRenewed(jobId, role, oldId, fresh);
    } catch {
      // best-effort: el evento nunca rompe el flujo
    }
    const res = await promptWith(fresh);
    return { sessionId: fresh, res, renewed: true };
  };

  // Con guardada + identidad exigida (definición factory existente): UNA
  // lectura best-effort. Mismatch EXPLÍCITO → renovar; duda (lectura falla o
  // sin agent) → reutilizar como siempre. Sin expectAgent/getAgent: intacto.
  if (saved && expectAgent && getAgent) {
    try {
      if (hasMirrorFn(expectAgent)) {
        const cur = await getAgent(saved);
        if (typeof cur === "string" && cur.length > 0 && cur !== expectAgent) {
          return await renew(saved);
        }
      }
    } catch {
      // verificación best-effort: ante duda se reutiliza, jamás se renueva
    }
  }

  // Con guardada: reutilizar la conversación.
  try {
    const res = await promptWith(saved);
    return { sessionId: saved, res, renewed: false };
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    // Sesión muerta (daemon reiniciado): renovación lazy, UNA sola vez.
    return await renew(saved);
  }
}
