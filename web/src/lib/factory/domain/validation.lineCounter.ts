// validation.lineCounter — SRP: wrapper de yaml LineCounter para file+line real.
// Source: WarpFactories.md §7 · US-058 · PRD P1-01

import { LineCounter, parseDocument } from "yaml";

export interface YamlWithLines {
  readonly doc: ReturnType<typeof parseDocument>;
  readonly lineCounter: LineCounter;
}

// WeakMap para recuperar doc desde LineCounter sin cambiar firma spec (lc, path).
const docByCounter = new WeakMap<LineCounter, ReturnType<typeof parseDocument>>();

export function parseYamlWithLineCounter(raw: string): YamlWithLines {
  const lineCounter = new LineCounter();
  const doc = parseDocument(raw, { lineCounter });
  docByCounter.set(lineCounter, doc);
  return { doc, lineCounter };
}

/**
 * Mapea un Zod path (e.g. ["repositories",0,"owner"]) a {line,col} usando offsets del doc.
 * Requiere que `lc` haya sido creado via `parseYamlWithLineCounter(raw)`.
 * Fallback progresivo: intenta path completo, luego prefijos más cortos.
 */
export function lineForPath(
  lc: LineCounter,
  path: readonly (string | number)[],
): { line: number; col: number } | undefined {
  const doc = docByCounter.get(lc);
  if (!doc) return undefined;
  if (path.length === 0) return undefined;
  try {
    // Intenta path completo primero
    const attempts: (readonly (string | number)[])[] = [path];
    // También prefijos decrecientes para casos donde el issue apunta a un campo inexistente
    for (let len = path.length - 1; len >= 1; len -= 1) {
      attempts.push(path.slice(0, len));
    }
    for (const attempt of attempts) {
      let node: unknown = null;
      try {
        // getIn con true retorna Node en lugar de JS value
        node = (doc as unknown as { getIn: (p: unknown[], keepNode: boolean) => unknown }).getIn(
          attempt as unknown[],
          true,
        );
      } catch {
        continue;
      }
      if (node !== null && typeof node === "object") {
        const withRange = node as { range?: readonly number[] | null; key?: { range?: readonly number[] | null } };
        // Scalar / Map / Seq tienen range
        if (Array.isArray(withRange.range) && typeof withRange.range[0] === "number") {
          const pos = lc.linePos(withRange.range[0]);
          const line = pos.line === 0 ? 1 : pos.line;
          const col = pos.line === 0 ? pos.col + 1 : pos.col;
          return { line, col };
        }
        // Pair tiene key con range
        if (withRange.key && Array.isArray(withRange.key.range) && typeof withRange.key.range[0] === "number") {
          const pos = lc.linePos(withRange.key.range[0]);
          const line = pos.line === 0 ? 1 : pos.line;
          const col = pos.line === 0 ? pos.col + 1 : pos.col;
          return { line, col };
        }
      }
    }
    // Fallback: buscar directamente offset de la clave última en el texto via documentos CST
    // No disponible sin recomputar; retornar undefined para que caller use findLineForPath
    return undefined;
  } catch {
    return undefined;
  }
}
