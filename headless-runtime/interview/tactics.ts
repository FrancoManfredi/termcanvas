// Tácticas de arquitectura por ASR → ADRs.
//
// Tres tipos de llamada, TODAS con sesión efímera propia (mismo patrón que
// backfillStoriesForSynthesis); ninguna comparte sesión con otra:
//   1. analyzeTacticForAsr — UNA llamada angosta POR ASR genuino: candidatas
//      del catálogo de tácticas con argumentación completa + UNA recomendada.
//      La decisión final es siempre humana (el arquitecto elige y evalúa).
//   2. consolidateTactics — UNA llamada con visión completa DESPUÉS de las
//      paralelas y ANTES de que el usuario confirme nada: detecta conflictos
//      entre las recomendadas de ASRs distintos (ATAM lo llama "tradeoff
//      point"). Analizar cada ASR aislado pierde la vista macro; este paso
//      la recupera sin mezclar argumentos entre categorías.
//   3. validateFreeTextDecision — valida una decisión en texto libre contra
//      restricciones_globales y genera su Y-statement en la misma pasada.
//      No bloqueante: se avisa, no se impide.
//
// El artefacto resultante es un ADR markdown en
// <proyecto>/.agents/architecture/decisions/ADR-<NNN>-<slug>.md más un
// manifiesto decisiones-activo.json (asr_id → ADR activo). Los ADR nunca se
// editan ni se borran: re-analizar un ASR crea uno nuevo y marca SOLO la
// línea Estado del viejo como "Superseded by ADR-<NNN>" — el historial de
// razonamiento se preserva (mismo criterio que los tombstones de la
// síntesis).
//
// Escritura segura: el documento/manifiesto se arma EN MEMORIA, se valida y
// recién ahí se escribe — ningún fallo deja archivos a medias.

import fs from "node:fs";
import path from "node:path";
import {
  ensureClient,
  promptStructured,
  SYNTHESIS_TIMEOUT_MS,
  type InterviewLedger,
} from "./engine.ts";
import {
  TacticsAnalysisOutputSchema,
  TacticsConsolidationOutputSchema,
  DecisionValidationOutputSchema,
  TACTICS_ANALYSIS_SCHEMA,
  TACTICS_CONSOLIDATION_SCHEMA,
  DECISION_VALIDATION_SCHEMA,
  type AsrItem,
  type SynthesisResult,
  type TacticaCandidata,
  type TacticsAnalysisOutput,
  type TacticsConsolidationOutput,
  type ConflictoTacticas,
  type DecisionValidationOutput,
} from "./schema.ts";
import { loadSynthesis } from "./requirements.ts";
import { getActiveBrief, findLatestBriefDocument, formatBriefForPrompt } from "./brief.ts";

// Re-exports: la superficie pública del feature vive acá para que renderer e
// IPC tipen contra un solo módulo.
export type {
  TacticaCandidata,
  TacticsAnalysisOutput,
  TacticsConsolidationOutput,
  ConflictoTacticas,
  DecisionValidationOutput,
} from "./schema.ts";

// ─── Rutas (convención .agents/ del proyecto objetivo) ───────────────────

export function architectureDir(projectPath: string): string {
  return path.join(projectPath, ".agents", "architecture");
}

export function decisionsDir(projectPath: string): string {
  return path.join(architectureDir(projectPath), "decisions");
}

export function adrManifestPath(projectPath: string): string {
  return path.join(architectureDir(projectPath), "decisiones-activo.json");
}

// ─── Manifiesto de ADRs activos ──────────────────────────────────────────
// Mapa asr_id → ADR activo. RESOLVE/REVIEW/FIX/PLANNING consultan ESTO, no
// parsean metadata de los markdown en tiempo real (barato y confiable).
// `y_statement` vive acá para que la inyección downstream sea una línea sin
// leer archivos; `reemplazados` acumula los números supersedeados para que
// la inyección pueda advertir sobre código heredado sin historial en disco.

export interface AdrManifestEntry {
  adr_activo: string;
  path: string;
  asr_id: string;
  y_statement: string;
  actualizado_at: string;
  reemplazados: string[];
}

export type AdrManifest = Record<string, AdrManifestEntry>;

