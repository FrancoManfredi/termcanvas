// Tests del motor de entrevistas con el CLIENTE DE MODELO MOCKEADO.
//
// NADA corre contra un modelo real: se inyecta un cliente falso vía
// setTestClient (seam del engine) que devuelve los JSON esperados. Esto
// permite cubrir todos los flujos del motor sin gastar llamadas:
//   - contrato del payload: turnos con opencode-go/hy3 SIN variant (el
//     camino de siempre); síntesis y gap-check con opencode-go/
//     deepseek-v4-flash (variant "max" solo en la síntesis final — la ventana
//     1M aguanta el contexto completo de la entrevista);
//   - reproducción del error reportado ("Generación de pregunta: error del
//     modelo (APIError)");
//   - reintentos por output fuera de contrato;
//   - turnos, contradicciones, gap-check, ASR, síntesis final;
//   - motor del brief (Fase 0): arranque, posición, respuestas, síntesis.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import {
  setTestClient,
  startInterview,
  askQuestion,
  resumeInterview,
  submitAnswer,
  recordAnswer,
  synthesizeInterview,
  listInterviews,
  deleteInterview,
  interviewProgress,
  lastOpenContradiction,
  modelCallCount,
  structuredRetryCount,
  TOPICS,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  SYNTHESIS_MODEL,
  GAP_CHECK_MODEL,
  type InterviewLedger,
  type TurnResult,
  type QuestionWithJudgment,
} from "../headless-runtime/interview/engine.ts";
import {
  startBriefInterview,
  briefInterviewState,
  recordBriefAnswer,
  loadBriefLedger,
  synthesizeBrief,
  getActiveBrief,
  listBriefDocuments,
  listBriefInterviews,
} from "../headless-runtime/interview/brief.ts";
import { briefDocumentPath, type BriefDocument } from "../headless-runtime/interview/brief.ts";
import { setCatalogClient } from "../electron/model-catalog.ts";

// El gate de modelos (routing por fase) consulta el catálogo de opencode en
// cada llamada del motor: mockeado UNA vez acá para que ningún test intente
// levantar un server REAL (30s de timeout × reintentos × decenas de
// llamadas = suite colgada). Fixture sano con los defaults que este archivo
// asierte: opencode-go conectado con hy3 y deepseek-v4-flash (variant max).
setCatalogClient({
  provider: {
    list: async () => ({
      data: {
        all: [
          {
            id: "opencode-go",
            name: "OpenCode Go",
            models: {
              hy3: { status: "active", limit: { context: 128000 }, variants: {} },
              "deepseek-v4-flash": {
                status: "active",
                limit: { context: 1000000 },
                variants: { max: {} },
              },
            },
          },
        ],
        default: { "opencode-go": "hy3" },
        connected: ["opencode-go"],
      },
    }),
  },
});

// ─── Helpers del mock ────────────────────────────────────────────────────

interface PromptCall {
  sessionID: string;
  model: { providerID: string; modelID: string };
  variant?: string;
  tools: Record<string, boolean>;
  parts: { type: string; text: string }[];
  format: { type: string; schema: Record<string, unknown> };
}

function makeMockClient(prompts: ((req: PromptCall) => unknown)[] = []) {
  const calls = {
    create: [] as { title: string; directory: string }[],
    prompt: [] as PromptCall[],
  };
  let promptIndex = 0;
  // Acepta handlers (función) o respuestas directas (objeto).
  const handlers = prompts.map((h) => (typeof h === "function" ? h : () => h));
  const client = {
    session: {
      create: async (input: { title: string; directory: string }) => {
        calls.create.push(input);
        return { data: { id: `ses_mock_${calls.create.length}` }, error: null };
      },
      prompt: async (input: PromptCall) => {
        calls.prompt.push(input);
        const handler = handlers[promptIndex] ?? handlers[handlers.length - 1];
        if (!handler) throw new Error("Mock sin handler de prompt configurado");
        promptIndex += 1;
        return handler(input);
      },
      delete: async () => ({ data: true, error: null }),
    },
  } as unknown as OpencodeClient;
  return { client, calls };
}

