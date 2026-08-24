// Tests del feature Tácticas de Arquitectura por ASR → ADR con el CLIENTE
// DE MODELO MOCKEADO (mismo seam setTestClient que interview-engine-mock).
// NADA corre contra un modelo real. Cubre:
//   - analyzeTacticForAsr: sesión efímera propia + asr_id/categoria fijados
//     por el motor + sanitización de es_unica_viable (length===1 <=> true)
//     + reintentos del predicate (una sola recomendada, conexión de negocio
//     en el 100%, sacrificio declarado).
//   - CATÁLOGO: carga del archivo de la categoría, inyección inline en el
//     prompt, guardrail que rechaza nombres fuera del catálogo, mapeo
//     atributo → categoría con fallback manual (categoria_no_mapeada).
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

import { test, beforeEach, afterEach, mock } from "node:test";
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
  ejecutarAnalisisTacticas,
  leerEstadoAnalisis,
  analisisTacticasPath,
} from "../headless-runtime/interview/tactics.ts";
import { setCatalogoTacticasBaseDir } from "../headless-runtime/interview/tactic-catalog.ts";
import {
  mapearAtributoACategoria,
  type CategoriaTactica,
} from "../shared/tacticCategorias.ts";
import {
  setTacticaWatchdogMs,
  TACTICA_WATCHDOG_MS_DEFAULT,
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

function makeMockClient(
  prompts: ((req: PromptCall) => unknown)[] = [],
  opts?: { createError?: string },
) {
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
        if (opts?.createError) throw new Error(opts.createError);
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

const TACTICA_PRINCIPAL = "Mantener múltiples copias de los datos";
const TACTICA_SECUNDARIA = "Gestionar los pedidos de trabajo";
const TACTICA_TERCIARIA = "Limitar el tamaño de las colas";
const TACTICA_CUARTA = "Aumentar los recursos";

// Fixture del catálogo (mismo formato que resources/architecture-tactics/
// <categoria>.md: headings #### = tácticas reales del archivo).
const CATALOGO_RENDIMIENTO = `### 2.5.2 Tácticas para el rendimiento

#### ${TACTICA_SECUNDARIA}

Texto de la táctica.

#### ${TACTICA_PRINCIPAL}

Texto de la táctica.

#### ${TACTICA_CUARTA}

Texto de la táctica.

#### ${TACTICA_TERCIARIA}

Texto de la táctica.
`;

const CATALOGO_SEGURIDAD = `### 2.5.4 Tácticas para la seguridad

#### Cifrar los datos

Texto de la táctica.

#### Autenticar actores

Texto de la táctica.
`;

let tmp: string;
let synthesisPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tactics-test-"));
  synthesisPath = path.join(tmp, "entrevista-123-sintesis.json");
  fs.writeFileSync(synthesisPath, JSON.stringify(makeSynthesis()));
  // Catálogo fixture por test (setCatalogoTacticasBaseDir es estado global).
  const catalogos = path.join(tmp, "catalogos");
  fs.mkdirSync(catalogos, { recursive: true });
  fs.writeFileSync(path.join(catalogos, "rendimiento.md"), CATALOGO_RENDIMIENTO);
  fs.writeFileSync(path.join(catalogos, "seguridad.md"), CATALOGO_SEGURIDAD);
  setCatalogoTacticasBaseDir(catalogos);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CANDIDATA_BASE: Record<string, unknown> = {
  nombre_tactica: TACTICA_PRINCIPAL,
  proposito: "Gestionar los recursos",
  argumentacion: "Las lecturas repetidas del catálogo sobre el monolito Node.js se sirven de memoria.",
  trade_offs_para_este_proyecto: "Memoria extra del proceso único, sin costo de infra.",
  conexion_con_objetivo_de_negocio: "Permite demostrar el MVP rápido ante inversores sin servidores caros.",
  cumple_totalmente_la_restriccion: true,
  que_se_sacrifica: null,
  es_recomendada: false,
  es_unica_viable: false,
};

function candidata(overrides: Partial<TacticaCandidata> = {}): Record<string, unknown> {
  return { ...CANDIDATA_BASE, ...overrides };
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

async function analizarPrimero(opts?: {
  categoriaExplicita?: import("../shared/tacticCategorias").CategoriaTactica;
}) {
  const syn = makeSynthesis();
  return analyzeTacticForAsr(tmp, syn, syn.atributos_de_calidad_y_asrs[0], opts);
}

// ─── Mapeo atributo → categoría ──────────────────────────────────────────

test("mapearAtributoACategoria: nombres directos y keywords primarias son confiad@s", () => {
  for (const [texto, esperada] of [
    ["Rendimiento", "rendimiento"],
    ["Disponibilidad", "disponibilidad"],
    ["Seguridad de la información", "seguridad"],
    ["Protección ante fallas catastróficas", "proteccion"],
    ["Modificabilidad", "modificabilidad"],
    ["Facilidad de despliegue", "despliegue"],
    ["Eficiencia energética", "eficiencia_energetica"],
    ["performance bajo carga", "rendimiento"],
  ] as const) {
    const r = mapearAtributoACategoria(texto);
    assert.equal(r.categoria, esperada, `"${texto}" debe mapear a ${esperada}`);
    assert.equal(r.confiado, true, `"${texto}" debe ser confiado`);
  }
});

test("mapearAtributoACategoria: protección y seguridad NO se confunden (safety vs security)", () => {
  // Keyword específica de protección gana aunque el texto mencione seguridad.
  const r = mapearAtributoACategoria("Protección y seguridad física del sistema");
  assert.equal(r.categoria, "proteccion");
  const s = mapearAtributoACategoria("Resistir ataques y proteger credenciales");
  assert.notEqual(s.categoria, "proteccion");
});

test("mapearAtributoACategoria: sin match devuelve null no-confiado (fallback manual)", () => {
  const r = mapearAtributoACategoria("Usabilidad");
  assert.equal(r.categoria, null);
  assert.equal(r.confiado, false);
  const vacio = mapearAtributoACategoria("");
  assert.equal(vacio.categoria, null);
});

// ─── Catálogo: inyección + guardrail ─────────────────────────────────────

test("analyzeTacticForAsr: inyecta el archivo de SU categoría con la regla de exclusividad", async () => {
  const { client, calls } = makeMockClient([
    () => okPrompt(analysisPayload([candidata({ es_recomendada: true })])),
  ]);
  setTestClient(client);
  const res = await analizarPrimero();
  void res;
  const texto = calls.prompt[0].parts[0].text;
  assert.ok(texto.includes(CATALOGO_RENDIMIENTO.trim()), "el contenido completo del catálogo va inline");
  assert.ok(
    texto.includes("usá EXCLUSIVAMENTE las tácticas de este catálogo, nombres exactos, sin inventar variantes ni mezclar con otras fuentes"),
    "la instrucción anti-invención está en el prompt",
  );
  assert.ok(!texto.includes("Cifrar los datos"), "NO inyecta categorías ajenas al ASR");
});

test("analyzeTacticForAsr: guardrail rechaza nombre inventado y reintenta; si persiste, falla", async () => {
  const inventada = analysisPayload([candidata({ es_recomendada: true, nombre_tactica: "Cache distribuido con TTL adaptativo" })]);
  const { client } = makeMockClient([() => okPrompt(inventada)]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.equal(res.ok, false);
  if (!res.ok && !("reason" in res)) assert.match(res.error, /fuera de contrato/);
});

test("analyzeTacticForAsr: guardrail acepta paráfrasis cuyo matchea por tokens (sin 'los')", async () => {
  const parafraseada = analysisPayload([
    candidata({ es_recomendada: true, nombre_tactica: "gestionar pedidos de trabajo" }),
  ]);
  const { client, calls } = makeMockClient([() => okPrompt(parafraseada)]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.ok(res.ok, "la paráfrasis con tokens del heading es válida");
  assert.equal(calls.prompt.length, 1, "no consume reintentos");
});

test("analyzeTacticForAsr: atributo sin categoría del catálogo falla ANTES de llamar al modelo", async () => {
  const { client, calls } = makeMockClient([]);
  setTestClient(client);
  const syn = makeSynthesis();
  const res = await analyzeTacticForAsr(tmp, syn, syn.atributos_de_calidad_y_asrs[2]);
  assert.ok(!res.ok && (res as { reason?: string }).reason === "categoria_no_mapeada");
  assert.match((res as { error: string }).error, /Usabilidad/);
  assert.equal(calls.create.length, 0, "no se paga sesión ni llamada sin categoría");
});

test("analyzeTacticForAsr: categoría explícita (fallback manual) pisa el mapeo automático", async () => {
  const { client, calls } = makeMockClient([
    () =>
      okPrompt(
        analysisPayload([{ ...candidata(), nombre_tactica: "Cifrar los datos", es_recomendada: true }]),
      ),
  ]);
  setTestClient(client);
  const res = await analizarPrimero({ categoriaExplicita: "seguridad" });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.categoriaUsada, "seguridad", "la explícita pisa 'rendimiento' del atributo");
  assert.equal(res.data.categoria_atributo, "seguridad", "categoria_atributo la fija el motor");
  const texto = calls.prompt[0].parts[0].text;
  assert.ok(texto.includes("Cifrar los datos"), "inyecta el catálogo de la explícita");
  assert.ok(!texto.includes(TACTICA_PRINCIPAL), "no mezcla el catálogo del atributo");
});

// ─── Análisis por ASR ─────────────────────────────────────────────────────

test("analyzeTacticForAsr: una sesión efímera propia, liberada al terminar; asr_id lo fija el motor", async () => {
  const { client, calls } = makeMockClient([
    () => okPrompt(analysisPayload([candidata({ es_recomendada: true })])),
  ]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.asr_id, "ASR-001", "el eco del modelo no manda: el motor fija el id");
  assert.equal(calls.create.length, 1, "UNA sesión efímera por llamada");
  assert.equal(calls.deleted.length, 1, "la sesión se libera en finally");
});

test("analyzeTacticForAsr: única candidata sin es_unica_viable se SANITIZA a true (badge garantizado)", async () => {
  const { client } = makeMockClient([() => okPrompt(analysisPayload([candidata({ es_recomendada: true })]))]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.ok(res.ok && res.data.candidatas[0].es_unica_viable === true);
});

test("analyzeTacticForAsr: varias candidatas NUNCA llevan es_unica_viable (se limpia el flag mentiroso)", async () => {
  const payload = analysisPayload([
    candidata({ es_recomendada: true, es_unica_viable: true }),
    candidata({ nombre_tactica: TACTICA_TERCIARIA }),
  ]);
  const { client } = makeMockClient([() => okPrompt(payload)]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.ok(res.ok && res.data.candidatas.every((c) => c.es_unica_viable === false));
});

test("analyzeTacticForAsr: reintenta cuando hay DOS recomendadas y acepta al intento válido", async () => {
  const malo = analysisPayload([
    candidata({ es_recomendada: true }),
    candidata({ nombre_tactica: TACTICA_SECUNDARIA, es_recomendada: true }),
  ]);
  const bueno = analysisPayload([
    candidata({ es_recomendada: true }),
    candidata({ nombre_tactica: TACTICA_SECUNDARIA }),
  ]);
  const { client } = makeMockClient([() => okPrompt(malo), () => okPrompt(bueno)]);
  setTestClient(client);
  const antes = structuredRetryCount();
  const res = await analizarPrimero();
  assert.ok(res.ok, "el segundo intento debe validar");
  assert.ok(structuredRetryCount() > antes, "el fallo de contrato consumió un reintento auditado");
});

test("analyzeTacticForAsr: falla si alguna candidata no tiene conexión de negocio (100% obligatoria)", async () => {
  const payload = analysisPayload([
    candidata({ es_recomendada: true }),
    candidata({ nombre_tactica: TACTICA_CUARTA, conexion_con_objetivo_de_negocio: "   " }),
  ]);
  const { client } = makeMockClient([() => okPrompt(payload)]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.equal(res.ok, false);
  if (!res.ok && !("reason" in res)) assert.match(res.error, /fuera de contrato/);
});

test("analyzeTacticForAsr: exige sacrificio declarado cuando cumple_totalmente=false", async () => {
  const payload = analysisPayload([
    candidata({ es_recomendada: true, cumple_totalmente_la_restriccion: false, que_se_sacrifica: null }),
  ]);
  const { client } = makeMockClient([() => okPrompt(payload)]);
  setTestClient(client);
  const res = await analizarPrimero();
  assert.equal(res.ok, false);
  if (!res.ok && !("reason" in res)) assert.match(res.error, /fuera de contrato/);
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
  assert.match(y, new RegExp(`optar por ${TACTICA_PRINCIPAL} para lograr`));
  assert.match(y, /aceptando Memoria extra del proceso único, sin costo de infra\.$/);
  assert.equal(y.split("\n").length, 1, "formato UNA línea");
  assert.doesNotMatch(y, /\.\./, "nunca termina con doble punto");
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
    tacticaNombre: TACTICA_PRINCIPAL,
    conexionNegocio: "MVP rápido sin servidores caros.",
    decisionTexto: "Argumentación de la candidata elegida.",
    decisionEsTextoLibre: false,
    justificacionRecomendada: "Justificación del análisis.",
    elegidaEsLaRecomendada: true,
    tradeOffsElegida: "Memoria extra del proceso único.",
    candidatasDescartadas: [candidata({ nombre_tactica: TACTICA_SECUNDARIA }) as unknown as TacticaCandidata],
    conflictosInvolucrados: [] as ConflictoTacticas[],
    conflictosAceptados: false,
    limitacionAceptada: null,
    ...overrides,
  };
}

test("renderAdrMarkdown: template completo con candidatas descartadas y conexión de negocio", () => {
  const md = renderAdrMarkdown(adrInput());
  assert.match(md, new RegExp(`^# ADR-001: ${TACTICA_PRINCIPAL}$`, "m"));
  assert.match(md, /\*\*Estado\*\*: Aceptado/);
  assert.match(md, /> En el contexto de X decidimos Y aceptando Z\./);
  assert.match(md, /## Por qué importa para el proyecto/);
  assert.match(md, /MVP rápido sin servidores caros\./);
  assert.match(md, /## Candidatas consideradas/);
  assert.match(md, new RegExp(TACTICA_SECUNDARIA), "las descartadas quedan registradas con su argumentación");
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
  const riesgoIdx = md.indexOf("**Riesgo aceptado conscientemente**");
  assert.ok(riesgoIdx > consecuenciasIdx, "el riesgo va dentro de Consecuencias");
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
          candidata({ nombre_tactica: TACTICA_SECUNDARIA }),
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
        analysisPayload([candidata({ es_recomendada: true, nombre_tactica: TACTICA_SECUNDARIA })]),
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
    () => okPrompt(analysisPayload([candidata({ es_recomendada: true, nombre_tactica: TACTICA_SECUNDARIA })])),
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

// ─── Trabajo de fondo persistido ─────────────────────────────────────────

async function esperarHasta(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const inicio = Date.now();
  while (!fn()) {
    if (Date.now() - inicio > timeoutMs) throw new Error("timeout esperando condición del job");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("console.log: el prompt completo de cada ASR queda en la consola del proceso main", async () => {
  const logs: string[] = [];
  const spy = mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  try {
    const { client } = makeMockClient([() => okPrompt(analysisPayload([candidata({ es_recomendada: true })]))]);
    setTestClient(client);
    const res = await analizarPrimero();
    assert.ok(res.ok);
    const delPrompt = logs.filter((l) => l.includes("[tácticas ASR-001] prompt ("));
    assert.equal(delPrompt.length, 1, "UN log por llamada");
    assert.ok(delPrompt[0].includes(CATALOGO_RENDIMIENTO.trim().slice(0, 40)), "el log incluye el contenido del catálogo");
  } finally {
    spy.mock.restore();
  }
});

test("ejecutarAnalisisTacticas: job de fondo que persiste resultados y consolidación", async () => {
  const conflictos = [
    {
      asr_a: "ASR-001",
      tactica_a: TACTICA_PRINCIPAL,
      asr_b: "ASR-002",
      tactica_b: "Cifrar los datos",
      explicacion: "Tensión entre rendimiento y seguridad.",
    },
  ];
  const { client, calls } = makeMockClient([
    () => okPrompt(analysisPayload([{ ...candidata(), es_recomendada: true }])),
    () =>
      okPrompt(
        analysisPayload(
          [{ ...candidata(), nombre_tactica: "Cifrar los datos", es_recomendada: true }],
          { categoria_atributo: "seguridad" },
        ),
      ),
    () => okPrompt({ conflictos }),
  ]);
  setTestClient(client);

  const arranque = await ejecutarAnalisisTacticas(tmp, synthesisPath);
  assert.deepEqual(arranque, { started: true });

  // El doc arranca en running con ambos ASR corriendo.
  const temprano = leerEstadoAnalisis(tmp, synthesisPath);
  assert.ok(temprano.estado === "running" || temprano.estado === "done", "el doc existe desde el arranque");

  await esperarHasta(() => leerEstadoAnalisis(tmp, synthesisPath).estado === "done");

  const final = leerEstadoAnalisis(tmp, synthesisPath);
  assert.equal(final.estado, "done");
  if (final.estado !== "done") return;
  const doc = final.doc;
  assert.equal(doc.synthesis_path, synthesisPath);
  const r1 = doc.resultados_por_asr["ASR-001"];
  const r2 = doc.resultados_por_asr["ASR-002"];
  assert.ok(r1?.estado === "ok" && r1.resultado?.ok);
  assert.ok(r2?.estado === "ok");
  if (r1.resultado?.ok) {
    assert.equal(r1.resultado.categoriaUsada, "rendimiento");
    assert.equal(r1.resultado.data.categoria_atributo, "rendimiento");
  }
  assert.equal(doc.consolidacion.estado, "ok");
  if (doc.consolidacion.estado === "ok") assert.equal(doc.consolidacion.data?.conflictos.length, 1);
  assert.equal(calls.create.length, 3, "2 análisis + 1 consolidación");
});

test("ejecutarAnalisisTacticas: un segundo arranque para la misma síntesis NO duplica el run", async () => {
  let liberar!: () => void;
  const puerta = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  const { client } = makeMockClient([
    async () => {
      await puerta;
      return okPrompt(analysisPayload([candidata({ es_recomendada: true })]));
    },
  ]);
  setTestClient(client);

  const primera = await ejecutarAnalisisTacticas(tmp, synthesisPath);
  assert.deepEqual(primera, { started: true });
  const segunda = await ejecutarAnalisisTacticas(tmp, synthesisPath);
  assert.equal(segunda.started, false);
  assert.equal(segunda.motivo, "ya_en_curso");

  liberar();
  await esperarHasta(() => leerEstadoAnalisis(tmp, synthesisPath).estado === "done");
});

test("leerEstadoAnalisis: running con timestamp viejo = stale (app cerrada a mitad)", () => {
  const hace46min = new Date(Date.now() - 46 * 60 * 1000).toISOString();
  const docViejo = {
    synthesis_path: synthesisPath,
    estado: "running",
    iniciado_at: hace46min,
    actualizado_at: hace46min,
    resultados_por_asr: { "ASR-001": { estado: "corriendo" } },
    consolidacion: { estado: "pendiente" },
  };
  fs.mkdirSync(path.join(tmp, ".agents", "architecture"), { recursive: true });
  fs.writeFileSync(analisisTacticasPath(tmp), JSON.stringify(docViejo));
  const estado = leerEstadoAnalisis(tmp, synthesisPath);
  assert.equal(estado.estado, "stale");

  // Con síntesis distinta → idle (no contamina otra entrevista).
  const otro = leerEstadoAnalisis(tmp, path.join(tmp, "otra-sintesis.json"));
  assert.equal(otro.estado, "idle");
});

test("confirmar decisión poda la entrada del análisis pendiente; sin pendientes borra el archivo", async () => {
  const analisisOk = {
    ok: true,
    data: analysisPayload([
      candidata({ es_recomendada: true }),
      candidata({ nombre_tactica: TACTICA_SECUNDARIA }),
    ]),
    categoriaUsada: "rendimiento",
    categoriaConfiada: true,
  } as never;

  // Doc con DOS pendientes → confirmar ASR-001 deja el archivo con ASR-002.
  const base = {
    synthesis_path: synthesisPath,
    estado: "done",
    iniciado_at: new Date().toISOString(),
    actualizado_at: new Date().toISOString(),
    consolidacion: { estado: "skipped" },
  };
  fs.mkdirSync(path.join(tmp, ".agents", "architecture"), { recursive: true });
  fs.writeFileSync(
    analisisTacticasPath(tmp),
    JSON.stringify({
      ...base,
      resultados_por_asr: {
        "ASR-001": { estado: "ok", resultado: analisisOk },
        "ASR-002": { estado: "ok", resultado: analisisOk },
      },
    }),
  );

  let res = await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-001",
    tipo: "candidata",
    analysis: (analisisOk as { data: never }).data,
    candidataIndex: 0,
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  assert.ok(res.ok);
  assert.ok(fs.existsSync(analisisTacticasPath(tmp)), "quedan pendientes: el archivo sigue");
  const docTrasPrimera = JSON.parse(fs.readFileSync(analisisTacticasPath(tmp), "utf-8"));
  assert.equal(docTrasPrimera.resultados_por_asr["ASR-001"], undefined);
  assert.ok(docTrasPrimera.resultados_por_asr["ASR-002"]);

  // Última pendiente → confirmar borra el archivo entero.
  res = await confirmTacticDecision(tmp, {
    synthesisPath,
    asrId: "ASR-002",
    tipo: "candidata",
    analysis: (analisisOk as { data: never }).data,
    candidataIndex: 0,
    conflictosInvolucrados: [],
    conflictosAceptados: false,
  });
  assert.ok(res.ok);
  assert.equal(fs.existsSync(analisisTacticasPath(tmp)), false, "sin pendientes no queda archivo");
});

// ─── Blindaje: watchdog + sesión acotada + recuperación instantánea ──────

test("watchdog: un modelo colgado NO cuelga la llamada — corta con error claro", async () => {
  setTacticaWatchdogMs(80);
  try {
    const { client } = makeMockClient([
      () => new Promise(() => {}), // el prompt nunca responde
    ]);
    setTestClient(client);
    const res = await analizarPrimero();
    assert.equal(res.ok, false);
    if (!res.ok && !("reason" in res)) {
      assert.match(res.error, /excedió el tiempo total/);
    }
  } finally {
    setTacticaWatchdogMs(TACTICA_WATCHDOG_MS_DEFAULT);
  }
});

test("fallo de sesión (server caído) vuelve como error per-ASR, sin colgar el job", async () => {
  const { client } = makeMockClient([], { createError: "connect ECONNREFUSED" });
  setTestClient(client);

  // Llamada directa: ok:false con el mensaje del fallo.
  const directa = await analizarPrimero();
  assert.equal(directa.ok, false);
  if (!directa.ok && !("reason" in directa)) assert.match(directa.error, /ECONNREFUSED/);

  // Job completo: el ASR queda en error y el doc llega a done (no running).
  const arranque = await ejecutarAnalisisTacticas(tmp, synthesisPath);
  assert.deepEqual(arranque, { started: true });
  await esperarHasta(() => leerEstadoAnalisis(tmp, synthesisPath).estado === "done");
  const final = leerEstadoAnalisis(tmp, synthesisPath);
  if (final.estado !== "done") return;
  for (const entry of Object.values(final.doc.resultados_por_asr)) {
    assert.equal(entry.estado, "error");
  }
});

test("leerEstadoAnalisis: doc running SIN run vivo = stale INMEDIATO; CON run vivo = running", async () => {
  // Doc fresco (timestamp de ahora) sin ningún run activo → stale igual.
  fs.mkdirSync(path.join(tmp, ".agents", "architecture"), { recursive: true });
  fs.writeFileSync(
    analisisTacticasPath(tmp),
    JSON.stringify({
      synthesis_path: synthesisPath,
      estado: "running",
      iniciado_at: new Date().toISOString(),
      actualizado_at: new Date().toISOString(),
      resultados_por_asr: { "ASR-001": { estado: "corriendo" } },
      consolidacion: { estado: "pendiente" },
    }),
  );
  assert.equal(leerEstadoAnalisis(tmp, synthesisPath).estado, "stale");

  // Con un run VIVO para esa síntesis → running legítimo (no stale).
  let liberar!: () => void;
  const puerta = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  const { client } = makeMockClient([
    async () => {
      await puerta;
      return okPrompt(analysisPayload([candidata({ es_recomendada: true })]));
    },
  ]);
  setTestClient(client);
  await ejecutarAnalisisTacticas(tmp, synthesisPath); // pisa el doc a running
  const durante = leerEstadoAnalisis(tmp, synthesisPath);
  assert.equal(durante.estado, "running", "con run vivo el doc NO es stale");
  liberar();
  await esperarHasta(() => leerEstadoAnalisis(tmp, synthesisPath).estado === "done");
});
