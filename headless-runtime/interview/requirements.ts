// Síntesis de la entrevista de requerimientos (planilla de salida) como
// contexto de los prompts de orquestador.
//
// La entrevista de requerimientos produce, al finalizar, una planilla con
// RFs, ASRs, restricciones y glosario en
// <proyecto>/.agents/interview/requerimientos/entrevista-<ts>-sintesis.json.
// Esa planilla condiciona las decisiones técnicas de los agentes, así que
// los prompts la inyectan INLINE (el agente no lee archivos).
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
  type InterviewLedger,
} from "./engine.ts";
import { SynthesisSchema, type SynthesisResult } from "./schema.ts";

// Marcador de la síntesis activa: vive junto a las síntesis, mismo patrón
// que contexto-activo.json en la subcarpeta de contexto.
const ACTIVE_REQUIREMENTS_FILE = "requerimientos-activo.json";

export function activeRequirementsPath(projectPath: string): string {
  return path.join(requirementsDir(projectPath), ACTIVE_REQUIREMENTS_FILE);
}

// Carga una síntesis desde disco. Best-effort: JSON inválido o fuera de
// schema devuelve null (el caller degrada a "sin síntesis", nunca rompe).
export function loadSynthesis(synthesisPath: string): SynthesisResult | null {
  if (!fs.existsSync(synthesisPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(synthesisPath, "utf-8")) as unknown;
    const parsed = SynthesisSchema.safeParse(raw);
    return parsed.success ? parsed.data : (raw as SynthesisResult);
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
): string {
  const rf = (synthesis.requerimientos_funcionales ?? []).map((r) =>
    [
      `### ${r.id} [${r.prioridad}]`,
      r.descripcion || "(sin descripcion)",
      `- Justificación: ${r.justificacion || "(sin especificar)"}`,
      `- Criterio de ajuste: ${r.criterio_de_ajuste || "(sin especificar)"}`,
      `- Origen: ${r.origen || "(sin origen)"}`,
    ].join("\n"),
  ).join("\n\n") || "(ninguno)";

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
): RequirementsForPrompt | null {
  const activa = getActiveRequirements(projectPath);
  if (activa) {
    return {
      text: formatRequirementsForPrompt(activa.synthesis, activa.path, false),
      sourcePath: activa.path,
      isFallback: false,
    };
  }
  const latest = findLatestSynthesis(projectPath);
  if (!latest) return null;
  return {
    text: formatRequirementsForPrompt(latest.synthesis, latest.path, true),
    sourcePath: latest.path,
    isFallback: true,
  };
}

// Re-export para compatibilidad con el import de entrevista.
export type { InterviewLedger };
