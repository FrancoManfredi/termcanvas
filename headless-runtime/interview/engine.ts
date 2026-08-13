// Motor de entrevista de requerimientos adaptativa: API pública del
// módulo (sin UI). El contrato completo que la UI va a consumir es:
//   createInterview / submitAnswer / loadInterviewState / listInterviews
// El SDK de opencode queda encapsulado detrás de InterviewModelGateway.

import fs from "node:fs";
import path from "node:path";
import {
  createLedger,
  interviewDir,
  ledgerFilePath,
  loadLedger,
  markContradictionPending,
  normalizeConflictingAnswerId,
  recordAnswer,
  resolveContradictionsForAnswer,
  saveLedger,
  updateTopicStatusForQuestion,
} from "./ledger.ts";
import { buildTurnPrompt } from "./prompt.ts";
import {
  OpenCodeModelGateway,
  closeInterviewServer,
  type InterviewModelGateway,
} from "./open-code-client.ts";
import {
  InterviewEngineError,
  type InterviewLedger,
  type InterviewQuestion,
  type InterviewSummary,
  type UserAnswerInput,
} from "./types.ts";

// Modelo por defecto del motor, decidido EMPÍRICAMENTE (ver
// scripts/interview-model-probe.ts y la sección "Modelo elegido" del PR):
//   provider: opencode-go (suscripción Go, auth vía OPENCODE_GO_AUTH_COOKIE
//   + OPENCODE_GO_WORKSPACE_ID que hereda el server spawnado)
//   modelID:  gpt-5.6-luna
//   variant:  none (reasoningEffort "none" — el gateway Console Go rechaza
//   tool_choice, que es lo que usa json_schema, cuando thinking está activo)
// Probados y DESCARTADOS con evidencia: big-pickle y deepseek-v4-* fallan
// con "Thinking mode does not support this tool_choice" (no tienen variante
// sin thinking); hy3/none devuelve el JSON anidado en un string;
// minimax-m3/none omite campos requeridos del schema.
export const DEFAULT_PROVIDER_ID = "opencode-go";
export const DEFAULT_MODEL_ID = "gpt-5.6-luna";
export const DEFAULT_MODEL_VARIANT = "none";

export interface InterviewEngineOptions {
  providerID?: string;
  modelID?: string;
  variant?: string;
  gateway?: InterviewModelGateway;
}

let defaultGateway: InterviewModelGateway | null = null;

function resolveGateway(options: InterviewEngineOptions): InterviewModelGateway {
  if (options.gateway) return options.gateway;
  // Overrides explícitos (modelID/providerID/variant) no se cachean: cada
  // llamada con config distinta recibe su propio gateway.
  if (
    options.modelID !== undefined ||
    options.providerID !== undefined ||
    options.variant !== undefined
  ) {
    return new OpenCodeModelGateway(
      options.modelID ?? DEFAULT_MODEL_ID,
      options.providerID ?? DEFAULT_PROVIDER_ID,
      options.variant ?? DEFAULT_MODEL_VARIANT,
    );
  }
  if (!defaultGateway) {
    defaultGateway = new OpenCodeModelGateway(DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, DEFAULT_MODEL_VARIANT);
  }
  return defaultGateway;
}

export function getDefaultGateway(): InterviewModelGateway {
  return resolveGateway({});
}

export { closeInterviewServer };

function interviewTitle(projectPath: string): string {
  return `Entrevista de requerimientos — ${path.basename(projectPath)}`;
}

// Núcleo del turno: registra la respuesta (si hay), arma el contexto
// compacto del ledger, pide la siguiente pregunta con structured output y
// persiste lo que el modelo decidió (tópicos nuevos, status,
// contradicciones). La respuesta se persiste ANTES de llamar al modelo:
// un fallo de red o de structured output nunca pierde la respuesta, y el
// reintento deduplica. El estado del tópico respondido (open_vague vs
// closed) lo decide el modelo en este turno vía topic_action — el código
// no duplica ese juicio con heurísticas locales.
async function nextTurn(
  ledgerPath: string,
  ledger: InterviewLedger,
  userAnswer: UserAnswerInput | null,
  gateway: InterviewModelGateway,
): Promise<InterviewQuestion> {
  let answeredTopicId: string | null = null;
  if (userAnswer) {
    const answer = recordAnswer(ledger, userAnswer);
    resolveContradictionsForAnswer(ledger, answer);
    answeredTopicId = answer.topic_id;
    saveLedger(ledgerPath, ledger);
  }

  const turnPrompt = buildTurnPrompt(ledger);
  const question = await gateway.nextQuestion({
    sessionId: ledger.session_id,
    turnPrompt,
  });

  if (question.contradiction_flag) {
    question.contradiction_flag.conflicting_answer_id = normalizeConflictingAnswerId(ledger, question);
  }

  updateTopicStatusForQuestion(ledger, question, answeredTopicId);
  if (question.topic_action === "resolve_contradiction" && question.contradiction_flag) {
    markContradictionPending(ledger, question);
  }

  ledger.last_question = question;
  ledger.last_turn_at = new Date().toISOString();
  saveLedger(ledgerPath, ledger);
  return question;
}