export function readAdrManifest(projectPath: string): AdrManifest {
  const p = adrManifestPath(projectPath);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: AdrManifest = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const e = v as Partial<AdrManifestEntry>;
      if (typeof e?.adr_activo === "string" && typeof e?.path === "string") {
        out[k] = {
          adr_activo: e.adr_activo,
          path: e.path,
          asr_id: typeof e.asr_id === "string" ? e.asr_id : k,
          y_statement: typeof e.y_statement === "string" ? e.y_statement : "",
          actualizado_at: typeof e.actualizado_at === "string" ? e.actualizado_at : "",
          reemplazados: Array.isArray(e.reemplazados) ? e.reemplazados.filter((x): x is string => typeof x === "string") : [],
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAdrManifest(projectPath: string, manifest: AdrManifest): void {
  fs.mkdirSync(architectureDir(projectPath), { recursive: true });
  fs.writeFileSync(adrManifestPath(projectPath), JSON.stringify(manifest, null, 2));
}

// ─── Prompts ─────────────────────────────────────────────────────────────

const HEURISTICA_RESTRICCIONES = `- Heurística de restricciones OBLIGATORIA: traducí presupuesto/stack/tiempo a criterios concretos antes de proponer. Si el presupuesto es bootstrapped o casi nulo, priorizá tácticas de simplicidad operativa y descartá estilos distribuidos, replicación activa-activa o licencias pagas — a menos que ninguna alternativa simple cumpla el ASR, en cuyo caso usá cumple_totalmente_la_restriccion=false y declará el sacrificio en que_se_sacrifica.
- NUNCA propongas cambiar una restricción obligatoria (stack, presupuesto) para hacer viable una táctica: solo declará qué se sacrifica.`;

function constraintsText(synthesis: SynthesisResult): string {
  const items = synthesis.restricciones_globales ?? [];
  if (items.length === 0) return "(sin restricciones relevadas)";
  return items
    .map((c) => `- [${c.id}] ${c.tipo}: ${c.descripcion} (impacto: ${c.impacto})`)
    .join("\n");
}

function escenarioText(asr: AsrItem): string {
  const e = asr.escenario_tecnico_6_partes;
  return [
    `- Fuente: ${e.fuente}`,
    `- Estímulo: ${e.estimulo}`,
    `- Artefacto: ${e.artefacto}`,
    `- Entorno: ${e.entorno}`,
    `- Respuesta: ${e.respuesta}`,
    `- Medida de respuesta: ${e.medida_de_respuesta}`,
  ].join("\n");
}

function buildAnalysisPrompt(synthesis: SynthesisResult, asr: AsrItem, briefText: string): string {
  return [
    "Sos un Arquitecto de Software Senior. Analizá las tácticas de arquitectura aplicables al ASR de abajo para ESTE proyecto.",
    "",
    "REGLAS:",
    "- Devolvé SOLO candidatas genuinamente viables dadas las restricciones reales. Si solo existe UNA táctica realista, devolvé una sola con es_unica_viable=true — NUNCA inventes una segunda opción débil solo para llenar un mínimo.",
    "- Exactamente UNA candidata con es_recomendada=true; todas las demás false.",
    "- La argumentación y los trade-offs deben citar datos reales del proyecto (stack, presupuesto y tiempos de RESTRICCIONES GLOBALES), no generalidades de libro.",
    "- conexion_con_objetivo_de_negocio es OBLIGATORIA en TODAS las candidatas, también en las que quedan descartadas: cada una explica cómo apoya misión/visión/propuesta de valor del brief — nunca solo el beneficio técnico.",
    ...HEURISTICA_RESTRICCIONES.split("\n"),
    "",
    `BRIEF DE CONTEXTO DEL NEGOCIO:\n${briefText}`,
    "",
    `ASR A ANALIZAR (${asr.id}):`,
    `- Atributo: ${asr.atributo}`,
    `- Justificación arquitectónica: ${asr.justificacion_arquitectonica}`,
    "- Escenario técnico:",
    escenarioText(asr),
    `- Trade-offs identificados: ${asr.trade_offs_identificados}`,
    "",
    `RESTRICCIONES GLOBALES:\n${constraintsText(synthesis)}`,
    "",
    "Completá TODOS los campos de cada candidata.",
  ].join("\n");
}

function buildConsolidationPrompt(
  recomendadas: Array<{ asrId: string; atributo: string; candidata: TacticaCandidata }>,
): string {
  const lista = recomendadas
    .map(
      (r) =>
        `- [${r.asrId} · ${r.atributo}] ${r.candidata.nombre_tactica} (${r.candidata.proposito}): trade-offs declarados → ${r.candidata.trade_offs_para_este_proyecto}`,
    )
    .join("\n");
  return [
    "Sos un Arquitecto de Software Senior revisando el conjunto completo de decisiones tentativas de un proyecto.",
    "",
    "Estas son las tácticas RECOMENDADAS de cada ASR genuino, analizadas una por una de forma independiente:",
    lista,
    "",
    "Buscá CONFLICTOS ENTRE ELLAS: pares de tácticas individualmente correctas que se degradan mutuamente cuando se combinan (ATAM lo llama \"tradeoff point\"; ej: cache para rendimiento vs. cifrado en tránsito para seguridad).",
    "Para cada conflicto explicá CONCRETAMENTE por qué se degradan mutuamente y qué decisión enfrenta el arquitecto. Si no hay conflictos reales, devolvé conflictos vacío — no inventes tensiones débiles.",
  ].join("\n");
}

function buildValidationPrompt(synthesis: SynthesisResult, asr: AsrItem, textoLibre: string): string {
  return [
    "Sos un Arquitecto de Software Senior. El arquitecto del proyecto escribió su PROPIA decisión (ninguna candidata generada le cerró) para el ASR de abajo.",
    "",
    "Tu trabajo, en UNA sola respuesta:",
    "1. Comparar esa decisión contra las RESTRICCIONES GLOBALES (stack obligatorio, presupuesto, tiempo). Si choca con alguna, marcá aparta_de_restriccion=true y escribí en advertencia QUÉ restricción choca y cómo — sin bloquear: el usuario sigue siendo la autoridad final. Si no choca, advertencia=null.",
    "2. Generar el y_statement de SU decisión (una línea, formato 'En el contexto de <ASR>, decidimos <decisión> para lograr <beneficio>, aceptando <trade-off principal>').",
    "",
    `DECISIÓN DEL ARQUITECTO (texto libre):\n${textoLibre}`,
    "",
    `ASR (${asr.id}): ${asr.atributo} — ${asr.justificacion_arquitectonica}`,
    "",
    `RESTRICCIONES GLOBALES:\n${constraintsText(synthesis)}`,
  ].join("\n");
}

// ─── Validación de contrato + sanitización ───────────────────────────────
// El server 1.18.18 no aplica required/min/maxItems: los invariantes reales
// van acá y su fallo dispara el reintento del motor (misma mecánica que el
// resto de las llamadas). La consistencia de es_unica_viable NO reintenta:
// se sanitiza después de validar porque es ruido barato de reparar.

function isValidTacticsAnalysis(value: unknown): value is TacticsAnalysisOutput {
  const parsed = TacticsAnalysisOutputSchema.safeParse(value);
  if (!parsed.success) return false;
  const d = parsed.data;
  if (d.candidatas.length < 1 || d.candidatas.length > 4) return false;
  // Exactamente UNA recomendada.
  if (d.candidatas.filter((c) => c.es_recomendada).length !== 1) return false;
  // Conexión con objetivo de negocio OBLIGATORIA en el 100% de las
  // candidatas: las descartadas también quedan registradas en el ADR bajo
  // "Candidatas consideradas", así que una sin justificación de negocio
  // contaminaría el registro histórico completo.
  if (d.candidatas.some((c) => c.conexion_con_objetivo_de_negocio.trim().length === 0)) return false;
  // Sacrificio declarado cuando no cumple totalmente la restricción.
  if (d.candidatas.some((c) => !c.cumple_totalmente_la_restriccion && !(c.que_se_sacrifica ?? "").trim())) return false;
  return true;
}

// length===1 ⇔ es_unica_viable: una sola tarjeta DEBE llevar el badge (si el
// modelo lo omitió, la señal visual se perdería) y varias tarjetas NUNCA
// pueden llevarlo (sería mentira visual). Determinístico, cero re-llamadas.
function sanitizeUnicidad(data: TacticsAnalysisOutput): TacticsAnalysisOutput {
  const unica = data.candidatas.length === 1;
  return {
    ...data,
    candidatas: data.candidatas.map((c) => ({ ...c, es_unica_viable: unica })),
  };
}

function isValidConsolidation(value: unknown): value is TacticsConsolidationOutput {
  return TacticsConsolidationOutputSchema.safeParse(value).success;
}

function isValidDecisionValidation(value: unknown): value is DecisionValidationOutput {
  const parsed = DecisionValidationOutputSchema.safeParse(value);
  if (!parsed.success) return false;
  const d = parsed.data;
  if (d.y_statement.trim().length === 0) return false;
  // Si marca choque, la advertencia es el texto que el usuario va a leer:
  // sin ella el aviso sería vacío y no informado.
  if (d.aparta_de_restriccion && !(d.advertencia ?? "").trim()) return false;
  return true;
}

// ─── Llamada 1: análisis por ASR ─────────────────────────────────────────

export type TacticAnalysisResult =
  | { ok: true; data: TacticsAnalysisOutput }
  | { ok: false; error: string };

export async function analyzeTacticForAsr(
  projectPath: string,
  synthesis: SynthesisResult,
  asr: AsrItem,
): Promise<TacticAnalysisResult> {
  const contexto = getActiveBrief(projectPath) ?? findLatestBriefDocument(projectPath);
  const briefText = contexto ? formatBriefForPrompt(contexto.brief) : "(sin brief de contexto)";
  const prompt = buildAnalysisPrompt(synthesis, asr, briefText);

  // Sesión efímera REAL por llamada: NO se pasa session_id vacío (el SDK
  // armaría "/session//message" y el server respondería HTML — ver nota en
  // requirements.ts). Se libera en finally, best-effort.
  const client = await ensureClient();
  const sesion = await client.session.create({
    title: `Tácticas de arquitectura ${asr.id}`,
    directory: projectPath,
  });
  if (sesion.error || !sesion.data) {
    return {
      ok: false,
      error: `No se pudo crear la sesión de análisis (${asr.id}): ${JSON.stringify(sesion.error)}`,
    };
  }
  const fakeLedger = { session_id: sesion.data.id, project_path: projectPath } as unknown as InterviewLedger;
  try {
    const res = await promptStructured(
      fakeLedger,
      TACTICS_ANALYSIS_SCHEMA,
      prompt,
      isValidTacticsAnalysis,
      `Tácticas ${asr.id}`,
      SYNTHESIS_TIMEOUT_MS,
      undefined,
      "tactics",
    );
    // asr_id lo fija el MOTOR con el id de entrada (transcripción fiel, igual
    // que respuestas_detalladas del brief): el eco del modelo no manda.
    const data = sanitizeUnicidad({ ...res.data, asr_id: asr.id });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await client.session.delete({ sessionID: fakeLedger.session_id });
    } catch {
      // Sesión huérfana tolerable.
    }
  }
}

// ─── Llamada 2: consolidación (conflictos entre recomendadas) ────────────

export type ConsolidationResult =
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; data: TacticsConsolidationOutput }
  | { ok: false; error: string };

export async function consolidateTactics(
  projectPath: string,
  recomendadas: Array<{ asrId: string; atributo: string; candidata: TacticaCandidata }>,
): Promise<ConsolidationResult> {
  // Sin al menos dos recomendadas no existe ningún par que pueda tensionar:
  // la llamada no se paga (decisión aprobada por el dueño).
  if (recomendadas.length < 2) return { ok: true, skipped: true };

  const prompt = buildConsolidationPrompt(recomendadas);
  const client = await ensureClient();
  const sesion = await client.session.create({
    title: "Consolidación de tácticas (conflictos)",
    directory: projectPath,
  });
  if (sesion.error || !sesion.data) {
    return {
      ok: false,
      error: `No se pudo crear la sesión de consolidación: ${JSON.stringify(sesion.error)}`,
    };
  }
  const fakeLedger = { session_id: sesion.data.id, project_path: projectPath } as unknown as InterviewLedger;
  try {
    const res = await promptStructured(
      fakeLedger,
      TACTICS_CONSOLIDATION_SCHEMA,
      prompt,
      isValidConsolidation,
      "Consolidación de tácticas",
      SYNTHESIS_TIMEOUT_MS,
      undefined,
      "tactics",
    );
    return { ok: true, skipped: false, data: res.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await client.session.delete({ sessionID: fakeLedger.session_id });
    } catch {
      // Sesión huérfana tolerable.
    }
  }
}

// ─── Llamada 3: validación de texto libre (no bloqueante) ────────────────

export type FreeTextValidationResult =
  | { ok: true; data: DecisionValidationOutput }
  | { ok: false; error: string };

export async function validateFreeTextDecision(
  projectPath: string,
  synthesis: SynthesisResult,
  asr: AsrItem,
  textoLibre: string,
): Promise<FreeTextValidationResult> {
  const prompt = buildValidationPrompt(synthesis, asr, textoLibre);
  const client = await ensureClient();
  const sesion = await client.session.create({
    title: `Validación de decisión propia (${asr.id})`,
    directory: projectPath,
  });
  if (sesion.error || !sesion.data) {
    return {
      ok: false,
      error: `No se pudo crear la sesión de validación: ${JSON.stringify(sesion.error)}`,
    };
  }
  const fakeLedger = { session_id: sesion.data.id, project_path: projectPath } as unknown as InterviewLedger;
  try {
    const res = await promptStructured(
      fakeLedger,
      DECISION_VALIDATION_SCHEMA,
      prompt,
      isValidDecisionValidation,
      `Validación de decisión ${asr.id}`,
      SYNTHESIS_TIMEOUT_MS,
      undefined,
      "tactics",
    );
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await client.session.delete({ sessionID: fakeLedger.session_id });
    } catch {
      // Sesión huérfana tolerable.
    }
  }
}

