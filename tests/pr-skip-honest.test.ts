/**
 * pr-skip-honest — accept humano sobre job sin aislamiento no puede quedar
 * mudo. `maybeOpenPrForCompletedJob` salta (not-isolated / bad-branch) pero
 * SIEMPRE deja evento en el timeline: sin eso el accept se siente como
 * "no pasó nada" y el panel no puede explicar por qué no hay PR.
 *
 * Offline: store en memoria + rama de skip que nunca toca red (openPrForJob
 * no se alcanza en estos caminos).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { maybeOpenPrForCompletedJob } from "../headless-runtime/factory/isolation/gitHubPr.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function baseJob(id: string, patch: Record<string, unknown> = {}): Parameters<
  typeof workItemStore.create
>[0] & Record<string, unknown> {
  return {
    id,
    prompt: "trivial sin issue",
    worktree: "C:/tmp/pr-skip-honest",
    ...patch,
  };
}

function chainToComplete(id: string, _tag: string): void {
  const steps: Array<Parameters<typeof workItemStore.transition>[1]> = [
    "Foreman",
    "Building",
    "Review",
    "Complete",
  ];
  steps.forEach((s, i) => {
    workItemStore.transition(id, s, "system", `t${i + 1}`);
  });
}

test("not-isolated: Complete sin jaula deja evento honesto de skip", async () => {
  workItemStore.clear();
  const created = workItemStore.create(baseJob("job-skip-iso01"));
  chainToComplete(created.id, "job-skip-iso01");
  const out = await maybeOpenPrForCompletedJob("job-skip-iso01");
  assert.equal(out.opened, false);
  if (!out.opened) assert.equal(out.skipped, "not-isolated");
  const events = workItemStore.get("job-skip-iso01")?.timeline ?? [];
  const skip = events.find((e) => e.message.startsWith("pr skipped:"));
  assert.ok(skip, "skip debe quedar en el timeline");
  assert.match(skip?.message ?? "", /not-isolated/);
  assert.match(skip?.message ?? "", /worktree/);
});

test("bad-branch: rama sin patrón issue-N deja evento honesto de skip", async () => {
  workItemStore.clear();
  const created = workItemStore.create(baseJob("job-skip-iso02"));
  chainToComplete(created.id, "job-skip-iso02");
  const wi = workItemStore.get("job-skip-iso02") as unknown as Record<
    string,
    unknown
  >;
  wi["isolation"] = {
    branch: "feature/sin-patron",
    baseBranch: "main",
    worktreePath: "C:/tmp/pr-skip-honest-wt",
    repoRoot: "C:/tmp/pr-skip-honest",
    state: "created",
    createdAt: new Date().toISOString(),
  };
  const out = await maybeOpenPrForCompletedJob("job-skip-iso02");
  assert.equal(out.opened, false);
  if (!out.opened) assert.equal(out.skipped, "bad-branch");
  const events = workItemStore.get("job-skip-iso02")?.timeline ?? [];
  const skip = events.find((e) => e.message.startsWith("pr skipped:"));
  assert.ok(skip, "skip debe quedar en el timeline");
  assert.match(skip?.message ?? "", /bad-branch/);
  assert.match(skip?.message ?? "", /feature\/sin-patron/);
});