function okPrompt(structured: unknown, tokens = { input: 111, output: 22 }) {
  return {
    error: null,
    data: {
      info: {
        id: "msg_mock",
        sessionID: "s",
        role: "assistant",
        time: { created: 0 },
        modelID: "deepseek-v4-flash",
        providerID: "opencode-go",
        mode: "build",
        agent: "build",
        path: { cwd: "", root: "" },
        cost: 0,
        tokens: { total: 133, input: tokens.input, output: tokens.output, reasoning: 0, cache: { read: 0, write: 0 } },
        structured,
      },
      parts: [],
    },
  };
}

function apiErrorPrompt(name: string) {
  return {
    error: null,
    data: {
      info: {
        id: "msg_mock",
        sessionID: "s",
        role: "assistant",
        time: { created: 0 },
        modelID: "deepseek-v4-flash",
        providerID: "opencode-go",
        mode: "build",
        agent: "build",
        path: { cwd: "", root: "" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        error: { name },
      },
      parts: [],
    },
  };
}

const QUESTION_VALIDA: QuestionWithJudgment = {
  question_text: "¿Qué problema principal resuelve el sistema para el usuario?",
  kind: "single_select",
  options: [
    { id: "o1", label: "Nivel básico: tolera caídas de horas" },
    { id: "o2", label: "Nivel crítico: menos de 5 minutos de caída por mes" },
  ],
  previous_answer_sufficient: null,
  response_kind: null,
  contradiction: null,
};

// La planilla completa de salida (RFs, ASRs, restricciones, glosario) —
// el JSON esperado que el modelo debe producir en la síntesis final.
const SYNTHESIS_JSON = {
  proyecto_metadata: {
    nombre_proyecto: "Cooperativa Verde",
    id_sesion: "ses_mock_1",
    fecha_relevamiento: "2026-08-16T00:00:00.000Z",
    brief_contexto: "Cooperativa hortícola que necesita trazabilidad por QR de sus lotes.",
  },
  requerimientos_funcionales: [
    {
      id: "RF-001",
      descripcion: "El sistema debe permitir dar de alta un lote asociando un QR con producto, fecha y productor.",
      justificacion: "Es el flujo principal y el alcance mínimo declarado por el creador.",
      prioridad: "Must have",
      criterio_de_ajuste: "Una cooperativa completa el alta desde el celular sin planilla de papel.",
      origen: "a1",
    },
    {
      id: "RF-002",
      descripcion: "El sistema debe permitir consultar el historial del lote escaneando el QR.",
      justificacion: "Núcleo del valor: verificar el origen en segundos.",
      prioridad: "Must have",
      criterio_de_ajuste: "Al escanear un QR válido se muestra el historial completo.",
      origen: "a2",
    },
  ],
  atributos_de_calidad_y_asrs: [
    {
      id: "ASR-001",
      atributo: "Disponibilidad",
      es_asr_genuino: true,
      justificacion_arquitectonica: "El registro offline de 2h obliga a arquitectura offline-first con sync idempotente.",
      escenario_tecnico_6_partes: {
        fuente: "Productor en la chacra",
        estimulo: "Pérdida de conectividad por hasta 2 horas",
        artefacto: "PWA de registro de lotes",
        entorno: "Chacra con internet inestable",
        respuesta: "El registro continúa offline y sincroniza al recuperar conexión",
        medida_de_respuesta: "Hasta 2 horas sin conectividad sin pérdida ni duplicados",
      },
      trade_offs_identificados: "Complejidad de sync vs disponibilidad en campo.",
      origen: "a3",
    },
    {
      id: "ASR-002",
      atributo: "Usabilidad",
      es_asr_genuino: false,
      justificacion_arquitectonica: "Registro en menos de 90s es preferencia de UX, no decisión estructural.",
      escenario_tecnico_6_partes: {
        fuente: "Encargada de la cooperativa",
        estimulo: "Debe dar de alta un lote desde su celular",
        artefacto: "PWA de registro",
        entorno: "Cooperativa, celular básico",
        respuesta: "Completa el alta sin ayuda externa",
        medida_de_respuesta: "Tiempo de registro < 90 segundos",
      },
      trade_offs_identificados: "Velocidad vs completitud de campos.",
      origen: "a4",
    },
  ],
  restricciones_globales: [
    {
      id: "CON-001",
      tipo: "Stack Tecnológico",
      descripcion: "Node.js, TypeScript, PostgreSQL y PWA liviana.",
      impacto: "Sin apps nativas ni frameworks pesados.",
    },
    {
      id: "CON-002",
      tipo: "Legal",
      descripcion: "Los datos deben vivir en Uruguay (Ley 18.331).",
      impacto: "Hosting local obligatorio; consentimiento y derechos del titular.",
    },
  ],
  glosario_de_terminos: {
    Lote: "Unidad de fruta registrada con QR al momento de la cosecha.",
    Trazabilidad: "Capacidad de demostrar el origen de un lote en segundos.",
  },
};

// El documento del brief esperado (Fase 0) — completo para pasar el schema.
const BRIEF_DOC: BriefDocument = {
  resumen_proyecto: "Plataforma de trazabilidad hortícola por QR para cooperativas.",
  flujo_principal_ideal: "La encargada da de alta un lote con QR; el mayorista lo escanea y ve el historial.",
  mision: "Que el origen de la comida se verifique en segundos, sin papel.",
  problema: "Los lotes se rechazan por falta de trazabilidad verificable.",
  usuarios_objetivo: "Cooperativas hortícolas y mayoristas del Mercado Central.",
  contexto_origen: "Nace de la experiencia familiar en la chacra.",
  vision: "Red de cooperativas con trazabilidad verificable punta a punta.",
  valores_no_negociables: "Veracidad de los datos; no monetizar datos de productores.",
  stakeholders: "Asamblea de la cooperativa, director de operaciones del mercado.",
  alcance_minimo: "Alta de lotes con QR, consulta por escaneo y alertas de vencimiento.",
  fuera_de_alcance: "Marketplace, pagos, lectura RFID.",
  restricciones_y_supuestos: "Bootstrapped, ~6 meses para el piloto, datos en Uruguay.",
  propuesta_de_valor: "Que el reclamo no quede en el grupo de WhatsApp.",
  incertidumbres_criticas: [
    { tema: "Modelo de reparto de la cosecha", por_que_importa: "Promesa central", impacto_en_diseno: "Reglas de asignación" },
  ],
  alertas_consistencia: [
    { descripcion: "Visión nacional vs alcance mínimo sin coordinación entre barrios.", gravedad: "media" },
  ],
  respuestas_detalladas: [],
  brief_contexto: "Cooperativa hortícola que necesita trazabilidad por QR de sus lotes.",
};

// ─── Fixtures ────────────────────────────────────────────────────────────

let tmpRoot: string;
let projectPath: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tc-engine-mock-"));
  projectPath = path.join(tmpRoot, "proyecto");
  fs.mkdirSync(projectPath, { recursive: true });
  setTestClient(makeMockClient().client);
});

