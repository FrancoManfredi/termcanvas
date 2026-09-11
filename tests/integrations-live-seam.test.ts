/**
 * F1-T1 — live seam suite (contracts + vault, 100% offline, zero network).
 * `npx tsx --test tests/integrations-live-seam.test.ts` (offline, no daemon).
 *
 * Covers the T1 DONE slice:
 * - Mock-local P0 contract intact (mode/provider allowlist, secret-forbidden).
 * - LiveSectionSchema additive: defaults off, vaultRef demanded when live,
 *   secret-looking keys refused, strict on unknown keys.
 * - IntakeEvent / IntegrationRef / PostBack shapes (valid + boundary fails).
 * - Loop-cap constants (WEBHOOK_DEDUPE_MAX / POSTBACK_MAX_ATTEMPTS / REF_MAX).
 * - vault.ts: env-name refs only, hasLiveCredentials gate, redact() scrubs
 *   every occurrence and never leaks a value; zero disk writes.
 * - index-live.ts seam: single barrel resolves, filter accept-all via seam.
 *
 * Sandbox: none needed (no disk touched). Env names used here are
 * test-scoped and restored after the run. ESM only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FilterNodeSchema,
  IntakeEventSchema,
  IntegrationRefSchema,
  IntegrationsSectionSchema,
  LiveSectionSchema,
  PostBackSchema,
  INTEGRATION_REF_MAX,
  POSTBACK_MAX_ATTEMPTS,
  WEBHOOK_DEDUPE_MAX,
} from "../headless-runtime/factory/integrations/integrationTypes.ts";
import {
  hasLiveCredentials,
  readRef,
  redact,
  vault,
} from "../headless-runtime/factory/integrations/vault.ts";
import * as indexLive from "../headless-runtime/factory/integrations/index-live.ts";

// ── Offline guard: the seam must never touch the network ──

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("real network forbidden in tests (live seam is offline)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "suite is offline: fetch never called");
});

// ── Test-scoped env names (values are random, never real secrets) ──

const ENV_NAME = "TERMCANVAS_TEST_F1T1_VAULT_KEY";
const ENV_VALUE = `t1-val-${Date.now().toString(36)}-x7q2`;
test.beforeEach(() => {
  try {
    delete process.env[ENV_NAME];
  } catch {
    // env reset never blocks a test
  }
});
test.after(() => {
  try {
    delete process.env[ENV_NAME];
  } catch {
    // cleanup is best-effort
  }
});

// ── Mock-local P0 intact ──

test("mock-local section still parses with P0 defaults", { timeout: 15000 }, () => {
  const parsed = IntegrationsSectionSchema.safeParse({
    enabled: true,
    mode: "mock-local",
    provider: "linear",
  });
  assert.equal(parsed.success, true);
});

test("mock-local rejects live mode, slack, and secret fields", { timeout: 15000 }, () => {
  assert.equal(
    IntegrationsSectionSchema.safeParse({ enabled: true, mode: "live", provider: "linear" }).success,
    false,
  );
  assert.equal(
    IntegrationsSectionSchema.safeParse({ enabled: true, mode: "mock-local", provider: "slack" }).success,
    false,
  );
  for (const key of ["token", "webhookSecret", "api_key", "bearer"]) {
    const parsed = IntegrationsSectionSchema.safeParse({
      enabled: true,
      mode: "mock-local",
      provider: "linear",
      [key]: "some-value",
    });
    assert.equal(parsed.success, false, `secret field "${key}" must stay forbidden`);
  }
});

// ── LiveSection additive ──

test("live section defaults to off (mock-local behavior preserved)", { timeout: 15000 }, () => {
  const parsed = LiveSectionSchema.safeParse({});
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.liveMode, false);
  assert.equal(parsed.data.provider, "linear");
  assert.equal(parsed.data.vaultRef, "");
  assert.equal(parsed.data.allowPostBack, true);
  assert.equal(parsed.data.filter, undefined);
});

test("liveMode:true demands a vaultRef env name, never a value", { timeout: 15000 }, () => {
  assert.equal(LiveSectionSchema.safeParse({ liveMode: true }).success, false);
  assert.equal(LiveSectionSchema.safeParse({ liveMode: true, vaultRef: "" }).success, false);
  const ok = LiveSectionSchema.safeParse({ liveMode: true, vaultRef: "LINEAR_API_KEY" });
  assert.equal(ok.success, true);
});

test("live section is strict and refuses secret-looking keys", { timeout: 15000 }, () => {
  assert.equal(
    LiveSectionSchema.safeParse({ liveMode: false, unknownKey: 1 }).success,
    false,
  );
  assert.equal(
    LiveSectionSchema.safeParse({ liveMode: true, vaultRef: "K", token: "abc" }).success,
    false,
  );
});

test("live filter example from the plan validates", { timeout: 15000 }, () => {
  const parsed = LiveSectionSchema.safeParse({
    liveMode: false,
    provider: "linear",
    allowPostBack: true,
    filter: {
      op: "or",
      any: [
        { field: "label", equals: "factory" },
        { field: "titleContains", contains: "bug" },
      ],
    },
  });
  assert.equal(parsed.success, true);
});

// ── Intake / ref / post-back shapes ──

test("intake event: minimal valid applies safe defaults", { timeout: 15000 }, () => {
  const parsed = IntakeEventSchema.safeParse({
    provider: "linear",
    threadId: "LIN-42",
    title: "Fix the badge",
    eventId: "evt-1",
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.replyTo, null);
  assert.equal(parsed.data.author, "");
  assert.equal(parsed.data.body, "");
  assert.deepEqual(parsed.data.labels, []);
});

test("intake event: reply shape and boundary fails", { timeout: 15000 }, () => {
  const reply = IntakeEventSchema.safeParse({
    provider: "slack",
    threadId: "T-9",
    replyTo: "LIN-42",
    author: "bot",
    title: "re: badge",
    body: "same work item",
    labels: ["factory"],
    eventId: "evt-2",
  });
  assert.equal(reply.success, true);
  assert.equal(IntakeEventSchema.safeParse({ provider: "linear", threadId: "", title: "x", eventId: "e" }).success, false);
  assert.equal(IntakeEventSchema.safeParse({ provider: "linear", threadId: "t", title: "", eventId: "e" }).success, false);
  assert.equal(
    IntakeEventSchema.safeParse({ provider: "linear", threadId: "t", title: "x", eventId: "e", labels: new Array(21).fill("l") }).success,
    false,
  );
});

test("integration ref and post-back kinds validate", { timeout: 15000 }, () => {
  assert.equal(
    IntegrationRefSchema.safeParse({ provider: "linear", threadId: "LIN-1", eventId: "e1" }).success,
    true,
  );
  const postback = PostBackSchema.safeParse({ jobId: "job-1", threadId: "LIN-1", kind: "ask_human", title: "Need input" });
  assert.equal(postback.success, true);
  if (!postback.success) return;
  assert.equal(postback.data.body, "");
  for (const kind of ["complete", "ask_human", "proposal-ready", "benchmark-done"]) {
    assert.equal(
      PostBackSchema.safeParse({ jobId: "j", threadId: "t", kind, title: "ok" }).success,
      true,
      `kind "${kind}" must validate`,
    );
  }
  assert.equal(
    PostBackSchema.safeParse({ jobId: "j", threadId: "t", kind: "shipped", title: "ok" }).success,
    false,
  );
});

test("filter leaf exactly-one rule holds (both set / neither set fail)", { timeout: 15000 }, () => {
  assert.equal(FilterNodeSchema.safeParse({ field: "author", equals: "bot" }).success, true);
  assert.equal(FilterNodeSchema.safeParse({ field: "author" }).success, false);
  assert.equal(FilterNodeSchema.safeParse({ field: "author", equals: "a", contains: "b" }).success, false);
  assert.equal(FilterNodeSchema.safeParse({ field: "nope", equals: "a" }).success, false);
  assert.equal(FilterNodeSchema.safeParse({ op: "and", all: [] }).success, false);
});

test("loop-cap constants match the plan (500 / 3 / 1)", { timeout: 15000 }, () => {
  assert.equal(WEBHOOK_DEDUPE_MAX, 500);
  assert.equal(POSTBACK_MAX_ATTEMPTS, 3);
  assert.equal(INTEGRATION_REF_MAX, 1);
});

// ── vault.ts ──

test("readRef resolves names only, never values-as-names", { timeout: 15000 }, () => {
  assert.equal(readRef(""), null);
  assert.equal(readRef("   "), null);
  assert.equal(readRef("not set (bad name!)"), null);
  assert.equal(readRef("TERMCANVAS_TEST_F1T1_MISSING_XYZ"), null);
  process.env[ENV_NAME] = ENV_VALUE;
  assert.equal(readRef(ENV_NAME), ENV_VALUE);
  assert.equal(readRef(`  ${ENV_NAME}  `), ENV_VALUE);
});

test("hasLiveCredentials gates on opt-in plus a resolving ref", { timeout: 15000 }, () => {
  assert.equal(hasLiveCredentials({ liveMode: false, vaultRef: ENV_NAME } as never), false);
  process.env[ENV_NAME] = ENV_VALUE;
  assert.equal(hasLiveCredentials({ liveMode: false, vaultRef: ENV_NAME } as never), false);
  assert.equal(hasLiveCredentials({ liveMode: true, vaultRef: "" } as never), false);
  assert.equal(hasLiveCredentials({ liveMode: true, vaultRef: "TERMCANVAS_TEST_F1T1_MISSING_XYZ" } as never), false);
  assert.equal(hasLiveCredentials({ liveMode: true, vaultRef: ENV_NAME } as never), true);
  assert.equal(hasLiveCredentials(null as never), false);
});

test("redact scrubs every occurrence and never leaks the value", { timeout: 15000 }, () => {
  process.env[ENV_NAME] = ENV_VALUE;
  const line = `posting with ${ENV_VALUE} and again ${ENV_VALUE} done`;
  const scrubbed = redact(line, [ENV_NAME]);
  assert.equal(scrubbed.includes(ENV_VALUE), false);
  assert.equal(scrubbed, "posting with *** and again *** done");
  assert.equal(redact("clean line, no secrets", [ENV_NAME]), "clean line, no secrets");
  assert.equal(redact("anything", ["TERMCANVAS_TEST_F1T1_MISSING_XYZ"]), "anything");
  assert.equal(redact("", [ENV_NAME]), "");
});

test("vault object exposes the three port functions", { timeout: 15000 }, () => {
  assert.equal(typeof vault.readRef, "function");
  assert.equal(typeof vault.hasLiveCredentials, "function");
  assert.equal(typeof vault.redact, "function");
});

// ── index-live seam ──

test("index-live barrel resolves and matches accept-all through the seam", { timeout: 15000 }, () => {
  assert.equal(typeof indexLive.matchesIntakeFilter, "function");
  assert.equal(typeof indexLive.explainIntakeFilter, "function");
  assert.equal(typeof indexLive.readRef, "function");
  assert.equal(typeof indexLive.redact, "function");
  assert.equal(typeof indexLive.LiveSectionSchema, "object");
  assert.equal(typeof indexLive.FilterNodeSchema, "object");
  const ev = IntakeEventSchema.parse({ provider: "linear", threadId: "LIN-1", title: "t", eventId: "e1" });
  assert.equal(indexLive.matchesIntakeFilter(undefined, ev), true);
  assert.equal(indexLive.explainIntakeFilter(undefined, ev), "accept-all (no filter)");
});
