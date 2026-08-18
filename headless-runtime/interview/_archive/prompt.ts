// Construcción del prompt de cada turno. El modelo recibe UNICAMENTE el
// estado compacto del ledger (nunca el transcript): mapa de tópicos,
// resumen de las últimas respuestas y contradicciones pendientes.

import type { InterviewAnswer, InterviewLedger } from "./types.ts";
import { pendingContradictions } from "./ledger.ts";

export const RECENT_ANSWERS_LIMIT = 5;
export const FREE_TEXT_SUMMARY_LIMIT = 80;

function summarizeAnswer(answer: InterviewAnswer): string {
  const selectedLabel =
    answer.options_presented.find((option) => option.id === answer.selected_option_id)?.label ?? null;
  let response: string;
  if (selectedLabel !== null) {
    response = selectedLabel;
  } else if (answer.free_text && answer.free_text.trim().length > 0) {
    const text = answer.free_text.trim();
    response = text.length > FREE_TEXT_SUMMARY_LIMIT ? `${text.slice(0, FREE_TEXT_SUMMARY_LIMIT)}…` : text;
  } else {
    response = "(sin respuesta)";
  }
  return `- [${answer.topic_id}] ${answer.question_text} → ${response} (implica: ${answer.implies})`;
}

export function buildRecentAnswersSummary(ledger: InterviewLedger, limit = RECENT_ANSWERS_LIMIT): string {
  const recent = ledger.answers.slice(-limit);
  if (recent.length === 0) return "(no hay respuestas todavía)";
  return recent.map(summarizeAnswer).join("\n");
}

// Template del sistema, texto exacto del contrato. Las partes entre {} se
// interpolan con datos del ledger actual.
export function buildTurnPrompt(ledger: InterviewLedger): string {
  const topicsJson = JSON.stringify(ledger.topics, null, 2);
  const pendingJson = JSON.stringify(pendingContradictions(ledger), null, 2);

  return `Sos un analista de requerimientos senior entrevistando al dueño de un proyecto de software.
Tu objetivo: generar la SIGUIENTE pregunta de la entrevista, una sola, en formato estructurado.

REGLAS:
- Si la última respuesta fue vaga o no medible (ej: "rápido", "fácil de usar", "seguro"),
  tu próxima pregunta NO avanza de tópico: repreguntá el MISMO tópico pidiendo un número,
  un umbral, o una condición concreta, con topic_action=drill_down.
- Si detectás que la nueva respuesta contradice una respuesta anterior (comparando contra el
  campo "implies" de las respuestas previas en el ledger), tu próxima pregunta es
  topic_action=resolve_contradiction, presentando ambas versiones como opciones para que el
  usuario elija cuál vale (con sus propios "implies" reflejando cada alternativa).
- Priorizá tópicos con status "open_vague" e "in_contradiction" con mayor urgencia que abrir
  tópicos nuevos de menor prioridad.
- Si el usuario mencionó un flujo de trabajo nuevo (en texto libre o al elegir una opción que
  lo revele) y no existe un tópico core_flow para ese flujo en el ledger, generá una pregunta
  con topic_action=open_new_topic, topic_id nuevo con prefijo "flow.", topic_category="core_flow".
- Nunca reformules una pregunta sobre un tópico con status "closed" salvo que sea
  topic_action=resolve_contradiction.
- El campo "options" siempre ofrece alternativas concretas y mutuamente diferenciadas — nunca
  una opción tipo "otro" como salida, el usuario ya tiene el campo de texto libre para eso.
- Marcá asr_candidate implícitamente eligiendo topic_category="nonfunctional" cuando la pregunta
  trate sobre una restricción que podría forzar una decisión de arquitectura (concurrencia,
  consistencia de datos, latencia, disponibilidad, seguridad de acceso).

CONTEXTO DEL PROYECTO (leé este archivo si existe, no asumas su contenido):
${ledger.project_context_path}

MAPA DE TÓPICOS Y SU ESTADO ACTUAL (JSON):
${topicsJson}

ÚLTIMAS 5 RESPUESTAS (resumen corto, no transcript completo):
${buildRecentAnswersSummary(ledger)}

CONTRADICCIONES PENDIENTES SIN RESOLVER (JSON):
${pendingJson}

Generá la siguiente pregunta.`;
}
