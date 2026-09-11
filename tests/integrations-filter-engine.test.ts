/**
 * F1-T1 — filter engine suite (pure matcher, 100% offline, zero network).
 * `npx tsx --test tests/integrations-filter-engine.test.ts` (offline).
 *
 * Covers the T1 DONE slice for `filterEngine.ts` (event x filter -> bool
 * plus one-line `explain`): accept-all, leaf equals/contains per field,
 * label membership semantics, AND/OR/NOT plus nesting, fail-closed invalid
 * shapes, single-line explain guarantee, and port-object parity
 * (`filterEngine` delegates to the exported pure functions).
 * ESM only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { IntakeEventSchema } from "../headless-runtime/factory/integrations/integrationTypes.ts";
import type {
  IntakeEvent,
  IntakeFilter,
} from "../headless-runtime/factory/integrations/integrationTypes.ts";
import {
  explainIntakeFilter,
  filterEngine,
  matchesIntakeFilter,
} from "../headless-runtime/factory/integrations/filterEngine.ts";

// ── Offline guard: the pure engine must never touch the network ──

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("real network forbidden in tests (filter engine is pure)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "suite is offline: fetch never called");
});

// ── Fixtures ──

function makeEvent(overrides?: Partial<IntakeEvent>): IntakeEvent {
  return IntakeEventSchema.parse({
    provider: "linear",
    threadId: "LIN-42",
    replyTo: null,
    author: "bot",
    title: "Fix the cost badge",
    body: "the badge shows USD 0.00 as data",
    labels: ["factory", "bug"],
    eventId: "evt-1",
    ...overrides,
  });
}

const BASE = makeEvent();
const bad = (v: unknown): IntakeFilter => v as IntakeFilter;

// ── Accept-all + leaves ──

test("absent filter accepts all, with the documented explain line", { timeout: 15000 }, () => {
  assert.equal(matchesIntakeFilter(undefined, BASE), true);
  assert.equal(explainIntakeFilter(undefined, BASE), "accept-all (no filter)");
});

test("leaf equals matches exactly per field (case-sensitive)", { timeout: 15000 }, () => {
  assert.equal(matchesIntakeFilter({ field: "author", equals: "bot" }, BASE), true);
  assert.equal(matchesIntakeFilter({ field: "author", equals: "Bot" }, BASE), false);
  assert.equal(matchesIntakeFilter({ field: "event", equals: "linear" }, BASE), true);
  assert.equal(matchesIntakeFilter({ field: "event", equals: "slack" }, BASE), false);
  assert.equal(matchesIntakeFilter({ field: "project", equals: "LIN-42" }, BASE), true);
});

test("leaf contains matches substrings of title and body", { timeout: 15000 }, () => {
  assert.equal(matchesIntakeFilter({ field: "titleContains", contains: "cost badge" }, BASE), true);
  assert.equal(matchesIntakeFilter({ field: "titleContains", contains: "missing" }, BASE), false);
  assert.equal(matchesIntakeFilter({ field: "bodyContains", contains: "USD 0.00" }, BASE), true);
  assert.equal(matchesIntakeFilter({ field: "bodyContains", contains: "usd 0.00" }, BASE), false);
});

test("label field: equals is membership, contains is substring of a label", { timeout: 15000 }, () => {
  assert.equal(matchesIntakeFilter({ field: "label", equals: "factory" }, BASE), true);
  assert.equal(matchesIntakeFilter({ field: "label", equals: "fact" }, BASE), false);
  assert.equal(matchesIntakeFilter({ field: "label", contains: "fact" }, BASE), true);
  assert.equal(matchesIntakeFilter({ field: "label", contains: "zzz" }, BASE), false);
  assert.equal(matchesIntakeFilter({ field: "label", equals: "factory" }, makeEvent({ labels: [] })), false);
});

test("exactly-one violations fail closed with a reject explain", { timeout: 15000 }, () => {
  for (const leaf of [{ field: "author" }, { field: "author", equals: "a", contains: "b" }, { field: "nope", equals: "a" }]) {
    assert.equal(matchesIntakeFilter(bad(leaf), BASE), false);
    const line = explainIntakeFilter(bad(leaf), BASE);
    assert.ok(line.includes("=> false"), `explain pins the verdict, got: ${line}`);
  }
});

// ── Combinators ──

test("and requires every child", { timeout: 15000 }, () => {
  const allTrue: IntakeFilter = {
    op: "and",
    all: [{ field: "author", equals: "bot" }, { field: "label", equals: "bug" }],
  };
  const oneFalse: IntakeFilter = {
    op: "and",
    all: [{ field: "author", equals: "bot" }, { field: "label", equals: "nope" }],
  };
  assert.equal(matchesIntakeFilter(allTrue, BASE), true);
  assert.equal(matchesIntakeFilter(oneFalse, BASE), false);
  assert.ok(explainIntakeFilter(allTrue, BASE).startsWith("and => true"));
  assert.ok(explainIntakeFilter(oneFalse, BASE).startsWith("and => false"));
});

test("or requires at least one child", { timeout: 15000 }, () => {
  const oneTrue: IntakeFilter = {
    op: "or",
    any: [{ field: "label", equals: "nope" }, { field: "titleContains", contains: "badge" }],
  };
  const noneTrue: IntakeFilter = {
    op: "or",
    any: [{ field: "label", equals: "nope" }, { field: "author", equals: "human" }],
  };
  assert.equal(matchesIntakeFilter(oneTrue, BASE), true);
  assert.equal(matchesIntakeFilter(noneTrue, BASE), false);
  assert.ok(explainIntakeFilter(oneTrue, BASE).startsWith("or => true"));
});

test("not negates the child verdict", { timeout: 15000 }, () => {
  assert.equal(matchesIntakeFilter({ op: "not", node: { field: "author", equals: "bot" } }, BASE), false);
  assert.equal(matchesIntakeFilter({ op: "not", node: { field: "author", equals: "human" } }, BASE), true);
  const line = explainIntakeFilter({ op: "not", node: { field: "author", equals: "human" } }, BASE);
  assert.ok(line.startsWith("not => true"), `got: ${line}`);
});

test("nesting composes (and of or plus not)", { timeout: 15000 }, () => {
  const nested: IntakeFilter = {
    op: "and",
    all: [
      { op: "or", any: [{ field: "label", equals: "nope" }, { field: "label", equals: "factory" }] },
      { op: "not", node: { field: "author", equals: "human" } },
    ],
  };
  assert.equal(matchesIntakeFilter(nested, BASE), true);
  const line = explainIntakeFilter(nested, BASE);
  assert.ok(line.startsWith("and => true"), `got: ${line}`);
  assert.ok(!line.includes("\n"), "explain stays one line");
  const flipped: IntakeFilter = {
    op: "and",
    all: [nested, { field: "author", equals: "human" }],
  };
  assert.equal(matchesIntakeFilter(flipped, BASE), false);
});

// ── Fail-closed + explain guarantees ──

test("malformed shapes fail closed (null, unknown op, empty kids)", { timeout: 15000 }, () => {
  assert.equal(matchesIntakeFilter(bad(null), BASE), false);
  assert.equal(matchesIntakeFilter(bad({ op: "xor", any: [] }), BASE), false);
  assert.equal(matchesIntakeFilter(bad({ op: "and", all: [] }), BASE), false);
  assert.equal(matchesIntakeFilter(bad({ op: "or", any: [] }), BASE), false);
  assert.equal(matchesIntakeFilter(bad({ op: "not" }), BASE), false);
  assert.equal(matchesIntakeFilter(bad("just-a-string"), BASE), false);
  for (const f of [bad(null), bad({ op: "xor" }), bad({ op: "not" })]) {
    assert.ok(explainIntakeFilter(f, BASE).startsWith("reject"), "malformed explains as reject");
  }
});

test("explain is always a single line, even with hostile values", { timeout: 15000 }, () => {
  const hostile = makeEvent({ title: "a\nb\rc", body: "x\ty" });
  const lines = [
    explainIntakeFilter(undefined, hostile),
    explainIntakeFilter({ field: "titleContains", contains: "a\nb" }, hostile),
    explainIntakeFilter({ op: "and", all: [{ field: "bodyContains", contains: "x" }] }, hostile),
    explainIntakeFilter(bad(null), hostile),
  ];
  for (const line of lines) {
    assert.ok(!line.includes("\n") && !line.includes("\r"), `one line, got: ${JSON.stringify(line)}`);
  }
});

test("explain pins the matches verdict on every shape", { timeout: 15000 }, () => {
  const filters: IntakeFilter[] = [
    { field: "author", equals: "bot" },
    { field: "author", equals: "human" },
    { op: "and", all: [{ field: "label", equals: "factory" }] },
    { op: "or", any: [{ field: "label", equals: "zzz" }] },
    { op: "not", node: { field: "label", equals: "zzz" } },
  ];
  for (const f of filters) {
    const verdict = matchesIntakeFilter(f, BASE);
    assert.ok(explainIntakeFilter(f, BASE).endsWith(`=> ${verdict}`) || explainIntakeFilter(f, BASE).includes(`=> ${verdict} `) || explainIntakeFilter(f, BASE).includes(`=> ${verdict} [`));
  }
});

test("filterEngine port object delegates to the pure functions", { timeout: 15000 }, () => {
  const f: IntakeFilter = { field: "label", equals: "bug" };
  assert.equal(filterEngine.matches(f, BASE), matchesIntakeFilter(f, BASE));
  assert.equal(filterEngine.explain(f, BASE), explainIntakeFilter(f, BASE));
  assert.equal(filterEngine.matches(undefined, BASE), true);
});

test("reply continuation identity fields do not affect matching", { timeout: 15000 }, () => {
  const reply = makeEvent({ threadId: "LIN-42", replyTo: "LIN-42", eventId: "evt-9" });
  assert.equal(matchesIntakeFilter({ field: "project", equals: "LIN-42" }, reply), true);
  assert.equal(matchesIntakeFilter({ field: "author", equals: "bot" }, reply), true);
});
