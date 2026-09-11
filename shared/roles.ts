/**
 * Roles canónicos del Factory (FASE 1 E1 — fuente única).
 *
 * Reglas que honra (MASTER-PLAN-MODULARIDAD.md):
 * - C6 vocabulario único: este archivo es LA única fuente de listas de roles
 *   (agente factory / sesión por job / tools / scorer). Cualquier otro archivo
 *   que hoy define los suyos es legacy y migra en F1-E2/F2-F4 (ver
 *   tests/import-sweep-roles.test.ts, que los registra como excepción).
 * - C7 nada duplicado: a partir de F1-E2 los consumidores (toolPolicy,
 *   agentSessions, types/scorer, agentLoader, definitionValidate,
 *   workItemStore) importan de acá y NO redefinen.
 * - C1 ESM/cotas: ESM puro, cero `require()`, cero loops (predicados vía
 *   Set.has, O(1)), nunca lanza (todas las funciones son fail-closed con
 *   try/catch).
 * - C2 funciones puras fail-safe: solo datos + predicados puros, sin
 *   runtime/disco/red, sin leer factory.yaml, sin efectos.
 *
 * Decisión de dirección (por lectura, pedida en la tarea):
 * - `headless-runtime/runner/toolPolicy.ts` hoy NO importa nada (cero
 *   imports): no depende de roles futuros. Por eso la dirección es
 *   `toolPolicy → shared/roles` (E2 la cablea en F1-E2) y NUNCA
 *   `shared/roles → toolPolicy` (este archivo NO importa toolPolicy ni nada
 *   de headless-runtime; solo tipos de `shared/`, y de hecho cero imports).
 * - El mapeo rol→toolset-nombre vive acá como canónico (`ROLE_TO_TOOLSET_NAME`
 *   + `toolsetNameFor` con la MISMA semántica fail-closed que toolPolicy:
 *   solo `implement` —case-insensitive, trim— es `implement`, todo lo demás
 *   es `readonly`). toolPolicy migrará a delegar en este mapa; la duplicación
 *   temporal queda registrada como excepción legacy en el sweep.
 */

/**
 * Roles de agente factory (mayúsculas, fuente: headless-runtime/factory/agentLoader.ts `AGENT_TYPES`).
 * `CUSTOM` (paridad Warp: tipo default para agentes definidos por el usuario)
 * vale para hooks declarativos; los 5 core conservan su tipo fijo.
 */
export const FACTORY_AGENT_ROLES = [
  "FOREMAN",
  "TRIAGE",
  "SPEC",
  "IMPLEMENT",
  "REVIEW",
  "VERIFY",
  "CUSTOM",
] as const;

/** Un rol de agente factory. */
export type FactoryAgentRole = (typeof FACTORY_AGENT_ROLES)[number];

/** Roles de sesión por job (minúsculas, fuente: headless-runtime/sessions/agentSessions.ts + workItemStore KNOWN_AGENT_ROLES + shared/types/workItem.ts AgentSessionsSchema). */
export const SESSION_AGENT_ROLES = [
  "foreman",
  "triage",
  "spec",
  "implement",
  "review",
] as const;

/** Un rol con sesión propia por job. */
export type SessionAgentRole = (typeof SESSION_AGENT_ROLES)[number];

/** Roles de tools (fuente: headless-runtime/runner/toolPolicy.ts `ToolRole`). */
export const TOOL_ROLES = [
  "triage",
  "spec",
  "review",
  "foreman",
  "mvp-tracking",
  "interview",
  "implement",
] as const;

/** Un rol conocido por la política de tools. */
export type ToolRoleCanonical = (typeof TOOL_ROLES)[number];

/** Roles de scorer (fuente: shared/types/scorer.ts `SCORER_AGENT_ROLES`, orden original preservado). */
export const SCORER_ROLES = [
  "implement",
  "review",
  "verification",
  "triage",
  "spec",
  "foreman",
] as const;

/** Un rol que un scorer puede juzgar. */
export type ScorerRoleCanonical = (typeof SCORER_ROLES)[number];

/** Nombre canónico del toolset: solo dos existen (espejo de toolPolicy, sin importarlo). */
export type ToolsetNameCanonical = "readonly" | "implement";

/**
 * Mapa inmutable rol→nombre de toolset (la compuerta canónica).
 * Solo `implement` obtiene escritura; todo lo demás es `readonly`.
 */
export const ROLE_TO_TOOLSET_NAME: Readonly<Record<string, ToolsetNameCanonical>> = {
  triage: "readonly",
  spec: "readonly",
  review: "readonly",
  foreman: "readonly",
  "mvp-tracking": "readonly",
  interview: "readonly",
  implement: "implement",
} as const;

const FACTORY_AGENT_SET: ReadonlySet<string> = new Set(FACTORY_AGENT_ROLES as readonly string[]);
const SESSION_AGENT_SET: ReadonlySet<string> = new Set(SESSION_AGENT_ROLES as readonly string[]);
const TOOL_SET: ReadonlySet<string> = new Set(TOOL_ROLES as readonly string[]);
const SCORER_SET: ReadonlySet<string> = new Set(SCORER_ROLES as readonly string[]);

/**
 * True si el valor es un rol de agente factory (mayúsculas exactas). Puro, nunca lanza.
 */
export function isFactoryAgentRole(value: unknown): value is FactoryAgentRole {
  try {
    return typeof value === "string" && FACTORY_AGENT_SET.has(value);
  } catch {
    return false;
  }
}

/**
 * True si el valor es un rol de sesión por job. Puro, nunca lanza.
 */
export function isSessionAgentRole(value: unknown): value is SessionAgentRole {
  try {
    return typeof value === "string" && SESSION_AGENT_SET.has(value);
  } catch {
    return false;
  }
}

/**
 * True si el valor es un rol de tools. Puro, nunca lanza.
 */
export function isToolRole(value: unknown): value is ToolRoleCanonical {
  try {
    return typeof value === "string" && TOOL_SET.has(value);
  } catch {
    return false;
  }
}

/**
 * True si el valor es un rol de scorer. Puro, nunca lanza.
 */
export function isScorerRole(value: unknown): value is ScorerRoleCanonical {
  try {
    return typeof value === "string" && SCORER_SET.has(value);
  } catch {
    return false;
  }
}

/**
 * True si el valor es un rol conocido en CUALQUIERA de las cuatro listas.
 * Case-sensitive a propósito (`foreman` ≠ `FOREMAN`: listas distintas,
 * dominios distintos). Fail-closed: null/undefined/no-string/"" → false.
 * Puro, nunca lanza.
 */
export function isKnownRole(value: unknown): boolean {
  try {
    if (typeof value !== "string" || value.length === 0) return false;
    return (
      FACTORY_AGENT_SET.has(value) ||
      SESSION_AGENT_SET.has(value) ||
      TOOL_SET.has(value) ||
      SCORER_SET.has(value)
    );
  } catch {
    return false;
  }
}

/**
 * Nombre del toolset para un rol. Puro, nunca lanza.
 * Solo `implement` (case-insensitive, con trim) obtiene escritura; todo lo
 * demás —incluidos roles desconocidos/vacíos/no-string— cae a `readonly`
 * (fail-closed a lectura). Semántica idéntica a toolPolicy.toolsetNameFor
 * para que E2 pueda delegar sin cambiar formas.
 */
export function toolsetNameFor(role: unknown): ToolsetNameCanonical {
  try {
    if (typeof role === "string" && role.trim().toLowerCase() === "implement") {
      return "implement";
    }
  } catch {
    // cae a readonly
  }
  return "readonly";
}