// ─── API pública ────────────────────────────────────────────────────────

// Crea una entrevista nueva (ledger + sesión de opencode) y devuelve la
// primera pregunta. Si el primer turno falla, el ledger se descarta para
// que reintentar no acumule sesiones huérfanas.
export async function createInterview(
  projectPath: string,
  options: InterviewEngineOptions = {},
): Promise<{ ledgerPath: string; firstQuestion: InterviewQuestion }> {
  const gateway = resolveGateway(options);
  const sessionId = await gateway.createSession(interviewTitle(projectPath), projectPath);

  const ledger = createLedger({ projectPath, sessionId });
  const ledgerPath = ledgerFilePath(projectPath, Date.now());
  saveLedger(ledgerPath, ledger);

  try {
    const firstQuestion = await nextTurn(ledgerPath, ledger, null, gateway);
    return { ledgerPath, firstQuestion };
  } catch (err) {
    try {
      fs.unlinkSync(ledgerPath);
    } catch {
      // Ledger ya inexistente o sin permisos: el error original es lo que importa.
    }
    throw err;
  }
}

// Envía una respuesta y devuelve la siguiente pregunta. Idempotente ante
// reintentos (doble click o reintento tras fallo del modelo): si la última
// respuesta registrada corresponde exactamente a la pregunta que se está
// mostrando y coincide con el input, no se registra duplicado.
export async function submitAnswer(
  ledgerPath: string,
  answer: UserAnswerInput,
  options: InterviewEngineOptions = {},
): Promise<InterviewQuestion> {
  const gateway = resolveGateway(options);
  const ledger = loadLedger(ledgerPath);

  const last = ledger.answers[ledger.answers.length - 1];
  const isRetry =
    last !== undefined &&
    ledger.last_question !== null &&
    last.question_text === ledger.last_question.question_text &&
    last.selected_option_id === answer.selected_option_id &&
    last.free_text === answer.free_text;

  return nextTurn(ledgerPath, ledger, isRetry ? null : answer, gateway);
}

// Estado actual para retomar una sesión pausada. lastQuestion es la
// última pregunta mostrada (null solo en un ledger vacío), para que la UI
// pueda re-renderizar la pregunta pendiente.
export async function loadInterviewState(
  ledgerPath: string,
): Promise<{ ledger: InterviewLedger; lastQuestion: InterviewQuestion | null }> {
  const ledger = loadLedger(ledgerPath);
  return { ledger, lastQuestion: ledger.last_question };
}

// Lista las entrevistas existentes de un proyecto para el selector
// "retomar", ordenadas de más reciente a más antigua.
export async function listInterviews(projectPath: string): Promise<InterviewSummary[]> {
  const dir = interviewDir(projectPath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: InterviewSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^interview-\d+\.json$/.test(entry.name)) continue;
    const ledgerPath = path.join(dir, entry.name);
    try {
      const ledger = loadLedger(ledgerPath);
      summaries.push({
        ledgerPath,
        projectPath,
        session_id: ledger.session_id,
        created_at: ledger.created_at,
        last_turn_at: ledger.last_turn_at,
        topics_total: ledger.topics.length,
        topics_closed: ledger.topics.filter((topic) => topic.status === "closed").length,
        answers_count: ledger.answers.length,
        pending_contradictions: ledger.contradictions.filter((record) => !record.resolved).length,
      });
    } catch (err) {
      if (err instanceof InterviewEngineError && err.kind === "ledger_corrupt") {
        console.error(`[interview] skipping malformed ledger ${ledgerPath}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  summaries.sort((a, b) => b.last_turn_at.localeCompare(a.last_turn_at));
  return summaries;
}
