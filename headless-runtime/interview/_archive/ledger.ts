// Estado operativo de la entrevista: el ledger JSON en disco.
// Mismo patrón que `.agents/planning/plan-*.json` — la conversación en la
// sesión de opencode es auditoría; acá vive lo que el motor necesita por
// turno (mapa de tópicos, resumen corto de respuestas, contradicciones).

import fs from "node:fs";
import path from "node:path";
import {
  InterviewEngineError,
  type ContradictionRecord,
  type InterviewAnswer,
  type InterviewLedger,
  type InterviewQuestion,
  type QuestionOption,
  type TopicCategory,
  type TopicState,
  type UserAnswerInput,
} from "./types.ts";

export const INTERVIEW_DIR_NAME = "interview";
export const REPO_CONTEXT_FILE = ".agents/repo-context.md";
export const SEED_TOPIC_PRIORITY = 3;

// Semilla inicial del mapa de tópicos. NO es la lista completa de
// preguntas: es el punto de partida; los tópicos hijos (core_flow sobre
// todo) se instancian dinámicamente cuando la conversación lo amerita.
const SEED_DEFS: Array<{
  id: string;
  label: string;
  category: TopicCategory;
  priority: number;
}> = [
  { id: "vision.problem", label: "Problema que resuelve", category: "vision", priority: 5 },
  { id: "vision.users", label: "Usuarios y roles", category: "vision", priority: 5 },
  { id: "vision.success_criteria", label: "Criterios de éxito", category: "vision", priority: 4 },
  {
    id: "flow.main",
    label: "Flujo principal (plantilla — se clona por cada flujo mencionado)",
    category: "core_flow",
    priority: 5,
  },
  { id: "data.entities", label: "Entidades y datos centrales", category: "data", priority: 4 },
  { id: "data.lifecycle", label: "Ciclo de vida de los datos", category: "data", priority: 3 },
  { id: "data.consistency", label: "Consistencia y concurrencia", category: "data", priority: 3 },
  { id: "nonfunctional.performance", label: "Rendimiento y latencia", category: "nonfunctional", priority: 4 },
  { id: "nonfunctional.availability", label: "Disponibilidad", category: "nonfunctional", priority: 3 },
  { id: "nonfunctional.security", label: "Seguridad y acceso", category: "nonfunctional", priority: 4 },
  { id: "integrations.external_systems", label: "Integraciones externas", category: "integrations", priority: 3 },
  { id: "failure_modes.critical_paths", label: "Modos de falla en caminos críticos", category: "failure_modes", priority: 3 },
  { id: "scope.explicit_exclusions", label: "Fuera de alcance explícito", category: "scope", priority: 2 },
];

export function isAsrCandidate(category: TopicCategory): boolean {
  return category === "nonfunctional";
}

export function seedTopics(): TopicState[] {
  return SEED_DEFS.map((def) => ({
    ...def,
    status: "unopened",
    asr_candidate: isAsrCandidate(def.category),
  }));
}

export function interviewDir(projectPath: string): string {
  return path.join(projectPath, ".agents", INTERVIEW_DIR_NAME);
}

export function ledgerFilePath(projectPath: string, timestamp: number): string {
  return path.join(interviewDir(projectPath), `interview-${timestamp}.json`);
}

export function createLedger(input: {
  projectPath: string;
  sessionId: string;
  now?: Date;
}): InterviewLedger {
  const now = (input.now ?? new Date()).toISOString();
  return {
    session_id: input.sessionId,
    project_context_path: path.join(input.projectPath, REPO_CONTEXT_FILE),
    created_at: now,
    last_turn_at: now,
    topics: seedTopics(),
    answers: [],
    contradictions: [],
    last_question: null,
  };
}

