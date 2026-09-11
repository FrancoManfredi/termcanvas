/**
 * FASE 2 E1 — barrido de dominios jobs + verify (aporte E1).
 *
 * COORDINACIÓN CON E2: este archivo es aporte SOLO de E1 (dominios
 * `factory/jobs/*` y `factory/verify/*`). E2 agrega SUS tests para
 * `factory/review/*` y `factory/triageSpec/*` con nombres de test
 * prefijados `F2-E2 ...` (nunca `F2-E1 ...`): sin colisiones ni duplicados.
 * E2 tampoco edita este archivo (reparto sin solape: un archivo un dueño).
 *
 * Falla si un dominio E1 importa fuera de su lista blanca, si aparece
 * `require()`/timers de polling en los archivos nuevos, o si el cascarón
 * pierde los exports delegados (contrato congelado hacia E2/QA y tests
 * vecinos como verify-retry.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const JOBS_FILES = [
  "headless-runtime/factory/jobs/jobRoutes.ts",
  "headless-runtime/factory/jobs/jobService.ts",
] as const;

const VERIFY_FILES = [
  "headless-runtime/factory/verify/verifyRoutes.ts",
  "headless-runtime/factory/verify/verifyService.ts",
] as const;

const JOBS_ALLOW_IMPORTS = new Set([
  "node:fs",
  "node:path",
  "../../workItem/workItemStore",
  "../../workItem/jobView",
  "../../workItem/resultStore",
  "../../../shared/types/workItem",
]);

const VERIFY_ALLOW_IMPORTS = new Set([
  "node:fs",
  "node:path",
  "../../workItem/workItemStore",
  "../../implement/verifyEvidence",
  "../../../shared/types/implement",
  "../../../shared/types/workItem",
]);

/** Módulos ajenos a E1 (E2, medida, avisos, definición, ejecutores, yaml). */
const FORBIDDEN_TOKENS = [
  // Nota: NO se listan "../review/" ni "/review/" a propósito: la ruta
  // literal `/review/verify-retry` ES del dominio verify (sufijo propio).
  // Los módulos ajenos se detectan por nombre de módulo/símbolo.
  "reviewService",
  "reviewRaw",
  "reviewAgent",
  "reviewPrompt",
  "reviewDisk",
  "reviewModel",
  "reverifyAllowlist",
  "../triage/",
  "/triage/",
  "triageFlow",
  "triageAgent",
  "triagePrompt",
  "TriageFindings",
  "../spec/",
  "/spec/",
  "specFlow",
  "specAgent",
  "specPrompt",
  "SpecBrief",
  "../measure/",
  "/measure/",
  "scorerEngine",
  "scorerLoader",
  "scorerHttp",
  "Scorer",
  "scorer",
  "benchmark",
  "Benchmark",
  "improvement",
  "Improvement",
  "../notify/",
  "/notify/",
  "notif",
  "definitionValidate",
  "DefinitionIssue",
  "definition/status",
  ".yaml",
  ".yml",
  "runnerExecutor",
  "runnerService",
  "toolPolicy",
  "agentLoader",
  "getRunner",
  "factoryServer",
  "VerificationPanel",
  "verificationFallback",
];

function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

function extractImports(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s+[^;]*?\bfrom\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  const sideRe = /^\s*import\s*["']([^"']+)["']\s*;/gm;
  while ((m = sideRe.exec(src)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function stripImportLines(src: string): string {
  return src
    .split("\n")
    .filter((line) => !/^\s*import\s+/.test(line) && !/\bfrom\s*["']/.test(line))
    .join("\n");
}

test("F2-E1 barrido: jobs solo importa su lista blanca", () => {
  for (const rel of JOBS_FILES) {
    const src = readRel(rel);
    const offenders = extractImports(src).filter((spec) => !JOBS_ALLOW_IMPORTS.has(spec));
    assert.deepEqual(offenders, [], `${rel} importa fuera de su lista blanca: ${offenders.join(", ")}`);
  }
});

test("F2-E1 barrido: verify solo importa su lista blanca", () => {
  for (const rel of VERIFY_FILES) {
    const src = readRel(rel);
    const offenders = extractImports(src).filter((spec) => !VERIFY_ALLOW_IMPORTS.has(spec));
    assert.deepEqual(offenders, [], `${rel} importa fuera de su lista blanca: ${offenders.join(", ")}`);
  }
});

test("F2-E1 barrido: cero tokens ajenos en los 4 archivos nuevos", () => {
  const hits: string[] = [];
  for (const rel of [...JOBS_FILES, ...VERIFY_FILES]) {
    const body = stripImportLines(readRel(rel));
    for (const token of FORBIDDEN_TOKENS) {
      if (body.includes(token)) hits.push(`${rel} contiene ${JSON.stringify(token)}`);
    }
  }
  assert.deepEqual(hits, [], `tokens ajenos a E1:\n${hits.join("\n")}`);
});

test("F2-E1 barrido: ESM cero require() y cero timers de polling en dominios nuevos", () => {
  const hits: string[] = [];
  for (const rel of [...JOBS_FILES, ...VERIFY_FILES]) {
    const src = readRel(rel);
    if (/\brequire\s*\(\s*["'`]/.test(src)) hits.push(`${rel} usa require()`);
    if (/setTimeout|setInterval/.test(src)) hits.push(`${rel} crea timers (polling prohibido)`);
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("F2-E1 barrido: el cascarón conserva exports delegados (contrato E2/QA)", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  for (const name of [
    "export function parseVerifyRetryPath",
    "export function parseVerifyGetPath",
    "export function checkVerifyRetryGuards",
  ]) {
    assert.ok(src.includes(name), `el cascarón debe conservar ${name} (tests vecinos)`);
  }
  for (const marker of [
    "jobs/jobService",
    "jobs/jobRoutes",
    "verify/verifyService",
    "verify/verifyRoutes",
    "scheduleVerifyRetryRun",
    "readVerifyById",
    "getJobDetail",
    "listJobs",
  ]) {
    assert.ok(src.includes(marker), `el cascarón debe delegar en ${marker}`);
  }
});
