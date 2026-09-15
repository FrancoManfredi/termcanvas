/**
 * SpecPrompt — Ola 8.
 * Prompt del Spec-agent con json_schema strict + parse tolerante fences→zod.
 * Puro, sin I/O: solo datos (las reglas viven en el espejo
 * factory/agents/spec/agent.md),
 * testeable. Espeja la estructura de reviewPrompt sin copiar su lógica.
 */

import { z } from "zod";
import type { WorkItem } from "../../shared/types/workItem";
import type { TriageFindings } from "../../shared/types/triage";
import { SpecBriefSchema, type SpecBrief } from "../../shared/types/spec";

import {
  TAG_SPEC_FIRST,
  TAG_SPEC_REWORK,
  withPhaseTag,
} from "../llm/phaseTags";

export { SpecBriefSchema, type SpecBrief };

/**
 * Esquema LLM-only del spec (lo que devuelve el agente, sin contexto daemon).
 */
export const SpecLLMResponseSchema = SpecBriefSchema;

export type SpecLLMResponse = z.infer<typeof SpecLLMResponseSchema>;

/**
 * json_schema strict para session.prompt (SDK v2).
 * Obliga a {summary, acceptanceCriteria[≥1], targetFiles, trivial, openQuestions}.
 */
export const specJsonSchema = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string" as const,
      description: "Resumen del brief en 2-4 frases: qué se va a construir y por qué",
    },
    acceptanceCriteria: {
      type: "array" as const,
      minItems: 1,
      items: { type: "string" as const },
      description: "Criterios de aceptación verificables (qué debe pasar, no cómo), sin tope",
    },
    targetFiles: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Archivos objetivo (rutas relativas al worktree), sin tope",
    },
    trivial: {
      type: "boolean" as const,
      description: "true = cambio mínimo auto-aprobable (pocos archivos, sin diseño abierto)",
    },
    openQuestions: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Preguntas abiertas que el humano debe responder si no es trivial",
    },
  },
  required: ["summary", "acceptanceCriteria", "targetFiles", "trivial", "openQuestions"] as const,
  additionalProperties: false as const,
};

/**
 * Construye el prompt para el Spec-agent a partir del work item y,
 * cuando existe, de los findings del Triage-agent previo.
 */
export function buildSpecPrompt(
  workItem: Pick<WorkItem, "id" | "prompt" | "worktree" | "modelRef">,
  triage?: TriageFindings,
  feedback?: string,
): string {
  const promptBlock = (workItem.prompt ?? "").slice(0, 4000) || "(vacío)";
  const worktreeBlock =
    workItem.worktree && workItem.worktree.trim().length > 0
      ? workItem.worktree
      : "(no especificado — evaluar solo claridad del prompt)";
  const triageBlock = triage
    ? [
        "",
        "Triage previo (usalo como contexto, no lo contradigas sin motivo):",
        `- decision: ${triage.decision}`,
        `- scope: ${(triage.scope ?? "").slice(0, 500) || "(sin scope)"}`,
        `- complexity: ${triage.complexity}`,
        ...(triage.openQuestions && triage.openQuestions.length > 0
          ? [`- openQuestions: ${triage.openQuestions.slice(0, 5).join(" | ").slice(0, 500)}`]
          : []),
        `- reason: ${(triage.reason ?? "").slice(0, 300)}`,
      ].join("\n")
    : "";
  const cleanFeedback = typeof feedback === "string" ? feedback.trim().slice(0, 500) : "";
  const feedbackBlock =
    cleanFeedback.length > 0
      ? [
          "",
          "El humano RECHAZÓ tu brief anterior. Motivo:",
          `"""${cleanFeedback}"""`,
          "Corregí exactamente eso en el brief nuevo (criterios, archivos o summary según aplique).",
        ].join("\n")
      : "";

  // Turno único de datos: el agente (system prompt del espejo con las
  // reglas de factory/agents/spec/agent.md) ya sabe escribir briefs; el
  // turno lleva id, issue, worktree (lo explora para targetFiles), triage
  // previo, feedback humano de rechazo y el shape del bloque (las keys
  // exactas viven acá, no en el body: una sola fuente).
  const slim = [
    `WorkItem: ${workItem.id}.`,
    `Prompt original: """${promptBlock}"""`,
    `Worktree: ${worktreeBlock}`,
    triageBlock,
    feedbackBlock,
    "",
    "Escribí el brief ahora (prosa clara + bloque ```json al final):",
    'Cerrá con UN bloque ```json con las keys exactas: {"summary": "...", "acceptanceCriteria": ["..."], "targetFiles": ["..."], "trivial": false, "openQuestions": ["..."]}',
  ]
    .filter(Boolean)
    .join("\n");
  // Etiqueta humana de fase (primera línea): inicial vs rework pedido por humano.
  return withPhaseTag(
    slim,
    cleanFeedback.length > 0 ? TAG_SPEC_REWORK : TAG_SPEC_FIRST,
  );
}

/**
 * Parsea respuesta cruda del LLM (strip fences, primer { último }) y valida con zod.
 * Normaliza arrays ausentes a [] (zod exige ≥1 criterio: sigue siendo error si vacío).
 * Throw si inválido — el caller (specAgent) convierte a skip con evento trazado.
 */
export function parseSpecLLMResponse(raw: string): SpecLLMResponse {
  if (!raw || typeof raw !== "string") throw new Error("spec LLM response vacía");
  let s = raw.trim();
  if (s.length === 0) throw new Error("spec LLM response vacía");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    s = fence[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.substring(first, last + 1).trim();
  }
  if (!s.startsWith("{") || !s.endsWith("}")) {
    throw new Error(`spec JSON parse error: no object — raw=${raw.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(
      `spec JSON parse error: ${e instanceof Error ? e.message : String(e)} — raw=${raw.slice(0, 200)}`,
    );
  }
  // Normalización tolerante: arrays ausentes → [] (criterios vacíos siguen inválidos),
  // trivial como string "true"/"false" → boolean.
  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    for (const key of ["acceptanceCriteria", "targetFiles", "openQuestions"] as const) {
      if (!Array.isArray(rec[key])) rec[key] = [];
    }
    if (typeof rec.trivial === "string") {
      const t = rec.trivial.trim().toLowerCase();
      if (t === "true") rec.trivial = true;
      else if (t === "false") rec.trivial = false;
    }
    if (typeof rec.summary === "string") rec.summary = rec.summary.trim();
  }
  return SpecLLMResponseSchema.parse(parsed);
}

/**
 * Valida que un objeto sea SpecLLMResponse sin lanzar fences (para tests).
 */
export function validateSpecLLMPayload(payload: unknown): SpecLLMResponse {
  return SpecLLMResponseSchema.parse(payload);
}

export const SpecDecisionValues = ["trivial", "non-trivial"] as const;
