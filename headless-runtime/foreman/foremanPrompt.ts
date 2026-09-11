/**
 * Foreman Prompt — Ola 2 P0-2.
 * Construye prompt para LLM real vía @opencode-ai/sdk con json_schema {decision, reason, confidence}.
 * Pure function + zod validación.
 *
 * ── Warp vs TermCanvas (qué se le pasa a Foreman) ──
 * Warp (ver docs/wiki Warp/WarpFactories.md §3-§7 y WARP-FOR-Reference):
 *   Foreman recibe un Work Item completo, no solo un string:
 *   - work item reference (id, source, URL)
 *   - issue/ticket original (GitHub issue, Linear/Jira, Slack thread)
 *   - findings previos de Triage (evidence, scope, complexity, open questions)
 *   - code locations relevantes (archivos, líneas, repo context)
 *   - reproduction (pasos para reproducir)
 *   - acceptance criteria (criterios de aceptación del PR)
 *   - runner/environment/host context
 *   El Foreman en Warp enruta con todo ese contexto y decide skip de stages.
 *
 * TermCanvas hoy (Ola 2-3):
 *   Solo le pasamos { prompt: string (≤4000), worktree: string (ruta del proyecto activo),
 *   modelRef: {providerID, modelID, variant} } + repoContext opcional.
 *   Es el mínimo viable para decidir building vs needs_triage sin romper pacts.
 *   Warp-level findings/codeLocations/reproduction/acceptance se dejan para futuro
 *   cuando tengamos triage/spec findings persistidos.
 *
 * Ola 3 fix + Ola 6 des-hardcodeo (H1):
 *   - Asegura que worktree sea el proyecto activo informado en runtime (activeWorktree de
 *     FactoryLabPage, resuelto desde el store/window; vacío = no especificado). El prompt lo
 *     incluye siempre y el LLM no debe bloquear por worktree no-git (el sistema hace fallback
 *     automático al directorio del proyecto activo).
 *   - Asegura prompt completo (slice 0-4000, sin truncar silenciosamente a vacío).
  *   - Distingue prompt ambiguo (needs_triage 0.8-0.9) vs infra error (error 0.5) — ver foreman.ts.
 */

import { z } from "zod";
import { stripScopeBoilerplate } from "../../shared/scope";
import type { ModelRef, WorkItem } from "../../shared/types/workItem";
import type { TriageFindings } from "../../shared/types/triage";
import type { SpecBrief } from "../../shared/types/spec";
import { TAG_FOREMAN, withPhaseTag } from "../llm/phaseTags";
import { extractBalancedJSONObject, stripJsonFences } from "../llm/jsonExtract";

// ── Schema de decisión Foreman (validación LLM) ──

export const ForemanDecisionKindSchema = z.enum(["building", "needs_triage", "needs_input"]);

export const ForemanLLMResponseSchema = z.object({
  decision: ForemanDecisionKindSchema,
  reason: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});

export type ForemanLLMResponse = z.infer<typeof ForemanLLMResponseSchema>;

/**
 * Esquema json_schema para opencode SDK — strict.
 * Usado en session.prompt para forzar JSON válido.
 */
export const foremanJsonSchema = {
  type: "object" as const,
  properties: {
    decision: {
      type: "string" as const,
      enum: ["building", "needs_triage", "needs_input"],
      description: "building = prompt claro y ejecutable; needs_triage/needs_input = falta contexto o ambiguo",
    },
    reason: {
      type: "string" as const,
      description: "Explicación humana breve (1-2 frases) del porqué de la decisión, en español rioplatense neutro",
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "Confianza 0..1 — building 0.85-0.95, needs_triage/needs_input 0.8-0.9 si prompt ambiguo (no usar 0.5 para ambiguo)",
    },
  },
  required: ["decision", "reason", "confidence"] as const,
  additionalProperties: false as const,
};

/**
 * Contexto previo opcional de Ola 8 (Triage-agent + Spec-agent).
 * Puro y aditivo: sin este parámetro el output es byte-idéntico al actual.
 */
export interface ForemanExtraContext {
  triage?: TriageFindings;
  spec?: SpecBrief;
}

/**
 * Construye el turno del Foreman: solo datos (issue + contexto + cierre).
 * Las reglas viven en el system prompt del espejo
 * (factory/agents/foreman/agent.md); el turno nunca las repite.
 * - prompt completo (0-4000 chars) preservado sin truncar a vacío: si vacío,
 *   el LLM debe decidir needs_input (no building).
 *
 * Ola 8: 3er parámetro opcional {triage?, spec?} que agrega bloques "Triage previo"
 * y "Spec aprobada".
 */
