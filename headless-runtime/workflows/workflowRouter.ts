/**
 * WorkflowRouter (F7) — el Resolve del panel deja de hardcodear
 * `factory-default`: un one-shot al LLM elige entre los workflows
 * resolubles con solo el pedido del issue.
 *
 * Fallback SIEMPRE a `factory-default` (nunca bloquea el Resolve ni inventa
 * un workflow): error, timeout, JSON ilegible, nombre desconocido o router
 * apagado (`TERMCANVAS_WORKFLOW_ROUTER=off`).
 */

import { extractBalancedJSONObject, stripJsonFences } from "../llm/jsonExtract";
import { getDefaultModels } from "../factory/agentLoader";
import { resolveAgentModel } from "../factory/opencodeAgentSync";
import {
  discoverWorkflows,
  loadWorkflow,
  parseWorkflowDefinition,
} from "./loader";
import { createOpencodeAiRunner, type AiNodeRunner, type AiNodeResponse } from "./nodes/ai";

/**
 * Fallback cuando el repo no tiene ningún workflow tagueado `routable`:
 * los 3 pipelines oficiales de siempre.
 */
export const ROUTABLE_WORKFLOWS: readonly string[] = [
  "factory-default",
  "fix-issue",
  "plan-approve-implement",
];

export const FALLBACK_WORKFLOW = "factory-default";

export interface WorkflowRouteDecision {
  workflow: string;
  reason: string;
  routedBy: "llm" | "fallback";
  /** Sesión OpenCode del router (identidad foreman); ausente en fallback. */
  sessionId?: string;
}

export interface WorkflowRouteInput {
  itemId: string;
  prompt: string;
  worktree: string;
  repoRoot: string;
  /** Dato mínimo del issue (`#N — URL`) para el prompt del router. */
  issueText?: string;
  /** Runner IA inyectable (tests); default: OpenCode embebido. */
  runner?: AiNodeRunner;
  /** Timeout del one-shot (default 20s). */
  timeoutMs?: number;
}

interface RoutableCatalogEntry {
  name: string;
  description: string;
}

/**
 * Workflows que el router puede elegir: los tagueados `routable` en el YAML
 * (bundled/global/repo). Agregar un workflow = tirar el YAML con el tag.
 * Sin ninguno tagueado cae al fallback histórico. Nunca lanza.
 */
export function listRoutableWorkflows(repoRoot: string): string[] {
  const out: string[] = [];
  try {
    const discovered = discoverWorkflows({ repoRoot });
    for (const entry of discovered.values()) {
      try {
        const def = parseWorkflowDefinition(entry.source, entry.filePath);
        if (
          Array.isArray(def.tags) &&
          def.tags.includes("routable")
        ) {
          out.push(def.name);
        }
      } catch {
        // workflow inválido: no se ofrece
      }
    }
  } catch {
    // sin discovery: cae al fallback
  }
  if (out.length > 0) return out.sort();
  return [...ROUTABLE_WORKFLOWS];
}

/** Catálogo resolubles (workflow ausente/roto → no se ofrece). Nunca lanza. */
function catalogFor(repoRoot: string): RoutableCatalogEntry[] {
  const out: RoutableCatalogEntry[] = [];
  for (const name of listRoutableWorkflows(repoRoot)) {
    try {
      const loaded = loadWorkflow(name, { repoRoot });
      out.push({
        name,
        description: loaded.def.description || name,
      });
    } catch {
      // ausente en este repo: no se ofrece
    }
  }
  return out;
}

function fallback(reason: string): WorkflowRouteDecision {
  return {
    workflow: FALLBACK_WORKFLOW,
    reason: reason.slice(0, 300),
    routedBy: "fallback",
  };
}

/** JSON directo → fences → objeto balanceado embebido. Null si no hay nada usable. */
function parseDecision(
  raw: string,
  allowed: ReadonlySet<string>,
): { workflow: string; reason: string } | null {
  try {
    const candidates: string[] = [raw];
    const stripped = stripJsonFences(raw);
    if (stripped !== raw) candidates.push(stripped);
    const extracted = extractBalancedJSONObject(raw);
    if (extracted !== null) candidates.push(extracted);
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const workflow =
          typeof parsed.workflow === "string" ? parsed.workflow.trim() : "";
        if (!allowed.has(workflow)) continue;
        const reason =
          typeof parsed.reason === "string"
            ? parsed.reason.trim().slice(0, 300)
            : "";
        return { workflow, reason };
      } catch {
        // siguiente candidato
      }
    }
  } catch {
    // nunca lanza
  }
  return null;
}

