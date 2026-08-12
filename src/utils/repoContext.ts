// Contexto libre del repositorio en Markdown (lo escribe el usuario desde el
// modal de contexto): se referencia en CADA prompt de orquestador (planning,
// resolve, fix, review, conflict) para que el agente conozca el propósito y
// las intenciones del repo. La escritura vive en repoContextStore; este módulo
// es la referencia compartida, para que todos los flujos apunten al mismo
// archivo con el mismo formato de sección.
export const REPO_CONTEXT_FILE = ".agents/repo-context.md";

/**
 * Sección "CONTEXTO DEL REPOSITORIO" para los prompts de orquestador.
 *
 * La sección solo dice DÓNDE está el archivo: el agente lo lee él mismo con
 * su tool de lectura desde el worktree donde trabaja. El contenido no se
 * inyecta inline porque los prompts de orquestador se arman con datos
 * prefetch deterministas (ver repoContextStore) y el cuerpo libre del repo se
 * lee mejor en contexto, con su formateo Markdown original.
 *
 * Devuelve un array vacío cuando no hay ruta; el segmento va aplanado
 * (oneLine) porque opencode rompe --prompt con saltos de línea en Windows.
 */
export function buildRepoContextSection(repoPath: string | undefined): string[] {
  if (!repoPath || repoPath.trim().length === 0) return [];
  const contextFile = `${repoPath.replace(/[\\/]+$/, "")}/${REPO_CONTEXT_FILE}`;
  return [
    "CONTEXTO DEL REPOSITORIO (lo escribió el dueño del proyecto; es la intención, no el código): leé el archivo",
    `${contextFile} antes de empezar, con tu herramienta de lectura (está en el worktree o en el repo del proyecto). Si el archivo no existe o no se puede leer, seguí sin contexto.`,
  ];
}