// Contexto libre del repositorio en Markdown (lo escribe el usuario desde el
// modal de contexto): se inyecta en CADA prompt de orquestador (planning,
// resolve, fix, review, conflict) para que el agente conozca el propósito y
// las intenciones del repo. La escritura vive en repoContextStore; este módulo
// es la LECTURA compartida, para que todos los flujos usen la misma fuente y
// el mismo formato de sección.
export const REPO_CONTEXT_FILE = ".agents/repo-context.md";

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ");
}

/**
 * Lee el contexto del repositorio si existe. Es contenido opcional y libre:
 * si el archivo falta o no se puede leer, devuelve undefined y el prompt se
 * construye igual sin la sección.
 */
export async function readRepoContext(
  repoPath: string,
): Promise<string | undefined> {
  try {
    const read = await window.termcanvas.fs.readFile(
      `${repoPath.replace(/[\\/]+$/, "")}/${REPO_CONTEXT_FILE}`,
    );
    if (!("content" in read)) return undefined;
    const trimmed = read.content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sección "CONTEXTO DEL REPOSITORIO" para los prompts de orquestador.
 * Devuelve un array vacío cuando no hay contexto; el segmento va aplanado
 * (oneLine) porque opencode rompe --prompt con saltos de línea en Windows.
 */
export function buildRepoContextSection(
  repoContext: string | undefined,
): string[] {
  if (!repoContext || repoContext.trim().length === 0) return [];
  return [
    "CONTEXTO DEL REPOSITORIO (lo escribió el dueño del proyecto; es la intención, no el código):",
    oneLine(repoContext.trim()),
  ];
}