/**
 * Quita el bloque `## SCOPE` del prompt del panel: son reglas de orquestador
 * (worktree, no-PR) que ya viven en los agent.md y no aportan al ruteo.
 * Pura, nunca lanza.
 */
function stripScopeBlock(prompt: string): string {
  try {
    const idx = prompt.search(/^##\s+SCOPE\s*$/m);
    if (idx < 0) return prompt;
    return prompt.slice(0, idx).trimEnd();
  } catch {
    return prompt;
  }
}

function buildRouterPrompt(
  prompt: string,
  catalog: RoutableCatalogEntry[],
  issueText?: string,
): string {
  const lines = catalog.map((c) => `- ${c.name}: ${c.description}`).join("\n");
  const issueLine =
    typeof issueText === "string" && issueText.trim() !== ""
      ? [`Issue: ${issueText.trim()}`, ""]
      : [];
  return [
    "Workflows disponibles:",
    lines,
    "",
    ...issueLine,
    "Pedido:",
    stripScopeBlock(prompt).slice(0, 4000),
    "",
    'Respondé SOLO un JSON: {"workflow":"<nombre exacto>","reason":"<por qué, breve>"}',
  ].join("\n");
}

/**
 * Elige el workflow para un item. Siempre resuelve (nunca lanza): ante
 * cualquier problema devuelve `factory-default` con `routedBy: "fallback"`.
 */
export async function selectWorkflowForItem(
  input: WorkflowRouteInput,
): Promise<WorkflowRouteDecision> {
  try {
    if ((process.env.TERMCANVAS_WORKFLOW_ROUTER ?? "") === "off") {
      return fallback("router off (TERMCANVAS_WORKFLOW_ROUTER=off)");
    }
    const catalog = catalogFor(input.repoRoot);
    if (catalog.length === 0) {
      return fallback("sin workflows resolubles en este repo");
    }
    const allowed = new Set(catalog.map((c) => c.name));
    const runner = input.runner ?? createOpencodeAiRunner();
    const timeoutMs =
      typeof input.timeoutMs === "number" && input.timeoutMs > 0
        ? input.timeoutMs
        : 45_000;
    // Precedencia de modelo (fix: el modelo del agente foreman que el usuario
    // configura se ignoraba acá y siempre ganaba el yaml): el agente manda;
    // factory.yaml solo es fallback cuando el agente no pinea modelo.
    let model: string | undefined;
    try {
      model = resolveAgentModel("foreman") ?? getDefaultModels().foreman;
    } catch {
      model = undefined;
    }
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const raced = Promise.race([
      runner({
        runId: `router-${input.itemId}`,
        nodeId: "route",
        cwd: input.worktree,
        prompt: buildRouterPrompt(input.prompt, catalog, input.issueText),
        // Identidad foreman: el system prompt/rubric sale de
        // factory/agents/foreman/agent.md (editable desde la página de Agents).
        agent: "foreman",
        ...(model ? { model } : {}),
        outputFormat: {
          type: "object",
          properties: {
            workflow: { type: "string", enum: catalog.map((c) => c.name) },
            reason: { type: "string" },
          },
          required: ["workflow", "reason"],
        },
        timeoutMs,
        repoRoot: input.repoRoot,
        workflowDir: input.repoRoot,
        scopeDir: input.repoRoot,
      }),
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(
          () => reject(new Error("router timeout")),
          timeoutMs + 500,
        );
      }),
    ]);
    let response: AiNodeResponse;
    try {
      response = await raced;
    } finally {
      if (timeoutTimer !== null) {
        try {
          clearTimeout(timeoutTimer);
        } catch {
          // noop
        }
      }
    }
    const parsed = parseDecision(response.output ?? "", allowed);
    if (parsed === null) return fallback("respuesta del router inválida");
    const sessionId =
      typeof response.sessionId === "string" && response.sessionId !== ""
        ? response.sessionId
        : undefined;
    return {
      workflow: parsed.workflow,
      reason: parsed.reason || "elegido por el router",
      routedBy: "llm",
      ...(sessionId !== undefined ? { sessionId } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(`router falló: ${message.slice(0, 160)}`);
  }
}
