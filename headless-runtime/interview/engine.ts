// Motor de entrevista de requerimientos — FASE 6 (revisión final de huecos
// + doble validación de temas arquitectónicos).
//
// Patrón base (Fases 1-5): UNA sesión de opencode reusada; server dedicado;
// scheduler determinístico; el modelo clasifica (informative/noise/deferred),
// juzga suficiencia y detecta contradicciones en la misma llamada.
//
// Novedad de la Fase 6 — dos pasadas PUNTUALES (una sola vez, no por turno):
//
//   Parte A — gap-check final: cuando la entrevista se queda sin tópicos
//     pendientes, UNA llamada adicional mira el conjunto COMPLETO de
//     respuestas (todo junto, no tópico por tópico) buscando huecos que la
//     evaluación turno a turno no puede ver. Si hay huecos con
//     suggested_action="reopen_topic", los tópicos relacionados se reabren
//     (ledger.reopens) y se les da una oportunidad más antes de cerrar.
//     Una sola vez por entrevista (ledger.gap_check), best-effort.
//
//   Parte B — doble validación ASR: al cerrar un tópico ARQUITECTÓNICO
//     (ARCHITECTURAL_TOPICS) con respuesta suficiente, una llamada adicional
//     e independiente revisa si la restricción es genuinamente arquitectónica
//     o una preferencia de producto. El veredicto queda registrado
//     (ledger.asr_reviews) SIN perder la respuesta original; si no es
//     genuina, el tópico se re-clasifica para la síntesis futura.
//
// Fuera de esta fase (anotado, NO implementado): UI.

import fs from "node:fs";
import path from "node:path";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  AsrReviewVerdictSchema,
  GapCheckResultSchema,
  QuestionOutputSchema,
  SynthesisSchema,
  QUESTION_SCHEMA,
  GAP_CHECK_SCHEMA,
  ASR_REVIEW_SCHEMA,
  SYNTHESIS_SCHEMA,
  type QuestionOutput,
  type GapCheckResult,
  type GapRecord,
  type AsrReviewVerdict,
  type SynthesisResult,
} from "./schema.ts";

// Routing de modelo y CLI por fase: tipos/defaults del contrato compartido y el
// catálogo de disponibilidad (server efímero propio, cache TTL) para el gate.
import {
  DEFAULT_PHASE_CLIS,
  DEFAULT_PHASE_MODELS,
  resolveCliForPhase,
  type PhaseActivityEvent,
  type PhaseCli,
  type PhaseId,
} from "../../shared/phaseModels.ts";
import {
  fetchModelCatalog,
  validatePhaseAgainstCatalog,
} from "../../electron/model-catalog.ts";
import { getInterviewHarness as getHarness, closeAllHarnesses, __setTestHarness } from "./harness/index.ts";
import { opencodeHarness, setTestClient as setOpencodeTestClient, ensureClient as ensureOpencodeClient, closeInterviewServer as closeOpencodeServer } from "./harness/opencode.ts";
import type { HarnessInterviewAdapter } from "../../shared/neutral/interview.ts";
import type { CliCatalogSource } from "../../shared/modelCatalog.ts";

export { QUESTION_SCHEMA, GAP_CHECK_SCHEMA, ASR_REVIEW_SCHEMA, SYNTHESIS_SCHEMA, QuestionOutputSchema, GapCheckResultSchema, AsrReviewVerdictSchema, SynthesisSchema } from "./schema.ts";
export type { QuestionOutput, GapCheckResult, GapRecord, AsrReviewVerdict, SynthesisResult } from "./schema.ts";

// ─── Configuración ───────────────────────────────────────────────────────
// NOTA (routing por fase): los valores de acá son los DEFAULTS históricos.
// Desde WU4 cada llamada resuelve su modelo vía phaseModelRef — override del
// usuario (Settings → Models per phase, ver docs/model-routing-por-fase.md)
// > estas constantes. Un test de sync garantiza que no se desalineen del
// contrato compartido en shared/phaseModels.ts.

export const DEFAULT_PROVIDER_ID = "opencode-go";
export const DEFAULT_MODEL_ID = "hy3";
// ─────────────────────────────────────────────────────────────────────────
// deepseek-v4-flash (opencode-go): HABILITADO para las llamadas grandes.
// Re-verificado empíricamente con el server 1.18.18 (2026-08-18): el
// contrato completo de la síntesis (json_schema + SYNTHESIS_SCHEMA +
// variant "max" + contexto completo de la entrevista) funcionó en ~60s y
// validó con Zod. Antes el provider rechazaba el tool_choice forzado de
// json_schema con "Thinking mode does not support this tool_choice" cuando
// el modelo razonaba (DeepSeek V4 razona SIEMPRE) — ese límite ya no se da
// en el server actual. Ventaja: ventana de contexto 1M, la síntesis y el
// gap-check corren con el contexto COMPLETO sin desbordar (el problema que
// traía hy3, ventana chica).
// ─────────────────────────────────────────────────────────────────────────
// Los turnos por pregunta siguen con hy3 + json_schema SIN variant (el
// camino que ya funcionaba y es rápido/barato). El thinking máximo (variant
// "max") SOLO se aplica a la síntesis final, por decisión del dueño
// (costo/velocidad). El gap-check usa deepseek sin variant.
export interface ModelRef {
  providerID: string;
  modelID: string;
  variant?: string;
}
export const HEAVY_MODEL_ID = "deepseek-v4-flash";
export const SYNTHESIS_MODEL: ModelRef = { providerID: DEFAULT_PROVIDER_ID, modelID: HEAVY_MODEL_ID, variant: "max" };
export const GAP_CHECK_MODEL: ModelRef = { providerID: DEFAULT_PROVIDER_ID, modelID: HEAVY_MODEL_ID };

// Variante de razonamiento (thinking) — por defecto DESACTIVADA en los
// turnos por pregunta (hy3 + json_schema sin variant).
export const DEFAULT_MODEL_VARIANT: string | undefined = undefined;

// ─── Routing de modelo por fase ──────────────────────────────────────────
// La app inyecta overrides por fase (preferencesStore → IPC → acá) y TODA
// llamada del motor resuelve su modelo vía phaseModelRef — única puerta de
// resolución. Sin override rige el default; las constantes SYNTHESIS_MODEL /
// GAP_CHECK_MODEL quedan como fallback documental (un test de sync garantiza
// que no se desalineen de shared/phaseModels.ts).

export class ModelUnavailableError extends Error {
  constructor(
    readonly phaseId: PhaseId,
    readonly requested: ModelRef,
    readonly motive: string,
    readonly alternatives: string[],
  ) {
    super(
      `[${phaseId}] ${requested.providerID}/${requested.modelID} no está disponible: ${motive}` +
        (alternatives.length > 0
          ? ` Alternativas conectadas: ${alternatives.join(", ")}.`
          : ""),
    );
    this.name = "ModelUnavailableError";
  }
}

let phaseModelOverrides: Partial<Record<PhaseId, ModelRef>> = {};
let phaseCliOverrides: Partial<Record<PhaseId, PhaseCli>> = {};

/** Inyecta los overrides resueltos en preferences (null limpia todo). */
export function setPhaseModelOverrides(
  overrides: Partial<Record<PhaseId, ModelRef>> | null | undefined,
): void {
  phaseModelOverrides = overrides ? { ...overrides } : {};
}

export function setPhaseCliOverrides(
  overrides: Partial<Record<PhaseId, PhaseCli>> | null | undefined,
): void {
  phaseCliOverrides = overrides ? { ...overrides } : {};
}

export function phaseCliRef(phaseId: PhaseId): PhaseCli {
  return resolveCliForPhase(phaseId, phaseCliOverrides);
}

// ─── Feed de actividad ("IA actuando") ───────────────────────────────────
// Un solo listener: la app lo conecta al push IPC hacia el renderer. Los
// errores del listener NUNCA tumban el motor.

let phaseActivityListener: ((event: PhaseActivityEvent) => void) | null = null;

export function setPhaseActivityListener(
  listener: ((event: PhaseActivityEvent) => void) | null,
): void {
  phaseActivityListener = listener;
}

function emitActivity(event: PhaseActivityEvent): void {
  try {
    phaseActivityListener?.(event);
  } catch {
    // Listener roto no interrumpe la llamada en curso.
  }
}

// ─── Cancelación de llamadas en vuelo ────────────────────────────────────
// El servicio (interview-service) resuelve ledgerPath→session_id y llama
// cancelInterviewSession para abortar el fetch del modelo. La cancelación
// NO consume reintentos: se detecta antes de cada intento y justo después
// de cada await, y sale como InterviewCancelledError.

export class InterviewCancelledError extends Error {
  constructor() {
    super("Operación cancelada por el usuario");
    this.name = "InterviewCancelledError";
  }
}

const activeBySession = new Map<string, AbortController>();
// Sesiones marcadas como canceladas ANTES de que la llamada arranque (el
// servicio puede cancelar cuando todavía no hay controller registrado).
const abortedSessions = new Set<string>();

/**
 * Aborta la llamada en vuelo de una sesión o la marca como cancelada si
 * todavía no arrancó. La marca vive solo hasta que la operación se asienta.
 */
export function cancelInterviewSession(sessionId: string): boolean {
  abortedSessions.add(sessionId);
  const controller = activeBySession.get(sessionId);
  controller?.abort(new InterviewCancelledError());
  return controller !== undefined;
}

/** Modelo efectivo de una fase: override del usuario > default del motor. */
export function phaseModelRef(phaseId: PhaseId): ModelRef {
  const override = phaseModelOverrides[phaseId];
  if (override) return override;
  const def = DEFAULT_PHASE_MODELS[phaseId];
  if (def) return def;
  // Fases CLI (default null en el contrato compartido) no deberían
  // resolverse por acá: si ocurre, cae al default de turno del motor.
  return { providerID: DEFAULT_PROVIDER_ID, modelID: DEFAULT_MODEL_ID };
}