afterEach(() => {
  setTestClient(null);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows: archivos aún abiertos — no crítico en tests.
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────

test("contrato del payload: opencode-go/hy3, SIN variant, json_schema", async () => {
  const { client, calls } = makeMockClient([okPrompt(QUESTION_VALIDA)]);
  setTestClient(client);
  const { ledger } = await startInterview(projectPath);
  await askQuestion(ledger, "problema", "brief de prueba");

  assert.equal(calls.prompt.length, 1);
  const req = calls.prompt[0];
  assert.deepEqual(req.model, { providerID: "opencode-go", modelID: "hy3" });
  assert.equal(req.model.providerID, DEFAULT_PROVIDER_ID);
  assert.equal(req.model.modelID, DEFAULT_MODEL_ID);
  // CLAVE: los turnos por pregunta van SIN variant (hy3 + json_schema, el
  // camino que ya funcionaba). El thinking max queda reservado a la síntesis.
  assert.equal("variant" in req, false, "el prompt del turno NO debe mandar variant");
  assert.equal(req.format.type, "json_schema");
  assert.ok(req.format.schema && typeof req.format.schema === "object");
  assert.deepEqual(req.tools, {});
  assert.ok(req.parts.length >= 1 && req.parts[0].type === "text" && req.parts[0].text.length > 0);
});

test("startInterview (interview:create): crea sesión + ledger, sin llamada de modelo", async () => {
  const { client, calls } = makeMockClient();
  setTestClient(client);
  const antes = modelCallCount();
  const { ledgerPath, ledger } = await startInterview(projectPath);

  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].title, "Entrevista de requerimientos");
  assert.equal(calls.create[0].directory, projectPath);
  assert.equal(ledger.session_id, "ses_mock_1");
  assert.deepEqual(ledger.topics, [...TOPICS]);
  assert.ok(fs.existsSync(ledgerPath));
  assert.equal(modelCallCount() - antes, 0);
});

