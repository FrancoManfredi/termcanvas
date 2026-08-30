// validation.lineCounter — SRP: wrapper de yaml LineCounter para file+line real.
// Source: WarpFactories.md §7 · US-058 · PRD P1-01

import { LineCounter, parseDocument } from "yaml";

export interface YamlWithLines {
  readonly doc: ReturnType<typeof parseDocument>;
  readonly lineCounter: LineCounter;
}

// WeakMap para recuperar doc desde LineCounter sin cambiar firma spec (lc, path).
const docByCounter = new WeakMap<LineCounter, ReturnType<typeof parseDocument>>();
const offsetByCounter = new WeakMap<LineCounter, number>();

export function parseYamlWithLineCounter(raw: string): YamlWithLines {
  const lineCounter = new LineCounter();
  const doc = parseDocument(raw, { lineCounter });
  docByCounter.set(lineCounter, doc);
  offsetByCounter.set(lineCounter, 0);
  return { doc, lineCounter };
}

/**
 * Parsea solo el bloque frontmatter YAML (entre --- delimiters) con LineCounter.
 * Para agent.md / automation.md / scorer.md / skill SKILL.md.
 * offset = línea del file donde empieza el YAML (1 = opening ---), por lo que yaml line 1 => file line 2.
 * Fallback: si no hay frontmatter, parsea raw completo con offset 0.
 */
export function parseFrontmatterWithLineCounter(raw: string): YamlWithLines {
  const normalized = raw.replace(/\r\n/g, "\n");
  const trimmedStart = normalized.trimStart();
  // Calcular leading lines antes del primer ---
  const before = normalized.slice(0, normalized.length - trimmedStart.length);
  const leadingLines = before ? before.split("\n").length - 1 : 0;

  if (!trimmedStart.startsWith("---")) {
    // No frontmatter, treat as plain yaml
    const lineCounter = new LineCounter();
    const doc = parseDocument(raw, { lineCounter });
    docByCounter.set(lineCounter, doc);
    offsetByCounter.set(lineCounter, 0);
    return { doc, lineCounter };
  }

  const firstDelimEnd = trimmedStart.indexOf("\n");
  if (firstDelimEnd === -1) {
    const lineCounter = new LineCounter();
    const doc = parseDocument("", { lineCounter });
    docByCounter.set(lineCounter, doc);
    offsetByCounter.set(lineCounter, leadingLines + 1);
    return { doc, lineCounter };
  }

  const afterFirst = trimmedStart.slice(firstDelimEnd + 1);
  const match = afterFirst.match(/^---\s*$/m);

  let yamlContent: string;
  if (!match || match.index === undefined) {
    // Sin cierre, tomar todo afterFirst
    yamlContent = afterFirst;
  } else {
    yamlContent = afterFirst.slice(0, match.index);
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(yamlContent, { lineCounter });
  docByCounter.set(lineCounter, doc);
  // yamlContent line 1 corresponde a file line leadingLines + 2 (después de opening ---)
  offsetByCounter.set(lineCounter, leadingLines + 1);
  return { doc, lineCounter };
}

/**
 * Mapea un Zod path (e.g. ["repositories",0,"owner"]) a {line,col} usando offsets del doc.
 * Requiere que `lc` haya sido creado via `parseYamlWithLineCounter(raw)` o `parseFrontmatterWithLineCounter(raw)`.
 * Fallback progresivo: intenta path completo, luego prefijos más cortos.
 * Prioridad: para keys de mapa, retorna línea del key (no del value), para evitar off-by-one en colecciones.
 */
export function lineForPath(
  lc: LineCounter,
  path: readonly (string | number)[],
): { line: number; col: number } | undefined {
  const doc = docByCounter.get(lc);
  if (!doc) return undefined;
  if (path.length === 0) return undefined;
  const offset = offsetByCounter.get(lc) ?? 0;
  try {
    const attempts: (readonly (string | number)[])[] = [path];
    for (let len = path.length - 1; len >= 1; len -= 1) {
      attempts.push(path.slice(0, len));
    }
    for (const attempt of attempts) {
      // Primero intenta resolver como Pair key (para mapas) — busca el key exacto en el parent map.
      const last = attempt[attempt.length - 1];
      if (typeof last === "string") {
        const parentPath = attempt.slice(0, -1);
        try {
          let parentNode: unknown = null;
          if (parentPath.length === 0) {
            parentNode = (doc as unknown as { contents: unknown }).contents;
          } else {
            parentNode = (doc as unknown as { getIn: (p: unknown[], keepNode: boolean) => unknown }).getIn(
              parentPath as unknown[],
              true,
            );
          }
          if (parentNode && typeof parentNode === "object" && "items" in (parentNode as Record<string, unknown>)) {
            const items = (parentNode as { items: unknown[] }).items;
            for (const item of items) {
              const pair = item as { key?: { value?: unknown; range?: readonly number[] | null }; range?: readonly number[] | null };
              const keyNode = pair.key as unknown as { value?: unknown; range?: readonly number[] | null } | undefined;
              let keyStr: string | undefined;
              if (keyNode && typeof keyNode === "object" && "value" in (keyNode as Record<string, unknown>)) {
                const v = (keyNode as { value: unknown }).value;
                if (typeof v === "string") keyStr = v;
                else if (v !== undefined) keyStr = String(v);
              } else if (typeof keyNode === "string") {
                keyStr = keyNode;
              }
              // fallback: if pair has range but key is scalar string, try string comparison via range text? Use simple equality
              if (keyStr === String(last)) {
                const r = keyNode?.range;
                if (Array.isArray(r) && typeof r[0] === "number") {
                  const pos = lc.linePos(r[0]);
                  const line = pos.line === 0 ? 1 : pos.line;
                  const col = pos.line === 0 ? pos.col + 1 : pos.col;
                  return { line: line + offset, col };
                }
              }
            }
          }
        } catch {
          // ignore and continue to generic getIn
        }
      }
      // Intento genérico via getIn para valores escalares o índices de array
      let node: unknown = null;
      try {
        node = (doc as unknown as { getIn: (p: unknown[], keepNode: boolean) => unknown }).getIn(
          attempt as unknown[],
          true,
        );
      } catch {
        continue;
      }
      if (node !== null && typeof node === "object") {
        const withRange = node as { range?: readonly number[] | null; key?: { range?: readonly number[] | null } };
        if (Array.isArray(withRange.range) && typeof withRange.range[0] === "number") {
          const pos = lc.linePos(withRange.range[0]);
          const line = pos.line === 0 ? 1 : pos.line;
          const col = pos.line === 0 ? pos.col + 1 : pos.col;
          return { line: line + offset, col };
        }
        if (withRange.key && Array.isArray(withRange.key.range) && typeof withRange.key.range[0] === "number") {
          const pos = lc.linePos(withRange.key.range[0]);
          const line = pos.line === 0 ? 1 : pos.line;
          const col = pos.line === 0 ? pos.col + 1 : pos.col;
          return { line: line + offset, col };
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Helper para frontmatter: mapea una key top-level del frontmatter a {line,col}.
 * Es wrapper sobre lineForPath con offset ya aplicado.
 */
export function lineForFrontmatterKey(
  lc: LineCounter,
  key: string,
): { line: number; col: number } | undefined {
  return lineForPath(lc, [key]);
}
