import test from "node:test";
import assert from "node:assert/strict";

import { useComposerStore } from "../src/stores/composerStore.ts";

test("rename title mode preserves and restores the composer draft", () => {
  useComposerStore.setState({
    draft: "ship it",
    images: [],
    isSubmitting: false,
    error: null,
  });

  useComposerStore
    .getState()
    .enterRenameTerminalTitleMode("terminal-1", "fix-auth");

  assert.equal(useComposerStore.getState().mode, "renameTerminalTitle");
  assert.equal(useComposerStore.getState().draft, "fix-auth");

  useComposerStore.getState().exitRenameTerminalTitleMode();

  assert.equal(useComposerStore.getState().mode, "compose");
  assert.equal(useComposerStore.getState().draft, "ship it");
});
