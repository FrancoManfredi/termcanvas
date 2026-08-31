import test from "node:test";
import assert from "node:assert/strict";

import { resolveAllCardPositions } from "../src/stores/cardLayoutStore.ts";

test("resolveAllCardPositions keeps the prioritized card under the cursor and pushes the overlapping peer away", () => {
  const cards = {
    "diff:worktree-1": { x: 100, y: 100, w: 400, h: 340 },
    "filetree:worktree-1": { x: 120, y: 110, w: 280, h: 340 },
  };

  const resolved = resolveAllCardPositions(cards, [], {
    priorityIds: ["filetree:worktree-1"],
  });

  assert.deepEqual(resolved["filetree:worktree-1"], { x: 120, y: 110 });
  assert.deepEqual(resolved["diff:worktree-1"], { x: 100, y: 462 });
});

test("resolveAllCardPositions ignores duplicate priority ids from active and recent card state", () => {
  const cards = {
    "diff:worktree-1": { x: 100, y: 100, w: 400, h: 340 },
    "filetree:worktree-1": { x: 120, y: 110, w: 280, h: 340 },
  };

  const resolved = resolveAllCardPositions(cards, [], {
    priorityIds: ["filetree:worktree-1", "filetree:worktree-1"],
  });

  assert.deepEqual(resolved["filetree:worktree-1"], { x: 120, y: 110 });
  assert.deepEqual(resolved["diff:worktree-1"], { x: 100, y: 462 });
});
