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

test("packIssuePositions packs sorted by number with gaps from anchor", async () => {
  const { packIssuePositions, issueGridSpacing } = await import(
    "../src/canvas/issueGridLayout.ts"
  );

  const positions = packIssuePositions([
    { issueNumber: 1, worktreeId: "w1", x: 0, y: 50 },
    { issueNumber: 2, worktreeId: "w1", x: 1000, y: 60 },
    { issueNumber: 3, worktreeId: "w1", x: 3000, y: 80 },
  ]);

  const spacing = issueGridSpacing();
  // Anchor = leftmost card (issue 1 at x=0, y=50).
  assert.deepEqual(positions.get(1), { x: 0, y: 50 });
  assert.deepEqual(positions.get(2), { x: spacing, y: 50 });
  assert.deepEqual(positions.get(3), { x: spacing * 2, y: 50 });
});

test("packIssuePositions groups by worktreeId", async () => {
  const { packIssuePositions } = await import(
    "../src/canvas/issueGridLayout.ts"
  );

  const positions = packIssuePositions([
    { issueNumber: 5, worktreeId: "w1", x: 100, y: 10 },
    { issueNumber: 6, worktreeId: "w2", x: 500, y: 30 },
  ]);

  assert.deepEqual(positions.get(5), { x: 100, y: 10 });
  assert.deepEqual(positions.get(6), { x: 500, y: 30 });
  assert.equal(positions.size, 2);
});

test("packIssuePositions is empty for no issues", async () => {
  const { packIssuePositions } = await import(
    "../src/canvas/issueGridLayout.ts"
  );

  assert.equal(packIssuePositions([]).size, 0);
});
