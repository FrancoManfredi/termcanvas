/**
 * Restore de isolation (T01): el worktree/branch/PR del job sobrevive al
 * reinicio del daemon. Sin este restore, el summary pierde `isolation`
 * (los jobs viejos quedaban sin branch/worktreePath aunque el worktree
 * existiera en disco).
 *
 * Offline: disco tmp, sin daemon, sin red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureWorkItemDir,
  readWorkItemFromDir,
} from "../headless-runtime/workItem/workItemDisk.ts";
import type { WorkItem } from "../shared/types/workItem.ts";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "wf-iso-restore-"));
test.after(() => {
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const ISOLATION = {
  branch: "issue-42-fix-something",
  baseBranch: "main",
  worktreePath: "C:/repo/.worktrees/issue-42-fix-something",
  repoRoot: "C:/repo",
  state: "created" as const,
  createdAt: "2026-09-12T00:00:00.000Z",
  prNumber: 61,
  prUrl: "https://github.com/org/repo/pull/61",
};

function mkItem(
  id: string,
  overrides: Record<string, unknown> = {},
): WorkItem {
  const dir = path.join(SANDBOX, id);
  fs.mkdirSync(dir, { recursive: true });
  return {
    id,
    prompt: "prompt de prueba",
    worktree: "C:/repo",
    phase: "diagnosisLlm",
    status: "Building",
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:01.000Z",
    timeline: [
      {
        id: `${id}-t0`,
        from: "Intake",
        to: "Intake",
        at: "2026-09-12T00:00:00.000Z",
        actor: "user",
        message: "created",
      },
    ],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir,
    dotDonePath: path.join(dir, ".done"),
    runnerId: "linux-build",
    ...overrides,
  } as unknown as WorkItem;
}

test("isolation: sobrevive el round-trip persist → restore desde job.json", () => {
  const item = mkItem("job-iso-roundtrip", { isolation: ISOLATION });
  ensureWorkItemDir(item);
  const restored = readWorkItemFromDir(item.dir!);
  assert.ok(restored);
  assert.deepEqual(restored.isolation, ISOLATION);
});

test("isolation: fallback a la meta del timeline cuando job.json no la trae", () => {
  const item = mkItem("job-iso-timeline", {
    timeline: [
      {
        id: "job-iso-timeline-t0",
        from: "Intake",
        to: "Intake",
        at: "2026-09-12T00:00:00.000Z",
        actor: "user",
        message: "created",
      },
      {
        id: "job-iso-timeline-t1",
        from: "Intake",
        to: "Intake",
        at: "2026-09-12T00:00:02.000Z",
        actor: "system",
        message: "isolation created branch=issue-42-fix-something",
        meta: { isolation: ISOLATION },
      },
    ],
  });
  ensureWorkItemDir(item);
  const restored = readWorkItemFromDir(item.dir!);
  assert.ok(restored);
  assert.equal(restored.isolation?.branch, ISOLATION.branch);
  assert.equal(restored.isolation?.worktreePath, ISOLATION.worktreePath);
  assert.equal(restored.isolation?.prNumber, 61);
});

test("isolation: shapes rotos no inventan jaula (undefined)", () => {
  const item = mkItem("job-iso-junk", {
    isolation: { branch: "" },
    timeline: [
      {
        id: "job-iso-junk-t0",
        from: "Intake",
        to: "Intake",
        at: "2026-09-12T00:00:00.000Z",
        actor: "user",
        message: "created",
        meta: { isolation: { state: "created" } },
      },
    ],
  });
  ensureWorkItemDir(item);
  const restored = readWorkItemFromDir(item.dir!);
  assert.ok(restored);
  assert.equal(restored.isolation, undefined);
});