export function loadLedger(ledgerPath: string): InterviewLedger {
  let raw: string;
  try {
    raw = fs.readFileSync(ledgerPath, "utf-8");
  } catch (err) {
    throw new InterviewEngineError(
      "ledger_corrupt",
      `No se pudo leer el ledger ${ledgerPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InterviewEngineError("ledger_corrupt", `El ledger ${ledgerPath} no es JSON válido`);
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as InterviewLedger).session_id !== "string") {
    throw new InterviewEngineError("ledger_corrupt", `El ledger ${ledgerPath} no cumple el contrato mínimo`);
  }
  return parsed as InterviewLedger;
}

export function saveLedger(ledgerPath: string, ledger: InterviewLedger): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf-8");
}

function nextAnswerId(ledger: InterviewLedger): string {
  return `a_${String(ledger.answers.length + 1).padStart(3, "0")}`;
}

function nextContradictionId(ledger: InterviewLedger): string {
  return `c_${String(ledger.contradictions.length + 1).padStart(3, "0")}`;
}

// Contexto de la pregunta que se está respondiendo: la última mostrada.
// Si no coincide con el topic_id del input (ledger manipulado o retoma
// rara), se registra igualmente con un contexto mínimo y sin opciones.
function questionContextFor(
  ledger: InterviewLedger,
  topicId: string,
): { questionText: string; options: QuestionOption[] } {
  const last = ledger.last_question;
  if (last && last.topic_id === topicId) {
    return { questionText: last.question_text, options: last.options };
  }
  return { questionText: "(pregunta no registrada en el ledger)", options: [] };
}

export function inferImplies(input: UserAnswerInput, options: QuestionOption[]): string {
  if (input.selected_option_id) {
    const option = options.find((candidate) => candidate.id === input.selected_option_id);
    if (option) return option.implies;
  }
  const text = input.free_text?.trim();
  if (text && text.length > 0) return text.slice(0, 200);
  return "(respuesta vacía)";
}

export function recordAnswer(ledger: InterviewLedger, input: UserAnswerInput, now?: Date): InterviewAnswer {
  const { questionText, options } = questionContextFor(ledger, input.topic_id);
  const answer: InterviewAnswer = {
    id: nextAnswerId(ledger),
    topic_id: input.topic_id,
    question_text: questionText,
    options_presented: options,
    selected_option_id: input.selected_option_id,
    free_text: input.free_text,
    implies: inferImplies(input, options),
    timestamp: (now ?? new Date()).toISOString(),
  };
  ledger.answers.push(answer);
  return answer;
}

// Marca como resuelta la contradicción que la pregunta respondida estaba
// presentando (la pregunta traía contradiction_flag con el answer id en
// conflicto; esa respuesta decide cuál versión vale).
export function resolveContradictionsForAnswer(ledger: InterviewLedger, answer: InterviewAnswer): void {
  const flag = ledger.last_question?.contradiction_flag;
  if (!flag) return;
  const record = ledger.contradictions.find(
    (candidate) => candidate.answer_a === flag.conflicting_answer_id && !candidate.resolved,
  );
  if (record) {
    record.resolved = true;
    record.resolution_answer_id = answer.id;
  }
}

// Persiste lo que el MODELO decidió sobre el estado de los tópicos. El
// código no duplica el juicio "¿fue específica esta respuesta?" — eso se
// decide en el turno siguiente vía topic_action (drill_down → open_vague,
// cerrar/moverse → closed). Regla de inferencia local permitida por el
// diseño: si el modelo preguntó por OTRO tópico distinto al recién
// respondido, el respondido se considera cubierto (closed).
export function updateTopicStatusForQuestion(
  ledger: InterviewLedger,
  question: InterviewQuestion,
  answeredTopicId: string | null,
): void {
  const existing = ledger.topics.find((topic) => topic.id === question.topic_id);
  if (!existing) {
    ledger.topics.push({
      id: question.topic_id,
      label: question.topic_label ?? question.topic_id,
      category: question.topic_category ?? "core_flow",
      status: "open_new",
      priority: SEED_TOPIC_PRIORITY,
      asr_candidate: isAsrCandidate(question.topic_category ?? "core_flow"),
    });
  } else {
    switch (question.topic_action) {
      case "drill_down":
        existing.status = "open_vague";
        break;
      case "resolve_contradiction":
        existing.status = "in_contradiction";
        break;
      case "close_topic":
        existing.status = "closed";
        break;
      case "open_new_topic":
        if (existing.status === "unopened") existing.status = "open_new";
        break;
    }
  }

  if (answeredTopicId && answeredTopicId !== question.topic_id) {
    const answered = ledger.topics.find((topic) => topic.id === answeredTopicId);
    if (
      answered &&
      answered.status !== "closed" &&
      answered.status !== "in_contradiction"
    ) {
      answered.status = "closed";
    }
  }
}

export function markContradictionPending(ledger: InterviewLedger, question: InterviewQuestion): void {
  const flag = question.contradiction_flag;
  if (!flag) return;
  const lastAnswer = ledger.answers[ledger.answers.length - 1];
  const record: ContradictionRecord = {
    id: nextContradictionId(ledger),
    answer_a: flag.conflicting_answer_id,
    answer_b: lastAnswer?.id ?? flag.conflicting_answer_id,
    explanation: flag.explanation,
    resolved: false,
    resolution_answer_id: null,
  };
  ledger.contradictions.push(record);
}

// El modelo NO ve los answer ids en el resumen (solo topic + implies), así
// que el conflicting_answer_id que devuelve puede no existir. Normaliza a
// un id real con un fallback determinístico: la respuesta más antigua del
// mismo tópico (distinta de la última — la última es el disparador, que el
// motor registra como answer_b), o la más antigua del ledger.
export function normalizeConflictingAnswerId(ledger: InterviewLedger, question: InterviewQuestion): string {
  const flag = question.contradiction_flag;
  if (!flag) return "";
  if (ledger.answers.some((answer) => answer.id === flag.conflicting_answer_id)) {
    return flag.conflicting_answer_id;
  }
  const last = ledger.answers[ledger.answers.length - 1];
  const sameTopic = ledger.answers.find(
    (answer) => answer.topic_id === question.topic_id && answer.id !== last?.id,
  );
  return (
    sameTopic?.id ??
    ledger.answers.find((answer) => answer.id !== last?.id)?.id ??
    last?.id ??
    ""
  );
}

export function pendingContradictions(ledger: InterviewLedger): ContradictionRecord[] {
  return ledger.contradictions.filter((record) => !record.resolved);
}
