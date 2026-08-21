// Síntesis de la entrevista de requerimientos (planilla de salida) como
// contexto de los prompts de orquestador.
//
// La entrevista de requerimientos produce, al finalizar, una planilla con
// historias de usuario, RFs, ASRs, restricciones y glosario en
// <proyecto>/.agents/interview/requerimientos/entrevista-<ts>-sintesis.json.
// Las historias de usuario son el artefacto de producto PRIMARIO (roles del
// brief) y los RFs las formalizan (cada RF lleva historia_origen) — misma
// cadena de razonamiento, sin deriva silenciosa. Esa planilla condiciona las
// decisiones técnicas de los agentes, así que los prompts la inyectan INLINE
// (el agente no lee archivos).
//
// El selector de "síntesis activa" replica el patrón del brief
// (contexto-activo.json): el dueño elige explícitamente qué síntesis manda a
// los prompts; sin marcador, cae a la más reciente; sin ninguna, "" (el
// prompt corre sin sección).

import fs from "node:fs";
import path from "node:path";
import {
  ensureInterviewLayout,
  requirementsDir,
  promptStructured,
  ensureClient,
  loadLedger,
  saveLedger,
  SYNTHESIS_TIMEOUT_MS,
  phaseModelRef,
  type InterviewLedger,
} from "./engine.ts";
import {
  SynthesisSchema,
  BackfillStoriesOutputSchema,
  BACKFILL_STORIES_SCHEMA,
  type SynthesisResult,
  type UserStory,
  type BackfillStoriesOutput,
} from "./schema.ts";
import {
  getActiveBrief,
  findLatestBriefDocument,
  formatBriefForPrompt,
} from "./brief.ts";

// Marcador de la síntesis activa: vive junto a las síntesis, mismo patrón
// que contexto-activo.json en la subcarpeta de contexto.
const ACTIVE_REQUIREMENTS_FILE = "requerimientos-activo.json";

export function activeRequirementsPath(projectPath: string): string {
  return path.join(requirementsDir(projectPath), ACTIVE_REQUIREMENTS_FILE);
}

// Normaliza una síntesis al contrato N:N actual: los RFs del contrato 1:N
// viejo traen "historia_origen" (string) — se deriva "historias_origen"
// (array) cuando está vacío para que el resto del sistema lea un solo campo.
export function normalizeSynthesis(syn: SynthesisResult): SynthesisResult {
  return {
    ...syn,
    requerimientos_funcionales: (syn.requerimientos_funcionales ?? []).map((r) => {
      const historias = (r.historias_origen ?? []).length
        ? r.historias_origen
        : r.historia_origen && r.historia_origen !== "(sin historia)"
          ? [r.historia_origen]
          : [];
      return { ...r, historias_origen: historias };
    }),
  };
}

// Carga una síntesis desde disco. Best-effort: JSON inválido o fuera de
// schema devuelve null (el caller degrada a "sin síntesis", nunca rompe).
export function loadSynthesis(synthesisPath: string): SynthesisResult | null {
  if (!fs.existsSync(synthesisPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(synthesisPath, "utf-8")) as unknown;
    const parsed = SynthesisSchema.safeParse(raw);
    return normalizeSynthesis(parsed.success ? parsed.data : (raw as SynthesisResult));
  } catch {
    return null;
  }
}

// TODAS las síntesis del proyecto, de más antigua a más reciente
// (entrevista-<ts>-sintesis.json en la subcarpeta de requerimientos).
export function listSynthesis(
  projectPath: string,
): { synthesis: SynthesisResult; path: string; timestamp: number }[] {
  ensureInterviewLayout(projectPath);
  const dir = requirementsDir(projectPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^entrevista-(\d+)-sintesis\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => {
      const path_ = path.join(dir, m[0]);
      return {
        synthesis: loadSynthesis(path_) ?? ({} as SynthesisResult),
        path: path_,
        timestamp: Number(m[1]),
      };
    })
    .filter((s) => s.synthesis && typeof s.synthesis === "object");
}

// La síntesis más reciente del proyecto, o null si no hay ninguna.
export function findLatestSynthesis(
  projectPath: string,
): { synthesis: SynthesisResult; path: string; timestamp: number } | null {
  const all = listSynthesis(projectPath);
  return all.length > 0 ? all[all.length - 1] : null;
}

// Marca la síntesis que el dueño eligió como la vigente para los prompts.
export function setActiveRequirements(projectPath: string, synthesisPath: string): void {
  const dir = requirementsDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    activeRequirementsPath(projectPath),
    JSON.stringify({ path: synthesisPath, at: new Date().toISOString() }, null, 2),
  );
}

