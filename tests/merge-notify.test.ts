/**
 * merge-notify — close-out ante merge del PR de handoff (Warp paso 7).
 * `notePrMergedEqual` registra el merge (evento durable + isolation
 * `pr-merged`) con guardas 404/409 y es idempotente (duplicados → ok sin
 * duplicar eventos). Offline: store en memoria, cero red, cero git.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { notePrMergedEqual } from "../headless-runtime/factory/isolation/gitHubPr.ts";

function completeJobWithPr(id: string, prNumber: number): void {
  workItemStore.clear();
  const created = workItemStore.create({ id, prompt: "p", worktree: "C:/tmp/merge" });
  const chain: Array<"Foreman" | "Building" | "Review" | "Complete"> = [
    "Foreman",
    "Building",
    "Review",
    "Complete",
  ];
  chain.forEach((s, i) => {
    workItemStore.transition(created.id, s, "system", `t${i + 1}`);
  });
  const wi = workItemStore.get(id) as unknown as Record<string, unknown>;
  wi["isolation"] = {
    branch: "issue-9-x",
    baseBranch: "main",
    worktreePath: "C:/tmp/merge-wt",
    repoRoot: "C:/tmp/merge",
    state: "pr-open",
    prNumber,
    prUrl: `https://github.com/o/r/pull/${prNumber}`,
    createdAt: new Date().toISOString(),
  };
}

test("merge-notify registra el merge con evento durable y estado pr-merged", () => {
  completeJobWithPr("job-merge-01", 9);
  const out = notePrMergedEqual("job-merge-01", 9);
  assert.deepEqual(out, { ok: true, id: "job-merge-01", prNumber: 9, duplicate: false });
  const wi = workItemStore.get("job-merge-01") as unknown as Record<string, unknown>;
  const iso = wi["isolation"] as Record<string, unknown>;
  assert.equal(iso["state"], "pr-merged");
  const events = (wi["timeline"] as Array<{ message: string; meta?: unknown }>) ?? [];
  const found = events.filter((e) => e.message.startsWith("pr merged #9"));
  assert.equal(found.length, 1);
  const meta = (found[0]?.meta ?? {}) as Record<string, unknown>;
  assert.deepEqual(meta["pr"], { merged: true, prNumber: 9 });
  workItemStore.clear();
});

test("merge-notify es idempotente (duplicado no duplica eventos)", () => {
  completeJobWithPr("job-merge-02", 10);
  assert.deepEqual(notePrMergedEqual("job-merge-02", 10), {
    ok: true,
    id: "job-merge-02",
    prNumber: 10,
    duplicate: false,
  });
  const again = notePrMergedEqual("job-merge-02", 10);
  assert.deepEqual(again, { ok: true, id: "job-merge-02", prNumber: 10, duplicate: true });
  const wi = workItemStore.get("job-merge-02") as unknown as Record<string, unknown>;
  const events = (wi["timeline"] as Array<{ message: string }>) ?? [];
  assert.equal(events.filter((e) => e.message.startsWith("pr merged #10")).length, 1);
  workItemStore.clear();
});

test("merge-notify rechaza honesto: 404/409/mismatch/junk", () => {
  const missing = notePrMergedEqual("job-merge-nope", 1);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 404);
  completeJobWithPr("job-merge-03", 11);
  const mismatch = notePrMergedEqual("job-merge-03", 12);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.code, 409);
    assert.match(mismatch.error, /mismatch/);
  }
  const junk = notePrMergedEqual("job-merge-03", -1);
  assert.equal(junk.ok, false);
  if (!junk.ok) assert.equal(junk.code, 400);
  // No-Complete no cierra: Review no acepta close-out.
  workItemStore.clear();
  const created = workItemStore.create({ id: "job-merge-04", prompt: "p", worktree: "C:/tmp/merge" });
  workItemStore.transition(created.id, "Foreman", "system", "t1");
  const early = notePrMergedEqual("job-merge-04", 1);
  assert.equal(early.ok, false);
  if (!early.ok) assert.equal(early.code, 409);
  workItemStore.clear();
});