export function buildForemanPrompt(workItem: Pick<WorkItem, "prompt" | "worktree" | "modelRef"> & { prompt: string; worktree: string; modelRef?: ModelRef }, repoContext?: string, extra?: ForemanExtraContext): string {
  const promptForPrompt = (workItem.prompt ?? "").slice(0, 4000);
  // Asegurar prompt completo no vacío: si vacío, el LLM debe decidir needs_input (no building)
  const promptBlock = promptForPrompt.length > 0 ? promptForPrompt : "(vacío — falta prompt)";
  const contextBlock = repoContext && repoContext.trim().length > 0 ? `\n\nContexto repo:\n${repoContext.slice(0, 2000)}` : "";

  // Ola 8: bloques aditivos de contexto previo. "" cuando no hay contexto, de modo
  // que .filter(Boolean) los elimina y el output queda byte-idéntico al actual.
  const triageBlock = buildTriageContextBlock(extra?.triage);
  const specBlock = buildSpecContextBlock(extra?.spec);

  // Turno único de datos: el agente (system prompt del espejo con las
  // reglas de factory/agents/foreman/agent.md) ya sabe decidir; el turno
  // lleva solo el issue + contexto + cierre. El SCOPE canónico (disciplina
  // de ejecución del implement + propiedad del PR del orquestador) no
  // informa la clasificación: se retira aquí, no en el intake.
  const slim = [
    `Prompt del usuario: """${stripScopeBoilerplate(promptBlock)}"""`,
    contextBlock,
    triageBlock,
    specBlock,
    "",
    "Decidí ahora en JSON",
  ]
    .filter(Boolean)
    .join("\n");
  return withPhaseTag(slim, TAG_FOREMAN);
}

/**
 * Bloque "Triage previo" para el prompt del Foreman (Ola 8).
 * Devuelve "" si no hay findings, para preservar output idéntico sin contexto.
 */
export function buildTriageContextBlock(triage?: TriageFindings): string {
  if (!triage || typeof triage !== "object") return "";
  const lines = [
    "",
    "Triage previo (clasificación del Triage-agent, usala como contexto):",
    `- decision: ${triage.decision}`,
    `- scope: ${(triage.scope ?? "").slice(0, 500) || "(sin scope)"}`,
    `- complexity: ${triage.complexity}`,
    `- reason: ${(triage.reason ?? "").slice(0, 300)}`,
  ];
  if (Array.isArray(triage.openQuestions) && triage.openQuestions.length > 0) {
    lines.push(`- openQuestions: ${triage.openQuestions.slice(0, 5).join(" | ").slice(0, 500)}`);
  }
  return lines.join("\n");
}

/**
 * Bloque "Spec aprobada" para el prompt del Foreman (Ola 8).
 * Devuelve "" si no hay brief, para preservar output idéntico sin contexto.
 */
export function buildSpecContextBlock(spec?: SpecBrief): string {
  if (!spec || typeof spec !== "object") return "";
  const lines = [
    "",
    "Spec aprobada (brief del Spec-agent con gate humano superado, citala al decidir):",
    `- summary: ${(spec.summary ?? "").slice(0, 500)}`,
  ];
  if (Array.isArray(spec.acceptanceCriteria) && spec.acceptanceCriteria.length > 0) {
    lines.push(`- criterios: ${spec.acceptanceCriteria.slice(0, 10).join(" | ").slice(0, 800)}`);
  }
  if (Array.isArray(spec.targetFiles) && spec.targetFiles.length > 0) {
    lines.push(`- archivos: ${spec.targetFiles.slice(0, 20).join(", ").slice(0, 500)}`);
  }
  return lines.join("\n");
}

/**
 * Parsea respuesta cruda del LLM (string JSON) y valida con zod.
 * Ola 3 fix robusto: strip markdown fences, trim, busca primer { y último } y parsea ese substring.
 * Si el LLM devuelve texto + JSON (ej: "The user wants me to act as the Foreman... {\"decision\":\"building\"...}"),
 * extrae solo el objeto JSON. No parsea todo el texto.
 * Throw si inválido — caller debe fallback a needs_triage (si prompt ambiguo) o error (si infra).
 */
export function parseForemanLLMResponse(raw: string): ForemanLLMResponse {
  if (!raw || typeof raw !== "string") throw new Error("LLM response vacía");
  const jsonStr = stripJsonFences(raw);
  if (jsonStr.length === 0) throw new Error("LLM response vacía");
  // Extracción balanceada compartida (preferencia a objetos con
  // `decision`): tolera prosa + ecos de tool-call alrededor del JSON.
  const extracted = extractBalancedJSONObject(jsonStr, ["decision"]);
  if (extracted === null) {
    throw new Error(`LLM JSON parse error: no JSON object found — raw=${raw.slice(0, 1000)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    throw new Error(`LLM JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw=${raw.slice(0, 1000)}`);
  }
  const validated = ForemanLLMResponseSchema.parse(parsed);
  // Normalizar needs_input → needs_triage para WorkItemStatus Triage (single status simplifica UI)
  // Mantenemos needs_input como decision válida pero factoryServer lo mapeará a Triage
  return validated;
}

/**
 * Helper para mapear decision LLM → WorkItemStatus destino.
 * Nota: "error" de infra no viene del LLM, lo genera foreman.ts fallback; no se mapea aquí.
 */
export function mapDecisionToStatus(decision: string): "Building" | "Triage" {
  if (decision === "building") return "Building";
  return "Triage";
}
