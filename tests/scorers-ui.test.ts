import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_REASON_MAX,
  formatPassRate,
  formatScoreDate,
  jobScoresUrl,
  manualScorePayload,
  manualScoreUrl,
  originLabel,
  parseJobScores,
  parseScorersList,
  parseScoresSummary,
  scoreBadgeTone,
  scorerSubtitle,
  scorersUrl,
  scoresSummaryUrl,
  truncateReason,
} from "../src/features/factoryLab/components/scorersUi.ts";

// Helpers puros del ScorersPanel (Ola 11). El .tsx NO se testea sin harness:
// requiere React + fetch + discoverFactoryPort contra el daemon real, así que
// se verifica por lectura (defensivo: parsers nunca throw, "sin datos"/"—"
// ante cualquier forma inesperada).

// ── scoreBadgeTone ──

test("passing true → green, false → red", () => {
  assert.equal(scoreBadgeTone(true), "green");
  assert.equal(scoreBadgeTone(false), "red");
});

test("sin score (null/undefined) → zinc", () => {
  assert.equal(scoreBadgeTone(null), "zinc");
  assert.equal(scoreBadgeTone(undefined), "zinc");
});

// ── formatPassRate ──

test("null o scored=0 → —", () => {
  assert.equal(formatPassRate(null), "—");
  assert.equal(formatPassRate(undefined), "—");
  assert.equal(formatPassRate({ scored: 0, passing: 0 }), "—");
});

test("normal → NN% (p/scored)", () => {
  assert.equal(formatPassRate({ scored: 4, passing: 3 }), "75% (3/4)");
  assert.equal(formatPassRate({ scored: 3, passing: 3 }), "100% (3/3)");
  assert.equal(formatPassRate({ scored: 2, passing: 0 }), "0% (0/2)");
});

test("redondea el porcentaje", () => {
  assert.equal(formatPassRate({ scored: 3, passing: 1 }), "33% (1/3)");
  assert.equal(formatPassRate({ scored: 3, passing: 2 }), "67% (2/3)");
});

// ── originLabel ──

test("sampled → muestra, manual → manual", () => {
  assert.equal(originLabel("sampled"), "muestra");
  assert.equal(originLabel("manual"), "manual");
});

test("resto → —", () => {
  assert.equal(originLabel("other"), "—");
  assert.equal(originLabel(""), "—");
  assert.equal(originLabel(null), "—");
  assert.equal(originLabel(undefined), "—");
  assert.equal(originLabel(42), "—");
});

// ── scorerSubtitle ──

test("subtitle completo → modelo · sample N% · umbral X", () => {
  assert.equal(
    scorerSubtitle({ model: "opencode-go/muse-spark", samplingRate: 25, passingScore: 0.7 }),
    "opencode-go/muse-spark · sample 25% · umbral 0.7",
  );
});

test("campos ausentes → — por campo, nunca rompe", () => {
  assert.equal(scorerSubtitle(null), "— · sample — · umbral —");
  assert.equal(scorerSubtitle(undefined), "— · sample — · umbral —");
  assert.equal(scorerSubtitle({}), "— · sample — · umbral —");
  assert.equal(
    scorerSubtitle({ model: "m", samplingRate: "x", passingScore: null }),
    "m · sample — · umbral —",
  );
});

// ── truncateReason ──

test("reason corta intacta, vacía/no-string → —", () => {
  assert.equal(truncateReason("bien"), "bien");
  assert.equal(truncateReason(""), "—");
  assert.equal(truncateReason(null), "—");
  assert.equal(truncateReason(undefined), "—");
});

test("reason larga se recorta con …", () => {
  const long = "x".repeat(SCORE_REASON_MAX + 50);
  const out = truncateReason(long);
  assert.equal(out.length, SCORE_REASON_MAX + 1);
  assert.ok(out.endsWith("…"));
});

// ── formatScoreDate ──

test("fecha válida → string local, inválida → —", () => {
  const ok = formatScoreDate("2026-09-01T12:00:00.000Z");
  assert.ok(ok.length > 0 && ok !== "—");
  assert.equal(formatScoreDate("no-fecha"), "—");
  assert.equal(formatScoreDate(""), "—");
  assert.equal(formatScoreDate(null), "—");
});

// ── builders de URLs/payloads ──

test("URLs con encode y payload manual {}", () => {
  assert.equal(scorersUrl(17680), "http://127.0.0.1:17680/factory/scorers");
  assert.equal(scoresSummaryUrl(17680), "http://127.0.0.1:17680/factory/scores/summary");
  assert.equal(
    jobScoresUrl(17680, "job 1/2"),
    "http://127.0.0.1:17680/factory/jobs/job%201%2F2/scores",
  );
  assert.equal(
    manualScoreUrl(17680, "job1", "mi scorer"),
    "http://127.0.0.1:17680/factory/jobs/job1/scores/mi%20scorer",
  );
  assert.deepEqual(manualScorePayload(), {});
});

// ── parsers defensivos ──

test("parseScorersList: forma válida + basura → solo válidos", () => {
  const out = parseScorersList({
    scorers: [
      {
        name: "s1",
        description: "d",
        agents: ["a", 1],
        labels: [{ value: "ok", score: 1 }],
        passingScore: 0.7,
        samplingRate: 25,
        model: "m",
        selfImprovement: false,
      },
      { name: "", description: "sin nombre" },
      null,
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "s1");
  assert.deepEqual(out[0].agents, ["a"]);
});

test("parseScorersList: basura → [] sin throw", () => {
  assert.deepEqual(parseScorersList(null), []);
  assert.deepEqual(parseScorersList({}), []);
  assert.deepEqual(parseScorersList({ scorers: "x" }), []);
});

test("parseJobScores: válido + ausente → fallbacks", () => {
  const out = parseJobScores({
    workItemId: "j1",
    scores: { s1: { label: "ok", score: 1, passing: true, reason: "r", model: "m", origin: "manual", at: "t" } },
  });
  assert.equal(out.workItemId, "j1");
  assert.equal(out.scores["s1"].passing, true);
  assert.deepEqual(parseJobScores(null), { workItemId: "", scores: {} });
  assert.deepEqual(parseJobScores({}), { workItemId: "", scores: {} });
});

test("parseScoresSummary: válido + basura → {} sin throw", () => {
  const out = parseScoresSummary({ scorers: { s1: { scored: 4, passing: 3, failing: 1, passRate: 0.75 } } });
  assert.equal(out["s1"].scored, 4);
  assert.equal(formatPassRate(out["s1"]), "75% (3/4)");
  assert.deepEqual(parseScoresSummary(null), {});
  assert.deepEqual(parseScoresSummary({ scorers: [] }), {});
});
