import test from "node:test";
import assert from "node:assert/strict";
import {
  adoptUrl,
  canDecide,
  discardUrl,
  failuresUrl,
  proposePayload,
  proposalStatusBadge,
  proposalUrl,
  proposalsUrl,
  regressionsSummary,
  retryAnalysisUrl,
  targetShort,
} from "../src/features/factoryLab/components/improvementUi.ts";

// Helpers puros del SelfImprovementPanel (Ola 13). El .tsx NO se testea sin
// harness: requiere React + fetch + discoverFactoryPort contra el daemon real,
// así que se verifica por lectura (defensivo: parsers nunca throw, "sin datos"/
// "—" ante cualquier forma inesperada).

// ── proposalStatusBadge ──

test("pending → blue analizando", () => {
  assert.deepEqual(proposalStatusBadge("pending"), { tone: "blue", label: "analizando" });
});

test("ready → amber lista para revisar", () => {
  assert.deepEqual(proposalStatusBadge("ready"), { tone: "amber", label: "lista para revisar" });
});

test("failed → red falló", () => {
  assert.deepEqual(proposalStatusBadge("failed"), { tone: "red", label: "falló" });
});

test("adopted → green adoptada", () => {
  assert.deepEqual(proposalStatusBadge("adopted"), { tone: "green", label: "adoptada" });
});

test("discarded → zinc descartada", () => {
  assert.deepEqual(proposalStatusBadge("discarded"), { tone: "zinc", label: "descartada" });
});

test("desconocido → zinc —", () => {
  assert.deepEqual(proposalStatusBadge("other"), { tone: "zinc", label: "—" });
  assert.deepEqual(proposalStatusBadge(""), { tone: "zinc", label: "—" });
  assert.deepEqual(proposalStatusBadge(null), { tone: "zinc", label: "—" });
  assert.deepEqual(proposalStatusBadge(undefined), { tone: "zinc", label: "—" });
  assert.deepEqual(proposalStatusBadge(42), { tone: "zinc", label: "—" });
});

// ── canDecide ──

test("solo ready se puede decidir", () => {
  assert.equal(canDecide("ready"), true);
  assert.equal(canDecide("pending"), false);
  assert.equal(canDecide("failed"), false);
  assert.equal(canDecide("adopted"), false);
  assert.equal(canDecide("discarded"), false);
  assert.equal(canDecide("other"), false);
  assert.equal(canDecide(null), false);
  assert.equal(canDecide(undefined), false);
});

// ── regressionsSummary ──

test("vacío/inválido → —", () => {
  assert.equal(regressionsSummary([]), "—");
  assert.equal(regressionsSummary(null), "—");
  assert.equal(regressionsSummary(undefined), "—");
  assert.equal(regressionsSummary("x"), "—");
  assert.equal(regressionsSummary([null, "", "  ", 42]), "—");
});

test("normal → N runs: ids", () => {
  assert.equal(regressionsSummary(["a"]), "1 run: a");
  assert.equal(regressionsSummary(["a", "b"]), "2 runs: a, b");
});

test("largo se acota a 120 chars con …", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `job-run-${String(i).padStart(3, "0")}-largo`);
  const out = regressionsSummary(ids);
  assert.ok(out.length <= 120);
  assert.ok(out.endsWith("…"));
  assert.ok(out.startsWith("30 runs:"));
});

// ── targetShort ──

test("últimos 2 segmentos del path", () => {
  assert.equal(targetShort("factory/scorers/x/scorer.md"), "x/scorer.md");
  assert.equal(targetShort("a/b"), "a/b");
  assert.equal(targetShort("solo"), "solo");
});

test("acepta backslashes y espacios", () => {
  assert.equal(targetShort("factory\\scorers\\x\\scorer.md"), "x/scorer.md");
  assert.equal(targetShort("  a/b/c  "), "b/c");
});

test("vacío/inválido → —", () => {
  assert.equal(targetShort(""), "—");
  assert.equal(targetShort("   "), "—");
  assert.equal(targetShort(null), "—");
  assert.equal(targetShort(undefined), "—");
  assert.equal(targetShort(42), "—");
});

// ── builders de URLs/payload ──

test("URLs con puerto dado y encode", () => {
  assert.equal(proposalsUrl(17680), "http://127.0.0.1:17680/factory/improve/proposals");
  assert.equal(
    proposalUrl(17681, "p 1/2"),
    "http://127.0.0.1:17681/factory/improve/proposals/p%201%2F2",
  );
  assert.equal(
    failuresUrl(17680, "mi scorer"),
    "http://127.0.0.1:17680/factory/improve/failures?scorer=mi%20scorer",
  );
  assert.equal(
    adoptUrl(17680, "p1"),
    "http://127.0.0.1:17680/factory/improve/proposals/p1/adopt",
  );
  assert.equal(
    discardUrl(17680, "p1"),
    "http://127.0.0.1:17680/factory/improve/proposals/p1/discard",
  );
  assert.equal(
    retryAnalysisUrl(17680, "p1"),
    "http://127.0.0.1:17680/factory/improve/proposals/p1/retry-analysis",
  );
});

test("payload de propuesta", () => {
  assert.deepEqual(proposePayload("review-formato-valido"), { scorer: "review-formato-valido" });
  assert.deepEqual(proposePayload("  x  "), { scorer: "x" });
});
