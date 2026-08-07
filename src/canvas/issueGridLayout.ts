const CARD_WIDTH = 980;
const CARD_HEIGHT = 500;
const H_GAP = 40;
const V_GAP = 0;
const COLUMNS = 999;
const OFFSET_Y = 50;

export function computeIssueGridPositions(
  worktreePos: { x: number; y: number },
  index: number,
): { x: number; y: number } {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);

  return {
    x: worktreePos.x + col * (CARD_WIDTH + H_GAP),
    y: worktreePos.y + OFFSET_Y + row * (CARD_HEIGHT + V_GAP),
  };
}

export function issueGridSpacing(): number {
  return CARD_WIDTH + H_GAP;
}

/**
 * Pack the given issues into a compact horizontal row per worktree group,
 * ordered by issue number. The row keeps the canvas anchor of the previous
 * layout (leftmost card) and drops closed-issue gaps that would otherwise
 * live on as empty space after filtering.
 */
export interface PackableIssue {
  issueNumber: number;
  worktreeId?: string;
  x: number;
  y: number;
}

export function packIssuePositions(issues: PackableIssue[]): Map<number, { x: number; y: number }> {
  const result = new Map<number, { x: number; y: number }>();

  const groups = new Map<string, PackableIssue[]>();
  for (const issue of issues) {
    const key = issue.worktreeId ?? "default";
    const list = groups.get(key) ?? [];
    list.push(issue);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.issueNumber - b.issueNumber);
    if (sorted.length === 0) continue;

    let anchorX = Number.POSITIVE_INFINITY;
    let anchorY = sorted[0].y;
    for (const issue of sorted) {
      if (issue.x < anchorX) {
        anchorX = issue.x;
        anchorY = issue.y;
      }
    }

    sorted.forEach((issue, index) => {
      result.set(issue.issueNumber, {
        x: anchorX + index * issueGridSpacing(),
        y: anchorY,
      });
    });
  }

  return result;
}

export const ISSUE_CARD_WIDTH = CARD_WIDTH;
export const ISSUE_CARD_HEIGHT = CARD_HEIGHT;