test("interview:create completo: primera pregunta generada (el flujo que fallaba)", async () => {
  const { client, calls } = makeMockClient([okPrompt(QUESTION_VALIDA)]);
  setTestClient(client);
  const antes = modelCallCount();

  const { ledger } = await startInterview(projectPath);
  const turno = await askQuestion(ledger, ledger.topics[0], "");
  assert.equal(turno.question.kind, "single_select");
  assert.equal(turno.question.options.length, 2);
  assert.equal(turno.question.question_text.length > 0, true);
  assert.equal(calls.prompt.length, 1);
  assert.equal(modelCallCount() - antes, 1);
});

test("reproduce el error reportado: APIError en info.error → 'error del modelo (APIError)'", async () => {
  const { client } = makeMockClient([apiErrorPrompt("APIError")]);
  setTestClient(client);
  const { ledger } = await startInterview(projectPath);

  await assert.rejects(
    () => askQuestion(ledger, "problema", ""),
    /Generación de pregunta: error del modelo \(APIError\)/,
  );
});

test("output fuera de contrato: reintenta hasta obtener uno válido", async () => {
  const invalido = { question_text: "", kind: "single_select", options: [] };
  const { client, calls } = makeMockClient([okPrompt(invalido), okPrompt(QUESTION_VALIDA)]);
  setTestClient(client);
  const retriesAntes = structuredRetryCount();
  const callsAntes = modelCallCount();
  const { ledger } = await startInterview(projectPath);

  const turno = await askQuestion(ledger, "problema", "");
  assert.equal(turno.question.kind, "single_select");
  assert.equal(calls.prompt.length, 2);
  assert.ok(structuredRetryCount() - retriesAntes >= 1, "debe contar el reintento");
  assert.equal(modelCallCount() - callsAntes, 2);
});

test("submitAnswer: turno completo registra, clasifica y encola la pregunta", async () => {
  const juzgada: QuestionWithJudgment = {
    ...QUESTION_VALIDA,
    response_kind: "informative",
    previous_answer_sufficient: false,
  };
  const { client } = makeMockClient([okPrompt(juzgada)]);
  setTestClient(client);
  const { ledgerPath, ledger } = await startInterview(projectPath);

  const turno: TurnResult = await submitAnswer(ledgerPath, ledger, {
    topic: "problema",
    question_text: "¿Qué problema?",
    free_text: "Los lotes se rechazan por falta de trazabilidad.",
    selected_option_id: null,
    selected_option_label: null,
  });

  assert.equal(turno.done, false);
  assert.equal(turno.kind, "question");
  assert.equal(ledger.answers.length, 1);
  assert.equal(ledger.answers[0].response_kind, "informative");
  assert.equal(ledger.answers[0].sufficient, false);
  assert.equal(ledger.pending_question?.topic, "problema");
  assert.deepEqual(interviewProgress(ledger), { answered: 1, closed: 0, total: 5, pct: 0 });
});

