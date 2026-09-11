/**
 * Improvement domain types — Ola 13 Self-improvement.
 * Contrato daemon ↔ renderer para propuestas versionadas estilo Warp:
 * agrupa failures por scorer → propone archivo COMPLETO contra `factory/`
 * con `regressionsAddressed` → un humano adopta o descarta. JAMÁS auto-apply.
 * Zod schemas + TypeScript types + allowlist de targets + helpers puros.
 * Estilo espejo de `shared/types/scorer.ts`.
 */

import { z } from "zod";
import { SCORER_NAME_PATTERN } from "./scorer";

// ── Constants ──

/**
 * Contenido máximo de `newContent`: 16KB. Skills reales ~2-4KB
 * (`factory/skills/code-review/SKILL.md` ~4KB): margen honesto sin
 * dejar que el LLM inyecte archivos gigantes.
 */
export const IMPROVEMENT_MAX_CONTENT = 16384;
/** Preview del prompt original adjunto a cada failure (slice, espejo scorerEngine). */
export const FAILURE_PROMPT_PREVIEW_MAX = 200;
/** Ids de propuesta: `imp-<base36>-<rand>`, seguros para rutas y filenames. */
export const PROPOSAL_ID_PATTERN = /^imp-[a-z0-9-]+$/i;
/** Límite de caracteres por entrada de `regressionsAddressed` (un workItemId). */
export const REGRESSION_REF_MAX = 200;

// ── FailureCase ──

export const FailureCaseSchema = z.object({
  workItemId: z.string().regex(/^job-[a-z0-9\-]+$/),
  scorer: z.string().min(1).max(64).regex(SCORER_NAME_PATTERN),
  label: z.string().min(1).max(64),
  reason: z.string().min(1).max(2000),
  at: z.string().min(1),
  promptPreview: z.string().max(FAILURE_PROMPT_PREVIEW_MAX),
});
export type FailureCase = z.infer<typeof FailureCaseSchema>;

// ── ImprovementProposal ──

export const ImprovementStatusSchema = z.enum([
  "pending",
  "ready",
  "failed",
  "adopted",
  "discarded",
]);
export type ImprovementStatus = z.infer<typeof ImprovementStatusSchema>;

export const ImprovementProposalSchema = z.object({
  id: z.string().min(1).max(128).regex(PROPOSAL_ID_PATTERN),
  scorer: z.string().min(1).max(64).regex(SCORER_NAME_PATTERN),
  status: ImprovementStatusSchema,
  pattern: z.string().max(2000).optional(),
  rationale: z.string().max(2000).optional(),
  /** Ruta relativa al dir `factory/` (ej. `skills/code-review/SKILL.md`). */
  target: z.string().min(1).max(300).optional(),
  /** Archivo COMPLETO propuesto (no diff). Solo en ready. */
  newContent: z.string().max(IMPROVEMENT_MAX_CONTENT).optional(),
  /** WorkItemIds de failures que motivan la propuesta (trazabilidad Warp). */
  regressionsAddressed: z.array(z.string().min(1).max(REGRESSION_REF_MAX)).max(50),
  createdAt: z.string().min(1),
  decidedAt: z.string().min(1).optional(),
  /** Razón visible cuando status=failed. Nunca se inventa contenido. */
  failureReason: z.string().max(2000).optional(),
  /** Relativo a `factory/` (ej. `.proposals/<id>.bak`), solo si hubo backup. */
  backupPath: z.string().min(1).max(500).optional(),
  /**
   * Reintentos de análisis consumidos (P4c retry-analysis: solo `failed`
   * reintenta, tope `RETRY_ANALYSIS_MAX = 1` en `improvementHttp`).
   * Aditivo y opcional: las propuestas viejas sin el campo cuentan como 0.
   */
  retryCount: z.number().int().min(0).max(10).optional(),
  /** Instante ISO del último re-análisis (ready o failed honesto). */
  lastRetriedAt: z.string().min(1).optional(),
});
export type ImprovementProposal = z.infer<typeof ImprovementProposalSchema>;

