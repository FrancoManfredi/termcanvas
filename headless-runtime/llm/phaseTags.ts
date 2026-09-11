/**
 * phaseTags — etiquetas humanas de fase al principio de cada mensaje LLM.
 *
 * Flujo simple (sin reintentos): implement → review → revise → review.
 * Cada builder antepone UNA línea `[FASE: ...]` al texto que envía. Puro,
 * cero imports, cero efectos: importable desde headless y renderer sin
 * ciclos. Nunca lanza.
 */

/** Antepone la etiqueta como primera línea (separada por línea en blanco). */
export function withPhaseTag(text: string, tag: string): string {
  try {
    const t = typeof tag === "string" ? tag.trim() : "";
    if (t.length === 0) return typeof text === "string" ? text : "";
    const body = typeof text === "string" ? text : "";
    return `${t}\n\n${body}`;
  } catch {
    try {
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    }
  }
}

export const TAG_IMPLEMENT_FIRST =
  "[FASE: IMPLEMENT inicial — Este es el primer mensaje para implementar el issue]";

export function tagImplementRevise(attempt: number | null): string {
  try {
    const suffix =
      typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0
        ? ` (tras review intento ${attempt})`
        : "";
    return `[FASE: IMPLEMENT revise — Estos son cambios pedidos por el reviewer${suffix}]`;
  } catch {
    return "[FASE: IMPLEMENT revise — Estos son cambios pedidos por el reviewer]";
  }
}

export function tagReview(attempt: number): string {
  try {
    const n =
      typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0
        ? attempt
        : 1;
    return `[FASE: REVIEW intento ${n} — Revisión del cambio del builder]`;
  } catch {
    return "[FASE: REVIEW — Revisión del cambio del builder]";
  }
}

export const TAG_REVIEW_REPAIR =
  "[FASE: REVIEW repair — Reenvío del veredicto en JSON, no re-ejecutar la revisión]";

export const TAG_TRIAGE_FIRST =
  "[FASE: TRIAGE inicial — Clasificación del pedido (qué camino sigue)]";

export const TAG_TRIAGE_REPAIR =
  "[FASE: TRIAGE repair — Reenvío de la clasificación en JSON]";

export const TAG_SPEC_FIRST =
  "[FASE: SPEC inicial — Especificación a partir del pedido]";

export const TAG_SPEC_REWORK =
  "[FASE: SPEC rework — Ajuste del brief pedido por el humano]";

export const TAG_FOREMAN =
  "[FASE: FOREMAN — Decisión de camino del job]";

export function tagScorer(scorerName: string, manual: boolean): string {
  try {
    const name =
      typeof scorerName === "string" && scorerName.trim().length > 0
        ? scorerName.trim()
        : "desconocido";
    return `[FASE: JUEZ ${name} — Calificación de una sola pregunta (${manual ? "manual" : "automática"})]`;
  } catch {
    return "[FASE: JUEZ — Calificación de una sola pregunta]";
  }
}

export const TAG_ANALYSIS =
  "[FASE: ANÁLISIS — Propuesta de mejora desde fallos de scorers]";

/** Etiqueta derivada del phaseId de entrevista (undefined = sin tag). */
export function tagInterviewPhase(phaseId: unknown): string {
  try {
    switch (phaseId) {
      case "brief":
        return "[FASE: ENTREVISTA brief — Síntesis del brief]";
      case "requirements":
        return "[FASE: ENTREVISTA requirements — Pregunta de requerimientos]";
      case "gapCheck":
        return "[FASE: ENTREVISTA gap-check — Verificación de huecos]";
      case "asrReview":
        return "[FASE: ENTREVISTA asr-review — Revisión de lo escuchado]";
      case "synthesis":
        return "[FASE: ENTREVISTA synthesis — Síntesis final]";
      case "tactics":
        return "[FASE: ENTREVISTA tactics — Análisis de tácticas]";
      default:
        return "";
    }
  } catch {
    return "";
  }
}

export const TAG_CANVAS_RESOLVE =
  "[FASE: CANVAS resolver — Implementación del issue desde el canvas]";

export const TAG_CANVAS_REVIEW =
  "[FASE: CANVAS review — Revisión del cambio desde el canvas]";

export const TAG_CANVAS_FIX =
  "[FASE: CANVAS fix — Corrección pedida por el reviewer desde el canvas]";

export const TAG_CANVAS_CONFLICT =
  "[FASE: CANVAS conflicto — Resolución de conflicto con main]";

export const TAG_PLANNING =
  "[FASE: PLANNING — Sesión de planificación]";