test("contradicción: turno de resolución en código + veredicto aplica superseded", async () => {
  const juzgada: QuestionWithJudgment = {
    ...QUESTION_VALIDA,
    response_kind: "informative",
    previous_answer_sufficient: false,
    contradiction: { conflicting_answer_id: "a1", reason: "velocidad vs seguridad" },
  };
  const { client } = makeMockClient([okPrompt(juzgada), okPrompt(QUESTION_VALIDA)]);
  setTestClient(client);
  const { ledgerPath, ledger } = await startInterview(projectPath);

  // Respuesta previa a1 en el mismo tópico.
  recordAnswer(ledgerPath, ledger, {
    topic: "problema",
    question_text: "¿Primera?",
    free_text: "Queremos máxima velocidad.",
    selected_option_id: null,
    selected_option_label: null,
  });

  const turno = await submitAnswer(ledgerPath, ledger, {
    topic: "problema",
    question_text: "¿Segunda?",
    free_text: "Queremos cifrado pesado.",
    selected_option_id: null,
    selected_option_label: null,
  });

  assert.equal(turno.kind, "resolution");
  assert.equal(turno.topic, "__contradiction__");
  assert.equal(lastOpenContradiction(ledger)?.conflicting_answer_id, "a1");
  // La pregunta de resolución se arma en código: 3 opciones (nueva/anterior/ambas).
  assert.equal(turno.question.options.length, 3);

  // El usuario elige la versión anterior → la NUEVA queda descartada.
  const resolucion = await submitAnswer(ledgerPath, ledger, {
    topic: "__contradiction__",
    question_text: turno.question.question_text,
    selected_option_id: "anterior",
    selected_option_label: "Vale lo que dije antes",
    free_text: null,
  });

  assert.equal(lastOpenContradiction(ledger), null);
  assert.equal(ledger.contradictions[0].status, "resolved");
  const nueva = ledger.answers.find((a) => a.id === "a2");
  assert.equal(nueva?.superseded, true);
  assert.equal(nueva?.superseded_by, "c1");
  assert.equal(resolucion.done, false);
});

test("gap-check (Fase 6A): hueco detectado reabre el tópico", async () => {
  const suficiente: QuestionWithJudgment = {
    ...QUESTION_VALIDA,
    response_kind: "informative",
    previous_answer_sufficient: true,
  };
  const gaps = {
    gaps: [{ topic: "problema", reason: "Falta definir la medida de respuesta.", suggested_action: "reopen_topic" }],
  };
  const { client, calls } = makeMockClient([okPrompt(suficiente), okPrompt(gaps), okPrompt(QUESTION_VALIDA)]);
  setTestClient(client);
  const { ledgerPath, ledger } = await startInterview(projectPath);
  // Un solo tópico (problema) ya cubierto → el scheduler se queda sin pendientes.
  ledger.topics = ["problema"];
  recordAnswer(ledgerPath, ledger, {
    topic: "problema",
    question_text: "¿Primera?",
    free_text: "Disponibilidad crítica.",
    selected_option_id: null,
    selected_option_label: null,
  });
  ledger.answers[0].sufficient = true;
  ledger.answers[0].response_kind = "informative";

  const turno = await submitAnswer(ledgerPath, ledger, {
    topic: "problema",
    question_text: "¿Segunda?",
    free_text: "Confirmado: crítica.",
    selected_option_id: null,
    selected_option_label: null,
  });

  assert.ok(ledger.gap_check, "debe correr el gap-check");
  assert.equal(ledger.gap_check?.gaps.length, 1);
  assert.equal(ledger.reopens.length, 1);
  assert.equal(ledger.reopens[0].topic, "problema");
  assert.equal(turno.done, false);
  assert.equal(turno.topic, "problema");

  // Contrato del gap-check: deepseek-v4-flash (ventana 1M) SIN variant.
  const gapReq = calls.prompt[1];
  assert.equal(gapReq.model.providerID, GAP_CHECK_MODEL.providerID);
  assert.equal(gapReq.model.modelID, GAP_CHECK_MODEL.modelID);
  assert.equal("variant" in gapReq, false, "gap-check sin thinking max");
  assert.equal(gapReq.format.type, "json_schema");
});

