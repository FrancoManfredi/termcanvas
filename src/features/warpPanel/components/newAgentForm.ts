import type { FactoryAgentCreateInput } from "../../../lib/factoryClient";

/**
 * newAgentForm — lógica pura del alta de agentes (sin DOM).
 * La usan la sección de creación y las suites (cero render).
 * Vocabularios espejados del backend: `toolPolicy.AGENT_TOOL_KEYS`,
 * `agentLoader.AGENT_STAGES` y `shared/roles FACTORY_AGENT_ROLES`
 * (CUSTOM). Si el backend cambia, estos tests gritan.
 */

export const AGENT_TOOL_OPTIONS: readonly string[] = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "webfetch",
];

export const AGENT_STAGE_OPTIONS: readonly string[] = [
  "none",
  "pre-build",
  "post-build",
  "post-review",
];

/** Tipos elegibles al crear (los 5 core son singletons con tipo fijo). */
export const AGENT_TYPE_OPTIONS: readonly string[] = ["VERIFY", "CUSTOM"];

/** Slots hook posicionados sobre el pipeline (para el StagePicker visual). */
export interface PipelineHookSlot {
  stage: string;
  label: string;
  hint: string;
}

export const PIPELINE_HOOK_SLOTS: readonly PipelineHookSlot[] = [
  { stage: "pre-build", label: "pre-build", hint: "Triage → Building" },
  { stage: "post-build", label: "post-build", hint: "Building → Review" },
  { stage: "post-review", label: "post-review", hint: "Review → Complete" },
];

export const CORE_PIPELINE_STAGES: readonly string[] = [
  "Intake",
  "Foreman",
  "Triage",
  "Building",
  "Review",
  "Complete",
];

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
  agentType: string;
  tools: string[];
  stage: string;
  blocking: boolean;
  model: string;
  body: string;
}

export const EMPTY_NEW_AGENT_FORM: NewAgentForm = {
  name: "",
  description: "",
  agentType: "VERIFY",
  tools: ["read", "glob", "grep"],
  stage: "post-review",
  blocking: false,
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
    if (!AGENT_STAGE_OPTIONS.includes(form.stage)) errors.push("Invalid stage.");
    if (!AGENT_TYPE_OPTIONS.includes(form.agentType)) errors.push("Invalid agent type.");
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
    agentType: form.agentType,
    mode: "all",
    tools: [...form.tools],
    stage: form.stage,
    blocking: form.stage === "none" ? false : form.blocking,
  };
  if (form.model.trim()) frontmatter.model = form.model.trim();
  return { name: form.name.trim(), frontmatter, body: form.body.trim() };
}
