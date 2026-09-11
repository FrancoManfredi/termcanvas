/**
 * F1-T2 — post-back suite (liveAdapter + service reconcile, 100% offline).
 * `npx tsx --test tests/integrations-postback.test.ts` (offline, no daemon).
 *
 * Covers the T2 DONE slice for post-back:
 * - liveAdapter.postBack with INJECTED fetch: success maps remoteId with
 *   attempts 1; flaky-then-ok retries within the cap; always-failing ends
 *   ok:false after EXACTLY 3 attempts (LOOPS L-IN-02); a throwing fetch
 *   never escapes (ok:false value, never a throw).
 * - Zero secrets: the secret reaches the wire (Authorization header) but
 *   NO captured log line contains it (every line goes through redact()).
 * - No credentials (vaultRef unset) performs ZERO fetches (attempts 0).
 * - Explicit timeouts: a never-resolving fetch with timeoutMs 50 ends
 *   bounded (3 attempts, fast) instead of hanging.
 * - Service reconcile: liveMode:false records through the exact mock-local
 *   writer (via:"mock", mock id); liveMode:true with injected fetch goes
 *   live (via:"live"); allowPostBack:false refuses 409; invalid input is
 *   400; reconcileAckNotification acks honestly and never throws.
 *
 * Sandbox: `TERMCANVAS_FACTORY_DIR` points at a tmpdir for the mock path.
 * The global `fetch` is guarded: only the INJECTED mock may be called.
 * ESM only, zero `require()`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "postback-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import {
  LIVE_ADAPTER_DEFAULT_TIMEOUT_MS,
  createLiveAdapter,
} from "../headless-runtime/factory/integrations/liveAdapter.ts";
import type { FetchLike } from "../headless-runtime/factory/integrations/liveAdapter.ts";
import {
  postBackToThread,
  reconcileAckNotification,
} from "../headless-runtime/factory/integrations/integrationService.ts";
import { POSTBACK_MAX_ATTEMPTS } from "../headless-runtime/factory/integrations/integrationTypes.ts";
import { resetMockAdapterForTests } from "../headless-runtime/factory/integrations/mockAdapter.ts";

// ── Offline guard: only the injected mock fetch may run ──

let realFetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  realFetchCalls += 1;
  throw new Error("real network forbidden in tests (post-back uses injected fetch)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
  assert.equal(realFetchCalls, 0, "suite is offline: real fetch never called");
});

// ── Test-scoped credential (random value, never a real secret) ──

const ENV_NAME = "TERMCANVAS_TEST_F1T2_POSTBACK_KEY";
const ENV_VALUE = `f1t2-pb-${Date.now().toString(36)}-s3cr3t`;
test.before(() => {
  process.env[ENV_NAME] = ENV_VALUE;
});
test.after(() => {
  try {
    delete process.env[ENV_NAME];
  } catch {
    // cleanup is best-effort
  }
});
test.beforeEach(() => {
  try {
    resetMockAdapterForTests();
  } catch {
    // reset never blocks a test
  }
});

// ── Injected fetch doubles ──

function okFetch(seen: { calls: number; auth: Array<string | null> }): FetchLike {
  return (async (_url, init) => {
    seen.calls += 1;
    try {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen.auth.push(typeof h.authorization === "string" ? h.authorization : null);
    } catch {
      seen.auth.push(null);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "rem-1" }) };
  }) as FetchLike;
}

function flakyFetch(seen: { calls: number }): FetchLike {
  return (async () => {
    seen.calls += 1;
    if (seen.calls < 3) return { ok: false, status: 500, text: async () => "boom" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ remoteId: "rem-3" }) };
  }) as FetchLike;
}

function failingFetch(seen: { calls: number }): FetchLike {
  return (async () => {
    seen.calls += 1;
    return { ok: false, status: 503, text: async () => "down" };
  }) as FetchLike;
}

function throwingFetch(seen: { calls: number }): FetchLike {
  return (async () => {
    seen.calls += 1;
    throw new Error("socket hangup");
  }) as FetchLike;
}

function hangingFetch(seen: { calls: number }): FetchLike {
  return ((_url, init) => {
    seen.calls += 1;
    void init;
    return new Promise<never>(() => {
      // never resolves: the explicit timeout must bound it
    });
  }) as unknown as FetchLike;
}

function postBackInput(over?: Record<string, unknown>) {
  return {
    jobId: "job-1",
    threadId: "LIN-42",
    kind: "complete",
    title: "Done: badge fixed",
    body: "evidence attached",
    ...over,
  };
}

function captureLogger(): { lines: string[]; fn: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    fn: (line: string) => {
      lines.push(line);
    },
  };
}

// ── liveAdapter.postBack ──

test("post-back success maps the remote id with one attempt", { timeout: 15000 }, async () => {
  const seen = { calls: 0, auth: [] as Array<string | null> };
  const log = captureLogger();
  const adapter = createLiveAdapter({
    vaultRef: ENV_NAME,
    webhookSecretRef: "",
    fetchImpl: okFetch(seen),
    timeoutMs: 5000,
    logger: log.fn,
  });
  const res = await adapter.postBack(postBackInput());
  assert.equal(res.ok, true);
  assert.equal(res.remoteId, "rem-1");
  assert.equal(res.attempts, 1);
  assert.equal(seen.calls, 1);
  assert.equal(seen.auth[0], `Bearer ${ENV_VALUE}`);
  assert.ok(log.lines.length > 0);
  for (const line of log.lines) {
    assert.equal(line.includes(ENV_VALUE), false, "no log line may carry the secret");
  }
});

test("post-back retries a flaky endpoint within the cap", { timeout: 15000 }, async () => {
  const seen = { calls: 0 };
  const adapter = createLiveAdapter({
    vaultRef: ENV_NAME,
    fetchImpl: flakyFetch(seen),
    timeoutMs: 5000,
  });
  const res = await adapter.postBack(postBackInput({ kind: "ask_human" }));
  assert.equal(res.ok, true);
  assert.equal(res.remoteId, "rem-3");
  assert.equal(res.attempts, 3);
  assert.equal(seen.calls, 3);
});

test("post-back ends honest after exactly 3 attempts on persistent failure", { timeout: 15000 }, async () => {
  assert.equal(POSTBACK_MAX_ATTEMPTS, 3);
  const seen = { calls: 0 };
  const adapter = createLiveAdapter({
    vaultRef: ENV_NAME,
    fetchImpl: failingFetch(seen),
    timeoutMs: 5000,
  });
  const res = await adapter.postBack(postBackInput());
  assert.equal(res.ok, false);
  assert.equal(res.remoteId, null);
  assert.equal(res.attempts, 3);
  assert.equal(seen.calls, 3);
  assert.ok(res.note.includes("3 attempts"));
});

test("post-back survives a throwing fetch as a value (never throws)", { timeout: 15000 }, async () => {
  const seen = { calls: 0 };
  const adapter = createLiveAdapter({
    vaultRef: ENV_NAME,
    fetchImpl: throwingFetch(seen),
    timeoutMs: 5000,
  });
  const res = await adapter.postBack(postBackInput());
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
  assert.equal(seen.calls, 3);
});

test("post-back without credentials performs zero fetches", { timeout: 15000 }, async () => {
  const seen = { calls: 0 };
  const adapter = createLiveAdapter({ fetchImpl: failingFetch(seen), timeoutMs: 5000 });
  const res = await adapter.postBack(postBackInput());
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 0);
  assert.equal(seen.calls, 0);
});

test("post-back validates input before any fetch", { timeout: 15000 }, async () => {
  const seen = { calls: 0 };
  const adapter = createLiveAdapter({
    vaultRef: ENV_NAME,
    fetchImpl: failingFetch(seen),
    timeoutMs: 5000,
  });
  const res = await adapter.postBack({ jobId: "j", threadId: "t", kind: "shipped", title: "x" });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 0);
  assert.equal(seen.calls, 0);
});

test("post-back explicit timeout bounds a hanging endpoint", { timeout: 15000 }, async () => {
  const seen = { calls: 0 };
  const adapter = createLiveAdapter({
    vaultRef: ENV_NAME,
    fetchImpl: hangingFetch(seen),
    timeoutMs: 50,
  });
  const started = Date.now();
  const res = await adapter.postBack(postBackInput());
  const elapsed = Date.now() - started;
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
  assert.equal(seen.calls, 3);
  assert.ok(elapsed < 10000, `bounded by explicit timeouts (took ${elapsed}ms)`);
});

test("live adapter exposes an explicit default timeout", { timeout: 15000 }, () => {
  assert.equal(LIVE_ADAPTER_DEFAULT_TIMEOUT_MS, 15000);
});

// ── service reconcile ──

test("service post-back with liveMode:false records via the exact mock writer", { timeout: 15000 }, async () => {
  const res = await postBackToThread(postBackInput(), {
    factoryDir: SANDBOX_FACTORY,
    live: {
      liveMode: false,
      provider: "linear",
      vaultRef: "",
      webhookSecretRef: "",
      allowPostBack: true,
    },
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.via, "mock");
  assert.ok(typeof res.remoteId === "string" && res.remoteId.startsWith("m-"));
  assert.equal(res.attempts, 0);
});

test("service post-back live with injected fetch goes live", { timeout: 15000 }, async () => {
  const seen = { calls: 0, auth: [] as Array<string | null> };
  const res = await postBackToThread(postBackInput({ kind: "proposal-ready" }), {
    live: {
      liveMode: true,
      provider: "linear",
      vaultRef: ENV_NAME,
      webhookSecretRef: "",
      allowPostBack: true,
    },
    fetchImpl: okFetch(seen),
    timeoutMs: 5000,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.via, "live");
  assert.equal(res.remoteId, "rem-1");
  assert.equal(seen.calls, 1);
});

test("service post-back refuses honestly on bad input, disabled switch, and garbage", { timeout: 15000 }, async () => {
  const bad = await postBackToThread({ nope: true });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.equal(bad.code, 400);
  const disabled = await postBackToThread(postBackInput(), {
    live: {
      liveMode: true,
      provider: "linear",
      vaultRef: ENV_NAME,
      webhookSecretRef: "",
      allowPostBack: false,
    },
    fetchImpl: okFetch({ calls: 0, auth: [] }),
    timeoutMs: 5000,
  });
  assert.equal(disabled.ok, false);
  if (disabled.ok) return;
  assert.equal(disabled.code, 409);
  for (const garbage of [null, "x", 42]) {
    const res = await postBackToThread(garbage);
    assert.equal(res.ok, false, "garbage must be a value, never a throw");
  }
});

test("reconcileAckNotification acks honestly and never throws", { timeout: 15000 }, async () => {
  const recorded = await postBackToThread(postBackInput(), {
    factoryDir: SANDBOX_FACTORY,
    live: {
      liveMode: false,
      provider: "linear",
      vaultRef: "",
      webhookSecretRef: "",
      allowPostBack: true,
    },
  });
  assert.equal(recorded.ok, true);
  if (!recorded.ok || recorded.remoteId === null) return;
  assert.deepEqual(reconcileAckNotification(recorded.remoteId), { ok: true, acked: true });
  assert.equal(reconcileAckNotification("m-missing").acked, false);
  assert.equal(reconcileAckNotification(null).acked, false);
  assert.equal(reconcileAckNotification(42).acked, false);
});
