/**
 * F3-T1 — Human-in-the-measure decision records (pure + offline).
 * Covers headless-runtime/factory/measure/decisionRecord.ts with zero I/O,
 * zero network and zero daemon. Includes negative asserts proving the
 * human-only rule: never auto-winner, never auto-adopt.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BENCHMARK_DECISION_FORBIDDEN_KEYS,
  BenchmarkDecisionSchema,
  findForbiddenKeys,
  formatDecisionIssues,
  isHumanBenchmarkDecision,
  isHumanSpecCite,
  isNonBlankString,
  isValidIsoUtcString,
  parseBenchmarkDecision,
  parseSpecCite,
  SPEC_CITE_FORBIDDEN_KEYS,
  SpecCiteSchema,
  summarizeBenchmarkDecision,
  summarizeSpecCite,
  validateBenchmarkDecision,
  validateSpecCite,
} from "../headless-runtime/factory/measure/decisionRecord.ts";

const DECIDED_AT = "2026-09-05T12:00:00.000Z";
const APPROVED_AT = "2026-09-05T12:30:00.000Z";

function makeBenchmarkDecision(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    benchmarkId: "bench-abc123",
    decidedAt: DECIDED_AT,
    decidedBy: "human",
    change: "review model big-pickle -> gpt-4o for review role",
    costWeight: "weekly spend must stay flat",
    qualityWeight: "fewer major misses on requirements",
    trialsRef: "factory/.benchmark-results/bench-abc123.json",
    note: "human weighed cost vs quality over 12 trials",
    ...overrides,
  };
}

function makeSpecCite(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jobId: "job-abc123",
    specApprovedAt: APPROVED_AT,
    approvedBy: "human",
    implementCites: "implement follows approved brief section 2 (scope + criteria)",
    ...overrides,
  };
}

// ── BenchmarkDecision accepts ──

test("benchmark decision accepts a minimal valid record with defaults", () => {
  const parsed = parseBenchmarkDecision({
    benchmarkId: "bench-min",
    decidedAt: DECIDED_AT,
    decidedBy: "human",
    change: "keep current review model",
    trialsRef: "factory/.benchmark-results/bench-min.json",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.data.costWeight, "");
    assert.equal(parsed.data.qualityWeight, "");
    assert.equal(parsed.data.note, "");
    assert.equal(parsed.data.decidedBy, "human");
  }
});

test("benchmark decision accepts a full valid record", () => {
  const parsed = parseBenchmarkDecision(makeBenchmarkDecision());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.data.benchmarkId, "bench-abc123");
    assert.equal(parsed.data.trialsRef, "factory/.benchmark-results/bench-abc123.json");
  }
  const validated = validateBenchmarkDecision(makeBenchmarkDecision());
  assert.equal(validated.decidedBy, "human");
  assert.ok(isHumanBenchmarkDecision(makeBenchmarkDecision()));
  assert.ok(summarizeBenchmarkDecision(makeBenchmarkDecision()).includes("bench-abc123"));
});

test("benchmark decision accepts ISO without millis and with offset", () => {
  assert.equal(
    parseBenchmarkDecision(
      makeBenchmarkDecision({ decidedAt: "2026-09-05T12:00:00Z" }),
    ).ok,
    true,
  );
  assert.equal(
    parseBenchmarkDecision(
      makeBenchmarkDecision({ decidedAt: "2026-09-05T12:00:00+00:00" }),
    ).ok,
    true,
  );
});

// ── BenchmarkDecision human-only negatives (never auto) ──

test("benchmark decision rejects every non-human decisor", () => {
  const badValues: unknown[] = ["auto", "system", "bot", "agent", "", "Human", "HUMAN", null, 42];
  for (const decidedBy of badValues) {
    const parsed = parseBenchmarkDecision(makeBenchmarkDecision({ decidedBy }));
    assert.equal(parsed.ok, false, `decidedBy=${String(decidedBy)} must fail`);
    if (!parsed.ok) {
      assert.match(parsed.error, /human/i);
    }
  }
});

test("benchmark decision rejects a missing decisor", () => {
  const input = makeBenchmarkDecision();
  delete input["decidedBy"];
  const parsed = parseBenchmarkDecision(input);
  assert.equal(parsed.ok, false);
});

test("benchmark decision rejects winner smuggling (no auto-winner)", () => {
  const winnerPayloads: Array<Record<string, unknown>> = [
    makeBenchmarkDecision({ winner: "cfg-1" }),
    makeBenchmarkDecision({ autoWinner: "cfg-2" }),
    makeBenchmarkDecision({ winningConfig: "cfg-1" }),
    makeBenchmarkDecision({ recommendation: "cfg-1" }),
    makeBenchmarkDecision({ auto: true }),
  ];
  for (const payload of winnerPayloads) {
    const parsed = parseBenchmarkDecision(payload);
    assert.equal(parsed.ok, false, "winner-like field must fail strict plus never-auto rule");
    if (!parsed.ok) {
      assert.ok(
        /winner|recommendation|forbidden|never|unrecognized/i.test(parsed.error),
        `error must name the auto-winner problem: ${parsed.error}`,
      );
    }
  }
  assert.throws(() => validateBenchmarkDecision(makeBenchmarkDecision({ winner: "cfg-1" })), /winner|never|invalid/i);
});

test("benchmark decision rejects unknown extra keys (strict)", () => {
  const parsed = parseBenchmarkDecision(makeBenchmarkDecision({ extra: "nope" }));
  assert.equal(parsed.ok, false);
});

// ── BenchmarkDecision field negatives ──

test("benchmark decision rejects blank or missing ids and refs", () => {
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ benchmarkId: "" })).ok, false);
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ benchmarkId: "   " })).ok, false);
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ benchmarkId: "a\0b" })).ok, false);
  const missingId = makeBenchmarkDecision();
  delete missingId["benchmarkId"];
  assert.equal(parseBenchmarkDecision(missingId).ok, false);
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ trialsRef: "" })).ok, false);
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ trialsRef: "   " })).ok, false);
  const missingRef = makeBenchmarkDecision();
  delete missingRef["trialsRef"];
  assert.equal(parseBenchmarkDecision(missingRef).ok, false);
  assert.equal(
    parseBenchmarkDecision(makeBenchmarkDecision({ trialsRef: "x".repeat(257) })).ok,
    false,
  );
});

test("benchmark decision rejects blank or oversized change", () => {
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ change: "" })).ok, false);
  assert.equal(parseBenchmarkDecision(makeBenchmarkDecision({ change: "   " })).ok, false);
  assert.equal(
    parseBenchmarkDecision(makeBenchmarkDecision({ change: "x".repeat(501) })).ok,
    false,
  );
  const missing = makeBenchmarkDecision();
  delete missing["change"];
  assert.equal(parseBenchmarkDecision(missing).ok, false);
});

test("benchmark decision rejects bad timestamps", () => {
  const badDates: unknown[] = ["", "   ", "not-a-date", "2026-13-99T99:99:99Z", "12:00", "2026/09/05", null, 123];
  for (const decidedAt of badDates) {
    assert.equal(
      parseBenchmarkDecision(makeBenchmarkDecision({ decidedAt })).ok,
      false,
      `decidedAt=${String(decidedAt)} must fail`,
    );
  }
  assert.equal(
    parseBenchmarkDecision(makeBenchmarkDecision({ decidedAt: ` ${DECIDED_AT}` })).ok,
    false,
  );
});

test("benchmark decision rejects oversized optionals", () => {
  assert.equal(
    parseBenchmarkDecision(makeBenchmarkDecision({ costWeight: "x".repeat(201) })).ok,
    false,
  );
  assert.equal(
    parseBenchmarkDecision(makeBenchmarkDecision({ qualityWeight: "x".repeat(201) })).ok,
    false,
  );
  assert.equal(
    parseBenchmarkDecision(makeBenchmarkDecision({ note: "x".repeat(1001) })).ok,
    false,
  );
});

test("benchmark decision helpers are pure and fail-safe", () => {
  assert.equal(isHumanBenchmarkDecision(null), false);
  assert.equal(isHumanBenchmarkDecision("nope"), false);
  assert.equal(isHumanBenchmarkDecision(makeBenchmarkDecision({ decidedBy: "auto" })), false);
  assert.equal(summarizeBenchmarkDecision(null), "");
  assert.equal(summarizeBenchmarkDecision({}), "");
  assert.equal(
    summarizeBenchmarkDecision(makeBenchmarkDecision()).includes("decided by human"),
    true,
  );
  assert.throws(() => validateBenchmarkDecision(null), /invalid benchmark decision/i);
  assert.throws(() => validateBenchmarkDecision({}), /invalid benchmark decision/i);
});

// ── SpecCite accepts ──

test("spec cite accepts a valid brief to approve to implement chain", () => {
  const input = makeSpecCite();
  const parsed = parseSpecCite(input);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.data.jobId, "job-abc123");
    assert.equal(parsed.data.approvedBy, "human");
    assert.equal(parsed.data.specApprovedAt, APPROVED_AT);
  }
  const validated = validateSpecCite(input);
  assert.equal(validated.approvedBy, "human");
  assert.ok(isHumanSpecCite(input));
  assert.ok(summarizeSpecCite(input).includes("job-abc123"));
});

// ── SpecCite human-only negatives (never auto-adopt) ──

test("spec cite rejects every non-human approver", () => {
  const badValues: unknown[] = ["auto", "system", "bot", "agent", "", "Human", null];
  for (const approvedBy of badValues) {
    const parsed = parseSpecCite(makeSpecCite({ approvedBy }));
    assert.equal(parsed.ok, false, `approvedBy=${String(approvedBy)} must fail`);
    if (!parsed.ok) {
      assert.match(parsed.error, /human/i);
    }
  }
  const missing = makeSpecCite();
  delete missing["approvedBy"];
  assert.equal(parseSpecCite(missing).ok, false);
});

test("spec cite rejects auto-adopt smuggling (no auto-adopt)", () => {
  const payloads: Array<Record<string, unknown>> = [
    makeSpecCite({ autoAdopt: true }),
    makeSpecCite({ autoApprove: true }),
    makeSpecCite({ adopted: true }),
    makeSpecCite({ auto: true }),
    makeSpecCite({ winner: "cfg-1" }),
  ];
  for (const payload of payloads) {
    const parsed = parseSpecCite(payload);
    assert.equal(parsed.ok, false, "auto-adopt-like field must fail");
    if (!parsed.ok) {
      assert.ok(
        /adopt|winner|forbidden|never|unrecognized/i.test(parsed.error),
        `error must name the auto problem: ${parsed.error}`,
      );
    }
  }
  assert.throws(() => validateSpecCite(makeSpecCite({ autoAdopt: true })), /adopt|never|invalid/i);
});

test("spec cite rejects unknown extra keys (strict)", () => {
  assert.equal(parseSpecCite(makeSpecCite({ extra: 1 })).ok, false);
});

// ── SpecCite field negatives ──

test("spec cite rejects blank cite, job and timestamp", () => {
  assert.equal(parseSpecCite(makeSpecCite({ implementCites: "" })).ok, false);
  assert.equal(parseSpecCite(makeSpecCite({ implementCites: "   " })).ok, false);
  assert.equal(
    parseSpecCite(makeSpecCite({ implementCites: "x".repeat(501) })).ok,
    false,
  );
  const missingCite = makeSpecCite();
  delete missingCite["implementCites"];
  assert.equal(parseSpecCite(missingCite).ok, false);
  assert.equal(parseSpecCite(makeSpecCite({ jobId: "" })).ok, false);
  assert.equal(parseSpecCite(makeSpecCite({ jobId: "   " })).ok, false);
  assert.equal(parseSpecCite(makeSpecCite({ specApprovedAt: "yesterday" })).ok, false);
  assert.equal(parseSpecCite(makeSpecCite({ specApprovedAt: "" })).ok, false);
});

test("spec cite helpers are pure and fail-safe", () => {
  assert.equal(isHumanSpecCite(null), false);
  assert.equal(isHumanSpecCite(makeSpecCite({ approvedBy: "auto" })), false);
  assert.equal(summarizeSpecCite(null), "");
  assert.equal(summarizeSpecCite({}).includes(""), true);
  assert.throws(() => validateSpecCite(null), /invalid spec cite/i);
});

// ── Shared pure helpers ──

test("iso utc helper accepts shape plus real dates only", () => {
  assert.equal(isValidIsoUtcString(DECIDED_AT), true);
  assert.equal(isValidIsoUtcString("2026-09-05T12:00:00Z"), true);
  assert.equal(isValidIsoUtcString("not-a-date"), false);
  assert.equal(isValidIsoUtcString(""), false);
  assert.equal(isValidIsoUtcString(null), false);
  assert.equal(isValidIsoUtcString(123), false);
  assert.equal(isValidIsoUtcString(` ${DECIDED_AT}`), false);
  assert.equal(isValidIsoUtcString("x".repeat(65)), false);
});

test("non-blank helper rejects empties, NUL and overlong", () => {
  assert.equal(isNonBlankString("hello", 10), true);
  assert.equal(isNonBlankString("", 10), false);
  assert.equal(isNonBlankString("   ", 10), false);
  assert.equal(isNonBlankString("a\0b", 10), false);
  assert.equal(isNonBlankString(null, 10), false);
  assert.equal(isNonBlankString(42, 10), false);
  assert.equal(isNonBlankString("toolong", 3), false);
});

test("forbidden-key finder and issue formatter never throw", () => {
  assert.deepEqual(findForbiddenKeys(null, BENCHMARK_DECISION_FORBIDDEN_KEYS), []);
  assert.deepEqual(findForbiddenKeys([], BENCHMARK_DECISION_FORBIDDEN_KEYS), []);
  assert.deepEqual(
    findForbiddenKeys({ winner: "x" }, BENCHMARK_DECISION_FORBIDDEN_KEYS),
    ["winner"],
  );
  assert.deepEqual(findForbiddenKeys({}, SPEC_CITE_FORBIDDEN_KEYS), []);
  assert.equal(formatDecisionIssues(null), "invalid decision record");
  assert.equal(formatDecisionIssues([]), "invalid decision record");
  assert.ok(
    formatDecisionIssues([{ path: ["decidedBy"], message: "must be human" }]).includes("decidedBy"),
  );
  assert.ok(formatDecisionIssues([{ message: "boom" }]).includes("boom"));
  assert.ok(formatDecisionIssues([null]).includes("invalid"));
});

test("schemas stay strict and human-only by construction", () => {
  const benchShape = BenchmarkDecisionSchema.safeParse(makeBenchmarkDecision());
  assert.equal(benchShape.success, true);
  if (benchShape.success) {
    assert.equal((benchShape.data as { decidedBy: string }).decidedBy, "human");
    assert.ok(!("winner" in benchShape.data));
  }
  const citeShape = SpecCiteSchema.safeParse(makeSpecCite());
  assert.equal(citeShape.success, true);
  if (citeShape.success) {
    assert.equal((citeShape.data as { approvedBy: string }).approvedBy, "human");
    assert.ok(!("autoAdopt" in citeShape.data));
  }
});

test("module exposes no auto winner or auto adopt surface", async () => {
  const mod = (await import(
    "../headless-runtime/factory/measure/decisionRecord.ts"
  )) as Record<string, unknown>;
  const names = Object.keys(mod).map((key) => key.toLowerCase());
  assert.ok(!names.some((name) => name.includes("autowinner") || name === "winner"));
  assert.ok(!names.some((name) => name.includes("autoadopt")));
  assert.ok(!names.some((name) => name.includes("pickwinner")));
  assert.ok(typeof mod["validateBenchmarkDecision"] === "function");
  assert.ok(typeof mod["validateSpecCite"] === "function");
  assert.ok(typeof mod["parseBenchmarkDecision"] === "function");
  assert.ok(typeof mod["parseSpecCite"] === "function");
});
