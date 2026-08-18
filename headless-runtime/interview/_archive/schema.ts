// Schema JSON exacto del contrato de pregunta. Se pasa como
// `format: { type: "json_schema", schema: NEXT_QUESTION_SCHEMA }` en cada
// session.prompt para que el servidor devuelva la pregunta ya validada y
// estructurada (structured output), sin parsear texto libre.

export const NEXT_QUESTION_SCHEMA = {
  name: "next_interview_question",
  type: "object",
  properties: {
    topic_id: {
      type: "string",
      description:
        "ID del tópico del mapa de cobertura al que pertenece esta pregunta. Si es un tópico nuevo no presente en el ledger (ej. un core_flow instanciado dinámicamente), usar un id nuevo con el prefijo de categoría correspondiente.",
    },
    topic_label: {
      type: "string",
      description:
        "Nombre humano del tópico, solo requerido si topic_id es nuevo (no existe todavía en el ledger)",
    },
    topic_category: {
      type: "string",
      enum: ["vision", "core_flow", "data", "nonfunctional", "integrations", "failure_modes", "scope"],
      description: "Solo requerido si topic_id es nuevo",
    },
    topic_action: {
      type: "string",
      enum: ["open_new_topic", "drill_down", "resolve_contradiction", "close_topic"],
      description:
        "open_new_topic: primera pregunta de un tópico. drill_down: repregunta porque la respuesta anterior fue vaga. resolve_contradiction: presenta un conflicto detectado para que el usuario elija. close_topic: pregunta final que cierra un tópico ya suficientemente cubierto (puede no generarse pregunta nueva, ver nota abajo).",
    },
    question_text: {
      type: "string",
      description:
        "El texto de la pregunta, en español, dirigido directamente al usuario, en segunda persona",
    },
    why_asking: {
      type: "string",
      description:
        "Frase corta (una línea) explicando por qué se pregunta esto. Se muestra en la UI como contexto opcional bajo la pregunta.",
    },
    kind: {
      type: "string",
      enum: ["single_select", "multi_select", "free_only"],
      description:
        "free_only cuando dar opciones sería artificial (ej: nombre del proyecto, descripción libre de un caso raro)",
    },
    options: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          implies: {
            type: "string",
            description:
              "Qué implica elegir esta opción, en una frase corta. Uso interno para detección de contradicciones — no se muestra en la UI.",
          },
        },
        required: ["id", "label", "implies"],
      },
      description:
        "2 a 5 opciones concretas y mutuamente diferenciadas. Vacío si kind=free_only. El campo de texto libre está SIEMPRE disponible en la UI sin importar el kind — no generar una opción tipo 'otro' porque ya existe ese mecanismo aparte.",
    },
    contradiction_flag: {
      type: ["object", "null"],
      properties: {
        conflicting_answer_id: { type: "string" },
        explanation: { type: "string" },
      },
      description:
        "Obligatorio (no null) si topic_action=resolve_contradiction. Referencia al answer id anterior en conflicto y por qué.",
    },
    coverage_estimate: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description:
        "Estimación del modelo de cuánto del mapa de tópicos totales quedó cubierto tras responder esta pregunta. Usado para la barra de progreso en la UI (no se implementa la UI en esta tarea, pero el campo debe generarse siempre).",
    },
  },
  required: ["topic_id", "topic_action", "question_text", "kind", "options", "coverage_estimate"],
} as const;
