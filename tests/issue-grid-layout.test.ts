import test from "node:test";
import assert from "node:assert/strict";

// Updated constants: CARD_WIDTH=980, CARD_HEIGHT=500, H_GAP=40, V_GAP=0, COLUMNS=999, OFFSET_Y=50
// Effectively horizontal: all same row (y = worktree.y + 50), x increments by 1020 (980+40)

test("computeIssueGridPositions horizontal row", async () => {
  const { computeIssueGridPositions } = await import(
    "../src/canvas/issueGridLayout.ts"
  );

  const pos = { x: 100, y: 200 };
  assert.equal(computeIssueGridPositions(pos, 0).x, 100);
  assert.equal(computeIssueGridPositions(pos, 0).y, 250);

  assert.equal(computeIssueGridPositions(pos, 1).x, 1120); // 100 + 1020
  assert.equal(computeIssueGridPositions(pos, 1).y, 250);

  assert.equal(computeIssueGridPositions(pos, 2).x, 2140); // 100 + 2040
  assert.equal(computeIssueGridPositions(pos, 2).y, 250);
});

test("computeIssueGridPositions same row all indices", async () => {
  const { computeIssueGridPositions } = await import(
    "../src/canvas/issueGridLayout.ts"
  );

  const pos = { x: 0, y: 0 };
  for (let i = 0; i < 50; i++) {
    assert.equal(computeIssueGridPositions(pos, i).y, 50);
  }
});

test("computeIssueGridPositions offset from origin", async () => {
  const { computeIssueGridPositions } = await import(
    "../src/canvas/issueGridLayout.ts"
  );

  const p50 = computeIssueGridPositions({ x: 0, y: 0 }, 50);
  assert.equal(p50.x, 51000); // 50 * 1020
  assert.equal(p50.y, 50);
});
