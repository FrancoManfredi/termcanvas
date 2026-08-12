// Binary review verdict contract shared by the review flow.
//
// The review prompts are required to lead the general review body with one of
// the two exact lines below. TermCanvas parses that line to (a) override
// GitHub's own reviewDecision (a review posted with event=COMMENT records
// reviewDecision="COMMENTED" even when the body says approved) and (b) flip
// the real PR label that gates the fix/merge buttons on the issue card.
//
// FUENTE DE VERDAD de los labels: el estado del ciclo de review vive en el PR,
// y el issue asociado lo REFLEJA — cada vez que el PR cambia de label, el
// issue se sincroniza con el MISMO label canónico (un PR es un issue para la
// API de GitHub, así que `gh issue edit <prNumber>` apunta al PR; el issue
// real se resuelve desde el body del PR, "Closes #N" / "fixes #N"). La app aplica
// review:pendiente sola al detectar el PR nuevo; el reviewer flipa entre
// review:aprobado / review:comentado; el fix y la
// resolución de conflictos dejan review:fix-aplicado; el mergeador marca
// conflicto:main y QUITA review:aprobado (un PR conflictivo nunca puede
// mergearse). Todos se crean en el repo si no existen (gh label create).
// canonicalReviewLabel() deriva el estado canónico cuando un PR arrastra más
// de un label del ciclo.

import type { ReviewVerdict } from "../stores/issueReviewStore";

export type ReviewBodyVerdict = "APROBADO" | "CAMBIOS_PEDIDOS";

export const REVIEW_LABEL_PENDING = "review:pendiente";
export const REVIEW_LABEL_CHANGES = "review:comentado";
export const REVIEW_LABEL_FIX_APPLIED = "review:fix-aplicado";
export const REVIEW_LABEL_APPROVED = "review:aprobado";
export const REVIEW_LABEL_CONFLICT = "conflicto:main";

// Every label of the review cycle, in ascending state order. Used by the
// issue mirror to clear the whole cycle before applying the canonical label.
export const REVIEW_CYCLE_LABELS = [
  REVIEW_LABEL_PENDING,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CONFLICT,
] as const;

// State precedence when a PR carries more than one cycle label (e.g. a stale
// review:aprobado left alongside conflicto:main): the most advanced state
// wins. Single source of truth for the label mirrored onto the issue.
const REVIEW_LABEL_PRECEDENCE: Record<string, number> = {
  [REVIEW_LABEL_CONFLICT]: 5,
  [REVIEW_LABEL_APPROVED]: 4,
  [REVIEW_LABEL_FIX_APPLIED]: 3,
  [REVIEW_LABEL_CHANGES]: 2,
  [REVIEW_LABEL_PENDING]: 1,
};

/**
 * Derive the single canonical review-cycle label from the raw label list of a
 * PR. Returns null when the PR carries no cycle label (e.g. brand new PR).
 */
export function canonicalReviewLabel(labels: string[]): string | null {
  let canonical: string | null = null;
  for (const label of labels) {
    const precedence = REVIEW_LABEL_PRECEDENCE[label];
    if (!precedence) continue;
    if (!canonical || precedence > REVIEW_LABEL_PRECEDENCE[canonical]) {
      canonical = label;
    }
  }
  return canonical;
}

/**
 * The label the UI should display/gate on for an issue card: the PR's
 * canonical cycle label (labels are the persisted source of truth) with a
 * fallback to the in-memory verdict for live transitions — the moment the
 * fix flow launches, the verdict flips to FIX_APPLIED before the agent has
 * applied the label. Labels win whenever present, so a stale in-memory
 * verdict can never override real repo state.
 */
export function effectiveReviewLabel(
  labels: string[],
  verdict: ReviewVerdict | null | undefined,
): string | null {
  const canonical = canonicalReviewLabel(labels);
  if (canonical) return canonical;
  if (verdict === "APPROVED") return REVIEW_LABEL_APPROVED;
  if (verdict === "CHANGES_REQUESTED" || verdict === "COMMENTED") {
    return REVIEW_LABEL_CHANGES;
  }
  if (verdict === "FIX_APPLIED") return REVIEW_LABEL_FIX_APPLIED;
  if (verdict === "REVIEW_REQUIRED") return REVIEW_LABEL_PENDING;
  return null;
}

// Anchored to the FIRST line of the body only: the prompt contract requires
// the verdict line to lead the review body ("primera línea, sin texto antes").
// No multiline flag on purpose — a verdict buried mid-body does not count;
// the line may end with a newline (rest of the body is the summary) or EOL.
export const REVIEW_VERDICT_REGEX =
  /^\s*VEREDICTO:\s*(APROBADO|CAMBIOS_PEDIDOS)\.?\s*(\r?\n|$)/;

/**
 * Extract the binary verdict from a review body. The newest review whose body
 * carries the verdict line is the source of truth. gh returns the reviews
 * array oldest-first (verified empirically), so callers must scan ALL bodies
 * and let the last match win — a re-review must override the original verdict.
 */
export function parseReviewBodyVerdict(
  body: string | null | undefined,
): ReviewBodyVerdict | null {
  if (!body) return null;
  const match = body.match(REVIEW_VERDICT_REGEX);
  return match ? (match[1] as ReviewBodyVerdict) : null;
}

/**
 * Map a parsed verdict line to the GitHub reviewDecision value the rest of
 * the UI understands. Returns null when no verdict line was found.
 */
export function reviewDecisionFromBodyVerdict(
  bodyVerdict: ReviewBodyVerdict | null,
): "APPROVED" | "CHANGES_REQUESTED" | null {
  if (bodyVerdict === "APROBADO") return "APPROVED";
  if (bodyVerdict === "CAMBIOS_PEDIDOS") return "CHANGES_REQUESTED";
  return null;
}

/**
 * Fold the "fix pushed" state into the review decision: when the PR head has
 * moved past the commit the newest review evaluated, that verdict is stale —
 * the change needs re-review, not a merge. FIX_APPLIED wins regardless of
 * what the old review said (approved or changes requested), so the
 * fix-aplicado label is materialized by code instead of by the implementer's
 * prompt. No reviews yet (null decision) stays untouched.
 */
export function reviewDecisionWithFixApplied(
  decision:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "REVIEW_REQUIRED"
    | "COMMENTED"
    | null,
  headRefOid: string | null,
  lastReviewCommitId: string | null,
):
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | "COMMENTED"
  | "FIX_APPLIED"
  | null {
  if (decision === null || !headRefOid || !lastReviewCommitId) return decision;
  return headRefOid !== lastReviewCommitId ? "FIX_APPLIED" : decision;
}

/**
 * The label pair to flip for a given review decision. COMMENTED is treated as
 * "changes requested" by the prompt contract (inline comments without an
 * explicit verdict still block merging until answered).
 */
export function reviewLabelsForVerdict(
  verdict:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "COMMENTED"
    | "REVIEW_REQUIRED"
    | "FIX_APPLIED"
    | null,
): { target: string; other: string } | null {
  if (verdict === "APPROVED") {
    return { target: REVIEW_LABEL_APPROVED, other: REVIEW_LABEL_CHANGES };
  }
  if (verdict === "CHANGES_REQUESTED" || verdict === "COMMENTED") {
    return { target: REVIEW_LABEL_CHANGES, other: REVIEW_LABEL_APPROVED };
  }
  return null;
}
