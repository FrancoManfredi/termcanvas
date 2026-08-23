// Tests del feature Tácticas de Arquitectura por ASR → ADR con el CLIENTE
// DE MODELO MOCKEADO (mismo seam setTestClient que interview-engine-mock).
// NADA corre contra un modelo real. Cubre:
//   - analyzeTacticForAsr: sesión efímera propia + asr_id fijado por el
//     motor + sanitización de es_unica_viable (length===1 ⇔ true) +
//     reintentos del predicate (una sola recomendada, conexión de negocio en
//     el 100%, sacrificio declarado).
//   - consolidateTactics: skip con <2 recomendadas; conflicto con visión
//     completa.
//   - validateFreeTextDecision: choque con restricción + Y-statement.
//   - buildYStatementFromCandidate determinístico.
//   - renderAdrMarkdown: template completo (limitación aceptada, riesgo
//     aceptado conscientemente, candidatas descartadas, texto libre).
//   - confirmTacticDecision: escritura segura de ADR + manifiesto,
//     supersede que toca SOLO la línea Estado, defensa en profundidad del
//     texto libre sin validación previa.
//   - formatDecisionsForPrompt: inyección downstream desde el manifiesto.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { setTestClient, structuredRetryCount } from "../headless-runtime/interview/engine.ts";
import {
  analyzeTacticForAsr,
  consolidateTactics,
  validateFreeTextDecision,
  buildYStatementFromCandidate,
  renderAdrMarkdown,
  confirmTacticDecision,
  tacticsStatusForSynthesis,
  formatDecisionsForPrompt,
  readAdrManifest,
} from "../headless-runtime/interview/tactics.ts";
import type { SynthesisResult, AsrItem } from "../headless-runtime/interview/schema.ts";
import type { TacticaCandidata, ConflictoTacticas } from "../headless-runtime/interview/tactics.ts";
import { setCatalogClient } from "../electron/model-catalog.ts";

// El gate de modelos consulta el catálogo en cada llamada de la fase
// "tactics": mockeado UNA vez acá para que ningún test intente levantar un
// server real (fixture sano: opencode-go conectado con hy3).
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
              "deepseek-v4-flash": { status: "active", limit: { context: 1000000 }, variants: { max: {} } },
            },
          },
        ],
        default: { "opencode-go": "hy3" },
        connected: ["opencode-go"],
      },
    }),
  },
});

interface PromptCall {
  sessionID: string;
  parts: { type: string; text: string }[];
}

function makeMockClient(prompts: ((req: PromptCall) => unknown)[] = []) {
  const calls = {
    create: [] as { title: string; directory: string }[],
    prompt: [] as PromptCall[],
    deleted: [] as string[],
  };
  let promptIndex = 0;
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
      delete: async (input: { sessionID: string }) => {
        calls.deleted.push(input.sessionID);
        return { data: true, error: null };
      },
    },
  } as unknown as OpencodeClient;
  return { client, calls };
}

function okPrompt(structured: unknown) {
  return {
    error: null,
    data: {
      info: {
        id: "msg_mock",
        sessionID: "s",
        role: "assistant",
        time: { created: 0 },
        modelID: "hy3",
        providerID: "opencode-go",
        mode: "build",
        agent: "build",
        path: { cwd: "", root: "" },
        cost: 0,
        tokens: { total: 111, input: 90, output: 21, reasoning: 0, cache: { read: 0, write: 0 } },
        structured,
      },
      parts: [],
    },
  };
}

