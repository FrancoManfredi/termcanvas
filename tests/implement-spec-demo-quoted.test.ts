/**
 * FU-3 spec retry regression — quoted folder "spec-demo" parser fix.
 *
 * Carry-over from REPORT-F3-measure-humano.md Section A-retry
 * (job-mtop4fcx-0rii): brief + human approval were live, Foreman decided
 * building (conf 0.9, skipTriageSpec), but implement fell back with
 * "implement sin parse confiable -> Triage" and no SpecCite was produced.
 * Root cause: parseRequestedFromPrompt rule 1c regex
 * `carpeta\s+["']?([^\n"']+?)(?:\s+en\s+|...)` fails on
 * `carpeta "spec-demo" en su interior` because the closing quote blocks the
 * `\s+en` terminator, so it returns null and fallbackNeedsTriage routes to
 * Triage even though the request is a clear quoted folder with explicit files.
 *
 * Fix under test (implement track only, high cohesion, God +0):
 * - Rule 1a-bis extracts a quoted folder directly after the carpeta keyword
 *   (explicit quotes = high confidence, delivery-safe: only a plausible
 *   single token is accepted, doubt falls through to Triage as today).
 * - Rule 1c now tolerates an optional closing quote and `con`/`que`
 *   terminators, so unquoted `carpeta spec-demo con ...` also parses.
 * - Never mkdir literal: on doubt the parser returns null and the caller
 *   routes to Triage exactly as today (H-001 holds).
 *
 * NOTE: on-disk effect requires a user restart. The daemon runs as a single
 * load via `node --loader tsx headless-runtime/factory/factoryServer.ts`
 * (no watch mode), so this fix takes effect after the user restarts it.
 * This suite is fully offline (tmp worktrees, zero network, zero daemon,
 * zero LLM calls, zero jobs).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fallbackMinimalChange,
  fallbackNeedsTriage,
  isLiteralFolderName,
  isUnconfidentFolderName,
  parseRequestedFromPrompt,
} from "../headless-runtime/implement/minimalChange.ts";
import {
  isHumanSpecCite,
  parseSpecCite,
  summarizeSpecCite,
} from "../headless-runtime/factory/measure/decisionRecord.ts";

const TEST_TIMEOUT_MS = 30_000;

// Exact retry prompt from REPORT-F3 Section A-retry (quoted folder + 3 files).
const PROMPT_RETRY_EXACT =
  'Necesito una feature multi-archivo con diseno abierto en su interior: crear la carpeta "spec-demo" en su interior con spec-demo/esquema.md, spec-demo/criterios.md y spec-demo/tests.md que definan validacion de briefs (resumen, criterios verificables, archivos objetivo, trivial vs no-trivial); antes de implementar, escribir brief con criterios y preguntas abiertas para aprobacion humana';

// Second carry-over shape: unquoted folder with file clause and no `en` terminator.
const PROMPT_PARA_CARPETA =
  "Para la carpeta spec-demo con un archivo esquema.md que defina el resumen del brief";

// Synthetic but schema-valid brief excerpt (mirrors spec.md shape: criteria + targets).
const SPEC_MD_RETRY =
  "# brief spec-demo\n\nScope: validate briefs (resumen, criterios verificables, archivos objetivo, trivial vs no-trivial).\n" +
  "Criteria: esquema.md defines resumen, criterios.md defines verificables, tests.md defines test plan.\n" +
  "Targets: spec-demo/esquema.md, spec-demo/criterios.md, spec-demo/tests.md.\n";

const JOB_ID_RETRY = "job-mtop4fcx-0rii";
const APPROVED_AT_RETRY = "2026-09-05T18:10:16.142Z";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spec-demo-quoted-"));
}

test("quoted spec-demo retry prompt parses to folder spec-demo (no Triage)", { timeout: TEST_TIMEOUT_MS }, () => {
  const parsed = parseRequestedFromPrompt(PROMPT_RETRY_EXACT);
  assert.ok(parsed, "must parse the quoted folder");
  assert.equal(parsed?.relPath, "spec-demo");
  assert.equal(parsed?.isFolder, true);
  assert.equal(fallbackNeedsTriage(PROMPT_RETRY_EXACT), null, "confident parse must not route to Triage");
  assert.equal(isLiteralFolderName(PROMPT_RETRY_EXACT, "spec-demo"), false, "exact folder is not literal");
  assert.equal(isUnconfidentFolderName("spec-demo"), false, "single token is confident");
});

test("quoted spec-demo fallback creates exactly spec-demo (no literal dir)", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeTmp();
  try {
    const created = fallbackMinimalChange({ id: JOB_ID_RETRY, prompt: PROMPT_RETRY_EXACT, worktree: wt });
    assert.deepEqual(created, ["spec-demo"]);
    assert.equal(fs.existsSync(path.join(wt, "spec-demo")), true, "requested folder must exist");
    assert.equal(
      fs.existsSync(path.join(wt, 'spec-demo" en su interior')),
      false,
      "must never create a literal folder from prompt text",
    );
    for (const p of created) {
      assert.equal(isLiteralFolderName(PROMPT_RETRY_EXACT, p), false, `literal path: ${p}`);
    }
  } finally {
    try {
      fs.rmSync(wt, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

test("single-quote variant also parses (delivery-safe symmetry)", { timeout: TEST_TIMEOUT_MS }, () => {
  const prompt = "crear la carpeta 'spec-demo' en su interior con spec-demo/esquema.md que defina el brief";
  const parsed = parseRequestedFromPrompt(prompt);
  assert.ok(parsed, "single-quoted folder must parse");
  assert.equal(parsed?.relPath, "spec-demo");
  assert.equal(parsed?.isFolder, true);
  assert.equal(fallbackNeedsTriage(prompt), null);
});

test("unquoted para-la-carpeta con-archivo shape also parses (second carry-over)", { timeout: TEST_TIMEOUT_MS }, () => {
  const parsed = parseRequestedFromPrompt(PROMPT_PARA_CARPETA);
  assert.ok(parsed, "unquoted con-shape must parse after 1c con-terminator fix");
  assert.equal(parsed?.relPath, "spec-demo");
  assert.equal(parsed?.isFolder, true);
  assert.equal(fallbackNeedsTriage(PROMPT_PARA_CARPETA), null);
});

test("SpecCite chain preserved for the retry job (implement cites brief)", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.ok(SPEC_MD_RETRY.trim().length >= 20, "precondition: real brief, never a stub");
  const approval = { approvedBy: "human", specApprovedAt: APPROVED_AT_RETRY } as const;
  assert.equal(approval.approvedBy, "human", "approval must be human-only");
  const cite = {
    jobId: JOB_ID_RETRY,
    specApprovedAt: APPROVED_AT_RETRY,
    approvedBy: "human",
    implementCites: "implement follows approved brief for spec-demo (esquema.md scope + criterios.md criteria + tests.md plan)",
  } as const;
  const parsed = parseSpecCite(cite);
  assert.equal(parsed.ok, true, parsed.ok ? "ok" : parsed.error);
  if (parsed.ok) {
    assert.equal(parsed.data.jobId, JOB_ID_RETRY, "cite must link the exact job");
    assert.equal(parsed.data.specApprovedAt, APPROVED_AT_RETRY, "cite must link the exact approval instant");
    assert.ok(isHumanSpecCite(cite), "human-only guard must hold");
    assert.ok(summarizeSpecCite(cite).includes(JOB_ID_RETRY), "summary must reference the job");
    assert.ok(
      parsed.data.implementCites.includes("spec-demo"),
      "implement cite must reference the approved brief scope",
    );
  }
});

test("delivery-safe: doubt still routes to Triage (never mkdir literal)", { timeout: TEST_TIMEOUT_MS }, () => {
  // No extractable name: must request Triage.
  const bare = fallbackNeedsTriage("Crea una carpeta");
  assert.ok(typeof bare === "string" && bare.length > 0, "bare folder intent must triage");
  // Long descriptive residue without quotes: must request Triage.
  const longResidue = fallbackNeedsTriage(
    "Hace una carpeta linda para el proyecto con muchas palabras descriptivas varias",
  );
  assert.ok(typeof longResidue === "string" && longResidue.length > 0, "residue must triage");
  // Long quoted sentence is doubt, not an explicit folder token: must not parse as a folder.
  const longQuoted =
    'Crear la carpeta "esta es una frase larga que no es un nombre de carpeta" en su interior con spec-demo/esquema.md';
  const parsedLong = parseRequestedFromPrompt(longQuoted);
  assert.equal(parsedLong, null, "quoted sentence must not parse as a folder (doubt -> Triage)");
  assert.ok(
    typeof fallbackNeedsTriage(longQuoted) === "string",
    "quoted sentence must route to Triage as today",
  );
  // Path separators inside quotes are doubt: never treat as a folder.
  const slashQuoted = 'Crear la carpeta "spec-demo/esquema" en su interior con archivos';
  assert.equal(parseRequestedFromPrompt(slashQuoted), null, "quoted path must not parse as a folder");
});