// La síntesis activa si el marcador sigue apuntando a un archivo existente.
export function getActiveRequirements(
  projectPath: string,
): { synthesis: SynthesisResult; path: string; timestamp: number } | null {
  ensureInterviewLayout(projectPath);
  const marker = activeRequirementsPath(projectPath);
  if (!fs.existsSync(marker)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, "utf-8")) as { path?: string };
    if (typeof parsed.path !== "string" || !fs.existsSync(parsed.path)) return null;
    const synthesis = loadSynthesis(parsed.path);
    if (!synthesis) return null;
    const m = /^entrevista-(\d+)-sintesis\.json$/.exec(path.basename(parsed.path));
    return { synthesis, path: parsed.path, timestamp: m ? Number(m[1]) : Date.now() };
  } catch {
    return null;
  }
}

// ─── Formateo para los prompts de orquestador ─────────────────────────────
// Texto compacto y OBLIGATORIO: RFs con prioridad, ASRs con su impacto
// estructural, restricciones y glosario. La primera línea es la procedencia
// (activa vs fallback) para que el agente la repita en su resumen final y la
// trazabilidad del fallback quede en el log de la sesión.

export interface RequirementsForPrompt {
  text: string;
  sourcePath: string;
  isFallback: boolean;
}

// Opciones de formato para los prompts de orquestador. Por defecto (sin
// opciones) se emite el formato COMPACTO — RFs/ASRs/restricciones/glosario,
// byte idéntico al histórico: RESOLVE/FIX/REVIEW/CONFLICT lo usan así y no
// pagan el costo de las historias. Solo PLANNING pasa includeStories:true
// (los issues que redacta los leen humanos y otros agentes en GitHub, y la
// narrativa de la historia comunica mejor el "por qué").
export interface RequirementsFormatOptions {
  includeStories?: boolean;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "(fecha desconocida)";
  }
}

// Formatea la síntesis como sección inyectable. "fallback" indica que la
// selección no fue explícita (cayó a la más reciente) — el prompt lo marca
// para que el agente lo repita y se note en el log.
//
// Se incluyen TODOS los campos de cada ítem, no solo un resumen: la
// justificación, el criterio de ajuste, el escenario técnico completo del
// ASR (6 partes), los trade-offs y el impacto de cada restricción son los
// datos que realmente definen la decisión técnica.
export function formatRequirementsForPrompt(
  synthesis: SynthesisResult,
  sourcePath: string,
  isFallback: boolean,
  opts?: RequirementsFormatOptions,
): string {
  const includeStories = opts?.includeStories === true;

  const historias = includeStories
    ? (synthesis.historias_de_usuario ?? []).map((h) =>
        [
          `### ${h.id} [${h.prioridad}]`,
          `Como ${h.rol}, quiero ${h.quiero}, para ${h.para}.`,
          `- Título: ${h.titulo || "(sin titulo)"}`,
          ...(h.criterios_de_aceptacion.length > 0
            ? [`- Criterios de aceptación:`, ...h.criterios_de_aceptacion.map((c) => `  - ${c}`)]
            : []),
          `- Origen: ${h.origen || "(sin origen)"}`,
        ].join("\n"),
      ).join("\n\n")
    : "";

  const rf = (synthesis.requerimientos_funcionales ?? []).map((r) => {
    const hs = (r.historias_origen ?? []).filter((id) => id && id !== "(sin historia)");
    return [
      `### ${r.id} [${r.prioridad}]`,
      r.descripcion || "(sin descripcion)",
      `- Justificación: ${r.justificacion || "(sin especificar)"}`,
      `- Criterio de ajuste: ${r.criterio_de_ajuste || "(sin especificar)"}`,
      `- Origen: ${r.origen || "(sin origen)"}`,
      ...(includeStories && hs.length > 0 ? [`- Formaliza las historias: ${hs.join(", ")}`] : []),
    ].join("\n");
  }).join("\n\n") || "(ninguno)";

  const asr = (synthesis.atributos_de_calidad_y_asrs ?? []).map((a) => {
    const esc = a.escenario_tecnico_6_partes ?? {};
    return [
      `### ${a.id} — ${a.atributo} (${a.es_asr_genuino === true ? "ASR GENUINO" : "no genuino"})`,
      a.justificacion_arquitectonica || "(sin especificar)",
      `- Escenario técnico:`,
      `  - Fuente: ${esc.fuente || "(sin especificar)"}`,
      `  - Estímulo: ${esc.estimulo || "(sin especificar)"}`,
      `  - Artefacto: ${esc.artefacto || "(sin especificar)"}`,
      `  - Entorno: ${esc.entorno || "(sin especificar)"}`,
      `  - Respuesta: ${esc.respuesta || "(sin especificar)"}`,
      `  - Medida de respuesta: ${esc.medida_de_respuesta || "(sin especificar)"}`,
      `- Trade-offs identificados: ${a.trade_offs_identificados || "(sin especificar)"}`,
      `- Origen: ${a.origen || "(sin origen)"}`,
    ].join("\n");
  }).join("\n\n") || "(ninguno)";

  const con = (synthesis.restricciones_globales ?? []).map((c) =>
    [
      `### ${c.id} — ${c.tipo}`,
      c.descripcion || "(sin descripcion)",
      `- Impacto en el diseño: ${c.impacto || "(sin especificar)"}`,
    ].join("\n"),
  ).join("\n\n") || "(ninguna)";

  const glosario = Object.entries(synthesis.glosario_de_terminos ?? {})
    .map(([termino, def]) => `- ${termino}: ${def}`)
    .join("\n") || "(sin términos)";

  const m = /^entrevista-(\d+)-sintesis\.json$/.exec(path.basename(sourcePath));
  const fecha = m ? formatDate(Number(m[1])) : "(fecha desconocida)";
  const nombre = path.basename(sourcePath);

  return [
    `Síntesis de requerimientos usada: ${nombre} (${fecha}) — ${isFallback ? "FALLBACK: más reciente (sin selección activa)" : "selección activa del dueño"}.`,
    "",
    ...(includeStories && historias
      ? [
          `HISTORIAS DE USUARIO (contexto de producto: el por qué detrás de los requerimientos):`,
          historias,
          "",
        ]
      : []),
    `REQUERIMIENTOS FUNCIONALES:`,
    rf,
    "",
    `ATRIBUTOS DE CALIDAD Y ASR (obligan decisiones estructurales):`,
    asr,
    "",
    `RESTRICCIONES GLOBALES:`,
    con,
    "",
    `GLOSARIO:`,
    glosario,
  ].join("\n");
}