/** Resumen sin `newContent` para GET lista (el contenido viaja solo en detail). */
export type ProposalSummary = Omit<ImprovementProposal, "newContent">;

// ── Allowlist de targets adoptables ──

/**
 * True si el target es adoptable: ruta relativa dentro de `skills/` o
 * `agents/` (relativa al dir `factory/`), terminada en `.md`, sin `..`,
 * sin absolutos (posix, drive Windows, UNC), sin backslashes ni NUL.
 * Defensa contra traversal del contenido generado por el LLM.
 * Puro, nunca lanza.
 */
export function isAdoptableTarget(target: unknown): boolean {
  try {
    if (typeof target !== "string") return false;
    const t = target.trim();
    if (t.length === 0 || t.length > 300) return false;
    if (t !== target) return false;
    if (t.includes("\\") || t.includes("\0")) return false;
    if (t.startsWith("/")) return false;
    if (/^[a-zA-Z]:/.test(t)) return false;
    const segs = t.split("/");
    if (segs.some((s) => s === "" || s === "." || s === "..")) return false;
    if (segs.some((s) => s.includes(".."))) return false;
    const inAllowlist = t.startsWith("skills/") || t.startsWith("agents/");
    if (!inAllowlist) return false;
    if (segs.length < 2) return false;
    if (!t.endsWith(".md")) return false;
    try {
      const decoded = decodeURIComponent(t);
      if (decoded !== t) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
          return false;
        }
        if (decoded === "." || decoded === "..") return false;
        if (decoded.startsWith("/")) return false;
        if (/^[a-zA-Z]:/.test(decoded)) return false;
      }
    } catch {
      // `%` suelto que no decodifica: sospechoso → rechazar.
      if (t.includes("%")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Validación por estado ──

/**
 * Valida una propuesta (schema zod + invariantes por estado) y lanza si es
 * inválida:
 * - ready: exige pattern/rationale/target/newContent no vacíos y ≥1 regression.
 * - failed: exige failureReason visible (prohibido fallar en silencio).
 * - adopted/discarded: exigen decidedAt (toda decisión humana queda fechada).
 * NOTA: el allowlist de `target` NO se valida acá sino en los bordes
 * (analyze + adopt), para que un cambio futuro de reglas no invalide el
 * historial persistido. Puro salvo el throw.
 */
export function validateImprovementProposal(payload: unknown): ImprovementProposal {
  const parsed = ImprovementProposalSchema.parse(payload);
  const nonEmpty = (v: string | undefined): boolean =>
    typeof v === "string" && v.trim().length > 0;
  if (parsed.status === "ready") {
    const missing: string[] = [];
    if (!nonEmpty(parsed.pattern)) missing.push("pattern");
    if (!nonEmpty(parsed.rationale)) missing.push("rationale");
    if (!nonEmpty(parsed.target)) missing.push("target");
    if (!nonEmpty(parsed.newContent)) missing.push("newContent");
    if (parsed.regressionsAddressed.length === 0) missing.push("regressionsAddressed");
    if (missing.length > 0) {
      throw new Error(
        `proposal inválida "${parsed.id}": ready exige ${missing.join(", ")}`,
      );
    }
  }
  if (parsed.status === "failed" && !nonEmpty(parsed.failureReason)) {
    throw new Error(
      `proposal inválida "${parsed.id}": failed exige failureReason visible`,
    );
  }
  if (
    (parsed.status === "adopted" || parsed.status === "discarded") &&
    !nonEmpty(parsed.decidedAt)
  ) {
    throw new Error(
      `proposal inválida "${parsed.id}": ${parsed.status} exige decidedAt`,
    );
  }
  return parsed;
}

/**
 * Resumen sin `newContent` (para GET lista). Puro, nunca lanza
 * (devuelve null si la propuesta es inválida).
 */
export function toProposalSummary(
  proposal: ImprovementProposal | null | undefined,
): ProposalSummary | null {
  try {
    if (!proposal || typeof proposal !== "object") return null;
    const parsed = ImprovementProposalSchema.parse(proposal);
    const { newContent: _dropped, ...rest } = parsed;
    void _dropped;
    return rest;
  } catch {
    return null;
  }
}
