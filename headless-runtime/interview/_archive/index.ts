// API pública del motor de entrevista de requerimientos.
// La UI (fuera de esta tarea) consume SOLO estas funciones; el SDK de
// opencode no se expone fuera del módulo.

export {
  createInterview,
  submitAnswer,
  loadInterviewState,
  listInterviews,
  closeInterviewServer,
  getDefaultGateway,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_VARIANT,
  type InterviewEngineOptions,
} from "./engine.ts";

export { NEXT_QUESTION_SCHEMA } from "./schema.ts";

export {
  seedTopics,
  loadLedger,
  saveLedger,
  recordAnswer,
  updateTopicStatusForQuestion,
  markContradictionPending,
  resolveContradictionsForAnswer,
} from "./ledger.ts";

export type { InterviewModelGateway } from "./open-code-client.ts";

export { buildRecentAnswersSummary, buildTurnPrompt } from "./prompt.ts";

export type {
  InterviewLedger,
  InterviewAnswer,
  InterviewQuestion,
  InterviewSummary,
  InterviewQuestion as Question,
  QuestionOption,
  QuestionKind,
  TopicState,
  TopicCategory,
  TopicStatus,
  TopicAction,
  ContradictionRecord,
  ContradictionFlag,
  UserAnswerInput,
} from "./types.ts";

export { InterviewEngineError, type InterviewEngineErrorKind } from "./types.ts";