function makeSynthesis(): SynthesisResult {
  const asr = (id: string, atributo: string): AsrItem => ({
    id,
    atributo,
    es_asr_genuino: true,
    justificacion_arquitectonica: `Obliga decisión estructural (${atributo}).`,
    escenario_tecnico_6_partes: {
      fuente: "Usuario",
      estimulo: "Carga pico",
      artefacto: "API",
      entorno: "Producción",
      respuesta: "Responde",
      medida_de_respuesta: "< 200ms",
    },
    trade_offs_identificados: "Costo vs beneficio.",
    origen: "a1",
  });
  return {
    proyecto_metadata: {
      nombre_proyecto: "Demo",
      id_sesion: "ses_1",
      fecha_relevamiento: "2026-08-23T00:00:00.000Z",
      brief_contexto: "MVP bootstrapped para validar propuesta de valor.",
    },
    historias_de_usuario: [],
    historias_backfilled: false,
    requerimientos_funcionales: [],
    atributos_de_calidad_y_asrs: [
      asr("ASR-001", "Rendimiento"),
      asr("ASR-002", "Seguridad"),
      { ...asr("ASR-003", "Usabilidad"), es_asr_genuino: false },
    ],
    restricciones_globales: [
      {
        id: "CON-001",
        tipo: "Stack Tecnologico",
        descripcion: "Monolito Node.js simple",
        impacto: "Sin microservicios",
      },
      {
        id: "CON-002",
        tipo: "Presupuesto",
        descripcion: "Bootstrapped, casi nulo",
        impacto: "Sin licencias pagas ni infra distribuida",
      },
    ],
    glosario_de_terminos: {},
    rfs_eliminados: [],
    asrs_eliminados: [],
    restricciones_eliminadas: [],
    terminos_eliminados: [],
  };
}

const CANDIDATA_CACHE: Record<string, unknown> = {
  nombre_tactica: "Cache",
  proposito: "Mantener datos en almacenamiento múltiple",
  argumentacion: "Las lecturas repetidas del catálogo sobre el monolito Node.js se sirven de memoria.",
  trade_offs_para_este_proyecto: "Memoria extra del proceso único, sin costo de infra.",
  conexion_con_objetivo_de_negocio: "Permite demostrar el MVP rápido ante inversores sin servidores caros.",
  cumple_totalmente_la_restriccion: true,
  que_se_sacrifica: null,
  es_recomendada: false,
  es_unica_viable: false,
};

function candidata(overrides: Partial<TacticaCandidata> = {}): Record<string, unknown> {
  return { ...CANDIDATA_CACHE, ...overrides };
}

function analysisPayload(candidatas: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    asr_id: "ECO-DEL-MODELO",
    categoria_atributo: "rendimiento",
    candidatas,
    justificacion_de_la_recomendada: "Es la mejor dada el presupuesto nulo y el stack monolito.",
    y_statement: "Y del modelo.",
    ...overrides,
  };
}

let tmp: string;
let synthesisPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tactics-test-"));
  synthesisPath = path.join(tmp, "entrevista-123-sintesis.json");
  fs.writeFileSync(synthesisPath, JSON.stringify(makeSynthesis()));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── Análisis por ASR ─────────────────────────────────────────────────────

test("analyzeTacticForAsr: una sesión efímera propia, liberada al terminar; asr_id lo fija el motor", async () => {
  const { client, calls } = makeMockClient([
    () =>
      okPrompt(
        analysisPayload([
          candidata({ es_recomendada: true }),
        ]),
      ),
  ]);
  setTestClient(client);
  const res = await analyzeTacticForAsr(tmp, makeSynthesis(), makeSynthesis().atributos_de_calidad_y_asrs[0]);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.asr_id, "ASR-001", "el eco del modelo no manda: el motor fija el id");
  assert.equal(calls.create.length, 1, "UNA sesión efímera por llamada");
  assert.equal(calls.deleted.length, 1, "la sesión se libera en finally");
  assert.equal(calls.deleted[0], calls.create[0] ? "ses_mock_1" : "");
});

test("analyzeTacticForAsr: única candidata sin es_unica_viable se SANITIZA a true (badge garantizado)", async () => {
  const { client } = makeMockClient([() => okPrompt(analysisPayload([candidata({ es_recomendada: true })]))]);
  setTestClient(client);
  const res = await analyzeTacticForAsr(tmp, makeSynthesis(), makeSynthesis().atributos_de_calidad_y_asrs[0]);
  assert.ok(res.ok && res.data.candidatas[0].es_unica_viable === true);
});

test("analyzeTacticForAsr: varias candidatas NUNCA llevan es_unica_viable (se limpia el flag mentiroso)", async () => {
  const payload = analysisPayload([
    candidata({ es_recomendada: true, es_unica_viable: true }),
    candidata({ nombre_tactica: "Cola de mensajes" }),
  ]);
  const { client } = makeMockClient([() => okPrompt(payload)]);
  setTestClient(client);
  const res = await analyzeTacticForAsr(tmp, makeSynthesis(), makeSynthesis().atributos_de_calidad_y_asrs[0]);
  assert.ok(res.ok && res.data.candidatas.every((c) => c.es_unica_viable === false));
});

