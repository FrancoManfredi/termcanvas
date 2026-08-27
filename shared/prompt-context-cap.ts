// El texto del brief/síntesis activos viaja INLINE dentro de --prompt del CLI,
// y en Windows la línea de comandos completa tiene un tope duro de 32.767
// caracteres: CreateProcess falla con error 206 ("Cannot create process") y
// el PTY ni arranca. Un documento de contexto grande (decenas de KB) supera
// ese tope por sí solo, así que cada sección se acota en la fuente IPC
// (interview-service) y la nota le dice al agente dónde leer el documento
// completo con sus herramientas.
export const PROMPT_CONTEXT_MAX_CHARS = 6_000;

export function capPromptContextText(
  text: string,
  sourcePath?: string | null,
): string {
  if (text.length <= PROMPT_CONTEXT_MAX_CHARS) return text;
  const cut = text.slice(0, PROMPT_CONTEXT_MAX_CHARS);
  const pointer = sourcePath
    ? `El documento completo está en: ${sourcePath}`
    : "El documento completo vive en .agents/interview/ dentro del repositorio.";
  return `${cut}\n\n[TEXTO TRUNCADO POR TermCanvas: la sección original tiene ${text.length} caracteres y el límite de línea de comandos de Windows no permite inyectarla completa en el prompt. ${pointer} — leélo con tu herramienta de lectura de archivos antes de decidir con base en este contexto.]`;
}
