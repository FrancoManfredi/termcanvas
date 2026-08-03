/**
 * Build a git branch name from a GitHub issue.
 *
 * Format: `issue-<N>-<slug>` where slug is derived from the title:
 * - lowercase
 * - non-alphanumeric → hyphen
 * - consecutive hyphens collapsed
 * - leading/trailing hyphens trimmed
 * - truncated to 40 characters max
 */
export function buildIssueBranchName(issue: {
  issueNumber: number;
  title: string;
}): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");

  return slug ? `issue-${issue.issueNumber}-${slug}` : `issue-${issue.issueNumber}`;
}