test("analyzeTacticForAsr: reintenta cuando hay DOS recomendadas y acepta al intento válido", async () => {
  const malo = analysisPayload([
    candidata({ es_recomendada: true }),
    candidata({ nombre_tactica: "Otra", es_recomendada: true }),
  ]);
  const bueno = analysisPayload([candidata({ es_recomendada: true }), candidata({ nombre_tactica: "Otra" })]);
  const { client } = makeMockClient([() => okPrompt(malo), () => okPrompt(bueno)]);
  setTestClient(client);
  const antes = structuredRetryCount();
  const res = await analyzeTacticForAsr(tmp, makeSynthesis(), makeSynthesis().atributos_de_calidad_y_asrs[0]);
  assert.ok(res.ok, "el segundo intento debe validar");
  assert.ok(structuredRetryCount() > antes, "el fallo de contrato consumió un reintento auditado");
});

test("analyzeTacticForAsr: falla si alguna candidata no tiene conexión de negocio (100% obligatoria)", async () => {
  const payload = analysisPayload([
    candidata({ es_recomendada: true }),
    candidata({ nombre_tactica: "Sin conexión", conexion_con_objetivo_de_negocio: "   " }),
  ]);
  const { client } = makeMockClient([() => okPrompt(payload)]);
  setTestClient(client);
  const res = await analyzeTacticForAsr(tmp, makeSynthesis(), makeSynthesis().atributos_de_calidad_y_asrs[0]);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /fuera de contrato/);
});

test("analyzeTacticForAsr: exige sacrificio declarado cuando cumple_totalmente=false", async () => {
  const payload = analysisPayload([
    candidata({ es_recomendada: true, cumple_totalmente_la_restriccion: false, que_se_sacrifica: null }),
  ]);
  const { client } = makeMockClient([() => okPrompt(payload)]);
  setTestClient(client);
  const res = await analyzeTacticForAsr(tmp, makeSynthesis(), makeSynthesis().atributos_de_calidad_y_asrs[0]);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /fuera de contrato/);
});

// ─── Consolidación ────────────────────────────────────────────────────────

test("consolidateTactics: con menos de dos recomendadas NO gasta llamada", async () => {
  const { client, calls } = makeMockClient([]);
  setTestClient(client);
  const rec = candidata({ es_recomendada: true }) as unknown as TacticaCandidata;
  const res = await consolidateTactics(tmp, [{ asrId: "ASR-001", atributo: "Rendimiento", candidata: rec }]);
  assert.ok(res.ok && res.skipped);
  assert.equal(calls.create.length, 0);
});

test("consolidateTactics: una llamada con visión completa detecta el conflicto cache vs cifrado", async () => {
  const conflictos = [
    {
      asr_a: "ASR-001",
      tactica_a: "Cache",
      asr_b: "ASR-002",
      tactica_b: "Cifrado en tránsito",
      explicacion: "El cifrado constante degrada la ganancia de latencia del cache.",
    },
  ];
  const { client, calls } = makeMockClient([() => okPrompt({ conflictos })]);
  setTestClient(client);
  const rec = candidata({ es_recomendada: true }) as unknown as TacticaCandidata;
  const res = await consolidateTactics(tmp, [
    { asrId: "ASR-001", atributo: "Rendimiento", candidata: rec },
    { asrId: "ASR-002", atributo: "Seguridad", candidata: rec },
  ]);
  assert.ok(res.ok && !res.skipped);
  if (res.ok && !res.skipped) assert.equal(res.data.conflictos.length, 1);
  assert.equal(calls.create.length, 1, "la consolidación es UNA llamada aparte");
});

// ─── Validación de texto libre ────────────────────────────────────────────

test("validateFreeTextDecision: marca el choque con la restricción y genera el Y-statement", async () => {
  const { client } = makeMockClient([
    () =>
      okPrompt({
        aparta_de_restriccion: true,
        advertencia: "Proponer microservicios choca con CON-001 (monolito obligatorio).",
        y_statement: "En el contexto de escalabilidad, decidimos microservicios, aceptando el choque.",
      }),
  ]);
  setTestClient(client);
  const syn = makeSynthesis();
  const res = await validateFreeTextDecision(tmp, syn, syn.atributos_de_calidad_y_asrs[0], "Uso microservicios");
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.data.aparta_de_restriccion, true);
  assert.match(res.data.advertencia ?? "", /CON-001/);
  assert.match(res.data.y_statement, /^En el contexto de/);
});

