// Contexto activo del repositorio para los prompts de orquestador (planning,
// resolve, fix, review, conflict). Dos fuentes de verdad, ambas relevadas
// con entrevistas (Fase 0) y ambas inyectadas INLINE (el agente no lee
// archivos):
//   - El documento del brief activo (contexto-<ts>-documento.json que
//     referencia contexto-activo.json): la intención del negocio.
//   - La síntesis de requerimientos activa (entrevista-<ts>-sintesis.json que
//     referencia requerimientos-activo.json): RFs, ASRs, restricciones y
//     glosario que OBLIGAN decisiones técnicas.
// El texto lo formatea el motor y viaja por IPC desde el proceso principal;
// este módulo los convierte en secciones markdown que van inline en cada
// prompt, con jerarquía visual real (los prompts de orquestador ya no se
// aplastan a una sola línea).

/**
 * Resuelve el texto del contexto activo vía IPC (proceso principal, donde el
 * motor puede leer node:fs). Best-effort: sin bridge o con error devuelve ""
 * y el prompt corre sin sección de contexto.
 */
export async function resolveRepoContextText(
  repoPath: string | undefined,
): Promise<string> {
  if (!repoPath || repoPath.trim().length === 0) return "";
  try {
    return await window.termcanvas?.interview?.activeBriefText(repoPath);
  } catch {
    return "";
  }
}

/**
 * Resuelve el texto de la síntesis de requerimientos ACTIVA (o fallback a la
 * más reciente) vía IPC. Best-effort: sin bridge, sin síntesis o con error
 * devuelve "" y el prompt corre sin la sección de requerimientos.
 */
export async function resolveRequirementsText(
  repoPath: string | undefined,
): Promise<string> {
  if (!repoPath || repoPath.trim().length === 0) return "";
  try {
    return await window.termcanvas?.interview?.activeRequirementsText(repoPath);
  } catch {
    return "";
  }
}

/**
 * Sección "CONTEXTO DEL REPOSITORIO" para los prompts de orquestador.
 *
 * El texto del brief activo se inyecta INLINE (el agente no lee ningún
 * archivo), con su formato multilínea original: la jerarquía visual de la
 * entrevista se preserva en el prompt.
 *
 * Devuelve un array vacío cuando no hay texto; el prompt corre sin sección.
 */
export function buildRepoContextSection(
  repoContextText: string | undefined,
): string[] {
  const text = (repoContextText ?? "").trim();
  if (text.length === 0) return [];
  return [
    "## CONTEXTO DEL REPOSITORIO",
    "",
    "Texto relevado con la entrevista de contexto (lo escribió el dueño del proyecto; es la intención, no el código):",
    "",
    text,
  ];
}

/**
 * Sección "REQUERIMIENTOS RELEVADOS" para los prompts de orquestador.
 *
 * El texto de la síntesis de requerimientos activa (RFs, ASRs, restricciones,
 * glosario) se inyecta INLINE. Los ASRs y restricciones OBLIGAN decisiones
 * técnicas, así que la sección lo dice explícito, y el agente repite en su
 * resumen final qué síntesis usó (la primera línea del texto trae la
 * procedencia: activa o fallback) para que quede trazable en el log.
 *
 * Devuelve un array vacío cuando no hay texto; el prompt corre sin sección.
 */
export function buildRequirementsSection(
  requirementsText: string | undefined,
): string[] {
  const text = (requirementsText ?? "").trim();
  if (text.length === 0) return [];
  return [
    "## REQUERIMIENTOS RELEVADOS (OBLIGATORIOS: tus decisiones técnicas deben respetarlos)",
    "",
    text,
    "",
    'Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada: <archivo>" que figura arriba (con su fecha).',
  ];
}
