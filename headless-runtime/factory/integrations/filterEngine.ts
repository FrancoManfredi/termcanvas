/**
 * integrations/filterEngine — F1 live seam: pure AND/OR/NOT intake matcher.
 *
 * Zero I/O, zero network, zero secrets: `event x filter -> boolean` plus a
 * single-line auditable `explain` string. Every export is total (never
 * throws); malformed filters fail closed to `false`. Tested 100% offline in
 * `tests/integrations-filter-engine.test.ts`. ESM only.
 *
 * Field projection (filter field -> intake-event source):
 * - `event` -> `ev.provider` (e.g. equals "linear").
 * - `project` -> `ev.project` when present (forward-compatible), else the
 *   `ev.threadId` (thread prefixes conventionally carry the project key).
 * - `label` -> `ev.labels[]`: `equals` means membership, `contains` means a
 *   substring of any label.
 * - `author` -> `ev.author`.
 * - `titleContains` -> substring of `ev.title`.
 * - `bodyContains` -> substring of `ev.body`.
 *
 * Leaf comparison is case-sensitive exact (`equals`) or substring
 * (`contains`). An absent filter (`undefined`) is accept-all.
 */

import type { IntakeEvent, IntakeFilter } from "./integrationTypes";

/** Pure matcher port (implemented below by `filterEngine`). */
export interface FilterEngine {
  /** True when `ev` passes `filter`; `undefined` filter accepts all. */
  matches(filter: IntakeFilter | undefined, ev: IntakeEvent): boolean;
  /** One-line auditable reason for the `matches` verdict. Never throws. */
  explain(filter: IntakeFilter | undefined, ev: IntakeEvent): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function asString(value: unknown): string {
  try {
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** Candidate haystacks for one filter field (label yields many). */
function readHaystacks(ev: IntakeEvent, field: string): string[] {
  try {
    if (!isRecord(ev)) return [];
    switch (field) {
      case "event":
        return [asString((ev as unknown as Record<string, unknown>).provider)];
      case "project": {
        const extra = (ev as unknown as Record<string, unknown>).project;
        if (typeof extra === "string" && extra.length > 0) return [extra];
        return [asString((ev as unknown as Record<string, unknown>).threadId)];
      }
      case "label": {
        const labels = (ev as unknown as Record<string, unknown>).labels;
        if (!Array.isArray(labels)) return [];
        const out: string[] = [];
        labels.forEach((l) => {
          try {
            if (typeof l === "string") out.push(l);
          } catch {
            // a bad label never aborts the read
          }
        });
        return out;
      }
      case "author":
        return [asString((ev as unknown as Record<string, unknown>).author)];
      case "titleContains":
        return [asString((ev as unknown as Record<string, unknown>).title)];
      case "bodyContains":
        return [asString((ev as unknown as Record<string, unknown>).body)];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** Leaf verdict; unknown fields and malformed leaves are false. */
function matchLeaf(node: Record<string, unknown>, ev: IntakeEvent): boolean {
  try {
    if (typeof node.field !== "string" || node.field.length === 0) return false;
    const hasEquals = node.equals !== undefined;
    const hasContains = node.contains !== undefined;
    if (hasEquals === hasContains) return false;
    const haystacks = readHaystacks(ev, node.field);
    if (node.field === "label") {
      if (hasEquals) {
        if (typeof node.equals !== "string") return false;
        return haystacks.includes(node.equals);
      }
      if (typeof node.contains !== "string") return false;
      return haystacks.some((l) => {
        try {
          return l.includes(node.contains as string);
        } catch {
          return false;
        }
      });
    }
    const hay = haystacks.length > 0 ? (haystacks[0] as string) : "";
    if (hasEquals) {
      return typeof node.equals === "string" && hay === node.equals;
    }
    return typeof node.contains === "string" && hay.includes(node.contains);
  } catch {
    return false;
  }
}

/**
 * Pure verdict: `event x filter -> boolean`. `undefined` filter accepts
 * all; every other malformed shape fails closed to `false`. Never throws.
 */
export function matchesIntakeFilter(
  filter: IntakeFilter | undefined,
  ev: IntakeEvent,
): boolean {
  try {
    if (filter === undefined) return true;
    if (!isRecord(ev) || !isRecord(filter)) return false;
    const node = filter as unknown as Record<string, unknown>;
    if (typeof node.field === "string") return matchLeaf(node, ev);
    if (node.op === "and") {
      if (!Array.isArray(node.all) || node.all.length === 0) return false;
      return node.all.every((c) => {
        try {
          return matchesIntakeFilter(c as IntakeFilter, ev);
        } catch {
          return false;
        }
      });
    }
    if (node.op === "or") {
      if (!Array.isArray(node.any) || node.any.length === 0) return false;
      return node.any.some((c) => {
        try {
          return matchesIntakeFilter(c as IntakeFilter, ev);
        } catch {
          return false;
        }
      });
    }
    if (node.op === "not") {
      if (!("node" in node) || node.node === undefined) return false;
      try {
        return !matchesIntakeFilter(node.node as IntakeFilter, ev);
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Keeps `explain` to one line: flattens whitespace, caps length at 80. */
function sanitize(value: unknown): string {
  try {
    const s = typeof value === "string" ? value : String(value ?? "?");
    return s.replace(/[\r\n\t]+/g, " ").slice(0, 80);
  } catch {
    return "?";
  }
}

/**
 * One-line auditable reason for the `matches` verdict (same verdict the
 * caller gets from `matchesIntakeFilter`). Never throws, never emits a
 * newline. Shapes: `accept-all (no filter)`; `leaf <f> <mode> "<v>" =>
 * <bool>`; `<and|or> => <bool> [<child>; ...]`; `not => <bool> [<child>]`;
 * `reject (<hint>) => false` for malformed filters.
 */
export function explainIntakeFilter(
  filter: IntakeFilter | undefined,
  ev: IntakeEvent,
): string {
  try {
    if (filter === undefined) return "accept-all (no filter)";
    let verdict = false;
    try {
      verdict = matchesIntakeFilter(filter, ev);
    } catch {
      verdict = false;
    }
    if (!isRecord(filter)) return `reject (invalid filter shape) => ${verdict}`;
    const node = filter as unknown as Record<string, unknown>;
    if (typeof node.field === "string") {
      const mode =
        node.equals !== undefined
          ? "equals"
          : node.contains !== undefined
            ? "contains"
            : "?";
      const raw = node.equals !== undefined ? node.equals : node.contains;
      return `leaf ${sanitize(node.field)} ${mode} "${sanitize(raw)}" => ${verdict}`;
    }
    if (node.op === "and" || node.op === "or") {
      const kids = node.op === "and" ? node.all : node.any;
      const arr: unknown[] = Array.isArray(kids) ? kids : [];
      const parts = arr.map((c) => {
        try {
          return explainIntakeFilter(c as IntakeFilter, ev);
        } catch {
          return "reject (child)";
        }
      });
      return `${String(node.op)} => ${verdict} [${parts.join("; ")}]`;
    }
    if (node.op === "not") {
      const hasChild = "node" in node && node.node !== undefined;
      if (!hasChild) return `reject (not without node) => ${verdict}`;
      let child = "reject (child)";
      try {
        child = explainIntakeFilter(node.node as IntakeFilter, ev);
      } catch {
        child = "reject (child)";
      }
      return `not => ${verdict} [${child}]`;
    }
    return `reject (invalid filter shape) => ${verdict}`;
  } catch {
    return "reject (explain failed) => false";
  }
}

/** Default pure-matcher port implementation (stateless, total). */
export const filterEngine: FilterEngine = {
  matches: (filter, ev) => matchesIntakeFilter(filter, ev),
  explain: (filter, ev) => explainIntakeFilter(filter, ev),
};
