/**
 * Extracción tolerante de JSON desde texto mixto de LLM (módulo único).
 *
 * Los agentes narran: preámbulo en prosa, ecos de tool-call `{"id":...}`,
 * fences, texto posterior. El viejo `first-{ → last-}` concatenaba varios
 * objetos y producía basura imparsable (caso vivo: review con reverify
 * narrado + eco de tool-call + JSON). Estrategia: escanear TODOS los
 * candidatos con llaves balanceadas (una pasada, sin `for`/`while` por
 * regla LOOPS, respetando strings/escapes con stack de inicios) y preferir
 * el que parsea Y trae alguna de las `preferKeys` (ej. `verdict`,
 * `decision`); fallback al primer objeto que parsee. Puro, nunca lanza.
 */

/**
 * Extrae el mejor candidato a objeto JSON desde texto mixto.
 * Null cuando no hay ningún objeto parseable. Puro, nunca lanza.
 */
export function extractBalancedJSONObject(
  mixed: unknown,
  preferKeys?: readonly string[],
): string | null {
  try {
    if (!mixed || typeof mixed !== "string") return null;
    const s = mixed as string;
    const candidates: string[] = [];
    const starts: number[] = [];
    let inStr: string | null = null;
    let esc = false;
    s.split("").forEach((c, idx) => {
      if (inStr !== null) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === inStr) inStr = null;
        return;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        return;
      }
      if (c === "{") {
        starts.push(idx);
        return;
      }
      if (c === "}") {
        if (starts.length === 0) return;
        const from = starts.pop() as number;
        candidates.push(s.substring(from, idx + 1));
      }
    });
    const wants: readonly string[] = Array.isArray(preferKeys) ? preferKeys : [];
    let firstParseable: string | null = null;
    let preferred: string | null = null;
    candidates.forEach((cand) => {
      if (preferred !== null) return;
      try {
        const p = JSON.parse(cand) as unknown;
        if (p === null || typeof p !== "object" || Array.isArray(p)) return;
        if (firstParseable === null) firstParseable = cand;
        if (wants.length === 0) {
          preferred = cand;
          return;
        }
        const rec = p as Record<string, unknown>;
        if (wants.some((k) => typeof rec[k] === "string")) {
          preferred = cand;
        }
      } catch {
        // no parsea: sigue al siguiente candidato
      }
    });
    return preferred ?? firstParseable;
  } catch {
    return null;
  }
}

/**
 * Limpieza previa común: trim + strip de fences markdown (primero que
 * contenga algo, si no los marcadores sueltos). Puro, nunca lanza.
 */
export function stripJsonFences(raw: unknown): string {
  try {
    if (!raw || typeof raw !== "string") return "";
    let s = (raw as string).trim();
    if (s.length === 0) return "";
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence && fence[1]) {
      s = fence[1].trim();
    } else {
      s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    }
    return s;
  } catch {
    return "";
  }
}
