/**
 * warp-poll-identity — perf Ola 4 (steady-state poll storm).
 *
 * Root cause: the shared 2.5s loop called `setWorkItems(freshArray)` every
 * tick, and the setter ALWAYS minted a new array identity plus a fresh
 * `lastUpdatedAt` — even when the daemon reported zero changes. Every
 * `workItems` subscriber (`useIssues`, `useActivity`) re-rendered and both
 * warp snapshots rebuilt on each tick in steady state.
 *
 * Fix (`src/stores/workItemStore.ts`): `setWorkItems`/`setForemanLogs`
 * compare cheap change signatures first; an unchanged payload keeps the old
 * array identity and skips the `lastUpdatedAt` bump, so the tick is a
 * downstream no-op. Fail-open: junk/throws force the update (old behavior).
 * Offline: pure, zero network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  foremanLogsSignature,
  workItemListSignature,
  useWorkItemStore,
} from "../src/stores/workItemStore.ts";
import type { WorkItem } from "../../shared/types/workItem.ts";

function job(overrides: Record<string, unknown> = {}): WorkItem {
  return {
    id: "job-abc",
    status: "Building",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    phase: "diagnosisLlm",
    timeline: [],
    ...overrides,
  } as unknown as WorkItem;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

test("identical payloads share a signature across identities", () => {
  const a = [job(), job({ id: "job-def", status: "Review" })];
  const b = clone(a);
  assert.notEqual(a, b);
  assert.equal(workItemListSignature(a), workItemListSignature(b));
});

test("real changes move the signature", () => {
  const base = [job()];
  assert.notEqual(
    workItemListSignature(base),
    workItemListSignature([job({ status: "Review" })]),
  );
  assert.notEqual(
    workItemListSignature(base),
    workItemListSignature([job({ updatedAt: "2026-06-06T00:00:00.000Z" })]),
  );
  assert.notEqual(
    workItemListSignature(base),
    workItemListSignature([
      job({ timeline: [{ id: "t1", at: "2026-01-01T00:00:02.000Z" }] }),
    ]),
  );
  assert.notEqual(
    workItemListSignature(base),
    workItemListSignature([
      job({ isolation: { prNumber: 61, prUrl: "https://x/y/pull/61" } }),
    ]),
  );
  assert.notEqual(workItemListSignature(base), workItemListSignature([]));
  assert.equal(workItemListSignature([]), workItemListSignature([]));
});

test("signatures never throw on junk", () => {
  assert.equal(typeof workItemListSignature(null), "string");
  assert.equal(typeof workItemListSignature("junk"), "string");
  assert.equal(typeof workItemListSignature([null, 42]), "string");
  assert.equal(typeof foremanLogsSignature(null), "string");
  assert.equal(typeof foremanLogsSignature("junk"), "string");
});

test("foreman window catches appends and rotations", () => {
  const log = (id: string, at: string): unknown => ({
    id,
    at,
    level: "info",
    message: "m",
    workItemId: "job-abc",
    decision: {},
  });
  const a = [log("1", "t1"), log("2", "t2")];
  assert.equal(foremanLogsSignature(a), foremanLogsSignature(clone(a)));
  assert.notEqual(
    foremanLogsSignature(a),
    foremanLogsSignature([...a, log("3", "t3")]),
  );
  // Same length, rotated window (limit truncation) still moves the signature.
  assert.notEqual(
    foremanLogsSignature(a),
    foremanLogsSignature([log("2", "t2"), log("3", "t3")]),
  );
});

test("setWorkItems keeps identity + timestamp on unchanged payload", () => {
  const store = useWorkItemStore.getState();
  store.setWorkItems([]);
  const first = [job(), job({ id: "job-def" })];
  store.setWorkItems(first);
  const at = useWorkItemStore.getState().lastUpdatedAt;
  assert.ok(typeof at === "string" && at.length > 0);
  // Same content, fresh identity (what the poll delivers every tick).
  store.setWorkItems(clone(first));
  const after = useWorkItemStore.getState();
  assert.equal(after.workItems, first);
  assert.equal(after.lastUpdatedAt, at);
  // Real change → new identity + fresh timestamp.
  store.setWorkItems([job({ status: "Complete" })]);
  const changed = useWorkItemStore.getState();
  assert.notEqual(changed.workItems, first);
  assert.notEqual(changed.lastUpdatedAt, at);
  store.setWorkItems([]);
});
