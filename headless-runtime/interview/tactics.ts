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
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
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
import {
  cargarCatalogoTacticas,
  matcheaCatalogo,
  type CatalogoTacticas,
} from "./tactic-catalog.ts";
import {
  mapearAtributoACategoria,
  CATEGORIA_LABELS,
  type CategoriaTactica,
} from "../../shared/tacticCategorias.ts";

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

export function analisisTacticasPath(projectPath: string): string {
  return path.join(architectureDir(projectPath), "analisis-tacticas.json");
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

function buildAnalysisPrompt(
  synthesis: SynthesisResult,
  asr: AsrItem,
  briefText: string,
  catalogo: CatalogoTacticas,
): string {
  return [
    "Sos un Arquitecto de Software Senior. Analizá las tácticas de arquitectura aplicables al ASR de abajo para ESTE proyecto.",
    "",
    `CATÁLOGO DE TÁCTICAS (${CATEGORIA_LABELS[catalogo.categoria]} — categoría "${catalogo.categoria}"):`,
    "REGLA: usá EXCLUSIVAMENTE las tácticas de este catálogo, nombres exactos, sin inventar variantes ni mezclar con otras fuentes. El campo nombre_tactica de cada candidata debe ser el nombre EXACTO de una táctica del catálogo de abajo.",
    "",
    catalogo.contenido,
    "",
    "REGLAS:",
    "- Máximo 4 candidatas en total: elegí las de mayor impacto real para ESTE ASR.",
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

// Guardrail del catálogo: cada nombre_tactica debe matchear un heading real
// del archivo cargado (match por tokens — ver tactic-catalog.ts). Sin esto
// el modelo puede colar tácticas inventadas "de memoria" aunque el prompt
// prohíba mezclar fuentes; con esto, el reintento existente lo corrige.
function crearPredicateTacticas(headings: string[]) {
  return function isValidTacticsAnalysis(value: unknown): value is TacticsAnalysisOutput {
    const parsed = TacticsAnalysisOutputSchema.safeParse(value);
    if (!parsed.success) return false;
    const d = parsed.data;
    // Vacío sí es fallo genuino (sin candidatas no hay análisis); el EXCESO
    // (>4) NO reintenta: se recorta determinísticamente en sanitizarCandidatas
    // — el modelo tiende a entregar 5-6 tácticas válidas del catálogo y los
    // reintentos ciegos solo repetían el mismo fracaso (bug ASR-001/003).
    if (d.candidatas.length < 1) return false;
    // Exactamente UNA recomendada.
    if (d.candidatas.filter((c) => c.es_recomendada).length !== 1) return false;
    // Conexión con objetivo de negocio OBLIGATORIA en el 100% de las
    // candidatas: las descartadas también quedan registradas en el ADR bajo
    // "Candidatas consideradas", así que una sin justificación de negocio
    // contaminaría el registro histórico completo.
    if (d.candidatas.some((c) => c.conexion_con_objetivo_de_negocio.trim().length === 0)) return false;
    // Sacrificio declarado cuando no cumple totalmente la restricción.
    if (d.candidatas.some((c) => !c.cumple_totalmente_la_restriccion && !(c.que_se_sacrifica ?? "").trim())) return false;
    // Nada fuera del catálogo cargado.
    if (d.candidatas.some((c) => !matcheaCatalogo(c.nombre_tactica, headings))) return false;
    return true;
  };
}

// Sanitización post-parse (no dispara reintentos):
//   1. RECORTE a 4: si vienen más, quedan la recomendada + las primeras en
//      orden de llegada hasta completar (preserva el orden original). El
//      modelo demostró entregar 5-6 válidas seguidas y el recorte le ahorra
//      al usuario elegir entre 6 tarjetas sin valor agregado.
//   2. Unicidad length===1 ⇔ es_unica_viable: una sola tarjeta DEBE llevar el
//      badge (si el modelo lo omitió, la señal visual se perdería) y varias
//      tarjetas NUNCA pueden llevarlo (sería mentira visual).
function sanitizarCandidatas(
  data: TacticsAnalysisOutput,
  etiqueta: string,
): TacticsAnalysisOutput {
  let candidatas = data.candidatas;
  if (candidatas.length > 4) {
    const recomendada = candidatas.find((c) => c.es_recomendada);
    const otras = candidatas.filter((c) => !c.es_recomendada).slice(0, 3);
    const aConservar = new Set([recomendada!, ...otras]);
    candidatas = candidatas.filter((c) => aConservar.has(c));
    console.log(
      `[tácticas ${etiqueta}] ${data.candidatas.length} candidatas > máximo 4: se conservan la recomendada + las primeras 3.`,
    );
  }
  const unica = candidatas.length === 1;
  return {
    ...data,
    candidatas: candidatas.map((c) => ({ ...c, es_unica_viable: unica })),
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

// ─── Blindaje: watchdog + sesión efímera acotada ─────────────────────────
// session.create del SDK NO tiene timeout propio: con un server trabado que
// abre puerto pero no responde, la llamada queda colgada para siempre. Dos
// capas duras INDEPENDIENTES de los reintentos internos del motor (que hoy
// pueden estirar ~18 min por ASR en el peor caso):
//   - carrera de 60s sobre session.create;
//   - watchdog TOTAL por llamada al modelo.

const SESSION_CREATE_TIMEOUT_MS = 60_000;
export const TACTICA_WATCHDOG_MS_DEFAULT = 8 * 60 * 1000;
let tacticaWatchdogMs = TACTICA_WATCHDOG_MS_DEFAULT;

/** Seam para tests: achicar el watchdog sin esperar minutos reales. */
export function setTacticaWatchdogMs(ms: number): void {
  tacticaWatchdogMs = ms;
}

function conWatchdog<T>(promesa: Promise<T>, etiqueta: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${etiqueta}: excedió el tiempo total (${Math.round(tacticaWatchdogMs / 60000)} min). Reintentá.`,
          ),
        ),
      tacticaWatchdogMs,
    );
  });
  return Promise.race([promesa, vencimiento]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function crearSesionEfimera(
  client: OpencodeClient,
  title: string,
  directory: string,
): Promise<{ id: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      client.session.create({ title, directory }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`No se pudo crear la sesión "${title}": tiempo de espera excedido.`),
            ),
          SESSION_CREATE_TIMEOUT_MS,
        );
      }),
    ]);
    if (res.error || !res.data) {
      throw new Error(JSON.stringify(res.error));
    }
    return res.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Llamada 1: análisis por ASR (con catálogo de la categoría) ──────────

export type TacticAnalysisResult =
  | {
      ok: true;
      data: TacticsAnalysisOutput;
      categoriaUsada: CategoriaTactica;
      /** false = mapeo débil: la UI ofrece re-mapear manualmente. */
      categoriaConfiada: boolean;
    }
  | { ok: false; reason: "categoria_no_mapeada"; atributo: string; error: string }
  | { ok: false; error: string };

export async function analyzeTacticForAsr(
  projectPath: string,
  synthesis: SynthesisResult,
  asr: AsrItem,
  opts?: { categoriaExplicita?: CategoriaTactica },
): Promise<TacticAnalysisResult> {
  // Categoría del catálogo: explícita (fallback manual de la UI) o mapeo
  // automático desde el texto libre del atributo.
  const mapeo = opts?.categoriaExplicita
    ? { categoria: opts.categoriaExplicita as CategoriaTactica, confiado: true }
    : mapearAtributoACategoria(asr.atributo);
  if (!mapeo.categoria) {
    return {
      ok: false,
      reason: "categoria_no_mapeada",
      atributo: asr.atributo,
      error: `No se pudo mapear el atributo "${asr.atributo}" a una categoría del catálogo — elegila manualmente.`,
    };
  }

  let catalogo: CatalogoTacticas;
  try {
    catalogo = cargarCatalogoTacticas(mapeo.categoria);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const contexto = getActiveBrief(projectPath) ?? findLatestBriefDocument(projectPath);
  const briefText = contexto ? formatBriefForPrompt(contexto.brief) : "(sin brief de contexto)";
  const prompt = buildAnalysisPrompt(synthesis, asr, briefText, catalogo);
  // Trazabilidad pedida por el dueño: el prompt completo de cada ASR queda
  // en la consola del proceso main (terminal donde corre electron — NUNCA en
  // DevTools del renderer).
  console.log(`[tácticas ${asr.id}] prompt (${prompt.length} chars):\n${prompt}`);

  // Sesión efímera REAL por llamada: NO se pasa session_id vacío (el SDK
  // armaría "/session//message" y el server respondería HTML — ver nota en
  // requirements.ts). Se libera en finally, best-effort.
  console.log(`[tácticas ${asr.id}] llamando al modelo…`);
  let client: OpencodeClient;
  let sesionId: string;
  try {
    client = await ensureClient();
    sesionId = (
      await crearSesionEfimera(client, `Tácticas de arquitectura ${asr.id}`, projectPath)
    ).id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[tácticas ${asr.id}] terminó con error (sesión): ${msg}`);
    return { ok: false, error: msg };
  }
  const fakeLedger = { session_id: sesionId, project_path: projectPath } as unknown as InterviewLedger;
  try {
    const res = await conWatchdog(
      promptStructured(
        fakeLedger,
        TACTICS_ANALYSIS_SCHEMA,
        prompt,
        crearPredicateTacticas(catalogo.headings),
        `Tácticas ${asr.id}`,
        SYNTHESIS_TIMEOUT_MS,
        undefined,
        "tactics",
      ),
      `Tácticas ${asr.id}`,
    );
    // asr_id y categoria_atributo los fija el MOTOR con los datos de entrada
    // (transcripción fiel): el eco del modelo no manda.
    const data = sanitizarCandidatas(
      { ...res.data, asr_id: asr.id, categoria_atributo: catalogo.categoria },
      asr.id,
    );
    console.log(`[tácticas ${asr.id}] terminó ok`);
    return {
      ok: true,
      data,
      categoriaUsada: catalogo.categoria,
      categoriaConfiada: mapeo.confiado,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[tácticas ${asr.id}] terminó con error: ${msg}`);
    return { ok: false, error: msg };
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
  console.log(`[tácticas] consolidación llamando al modelo (${recomendadas.length} recomendadas)…`);
  let client: OpencodeClient;
  let sesionId: string;
  try {
    client = await ensureClient();
    sesionId = (
      await crearSesionEfimera(client, "Consolidación de tácticas (conflictos)", projectPath)
    ).id;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const fakeLedger = { session_id: sesionId, project_path: projectPath } as unknown as InterviewLedger;
  try {
    const res = await conWatchdog(
      promptStructured(
        fakeLedger,
        TACTICS_CONSOLIDATION_SCHEMA,
        prompt,
        isValidConsolidation,
        "Consolidación de tácticas",
        SYNTHESIS_TIMEOUT_MS,
        undefined,
        "tactics",
      ),
      "Consolidación de tácticas",
    );
    console.log("[tácticas] consolidación terminó ok");
    return { ok: true, skipped: false, data: res.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[tácticas] consolidación terminó con error: ${msg}`);
    return { ok: false, error: msg };
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
  let client: OpencodeClient;
  let sesionId: string;
  try {
    client = await ensureClient();
    sesionId = (
      await crearSesionEfimera(client, `Validación de decisión propia (${asr.id})`, projectPath)
    ).id;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const fakeLedger = { session_id: sesionId, project_path: projectPath } as unknown as InterviewLedger;
  try {
    const res = await conWatchdog(
      promptStructured(
        fakeLedger,
        DECISION_VALIDATION_SCHEMA,
        prompt,
        isValidDecisionValidation,
        `Validación de decisión ${asr.id}`,
        SYNTHESIS_TIMEOUT_MS,
        undefined,
        "tactics",
      ),
      `Validación de decisión ${asr.id}`,
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

  // La decisión está tomada: la entrada sale de los pendientes (el archivo
  // completo desaparece cuando no queda ninguna sin decidir).
  podarEntradaAnalisis(projectPath, input.synthesisPath, input.asrId);

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

// ─── Análisis como TRABAJO DE FONDO persistido ───────────────────────────
// El análisis corre EN EL PROCESO MAIN desacoplado de la UI: cerrar el modal
// o la app no lo cancela (cerrar la app sí — al reabrir, el estado queda en
// disco y los resultados terminados se muestran para elegir). La fuente de
// verdad es analisis-tacticas.json junto a las decisiones: se escribe
// atómicamente después de CADA evento (arranque, ASR terminal, consolidación)
// para que un crash nunca pierda más que el ASR en vuelo.

export interface AnalisisAsrEntry {
  estado: "corriendo" | "ok" | "error";
  resultado?: TacticAnalysisResult;
  error?: string;
}

export interface AnalisisTacticasDoc {
  synthesis_path: string;
  estado: "running" | "done" | "error";
  iniciado_at: string;
  actualizado_at: string;
  resultados_por_asr: Record<string, AnalisisAsrEntry>;
  consolidacion: {
    estado: "pendiente" | "ok" | "skipped" | "error";
    data?: TacticsConsolidationOutput;
    error?: string;
  };
  error_global?: string;
}

export type EstadoAnalisisTacticas =
  | { estado: "idle" }
  | { estado: "stale"; doc: AnalisisTacticasDoc }
  | { estado: "running" | "done" | "error"; doc: AnalisisTacticasDoc };

// Un run completo (2-4 ASR) no debería superar esto ni de cerca: si el doc
// quedó "running" con timestamp viejo es que la app murió a mitad de camino.
const STALE_ANALISIS_MS = 45 * 60 * 1000;

function leerAnalisisDoc(projectPath: string): AnalisisTacticasDoc | null {
  const p = analisisTacticasPath(projectPath);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as AnalisisTacticasDoc;
    if (!raw || typeof raw !== "object" || typeof raw.synthesis_path !== "string") return null;
    if (!raw.resultados_por_asr || typeof raw.resultados_por_asr !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

function escribirAnalisisDoc(projectPath: string, doc: AnalisisTacticasDoc): void {
  fs.mkdirSync(architectureDir(projectPath), { recursive: true });
  doc.actualizado_at = new Date().toISOString();
  // Una sola escritura con el documento ya armado en memoria: quien lee ve
  // siempre JSON válido.
  fs.writeFileSync(analisisTacticasPath(projectPath), JSON.stringify(doc, null, 2));
}

/** Estado del análisis para la UI, con detección de run interrumpido. */
export function leerEstadoAnalisis(
  projectPath: string,
  synthesisPath: string,
): EstadoAnalisisTacticas {
  const doc = leerAnalisisDoc(projectPath);
  if (!doc || doc.synthesis_path !== synthesisPath) return { estado: "idle" };
  if (doc.estado === "running") {
    // Un doc "running" SIN run vivo en este proceso = interrumpido (la app
    // se cerró o murió a mitad): stale INMEDIATO, sin esperar el umbral.
    // El umbral viejo queda solo como red de seguridad extra.
    if (!analisisEnCurso(synthesisPath)) return { estado: "stale", doc };
    if (Date.now() - Date.parse(doc.iniciado_at) > STALE_ANALISIS_MS) {
      return { estado: "stale", doc };
    }
  }
  return { estado: doc.estado, doc };
}

function podarEntradaAnalisis(projectPath: string, synthesisPath: string, asrId: string): void {
  const doc = leerAnalisisDoc(projectPath);
  if (!doc || doc.synthesis_path !== synthesisPath) return;
  delete doc.resultados_por_asr[asrId];
  if (Object.keys(doc.resultados_por_asr).length === 0) {
    try {
      fs.rmSync(analisisTacticasPath(projectPath));
    } catch {
      // Best-effort: sin pendientes el archivo sobrante es inofensivo.
    }
    return;
  }
  escribirAnalisisDoc(projectPath, doc);
}

// Un solo run activo por síntesis: re-clicar "Analizar" mientras corre no
// duplica llamadas ni pisa el doc a mitad de escritura.
const runsActivos = new Set<string>();

export function analisisEnCurso(synthesisPath: string): boolean {
  return runsActivos.has(synthesisPath);
}

async function consolidarYSeguir(
  projectPath: string,
  doc: AnalisisTacticasDoc,
  sintesis: SynthesisResult,
): Promise<void> {
  const recomendadas = Object.entries(doc.resultados_por_asr).flatMap(([asrId, entry]) => {
    const r = entry.resultado;
    if (!entry || entry.estado !== "ok" || !r || !r.ok) return [];
    const rec = r.data.candidatas.find((c) => c.es_recomendada);
    const atributo = sintesis.atributos_de_calidad_y_asrs.find((a) => a.id === asrId)?.atributo ?? "";
    return rec ? [{ asrId, atributo, candidata: rec }] : [];
  });
  const c = await consolidateTactics(projectPath, recomendadas);
  if (!c.ok) {
    doc.consolidacion = { estado: "error", error: c.error };
  } else if (c.skipped) {
    doc.consolidacion = { estado: "skipped" };
  } else {
    doc.consolidacion = { estado: "ok", data: c.data };
  }
}

/**
 * Arranca el análisis COMPLETO como trabajo de fondo: vuelve inmediatamente
 * ({ started }) y el progreso va quedando en analisis-tacticas.json. Nunca
 * lanza: los fallos viven en el doc.
 */
export async function ejecutarAnalisisTacticas(
  projectPath: string,
  synthesisPath: string,
): Promise<{ started: boolean; motivo?: string }> {
  if (runsActivos.has(synthesisPath)) return { started: false, motivo: "ya_en_curso" };
  const synthesis = loadSynthesis(synthesisPath);
  if (!synthesis) return { started: false, motivo: "no_synthesis" };
  const genuinos = (synthesis.atributos_de_calidad_y_asrs ?? []).filter((a) => a.es_asr_genuino === true);
  if (genuinos.length === 0) return { started: false, motivo: "no_genuine_asrs" };

  runsActivos.add(synthesisPath);
  // Fire-and-forget deliberado: el caller (IPC) vuelve YA; este cuerpo corre
  // hasta terminar y persiste cada hito.
  void (async () => {
    try {
      console.log(
        `[tácticas] run iniciado (${genuinos.length} ASR: ${genuinos.map((a) => a.id).join(", ")})`,
      );
      const ahora = new Date().toISOString();
      const doc: AnalisisTacticasDoc = {
        synthesis_path: synthesisPath,
        estado: "running",
        iniciado_at: ahora,
        actualizado_at: ahora,
        resultados_por_asr: Object.fromEntries(
          genuinos.map((a) => [a.id, { estado: "corriendo" } satisfies AnalisisAsrEntry]),
        ),
        consolidacion: { estado: "pendiente" },
      };
      escribirAnalisisDoc(projectPath, doc);

      await Promise.all(
        genuinos.map(async (a) => {
          const resultado = await analyzeTacticForAsr(projectPath, synthesis, a);
          // Re-leer antes de pisar: otro ASR pudo haber escrito entre medio.
          const actual = leerAnalisisDoc(projectPath);
          if (!actual || actual.synthesis_path !== synthesisPath) return;
          actual.resultados_por_asr[a.id] = { estado: resultado.ok ? "ok" : "error", resultado };
          escribirAnalisisDoc(projectPath, actual);
        }),
      );

      const docFinal = leerAnalisisDoc(projectPath);
      if (!docFinal || docFinal.synthesis_path !== synthesisPath) return;
      try {
        await consolidarYSeguir(projectPath, docFinal, synthesis);
      } catch (err) {
        docFinal.consolidacion = {
          estado: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
      docFinal.estado = "done";
      escribirAnalisisDoc(projectPath, docFinal);
      console.log("[tácticas] run terminado (done)");
    } catch (err) {
      // Catastrófico (p.ej. sin permisos de escritura): queda registrado.
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[tácticas] run terminado con error global: ${msg}`);
      const doc = leerAnalisisDoc(projectPath);
      if (doc && doc.synthesis_path === synthesisPath) {
        doc.estado = "error";
        doc.error_global = msg;
        escribirAnalisisDoc(projectPath, doc);
      }
    } finally {
      runsActivos.delete(synthesisPath);
    }
  })();
  return { started: true };
}

/**
 * Reintento quirúrgico de UN ASR como trabajo de fondo (persistido igual).
 * Si termina OK y hay ≥2 recomendadas vivas, re-consolida automáticamente:
 * la recomendada nueva puede cambiar los conflictos.
 */
export async function ejecutarReintentoTactico(
  projectPath: string,
  synthesisPath: string,
  asrId: string,
  categoriaExplicita?: CategoriaTactica,
): Promise<{ started: boolean; motivo?: string }> {
  if (runsActivos.has(synthesisPath)) return { started: false, motivo: "ya_en_curso" };
  const synthesis = loadSynthesis(synthesisPath);
  if (!synthesis) return { started: false, motivo: "no_synthesis" };
  const asr = (synthesis.atributos_de_calidad_y_asrs ?? []).find((a) => a.id === asrId);
  if (!asr) return { started: false, motivo: "asr_inexistente" };

  runsActivos.add(synthesisPath);
  void (async () => {
    try {
      console.log(
        `[tácticas] reintento iniciado (${asrId}${categoriaExplicita ? `, categoría ${categoriaExplicita}` : ""})`,
      );
      const docExistente = leerAnalisisDoc(projectPath);
      const doc: AnalisisTacticasDoc =
        docExistente && docExistente.synthesis_path === synthesisPath
          ? docExistente
          : {
              synthesis_path: synthesisPath,
              estado: "running",
              iniciado_at: new Date().toISOString(),
              actualizado_at: new Date().toISOString(),
              resultados_por_asr: {},
              consolidacion: { estado: "pendiente" },
            };
      doc.estado = "running";
      doc.resultados_por_asr[asrId] = { estado: "corriendo" };
      escribirAnalisisDoc(projectPath, doc);

      const resultado = await analyzeTacticForAsr(projectPath, synthesis, asr, { categoriaExplicita });

      const actual = leerAnalisisDoc(projectPath);
      if (!actual || actual.synthesis_path !== synthesisPath) return;
      actual.resultados_por_asr[asrId] = { estado: resultado.ok ? "ok" : "error", resultado };

      const okVivos = Object.values(actual.resultados_por_asr).filter((e) => e.estado === "ok");
      if (resultado.ok && okVivos.length >= 1) {
        try {
          await consolidarYSeguir(projectPath, actual, synthesis);
        } catch (err) {
          actual.consolidacion = {
            estado: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      const hayCorriendo = Object.values(actual.resultados_por_asr).some((e) => e.estado === "corriendo");
      actual.estado = hayCorriendo ? "running" : "done";
      escribirAnalisisDoc(projectPath, actual);
    } catch (err) {
      const doc = leerAnalisisDoc(projectPath);
      if (doc && doc.synthesis_path === synthesisPath) {
        doc.resultados_por_asr[asrId] = {
          estado: "error",
          error: err instanceof Error ? err.message : String(err),
        };
        const hayCorriendo = Object.values(doc.resultados_por_asr).some((e) => e.estado === "corriendo");
        doc.estado = hayCorriendo ? "running" : "done";
        escribirAnalisisDoc(projectPath, doc);
      }
    } finally {
      runsActivos.delete(synthesisPath);
    }
  })();
  return { started: true };
}
