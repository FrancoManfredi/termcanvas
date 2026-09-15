/**
 * agents/agentDraft — lógica pura del editor de agentes (sin DOM).
 *
 * Traduce entre el shape real del daemon (`FactoryAgentFull`: frontmatter
 * parseado + body) y el `AgentDraft` editable de la UI. La UI oculta lo
 * heredado (`agentType`, `mode`, `stage`, `blocking`): el save los gestiona
 * interno (primary siempre, hooks neutralizados, tipo preservado).
 *
 * La usan el console de Agents y las suites (cero render).
 */

import type { FactoryAgentFull } from "../../../lib/factoryClient";
import type { AgentDraft } from "../types";

export const AGENT_TYPE_VOCABULARY: readonly string[] = [
  "FOREMAN",
  "TRIAGE",
  "SPEC",
  "IMPLEMENT",
  "REVIEW",
  "VERIFY",
  "CUSTOM",
];

/**
 * Tools ofrecidas en la UI (subset real de opencode; `write` es legacy y se
 * normaliza a `edit` al leer). Orden canónico para mensajes estables.
 */
export const AGENT_TOOL_OPTIONS: readonly string[] = [
  "read",
  "edit",
  "bash",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "todowrite",
  "lsp",
];

function asString(value: unknown): string {
  try {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  } catch {
    return "";
  }
}

/** Normaliza listas del frontmatter (array, record-keys o `{a, b}`). Pura. */
export function agentNameList(raw: unknown): string[] {
  try {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) {
      return (raw as unknown[]).map((v) => asString(v)).filter(Boolean);
    }
    if (typeof raw === "object") {
      return Object.keys(raw as Record<string, unknown>)
        .map((k) => k.trim())
        .filter(Boolean);
    }
    if (typeof raw === "string") {
      const t = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
      if (t.length === 0) return [];
      return t
        .split(",")
        .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Normaliza tools del archivo para la UI: `write` (legacy) se pliega en
 * `edit`, igual que hace el engine con el permiso. Dedupe, preserva orden.
 */
export function normalizeToolsForUi(raw: unknown): string[] {
  const out: string[] = [];
  for (const name of agentNameList(raw)) {
    const mapped = name.toLowerCase() === "write" ? "edit" : name.toLowerCase();
    if (!AGENT_TOOL_OPTIONS.includes(mapped)) continue;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

function normalizeAgentType(raw: unknown): string {
  const value = asString(raw).toUpperCase();
  return AGENT_TYPE_VOCABULARY.includes(value) ? value : "CUSTOM";
}

/** Draft vacío para un nombre nuevo. */
export function emptyAgentDraft(name = ""): AgentDraft {
  return {
    name: name.trim(),
    description: "",
    agentType: "CUSTOM",
    model: "",
    icon: "",
    tools: [],
    skills: [],
    mcps: [],
    prompt: "",
  };
}

/** Convierte el agente real (frontmatter + body) al draft editable. */
export function draftFromAgentFull(full: FactoryAgentFull): AgentDraft {
  const fm = full?.frontmatter ?? {};
  return {
    name: asString(full?.name),
    description: asString(fm.description),
    agentType: normalizeAgentType(fm.agentType),
    model: asString(fm.model),
    icon: asString(fm.icon),
    tools: normalizeToolsForUi(fm.tools),
    skills: agentNameList(fm.skills),
    mcps: agentNameList(fm.mcps),
    prompt: typeof full?.body === "string" ? full.body : "",
  };
}

/**
 * Frontmatter gestionado por la UI a partir del draft. Solo las claves que
 * la sección edita; el daemon preserva el resto del archivo (patch aditivo).
 * `mode` siempre primary (no existen subagentes), `stage`/`blocking`
 * neutralizan los hooks legacy, y `agentType` preserva el del archivo.
 * `model: ""` e `icon: ""` limpian el pin y el ícono.
 */
export function draftToFrontmatter(draft: AgentDraft): Record<string, unknown> {
  return {
    description: draft.description.trim(),
    agentType: draft.agentType,
    mode: "primary",
    model: draft.model.trim(),
    icon: draft.icon.trim(),
    tools: [...draft.tools],
    skills: [...draft.skills],
    mcps: [...draft.mcps],
    stage: "none",
    blocking: false,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Dirty-check por campo (sin serializar el prompt completo). El orden de las
 * listas no ensucia; cualquier cambio real sí. Junk → dirty (nunca ocultar
 * una edición).
 */
export function isAgentDraftDirty(a: AgentDraft, b: AgentDraft): boolean {
  try {
    if (!a || !b) return true;
    return (
      a.description !== b.description ||
      a.agentType !== b.agentType ||
      a.model !== b.model ||
      a.icon !== b.icon ||
      a.prompt !== b.prompt ||
      !sameSet(a.tools ?? [], b.tools ?? []) ||
      !sameSet(a.skills ?? [], b.skills ?? []) ||
      !sameSet(a.mcps ?? [], b.mcps ?? [])
    );
  } catch {
    return true;
  }
}

/** Etiqueta corta del modelo para el índice ("provider/model" → "model"). */
export function formatModelShort(model: string): string {
  const value = asString(model);
  if (!value) return "default";
  const slash = value.lastIndexOf("/");
  return slash >= 0 && slash < value.length - 1 ? value.slice(slash + 1) : value;
}
