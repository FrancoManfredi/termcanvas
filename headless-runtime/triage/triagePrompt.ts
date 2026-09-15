/**
 * TriagePrompt — Ola 8.
 * Prompt del Triage-agent con json_schema strict + parse tolerante fences→zod.
 * Puro, sin I/O: solo datos (las reglas viven en el espejo
 * factory/agents/triage/agent.md), testeable.
 */

import { z } from "zod";
import type { WorkItem } from "../../shared/types/workItem";
import {
  TriageDecisionSchema,
  TriageComplexitySchema,
  type TriageFindings,
} from "../../shared/types/triage";
import { TAG_TRIAGE_FIRST, withPhaseTag } from "../llm/phaseTags";
import { extractBalancedJSONObject, stripJsonFences } from "../llm/jsonExtract";

export { TriageDecisionSchema, TriageComplexitySchema, type TriageFindings };

/**
 * Esquema LLM-only de triage (lo que devuelve el agente, sin contexto daemon).
 */
export const TriageLLMResponseSchema = z.object({
  decision: TriageDecisionSchema,
  scope: z.string().max(2000).default(""),
  complexity: TriageComplexitySchema,
  openQuestions: z.array(z.string().min(1).max(500)).max(10).default([]),
  reason: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1),
});

export type TriageLLMResponse = z.infer<typeof TriageLLMResponseSchema>;

/**
 * json_schema strict para session.prompt (SDK v2).
 * Obliga a {decision, scope, complexity, openQuestions, reason, confidence}.
 */
export const triageJsonSchema = {
  type: "object" as const,
  properties: {
    decision: {
      type: "string" as const,
      enum: ["building", "spec", "triage"],
      description:
        "building = claro y ejecutable directo; spec = necesita brief con criterios antes de Building; triage = ambiguo, necesita humano",
    },
    scope: {
      type: "string" as const,
      description: "Alcance estimado en 1-2 frases (qué tocaría el cambio)",
    },
    complexity: {
      type: "string" as const,
      enum: ["trivial", "simple", "complex"],
      description: "trivial = 1 paso obvio; simple = pocos archivos; complex = diseño abierto o muchos archivos",
    },
    openQuestions: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Preguntas concretas para el humano (vacío si decision=building)",
    },
    reason: {
      type: "string" as const,
      description: "Explicación humana breve (1-2 frases) del porqué de la decisión",
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "Confianza 0..1",
    },
  },
  required: ["decision", "scope", "complexity", "openQuestions", "reason", "confidence"] as const,
  additionalProperties: false as const,
};

/**
 * Construye el prompt para el Triage-agent.
 * Incluye prompt original, worktree y modelo del job (mismo modelo, sin disjoint).
 */
export function buildTriagePrompt(
  workItem: Pick<WorkItem, "id" | "prompt" | "worktree" | "modelRef">,
  repoContext?: string,
): string {
  const promptBlock = (workItem.prompt ?? "").slice(0, 4000) || "(vacío)";
  const worktreeBlock =
    workItem.worktree && workItem.worktree.trim().length > 0
      ? workItem.worktree
      : "(no especificado — evaluar solo claridad del prompt)";
  const modelRefStr = workItem.modelRef
    ? `${workItem.modelRef.providerID}/${workItem.modelRef.modelID}`
    : "(mismo modelo del job)";
  const modelRefLine =
    workItem.modelRef && `${workItem.modelRef.providerID}`.trim()
      ? `Modelo del job: ${modelRefStr}.`
      : "";
  const contextBlock =
    repoContext && repoContext.trim().length > 0
      ? `\n\nContexto repo:\n${repoContext.slice(0, 2000)}`
      : "";

  // Turno único de datos: el agente (system prompt del espejo con las
  // reglas de factory/agents/triage/agent.md) ya sabe clasificar; el turno
  // lleva id, issue, worktree (lo explora con lectura), cierre y el shape
  // del bloque (las keys exactas viven acá, no en el body: una sola fuente).
  const slim = [
    `WorkItem: ${workItem.id}.`,
    modelRefLine,
    `Prompt original: """${promptBlock}"""`,
    `Worktree: ${worktreeBlock}`,
    contextBlock,
    "",
    "Clasificá ahora (prosa clara + bloque ```json al final):",
    'Cerrá con UN bloque ```json con las keys exactas: {"decision": "building|spec|triage", "scope": "...", "complexity": "trivial|simple|complex", "openQuestions": ["..."], "reason": "...", "confidence": 0.85}',
  ]
    .filter(Boolean)
    .join("\n");
  return withPhaseTag(slim, TAG_TRIAGE_FIRST);
}

/**
 * Parsea respuesta cruda del LLM (strip fences, extracción balanceada con
 * preferencia a objetos con `decision`) y valida con zod.
 * Tolerante a mayúsculas/espacios en decision y complexity.
 * Throw si inválido — el caller (triageAgent) hace UN repair retry en
 * sesión y solo entonces cae a fallback building.
 */
export function parseTriageLLMResponse(raw: string): TriageLLMResponse {
  if (!raw || typeof raw !== "string") throw new Error("triage LLM response vacía");
  const s = stripJsonFences(raw);
  if (s.length === 0) throw new Error("triage LLM response vacía");
  const extracted = extractBalancedJSONObject(s, ["decision"]);
  if (extracted === null) {
    throw new Error(`triage JSON parse error: no object — raw=${raw.slice(0, 1000)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch (e) {
    throw new Error(
      `triage JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw=${raw.slice(0, 1000)}`,
    );
  }
  // Normalización tolerante: decision/complexity en mayúsculas o con espacios.
  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.decision === "string") rec.decision = rec.decision.trim().toLowerCase();
    if (typeof rec.complexity === "string") rec.complexity = rec.complexity.trim().toLowerCase();
    if (!Array.isArray(rec.openQuestions)) rec.openQuestions = [];
  }
  return TriageLLMResponseSchema.parse(parsed);
}

/**
 * Valida que un objeto sea TriageLLMResponse sin lanzar fences (para tests).
 */
export function validateTriageLLMPayload(payload: unknown): TriageLLMResponse {
  return TriageLLMResponseSchema.parse(payload);
}

export const TriageDecisionValues = ["building", "spec", "triage"] as const;
export const TriageComplexityValues = ["trivial", "simple", "complex"] as const;
