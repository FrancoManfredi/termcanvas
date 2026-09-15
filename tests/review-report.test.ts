/**
 * P3a — Canonical review report (prp-review contract): machine metadata,
 * severity mapping, findings table + details, dispositions, coverage and
 * validation, meta refresh for the publisher. Pure, offline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewReport,
  canonicalSeverity,
  curateSummary,
  parseReviewReportMeta,
  refreshReviewReportMeta,
} from "../headless-runtime/review/reviewReport.ts";

test("severity: engine severities map to Critical/Important/Suggestion", () => {
  assert.equal(canonicalSeverity("blocker"), "Critical");
  assert.equal(canonicalSeverity("major"), "Critical");
  assert.equal(canonicalSeverity("minor"), "Important");
  assert.equal(canonicalSeverity("info"), "Suggestion");
  assert.equal(canonicalSeverity("junk"), "Suggestion");
  assert.equal(canonicalSeverity(null), "Suggestion");
});

test("ready report: exact metadata lines + sections + parse round-trip", () => {
  const report = buildReviewReport({
    pr: 77,
    base: "main",
    head: "issue-5-x",
    reviewedHead: "abc123",
    verdict: "READY TO MERGE",
    summary: "El cambio cumple el issue y la verificación pasó.",
    findings: [],
    validation: [{ command: "pnpm test", result: "PASS", evidence: "12 passed" }],
    scopes: ["requirements", "tests", "security"],
    publication: "pending",
    reviewer: "opencode/big-pickle",
  });
  assert.match(report, /^prp-review-id: pr-77$/m);
  assert.match(report, /^pr: 77$/m);
  assert.match(report, /^base: main$/m);
  assert.match(report, /^head: issue-5-x$/m);
  assert.match(report, /^reviewed_head: abc123$/m);
  assert.match(report, /^verdict: READY TO MERGE$/m);
  assert.match(report, /^open_findings: 0$/m);
  assert.match(report, /^scopes: \[requirements, tests, security\]$/m);
  assert.match(report, /^publication: pending$/m);
  assert.ok(report.includes("## Ready to merge"));
  assert.ok(report.includes(
    "Revisado bajo scopes [requirements, tests, security] en abc123; otro revisor u otro head pueden ver más.",
  ));
  assert.ok(report.includes("No findings."));
  assert.ok(report.includes("**0 blocking · 0 non-blocking**"));
  assert.ok(report.includes("**Validation:** all green"));
  const meta = parseReviewReportMeta(report);
  assert.deepEqual(meta, {
    pr: 77,
    base: "main",
    head: "issue-5-x",
    reviewed_head: "abc123",
    verdict: "READY TO MERGE",
    open_findings: 0,
    scopes: ["requirements", "tests", "security"],
    publication: "pending",
  });
});

test("needs fixes: table + details + dispositions + open count", () => {
  const report = buildReviewReport({
    pr: 0,
    base: "main",
    head: "issue-5-x",
    verdict: "NEEDS FIXES",
    summary: "Falta cubrir el borde.",
    findings: [
      { id: "f1", severity: "blocker", message: "Null sin chequear", file: "a.ts:10", axis: "requirements", suggestion: "Chequear null", foundBy: "reviewer-a" },
      { id: "f2", severity: "info", message: "Nit de naming", state: "DECLINED", dispositionReason: "convención del repo" },
      { id: "f3", severity: "minor", message: "Sumar test de borde", state: "TRACKED_FOLLOW_UP", trackingIssue: "#45" },
    ],
    validation: [{ command: "pnpm test", result: "FAIL", evidence: "1 failed" }],
    scopes: ["requirements"],
    reviewer: "opencode/big-pickle",
  });
  assert.ok(report.includes("## Needs fixes"));
  assert.ok(report.includes("| `f1` | Critical | Null sin chequear | OPEN |"));
  assert.ok(report.includes("| `f2` | Suggestion | Nit de naming | DECLINED |"));
  assert.match(report, /^open_findings: 1$/m, "solo OPEN cuenta (sugerencia declinada no)");
  assert.ok(report.includes("**1 blocking · 2 non-blocking**"));
  assert.ok(report.includes("**Validation:** failing: pnpm test"));
  assert.ok(report.includes("**Disposition:** DECLINED — convención del repo"));
  assert.ok(report.includes("**Disposition:** TRACKED_FOLLOW_UP (#45)"));
  assert.ok(report.includes("**Found by:** `reviewer-a`"));
  assert.ok(report.includes("`a.ts:10`"));
});

test("refresh: publisher sets pr/head/publication, body preserved", () => {
  const local = buildReviewReport({
    pr: 0,
    base: "main",
    head: "issue-5-x",
    verdict: "READY TO MERGE",
    summary: "OK.",
    findings: [],
    validation: [],
    scopes: [],
  });
  const refreshed = refreshReviewReportMeta(local, {
    pr: 78,
    reviewedHead: "def456",
    publication: "https://github.com/o/r/pull/78#issuecomment-1",
  });
  assert.match(refreshed, /^prp-review-id: pr-78$/m);
  assert.match(refreshed, /^pr: 78$/m);
  assert.match(refreshed, /^reviewed_head: def456$/m);
  assert.match(refreshed, /^publication: https:\/\/github\.com\/o\/r\/pull\/78#issuecomment-1$/m);
  assert.ok(refreshed.includes("## Ready to merge"));
  assert.ok(refreshed.includes("No findings."));
  const junkRefresh = refreshReviewReportMeta(local, { publication: "./local/path.md" });
  assert.match(junkRefresh, /^publication: pending$/m, "path local jamás publica");
});

test("parse: null on junk, wrong verdict or bad counts", () => {
  assert.equal(parseReviewReportMeta(""), null);
  assert.equal(parseReviewReportMeta(null), null);
  assert.equal(parseReviewReportMeta("## hola\nsin metadata"), null);
  const bad = buildReviewReport({
    pr: 1, base: "m", head: "h", verdict: "READY TO MERGE",
    summary: "x", findings: [], validation: [], scopes: [],
  }).replace(/^verdict: .*$/m, "verdict: MAYBE");
  assert.equal(parseReviewReportMeta(bad), null);
});

test("curate: drops fences + leading tics, caps at sentence boundary", () => {
  const raw = [
    "Let me analyze this carefully.",
    "",
    "The fix wraps parsing in try/catch and returns [].",
    "Wait — one subtle thing: setItem may throw in private mode.",
    "",
    "```json",
    '{"green": true, "findings": []}',
    "```",
    "",
    "Trailing prose that must not survive the cap. ".repeat(60),
  ].join("\n");
  const got = curateSummary(raw, 200);
  assert.ok(!got.includes("Let me analyze"), "tic inicial fuera");
  assert.ok(!got.includes("```"), "fence fuera");
  assert.ok(!got.includes("green"), "JSON fuera");
  assert.ok(got.includes("try/catch"), "veredicto preservado");
  assert.ok(got.length <= 200, `cap respetado (${got.length})`);
  assert.match(got, /[.!?]$/, "corte en boundary, nunca a mitad de frase");
  assert.equal(curateSummary(""), "");
  assert.equal(curateSummary(null), "");
  assert.equal(curateSummary(42), "");
});

test("curate: short prose passes through, junk falls back", () => {
  assert.equal(curateSummary("El cambio cumple el issue."), "El cambio cumple el issue.");
  assert.equal(curateSummary("Sin puntuacion final pero corto"), "Sin puntuacion final pero corto");
  const noBoundary = `x${"y".repeat(900)}`;
  assert.ok(curateSummary(noBoundary, 100).endsWith("…"), "sin boundary: corte duro marcado");
});

test("validationNote: syntax-only scope is explicit, not all-green-alone", () => {
  const report = buildReviewReport({
    pr: 0, base: "main", head: "issue-5-x", verdict: "READY TO MERGE",
    summary: "OK.", findings: [],
    validation: [{ command: 'node --check "js/a.js"', result: "PASS", evidence: "exit 0" }],
    scopes: ["tests"],
    validationNote: "syntax only (no test runner in target repo)",
  });
  assert.ok(report.includes("**Validation:** all green — syntax only (no test runner in target repo)"));
  const plain = buildReviewReport({
    pr: 0, base: "main", head: "h", verdict: "READY TO MERGE",
    summary: "OK.", findings: [], validation: [], scopes: [],
  });
  assert.ok(plain.includes("**Validation:** not run"));
  assert.ok(!plain.includes(" — "), "sin nota no hay sufijo");
});

test("words: finding message/suggestion never cut mid-word", () => {
  const long = `La evidencia cubre solo sintaxis sobre los archivos cambiados y la suite de regresión agregada no fue ejecutada como paso de verificación, así que el comportamiento queda probado solo por narrativa`;
  const report = buildReviewReport({
    pr: 1, base: "m", head: "h", verdict: "NEEDS FIXES",
    summary: "Falta verificación real.",
    findings: [{ id: "f1", severity: "minor", message: long, suggestion: long }],
    validation: [], scopes: [],
  });
  const row = report.split("\n").find((l) => l.includes("`f1`")) ?? "";
  assert.ok(!row.endsWith("corru |") && !row.includes("corru |"), "tabla sin corte mid-word");
  assert.match(row, /\| OPEN \|$/, "la fila cierra con estado, no con fragmento");
  const impact = report.split("\n").find((l) => l.startsWith("**Impact:**")) ?? "";
  const lastWord = (impact.split(" ").at(-1) ?? "");
  assert.ok(lastWord.length > 3, `impacto termina en palabra completa (${lastWord})`);
});

test("class: invariant enumeration renders in details, absent without it", () => {
  const withClass = buildReviewReport({
    pr: 2, base: "m", head: "h", verdict: "NEEDS FIXES",
    summary: "El walker tiene falsos positivos.",
    findings: [{
      id: "f1", severity: "major",
      message: "El walker reporta gaps falsos en mapas properties y defaults objeto.",
      file: "structured-output.ts",
      class: "Invariante: solo se recorre a subschemas; búsqueda: grep properties/default/examples; afectados: properties, default, examples; limpios: items, additionalProperties.",
    }],
    validation: [], scopes: [],
  });
  assert.ok(withClass.includes("**Class:** Invariante:"), "details con clase");
  assert.ok(withClass.includes("miembros") || withClass.includes("afectados"), "miembros visibles");
  const plain = buildReviewReport({
    pr: 2, base: "m", head: "h", verdict: "NEEDS FIXES",
    summary: "x.", findings: [{ id: "f1", severity: "info", message: "Nit." }],
    validation: [], scopes: [],
  });
  assert.ok(!plain.includes("**Class:**"), "sin clase no hay línea");
});
