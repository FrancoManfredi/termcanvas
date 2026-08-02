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

export const ISSUE_CARD_WIDTH = CARD_WIDTH;
export const ISSUE_CARD_HEIGHT = CARD_HEIGHT;