test("doble validación ASR (Fase 6B): tópico arquitectónico cerrado con suficiente", async () => {
  const suficiente: QuestionWithJudgment = {
    ...QUESTION_VALIDA,
    response_kind: "informative",
    previous_answer_sufficient: true,
  };
  const veredicto = { is_genuine_asr: true, reason: "El registro offline obliga a arquitectura offline-first." };
  const gapsVacios = { gaps: [] };
  const { client } = makeMockClient([okPrompt(suficiente), okPrompt(veredicto), okPrompt(gapsVacios)]);
  setTestClient(client);
  const { ledgerPath, ledger } = await startInterview(projectPath);
  ledger.topics = ["rendimiento"];
  recordAnswer(ledgerPath, ledger, {
    topic: "rendimiento",
    question_text: "¿Primera?",
    free_text: "Latencia < 2s.",
    selected_option_id: null,
    selected_option_label: null,
  });
  ledger.answers[0].sufficient = true;
  ledger.answers[0].response_kind = "informative";

  const turno = await submitAnswer(ledgerPath, ledger, {
    topic: "rendimiento",
    question_text: "¿Segunda?",
    free_text: "Confirmado: < 2s.",
    selected_option_id: null,
    selected_option_label: null,
  });

  assert.equal(ledger.asr_reviews.length, 1);
  assert.equal(ledger.asr_reviews[0].topic, "rendimiento");
  assert.equal(ledger.asr_reviews[0].verdict.is_genuine_asr, true);
  assert.equal(turno.done, true, "sin huecos y sin pendientes → entrevista terminada");
});

test("síntesis final (Fase 6C): planilla completa guardada en ledger + JSON standalone", async () => {
  const { client, calls } = makeMockClient([okPrompt(SYNTHESIS_JSON)]);
  setTestClient(client);
  const { ledgerPath } = await startInterview(projectPath);

  const { synthesis, synthesisPath } = await synthesizeInterview(ledgerPath, "Cooperativa Verde");

  assert.equal(synthesis.requerimientos_funcionales.length, 2);
  assert.equal(synthesis.atributos_de_calidad_y_asrs.length, 2);
  assert.equal(synthesis.atributos_de_calidad_y_asrs[0].es_asr_genuino, true);
  assert.equal(synthesis.restricciones_globales.length, 2);
  assert.equal(Object.keys(synthesis.glosario_de_terminos).length, 2);
  assert.equal(synthesis.proyecto_metadata.nombre_proyecto, "Cooperativa Verde");

  // El ledger guarda la síntesis y el JSON standalone existe con el MISMO contenido.
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as InterviewLedger;
  assert.equal(ledger.synthesis?.data.requerimientos_funcionales[0].id, "RF-001");
  assert.ok(fs.existsSync(synthesisPath));
  const standalone = JSON.parse(fs.readFileSync(synthesisPath, "utf-8"));
  assert.deepEqual(standalone, synthesis);

  // Contrato de la síntesis: deepseek-v4-flash (ventana 1M) + variant "max"
  // (thinking máximo SOLO en la síntesis final, por decisión del dueño).
  const req = calls.prompt[0];
  assert.equal(req.model.providerID, SYNTHESIS_MODEL.providerID);
  assert.equal(req.model.modelID, SYNTHESIS_MODEL.modelID);
  assert.equal(req.variant, "max");
  assert.equal(req.format.type, "json_schema");
});

test("overflow de contexto: reintento único en sesión nueva (regla del dueño)", async () => {
  const { client, calls } = makeMockClient([apiErrorPrompt("ContextOverflowError"), okPrompt(SYNTHESIS_JSON)]);
  setTestClient(client);
  const { ledgerPath } = await startInterview(projectPath);

  const { synthesis } = await synthesizeInterview(ledgerPath, "Cooperativa Verde");

  assert.equal(synthesis.requerimientos_funcionales.length, 2);
  // startInterview crea la sesión inicial + la recreada por overflow.
  assert.equal(calls.create.length, 2);
  assert.equal(calls.prompt.length, 2, "un solo reintento, no los 3× de transporte");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8")) as InterviewLedger;
  assert.equal(ledger.session_id, "ses_mock_2", "el ledger queda apuntando a la sesión recreada");
});