// Resuelve el texto a inyectar en los prompts de orquestador:
//   activa -> fallback a la más reciente -> "" (sin sección).
// Devuelve también la procedencia para que la sección diga qué se usó.
export function resolveRequirementsForPrompt(
  projectPath: string,
  opts?: RequirementsFormatOptions,
): RequirementsForPrompt | null {
  const activa = getActiveRequirements(projectPath);
  if (activa) {
    return {
      text: formatRequirementsForPrompt(activa.synthesis, activa.path, false, opts),
      sourcePath: activa.path,
      isFallback: false,
    };
  }
  const latest = findLatestSynthesis(projectPath);
  if (!latest) return null;
  return {
    text: formatRequirementsForPrompt(latest.synthesis, latest.path, true, opts),
    sourcePath: latest.path,
    isFallback: true,
  };
}

// ─── Migración de síntesis legacy (derivar historias de RFs existentes) ──
// Las síntesis generadas ANTES del contrato con historias no las tienen. Esta
// función las deriva en UNA llamada (calidad de derivación, no estructural:
// la consistencia garantizada solo existe en la generación original) y
// REESCRIBE el JSON únicamente tras validar el documento completo en memoria
// — ningún fallo toca el archivo original.

export type BackfillStoriesResult =
  | { ok: true; synthesis: SynthesisResult }
  | {
      ok: false;
      reason: "no_synthesis" | "already_migrated" | "generation_failed";
      error: string;
    };

