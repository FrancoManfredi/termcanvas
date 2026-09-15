import type { FactoryAgentCreateInput } from "../../../lib/factoryClient";
import { AGENT_TOOL_OPTIONS } from "./agentDraft";

/**
 * newAgentForm — lógica pura del alta de agentes (sin DOM).
 * La usan el diálogo de alta y las suites (cero render).
 * El tipo siempre es CUSTOM (está oculto en la UI), mode primary y hooks
 * neutralizados: el editor de detalle ajusta lo demás tras el alta.
 */

export { AGENT_TOOL_OPTIONS };

/** Ids core: nunca se eliminan (el pipeline los asume fijos). */
export const CORE_AGENT_IDS: readonly string[] = [
  "foreman",
  "triage",
  "spec",
  "implement",
  "review",
];

export function isCoreAgentId(id: unknown): boolean {
  try {
    return typeof id === "string" && (CORE_AGENT_IDS as readonly string[]).includes(id.trim());
  } catch {
    return false;
  }
}

export interface NewAgentForm {
  name: string;
  description: string;
  tools: string[];
  model: string;
  body: string;
}

export const EMPTY_NEW_AGENT_FORM: NewAgentForm = {
  name: "",
  description: "",
  tools: ["read", "glob", "grep"],
  model: "",
  body: "",
};

/**
 * Valida el formulario (puro, testeable sin DOM). Devuelve errores en el
 * idioma de la UI (inglés, como el resto del panel).
 */
export function validateNewAgentInput(form: NewAgentForm): string[] {
  const errors: string[] = [];
  try {
    const name = (form.name ?? "").trim();
    if (!name) {
      errors.push("Name is required.");
    } else if (!/^[a-z0-9-]+$/i.test(name) || name.length > 64) {
      errors.push("Name must be [a-z0-9-], max 64 chars (no spaces or slashes).");
    }
    if (!(form.description ?? "").trim()) errors.push("Description is required.");
    if (!(form.body ?? "").trim()) errors.push("Prompt is required.");
    if (!Array.isArray(form.tools) || form.tools.length === 0) {
      errors.push("Pick at least one tool.");
    } else {
      const unknown = form.tools.filter((t) => !AGENT_TOOL_OPTIONS.includes(t));
      if (unknown.length > 0) errors.push(`Unknown tools: ${unknown.join(", ")}.`);
    }
    const model = (form.model ?? "").trim();
    if (model && !/^.+\/.+$/.test(model)) errors.push("Model must look like provider/model.");
  } catch {
    errors.push("Invalid form.");
  }
  return errors;
}

export function newAgentFormToInput(form: NewAgentForm): FactoryAgentCreateInput {
  const frontmatter: Record<string, unknown> = {
    description: form.description.trim(),
    agentType: "CUSTOM",
    mode: "primary",
    tools: [...form.tools],
    skills: [],
    mcps: [],
    stage: "none",
    blocking: false,
  };
  if (form.model.trim()) frontmatter.model = form.model.trim();
  return { name: form.name.trim(), frontmatter, body: form.body.trim() };
}