test("overflow de contexto repetido: falla determinista (no reintenta dos veces)", async () => {
  const { client, calls } = makeMockClient([apiErrorPrompt("ContextOverflowError"), apiErrorPrompt("ContextOverflowError"), okPrompt(SYNTHESIS_JSON)]);
  setTestClient(client);
  const { ledgerPath } = await startInterview(projectPath);

  await assert.rejects(() => synthesizeInterview(ledgerPath, "Cooperativa Verde"), /ContextOverflowError/);
  assert.equal(calls.create.length, 2, "una sola recreación, luego falla");
  assert.equal(calls.prompt.length, 2, "no se gasta una tercera llamada en algo determinista");
});

test("resume: sin pendientes → done sin llamadas; con pendiente → misma pregunta sin regenerar", async () => {
  const { client } = makeMockClient();
  setTestClient(client);
  const { ledgerPath, ledger } = await startInterview(projectPath);
  const antes = modelCallCount();

  // Sin pendientes (sin respuestas, pero con un tópico ya cerrado).
  ledger.topics = ["problema"];
  recordAnswer(ledgerPath, ledger, {
    topic: "problema",
    question_text: "¿Única?",
    free_text: "Suficiente.",
    selected_option_id: null,
    selected_option_label: null,
  });
  ledger.answers[0].sufficient = true;
  ledger.answers[0].response_kind = "informative";
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  const done = await resumeInterview(ledgerPath, "");
  assert.deepEqual(done, { done: true, reason: "all_topics_closed", usage: { input_tokens: 0, output_tokens: 0 } });
  assert.equal(modelCallCount() - antes, 0);

  // Con pregunta pendiente guardada en un tópico PENDING: se devuelve tal
  // cual, sin regenerar (0 llamadas).
  const ledgerPendiente: InterviewLedger = {
    ...ledger,
    topics: ["problema"],
    answers: [],
    pending_question: { topic: "problema", question: QUESTION_VALIDA },
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(ledgerPendiente, null, 2));
  const retomado = await resumeInterview(ledgerPath, "");
  assert.equal(retomado.done, false);
  assert.equal(retomado.question.question_text, QUESTION_VALIDA.question_text);
  assert.equal(modelCallCount() - antes, 0);
});

test("listInterviews y deleteInterview: puras, sin modelo", async () => {
  const { client } = makeMockClient();
  setTestClient(client);
  await startInterview(projectPath);
  const segunda = await startInterview(projectPath);
  const antes = modelCallCount();

  const summaries = listInterviews(projectPath);
  assert.equal(summaries.length, 2);
  assert.ok(summaries[0].created_at >= summaries[1].created_at, "ordenadas de más reciente a más antigua");
  assert.ok(summaries[0].ledgerPath.includes(path.join("requerimientos", "entrevista-")), "viven en la subcarpeta requerimientos/");

  deleteInterview(segunda.ledgerPath);
  assert.equal(listInterviews(projectPath).length, 1);
  assert.equal(modelCallCount() - antes, 0);
});