// ─── Y-statement determinístico ───────────────────────────────────────────

test("buildYStatementFromCandidate: una línea desde los campos de la candidata, sin llamada", () => {
  const syn = makeSynthesis();
  const c = candidata() as unknown as TacticaCandidata;
  const y = buildYStatementFromCandidate(syn.atributos_de_calidad_y_asrs[0], c);
  assert.match(y, /^En el contexto de Rendimiento \(ASR-001\), decidimos optar por Cache para lograr/);
  assert.match(y, /aceptando Memoria extra del proceso único, sin costo de infra\.$/);
  assert.equal(y.split("\n").length, 1, "formato UNA línea");
});

// ─── Render del ADR ───────────────────────────────────────────────────────

function adrInput(overrides: Partial<Parameters<typeof renderAdrMarkdown>[0]> = {}) {
  const syn = makeSynthesis();
  return {
    numero: 1,
    asr: syn.atributos_de_calidad_y_asrs[0],
    categoria: "rendimiento",
    sintesisFileName: "entrevista-123-sintesis.json",
    fecha: "2026-08-23",
    yStatement: "En el contexto de X decidimos Y aceptando Z.",
    tacticaNombre: "Cache",
    conexionNegocio: "MVP rápido sin servidores caros.",
    decisionTexto: "Argumentación de la candidata elegida.",
    decisionEsTextoLibre: false,
    justificacionRecomendada: "Justificación del análisis.",
    elegidaEsLaRecomendada: true,
    tradeOffsElegida: "Memoria extra del proceso único.",
    candidatasDescartadas: [candidata({ nombre_tactica: "CDN" }) as unknown as TacticaCandidata],
    conflictosInvolucrados: [] as ConflictoTacticas[],
    conflictosAceptados: false,
    limitacionAceptada: null,
    ...overrides,
  };
}

