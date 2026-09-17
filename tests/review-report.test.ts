/**
 * P3a — Canonical review report (prp-review contract): machine metadata,
 * severity mapping, round template (verdict/contract/head/findings/prior/
 * bot/discoveries/coverage), meta refresh for the publisher. Pure, offline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendBotReviewSection,
  applyBotFindingsToReport,
  assertReportIntegrity,
  buildReviewReport,
  canonicalSeverity,
  computeReadiness,
  curateSummary,
  hasOpenBlockingFindings,
  hasUndispositionedOpenFindings,
  parseReviewReportMeta,
  parseScopeContract,
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

test("gate: open major/blocker forces NEEDS FIXES; terminal and minor do not", () => {
  const major = (state?: string) => ({
    id: "f1",
    severity: "major",
    message: "m",
    ...(state === undefined ? {} : { state }),
  });
  assert.equal(hasOpenBlockingFindings([major()]), true);
  assert.equal(hasOpenBlockingFindings([major("OPEN")]), true);
  assert.equal(hasOpenBlockingFindings([{ ...major(), severity: "blocker" }]), true);
  assert.equal(hasOpenBlockingFindings([{ ...major(), severity: "Critical" }]), true);
  assert.equal(hasOpenBlockingFindings([{ ...major("FIXED"), severity: "major" }]), false);
  assert.equal(
    hasOpenBlockingFindings([{ ...major("TRACKED_FOLLOW_UP"), severity: "major" }]),
    false,
  );
  assert.equal(hasOpenBlockingFindings([{ ...major("DECLINED") }]), false);
  assert.equal(hasOpenBlockingFindings([{ ...major(), severity: "minor" }]), false);
  assert.equal(hasOpenBlockingFindings([{ ...major(), severity: "info" }]), false);
  assert.equal(hasOpenBlockingFindings([{ ...major(), severity: "Important" }]), false);
  assert.equal(hasOpenBlockingFindings([{ ...major(), severity: "Suggestion" }]), false);
  assert.equal(hasOpenBlockingFindings([]), false);
  assert.equal(hasOpenBlockingFindings(null), false);
});

test("ready report: exact metadata lines + round template + parse round-trip", () => {
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
    botFindings: [],
  });
  assert.match(report, /^prp-review-id: pr-77$/m);
  assert.match(report, /^pr: 77$/m);
  assert.match(report, /^base: main$/m);
  assert.match(report, /^head: issue-5-x$/m);
  assert.match(report, /^reviewed_head: abc123$/m);
  assert.match(report, /^verdict: READY TO MERGE$/m);
  assert.match(report, /^readiness: ready$/m);
  assert.match(report, /^open_findings: 0$/m);
  assert.match(report, /^mode: initial$/m);
  assert.match(report, /^round: 1$/m);
  assert.match(report, /^scopes: \[requirements, tests, security\]$/m);
  assert.match(report, /^publication: pending$/m);
  assert.ok(report.includes("# Review report — PR #77"));
  assert.ok(report.includes("Mode: **Initial review** (round 1)."));
  assert.ok(report.includes("Reviewed head SHA: `abc123`."));
  assert.ok(report.includes("Base: `main`."));
  assert.ok(report.includes("## 1. Verdict"));
  assert.ok(report.includes("**Ready. Action: `none`.**"));
  assert.ok(report.includes("**0 blocking · 0 non-blocking**"));
  assert.ok(report.includes("**Validation:** all green"));
  assert.ok(report.includes("## 2. Accepted contract"));
  assert.ok(report.includes("## 3. Reviewed head SHA"));
  assert.ok(report.includes("## 4. Findings"));
  assert.ok(report.includes("No findings."));
  assert.ok(report.includes("## 5. Prior findings"));
  assert.ok(report.includes("No prior findings — this is the first round."));
  assert.ok(report.includes("## 6. Bot review"));
  assert.ok(report.includes("reviewed head `abc123` with no findings"));
  assert.ok(report.includes("## 7. Discoveries"));
  assert.ok(report.includes("None recorded in this round."));
  assert.ok(report.includes("## 8. Review coverage"));
  assert.ok(report.includes(
    "Reviewed under scopes [requirements, tests, security] at `abc123`; another reviewer or another head may see more.",
  ));
  const meta = parseReviewReportMeta(report);
  assert.deepEqual(meta, {
    pr: 77,
    base: "main",
    head: "issue-5-x",
    reviewed_head: "abc123",
    verdict: "READY TO MERGE",
    readiness: "ready",
    open_findings: 0,
    scopes: ["requirements", "tests", "security"],
    publication: "pending",
  });
});

test("needs fixes: blocking/suggestions/rejected bullets + dispositions + open count", () => {
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
  assert.ok(report.includes("## 1. Verdict"));
  assert.ok(report.includes("**Not ready. Action: `fix f1`.**"));
  assert.ok(report.includes("### Blocking"));
  assert.ok(report.includes("`f1` — Null sin chequear. Status: OPEN."));
  assert.ok(report.includes("Evidence: `a.ts:10`."));
  assert.ok(report.includes("Required: Chequear null."));
  assert.ok(report.includes("Found by: reviewer-a"));
  assert.ok(report.includes("### Rejected findings"));
  assert.ok(report.includes("`f2` — Nit de naming. Status: DECLINED."));
  assert.ok(report.includes("Reason: convención del repo."));
  assert.ok(report.includes("**Resolved:** 0 · **Tracked follow-ups:** #45"));
  assert.match(report, /^open_findings: 1$/m, "solo OPEN cuenta (sugerencia declinada no)");
  assert.ok(report.includes("**1 blocking · 2 non-blocking**"));
  assert.ok(report.includes("**Validation:** failing: pnpm test"));
});

test("continuation: mode preamble + prior findings table + contract block", () => {
  const report = buildReviewReport({
    pr: 12,
    base: "dev",
    head: "issue-9-y",
    reviewedHead: "def456",
    verdict: "READY TO MERGE",
    summary: "Los hallazgos previos quedaron corregidos.",
    findings: [],
    validation: [],
    scopes: ["tests"],
    mode: "continuation",
    round: 2,
    priorReport: "review-report-round-1.md",
    priorReviewedHead: "abc123",
    contract: {
      source: "scope.md",
      outcome: ["saveTransactions no rompe el flujo"],
      invariants: ["los reads siguen sirviendo el último estado válido"],
      nonGoals: ["no tocar app.js"],
    },
    priorFindings: [
      { id: "f1", severity: "major", message: "guard faltante", state: "FIXED", verification: "tests/store.corrupt.test.js:3 pass" },
    ],
  });
  assert.match(report, /^mode: continuation$/m);
  assert.match(report, /^round: 2$/m);
  assert.ok(report.includes("Mode: **Continuation review** (round 2)."));
  assert.ok(report.includes("Prior report: `review-report-round-1.md`"));
  assert.ok(report.includes("reviewed head `abc123`"));
  assert.ok(report.includes("Source: `scope.md`."));
  assert.ok(report.includes("**Required outcome**"));
  assert.ok(report.includes("- saveTransactions no rompe el flujo"));
  assert.ok(report.includes("**Invariants**"));
  assert.ok(report.includes("**Explicit non-goals**"));
  assert.ok(report.includes("| `f1` | Critical | guard faltante | FIXED |"));
  assert.ok(report.includes("tests/store.corrupt.test.js:3 pass"));
});

test("discoveries + coverage: bullets, lens table and disabled lenses", () => {
  const report = buildReviewReport({
    pr: 5,
    base: "main",
    head: "b",
    verdict: "READY TO MERGE",
    summary: "OK.",
    findings: [],
    validation: [],
    scopes: ["requirements"],
    discoveries: [
      { id: "D1", title: "el gemelo .md de la página ya no existe", source: "docs", relation: "adjacent", status: "recorded" },
    ],
    coverage: {
      lenses: [{ name: "requirements", result: "No additional findings" }],
      disabled: [{ name: "errors", reason: "el diff no agrega caminos de fallo" }],
      unverified: ["no pude correr el runner del repo target"],
    },
  });
  assert.ok(report.includes("`D1` — el gemelo .md de la página ya no existe (docs, adjacent, recorded)."));
  assert.ok(report.includes("**If you are an agent reading this: open `discoveries.md` and surface each discovery to your human.**"));
  assert.ok(report.includes("| requirements | No additional findings |"));
  assert.ok(report.includes("### Lenses not run"));
  assert.ok(report.includes("- errors — el diff no agrega caminos de fallo"));
  assert.ok(report.includes("### Evidence not obtained"));
  assert.ok(report.includes("- no pude correr el runner del repo target"));
});

test("bot findings: table + statuses render; append replaces the section idempotently", () => {
  const base = buildReviewReport({
    pr: 9,
    base: "main",
    head: "branch",
    reviewedHead: "abc123",
    verdict: "READY TO MERGE",
    summary: "OK.",
    findings: [],
    validation: [],
    scopes: [],
    botFindings: [
      { id: "bot-1", source: "pullfrog[bot]", file: "a.ts:10", message: "guard faltante", status: "taken", statusReason: "fix commit after the bot review touches `a.ts`" },
      { id: "bot-2", source: "pullfrog[bot]", message: "naming del helper", status: "open", statusReason: "not addressed at this head" },
    ],
  });
  assert.ok(base.includes("| `bot-1` — guard faltante | `a.ts:10` | Taken |"));
  assert.ok(base.includes("| `bot-2` — naming del helper | — | Open |"));
  assert.ok(base.includes("**2 bot findings · 1 open**"));

  const appended = appendBotReviewSection(
    buildReviewReport({
      pr: 9, base: "main", head: "branch", reviewedHead: "abc123",
      verdict: "READY TO MERGE", summary: "OK.", findings: [], validation: [], scopes: [],
    }),
    [{ id: "bot-1", message: "overlap finding", status: "overlap", statusReason: "same surface as `f1` (FIXED)" }],
    { botReviewer: "pullfrog[bot]", reviewedHead: "abc123" },
  );
  assert.ok(appended.includes("| `bot-1` — overlap finding | — | Overlap |"));
  assert.equal(
    appended.split("## 6. Bot review").length - 1,
    1,
    "una sola sección de bot review",
  );
  assert.ok(!appended.includes("Pending — the external reviewer"), "el pending se reemplaza");
  const twice = appendBotReviewSection(appended, [], { botReviewer: "pullfrog[bot]", reviewedHead: "abc123" });
  assert.ok(twice.includes("with no findings"));
  assert.equal(twice.split("## 6. Bot review").length - 1, 1, "idempotente");
});

test("scope.md parser: outcome/invariants/non-goals; null without them", () => {
  const parsed = parseScopeContract(
    [
      "# Scope — issue #9",
      "",
      "## Required outcome",
      "- R1: el flag refleja el fallo",
      "- R2: los reads siguen",
      "",
      "## Invariants",
      "- el storage key no cambia",
      "",
      "## Explicit non-goals",
      "- no tocar app.js",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed?.source, "scope.md");
  assert.deepEqual(parsed?.outcome, ["R1: el flag refleja el fallo", "R2: los reads siguen"]);
  assert.deepEqual(parsed?.invariants, ["el storage key no cambia"]);
  assert.deepEqual(parsed?.nonGoals, ["no tocar app.js"]);
  assert.equal(parseScopeContract(""), null);
  assert.equal(parseScopeContract("## Otra\n- x"), null);
  assert.equal(parseScopeContract(null), null);
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
  assert.ok(refreshed.includes("## 1. Verdict"));
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
  const validationLine = plain.split("\n").find((l) => l.startsWith("**Validation:**")) ?? "";
  assert.equal(validationLine, "**Validation:** not run", "sin nota no hay sufijo");
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
  assert.ok(row.includes("narrativa."), "la última palabra completa queda");
  assert.ok(!row.includes("narra. Status"), "sin corte mid-word");
  const impact = report.split("\n").find((l) => l.includes("Required:")) ?? "";
  const lastWord = (impact.split(" ").at(-1) ?? "");
  assert.ok(lastWord.length > 3, `impacto termina en palabra completa (${lastWord})`);
});

test("class: invariant enumeration renders in the causal-class section, absent without it", () => {
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
  assert.ok(withClass.includes("### Complete causal class"), "sección de clase");
  assert.ok(withClass.includes("Invariante:") && withClass.includes("afectados"), "miembros visibles");
  const plain = buildReviewReport({
    pr: 2, base: "m", head: "h", verdict: "NEEDS FIXES",
    summary: "x.", findings: [{ id: "f1", severity: "info", message: "Nit." }],
    validation: [], scopes: [],
  });
  assert.ok(!plain.includes("### Complete causal class"), "sin clase no hay sección");
});

// ── WS2: verdict único — readiness (header + prose derived from computeReadiness) ──

test("readiness: READY + open Suggestion stays ready (production PR #156 regression)", () => {
  const report = buildReviewReport({
    pr: 156,
    base: "main",
    head: "issue-42-x",
    reviewedHead: "abc123",
    verdict: "READY TO MERGE",
    summary: "El cambio cumple el issue y la verificación pasó.",
    findings: [{ id: "f1", severity: "info", message: "nit de naming", state: "OPEN" }],
    validation: [],
    scopes: [],
    botFindings: [],
  });
  assert.match(report, /^verdict: READY TO MERGE$/m);
  assert.match(report, /^readiness: ready$/m, "sugerencia abierta no bloquea");
  assert.match(report, /^open_findings: 1$/m, "el conteo interno no cambia");
  assert.ok(report.includes("**Ready. Action: `none`.**"), "prosa deriva del mismo computo");
  assert.ok(!report.includes("**Not ready."));
  assert.equal(parseReviewReportMeta(report)?.readiness, "ready");
  assert.deepEqual(assertReportIntegrity(report), []);
});

test("readiness: READY + open Critical blocks; terminal Critical does not", () => {
  const blocked = buildReviewReport({
    pr: 156,
    base: "main",
    head: "h",
    reviewedHead: "abc123",
    verdict: "READY TO MERGE",
    summary: "Contradicción de veredicto.",
    findings: [{ id: "f1", severity: "blocker", message: "Null sin chequear" }],
    validation: [],
    scopes: [],
    botFindings: [],
  });
  assert.match(blocked, /^readiness: blocked$/m);
  assert.ok(blocked.includes("**Not ready. Action: `fix f1`.**"));

  const terminal = buildReviewReport({
    pr: 156,
    base: "main",
    head: "h",
    reviewedHead: "abc123",
    verdict: "READY TO MERGE",
    summary: "Fijado.",
    findings: [{ id: "f1", severity: "blocker", message: "Null sin chequear", state: "FIXED" }],
    validation: [],
    scopes: [],
    botFindings: [],
  });
  assert.match(terminal, /^readiness: ready$/m, "un Critical terminal no bloquea");
  assert.ok(terminal.includes("**Ready. Action: `none`.**"));
});

test("readiness: bot pending → pending with reasons; open bot finding → blocked with its id", () => {
  const pending = buildReviewReport({
    pr: 9, base: "main", head: "h", verdict: "READY TO MERGE",
    summary: "OK.", findings: [], validation: [], scopes: [],
  });
  assert.match(pending, /^readiness: pending$/m, "bot sin aterrizar = pendiente");
  assert.ok(pending.includes("**Review incomplete. Action: `none`.**"));
  assert.ok(
    pending.includes(" Pending: bot findings pending (external reviewer has not landed)."),
    "la prosa pendiente agrega las razones",
  );
  assert.ok(pending.includes("Pending — the external reviewer (`pullfrog`)"), "sección de bot pendiente");

  const blocked = buildReviewReport({
    pr: 9, base: "main", head: "h", verdict: "READY TO MERGE",
    summary: "OK.", findings: [], validation: [], scopes: [],
    botFindings: [{ id: "bot-1", message: "guard faltante", status: "open" }],
  });
  assert.match(blocked, /^readiness: blocked$/m);
  assert.ok(blocked.includes("**Not ready. Action: `none`.**"));
  const readiness = computeReadiness({
    verdict: "READY TO MERGE",
    findings: [],
    botFindings: [{ id: "bot-1", message: "guard faltante", status: "open" }],
  });
  assert.deepEqual(readiness, {
    ready: false,
    state: "blocked",
    reasons: ["bot finding `bot-1` open: guard faltante"],
  });
});

test("readiness: extraBlockers pass through; blocked wins over pending; junk never throws", () => {
  assert.deepEqual(
    computeReadiness({ verdict: "READY TO MERGE", findings: [], botFindings: [], extraBlockers: ["x"] }),
    { ready: false, state: "blocked", reasons: ["x"] },
  );
  assert.deepEqual(
    computeReadiness({ verdict: "READY TO MERGE", findings: [], botFindings: [] }),
    { ready: true, state: "ready", reasons: [] },
  );
  assert.deepEqual(
    computeReadiness({ verdict: "NEEDS FIXES", findings: [], botFindings: [] }),
    { ready: false, state: "blocked", reasons: ["verdict is NEEDS FIXES"] },
  );
  assert.deepEqual(
    computeReadiness({ verdict: "REVIEW INCOMPLETE", findings: [], botFindings: [] }),
    { ready: false, state: "pending", reasons: ["verdict is REVIEW INCOMPLETE"] },
  );
  assert.deepEqual(
    computeReadiness({
      verdict: "NEEDS FIXES",
      findings: [
        { id: "f1", severity: "major", message: "a" },
        { id: "f2", severity: "minor", message: "b" },
      ],
      botFindings: undefined,
    }),
    {
      ready: false,
      state: "blocked",
      reasons: [
        "verdict is NEEDS FIXES",
        "finding `f1` (Critical) is open",
        "bot findings pending (external reviewer has not landed)",
      ],
    },
  );
  const junk = computeReadiness({
    verdict: "BOGUS" as never,
    findings: "junk",
    botFindings: 42,
  });
  assert.equal(junk.state, "pending", "input basura cae a review incompleto");
  assert.ok(junk.reasons.length > 0);
});

test("refresh: publisher also patches prose PR and head SHA (PR #0 / unknown regression)", () => {
  const local = buildReviewReport({
    pr: 0,
    base: "main",
    head: "issue-5-x",
    verdict: "READY TO MERGE",
    summary: "OK.",
    findings: [],
    validation: [],
    scopes: [],
    botFindings: [],
  });
  assert.ok(local.includes("# Review report — PR #0"), "estado local pre-PR");
  assert.ok(local.includes("Reviewed head SHA: `unknown`."));
  const refreshed = refreshReviewReportMeta(local, {
    pr: 78,
    reviewedHead: "def456",
    publication: "https://github.com/o/r/pull/78#issuecomment-1",
  });
  assert.match(refreshed, /^pr: 78$/m);
  assert.ok(refreshed.includes("# Review report — PR #78"));
  assert.ok(!refreshed.includes("# Review report — PR #0"), "la prosa deja el placeholder");
  assert.ok(refreshed.includes("Reviewed head SHA: `def456`."), "la prosa deja el SHA real");
  assert.match(refreshed, /^readiness: ready$/m, "refresh nunca recomputa readiness");
  assert.ok(refreshed.includes("## 1. Verdict"));
  const readinessPatched = refreshReviewReportMeta(local, { pr: 78, readiness: "blocked" });
  assert.match(readinessPatched, /^readiness: blocked$/m, "patch explícito de readiness");
  assert.deepEqual(assertReportIntegrity(refreshed), []);
});

test("integrity: flags each violation, clean canonical report is empty", () => {
  const clean = buildReviewReport({
    pr: 77, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "READY TO MERGE", summary: "OK.",
    findings: [], validation: [{ command: "pnpm test", result: "PASS", evidence: "1 passed" }],
    scopes: ["tests"], botFindings: [],
  });
  assert.deepEqual(assertReportIntegrity(clean), []);

  const prZero = clean.replace(/^# Review report — PR #\d+$/m, "# Review report — PR #0");
  assert.deepEqual(assertReportIntegrity(prZero), ["prose has PR #0"]);

  const unknownSha = clean.replace(/^Reviewed head SHA: `.*`\.$/m, "Reviewed head SHA: `unknown`.");
  assert.deepEqual(assertReportIntegrity(unknownSha), [
    "prose has unknown head SHA",
    "head SHA differs between header and section 3",
  ]);

  const placeholder = buildReviewReport({
    pr: 77, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "READY TO MERGE", summary: "",
    findings: [], validation: [], scopes: [], botFindings: [],
  });
  assert.deepEqual(assertReportIntegrity(placeholder), ["placeholder summary"]);

  const disagree = buildReviewReport({
    pr: 77, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "NEEDS FIXES", summary: "Falta.",
    findings: [], validation: [], scopes: [], botFindings: [],
  }).replace("**Not ready. Action: `none`.**", "**Ready. Action: `none`.**");
  assert.ok(
    assertReportIntegrity(disagree).includes("readiness blocked but prose is not Not ready"),
  );

  assert.deepEqual(assertReportIntegrity(null), []);
  assert.deepEqual(assertReportIntegrity("junk sin header"), []);
});

test("parse: readiness line parses; a report without it still parses (default empty)", () => {
  const report = buildReviewReport({
    pr: 7, base: "main", head: "h", verdict: "READY TO MERGE",
    summary: "OK.", findings: [], validation: [], scopes: [], botFindings: [],
  });
  assert.equal(parseReviewReportMeta(report)?.readiness, "ready");
  const legacy = report.replace(/^readiness: .*$\n/m, "");
  const legacyMeta = parseReviewReportMeta(legacy);
  assert.ok(legacyMeta, "un reporte sin readiness sigue parseando");
  assert.equal(legacyMeta?.readiness, "");
  assert.equal(legacyMeta?.verdict, "READY TO MERGE");
});

test("blocked prose lists the reasons so the why is visible without the machine header", () => {
  const blocked = buildReviewReport({
    pr: 160, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "NEEDS FIXES", summary: "Faltan disposiciones.",
    findings: [{ id: "f1", severity: "major", message: "Suggestion sin disponer", state: "OPEN" }],
    validation: [], scopes: [], botFindings: [],
  });
  assert.match(blocked, /^readiness: blocked$/m);
  assert.ok(blocked.includes("Blocked by:"));
  assert.ok(blocked.includes("finding `f1` (Critical) is open"));
});

test("append: timeout deadline renders pending copy, not a silent no-findings", () => {
  const base = buildReviewReport({
    pr: 9, base: "main", head: "branch", reviewedHead: "abc123",
    verdict: "READY TO MERGE", summary: "OK.", findings: [], validation: [], scopes: [],
  });
  const timedOut = appendBotReviewSection(base, [], {
    botReviewer: "pullfrog[bot]", reviewedHead: "abc123", status: "timeout",
  });
  assert.ok(timedOut.includes("had not posted findings for head `abc123` by the deadline"));
  assert.ok(timedOut.includes("reconcile (Taken/Dropped) before merge"));
  const found = appendBotReviewSection(base, [], {
    botReviewer: "pullfrog[bot]", reviewedHead: "abc123", status: "found",
  });
  assert.ok(found.includes("reviewed head `abc123` with no findings"));
});

test("dispositions: any non-terminal finding counts; terminal states do not", () => {
  assert.equal(hasUndispositionedOpenFindings([]), false);
  assert.equal(hasUndispositionedOpenFindings([{ id: "f1", state: "FIXED" }]), false);
  assert.equal(hasUndispositionedOpenFindings([{ id: "f1", state: "declined" }]), false);
  assert.equal(hasUndispositionedOpenFindings([{ id: "f1", state: "TRACKED_FOLLOW_UP" }]), false);
  assert.equal(hasUndispositionedOpenFindings([{ id: "f1", state: "OPEN" }]), true);
  assert.equal(hasUndispositionedOpenFindings([{ id: "f1" }]), true, "sin state = abierto");
  assert.equal(hasUndispositionedOpenFindings([{ id: "f1", state: "FIXED" }, { id: "f2" }]), true);
  assert.equal(hasUndispositionedOpenFindings(null), false);
  assert.equal(hasUndispositionedOpenFindings(["junk"]), false);
});

test("extraBlockers: WS3/WS4 gates render as blocked with their reason", () => {
  const report = buildReviewReport({
    pr: 160, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "READY TO MERGE", summary: "OK.",
    findings: [{ id: "f1", severity: "info", message: "copy del banner", state: "OPEN" }],
    validation: [], scopes: [], botFindings: [],
    extraBlockers: ["finding `f1` open without disposition (TRACKED_FOLLOW_UP/DECLINED)"],
  });
  assert.match(report, /^readiness: blocked$/m);
  assert.ok(report.includes("Blocked by:"));
  assert.ok(report.includes("finding `f1` open without disposition"));
});

test("contractCoverage: WS4 table renders with sanitized pipes; absent renders nothing", () => {
  const withCoverage = buildReviewReport({
    pr: 1, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "NEEDS FIXES", summary: "El contrato debilita un requisito.",
    findings: [], validation: [], scopes: [], botFindings: [],
    contract: { source: "scope.md", outcome: ["R1: mantiene el estado en memoria"] },
    contractCoverage: [
      {
        requirement: "Rq1: mantiene|el estado",
        coveredBy: "R1",
        status: "weakened",
        note: "rewordeado",
      },
      { requirement: "Rq2: sin cobertura", coveredBy: "", status: "missing" },
    ],
  });
  assert.ok(withCoverage.includes("**Coverage (issue requirements → contract)**"));
  assert.ok(withCoverage.includes("| Requirement | Covered by | Status | Note |"));
  assert.ok(
    withCoverage.includes("| Rq1: mantiene/el estado | `R1` | weakened | rewordeado |"),
    "fila completa con coveredBy/status/nota",
  );
  assert.ok(
    !withCoverage.includes("mantiene|el estado"),
    "el pipe se neutraliza para no romper la tabla",
  );
  assert.ok(
    withCoverage.includes("| Rq2: sin cobertura | — | missing |"),
    "sin coveredBy va —",
  );
  assert.ok(!withCoverage.includes("## 2.1"), "sub-bloque sin heading numerado (no renumera)");
  assert.ok(withCoverage.includes("## 3. Reviewed head SHA"), "la plantilla conserva su numeración");

  const without = buildReviewReport({
    pr: 1, base: "main", head: "h", reviewedHead: "abc123",
    verdict: "READY TO MERGE", summary: "OK.",
    findings: [], validation: [], scopes: [], botFindings: [],
    contract: { source: "scope.md", outcome: ["R1: algo"] },
  });
  assert.ok(
    !without.includes("Coverage (issue requirements → contract)"),
    "sin coverage no se renderiza la tabla",
  );
  assert.ok(!without.includes("| Requirement | Covered by | Status | Note |"));
});

test("bot append: open findings downgrade verdict+§1 to blocked (PR #162 shape)", () => {
  const base = buildReviewReport({
    pr: 162, base: "main", head: "issue-151-x", reviewedHead: "919a934",
    verdict: "READY TO MERGE", summary: "El fix cumple el issue.",
    findings: [], validation: [], scopes: [],
  });
  assert.match(base, /^readiness: pending$/m);
  const findings = [
    { id: "bot-1", message: "Stale app.js catch comment", file: "js/app.js", status: "open" },
  ];
  const appended = appendBotReviewSection(base, findings, {
    botReviewer: "pullfrog", reviewedHead: "919a934", status: "found",
  });
  const coherent = applyBotFindingsToReport(appended, findings, { status: "found" });
  assert.match(coherent, /^verdict: REVIEW INCOMPLETE$/m);
  assert.match(coherent, /^readiness: blocked$/m);
  assert.ok(coherent.includes("**Not ready. Action: `none`.**"));
  assert.ok(coherent.includes("bot finding `bot-1` open"));
  assert.ok(!coherent.includes("**Ready."));
  assert.deepEqual(assertReportIntegrity(coherent), []);
});

test("bot append: no open findings return readiness to ready; timeout keeps pending with deadline copy", () => {
  const base = buildReviewReport({
    pr: 162, base: "main", head: "issue-151-x", reviewedHead: "919a934",
    verdict: "READY TO MERGE", summary: "OK.", findings: [], validation: [], scopes: [],
  });
  const taken = [{ id: "bot-1", message: "stale comment", status: "taken" }];
  const found = applyBotFindingsToReport(
    appendBotReviewSection(base, taken, { reviewedHead: "919a934", status: "found" }),
    taken,
    { status: "found" },
  );
  assert.match(found, /^readiness: ready$/m);
  assert.ok(found.includes("**Ready. Action: `none`.**"));
  assert.deepEqual(assertReportIntegrity(found), []);

  const timedOut = applyBotFindingsToReport(
    appendBotReviewSection(base, [], { reviewedHead: "919a934", status: "timeout" }),
    [],
    { status: "timeout" },
  );
  assert.match(timedOut, /^readiness: pending$/m);
  assert.ok(timedOut.includes("bot review deadline reached without findings"));
  assert.deepEqual(assertReportIntegrity(timedOut), []);
});

test("bot append: a non-READY verdict is preserved, never upgraded by reconciliation", () => {
  const base = buildReviewReport({
    pr: 162, base: "main", head: "h", reviewedHead: "abc",
    verdict: "NEEDS FIXES", summary: "Falta.",
    findings: [{ id: "f1", severity: "major", message: "m", state: "OPEN" }],
    validation: [], scopes: [], botFindings: [],
  });
  const out = applyBotFindingsToReport(
    base,
    [{ id: "bot-1", message: "x", status: "open" }],
    { status: "found" },
  );
  assert.match(out, /^verdict: NEEDS FIXES$/m);
  assert.equal(out, base, "sin cambios: §1 ya es honesto y §6 lleva el mandato");
});

test("refresh: §3 cursor is patched with the real head, not left as unknown", () => {
  const local = buildReviewReport({
    pr: 0, base: "main", head: "h", verdict: "READY TO MERGE",
    summary: "OK.", findings: [], validation: [], scopes: [], botFindings: [],
  });
  assert.ok(local.includes("## 3. Reviewed head SHA\n\n`unknown`"), "cursor pre-PR");
  const refreshed = refreshReviewReportMeta(local, { pr: 200, reviewedHead: "deadbee" });
  assert.ok(refreshed.includes("## 3. Reviewed head SHA\n\n`deadbee`"));
  assert.ok(!refreshed.includes("## 3. Reviewed head SHA\n\n`unknown`"));
  assert.ok(
    refreshed.includes("Reviewed under scopes [") && refreshed.includes("at `deadbee`"),
    "§8 también queda con el head real",
  );
  assert.deepEqual(assertReportIntegrity(refreshed), []);
});

test("integrity: READY with blocked readiness is the #162 defect", () => {
  const report = buildReviewReport({
    pr: 162, base: "main", head: "h", reviewedHead: "abc",
    verdict: "READY TO MERGE", summary: "OK.", findings: [], validation: [], scopes: [], botFindings: [],
  }).replace(/^readiness: .*$/m, "readiness: blocked");
  const violations = assertReportIntegrity(report);
  assert.ok(violations.includes("verdict READY TO MERGE with readiness blocked"));
  assert.ok(violations.includes("readiness blocked but prose is not Not ready"));
});

test("bot append P4: un finding dispositioned se muestra Dispositioned y no bloquea", () => {
  const base = buildReviewReport({
    pr: 1, base: "main", head: "h", reviewedHead: "abc",
    verdict: "READY TO MERGE", summary: "OK.", findings: [], validation: [], scopes: [],
  });
  const findings = [
    {
      id: "bot-1",
      message: "falta validación",
      status: "dispositioned",
      statusReason: "TRACKED_FOLLOW_UP — issue #99 (round disposition)",
    },
  ];
  const appended = appendBotReviewSection(base, findings, {
    reviewedHead: "abc",
    status: "found",
  });
  assert.ok(appended.includes("| Dispositioned |"), "la tabla del bot muestra Dispositioned");
  assert.ok(appended.includes("TRACKED_FOLLOW_UP — issue #99"), "la razón viaja a la tabla");
  const coherent = applyBotFindingsToReport(appended, findings, { status: "found" });
  assert.match(coherent, /^readiness: ready$/m, "sin abiertos la readiness vuelve a ready");
  assert.ok(coherent.includes("**Ready. Action: `none`.**"));
  assert.deepEqual(assertReportIntegrity(coherent), []);
});

test("wsE: scope.md con Amendments parsea y el reporte los renderiza", () => {
  const scope = [
    "# Scope — issue #151",
    "",
    "## Required outcome",
    "- R1: el estado en memoria sobrevive al write fallido.",
    "",
    "## Invariants",
    "- I3: los tests existentes no se modifican.",
    "",
    "## Amendments",
    "- A1: I3 enmendado — el test pineaba la propagación (el bug); se actualiza para pinear el fix (ronda 2).",
  ].join("\n");
  const parsed = parseScopeContract(scope);
  assert.ok(parsed, "el scope con amendments parsea");
  const amendments = parsed?.amendments as string[] | undefined;
  assert.equal(amendments?.length, 1);
  assert.ok(String(amendments?.[0]).includes("A1"));
  const onlyAmendments = parseScopeContract(
    ["## Amendments", "- A1: algo cambió — razón."].join("\n"),
  );
  assert.ok(onlyAmendments, "amendments solos también parsean");
  const report = buildReviewReport({
    pr: 1, base: "main", head: "h", reviewedHead: "abc",
    verdict: "READY TO MERGE", summary: "OK.",
    findings: [], validation: [], scopes: [], botFindings: [],
    contract: parsed ?? undefined,
  });
  assert.ok(report.includes("**Amendments**"));
  assert.ok(report.includes("- A1: I3 enmendado"));
});

test("bot append: un blocked ajeno al bot no se libera solo con el bot reconciliado", () => {
  const blocked = buildReviewReport({
    pr: 162, base: "main", head: "h", reviewedHead: "abc",
    verdict: "READY TO MERGE", summary: "OK.",
    findings: [{ id: "f1", severity: "major", message: "m", state: "OPEN" }],
    validation: [], scopes: [], botFindings: [],
    extraBlockers: ["requirement `Rq1` not covered (missing)"],
  });
  assert.match(blocked, /^readiness: blocked$/m);
  const out = applyBotFindingsToReport(blocked, [], { status: "found" });
  assert.equal(out, blocked, "blocked no se sube a ready sin ver los blockers");
});

test("bot append: el mensaje del bot no expande patrones de reemplazo ($&)", () => {
  const base = buildReviewReport({
    pr: 9, base: "main", head: "h", reviewedHead: "abc",
    verdict: "READY TO MERGE", summary: "OK.", findings: [], validation: [], scopes: [],
  });
  const count = (s: string, needle: string): number => s.split(needle).length - 1;
  const findings = [{ id: "bot-1", message: "use $& and $' carefully", status: "open" }];
  const injected = appendBotReviewSection(base, findings, { reviewedHead: "abc", status: "found" });
  assert.ok(injected.includes("use $& and $' carefully"), "texto literal en §6");
  assert.equal(count(injected, "## 2. Accepted contract"), 1, "sin splicing de secciones");
  const coherent = applyBotFindingsToReport(injected, findings, { status: "found" });
  assert.ok(coherent.includes("**Not ready. Action: `none`.**"));
  assert.ok(coherent.includes("use $& and $' carefully"), "sin expansión en apply");
  assert.equal(count(coherent, "## 1. Verdict"), 1);
  assert.equal(count(coherent, "## 2. Accepted contract"), 1);
});