test("migración del layout legacy: archivos movidos a subcarpetas + marcador reescrito", async () => {
  // Crea archivos con el layout VIEJO a mano en la raíz de .agents/interview/.
  const root = path.join(projectPath, ".agents", "interview");
  fs.mkdirSync(root, { recursive: true });
  const ts = 1700000000000;
  fs.writeFileSync(
    path.join(root, `interview-${ts}.json`),
    JSON.stringify({
      session_id: "ses_legacy",
      project_path: projectPath,
      topics: ["problema"],
      answers: [],
      contradictions: [],
      reopens: [],
      gap_check: null,
      asr_reviews: [],
      synthesis: null,
      pending_question: null,
    }),
  );
  fs.writeFileSync(path.join(root, `interview-${ts}-synthesis.json`), JSON.stringify({ hola: 1 }));
  fs.writeFileSync(
    path.join(root, `brief-${ts}.json`),
    JSON.stringify({ session_id: "ses_brief", project_path: projectPath, bloques: [], answers: [] }),
  );
  fs.writeFileSync(
    path.join(root, `brief-${ts}-brief.json`),
    JSON.stringify({
      resumen_proyecto: "Contexto legacy",
      propuesta_de_valor: "pv",
      incertidumbres_criticas: [],
      alertas_consistencia: [],
      respuestas_detalladas: [],
      brief_contexto: "ctx",
    }),
  );
  fs.writeFileSync(
    path.join(root, "active-brief.json"),
    JSON.stringify({ path: path.join(root, `brief-${ts}-brief.json`), at: new Date().toISOString() }),
  );

  const { client } = makeMockClient();
  setTestClient(client);

  // El primer acceso lista Y migra.
  const summaries = listInterviews(projectPath);
  assert.equal(summaries.length, 1);
  assert.ok(summaries[0].ledgerPath.includes(path.join("requerimientos", `entrevista-${ts}.json`)));

  const docs = listBriefDocuments(projectPath);
  assert.equal(docs.length, 1);
  assert.ok(docs[0].path.includes(path.join("contexto", `contexto-${ts}-documento.json`)));

  // El borrador migrado tiene documento → no aparece como "en progreso".
  const inProgress = listBriefInterviews(projectPath);
  assert.equal(inProgress.length, 0);

  // El marcador activo se reescribió a la ruta nueva.
  const activo = getActiveBrief(projectPath);
  assert.equal(
    activo?.path,
    path.join(projectPath, ".agents", "interview", "contexto", `contexto-${ts}-documento.json`),
  );

  // La raíz quedó limpia (solo las subcarpetas).
  const restantes = fs.readdirSync(root).filter((f) => f !== "requerimientos" && f !== "contexto");
  assert.deepEqual(restantes, []);
});

// ─── Motor del brief (Fase 0) ────────────────────────────────────────────

test("brief: arranque + recorrer todas las preguntas + posición nula al completar", async () => {
  const { client, calls } = makeMockClient();
  setTestClient(client);
  const { ledgerPath } = await startBriefInterview(projectPath);

  assert.equal(calls.create[0].title, "Fase 0 — Encuadre del proyecto");

  let pos = briefInterviewState(ledgerPath);
  assert.ok(pos, "la primera pregunta debe existir");
  assert.equal(pos.preguntaNumero, 1);
  assert.equal(pos.respondidas, 0);

  let pasos = 0;
  while (pos) {
    recordBriefAnswer(ledgerPath, loadBriefLedger(ledgerPath), {
      bloque: pos.bloque.id,
      pregunta: pos.pregunta,
      respuesta: `Respuesta del dueño ${pos.preguntaNumero}`,
    });
    pasos += 1;
    pos = briefInterviewState(ledgerPath);
  }
  assert.ok(pasos >= 8, "el template tiene al menos 8 preguntas");
  assert.equal(briefInterviewState(ledgerPath), null, "todas respondidas → listo para sintetizar");
});

test("brief: síntesis con documento mockeado, transcripción 1-a-1 por código", async () => {
  const { client, calls } = makeMockClient([okPrompt(BRIEF_DOC)]);
  setTestClient(client);
  const { ledgerPath } = await startBriefInterview(projectPath);

  // Responde 2 preguntas para verificar la transcripción.
  const pos1 = briefInterviewState(ledgerPath)!;
  recordBriefAnswer(ledgerPath, loadBriefLedger(ledgerPath), {
    bloque: pos1.bloque.id,
    pregunta: pos1.pregunta,
    respuesta: "Cooperativa hortícola del sur.",
  });
  const pos2 = briefInterviewState(ledgerPath)!;
  recordBriefAnswer(ledgerPath, loadBriefLedger(ledgerPath), {
    bloque: pos2.bloque.id,
    pregunta: pos2.pregunta,
    respuesta: "Registrar lotes con QR en el celular.",
  });

  const { brief, briefPath } = await synthesizeBrief(ledgerPath);

  assert.equal(brief.resumen_proyecto, BRIEF_DOC.resumen_proyecto);
  assert.equal(brief.respuestas_detalladas.length, 2);
  assert.equal(brief.respuestas_detalladas[0].respuesta, "Cooperativa hortícola del sur.");
  assert.equal(calls.prompt[0].format.type, "json_schema");
  // El documento sintetizado se escribe con el nombre brief-<ts>-brief.json.
  assert.ok(fs.existsSync(briefPath));
  assert.equal(briefPath, briefDocumentPath(ledgerPath));
});
