// Pure GitHub remote/query helpers shared by the Electron main process,
// the headless daemon and the web renderer (F2 web-local). No node,
// Electron or DOM dependencies.
import {
  parseReviewBodyVerdict,
  reviewDecisionFromBodyVerdict,
  reviewDecisionWithFixApplied,
} from "./review-verdict.ts";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/**
 * Parse `owner/repo` from a git remote URL (HTTPS or SSH, optional .git).
 * Returns null when the remote is not a GitHub URL.
 */
export function parseOwnerRepoFromRemote(
  remoteUrl: string | null | undefined,
): GitHubRepoRef | null {
  if (!remoteUrl) return null;
  const match = remoteUrl
    .trim()
    .match(/github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** GraphQL: PRs linked to an issue via the "Development" panel field. */
export function buildLinkedPrsQuery(): string {
  return `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          closedByPullRequestsReferences(first: 10) {
            nodes {
              number
              title
              url
              state
              headRefName
              headRefOid
            }
          }
        }
      }
    }`;
}

export interface LinkedPrNode {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName: string;
  headRefOid: string;
}

/** Extract the linked-PR nodes from a `gh api graphql` response. */
export function parseLinkedPrNodes(data: unknown): LinkedPrNode[] {
  const nodes = (
    data as {
      data?: {
        repository?: {
          issue?: {
            closedByPullRequestsReferences?: { nodes?: LinkedPrNode[] };
          };
        };
      };
    }
  )?.data?.repository?.issue?.closedByPullRequestsReferences?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

/** Prefer an OPEN PR, fall back to the first node (mirrors the bridge). */
export function pickPreferredPr(prs: LinkedPrNode[]): LinkedPrNode | null {
  if (prs.length === 0) return null;
  return prs.find((p) => p.state === "OPEN") ?? prs[0];
}

/** `gh pr view` argv for the review-decision lookup (mirrors the bridge). */
export function buildReviewDecisionArgs(prNumber: number): string[] {
  return [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "reviewDecision,reviews,labels,headRefOid",
    "--jq",
    "{ decision: .reviewDecision, headRefOid: .headRefOid, reviews: [.reviews[] | { state: .state, body: .body, submittedAt: .submittedAt, commitOid: .commit.oid }], labels: [.labels[].name] }",
  ];
}

export interface ReviewLookupReview {
  state: string;
  body: string;
  submittedAt: string;
  commitOid: string | null;
}

/**
 * Fold a `gh pr view` payload into the review-decision contract. Pure
 * mirror of the `github:get-pr-review-decision` handler: newest verdict
 * line wins, COMMENTED counts as feedback, head-moved-past-review folds
 * to FIX_APPLIED.
 */
export function foldReviewDecision(payload: {
  decision?: unknown;
  headRefOid?: unknown;
  reviews?: unknown;
  labels?: unknown;
}): {
  reviewDecision:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "REVIEW_REQUIRED"
    | "COMMENTED"
    | "FIX_APPLIED"
    | null;
  bodyVerdict: "APROBADO" | "CAMBIOS_PEDIDOS" | null;
  labels: string[];
  headRefOid: string | null;
  lastReviewCommitId: string | null;
} {
  const decision = payload?.decision;
  const headRefOid =
    typeof payload?.headRefOid === "string" ? payload.headRefOid : null;
  const reviews: ReviewLookupReview[] = Array.isArray(payload?.reviews)
    ? (payload.reviews as ReviewLookupReview[])
    : [];
  const labels: string[] = Array.isArray(payload?.labels)
    ? (payload.labels as string[])
    : [];

  let bodyVerdict: "APROBADO" | "CAMBIOS_PEDIDOS" | null = null;
  for (const review of reviews) {
    const parsed = parseReviewBodyVerdict(review.body);
    if (parsed) bodyVerdict = parsed;
  }

  const states = reviews.map((r) => r.state);
  const fallbackDecision =
    decision === "APPROVED" ||
    decision === "CHANGES_REQUESTED" ||
    decision === "REVIEW_REQUIRED"
      ? (decision as "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED")
      : states.includes("COMMENTED")
        ? "COMMENTED"
        : null;

  const lastReviewCommitId: string | null =
    reviews.length > 0 ? (reviews[reviews.length - 1].commitOid ?? null) : null;

  return {
    reviewDecision: reviewDecisionWithFixApplied(
      reviewDecisionFromBodyVerdict(bodyVerdict) ?? fallbackDecision,
      headRefOid,
      lastReviewCommitId,
    ),
    bodyVerdict,
    labels,
    headRefOid,
    lastReviewCommitId,
  };
}

/**
 * Resolve the issue a PR will close from its body ("Closes #N" / "fixes #N"
 * contract). Null when the body references no issue — the issue mirror is
 * skipped then.
 */
export function parseLinkedIssueNumber(
  body: string | null | undefined,
): number | null {
  if (!body) return null;
  const match = body.match(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i,
  );
  return match ? Number(match[1]) : null;
}

export const MAX_REVIEW_COMMENT_CHARS = 5000;

/** Truncate review-thread text the same way the bridge does. */
export function truncateReviewComments(full: string): string {
  const text = full.trim();
  return text.length > MAX_REVIEW_COMMENT_CHARS
    ? `${text.slice(0, MAX_REVIEW_COMMENT_CHARS)}... (feedback truncado — revisá el PR en GitHub para el resto)`
    : text;
}

// Label colors for `gh label create` (mirrors the Electron main process).
export const REVIEW_LABEL_COLORS: Record<string, string> = {
  "review:pendiente": "d4a017",
  "review:comentado": "e5534b",
  "review:fix-aplicado": "d4c5f9",
  "review:aprobado": "0e8a16",
  "conflicto:main": "b60205",
};

/** `gh label create` argv (idempotent with --force). */
export function buildEnsureLabelArgs(label: string): string[] {
  return [
    "label",
    "create",
    label,
    "--color",
    REVIEW_LABEL_COLORS[label] ?? "d4c5f9",
    "--force",
  ];
}

/** `gh issue edit` argv applying one review-cycle label to a PR. */
export function buildApplyCycleLabelArgs(
  prNumber: number,
  label: string,
  cycleLabels: readonly string[],
): string[] {
  const args = ["issue", "edit", String(prNumber), "--add-label", label];
  for (const other of cycleLabels) {
    if (other !== label) args.push("--remove-label", other);
  }
  return args;
}

/** `gh issue edit` argv mirroring the canonical label onto the issue. */
export function buildSyncIssueLabelArgs(
  issueNumber: number,
  canonical: string | null,
  cycleLabels: readonly string[],
): string[] {
  const args = ["issue", "edit", String(issueNumber)];
  if (canonical) args.push("--add-label", canonical);
  for (const other of cycleLabels) {
    if (other !== canonical) args.push("--remove-label", other);
  }
  return args;
}