// ─── Y-statement determinístico para candidata elegida ───────────────────
// Todos los campos ya existen en el objeto: reformatearlos no merece una
// llamada. Para TEXTO LIBRE sí hay llamada (validateFreeTextDecision genera
// el suyo, porque no hay estructura de dónde armarlo).

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max = 220): string {
  const t = collapse(text);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function buildYStatementFromCandidate(asr: AsrItem, c: TacticaCandidata): string {
  // Los campos vienen con su punto final: se normaliza para no terminar el
  // Y-statement con ".." y mantener el formato de UNA oración.
  const beneficio = collapse(c.conexion_con_objetivo_de_negocio).replace(/\.+$/, "") || collapse(c.proposito).replace(/\.+$/, "") || "el beneficio buscado";
  const tradeOff = collapse(c.trade_offs_para_este_proyecto).replace(/\.+$/, "") || "los trade-offs declarados en el análisis";
  return `En el contexto de ${collapse(asr.atributo)} (${asr.id}), decidimos optar por ${collapse(c.nombre_tactica)} para lograr ${clip(beneficio)}, aceptando ${clip(tradeOff)}.`;
}

// ─── Render del ADR (markdown legible, práctica estándar del formato) ────

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asr";
}

function nextAdrNumber(projectPath: string): number {
  let max = 0;
  const dir = decisionsDir(projectPath);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = /^ADR-(\d+)/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  for (const entry of Object.values(readAdrManifest(projectPath))) {
    const m = /^ADR-(\d+)$/.exec(entry.adr_activo);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export interface AdrRenderInput {
  numero: number;
  asr: AsrItem;
  categoria: string;
  sintesisFileName: string;
  fecha: string;
  yStatement: string;
  tacticaNombre: string;
  conexionNegocio: string;
  decisionTexto: string;
  decisionEsTextoLibre: boolean;
  justificacionRecomendada: string;
  elegidaEsLaRecomendada: boolean;
  tradeOffsElegida: string;
  candidatasDescartadas: TacticaCandidata[];
  conflictosInvolucrados: ConflictoTacticas[];
  conflictosAceptados: boolean;
  limitacionAceptada: string | null;
}

export function renderAdrMarkdown(input: AdrRenderInput): string {
  const nnn = String(input.numero).padStart(3, "0");
  const conflictosHeader =
    input.conflictosInvolucrados.length === 0
      ? "Ninguno detectado"
      : input.conflictosInvolucrados
          .map((c) => {
            const otroEsB = c.asr_a === input.asr.id;
            const otroAsr = otroEsB ? c.asr_b : c.asr_a;
            const otra = otroEsB ? c.tactica_b : c.tactica_a;
            return `- Con la táctica de ${otroAsr} (${otra}): ${c.explicacion}`;
          })
          .join("\n");

  const bloquesDescartadas = input.candidatasDescartadas.map((c) => {
    const sacrificio =
      !c.cumple_totalmente_la_restriccion && (c.que_se_sacrifica ?? "").trim()
        ? `\n  - Sacrificio declarado: ${collapse(c.que_se_sacrifica!)}`
        : "";
    return [
      `- **${c.nombre_tactica}** (${c.proposito})`,
      `  - Argumentación: ${collapse(c.argumentacion)}`,
      `  - Trade-offs: ${collapse(c.trade_offs_para_este_proyecto)}`,
      `  - Conexión con objetivo de negocio: ${collapse(c.conexion_con_objetivo_de_negocio)}${sacrificio}`,
    ].join("\n");
  });

  // La justificación de la recomendada acompaña SIEMPRE a una candidata
  // generada (registro completo del análisis); si el arquitecto eligió otra,
  // queda etiquetada como contexto para no confundir el motivo de la elección.
  const justificacionBloque = input.decisionEsTextoLibre
    ? []
    : input.elegidaEsLaRecomendada
      ? ["", "Justificación de la recomendación:", "", collapse(input.justificacionRecomendada)]
      : [
          "",
          "Contexto — el análisis había recomendado otra táctica, con esta justificación (el arquitecto evaluó el argumento y eligió distinto):",
          "",
          collapse(input.justificacionRecomendada),
        ];

  const limitacionBloque = input.limitacionAceptada
    ? [
        "### Limitación aceptada",
        "",
        collapse(input.limitacionAceptada),
        "",
        "No se propone cambiar ninguna restricción obligatoria (stack, presupuesto) para evitarla.",
      ]
    : [];

  // El conflicto confirmado se registra EN las consecuencias (donde la
  // práctica de ADR espera los riesgos), no solo en el header.
  const riesgosBloque =
    input.conflictosAceptados && input.conflictosInvolucrados.length > 0
      ? input.conflictosInvolucrados.map(
          (c) =>
            `**Riesgo aceptado conscientemente**: ${collapse(c.explicacion)} — el arquitecto revisó el conflicto detectado en la consolidación (${c.asr_a}/${c.tactica_a} ↔ ${c.asr_b}/${c.tactica_b}) y decidió que el trade-off vale la pena.`,
        )
      : [];

  const body: string[] = [
    `# ADR-${nnn}: ${input.tacticaNombre}`,
    "",
    `> ${input.yStatement}`,
    "",
    "**Estado**: Aceptado",
    `**Fecha**: ${input.fecha}`,
    `**ASR relacionado**: ${input.asr.id} (${input.categoria})`,
    `**Síntesis de origen**: ${input.sintesisFileName}`,
    "**Conflictos detectados con otras tácticas**:",
    conflictosHeader,
    "",
    "## Contexto",
    "",
    `Escenario técnico del ${input.asr.id} — ${input.asr.atributo}. ${collapse(input.asr.justificacion_arquitectonica)}`,
    "",
    escenarioText(input.asr),
    "",
    `Trade-offs identificados en la síntesis: ${input.asr.trade_offs_identificados}`,
    "",
    "## Por qué importa para el proyecto",
    "",
    collapse(input.conexionNegocio),
  ];

  const decision: string[] = [
    "## Decisión",
    "",
    `Se elige: **${input.tacticaNombre}**`,
    "",
    ...(input.decisionEsTextoLibre
      ? [`${collapse(input.decisionTexto)}`, "", "(decision del arquitecto, no generada por IA)"]
      : [`${collapse(input.decisionTexto)}`, ...justificacionBloque]),
  ];

  const candidatas: string[] = [
    "## Candidatas consideradas",
    "",
    bloquesDescartadas.length > 0
      ? bloquesDescartadas.join("\n\n")
      : "(no hubo otras candidatas — única opción genuinamente viable dadas las restricciones)",
  ];

  const consecuencias: string[] = [
    "## Consecuencias / Trade-offs",
    "",
    collapse(input.tradeOffsElegida) || "(sin trade-offs declarados)",
    ...riesgosBloque.flatMap((r) => ["", r]),
  ];

  return [...body, "", ...decision, "", ...limitacionBloque, ...limitacionBloque.length > 0 ? [""] : [], ...candidatas, "", ...consecuencias]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .concat("\n");
}

// ─── Confirmación: escribir el ADR + actualizar el manifiesto ────────────

export interface ConfirmTacticDecisionInput {
  synthesisPath: string;
  asrId: string;
  tipo: "candidata" | "libre";
  analysis: TacticsAnalysisOutput;
  candidataIndex?: number;
  textoLibre?: string;
  // Del validate previo en la UI; si falta (uso directo del canal), la
  // validación corre internamente antes de escribir nada.
  yStatementLibre?: string;
  conflictosInvolucrados: ConflictoTacticas[];
  conflictosAceptados: boolean;
  advertenciaConfirmada?: boolean;
}

export type ConfirmTacticDecisionResult =
  | {
      ok: true;
      adrNumero: string;
      adrPath: string;
      supersededAdr: string | null;
      manifest: AdrManifest;
    }
  | {
      ok: false;
      reason: "no_synthesis" | "asr_not_found" | "invalid_input" | "needs_confirmation" | "generation_failed";
      error: string;
    };

export async function confirmTacticDecision(
  projectPath: string,
  input: ConfirmTacticDecisionInput,
): Promise<ConfirmTacticDecisionResult> {
  const synthesis = loadSynthesis(input.synthesisPath);
  if (!synthesis) {
    return { ok: false, reason: "no_synthesis", error: "La síntesis no existe o no es válida." };
  }
  const asr = (synthesis.atributos_de_calidad_y_asrs ?? []).find((a) => a.id === input.asrId);
  if (!asr) {
    return { ok: false, reason: "asr_not_found", error: `El ASR ${input.asrId} no existe en esta síntesis.` };
  }

  let yStatement: string;
  let tacticaNombre: string;
  let conexionNegocio: string;
  let decisionTexto: string;
  let decisionEsTextoLibre = false;
  let justificacionRecomendada = "";
  let elegidaEsLaRecomendada = false;
  let tradeOffsElegida = "";
  let candidatasDescartadas: TacticaCandidata[] = [];
  let limitacionAceptada: string | null = null;

  if (input.tipo === "candidata") {
    const idx = input.candidataIndex ?? -1;
    const elegida = input.analysis.candidatas[idx];
    if (!elegida) {
      return { ok: false, reason: "invalid_input", error: "Índice de candidata inválido." };
    }
    yStatement = buildYStatementFromCandidate(asr, elegida);
    tacticaNombre = elegida.nombre_tactica;
    conexionNegocio = elegida.conexion_con_objetivo_de_negocio;
    decisionTexto = elegida.argumentacion;
    elegidaEsLaRecomendada = elegida.es_recomendada;
    justificacionRecomendada = input.analysis.justificacion_de_la_recomendada;
    tradeOffsElegida = elegida.trade_offs_para_este_proyecto;
    candidatasDescartadas = input.analysis.candidatas.filter((_, i) => i !== idx);
    limitacionAceptada =
      !elegida.cumple_totalmente_la_restriccion && (elegida.que_se_sacrifica ?? "").trim()
        ? elegida.que_se_sacrifica
        : null;
  } else {
    const texto = (input.textoLibre ?? "").trim();
    if (!texto) {
      return { ok: false, reason: "invalid_input", error: "Falta la decisión en texto libre." };
    }
    // Defensa en profundidad: si la UI no pasó por la validación previa, el
    // choque con restricciones exige confirmación explícita ANTES de escribir.
    let validacion: DecisionValidationOutput | null = null;
    if (typeof input.yStatementLibre !== "string" || !input.yStatementLibre.trim()) {
      const v = await validateFreeTextDecision(projectPath, synthesis, asr, texto);
      if (!v.ok) return { ok: false, reason: "generation_failed", error: v.error };
      validacion = v.data;
    }
    const efectiva =
      validacion ??
      ({ aparta_de_restriccion: false, advertencia: null, y_statement: input.yStatementLibre!.trim() } as DecisionValidationOutput);
    if (efectiva.aparta_de_restriccion && !input.advertenciaConfirmada) {
      return {
        ok: false,
        reason: "needs_confirmation",
        error: efectiva.advertencia ?? "La decisión parece apartarse de una restricción global — confirmá que es intencional.",
      };
    }
    yStatement = efectiva.y_statement;
    tacticaNombre = "Decisión del arquitecto";
    conexionNegocio = texto;
    decisionTexto = texto;
    decisionEsTextoLibre = true;
    // El texto libre no trae trade-offs estructurados: quedan dentro de la
    // propia decisión, que ya está transcrita íntegra en el ADR.
    tradeOffsElegida = "Los trade-offs aceptados están descritos por el arquitecto dentro de la decisión.";
  }

  // Numeración global del proyecto (scan de archivos + manifiesto) y ruta.
  const numero = nextAdrNumber(projectPath);
  const nnn = String(numero).padStart(3, "0");
  const fileName = `ADR-${nnn}-${slugify(`${asr.id}-${asr.atributo}`)}.md`;
  fs.mkdirSync(decisionsDir(projectPath), { recursive: true });
  const adrPath = path.join(decisionsDir(projectPath), fileName);

  // Supersede: el ADR anterior del mismo asr_id NO se edita salvo su línea
  // Estado — el resto del archivo queda intacto como registro histórico.
  const manifest = readAdrManifest(projectPath);
  const previa = manifest[input.asrId];
  let supersededAdr: string | null = null;
  let reemplazados: string[] = [];
  if (previa && previa.adr_activo !== `ADR-${nnn}` && fs.existsSync(previa.path)) {
    try {
      const contenido = fs.readFileSync(previa.path, "utf-8");
      const actualizado = contenido.replace(
        /^\*\*Estado\*\*:.*$/m,
        `**Estado**: Superseded by ADR-${nnn}`,
      );
      if (actualizado !== contenido) fs.writeFileSync(previa.path, actualizado);
      supersededAdr = previa.adr_activo;
      reemplazados = [previa.adr_activo, ...previa.reemplazados.filter((r) => r !== `ADR-${nnn}`)];
    } catch {
      // Best-effort: si el viejo no se puede marcar, el nuevo sigue siendo
      // el activo del manifiesto (la fuente de verdad downstream).
      supersededAdr = previa.adr_activo;
      reemplazados = [previa.adr_activo];
    }
  }

  const markdown = renderAdrMarkdown({
    numero,
    asr,
    categoria: input.analysis.categoria_atributo || asr.atributo,
    sintesisFileName: path.basename(input.synthesisPath),
    fecha: new Date().toISOString().slice(0, 10),
    yStatement,
    tacticaNombre,
    conexionNegocio,
    decisionTexto,
    decisionEsTextoLibre,
    justificacionRecomendada,
    elegidaEsLaRecomendada,
    tradeOffsElegida,
    candidatasDescartadas,
    conflictosInvolucrados: input.conflictosInvolucrados,
    conflictosAceptados: input.conflictosAceptados,
    limitacionAceptada,
  });

  // Escritura segura: primero el ADR, recién después el manifiesto (armado
  // en memoria y escrito de una pieza — quien lee ve siempre un estado
  // válido; en el peor caso intermedio hay ADR sin entrada, nunca al revés).
  fs.writeFileSync(adrPath, markdown);
  manifest[input.asrId] = {
    adr_activo: `ADR-${nnn}`,
    path: adrPath,
    asr_id: input.asrId,
    y_statement: yStatement,
    actualizado_at: new Date().toISOString(),
    reemplazados,
  };
  writeAdrManifest(projectPath, manifest);

  return {
    ok: true,
    adrNumero: `ADR-${nnn}`,
    adrPath,
    supersededAdr,
    manifest,
  };
}

// ─── Estado por síntesis (para la sección de la UI) ──────────────────────

export interface TacticStatusEntry {
  asrId: string;
  atributo: string;
  es_asr_genuino: boolean;
  adrActivo: { adr: string; path: string; yStatement: string } | null;
}

export function tacticsStatusForSynthesis(
  projectPath: string,
  synthesisPath: string,
): { asrs: TacticStatusEntry[] } {
  const synthesis = loadSynthesis(synthesisPath);
  if (!synthesis) return { asrs: [] };
  const manifest = readAdrManifest(projectPath);
  return {
    asrs: (synthesis.atributos_de_calidad_y_asrs ?? []).map((a) => {
      const entry = manifest[a.id];
      return {
        asrId: a.id,
        atributo: a.atributo,
        es_asr_genuino: a.es_asr_genuino === true,
        adrActivo:
          entry && fs.existsSync(entry.path)
            ? { adr: entry.adr_activo, path: entry.path, yStatement: entry.y_statement }
            : null,
      };
    }),
  };
}

// ─── Formateo para la inyección downstream (RESOLVE/FIX/REVIEW/PLANNING) ─
// Bloque compacto: y_statement SIEMPRE (barato, una línea) + instrucción
// explícita de leer el archivo completo ante cualquier duda + advertencia
// sobre código que parezca seguir un ADR reemplazado (juicio del modelo,
// enmarcado como posibilidad a verificar). Cadena vacía = sin sección.

export function formatDecisionsForPrompt(projectPath: string): string {
  const manifest = readAdrManifest(projectPath);
  const entries = Object.values(manifest).filter((e) => fs.existsSync(e.path));
  if (entries.length === 0) return "";

  const activos = entries.map((e) => `- **${e.adr_activo}** (${e.asr_id}): ${e.y_statement}\n  Detalle completo: ${path.relative(path.dirname(path.dirname(e.path)), e.path).replace(/\\/g, "/")}`);
  const reemplazados = [
    ...new Set(entries.flatMap((e) => e.reemplazados)),
  ];

  return [
    "DECISIONES DE ARQUITECTURA YA TOMADAS (ADRs activos):",
    "",
    ...activos,
    ...(reemplazados.length > 0
      ? ["", `ADRs reemplazados (ya NO vigentes): ${reemplazados.join(", ")}.`]
      : []),
    "",
    "Instrucciones OBLIGATORIAS sobre estas decisiones:",
    "- Cada línea resume UNA decisión completa. Si tu implementación podría interactuar con matices no cubiertos por el resumen (restricciones colaterales, consecuencias aceptadas, riesgos ya identificados), LEÉ el archivo completo del ADR antes de continuar — no asumas que el resumen alcanza.",
    "- NO propongas una táctica alternativa sin justificar explícitamente por qué la ya decidida no aplica a este caso puntual.",
    "- Si al explorar el código notás que la implementación existente parece seguir un ADR reemplazado, señalalo EXPLÍCITAMENTE en tu resumen final como posibilidad a verificar (no como hecho confirmado) — podría requerir migrar la implementación. Comentarios `// @follows ADR-XXX` en el código, si existen, son evidencia más fuerte; el mecanismo no depende de que existan.",
  ].join("\n");
}
