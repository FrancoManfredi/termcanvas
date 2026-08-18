// Contratos del motor de entrevista de requerimientos adaptativa.
// Este módulo es la frontera entre el estado operativo (ledger) y el
// contrato de la pregunta; no depende del SDK de opencode ni de la UI.
// La conversación (session.messages) es auditoría; el ledger es la fuente
// de verdad operativa.

export const TOPIC_CATEGORIES = [
  "vision",
  "core_flow",
  "data",
  "nonfunctional",
  "integrations",
  "failure_modes",
  "scope",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const TOPIC_STATUSES = [
  "unopened",
  "open_new",
  "open_vague",
  "in_contradiction",
  "closed",
] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const TOPIC_ACTIONS = [
  "open_new_topic",
  "drill_down",
  "resolve_contradiction",
  "close_topic",
] as const;
export type TopicAction = (typeof TOPIC_ACTIONS)[number];

export const QUESTION_KINDS = ["single_select", "multi_select", "free_only"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export interface TopicState {
  id: string;
  label: string;
  category: TopicCategory;
  status: TopicStatus;
  priority: number;
  asr_candidate: boolean;
}

export interface QuestionOption {
  id: string;
  label: string;
  implies: string;
}

export interface ContradictionFlag {
  conflicting_answer_id: string;
  explanation: string;
}

// Contrato exacto de `format.schema` en cada session.prompt (schema
// JSON Schema real en nextQuestionSchema.ts — aquí está su shape TS).
export interface InterviewQuestion {
  topic_id: string;
  topic_label?: string;
  topic_category?: TopicCategory;
  topic_action: TopicAction;
  question_text: string;
  why_asking?: string;
  kind: QuestionKind;
  options: QuestionOption[];
  contradiction_flag: ContradictionFlag | null;
  coverage_estimate: number;
}

export interface InterviewAnswer {
  id: string;
  topic_id: string;
  question_text: string;
  options_presented: QuestionOption[];
  selected_option_id: string | null;
  free_text: string | null;
  implies: string;
  timestamp: string;
}

export interface ContradictionRecord {
  id: string;
  answer_a: string;
  answer_b: string;
  explanation: string;
  resolved: boolean;
  resolution_answer_id: string | null;
}

export interface InterviewLedger {
  session_id: string;
  project_context_path: string;
  created_at: string;
  last_turn_at: string;
  topics: TopicState[];
  answers: InterviewAnswer[];
  contradictions: ContradictionRecord[];
  // Última pregunta mostrada al usuario: el estado operativo necesita
  // poder re-renderizar la pregunta pendiente al retomar una sesión.
  last_question: InterviewQuestion | null;
}

export interface UserAnswerInput {
  topic_id: string;
  selected_option_id: string | null;
  free_text: string | null;
}

export interface InterviewSummary {
  ledgerPath: string;
  projectPath: string;
  session_id: string;
  created_at: string;
  last_turn_at: string;
  topics_total: number;
  topics_closed: number;
  answers_count: number;
  pending_contradictions: number;
}

export type InterviewEngineErrorKind =
  | "structured_output_error"
  | "invalid_question"
  | "ledger_corrupt"
  | "server_unavailable"
  | "model_request_failed";

export class InterviewEngineError extends Error {
  readonly kind: InterviewEngineErrorKind;
  readonly payload: unknown;

  constructor(kind: InterviewEngineErrorKind, message: string, payload?: unknown) {
    super(message);
    this.name = "InterviewEngineError";
    this.kind = kind;
    this.payload = payload;
  }
}

export function isTopicCategory(value: unknown): value is TopicCategory {
  return typeof value === "string" && (TOPIC_CATEGORIES as readonly string[]).includes(value);
}

export function isTopicAction(value: unknown): value is TopicAction {
  return typeof value === "string" && (TOPIC_ACTIONS as readonly string[]).includes(value);
}

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === "string" && (QUESTION_KINDS as readonly string[]).includes(value);
}

// Guard defensivo sobre el output estructurado del modelo: el schema JSON
// valida en el servidor, pero el motor no confía ciegamente — una pregunta
// malformada nunca se persiste ni se devuelve (regla: no inventar).
//
// IMPORTANTE: el guard replica el contrato del schema (NEXT_QUESTION_SCHEMA),
// no lo endurece. El schema permite options vacías para cualquier kind y
// opciones presentes en free_only (son descripciones, no restricciones) —
// el guard NO debe rechazar lo que el server acepta, o turnos largos se
// romperían con invalid_question por casos degenerados pero válidos.
export function isValidInterviewQuestion(value: unknown): value is InterviewQuestion {
  return describeInterviewQuestionIssue(value) === null;
}

// Devuelve la primera violación del contrato (para diagnostics en errores)
// o null si la pregunta es válida.
export function describeInterviewQuestionIssue(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return "no es un objeto";
  }
  const q = value as Record<string, unknown>;

  if (typeof q.topic_id !== "string" || q.topic_id.length === 0) return "topic_id no es un string no vacío";
  if (!isTopicAction(q.topic_action)) return `topic_action inválido: ${String(q.topic_action)}`;
  if (typeof q.question_text !== "string" || q.question_text.length === 0) {
    return "question_text no es un string no vacío";
  }
  if (!isQuestionKind(q.kind)) return `kind inválido: ${String(q.kind)}`;

  if (q.topic_label !== undefined && typeof q.topic_label !== "string") return "topic_label no es string";
  if (q.why_asking !== undefined && typeof q.why_asking !== "string") return "why_asking no es string";
  if (q.topic_category !== undefined && !isTopicCategory(q.topic_category)) {
    return `topic_category inválido: ${String(q.topic_category)}`;
  }

  if (typeof q.coverage_estimate !== "number") return "coverage_estimate no es number";
  if (q.coverage_estimate < 0 || q.coverage_estimate > 1) {
    return `coverage_estimate fuera de rango: ${String(q.coverage_estimate)}`;
  }

  if (!Array.isArray(q.options)) return "options no es array";
  if (q.options.length > 5) return `options excede el máximo de 5: ${q.options.length}`;
  for (const option of q.options) {
    if (typeof option !== "object" || option === null) return "una option no es objeto";
    const o = option as Record<string, unknown>;
    if (typeof o.id !== "string") return "una option tiene id no string";
    if (typeof o.label !== "string") return "una option tiene label no string";
    if (typeof o.implies !== "string") return "una option tiene implies no string";
  }

  if (q.contradiction_flag !== null && q.contradiction_flag !== undefined) {
    if (typeof q.contradiction_flag !== "object") return "contradiction_flag no es objeto ni null";
    const flag = q.contradiction_flag as Record<string, unknown>;
    if (typeof flag.conflicting_answer_id !== "string") return "contradiction_flag.conflicting_answer_id no es string";
    if (typeof flag.explanation !== "string") return "contradiction_flag.explanation no es string";
  }

  return null;
}
