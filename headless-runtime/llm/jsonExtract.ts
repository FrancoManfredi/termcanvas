/**
 * Extracción tolerante de JSON desde texto mixto de LLM (módulo único).
 *
 * Los agentes narran: preámbulo en prosa, ecos de tool-call `{"id":...}`,
 * fences, texto posterior. El viejo `first-{ → last-}` concatenaba varios
 * objetos y producía basura imparsable (caso vivo: review con reverify
 * narrado + eco de tool-call + JSON). Estrategia: escanear TODOS los
 * candidatos con llaves balanceadas (una pasada, sin `for`/`while` por
 * regla LOOPS, respetando strings/escapes con stack de inicios) y preferir
 * el objeto que trae alguna de las `preferKeys` por PRESENCIA de clave
 * (`green` booleano y `findings` array matchean, no solo strings). Entre
 * varios candidatos gana el top-level más externo y último: en un JSON
 * anidado el objeto interno cierra primero, y esa era la bomba (el review
 * `{"green":true,"findings":[...,"reverify":{...}]}` devolvía el
 * `reverify` y la validación pedía `green`). Sin match: último top-level
 * parseable (la respuesta va al final); sin ningún top-level, el primer
 * parseable (compat). Puro, nunca lanza.
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
    const spans: Array<{ start: number; end: number }> = [];
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
        spans.push({ start: from, end: idx + 1 });
      }
    });
    interface ParsedCandidate {
      start: number;
      end: number;
      text: string;
      record: Record<string, unknown>;
    }
    const parsed: ParsedCandidate[] = spans
      .map((span): ParsedCandidate | null => {
        const text = s.substring(span.start, span.end);
        try {
          const value = JSON.parse(text) as unknown;
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            return null;
          }
          return { ...span, text, record: value as Record<string, unknown> };
        } catch {
          return null;
        }
      })
      .filter((cand): cand is ParsedCandidate => cand !== null)
      .sort((a, b) => a.start - b.start);
    if (parsed.length === 0) return null;
    const isTopLevel = (cand: ParsedCandidate): boolean =>
      !parsed.some(
        (other) =>
          other !== cand && other.start <= cand.start && cand.end <= other.end,
      );
    const wants: readonly string[] = Array.isArray(preferKeys) ? preferKeys : [];
    if (wants.length > 0) {
      const matches = parsed.filter((cand) =>
        wants.some((key) => typeof key === "string" && key in cand.record),
      );
      if (matches.length > 0) {
        const topMatches = matches.filter(isTopLevel);
        const pool = topMatches.length > 0 ? topMatches : matches;
        return pool[pool.length - 1].text;
      }
    }
    const top = parsed.filter(isTopLevel);
    if (top.length > 0) return top[top.length - 1].text;
    return parsed[0].text;
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
