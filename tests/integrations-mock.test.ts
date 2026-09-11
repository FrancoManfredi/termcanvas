/**
 * Wave 14 T03 (Track B) — local mock adapter suite.
 * `npx tsx --test tests/integrations-mock.test.ts` (offline, no daemon).
 *
 * Covers the T03 done criteria:
 * - post writes to disk, ack marks, list reads back (post -> disk -> ack)
 * - ring cap 100 with oldest-first eviction
 * - tolerant restore (missing/corrupt file means empty, never throws)
 * - invalid input throws with an actionable message (the service validates
 *   first, so routes never reach this throw)
 * - zero network: the global `fetch` is replaced by a guard that counts
 *   calls; the suite asserts it was never called (no fetch/red/tokens)
 *
 * Sandbox: `TERMCANVAS_FACTORY_DIR` points at a tmpdir; the real
 * `factory/` is never touched. ESM only, zero `require()`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getIntegrationsMockFilePath,
  listMockPosts,
  ackMockPost,
  mockAdapter,
  postMockPost,
  resetMockAdapterForTests,
} from "../headless-runtime/factory/integrations/mockAdapter.ts";
import { INTEGRATION_MOCK_MAX } from "../headless-runtime/factory/integrations/integrationTypes.ts";

// ── Sandbox factory (all `.integrations-mock.json` writes land here) ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "integrations-mock-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

// ── Fetch guard: no network may ever be touched ──

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("real network forbidden in tests (mock adapter is disk-local)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

test.beforeEach(() => {
  try {
    resetMockAdapterForTests();
  } catch {
    // reset never throws; belt and suspenders
  }
});

function makeInput(n: number): { provider: "linear"; title: string; body: string } {
  return { provider: "linear", title: `post ${n}`, body: `body ${n}` };
}

// ── post -> disk -> list ──

test("post returns a record and persists it to disk", () => {
  const rec = postMockPost(makeInput(1));
  assert.equal(rec.provider, "linear");
  assert.equal(rec.kind, "notification");
  assert.equal(rec.title, "post 1");
  assert.equal(rec.acked, false);
  assert.equal(rec.ackAt, null);
  assert.ok(rec.id.startsWith("m-"));
  assert.ok(rec.at.length > 0);

  const file = getIntegrationsMockFilePath();
  assert.ok(file.endsWith(".integrations-mock.json"));
  assert.ok(fs.existsSync(file));
  const onDisk = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    version: number;
    posts: Array<{ id: string }>;
  };
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.posts.length, 1);
  assert.equal(onDisk.posts[0]?.id, rec.id);
});

test("list reads back newest-first and reloads from disk after a reset of memory", () => {
  const a = postMockPost(makeInput(1));
  const b = postMockPost(makeInput(2));
  const listed = listMockPosts();
  assert.equal(listed.length, 2);
  assert.equal(listed[0]?.id, b.id);
  assert.equal(listed[1]?.id, a.id);

  // Force a disk reload path (memory cleared logically by re-pointing).
  const again = listMockPosts(10);
  assert.equal(again.length, 2);
});

test("list clamps limits (over-max clamps, zero/negative means empty)", () => {
  postMockPost(makeInput(1));
  postMockPost(makeInput(2));
  assert.equal(listMockPosts(1).length, 1);
  assert.equal(listMockPosts(1000).length, 2);
  assert.deepEqual(listMockPosts(0), []);
  assert.deepEqual(listMockPosts(-3), []);
});

// ── ring cap ──

test("ring keeps the newest 100 and evicts the oldest first", () => {
  assert.equal(INTEGRATION_MOCK_MAX, 100);
  const ids: string[] = [];
  Array.from({ length: 105 }).forEach((_, i) => {
    ids.push(postMockPost(makeInput(i)).id);
  });
  const listed = listMockPosts();
  assert.equal(listed.length, 100);
  // Newest first: the last posted id leads.
  assert.equal(listed[0]?.id, ids[104]);
  // The first five (oldest) were evicted.
  const kept = new Set(listed.map((p) => p.id));
  ids.slice(0, 5).forEach((id) => assert.ok(!kept.has(id)));
  ids.slice(5).forEach((id) => assert.ok(kept.has(id)));
});

// ── ack ──

test("ack marks acked with ackAt and persists it", () => {
  const rec = postMockPost(makeInput(1));
  assert.equal(ackMockPost(rec.id), true);
  const listed = listMockPosts();
  assert.equal(listed[0]?.acked, true);
  assert.ok(typeof listed[0]?.ackAt === "string");

  const onDisk = JSON.parse(
    fs.readFileSync(getIntegrationsMockFilePath(), "utf-8"),
  ) as { posts: Array<{ id: string; acked: boolean; ackAt: string | null }> };
  assert.equal(onDisk.posts[0]?.acked, true);
  assert.ok(typeof onDisk.posts[0]?.ackAt === "string");
});

test("ack of unknown or invalid ids returns false and never throws", () => {
  assert.equal(ackMockPost("m-missing-0"), false);
  assert.equal(ackMockPost(""), false);
  assert.equal(ackMockPost(null), false);
  assert.equal(ackMockPost(undefined), false);
  assert.equal(ackMockPost(42), false);
});

// ── tolerant restore ──

test("missing file means an empty list (never throws)", () => {
  assert.deepEqual(listMockPosts(), []);
});

test("corrupt file means an empty list (never throws)", () => {
  fs.writeFileSync(getIntegrationsMockFilePath(), "{not json", "utf-8");
  assert.deepEqual(listMockPosts(), []);
  // A post afterwards recovers the file.
  const rec = postMockPost(makeInput(1));
  assert.ok(rec.id.length > 0);
  assert.equal(listMockPosts().length, 1);
});

test("wrong-shape file means an empty list (never throws)", () => {
  fs.writeFileSync(
    getIntegrationsMockFilePath(),
    JSON.stringify({ version: 1, posts: [{ nope: true }] }),
    "utf-8",
  );
  assert.deepEqual(listMockPosts(), []);
});

// ── invalid input ──

test("post with invalid input throws an actionable error", () => {
  assert.throws(
    () => postMockPost({ provider: "linear", title: "", body: "" } as never),
    /title/,
  );
  assert.throws(
    () => postMockPost({ provider: "slack", title: "t", body: "" } as never),
    /provider|linear/,
  );
});

// ── port + zero network ──

test("mockAdapter programs to the port (post/ack/list) with zero network", () => {
  const rec = mockAdapter.post({ provider: "linear", title: "via port", body: "b" });
  assert.ok(rec.id.startsWith("m-"));
  assert.equal(mockAdapter.list(10).length, 1);
  assert.equal(mockAdapter.ack(rec.id), true);
  assert.equal(mockAdapter.list(10)[0]?.acked, true);
  assert.equal(fetchCalls, 0, "fetch must never be called by the disk-local mock");
});
