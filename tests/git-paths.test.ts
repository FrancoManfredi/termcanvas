import test from "node:test";
import assert from "node:assert/strict";

import { parseNulSeparatedGitPaths } from "../electron/git-paths.ts";

test("parseNulSeparatedGitPaths preserves unicode paths", () => {
  assert.deepEqual(
    parseNulSeparatedGitPaths("八股.md\0docs/未命名.md\0"),
    ["八股.md", "docs/未命名.md"],
  );
});

test("parseNulSeparatedGitPaths ignores trailing empty records", () => {
  assert.deepEqual(parseNulSeparatedGitPaths("README.md\0\0"), ["README.md"]);
});