export async function backfillStoriesForSynthesis(
  projectPath: string,
  synthesisPath: string,
): Promise<BackfillStoriesResult> {
  const synthesis = loadSynthesis(synthesisPath);
  if (!synthesis) {
    return { ok: false, reason: "no_synthesis", error: "La síntesis no existe o no es válida." };
  }
  if ((synthesis.historias_de_usuario?.length ?? 0) > 0) {
    // Ya migrada (p.ej. en una sesión anterior): la UI lee la síntesis del
    // LEDGER y las migraciones viejas solo escribían el JSON standalone — el
    // ledger quedó sin historias. Se sincroniza (reparación idempotente) y se
    // devuelve ok para que la UI muestre las historias sin repetir la llamada.
    try {
      syncSynthesisToLedger(synthesisPath, synthesis);
    } catch {
      // Best-effort: la reparación del ledger no debe romper el flujo.
    }
    return { ok: true, synthesis };
  }

  const contexto = getActiveBrief(projectPath) ?? findLatestBriefDocument(projectPath);
  const briefText = contexto ? formatBriefForPrompt(contexto.brief) : "(sin brief de contexto)";
  const rfText = formatRequirementsForPrompt(synthesis, synthesisPath, false);

  const prompt = `Sos un Analista de Producto Senior. Esta síntesis de requerimientos es LEGACY: no tiene historias de usuario. Derivá historias de usuario de los REQUERIMIENTOS FUNCIONALES existentes y del contexto del negocio.

REGLA: cada historia debe formalizar UN requerimiento funcional (campo rf_origen con su id exacto, ej: "RF-001"). No inventes funcionalidad que no esté respaldada por un RF. El rol sale del contexto del negocio (usuarios objetivo / stakeholders). Usá "epic" como rf_origen SOLO para historias transversales que no correspondan a un RF puntual (máximo una o dos).

Contexto del negocio:
${briefText}

${rfText}

Completá TODOS los campos de cada historia.`;

  // El motor reusa una sesión de opencode por llamada (promptStructured toma
  // el session_id del ledger). La migración no tiene ledger propio: se crea
  // una sesión REAL acá (mismo patrón que startBriefInterview). NO se pasa
  // session_id vacío: el SDK arma "POST /session/{sessionID}/message" y un id
  // vacío produce "/session//message" — el server responde una página HTML y
  // el SDK falla con "Request is not supported by this version of OpenCode
  // Server (Server responded with text/html)".
  const client = await ensureClient();
  const sesion = await client.session.create({
    title: "Migración de historias (legacy)",
    directory: projectPath,
  });
  if (sesion.error || !sesion.data) {
    return {
      ok: false,
      reason: "generation_failed",
      error: `No se pudo crear la sesión de migración: ${JSON.stringify(sesion.error)}`,
    };
  }
  const fakeLedger = { session_id: sesion.data.id, project_path: projectPath } as unknown as InterviewLedger;
  let data: BackfillStoriesOutput;
  try {
    const res = await promptStructured(
      fakeLedger,
      BACKFILL_STORIES_SCHEMA,
      prompt,
      (v): v is { historias: UserStory[] } => {
        const parsed = BackfillStoriesOutputSchema.safeParse(v);
        return parsed.success && parsed.data.historias.length > 0;
      },
      "Migración de historias",
      SYNTHESIS_TIMEOUT_MS,
      // Llamada grande como la síntesis: comparte la fase "synthesis" (mismo
      // default heavy y el mismo override del usuario si existiera).
      phaseModelRef("synthesis"),
      "synthesis",
    );
    data = BackfillStoriesOutputSchema.parse(res.data);
  } catch (err) {
    return {
      ok: false,
      reason: "generation_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Best-effort: libera la sesión de migración; nunca bloquea el resultado
    // (mismo criterio que cleanupInterview).
    try {
      await client.session.delete({ sessionID: fakeLedger.session_id });
    } catch {
      // Sesión huérfana tolerable.
    }
  }

  // Arma el documento nuevo COMPLETO en memoria, valida con el schema y
  // recién ahí escribe. El archivo original queda intacto ante cualquier
  // fallo de validación.
  const porRf = new Map<string, string>();
  for (const h of data.historias) {
    if (h.rf_origen && h.rf_origen !== "epic") porRf.set(h.rf_origen, h.id);
  }
  const next: SynthesisResult = {
    ...synthesis,
    historias_de_usuario: data.historias,
    historias_backfilled: true,
    requerimientos_funcionales: (synthesis.requerimientos_funcionales ?? []).map((r) => {
      const hs = porRf.get(r.id);
      return { ...r, historias_origen: hs ? [hs] : [] };
    }),
  };
  const parsed = SynthesisSchema.safeParse(next);
  if (!parsed.success) {
    return { ok: false, reason: "generation_failed", error: "El documento migrado no validó el contrato." };
  }
  // Escribe AMBAS fuentes de verdad: el ledger (de donde lee la UI) y el JSON
  // standalone (de donde leen los prompts de orquestador). El ledger se
  // sincroniza ANTES de escribir el standalone para no quedar a medias.
  syncSynthesisToLedger(synthesisPath, parsed.data);
  fs.writeFileSync(synthesisPath, JSON.stringify(parsed.data, null, 2));
  return { ok: true, synthesis: parsed.data };
}

// Mantiene el ledger al día con la síntesis (la UI lee ledger.synthesis.data,
// los prompts leen el JSON standalone — ambos deben quedar iguales).
function syncSynthesisToLedger(synthesisPath: string, data: SynthesisResult): void {
  const ledgerPath = synthesisPath.replace(/-sintesis\.json$/, ".json");
  const ledger = loadLedger(ledgerPath);
  ledger.synthesis = { at: new Date().toISOString(), data };
  saveLedger(ledgerPath, ledger);
}

// Re-export para compatibilidad con el import de entrevista.
export type { InterviewLedger };