// Gate best-effort ANTES de pagar la llamada: valida el ref resuelto contra
// el catálogo real de opencode y falla temprano con ModelUnavailableError
// (modelo removido del registry, proveedor sin auth, variant insoportada).
// Si el catálogo mismo no se puede obtener (server caído, endpoint roto), el
// gate NO bloquea: la llamada procede y el error real del modelo ya tiene su
// propio camino de reintentos/mensajes accionables.
async function gateModeloDeFase(phaseId: PhaseId, ref: ModelRef): Promise<void> {
  try {
    const cli = phaseCliRef(phaseId);
    // Si la fase tiene CLI = null (default global), el gate valida contra opencode
    // (comportamiento histórico). Si la fase eligió otro CLI, se valida contra su catálogo.
    const catalogSource = (cli ?? "opencode") as import("../../shared/modelCatalog.ts").CliCatalogSource;
    const catalog = await fetchModelCatalog(false, catalogSource);
    const veredicto = validatePhaseAgainstCatalog(phaseId, catalog, {
      [phaseId]: ref,
    });
    if (!veredicto.ok) {
      throw new ModelUnavailableError(
        phaseId,
        ref,
        veredicto.reason ?? "no disponible",
        veredicto.alternatives ?? [],
      );
    }
  } catch (err) {
    if (err instanceof ModelUnavailableError) throw err;
    console.warn(
      `[interview] gate de modelo omitido (${phaseId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const TOPICS = [
  "problema",
  "usuarios",
  "flujo_principal",
  "criterio_exito",
  "rendimiento",
] as const;
export type TopicId = (typeof TOPICS)[number];

// Tópicos de naturaleza arquitectónica: merecen la doble validación ASR al
// cerrar con suficiente (Parte B de la Fase 6). Los demás no la disparan.
export const ARCHITECTURAL_TOPICS: ReadonlySet<string> = new Set(["rendimiento"]);

// Cupo duro por tópico: cuenta SOLO respuestas informativas (las basura y
// diferidas no gastan presupuesto de preguntas reales).
export const MAX_QUESTIONS_PER_TOPIC = 3;

// Streak de basura: 2 respuestas noise SEGUIDAS cierran el tópico como
// exhausted(noise) — un contador distinto del cupo.
export const MAX_NOISE_STREAK = 2;

// Diferidas: la 1ra deja el tópico parked; la 2da (la última chance, al
// final de la entrevista) lo cierra como parked_unresolved.
export const MAX_DEFERRED_RETRIES = 2;

// Tópico virtual de las preguntas de resolución de contradicciones.
export const CONTRADICTION_TOPIC_ID = "__contradiction__";

const SUMMARY_ENTRY_MAX_CHARS = 120;

// Los schemas JSON del prompt viven en schema.ts (derivados de Zod con
// z.toJSONSchema — una sola fuente de verdad).
const MODEL_CALL_TIMEOUT_MS = 180_000;
// Arranque del server de opencode: 10s quedaba corto en cold start / con
// antivirus / bajo carga (se observó "Timeout waiting for server to start
// after 10000ms" en la síntesis real). 30s + reintento lo hace resiliente.
const SERVER_START_TIMEOUT_MS = 30_000;
const SERVER_START_RETRIES = 2;

// ─── Tipos ───────────────────────────────────────────────────────────────

export interface QuestionOption {
  id: string;
  label: string;
}

export interface InterviewQuestion {
  question_text: string;
  kind: "single_select" | "free_only";
  options: QuestionOption[];
}

export type ResponseKind = "informative" | "noise" | "deferred";

export interface ContradictionFlag {
  conflicting_answer_id: string;
  reason: string;
}

// Output completo de la llamada de pregunta. Tipado garantizado por Zod
// (QuestionOutputSchema); los campos con .optional() pueden venir undefined
// hasta la normalización final de askQuestion.
export type QuestionWithJudgment = QuestionOutput;

export interface InterviewAnswer {
  id: string;
  topic: string;
  question_text: string;
  selected_option_id: string | null;
  // Label legible de la opción elegida (para el resumen que ve el modelo y
  // para auditoría). Ausente cuando la respuesta fue texto libre.
  selected_option_label?: string | null;
  free_text: string | null;
  // Juicio del modelo sobre ESTA respuesta (llega en la llamada siguiente).
  sufficient?: boolean | null;
  // Clasificación de la Fase 5. Ausente (ledgers viejos) = "informative".
  response_kind?: ResponseKind;
  superseded?: boolean;
  superseded_by?: string;
}

export type ContradictionStatus = "open" | "resolved";

export interface ContradictionRecord {
  id: string;
  answer_id: string;
  conflicting_answer_id: string;
  reason: string;
  status: ContradictionStatus;
  resolution: { selected_option_id: string | null; free_text: string | null } | null;
}

export interface InterviewLedger {
  session_id: string;
  project_path: string;
  topics: string[];
  answers: InterviewAnswer[];
  contradictions: ContradictionRecord[];
  // Fase 6A: tópicos reabiertos por el gap-check (se limpia al re-cerrarlos).
  reopens: { topic: string; reason: string }[];
  // Fase 6A: resultado de la ÚNICA pasada final (null si todavía no corrió).
  gap_check: { gaps: GapRecord[]; at: string } | null;
  // Fase 6B: veredictos de la doble validación arquitectónica.
  asr_reviews: { topic: string; answer_id: string; verdict: AsrReviewVerdict; at: string }[];
  // Síntesis final: planilla de salida llena al terminar la entrevista.
  synthesis: { at: string; data: SynthesisResult } | null;
  // La pregunta que el motor generó y el usuario todavía no respondió: se
  // persiste para que RETOMAR devuelva la MISMA pregunta (sin regenerarla).
  // Se limpia al responder y se rellena con la siguiente pregunta generada.
  pending_question: { topic: string; question: QuestionWithJudgment } | null;
}

// Labels legibles de los tópicos internos (la UI los muestra como enums).
export const TOPIC_LABELS: Record<string, string> = {
  problema: "Problema",
  usuarios: "Usuarios",
  flujo_principal: "Flujo principal",
  criterio_exito: "Criterio de éxito",
  rendimiento: "Rendimiento",
  [CONTRADICTION_TOPIC_ID]: "Resolución de contradicción",
};

// Label de un tópico: el enum legible si es conocido; si la IA definió un
// tópico distinto, se muestra el valor tal cual.
export function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface UserAnswerInput {
  topic: string;
  question_text: string;
  free_text: string | null;
  selected_option_id: string | null;
  selected_option_label?: string | null;
}

export type TurnResult =
  | {
      done: false;
      kind: "question";
      question: InterviewQuestion;
      topic: string;
      sufficient: boolean | null;
      contradiction: ContradictionRecord | null;
      usage: ModelUsage;
    }
  | {
      done: false;
      kind: "resolution";
      question: InterviewQuestion;
      topic: typeof CONTRADICTION_TOPIC_ID;
      contradiction: ContradictionRecord;
      usage: ModelUsage;
    }
  | { done: true; reason: "all_topics_closed"; usage: ModelUsage };

// ─── Server + cliente — DELEGADO A HARNESS NEUTRO ───────────────────
// Si opencode muere mañana, el próximo harness entra sin tocar este archivo.
// El engine resuelve el harness vía phaseCliRef(phaseId) → getInterviewHarness.
// Para backward compat con tests que usan setTestClient(OpencodeClient mock),
// seguimos exponiendo esa función pero delega al opencode harness.

function getHarnessForPhase(phaseId?: PhaseId): HarnessInterviewAdapter {
  const cli = (phaseId ? phaseCliRef(phaseId) : null) as CliCatalogSource | null;
  const harnessId = (cli ?? "opencode") as CliCatalogSource;
  try {
    return getHarness(harnessId);
  } catch {
    return getHarness("opencode");
  }
}

// Seam de TESTS: inyecta un cliente mockeado de opencode (sin server real).
// Para tests de harness neutro usar __setTestHarness en su lugar.
export function setTestClient(client: OpencodeClient | null): void {
  setOpencodeTestClient(client);
}

// Nuevo seam neutro para tests que quieran mockear cualquier harness
export function __setTestHarnessForInterview(harnessId: CliCatalogSource, harness: HarnessInterviewAdapter | null): void {
  __setTestHarness(harnessId, harness);
}

export function __resetTestHarnessesForInterview(): void {
  // Limpia overrides de todos los harnesses (usado en beforeEach)
  __setTestHarness("opencode", null);
  __setTestHarness("codebuddy", null);
  __setTestHarness("claude", null);
  __setTestHarness("codex", null);
  __setTestHarness("gemini", null);
  __setTestHarness("kimi", null);
  __setTestHarness("wuu", null);
}

// Exportada para módulos hermanos (brief/requirements/tactics) — hoy siempre opencode.
// Queda como alias para no romper imports, pero el engine ya no la usa directo.
export async function ensureClient(): Promise<OpencodeClient> {
  return ensureOpencodeClient();
}

export function closeInterviewServer(): void {
  closeOpencodeServer();
  // También cierra otros harnesses por si alguno levanta recursos
  try {
    closeAllHarnesses();
  } catch {}
}

// ─── Ledger (persistencia) ───────────────────────────────────────────────
//
// LAYOUT DE ARCHIVOS (organizado por tipo de entrevista, dos subcarpetas):
//   <proyecto>/.agents/interview/requerimientos/
//     entrevista-<ts>.json            ledger de la entrevista de requerimientos
//     entrevista-<ts>-sintesis.json   planilla de salida (JSON standalone)
//   <proyecto>/.agents/interview/contexto/
//     contexto-<ts>.json              borrador de la entrevista de contexto
//     contexto-<ts>-documento.json    documento del contexto sintetizado
//     contexto-activo.json            marcador del contexto activo
// Los archivos del layout LEGACY (interview-*.json / brief-*.json /
// active-brief.json en la raíz de .agents/interview/) se MIGRAN a la
// subcarpeta correcta al primer acceso (ensureInterviewLayout).

export function interviewDir(projectPath: string): string {
  return path.join(projectPath, ".agents", "interview");
}

export function requirementsDir(projectPath: string): string {
  return path.join(interviewDir(projectPath), "requerimientos");
}

export function contextDir(projectPath: string): string {
  return path.join(interviewDir(projectPath), "contexto");
}

// Migra el layout legacy (raíz de .agents/interview/) al nuevo por
// subcarpetas. Idempotente y best-effort; se llama desde todos los puntos
// de lectura/escritura para que los proyectos existentes sigan funcionando.
export function ensureInterviewLayout(projectPath: string): void {
  const root = interviewDir(projectPath);
  if (!fs.existsSync(root)) return;
  const req = requirementsDir(projectPath);
  const ctx = contextDir(projectPath);
  fs.mkdirSync(req, { recursive: true });
  fs.mkdirSync(ctx, { recursive: true });

  for (const f of fs.readdirSync(root)) {
    const source = path.join(root, f);
    let dest: string | null = null;
    let m: RegExpExecArray | null;
    if ((m = /^interview-(\d+)\.json$/.exec(f))) dest = path.join(req, `entrevista-${m[1]}.json`);
    else if ((m = /^interview-(\d+)-synthesis\.json$/.exec(f))) dest = path.join(req, `entrevista-${m[1]}-sintesis.json`);
    else if ((m = /^brief-(\d+)\.json$/.exec(f))) dest = path.join(ctx, `contexto-${m[1]}.json`);
    else if ((m = /^brief-(\d+)-brief\.json$/.exec(f))) dest = path.join(ctx, `contexto-${m[1]}-documento.json`);
    else if (f === "active-brief.json") dest = path.join(ctx, "contexto-activo.json");
    if (!dest) continue;
    try {
      fs.renameSync(source, dest);
    } catch {
      // Ya movido o en conflicto: se conserva el destino.
    }
  }

  // El marcador del contexto activo guarda la RUTA absoluta del documento:
  // si apuntaba al layout legacy, se reescribe a la ruta nueva.
  const marker = path.join(ctx, "contexto-activo.json");
  if (fs.existsSync(marker)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(marker, "utf-8")) as { path?: string };
      if (typeof parsed.path === "string") {
        const m2 = /brief-(\d+)-brief\.json$/.exec(parsed.path);
        if (m2) {
          parsed.path = path.join(ctx, `contexto-${m2[1]}-documento.json`);
          fs.writeFileSync(marker, JSON.stringify(parsed, null, 2));
        }
      }
    } catch {
      // Marcador corrupto: getActiveBrief ya lo trata como inexistente.
    }
  }
}

export function ledgerFilePath(projectPath: string, timestamp: number = Date.now()): string {
  return path.join(requirementsDir(projectPath), `entrevista-${timestamp}.json`);
}

export function saveLedger(ledgerPath: string, ledger: InterviewLedger): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}

export function loadLedger(ledgerPath: string): InterviewLedger {
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`Ledger no encontrado: ${ledgerPath}`);
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as InterviewLedger;
  if (!Array.isArray(ledger.contradictions)) ledger.contradictions = [];
  if (!Array.isArray(ledger.reopens)) ledger.reopens = [];
  if (ledger.gap_check === undefined) ledger.gap_check = null;
  if (!Array.isArray(ledger.asr_reviews)) ledger.asr_reviews = [];
  if (ledger.synthesis === undefined) ledger.synthesis = null;
  if (ledger.pending_question === undefined) ledger.pending_question = null;
  return ledger;
}

// ─── Resumen de una entrevista guardada (para la UI: listar/retomar) ─────

export interface InterviewSummary {
  ledgerPath: string;
  created_at: string;
  answers_count: number;
  topics_closed: number;
  topics_total: number;
  pending_contradictions: number;
}

// Progreso de cobertura de una entrevista, derivado del estado de sus
// tópicos (el estado es derivado del historial; esta es la única fuente de
// verdad para la UI — el renderer no puede importar el motor).
export function interviewProgress(ledger: InterviewLedger): {
  answered: number;
  closed: number;
  total: number;
  pct: number;
} {
  const answered = ledger.answers.length;
  const closed = ledger.topics.filter((t) => {
    const st = topicState(ledger, t);
    return st === "covered" || st === "exhausted";
  }).length;
  const total = ledger.topics.length;
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  return { answered, closed, total, pct };
}

// Entrevistas existentes del proyecto, ordenadas de más reciente a más
// antigua. Pura (sin llamadas al modelo): lee los ledgers de la subcarpeta
// de requerimientos (migrando el layout legacy si hace falta).
export function listInterviews(projectPath: string): InterviewSummary[] {
  ensureInterviewLayout(projectPath);
  const dir = requirementsDir(projectPath);
  if (!fs.existsSync(dir)) return [];
  const summaries: InterviewSummary[] = [];
  for (const file of fs.readdirSync(dir)) {
    const m = /^entrevista-(\d+)\.json$/.exec(file);
    if (!m) continue;
    const ledgerPath = path.join(dir, file);
    try {
      const ledger = loadLedger(ledgerPath);
      const progress = interviewProgress(ledger);
      summaries.push({
        ledgerPath,
        created_at: new Date(Number(m[1])).toISOString(),
        answers_count: progress.answered,
        topics_closed: progress.closed,
        topics_total: progress.total,
        pending_contradictions: ledger.contradictions.filter((c) => c.status !== "resolved").length,
      });
    } catch {
      // Ledger corrupto/incompleto: no se lista (se conserva en disco).
    }
  }
  return summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// Elimina una entrevista guardada (ledger + su síntesis standalone, si hay).
export function deleteInterview(ledgerPath: string): void {
  for (const target of [ledgerPath, synthesisFilePath(ledgerPath)]) {
    try {
      fs.unlinkSync(target);
    } catch {
      // El archivo ya no existe (o no se pudo borrar): no es crítico.
    }
  }
}

function mergeUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

// ─── Resumen del historial (cuidado de costo de la Fase 4) ───────────────

function buildSummary(ledger: InterviewLedger, maxChars: number = SUMMARY_ENTRY_MAX_CHARS): string {
  if (ledger.answers.length === 0) return "(ninguna todavía)";
  return ledger.answers
    .map((a) => {
      const text = (a.free_text ?? a.selected_option_label ?? a.selected_option_id ?? "(sin texto)")
        .replace(/\s+/g, " ")
        .trim();
      const corto = text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
      const descartada = a.superseded ? ` (descartada en ${a.superseded_by ?? "resolución"})` : "";
      return `- [${a.id}] ${a.topic}: "${corto}"${descartada}`;
    })
    .join("\n");
}

// ─── Prompt por tópico (suficiencia + contradicción + clasificación) ─────

function buildTopicPrompt(ledger: InterviewLedger, topic: string, projectBrief: string): string {
  const reabierto = (ledger.reopens ?? []).find((r) => r.topic === topic);
  const notaReapertura = reabierto
    ? ` Este tópico fue REABIERTO por la revisión final porque: ${reabierto.reason}. Preguntá específicamente sobre ese hueco, sin repetir lo ya cubierto.`
    : "";
  return `Sos un Analista de Requerimientos y Arquitecto de Software Senior. Generá UNA pregunta estratégica sobre el tópico "${topic}" para el proyecto: ${projectBrief}.${notaReapertura}

Resumen de las respuestas ya dadas (el id entre corchetes es el identificador de cada respuesta; la ÚLTIMA línea es la respuesta que acabás de recibir):
${buildSummary(ledger)}

Tu objetivo: no solo recolectar funciones, sino identificar ASRs (Requerimientos Arquitectónicamente Significativos) que fuercen decisiones estructurales.

Regla de Oro (técnica "Play Dumb"): si el usuario usó términos vagos como "rápido", "seguro" o "escalable", NO los aceptes. Fingí que no entendés la magnitud y presioná por un rango numérico o medida de respuesta (ej: "¿24 horas es rápido o buscamos < 200ms?").

Regla de clasificación de la ÚLTIMA respuesta recibida: response_kind="informative" si aporta datos reales, aunque sea vaga (vaga NO es basura: una respuesta vaga es informative con previous_answer_sufficient=false). response_kind="noise" SOLO si es basura real: desconectada de la pregunta, sin sentido, o ruido tipeado sin pensar. response_kind="deferred" si el usuario dice explícitamente que no sabe o no decidió todavía (ej: "no sé", "no lo pensé", "lo vemos después") — es información honesta, no es ruido. Si response_kind es noise o deferred, previous_answer_sufficient=null.

Regla de Suficiencia: marcá previous_answer_sufficient=true SOLO si la respuesta (la última de este tópico, y solo si es informative) permite completar un Escenario de Atributo de Calidad con: (1) Estímulo: el evento que llega; (2) Ambiente: el contexto de carga o estado en el que ocurre (operación normal, pico de carga, fallo parcial); (3) Artefacto afectado: qué parte del sistema se impacta (toda la app, la base de datos, el frontend); (4) Medida de Respuesta: la métrica cuantificable (latencia, throughput, tiempo de recuperación). Distinguí la Respuesta — qué actividad realiza el sistema (ej: "bloquear acceso") — de la Medida — el criterio con el que se mide (ej: "en < 1 segundo"). Si esta es la primera pregunta del tópico (todavía no hay respuesta de este tópico que juzgar), marcá previous_answer_sufficient=null.

Regla de Contradicciones: compará la última respuesta contra TODAS las anteriores, de CUALQUIER tópico, no solo del mismo. Las respuestas marcadas "(descartada en ...)" ya no valen: ignorálas al comparar. Si una decisión (ej: alta velocidad) choca con otra (ej: cifrado pesado), señalá el Trade-off (compromiso) inmediatamente: completá contradiction con el id de la respuesta anterior en conflicto (el de los corchetes) y un motivo que nombre los DOS atributos en pugna (ej: "velocidad vs seguridad"). La priorización de cuál atributo gana es decisión del dueño del producto, no del analista: cuando haya un choque, tu siguiente pregunta debe hacerlo elegir cuál de los dos atributos es más prioritario para el éxito del negocio. Si no hay choque, contradiction=null. No inventes conflictos donde no los hay: respuestas complementarias o de distinto alcance no son contradicciones.

Regla de Opciones (anti-anclaje): las opciones deben representar NIVELES DE SERVICIO que el dueño del producto pueda entender (ej: "Disponibilidad básica: tolera caídas de horas" vs "Disponibilidad crítica: menos de 5 minutos de caída por mes") ANTES de hablar de milisegundos o porcentajes — no ancles al usuario con tecnicismos que no puede valorar; el rango numérico se negocia después de elegir el nivel. La pregunta debe ofrecer 2-4 opciones concretas con ese espíritu, o ser kind=free_only si es una definición de dominio pura. Generá la pregunta ahora.`;
}

// ─── Validación del contrato (Zod) ───────────────────────────────────────

// Sanea los ruidos CONOCIDOS y baratos del modelo antes de validar con Zod
// (así no se desperdicia un reintento en algo arreglable en una línea):
//   - key de kind con tags basura ("free_only<arg_key:...>") → enum extraído
//     del nombre de la key.
//   - response_kind como STRING "null" → null.
//   - contradiction como {conflicting_answer_id: null, reason: null} (objeto
//     de nulos = "sin choque") → null; reason ausente → texto por defecto.
function sanitizeQuestionOutput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const q = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...q };

  if (out.kind !== "single_select" && out.kind !== "free_only") {
    const kindLoose = Object.keys(out).find((k) => k.includes("single_select") || k.includes("free_only"));
    if (kindLoose?.includes("single_select")) out.kind = "single_select";
    else if (kindLoose?.includes("free_only")) out.kind = "free_only";
  }

  if (out.response_kind === "null") out.response_kind = null;

  if (out.contradiction !== null && typeof out.contradiction === "object") {
    const c = out.contradiction as Record<string, unknown>;
    if (typeof c.conflicting_answer_id !== "string" || c.conflicting_answer_id.length === 0) {
      out.contradiction = null;
    } else if (typeof c.reason !== "string" || c.reason.trim() === "") {
      c.reason = "sin motivo especificado";
    }
  }

  return out;
}

// Valida el output de la llamada de pregunta con Zod (tipos garantizados).
export function parseQuestionOutput(raw: unknown): { ok: true; data: QuestionOutput } | { ok: false } {
  const result = QuestionOutputSchema.safeParse(sanitizeQuestionOutput(raw));
  return result.success ? { ok: true, data: result.data } : { ok: false };
}

export function isValidQuestion(value: unknown): value is QuestionWithJudgment {
  return parseQuestionOutput(value).ok;
}

export function isValidGapCheckResult(value: unknown): value is GapCheckResult {
  return GapCheckResultSchema.safeParse(value).success;
}

export function isValidAsrReviewResult(value: unknown): value is AsrReviewVerdict {
  return AsrReviewVerdictSchema.safeParse(value).success;
}

export function isValidSynthesisResult(value: unknown): value is SynthesisResult {
  return SynthesisSchema.safeParse(value).success;
}

// ─── Scheduler determinístico (100% código, sin llamada al modelo) ───────

// Estado de un tópico, derivado de sus answers:
//   - pending:   sin respuestas, o la última fue informative insuficiente con
//                cupo restante, o hubo 1 solo noise (streak < MAX — se
//                repregunta una vez más).
//   - covered:   la última respuesta informative fue juzgada suficiente.
//   - parked:    la última respuesta fue deferred (se deja para el final).
//   - exhausted: cerrado: por cupo de informativas (budget), por streak de
//                basura (noise) o por diferida repetida (parked_unresolved).
export type TopicCoverage = "pending" | "covered" | "parked" | "exhausted";

export type ClosedReason = "budget" | "noise" | "parked_unresolved";

export function answersOfTopic(ledger: InterviewLedger, topic: string): InterviewAnswer[] {
  return ledger.answers.filter((a) => a.topic === topic);
}

export function lastAnswerOfTopic(ledger: InterviewLedger, topic: string): InterviewAnswer | undefined {
  const ofTopic = answersOfTopic(ledger, topic);
  return ofTopic[ofTopic.length - 1];
}

export function countAnswersOfTopic(ledger: InterviewLedger, topic: string): number {
  return ledger.answers.filter((a) => a.topic === topic).length;
}

export function countInformativeOfTopic(ledger: InterviewLedger, topic: string): number {
  return answersOfTopic(ledger, topic).filter((a) => (a.response_kind ?? "informative") === "informative").length;
}

export function countDeferredOfTopic(ledger: InterviewLedger, topic: string): number {
  return answersOfTopic(ledger, topic).filter((a) => a.response_kind === "deferred").length;
}

// Basura SEGUIDA al final del tópico (el streak se corta con cualquier
// respuesta que no sea noise).
export function noiseStreakOfTopic(ledger: InterviewLedger, topic: string): number {
  let streak = 0;
  const ofTopic = answersOfTopic(ledger, topic);
  for (let i = ofTopic.length - 1; i >= 0; i--) {
    if (ofTopic[i].response_kind === "noise") streak += 1;
    else break;
  }
  return streak;
}

// Por qué un tópico está cerrado (exhausted), o null si no lo está.
// El cierre por basura queda marcado DISTINTO del cierre normal ("budget")
// y del diferido sin resolver ("parked_unresolved"): la síntesis futura
// debe saber que un tópico noise NO tiene datos confiables.
export function closedReasonOf(ledger: InterviewLedger, topic: string): ClosedReason | null {
  const last = lastAnswerOfTopic(ledger, topic);
  if (!last) return null;
  if (noiseStreakOfTopic(ledger, topic) >= MAX_NOISE_STREAK) return "noise";
  if (last.response_kind === "deferred" && countDeferredOfTopic(ledger, topic) >= MAX_DEFERRED_RETRIES) {
    return "parked_unresolved";
  }
  if (
    (last.response_kind ?? "informative") === "informative" &&
    last.sufficient !== true &&
    countInformativeOfTopic(ledger, topic) >= MAX_QUESTIONS_PER_TOPIC
  ) {
    return "budget";
  }
  return null;
}

export function topicState(ledger: InterviewLedger, topic: string): TopicCoverage {
  const last = lastAnswerOfTopic(ledger, topic);
  if (!last) return "pending";
  if (closedReasonOf(ledger, topic)) return "exhausted";
  if (last.response_kind === "deferred") return "parked";
  if (last.response_kind === "noise") return "pending";
  if (last.sufficient === true) return "covered";
  if (countInformativeOfTopic(ledger, topic) >= MAX_QUESTIONS_PER_TOPIC) return "exhausted";
  return "pending";
}

// El próximo tópico a preguntar: pending primero; si no, un tópico REABIERTO
// por el gap-check (Fase 6A); si no, un parked (diferido, última chance); si
// no queda nada, null → la entrevista termina ahí.
export function pickNextTopic(ledger: InterviewLedger): string | null {
  const pending = ledger.topics.find((topic) => topicState(ledger, topic) === "pending");
  if (pending) return pending;
  const reopened = (ledger.reopens ?? []).find((r) => topicState(ledger, r.topic) !== "exhausted");
  if (reopened) return reopened.topic;
  const parked = ledger.topics.find((topic) => topicState(ledger, topic) === "parked");
  return parked ?? null;
}

// ─── Contador de llamadas al modelo (para tests) ─────────────────────────

let modelCallCountValue = 0;

export function modelCallCount(): number {
  return modelCallCountValue;
}

// ─── Arranque y turnos ───────────────────────────────────────────────────

export async function startInterview(
  projectPath: string,
): Promise<{ ledgerPath: string; ledger: InterviewLedger }> {
  ensureInterviewLayout(projectPath);
  // Usa el harness de la fase requirements (default opencode) para crear la sesión.
  // Si el usuario eligió codebuddy para requirements, la sesión será de codebuddy.
  const harness = getHarnessForPhase("requirements");
  await harness.ensureReady();
  let sesion: { id: string };
  try {
    sesion = await harness.createSession({
      projectPath,
      title: "Entrevista de requerimientos",
    });
  } catch (err) {
    throw new Error(`No se pudo crear la sesión (${harness.harnessId}): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!sesion?.id) throw new Error(`No se pudo crear la sesión (${harness.harnessId}): id vacío`);
  const ledger: InterviewLedger = {
    session_id: sesion.id,
    project_path: projectPath,
    topics: [...TOPICS],
    answers: [],
    contradictions: [],
    reopens: [],
    gap_check: null,
    asr_reviews: [],
    synthesis: null,
    pending_question: null,
  };
  const ledgerPath = ledgerFilePath(projectPath);
  saveLedger(ledgerPath, ledger);
  return { ledgerPath, ledger };
}

// UNA llamada al modelo sobre un tópico: clasifica la última respuesta,
// juzga su suficiencia (si es informative), detecta contradicciones contra
// el resto del historial y genera la próxima pregunta. SIEMPRE la misma
// sesión del ledger. Con reintentos automáticos si el output no valida.
export async function askQuestion(
  ledger: InterviewLedger,
  topic: string,
  projectBrief: string,
): Promise<{ question: QuestionWithJudgment; usage: ModelUsage }> {
  const { data, usage } = await promptStructured(
    ledger,
    QUESTION_SCHEMA,
    buildTopicPrompt(ledger, topic, projectBrief),
    isValidQuestion,
    "Generación de pregunta",
    MODEL_CALL_TIMEOUT_MS,
    phaseModelRef("requirements"),
    "requirements",
  );
  const question = data;

  // Normalización final al contrato interno (los defaults que Zod no puede
  // conocer: el modelo los omite a veces y el motor prefiere null/valores
  // explícitos a undefined):
  //   - previous_answer_sufficient ausente → null.
  //   - response_kind ausente (o null) → "informative".
  //   - contradiction ausente → null.
  //   - opción con "description" en vez de "label" → label = description.
  if (question.previous_answer_sufficient === undefined) question.previous_answer_sufficient = null;
  const rawKind = (question as unknown as { response_kind?: string }).response_kind;
  if (rawKind === undefined || rawKind === null) {
    question.response_kind = "informative";
  }
  if (question.contradiction === undefined || question.contradiction === null) {
    question.contradiction = null;
  }
  for (const option of question.options) {
    const o = option as { label?: string; description?: string };
    if (typeof o.label !== "string" && typeof o.description === "string") {
      o.label = o.description;
    }
  }
  return { question, usage };
}

// Reanuda una entrevista guardada (ledger) desde donde quedó: carga el
// estado, deja que el scheduler elija el próximo tópico pendiente y genera
// su primera pregunta con la MISMA sesión del ledger (el historial persiste
// en la sesión de opencode; el server nuevo la reabre desde el storage).
export async function resumeInterview(
  ledgerPath: string,
  projectBrief: string,
): Promise<TurnResult> {
  const ledger = loadLedger(ledgerPath);
  const next = pickNextTopic(ledger);
  if (!next) {
    ledger.pending_question = null;
    saveLedger(ledgerPath, ledger);
    return { done: true, reason: "all_topics_closed", usage: { input_tokens: 0, output_tokens: 0 } };
  }
  // La pregunta pendiente persiste en el ledger: si el scheduler sigue
  // pidiendo el MISMO tópico, se devuelve tal cual, sin regenerar (cerrar y
  // reabrir la app no cambia la pregunta en pantalla).
  if (ledger.pending_question && ledger.pending_question.topic === next) {
    return {
      done: false,
      kind: "question",
      question: ledger.pending_question.question,
      topic: next,
      sufficient: null,
      contradiction: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
  const turn = await askQuestion(ledger, next, projectBrief);
  ledger.pending_question = { topic: next, question: turn.question };
  saveLedger(ledgerPath, ledger);
  return {
    done: false,
    kind: "question",
    question: turn.question,
    topic: next,
    sufficient: null,
    contradiction: null,
    usage: turn.usage,
  };
}

// ─── Parseo de la respuesta del usuario (opciones sugeridas + texto libre)

// Interpreta lo que el usuario escribe cuando se le muestran opciones
// sugeridas (2-4) + un campo de escritura libre:
//   - un número entero dentro de 1..N → elige la opción N;
//   - el id exacto de una opción, con o sin corchetes ("[id]" o "id") y
//     case-insensitive → elige esa opción;
//   - cualquier otra cosa (incluido "1 hora", o un número FUERA de rango
//     como "0" o "9") → texto libre.
// En preguntas free_only (sin opciones) todo es texto libre.
// Devuelve null solo si el input está vacío (respuesta inválida).
// En la UI futura los botones mandan el id directo; esta función protege
// únicamente el campo de escritura libre.
export interface ParsedUserResponse {
  selected_option_id: string | null;
  selected_option_label: string | null;
  free_text: string | null;
}

export function parseUserResponse(question: InterviewQuestion, input: string): ParsedUserResponse | null {
  const text = input.trim();
  if (text.length === 0) return null;

  const options = question.options ?? [];
  if (options.length > 0) {
    // Número entero dentro de 1..N → opción N (con su label legible).
    if (/^\d+$/.test(text)) {
      const n = Number(text);
      if (n >= 1 && n <= options.length) {
        const chosen = options[n - 1];
        return { selected_option_id: chosen.id, selected_option_label: chosen.label, free_text: null };
      }
      // Número fuera de rango → se trata como texto libre.
    }
    // Id exacto de una opción, con o sin corchetes, case-insensitive.
    const normalized = text.replace(/^\[|\]$/g, "").toLowerCase();
    const byId = options.find((o) => o.id.toLowerCase() === normalized);
    if (byId) {
      return { selected_option_id: byId.id, selected_option_label: byId.label, free_text: null };
    }
  }

  return { selected_option_id: null, selected_option_label: null, free_text: text };
}

// ─── Llamada estructurada con reintentos ─────────────────────────────────

// El modelo es barato pero ruidoso: de vez en cuando devuelve JSON con keys rotas
// (tags "<arg_key:...>" incrustados, objetos de nulos, options ausentes).
// El server 1.18.18 no aplica estrictamente el schema (retryCount interno
// roto), así que el MOTOR reintenta la llamada completa cuando el output no
// valida. Cada reintento es una llamada más al modelo (se audita aparte).
const MAX_STRUCTURED_RETRIES = 2;

// La síntesis (final o del brief) es la llamada más cara del flujo: recibe el
// contexto completo y genera el JSON más grande. Los errores de API y los
// timeouts se reintentan igual que los outputs fuera de contrato.
export const SYNTHESIS_TIMEOUT_MS = 360_000;

let structuredRetryCountValue = 0;

// Cantidad de reintentos por output fuera de contrato (auditoría para tests).
export function structuredRetryCount(): number {
  return structuredRetryCountValue;
}

// Llamada estructurada con reintentos (exportada para módulos hermanos,
// ej: brief.ts — el ledger puede ser cualquier objeto con session_id).
// `model` opcional: override de modelo por llamada (las llamadas GRANDES —
// síntesis y gap-check — usan deepseek-v4-flash con su ventana de contexto
// 1M; los turnos por pregunta usan los defaults hy3). Sin `model`, usa
// DEFAULT_PROVIDER_ID/DEFAULT_MODEL_ID/DEFAULT_MODEL_VARIANT.
// `phaseId` opcional: activa el routing por fase (modelo efectivo vía
// phaseModelRef si no hay `model` explícito) y el gate de disponibilidad —
// valida el ref resuelto contra el catálogo real ANTES de abrir sesión.
export async function promptStructuredInner<T>(
  ledger: InterviewLedger,
  schema: Record<string, unknown>,
  text: string,
  validate: (value: unknown) => value is T,
  context: string,
  timeoutMs: number = MODEL_CALL_TIMEOUT_MS,
  model?: ModelRef,
  phaseId?: PhaseId,
): Promise<{ data: T; usage: ModelUsage }> {
  // Resolución ÚNICA acá adentro: si llega phaseId sin model explícito, el
  // modelo efectivo sale de phaseModelRef (override del usuario > default).
  // Ningún call site puede "olvidarse" del routing por descuido.
  const efectivo = model ?? (phaseId ? phaseModelRef(phaseId) : undefined);
  const providerID = efectivo?.providerID ?? DEFAULT_PROVIDER_ID;
  const modelID = efectivo?.modelID ?? DEFAULT_MODEL_ID;
  const variant = efectivo?.variant !== undefined ? efectivo.variant : DEFAULT_MODEL_VARIANT;
  // Gate temprano con el ref RESUELTO (override del usuario o default):
  // un modelo inexistente falla acá, no a mitad de la entrevista.
  // Ahora respeta el harness elegido por fase (opencode vs codebuddy).
  if (phaseId) {
    await gateModeloDeFase(phaseId, { providerID, modelID, ...(variant ? { variant } : {}) });
  }
  const harness = getHarnessForPhase(phaseId);
  await harness.ensureReady();
  let lastRaw: unknown;
  // Marca si ya se recreó la sesión por overflow de contexto en ESTA llamada:
  // el reintento tras recrear es ÚNICO (si vuelve a desbordar, es un error
  // determinista del contexto inline y no se reintenta de nuevo).
  let recreadaPorOverflow = false;
  // Cancelación cooperativa: el servicio puede abortar este controller vía
  // cancelInterviewSession(session_id). El abort NO consume reintentos —
  // sale inmediato como InterviewCancelledError.
  const controller = new AbortController();
  activeBySession.set(ledger.session_id, controller);
  const callSignal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  const ensureNotCancelled = (): void => {
    if (
      controller.signal.aborted ||
      abortedSessions.has(ledger.session_id)
    ) {
      throw new InterviewCancelledError();
    }
  };
  try {
    ensureNotCancelled();
    for (let attempt = 0; attempt <= MAX_STRUCTURED_RETRIES; attempt++) {
      ensureNotCancelled();
      try {
        const result = await harness.promptStructuredRaw({
          sessionId: ledger.session_id,
          projectPath: ledger.project_path,
          model: { providerID, modelID, ...(variant ? { variant } : {}) },
          text,
          schema,
          timeoutMs,
          signal: callSignal,
        });
        ensureNotCancelled();
        modelCallCountValue += 1;
        const raw = result.raw as T;
        if (validate(raw)) {
          return {
            data: raw,
            usage: result.usage,
          };
        }
        lastRaw = raw;
        structuredRetryCountValue += 1;
        console.warn(
          `[interview] ${context}: output fuera de contrato (intento ${attempt + 1}/${MAX_STRUCTURED_RETRIES + 1}, harness=${harness.harnessId}); reintentando`,
        );
        continue;
      } catch (err) {
        ensureNotCancelled();
        // Session not found → recrear sesión vía harness (opencode: server, codebuddy: id efímero)
        const serializado = err instanceof Error ? err.message : String(err);
        const esSesionPerdida = serializado.includes("Session not found");
        if (esSesionPerdida) {
          try {
            const sesion = await harness.createSession({
              projectPath: ledger.project_path,
              title: `${context} (sesión recreada)`,
            });
            ledger.session_id = sesion.id;
            console.warn(`[interview] ${context}: sesión original no encontrada; recreada como ${sesion.id} (harness=${harness.harnessId})`);
          } catch (createErr) {
            throw new Error(`${context}: no se pudo recrear la sesión: ${String(createErr)}`);
          }
          continue;
        }
        // Distingue error del modelo (info.error) vs error transitorio (respuesta.error / red)
        const infoError = (err as Record<string, unknown>)?._infoError as
          | { name?: string; message?: string }
          | undefined;
        const hasInfoError = !!infoError;
        const errName = infoError?.name ?? (err as Error).name;
        const errMsg = infoError?.message ?? serializado;
        // Overflow — reintento único en sesión nueva (solo para infoError)
        if (hasInfoError && !recreadaPorOverflow && esOverflowDeContexto({ name: errName, message: errMsg })) {
          try {
            const sesion = await harness.createSession({
              projectPath: ledger.project_path,
              title: `${context} (sesión nueva por overflow)`,
            });
            ledger.session_id = sesion.id;
            recreadaPorOverflow = true;
            console.warn(
              `[interview] ${context}: overflow de contexto (${errName}); reintento único en sesión nueva ${sesion.id} (harness=${harness.harnessId})`,
            );
          } catch (createErr) {
            throw new Error(`${context}: no se pudo crear sesión por overflow: ${String(createErr)}`);
          }
          continue;
        }
        if (hasInfoError) {
          // Error del modelo (info.error) — falla directo, no se reintenta como transitorio
          // (salvo overflow ya manejado arriba). Incluye StructuredOutputError y APIError.
          if (errName === "StructuredOutputError") {
            throw new Error(`${context}: el modelo no cumplió el schema (${errName})`);
          }
          throw new Error(`${context}: error del modelo (${errName ?? "Unknown"})`);
        }
        if (err instanceof InterviewCancelledError || errName === "InterviewCancelledError") throw err;
        // Transitorio (respuesta.error, timeout, red) — reintentar si quedan intentos
        if (attempt < MAX_STRUCTURED_RETRIES) {
          console.warn(`[interview] ${context}: error de llamada (${serializado}); reintentando (harness=${harness.harnessId})`);
          continue;
        }
        throw new Error(`${context} falló: ${serializado}`);
      }
    }
    throw new Error(`${context} fuera de contrato tras ${MAX_STRUCTURED_RETRIES + 1} intentos: ${JSON.stringify(lastRaw)}`);
  } finally {
    activeBySession.delete(ledger.session_id);
    abortedSessions.delete(ledger.session_id);
  }
}

/**
 * Wrapper público que emite el feed de actividad (start/end con timing,
 * usage y error) alrededor del cuerpo con reintentos. El ref para el evento
 * se resuelve igual que adentro (override > default) para que el feed
 * muestre SIEMPRE lo mismo que la llamada va a usar.
 */
export async function promptStructured<T>(
  ledger: InterviewLedger,
  schema: Record<string, unknown>,
  text: string,
  validate: (value: unknown) => value is T,
  context: string,
  timeoutMs: number = MODEL_CALL_TIMEOUT_MS,
  model?: ModelRef,
  phaseId?: PhaseId,
): Promise<{ data: T; usage: ModelUsage }> {
  const startedAt = Date.now();
  const efectivo = model ?? (phaseId ? phaseModelRef(phaseId) : undefined);
  const modelRefForEvent: ModelRef = efectivo ?? {
    providerID: DEFAULT_PROVIDER_ID,
    modelID: DEFAULT_MODEL_ID,
  };
  emitActivity({
    kind: "start",
    phaseId,
    context,
    modelRef: modelRefForEvent,
    startedAt,
  });
  try {
    const result = await promptStructuredInner(
      ledger,
      schema,
      text,
      validate,
      context,
      timeoutMs,
      model,
      phaseId,
    );
    emitActivity({
      kind: "end",
      phaseId,
      context,
      modelRef: modelRefForEvent,
      startedAt,
      durationMs: Date.now() - startedAt,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
    });
    return result;
  } catch (err) {
    emitActivity({
      kind: "end",
      phaseId,
      context,
      modelRef: modelRefForEvent,
      startedAt,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ¿El error del modelo es un overflow de contexto? El server lo reporta como
// ContextOverflowError (nombre) o con mensajes de "context length exceeded" /
// "prompt is too long" según el provider. Los mensajes reales de DeepSeek
// (contexto 1M, no debería pasar) y de proveedores OpenAI-compatibles varían,
// así que se matchea nombre + patrones comunes del mensaje.
function esOverflowDeContexto(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown };
  if (typeof e.name === "string" && /contextoverflow|max.*context|context.*length|prompt.*too (long|large)|request.*too large/i.test(e.name)) {
    return true;
  }
  if (typeof e.message === "string") {
    return /context length exceeded|maximum context|context overflow|prompt is too long|request too large|content is too large/i.test(e.message);
  }
  return false;
}

// Fase 6A: pasada final de huecos. UNA llamada con el conjunto COMPLETO de
// respuestas (todo junto, no tópico por tópico). Es la llamada más cara de la
// entrevista a propósito, pero se paga una sola vez.
export async function askGapCheck(
  ledger: InterviewLedger,
  projectBrief: string,
): Promise<{ result: { gaps: GapRecord[] }; usage: ModelUsage }> {
  const prompt = `Sos un Revisor de Calidad de Arquitectura (Portal de Calidad). Tu misión es encontrar HUECOS en la entrevista que impidan a un desarrollador empezar a programar sin incertidumbre.

Proyecto: ${projectBrief}
Tópicos de la entrevista: ${ledger.topics.join(", ")}

Respuestas de la entrevista (texto completo, sin truncar — esta es la pasada que se puede pagar el contexto):
${buildSummary(ledger, 500)}

Instrucciones Críticas:
1. Olfateo de Atributos Implícitos: revisá si el usuario omitió atributos de calidad estándar (ISO 25010) que son obvios para el dominio pero no se dijeron (ej: si es una app de salud, ¿dónde está la Seguridad/Privacidad y la Protección/Safety?).
2. Verificabilidad: detectá cualquier requerimiento que no tenga un criterio de ajuste medible.
3. Cabos Sueltos: si se mencionó una integración externa (API, DB adyacente) pero no el estilo de interacción (¿RPC, REST, Mensajería?), marcalo como hueco. También revisá dependencias externas (APIs, hardware) cuyas FALLAS no estén contempladas en los escenarios de Disponibilidad o Protección (las interfaces son vías de dos sentidos: no basta el estilo, hay que prever el fallo del otro lado).
4. Restricciones Globales: buscá huecos de cumplimiento normativo o legal según el país o la industria del proyecto (ej: GDPR, Sarbanes-Oxley, normativa de salud) — una restricción externa obligatoria que no se contempló es un hueco, aunque no parezca "técnico".
5. Consistencia Global: compará el conjunto COMPLETO de respuestas — una decisión de Rendimiento en un tópico que anula una de Seguridad en otro es un hueco de consistencia (el portal de calidad exige comprobar la consistencia como última instancia).
6. Cohesión y Acoplamiento: si una funcionalidad está repartida en demasiados tópicos sin un componente claro que la "adueñe", marcalo como hueco de Modularidad — un desarrollador no sabrá dónde escribir ese código.

Por cada hueco real, devolvé el tópico de la lista al que corresponde, el motivo técnico y suggested_action="reopen_topic". Si los atributos de Disponibilidad, Rendimiento y Seguridad están cubiertos con métricas, devolvé gaps=[].`;
  const { data, usage } = await promptStructured(
    ledger,
    GAP_CHECK_SCHEMA,
    prompt,
    isValidGapCheckResult,
    "Gap-check",
    MODEL_CALL_TIMEOUT_MS,
    phaseModelRef("gapCheck"),
    "gapCheck",
  );
  return { result: data, usage };
}

// Fase 6B: doble validación ASR. Rol de Arquitecto Revisor INDEPENDIENTE
// sobre un tópico arquitectónico recién cerrado con suficiente. El output
// (is_genuine_asr + reason + title/body opcionales) queda persistido en el
// ledger — la justificación queda trazable como Issue de GitHub.
export async function runAsrReview(
  ledger: InterviewLedger,
  topic: string,
  projectBrief: string,
): Promise<{ result: AsrReviewVerdict; usage: ModelUsage }> {
  const last = lastAnswerOfTopic(ledger, topic);
  const texto = last ? truncate(last.free_text ?? last.selected_option_id ?? "(sin texto)", 200) : "(sin respuesta)";
  const prompt = `Sos un Arquitecto Revisor Independiente. Debés juzgar si el tópico "${topic}" del proyecto "${projectBrief}" cerró con un ASR genuino.

Respuesta del tópico:
"${texto}"

Definición de ASR: un requerimiento es un ASR solo si tiene un impacto profundo en la estructura (ej: obliga a usar microservicios, caché distribuida, o un estilo dirigido por eventos). Si se puede resolver con "buen código" sin cambiar la forma del sistema, es solo una preferencia de producto.

Análisis Requerido:
1. Impacto Estructural: ¿qué decisión técnica fuerza este requerimiento? Distinguí decisión TÉCNICA de decisión ARQUITECTÓNICA: elegir una tecnología (ej: React.js) es técnico; se vuelve arquitectónico solo si se elige específicamente para soportar un atributo (rendimiento, escalabilidad). Si la respuesta del usuario menciona una tecnología, validá si es un MEDIO para un fin (el ASR) o una preferencia de stack.
2. Escenario de 6 partes: redactá el escenario técnico final (Fuente, Estímulo, Artefacto, Entorno, Respuesta, Medida).
3. Análisis de Compromisos (Trade-offs): identificá qué otro atributo de calidad se ve perjudicado por esta decisión (ej: +Seguridad = -Rendimiento).
4. Restricciones (Constraints): no ignores requerimientos que, aunque no parezcan "técnicos", restringen la libertad de diseño de forma obligatoria (presupuesto, tiempo, leyes como GDPR).
5. Justificación Arquitectónica: si es un ASR genuino, explicá qué patrón o estilo se estaría eligiendo (capas, microservicios, dirigido por eventos) y por qué es la solución "menos mala" para ese problema — el "porqué" es lo más valioso de la documentación.

Respondé is_genuine_asr (true solo si es un ASR genuino según la definición, incluyendo restricciones obligatorias) y el motivo en una frase en reason.`;
  const { data, usage } = await promptStructured(
    ledger,
    ASR_REVIEW_SCHEMA,
    prompt,
    isValidAsrReviewResult,
    "Revisión ASR",
    MODEL_CALL_TIMEOUT_MS,
    phaseModelRef("asrReview"),
    "asrReview",
  );
  return { result: data, usage };
}

export function recordAnswer(
  ledgerPath: string,
  ledger: InterviewLedger,
  answer: Omit<InterviewAnswer, "id">,
): InterviewAnswer {
  // UPSERT por (topic, question_text): si el usuario re-respondió la MISMA
  // pregunta (volver atrás y editar), se reemplaza la respuesta anterior en
  // vez de duplicarla — dos respuestas al mismo texto generaban
  // contradicciones falsas y ruido en el historial.
  const existente = [...ledger.answers]
    .reverse()
    .find((a) => a.topic === answer.topic && a.question_text === answer.question_text);
  if (existente) {
    existente.selected_option_id = answer.selected_option_id;
    existente.selected_option_label = answer.selected_option_label ?? null;
    existente.free_text = answer.free_text;
    // La clasificación/juicio llegan en la llamada siguiente (se re-juzga).
    existente.response_kind = "informative";
    existente.sufficient = null;
    // La respuesta cambió: las contradicciones ABIERTAS que la referenciaban
    // ya no aplican (el conflicto era contra la versión anterior).
    ledger.contradictions = ledger.contradictions.filter(
      (c) =>
        c.status !== "open" ||
        (c.answer_id !== existente.id && c.conflicting_answer_id !== existente.id),
    );
    saveLedger(ledgerPath, ledger);
    return existente;
  }
  const registrada: InterviewAnswer = { ...answer, id: `a${ledger.answers.length + 1}` };
  ledger.answers.push(registrada);
  saveLedger(ledgerPath, ledger);
  return registrada;
}

function truncate(text: string, max: number): string {
  const limpio = text.replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 3)}...` : limpio;
}

function buildResolutionQuestion(ledger: InterviewLedger, contradiction: ContradictionRecord): InterviewQuestion {
  const nueva = ledger.answers.find((a) => a.id === contradiction.answer_id);
  const anterior = ledger.answers.find((a) => a.id === contradiction.conflicting_answer_id);
  const textoNueva = truncate(nueva?.free_text ?? nueva?.selected_option_id ?? "(sin texto)", 60);
  const textoAnterior = truncate(anterior?.free_text ?? anterior?.selected_option_id ?? "(sin texto)", 60);
  return {
    question_text: `Detectamos una contradicción: ${contradiction.reason} Acabás de decir "${textoNueva}", pero antes dijiste "${textoAnterior}". ¿Cuál de las dos vale?`,
    kind: "single_select",
    options: [
      { id: "nueva", label: `Vale lo que acabo de decir: "${textoNueva}"` },
      { id: "anterior", label: `Vale lo que dije antes: "${textoAnterior}"` },
      { id: "ambas", label: "Ambas: se complementan y aclaro cómo" },
    ],
  };
}

// Turno completo de un tópico: registra la respuesta, hace la llamada que
// clasifica + juzga + detecta contradicciones + genera, escribe la
// clasificación en la answer, y deja que el SCHEDULER decida el próximo
// tópico (el estado del tópico es derivado: el scheduler salta exhausted,
// vuelve a pending para drill-down y deja parked para el final).
export async function submitAnswer(
  ledgerPath: string,
  ledger: InterviewLedger,
  input: UserAnswerInput,
  projectBrief: string,
): Promise<TurnResult> {
  // 0. Contradicción abierta: este turno es su RESOLUCIÓN (sin llamada al
  //    modelo para juzgar; la pregunta de resolución ya está armada).
  const open = lastOpenContradiction(ledger);
  if (open) {
    return resolveContradiction(ledgerPath, ledger, open, input, projectBrief);
  }

  // 1. Registra la respuesta (su clasificación llega en la llamada). La
  //    pregunta pendiente se consume: la próxima se re-genera/encola.
  ledger.pending_question = null;
  const nueva = recordAnswer(ledgerPath, ledger, {
    topic: input.topic,
    question_text: input.question_text,
    selected_option_id: input.selected_option_id,
    selected_option_label: input.selected_option_label ?? null,
    free_text: input.free_text,
  });

  // 2. La llamada que clasifica + juzga + detecta + genera. (El scheduler
  //    nunca elige un tópico exhausted, así que la llamada siempre aporta;
  //    el cupo viejo de "saltar la llamada" quedó cubierto por la
  //    transición derivada en topicState.)
  const turn = await askQuestion(ledger, input.topic, projectBrief);
  const generated = turn.question;
  let usage = turn.usage;

  // 3. Escribe la clasificación y el juicio en la respuesta registrada.
  nueva.response_kind = generated.response_kind ?? "informative";
  if (generated.response_kind === "informative") {
    nueva.sufficient = generated.previous_answer_sufficient;
  } else {
    // Basura y diferida no se juzgan por suficiencia (el modelo devuelve
    // null por la regla del prompt); si igual lo mandó, no se guarda.
    nueva.sufficient = null;
  }
  saveLedger(ledgerPath, ledger);

  // 4. Contradicción detectada: se registra (open) y el turno pasa a ser de
  //    resolución — el usuario elige cuál versión vale ANTES de que nada
  //    avance. La pregunta se arma en código, sin llamada al modelo.
  //
  //    VALIDACIÓN: la contradicción debe apuntar a una respuesta ANTERIOR
  //    distinta de la recién dada. El modelo a veces marca como "conflicto"
  //    la propia respuesta que está clasificando (falso positivo → c: a1 vs
  //    a1) o un id inexistente; en ese caso se descarta, no se registra.
  if (generated.contradiction) {
    const conflictingId = generated.contradiction.conflicting_answer_id;
    const existeOtraAnterior = ledger.answers.some((a) => a.id === conflictingId && a.id !== nueva.id);
    if (!existeOtraAnterior) {
      console.warn(
        `[interview] contradicción descartada: apunta a "${conflictingId}" (no es una respuesta anterior distinta de "${nueva.id}")`,
      );
    } else {
      const contradiction: ContradictionRecord = {
        id: `c${ledger.contradictions.length + 1}`,
        answer_id: nueva.id,
        conflicting_answer_id: conflictingId,
        reason: generated.contradiction.reason,
        status: "open",
        resolution: null,
      };
      ledger.contradictions.push(contradiction);
      saveLedger(ledgerPath, ledger);
      return {
        done: false,
        kind: "resolution",
        question: buildResolutionQuestion(ledger, contradiction),
        topic: CONTRADICTION_TOPIC_ID,
        contradiction,
        usage,
      };
    }
  }

  // 4b. Cierre del tópico: si quedó cerrado (por suficiente O por cupo/
  //     basura), ya no puede volver a preguntarse → sale de reopens (si
  //     había sido reabierto por el gap-check). Y si cerró CON suficiente
  //     siendo un tópico ARQUITECTÓNICO, corre la doble validación ASR
  //     (Parte B de la Fase 6): una llamada extra e independiente;
  //     best-effort (si falla, la entrevista no se cuelga).
  const cerrado = nueva.sufficient === true || topicState(ledger, input.topic) === "exhausted";
  if (cerrado) {
    ledger.reopens = (ledger.reopens ?? []).filter((r) => r.topic !== input.topic);
    if (
      nueva.sufficient === true &&
      ARCHITECTURAL_TOPICS.has(input.topic) &&
      !(ledger.asr_reviews ?? []).some((r) => r.topic === input.topic)
    ) {
      try {
        const review = await runAsrReview(ledger, input.topic, projectBrief);
        (ledger.asr_reviews ??= []).push({
          topic: input.topic,
          answer_id: nueva.id,
          verdict: review.result,
          at: new Date().toISOString(),
        });
        usage = mergeUsage(usage, review.usage);
      } catch (err) {
        console.error(`[interview] revisión ASR falló (best-effort): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    saveLedger(ledgerPath, ledger);
  }

  // 5. El scheduler decide el próximo tópico — 100% código, sin modelo.
  const next = pickNextTopic(ledger);
  if (!next) {
    // 5a. Fase 6A — gap-check final: se queda sin pendientes, pero antes de
    //     dar por terminada la entrevista corre UNA vez (solo si nunca
    //     corrió) la pasada holística de huecos. Si detecta huecos con
    //     reopen_topic, los tópicos se reabren y se les da una oportunidad
    //     más. Best-effort: si la llamada falla, la entrevista termina igual.
    if (ledger.gap_check === null) {
      try {
        const gap = await askGapCheck(ledger, projectBrief);
        usage = mergeUsage(usage, gap.usage);
        ledger.gap_check = { gaps: gap.result.gaps, at: new Date().toISOString() };
        for (const hueco of gap.result.gaps) {
          if (
            hueco.suggested_action === "reopen_topic" &&
            ledger.topics.includes(hueco.topic) &&
            !ledger.reopens.some((r) => r.topic === hueco.topic)
          ) {
            ledger.reopens.push({ topic: hueco.topic, reason: hueco.reason });
          }
        }
        saveLedger(ledgerPath, ledger);
      } catch (err) {
        console.error(`[interview] gap-check falló (best-effort): ${err instanceof Error ? err.message : String(err)}`);
        return { done: true, reason: "all_topics_closed", usage };
      }
      const reopened = pickNextTopic(ledger);
      if (reopened) {
        const turn = await askQuestion(ledger, reopened, projectBrief);
        ledger.pending_question = { topic: reopened, question: turn.question };
        saveLedger(ledgerPath, ledger);
        return {
          done: false,
          kind: "question",
          question: turn.question,
          topic: reopened,
          sufficient: null,
          contradiction: null,
          usage: mergeUsage(usage, turn.usage),
        };
      }
    }
    return { done: true, reason: "all_topics_closed", usage };
  }

  // 6. Mismo tópico (drill-down o repregunta tras un noise): la pregunta
  //    generada en el paso 2 sirve.
  if (next === input.topic) {
    ledger.pending_question = { topic: next, question: generated };
    saveLedger(ledgerPath, ledger);
    return {
      done: false,
      kind: "question",
      question: generated,
      topic: next,
      sufficient: nueva.sufficient ?? null,
      contradiction: null,
      usage,
    };
  }

  // 7. Otro tópico (avance, última chance de un parked, o tópico nuevo):
  //    primera pregunta del tópico decidido por el scheduler.
  const nextTurn = await askQuestion(ledger, next, projectBrief);
  ledger.pending_question = { topic: next, question: nextTurn.question };
  saveLedger(ledgerPath, ledger);
  return {
    done: false,
    kind: "question",
    question: nextTurn.question,
    topic: next,
    sufficient: null,
    contradiction: null,
    usage: {
      input_tokens: usage.input_tokens + nextTurn.usage.input_tokens,
      output_tokens: usage.output_tokens + nextTurn.usage.output_tokens,
    },
  };
}

// Procesa la respuesta a una pregunta de resolución: marca la contradicción
// como resuelta (con la elección del usuario), descarta la versión perdedora
// (superseded — no participará de la detección de choques futura) y retoma
// la entrevista normal: el scheduler elige el próximo tópico.
async function resolveContradiction(
  ledgerPath: string,
  ledger: InterviewLedger,
  contradiction: ContradictionRecord,
  input: UserAnswerInput,
  projectBrief: string,
): Promise<TurnResult> {
  contradiction.status = "resolved";
  contradiction.resolution = {
    selected_option_id: input.selected_option_id,
    free_text: input.free_text,
  };

  // Aplica el veredicto del usuario: la versión que NO vale queda descartada.
  // ("ambas" o una aclaración libre no descartan ninguna — anotado para
  // fases futuras.)
  const nueva = ledger.answers.find((a) => a.id === contradiction.answer_id);
  const anterior = ledger.answers.find((a) => a.id === contradiction.conflicting_answer_id);
  if (input.selected_option_id === "nueva" && anterior) {
    anterior.superseded = true;
    anterior.superseded_by = contradiction.id;
  } else if (input.selected_option_id === "anterior" && nueva) {
    nueva.superseded = true;
    nueva.superseded_by = contradiction.id;
  }
  saveLedger(ledgerPath, ledger);

  const next = pickNextTopic(ledger);
  if (!next) {
    return { done: true, reason: "all_topics_closed", usage: { input_tokens: 0, output_tokens: 0 } };
  }
  const turn = await askQuestion(ledger, next, projectBrief);
  return {
    done: false,
    kind: "question",
    question: turn.question,
    topic: next,
    sufficient: null,
    contradiction: null,
    usage: turn.usage,
  };
}

// La contradicción abierta más antigua (FIFO), o null si no hay ninguna.
export function lastOpenContradiction(ledger: InterviewLedger): ContradictionRecord | null {
  return ledger.contradictions.find((c) => c.status === "open") ?? null;
}

// ─── Síntesis final (planilla de salida) ─────────────────────────────────

// Ruta del JSON standalone de la síntesis (junto al ledger).
export function synthesisFilePath(ledgerPath: string): string {
  return ledgerPath.replace(/\.json$/, "-sintesis.json");
}

// Contexto enriquecido que ve el modelo en la síntesis: respuestas con su
// estado (suficiente/ruido/diferida/descartada), tópicos cerrados, huecos,
// veredictos ASR y contradicciones — para que la planilla se llene SOLO con
// evidencia real de la entrevista.
function buildSynthesisContext(ledger: InterviewLedger, projectBrief: string): string {
  const answers = ledger.answers
    .map((a) => {
      const marca = a.superseded
        ? " (DESCARTADA — el usuario eligió la otra versión en la resolución de contradicción)"
        : a.response_kind === "noise"
          ? " (RUIDO — no es dato confiable)"
          : a.response_kind === "deferred"
            ? " (DIFERIDA — el usuario no la respondió)"
            : "";
      const juicio = a.sufficient === true ? " [suficiente]" : a.sufficient === false ? " [insuficiente]" : "";
      const texto = (a.free_text ?? a.selected_option_label ?? a.selected_option_id ?? "(sin texto)")
        .replace(/\s+/g, " ")
        .trim();
      return `- [${a.id}] ${a.topic}: "${texto}"${juicio}${marca}`;
    })
    .join("\n");

  const estados = ledger.topics
    .map((t) => {
      const st = topicState(ledger, t);
      const motivo = closedReasonOf(ledger, t);
      return `${t}: ${st}${motivo ? ` (${motivo})` : ""}`;
    })
    .join(", ");

  const contradicciones =
    ledger.contradictions.length === 0
      ? "(ninguna)"
      : ledger.contradictions
          .map(
            (c) =>
              `- ${c.id}: [${c.answer_id}] vs [${c.conflicting_answer_id}] — ${c.reason} [${c.status}${
                c.resolution?.selected_option_id ? ` → eligió "${c.resolution.selected_option_id}"` : ""
              }]`,
          )
          .join("\n");

  const gaps =
    !ledger.gap_check || ledger.gap_check.gaps.length === 0
      ? "(sin huecos detectados)"
      : ledger.gap_check.gaps.map((g) => `- ${g.topic}: ${g.reason}`).join("\n");

  const asr =
    ledger.asr_reviews.length === 0
      ? "(sin revisiones ASR)"
      : ledger.asr_reviews
          .map((r) => `- ${r.topic}: is_genuine_asr=${r.verdict.is_genuine_asr} — ${r.verdict.reason}`)
          .join("\n");

  return `Proyecto: ${projectBrief}
session_id: ${ledger.session_id}

Respuestas de la entrevista (texto completo):
${answers}

Estado de los tópicos: ${estados}

Contradicciones:
${contradicciones}

Revisión final de huecos:
${gaps}

Doble validación ASR:
${asr}`;
}

function buildSynthesisPrompt(ledger: InterviewLedger, projectBrief: string): string {
  return `Sos un Analista de Requerimientos y Arquitecto de Software Senior. La entrevista de requerimientos TERMINÓ y tenés el conjunto completo de datos. Completá la planilla de síntesis con TODOS los campos, basándote SOLO en la evidencia de la entrevista — no inventes requerimientos que no estén respaldados por una respuesta.

${buildSynthesisContext(ledger, projectBrief)}

Reglas de calidad:
- historias_de_usuario: derivadas PRIMERO, SOLO de respuestas informativas ACTIVAS (sin RUIDO, DIFERIDA ni DESCARTADA) y de los roles del brief. Una historia captura intención de producto: "Como <rol>, quiero <acción>, para <beneficio>", con criterios_de_aceptacion verificables, prioridad MoSCoW y el id de la answer que la originó en "origen". El rol sale del brief (usuarios_objetivo / stakeholders); si el brief no lo especifica, usá el rol que la propia evidencia de la entrevista indique. No inventes historias sin respaldo en una respuesta.
- requerimientos_funcionales: FORMALIZAN las historias. La relación es N:N: cada RF lleva "historias_origen" (array de ids) con TODAS las historias que formaliza — mínimo UNA. Un RF puede satisfacer varias intenciones de negocio y NO debe duplicarse por historia (atomicidad / DRY): si una misma capacidad sirve a dos historias, un solo RF con ambas en historias_origen. Un RF jamás nace de otra fuente que no sea una historia (o, en casos excepcionales sin historia, de una respuesta que no justificó una historia propia). Cada RF con criterio_de_ajuste verificable y el id de la answer que lo originó en "origen". Asigná prioridad MoSCoW según la importancia que el creador le dio.
- atributos_de_calidad_y_asrs: TODOS los atributos de calidad que la evidencia de la entrevista respalde — sin tope ni mínimo, y puede haber VARIOS del mismo tipo si hay escenarios distintos (dos ASR de rendimiento con escenarios diferentes son válidos). Categorías típicas del catálogo de tácticas: disponibilidad, rendimiento, protección, seguridad, eficiencia energética, modificabilidad y despliegue. "Protección" es safety (evitar, detectar o remediar ESTADOS INSEGUROS: fallas catastróficas, hardware, eventos en orden incorrecto) y se distingue de "seguridad" (security: resistir accesos no autorizados). Cada uno con su escenario_tecnico_6_partes COMPLETO (fuente, estímulo, artefacto, entorno, respuesta, medida_de_respuesta cuantificable) y los trade_offs_identificados. es_asr_genuino=true SOLO si fuerza una decisión estructural profunda — usá los veredictos de la doble validación ASR si existen.
- restricciones_globales: restricciones explícitas de la entrevista o normativas obvias del dominio (ej: GDPR si hay datos personales).
- glosario_de_terminos: términos técnicos o de dominio ambiguos usados en la entrevista (objeto vacío si no aplica).
- proyecto_metadata: nombre_proyecto del brief, id_sesion de la entrevista, fecha_relevamiento (hoy, ISO8601), brief_contexto (resumen del dominio y metas del negocio).
- historias_backfilled: false (es la generación original; la migración legacy es la única que lo pone en true).

Completá TODOS los campos.`;
}

// Síntesis final: UNA llamada al modelo con el contexto completo de la
// entrevista. Se llama DESPUÉS de que la entrevista terminó (done) — no la
// dispara el motor automáticamente (los tests de fases anteriores no suman
// llamadas). Guarda el resultado en el ledger (ledger.synthesis) y escribe
// el JSON standalone junto al ledger.
export async function synthesizeInterview(
  ledgerPath: string,
  projectBrief: string,
): Promise<{ synthesis: SynthesisResult; usage: ModelUsage; synthesisPath: string }> {
  const ledger = loadLedger(ledgerPath);
  const { data, usage } = await promptStructured(
    ledger,
    SYNTHESIS_SCHEMA,
    buildSynthesisPrompt(ledger, projectBrief),
    isValidSynthesisResult,
    "Síntesis final",
    SYNTHESIS_TIMEOUT_MS,
    phaseModelRef("synthesis"),
    "synthesis",
  );
  // Re-parsea para aplicar defaults/.catch de Zod (promptStructured devuelve
  // el raw; el documento guardado debe quedar completo).
  const parsed = SynthesisSchema.safeParse(data);
  const synthesis = parsed.success ? parsed.data : (data as SynthesisResult);
  ledger.synthesis = { at: new Date().toISOString(), data: synthesis };
  saveLedger(ledgerPath, ledger);
  const synthesisPath = synthesisFilePath(ledgerPath);
  fs.writeFileSync(synthesisPath, JSON.stringify(synthesis, null, 2));
  return { synthesis, usage, synthesisPath };
}

// Limpieza best-effort al terminar la entrevista: borra la sesión (si el
// server ya no está, la deja huérfana) y apaga el server dedicado.
// Ahora harness-agnóstica: intenta borrar vía el harness que creó la sesión
// y vía opencode como fallback; el close cierra todos los harnesses.
export async function cleanupInterview(ledger: InterviewLedger): Promise<void> {
  if (ledger.session_id) {
    // Best-effort: intenta borrar vía todos los harnesses conocidos (id efímero de codebuddy es no-op)
    for (const hid of ["opencode", "codebuddy"] as CliCatalogSource[]) {
      try {
        await getHarness(hid).deleteSession(ledger.session_id);
      } catch {}
    }
  }
  closeInterviewServer();
}
