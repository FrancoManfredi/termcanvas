// Re-export hub: the contract moved to shared/review-verdict.ts (F2
// web-local) so the daemon and the web renderer can import it without
// dragging renderer sources. All existing imports keep working unchanged.
export {
  REVIEW_CYCLE_LABELS,
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_CONFLICT,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_GATE_FAIL,
  REVIEW_LABEL_PENDING,
  REVIEW_VERDICT_REGEX,
  canonicalReviewLabel,
  effectiveReviewLabel,
  parseReviewBodyVerdict,
  reviewDecisionFromBodyVerdict,
  reviewDecisionWithFixApplied,
  reviewLabelsForVerdict,
} from "../../shared/review-verdict.ts";
export type {
  ReviewBodyVerdict,
  ReviewVerdict,
} from "../../shared/review-verdict.ts";
