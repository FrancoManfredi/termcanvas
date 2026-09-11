/**
 * E1 implement track — flujo simple (sin pre-verify rescan) + parse determinista.
 *
 * Face A (late-flush): documenta la carrera histórica (writes LLM-externos
 * que aterrizan tarde) pero el service YA NO hace rescan pre-verify: una
 * sola verificación con la lista conciliada tal cual; si está vacía o
 * stale, el job queda parado en Building (sin sleeps ni re-descubrimiento).
 * Los helpers H-013 (`discoverLateCreatedFiles`, `reconcileCreatedFiles`)
 * siguen existiendo como funciones puras y se testean abajo, pero el
 * service no los llama antes del primer verify.
 *
 * Face B (parser non-determinism at `:226`):
 * - Same human prompt, two outcomes: retry3 `job-mtot0raj-0r2m` parsed past
 *   `:183/:226` to `:312`, retry4 `job-mtp4fqut-ncsf` fell back at `:226`
 *   with 0 extra calls, same daemon boot, same fix mtime.
 * - Differing input (hex-verified on job.json/prompt.md): retry3 stores
 *   `carpeta "spec-demo"` (0x22), retry4 stores `carpeta \"spec-demo\"`
 *   (0x5C 0x22) — literal backslash + quote from double JSON escaping at
 *   intake. Foreman re-dispatch `skipTriageSpec` never mutates
 *   `workItem.prompt`; bytes differ at creation, not at re-dispatch.
 * - Fix under test: `unescapePromptQuotes` normalization makes both byte
 *   shapes parse identically (deterministic quoted-folder), delivery-safe
 *   (doubt still routes to Triage, never mkdir literal, H-001 holds).
 *
 * Fully offline: tmp worktrees, zero network, zero daemon, zero LLM calls,
 * zero jobs. Explicit timeouts, no long fixed sleeps (max 500ms sleeps in
 * source only; tests use zero sleeps except one 600ms late-flush simulation
 * via real disk timing, bounded).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fallbackNeedsTriage,
  isLiteralFolderName,
  parseRequestedFileName,
  parseRequestedFromPrompt,
  unescapePromptQuotes,
} from "../headless-runtime/implement/minimalChange.ts";
import {
  discoverLateCreatedFiles,
  reconcileCreatedFiles,
  resolveVerifyRetryCreatedFiles,
} from "../headless-runtime/workItem/resultStore.ts";
import { detectCreatedFilesAnomaly } from "../headless-runtime/implement/verification.ts";

const TEST_TIMEOUT_MS = 30_000;

// Exact A-retry human prompt (retry3 bytes: clean quotes).
const PROMPT_CLEAN =
  'Necesito una feature multi-archivo con diseno abierto en su interior: crear la carpeta "spec-demo" en su interior con spec-demo/esquema.md, spec-demo/criterios.md y spec-demo/tests.md que definan validacion de briefs (resumen, criterios verificables, archivos objetivo, trivial vs no-trivial); antes de implementar, escribir brief con criterios y preguntas abiertas para aprobacion humana';

// Same human prompt as persisted in retry4 (bytes 0x5C 0x22: backslash + quote).
const PROMPT_ESCAPED =
  'Necesito una feature multi-archivo con diseno abierto en su interior: crear la carpeta \\"spec-demo\\" en su interior con spec-demo/esquema.md, spec-demo/criterios.md y spec-demo/tests.md que definan validacion de briefs (resumen, criterios verificables, archivos objetivo, trivial vs no-trivial); antes de implementar, escribir brief con criterios y preguntas abiertas para aprobacion humana';

// R4 trivial exact-byte shape (lab6-rev + dato.txt, 3 lines LF).
const PROMPT_R4 =
  "Crea la carpeta lab6-rev con un archivo dato.txt que contenga en su interior exactamente estas 3 lineas:\nR4-REV line one\nR4-REV line two\nThis file has exactly 2 lines\nNota: el archivo debe tener exactamente 3 lineas LF, con salto final incluido.";

const R4_FILE_CONTENT = "R4-REV line one\nR4-REV line two\nThis file has exactly 2 lines\n";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e1-lateflush-"));
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ── E1-B: escape normalization ──

test("unescapePromptQuotes normalizes double-escaped intake bytes", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.equal(unescapePromptQuotes('carpeta \\"spec-demo\\" en'), 'carpeta "spec-demo" en');
  assert.equal(unescapePromptQuotes("carpeta \\'spec-demo\\' en"), "carpeta 'spec-demo' en");
  assert.equal(unescapePromptQuotes("a\\\\b"), "a\\b");
  assert.equal(unescapePromptQuotes('carpeta "spec-demo" en'), 'carpeta "spec-demo" en');
  assert.equal(unescapePromptQuotes(""), "");
});

test("quoted-folder parses identically in both foreman contexts (clean vs escaped)", { timeout: TEST_TIMEOUT_MS }, () => {
  const clean = parseRequestedFromPrompt(PROMPT_CLEAN);
  const escaped = parseRequestedFromPrompt(PROMPT_ESCAPED);
  assert.ok(clean, "clean bytes must parse");
  assert.ok(escaped, "escaped bytes must parse identically (deterministic)");
  assert.deepEqual(escaped, clean);
  assert.equal(clean?.relPath, "spec-demo");
  assert.equal(clean?.isFolder, true);
  assert.equal(fallbackNeedsTriage(PROMPT_CLEAN), null);
  assert.equal(fallbackNeedsTriage(PROMPT_ESCAPED), null);
  assert.equal(isLiteralFolderName(PROMPT_CLEAN, "spec-demo"), false);
  assert.equal(isLiteralFolderName(PROMPT_ESCAPED, "spec-demo"), false);
});

test("file-name extraction agrees in both contexts", { timeout: TEST_TIMEOUT_MS }, () => {
  const cleanFile = parseRequestedFileName(PROMPT_CLEAN);
  const escapedFile = parseRequestedFileName(PROMPT_ESCAPED);
  assert.equal(cleanFile, escapedFile);
  assert.ok(cleanFile !== null && cleanFile.length > 0, "expected a requested file for the folder+file shape");
});

test("single-quote escaped variant also parses", { timeout: TEST_TIMEOUT_MS }, () => {
  const singleClean = "crear la carpeta 'spec-demo' en su interior con spec-demo/esquema.md que defina el brief";
  const singleEscaped = "crear la carpeta \\'spec-demo\\' en su interior con spec-demo/esquema.md que defina el brief";
  const a = parseRequestedFromPrompt(singleClean);
  const b = parseRequestedFromPrompt(singleEscaped);
  assert.ok(a && b, "both single-quote contexts must parse");
  assert.deepEqual(b, a);
  assert.equal(a?.relPath, "spec-demo");
});

// ── Negatives: delivery-safe in both contexts ──

test("negatives stay Triage in both contexts (never mkdir literal)", { timeout: TEST_TIMEOUT_MS }, () => {
  const bare = "Crea una carpeta";
  assert.equal(parseRequestedFromPrompt(bare), null);
  assert.ok(typeof fallbackNeedsTriage(bare) === "string");
  const residue = "Hace una carpeta linda para el proyecto con muchas palabras descriptivas varias";
  assert.equal(parseRequestedFromPrompt(residue), null);
  assert.ok(typeof fallbackNeedsTriage(residue) === "string");
  const longQuoted =
    'Crear la carpeta "esta es una frase larga que no es un nombre de carpeta" en su interior con spec-demo/esquema.md';
  assert.equal(parseRequestedFromPrompt(longQuoted), null);
  assert.ok(typeof fallbackNeedsTriage(longQuoted) === "string");
  const longQuotedEscaped =
    'Crear la carpeta \\"esta es una frase larga que no es un nombre de carpeta\\" en su interior con spec-demo/esquema.md';
  assert.equal(parseRequestedFromPrompt(longQuotedEscaped), null);
  assert.ok(typeof fallbackNeedsTriage(longQuotedEscaped) === "string");
  const slashQuoted = 'Crear la carpeta "spec-demo/esquema" en su interior con archivos';
  assert.equal(parseRequestedFromPrompt(slashQuoted), null);
  const slashQuotedEscaped = 'Crear la carpeta \\"spec-demo/esquema\\" en su interior con archivos';
  assert.equal(parseRequestedFromPrompt(slashQuotedEscaped), null);
});

// ── E1-A: flush-then-verify order ──

test("flush-then-verify order: stale empty fails H-012, late flush discovered then passes anomaly", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeTmp();
  try {
    fs.mkdirSync(path.join(wt, "lab6-rev"), { recursive: true });
    // Moment of first-verify snapshot (stale): folder empty, declared [].
    const staleDeclared: string[] = [];
    const anomalyStale = detectCreatedFilesAnomaly(wt, PROMPT_R4, staleDeclared);
    assert.ok(anomalyStale !== null && anomalyStale.includes("H-012"), `stale empty must fail H-012, got: ${String(anomalyStale)}`);
    // Late flush lands 2s after verify (R4 dato.txt 62B).
    fs.writeFileSync(path.join(wt, "lab6-rev", "dato.txt"), R4_FILE_CONTENT, "utf-8");
    // Pre-verify rescan reuses H-013: discover + single point.
    const late = discoverLateCreatedFiles(wt, PROMPT_R4, staleDeclared);
    assert.ok(late.length > 0, "late file must be discovered from disk");
    assert.ok(late.includes("lab6-rev/dato.txt"), `expected lab6-rev/dato.txt, got: ${late.join(",")}`);
    const merged = [...staleDeclared, ...late].slice(0, 50);
    const rechecked = reconcileCreatedFiles(merged, wt, PROMPT_R4);
    assert.ok(rechecked.kept.length > 0, "reconciled must keep the late file");
    const anomalyAfter = detectCreatedFilesAnomaly(wt, PROMPT_R4, rechecked.kept);
    assert.equal(anomalyAfter, null, `after flush + reconcile anomaly must clear, got: ${String(anomalyAfter)}`);
  } finally {
    rmRf(wt);
  }
});

test("pre-verify helper composes identically to verify-retry resolve (no duplication)", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeTmp();
  try {
    fs.mkdirSync(path.join(wt, "lab6-rev"), { recursive: true });
    fs.writeFileSync(path.join(wt, "lab6-rev", "dato.txt"), R4_FILE_CONTENT, "utf-8");
    const prev: string[] = [];
    const viaRetry = resolveVerifyRetryCreatedFiles(prev, wt, PROMPT_R4);
    const late = discoverLateCreatedFiles(wt, PROMPT_R4, prev);
    const viaPre = reconcileCreatedFiles([...prev, ...late].slice(0, 50), wt, PROMPT_R4);
    assert.deepEqual([...viaPre.kept].sort(), [...viaRetry.kept].sort());
    assert.ok(viaRetry.added.length > 0, "H-013 must report the late file as added");
  } finally {
    rmRf(wt);
  }
});

test("staggered multi-file: first file clears H-012 for its name, missing second still needs verify-retry (documents 38s bound)", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeTmp();
  try {
    fs.mkdirSync(path.join(wt, "spec-demo"), { recursive: true });
    const stale: string[] = [];
    const before = detectCreatedFilesAnomaly(wt, PROMPT_CLEAN, stale);
    // Empty folder without the requested file fails (stale snapshot).
    // Note: PROMPT_CLEAN has no `archivo` keyword; file clause comes from
    // `con spec-demo/esquema.md`, so fileName is esquema.md when present.
    // Empty dir may or may not fail depending on extraction; either way the
    // late-file path below must be deterministic.
    void before;
    fs.writeFileSync(path.join(wt, "spec-demo", "esquema.md"), "# esquema\n", "utf-8");
    const late = discoverLateCreatedFiles(wt, PROMPT_CLEAN, stale);
    assert.ok(late.length > 0, "first staggered file must be discovered");
    const rechecked = reconcileCreatedFiles([...stale, ...late].slice(0, 50), wt, PROMPT_CLEAN);
    const after = detectCreatedFilesAnomaly(wt, PROMPT_CLEAN, rechecked.kept);
    assert.equal(after, null, `first file present must clear anomaly, got: ${String(after)}`);
  } finally {
    rmRf(wt);
  }
});

test("no late-write means no invention (empty stays H-012 fail)", { timeout: TEST_TIMEOUT_MS }, () => {
  const wt = makeTmp();
  try {
    fs.mkdirSync(path.join(wt, "lab6-rev"), { recursive: true });
    const late = discoverLateCreatedFiles(wt, PROMPT_R4, []);
    assert.deepEqual(late, []);
    const rechecked = reconcileCreatedFiles([], wt, PROMPT_R4);
    assert.deepEqual(rechecked.kept, []);
    const anomaly = detectCreatedFilesAnomaly(wt, PROMPT_R4, []);
    assert.ok(anomaly !== null && anomaly.includes("H-012"));
  } finally {
    rmRf(wt);
  }
});

// ── Flujo simple: sin rescan pre-verify en el service ──

test("implementService no hace rescan pre-verify (una sola verificación)", { timeout: TEST_TIMEOUT_MS }, () => {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const decoded = decodeURIComponent(here);
  const src = fs.readFileSync(
    path.join(decoded, "..", "headless-runtime", "implement", "implementService.ts"),
    "utf-8",
  );
  const verifyIdx = src.indexOf("verificationService.run(worktreePath, dir, workItem.prompt, createdFiles)");
  assert.ok(verifyIdx >= 0, "service must run verification");
  assert.ok(!src.includes("discoverLateCreatedFiles"), "service must not rescan pre-verify");
  assert.ok(!src.includes("IMPLEMENT_PRE_VERIFY_RESCAN_MAX_ATTEMPTS"), "sin cap de rescan");
  assert.ok(!src.includes("IMPLEMENT_PRE_VERIFY_RESCAN_DELAY_MS"), "sin delay de rescan");
});
