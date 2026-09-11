/**
 * Spec domain types — Ola 8.
 * Contrato daemon ↔ renderer para el Spec-agent (brief + approval gate humano).
 * Zod schemas + TypeScript types + helpers puros. Sin cambios a schemas existentes.
 */

import { z } from "zod";

// ── SpecBrief ──

export const SpecBriefSchema = z.object({
  summary: z.string().min(1).max(2000),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1),
  targetFiles: z.array(z.string().min(1).max(500)).default([]),
  trivial: z.boolean(),
  openQuestions: z.array(z.string().min(1).max(500)).default([]),
});

export type SpecBrief = z.infer<typeof SpecBriefSchema>;

/**
 * Validate SpecBrief and throw if invalid.
 */
export function validateSpecBrief(payload: unknown): SpecBrief {
  return SpecBriefSchema.parse(payload);
}

// ── Approval gate (meta de timeline, Record<string,unknown> — sin tocar schemas) ──

/** Clave de meta que marca un pedido de aprobación de spec pendiente. */
export const SPEC_APPROVAL_META_KEY = "needsSpecApproval";

/** Clave de meta que marca una spec aprobada por humano (invalida pedidos previos). */
export const SPEC_APPROVED_META_KEY = "specApproved";

/** Clave de meta que marca una spec rechazada por humano (invalida pedidos previos). */
export const SPEC_REJECTED_META_KEY = "specRejected";

export interface SpecApprovalMeta {
  needsSpecApproval: true;
  specSummary: string;
}

/**
 * Construye la meta para la transición a Triage cuando el spec no es trivial.
 */
export function buildSpecApprovalMeta(specSummary: string): Record<string, unknown> {
  return {
    [SPEC_APPROVAL_META_KEY]: true,
    specSummary: String(specSummary ?? "").slice(0, 500),
  } as Record<string, unknown>;
}

interface TimelineLike {
  meta?: Record<string, unknown> | undefined;
}

/**
 * Busca en el timeline (del más nuevo al más viejo) el último pedido de
 * aprobación de spec VIGENTE: un evento posterior de `specApproved` o
 * `specRejected` invalida los pedidos previos (sin esto, cada regreso a
 * Triage resucitaba el approve de una spec ya decidida → loop infinito
 * approve→Building→Triage→approve). Puro, nunca lanza.
 */
export function getLatestSpecApprovalRequest(
  timeline: readonly TimelineLike[] | null | undefined,
): { specSummary: string } | null {
  try {
    if (!Array.isArray(timeline)) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      const meta = entry?.meta as Record<string, unknown> | undefined;
      if (!meta) continue;
      if (meta[SPEC_APPROVED_META_KEY] === true || meta[SPEC_REJECTED_META_KEY] === true) {
        return null;
      }
      if (meta[SPEC_APPROVAL_META_KEY] === true) {
        const summary = typeof meta.specSummary === "string" ? meta.specSummary : "";
        return { specSummary: summary };
      }
    }
    return null;
  } catch {
    return null;
  }
}