test("renderAdrMarkdown: template completo con candidatas descartadas y conexión de negocio", () => {
  const md = renderAdrMarkdown(adrInput());
  assert.match(md, /^# ADR-001: Cache$/m);
  assert.match(md, /\*\*Estado\*\*: Aceptado/);
  assert.match(md, /> En el contexto de X decidimos Y aceptando Z\./);
  assert.match(md, /## Por qué importa para el proyecto/);
  assert.match(md, /MVP rápido sin servidores caros\./);
  assert.match(md, /## Candidatas consideradas/);
  assert.match(md, /CDN/, "las descartadas quedan registradas con su argumentación");
  assert.match(md, /Conexión con objetivo de negocio: Permite demostrar el MVP/, "cada descartada lleva su conexión");
  assert.match(md, /## Consecuencias \/ Trade-offs/);
  assert.match(md, /Ninguno detectado/);
});

test("renderAdrMarkdown: limitación aceptada explícita cuando no cumple totalmente la restricción", () => {
  const md = renderAdrMarkdown(
    adrInput({ limitacionAceptada: "Queda sin cubrir el pico de 10k req/s." }),
  );
  assert.match(md, /### Limitación aceptada/);
  assert.match(md, /Queda sin cubrir el pico de 10k req\/s\./);
  assert.match(md, /No se propone cambiar ninguna restricción obligatoria/);
});

test("renderAdrMarkdown: riesgo aceptado consciente queda EN Consecuencias, no solo en el header", () => {
  const conflicto: ConflictoTacticas = {
    asr_a: "ASR-001",
    tactica_a: "Cache",
    asr_b: "ASR-002",
    tactica_b: "Cifrado en tránsito",
    explicacion: "El cifrado constante degrada la ganancia de latencia.",
  };
  const md = renderAdrMarkdown(
    adrInput({
      conflictosInvolucrados: [conflicto],
      conflictosAceptados: true,
    }),
  );
  const consecuenciasIdx = md.indexOf("## Consecuencias");
  assert.ok(conducenciasDespues(md, consecuenciasIdx), "el riesgo va dentro de Consecuencias");
  function conducenciasDespues(texto: string, desde: number): boolean {
    return texto.indexOf("**Riesgo aceptado conscientemente**") > desde;
  }
  assert.match(md, /Conflictos detectados con otras tácticas.*?Cifrado en tránsito/s);
});

test("renderAdrMarkdown: decisión propia marcada como del arquitecto, no generada por IA", () => {
  const md = renderAdrMarkdown(
    adrInput({
      decisionTexto: "Mi decisión propia basada en el contexto del negocio.",
      decisionEsTextoLibre: true,
      tacticaNombre: "Decisión del arquitecto",
    }),
  );
  assert.match(md, /\(decision del arquitecto, no generada por IA\)/);
  assert.doesNotMatch(md, /Justificación de la recomendación/);
});

// ─── Confirmación: ADR + manifiesto + supersede ──────────────────────────

async function confirmPrimera(): Promise<void> {
  const { client } = makeMockClient([
    () =>
      okPrompt(
        analysisPayload([
          candidata({ es_recomendada: true }),
          candidata({ nombre_tactica: "CDN" }),
        ]),
      ),
  ]);
  setTestClient(client);
  const syn = makeSynthesis();
  const analizado = await analyzeTacticForAsr(tmp, syn, syn.atributos_de_calidad_y_asrs[0]);
  assert.ok(analizado.ok);
  const res = await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-001",
    tipo: "candidata",
    analysis: (analizado as { ok: true; data: never }).data,
    candidataIndex: 0,
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  assert.ok(res.ok);
}

test("confirmTacticDecision: escribe ADR markdown + manifiesto con y_statement (sin parsear MD)", async () => {
  await confirmPrimera();
  const manifest = readAdrManifest(tmp);
  const entry = manifest["ASR-001"];
  assert.ok(entry, "manifiesto actualizado");
  assert.equal(entry.adr_activo, "ADR-001");
  assert.match(entry.y_statement, /^En el contexto de Rendimiento \(ASR-001\)/);
  assert.ok(fs.existsSync(entry.path));
  const md = fs.readFileSync(entry.path, "utf-8");
  assert.match(md, /Síntesis de origen\*\*: entrevista-123-sintesis\.json/);
});

test("confirmTacticDecision: supersede crea ADR nuevo, marca SOLO Estado del viejo y encadena reemplazados", async () => {
  await confirmPrimera();
  const manifestViejo = readAdrManifest(tmp);
  const pathViejo = manifestViejo["ASR-001"].path;
  const contenidoViejo = fs.readFileSync(pathViejo, "utf-8");

  // Re-análisis con decisión distinta → ADR nuevo.
  const { client } = makeMockClient([
    () =>
      okPrompt(
        analysisPayload(
          [candidata({ es_recomendada: true, nombre_tactica: "CDN" })],
          { categoria_atributo: "rendimiento" },
        ),
      ),
  ]);
  setTestClient(client);
  const syn = makeSynthesis();
  const analizado = await analyzeTacticForAsr(tmp, syn, syn.atributos_de_calidad_y_asrs[0]);
  assert.ok(analizado.ok);
  const res = await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-001",
    tipo: "candidata",
    analysis: (analizado as { ok: true; data: never }).data,
    candidataIndex: 0,
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  assert.ok(res.ok && res.adrNumero === "ADR-002");
  assert.equal(res.supersededAdr, "ADR-001");

  // El viejo NO se edita salvo su línea Estado.
  const contenidoNuevoViejo = fs.readFileSync(pathViejo, "utf-8");
  const viejoSinEstado = contenidoViejo.replace(/^\*\*Estado\*\*:.*$/m, "");
  const nuevoViejoSinEstado = contenidoNuevoViejo.replace(/^\*\*Estado\*\*:.*$/m, "");
  assert.equal(viejoSinEstado, nuevoViejoSinEstado, "resto del archivo intacto");
  assert.match(contenidoNuevoViejo, /^\*\*Estado\*\*: Superseded by ADR-002$/m);

  // El manifiesto apunta al nuevo y acumula la cadena de reemplazados.
  const manifest = readAdrManifest(tmp);
  assert.equal(manifest["ASR-001"].adr_activo, "ADR-002");
  assert.deepEqual(manifest["ASR-001"].reemplazados, ["ADR-001"]);
});

test("confirmTacticDecision texto libre SIN validación previa exige confirmación antes de escribir", async () => {
  // Defensa en profundidad: sin yStatementLibre el canal valida internamente;
  // el mock devuelve choque con restricción → needs_confirmation, sin ADR.
  const advertencia =
    "Tu decisión parece apartarse de CON-001 (monolito Node.js simple) — confirmá que es intencional.";
  const { client } = makeMockClient([
    () =>
      okPrompt({
        aparta_de_restriccion: true,
        advertencia,
        y_statement: "En el contexto de ASR-001, decidimos microservicios, aceptando el choque con CON-001.",
      }),
  ]);
  setTestClient(client);
  const primera = await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-001",
    tipo: "libre",
    analysis: analysisPayload([candidata({ es_recomendada: true })]) as never,
    textoLibre: "Uso microservicios igual",
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  assert.ok(!primera.ok && primera.reason === "needs_confirmation");
  assert.match((primera as { error: string }).error, /CON-001/);
  assert.equal(readAdrManifest(tmp)["ASR-001"], undefined, "sin confirmación NO se escribe nada");

  // El usuario confirma que es intencional → ahora sí se escribe, con el
  // riesgo documentado como decisión del arquitecto.
  const segunda = await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-001",
    tipo: "libre",
    analysis: analysisPayload([candidata({ es_recomendada: true })]) as never,
    textoLibre: "Uso microservicios igual",
    yStatementLibre: "En el contexto de ASR-001, decidimos microservicios, aceptando el choque con CON-001.",
    advertenciaConfirmada: true,
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  assert.ok(segunda.ok);
  const md = fs.readFileSync((segunda as { adrPath: string }).adrPath, "utf-8");
  assert.match(md, /\(decision del arquitecto, no generada por IA\)/);
});

// ─── Inyección downstream ────────────────────────────────────────────────

test("formatDecisionsForPrompt: vacío sin manifiesto; con ADRs incluye y_statement e instrucciones", async () => {
  assert.equal(formatDecisionsForPrompt(tmp), "");

  await confirmPrimera();
  const bloque = formatDecisionsForPrompt(tmp);
  assert.match(bloque, /\*\*ADR-001\*\* \(ASR-001\): En el contexto de Rendimiento \(ASR-001\)/);
  assert.match(bloque, /LEÉ el archivo completo del ADR antes de continuar/);
  assert.match(bloque, /NO propongas una táctica alternativa sin justificar/);
  assert.match(bloque, /posibilidad a verificar/, "advertencia de código heredado enmarcada");
  assert.doesNotMatch(bloque, /ADRs reemplazados/, "sin supersede no hay línea de reemplazados");
});

test("formatDecisionsForPrompt: tras un supersede lista los ADRs reemplazados (criterio 11)", async () => {
  await confirmPrimera();
  const { client } = makeMockClient([
    () => okPrompt(analysisPayload([candidata({ es_recomendada: true, nombre_tactica: "CDN" })])),
  ]);
  setTestClient(client);
  const syn = makeSynthesis();
  const analizado = await analyzeTacticForAsr(tmp, syn, syn.atributos_de_calidad_y_asrs[0]);
  assert.ok(analizado.ok);
  await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-001",
    tipo: "candidata",
    analysis: (analizado as { ok: true; data: never }).data,
    candidataIndex: 0,
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  const bloque = formatDecisionsForPrompt(tmp);
  assert.match(bloque, /\*\*ADR-002\*\*/);
  assert.match(bloque, /ADRs reemplazados \(ya NO vigentes\): ADR-001/);
});

test("tacticsStatusForSynthesis: mapea los ASRs con su ADR activo y el flag genuino", async () => {
  await confirmPrimera();
  const status = tacticsStatusForSynthesis(tmp, synthesisPath);
  const asr1 = status.asrs.find((a) => a.asrId === "ASR-001");
  const asr2 = status.asrs.find((a) => a.asrId === "ASR-002");
  const asr3 = status.asrs.find((a) => a.asrId === "ASR-003");
  assert.ok(asr1?.es_asr_genuino && asr1.adrActivo?.adr === "ADR-001");
  assert.ok(asr2?.es_asr_genuino && asr2.adrActivo === null, "sin decisión todavía");
  assert.equal(asr3?.es_asr_genuino, false, "la preferencia UX aparece pero no dispara análisis");
});
