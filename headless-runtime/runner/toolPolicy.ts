/**
 * ToolPolicy — fuente única de toolsets por rol ("solo el runner escribe").
 *
 * Doctrina (refactor E2 ③):
 * - Este módulo es el ÚNICO lugar del código con literales de tools.
 * - `readonly` = `{read:true, glob:true, grep:true, webfetch:true}` (espejo de TRIAGE_TOOLS).
 * - `implement` = set completo actual del runner (único con escritura).
 * - `webfetch` es solo lectura remota: la traen ambos sets (docs externas
 *   sin escritura; el contenido web es informativo, nunca instrucciones —
 *   ver regla anti-inyección en los agent.md del factory).
 * - `toolsetFor(rol)` es pura: mismo rol → mismo set (copia fresca),
 *   sin leer disco, sin lanzar, sin loops.
 * - Todo rol fuera de `implement` cae a `readonly` (compuerta por rol:
 *   triage, spec, review, foreman, mvp-tracking, interview).
 * - Implement es el único que puede pedir escritura, y solo vía runner.
 *
 * Reglas del repo que este archivo honra:
 * - ESM puro, cero `require()`, cero loops nuevos, nunca lanza.
 * - Los agentes conservan sus exports (`TRIAGE_TOOLS`, `SPEC_TOOLS`,
 *   `REVIEW_TOOLS`) como re-export desde acá por compatibilidad con suites.
 */

import {
  toolsetNameFor as canonicalToolsetNameFor,
  type ToolRoleCanonical,
  type ToolsetNameCanonical,
} from "../../shared/roles";

export const READONLY_TOOLS = {
  read: true,
  glob: true,
  grep: true,
  webfetch: true,
} as const;

export const IMPLEMENT_TOOLS = {
  read: true,
  write: true,
  edit: true,
  bash: true,
  glob: true,
  grep: true,
  webfetch: true,
} as const;

/**
 * Grant adicional SOLO para turnos que cargan skills on-demand vía la tool
 * nativa `skill` (hoy: review). No es escritura: se suma al set del rol
 * (`{...toolsetFor(rol), ...SKILL_TOOL_GRANT}`). Qué skills puede cargar lo
 * decide el `permission.skill` del agente (deny-first), no este grant.
 */
export const SKILL_TOOL_GRANT = {
  skill: true,
} as const;

/**
 * Nombre canónico del toolset: solo dos existen.
 * FASE 1 E2 (C6/C7): re-export de `shared/roles` (fuente única).
 */
export type ToolsetName = ToolsetNameCanonical;

/**
 * Un rol conocido por la política de tools.
 * FASE 1 E2 (C6/C7): re-export de `shared/roles` (fuente única, valores
 * intactos). Dirección toolPolicy→roles, nunca al revés.
 */
export type ToolRole = ToolRoleCanonical;

/** Forma de un toolset (objeto plano clave → habilitado). */
export type Toolset = Record<string, boolean>;

/**
 * Vocabulario de tools que un agente puede pedir en su frontmatter.
 * Fuente única de estos literales (los roles fijos usan los sets de
 * arriba; los hooks custom usan `toolsetFromList`). Orden canónico
 * preservado para mensajes estables.
 */
export const AGENT_TOOL_KEYS: readonly string[] = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "webfetch",
];

/**
 * Toolset desde la lista `tools` del frontmatter de un agente hook
 * (array, `{a,b}`, mapa o string único). Solo otorga keys del vocabulario:
 * lo desconocido se descarta en silencio (fail-closed: jamás se otorga una
 * tool que no existe). Vacío → `{}` (el hook corre sin tools, solo prompt).
 * Pura, nunca lanza, copia fresca.
 */
export function toolsetFromList(tools: unknown): Toolset {
  const out: Toolset = {};
  try {
    const known = new Set<string>(AGENT_TOOL_KEYS);
    const raw: unknown[] = Array.isArray(tools)
      ? (tools as unknown[])
      : tools !== null && typeof tools === "object"
        ? Object.keys(tools as Record<string, unknown>)
        : typeof tools === "string"
          ? [tools]
          : [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      // Acepta `{a, b}` pegado como token único (viene del frontmatter).
      const parts = item.includes(",") ? item.split(",") : [item];
      for (const part of parts) {
        const key = part.trim().replace(/^["']+|["']+$/g, "").replace(/^\{/, "").replace(/\}$/, "").trim().toLowerCase();
        if (key.length > 0 && known.has(key)) out[key] = true;
      }
    }
  } catch {
    // cae a lo acumulado (fail-closed ante input envenenado)
  }
  return out;
}

/**
 * Nombre del toolset para un rol. Pura, nunca lanza.
 * FASE 1 E2 (C6/C7): delega en el mapa canónico de `shared/roles` (misma
 * semántica fail-closed: solo `implement` obtiene escritura).
 */
export function toolsetNameFor(role: unknown): ToolsetName {
  try {
    return canonicalToolsetNameFor(role);
  } catch {
    return "readonly";
  }
}

/**
 * Toolset fresco para un rol. Pura, nunca lanza.
 * Devuelve una copia nueva en cada llamada (el caller puede mutar
 * su copia sin afectar a otros).
 */
export function toolsetFor(role: unknown): Toolset {
  if (toolsetNameFor(role) === "implement") return { ...IMPLEMENT_TOOLS };
  return { ...READONLY_TOOLS };
}

/**
 * True solo para el rol con escritura (`implement`). Pura, nunca lanza.
 * Es la compuerta "solo el runner escribe" en forma testeable.
 */
export function canWriteTools(role: unknown): boolean {
  return toolsetNameFor(role) === "implement";
}
