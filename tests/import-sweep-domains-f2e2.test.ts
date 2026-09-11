/**
 * FASE 2 E2 — barrido de dominios review + triageSpec (aporte E2).
 *
 * COORDINACIÓN CON E1: este archivo es aporte SOLO de E2 (dominios
 * `factory/review/*` y `factory/triageSpec/*`). NO edita ni duplica
 * tests/import-sweep-domains-f2.test.ts (aporte E1, dueño E1): todos los
 * nombres de test acá llevan prefijo `F2-E2` (jamás `F2-E1`).
 *
 * Falla si un dominio E2 importa fuera de su lista blanca, si menciona
 * módulos ajenos (triage/spec/measure/notify/definition/runner cruzados),
 * si aparece `require()`/timers de polling/`for(`/`while(` en los archivos
 * nuevos (meta-test de cotas), o si el cascarón pierde la delegación E2
 * (contrato hacia QA y tests vecinos como triage-questions-ui.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REVIEW_FILES = [
  "headless-runtime/factory/review/reviewRoutes.ts",
  "headless-runtime/factory/review/reviewActions.ts",
] as const;

const TRIAGE_SPEC_FILES = [
  "headless-runtime/factory/triageSpec/triageSpecRoutes.ts",
  "headless-runtime/factory/triageSpec/triageSpecService.ts",
] as const;

const REVIEW_ROUTES_ALLOW_IMPORTS = new Set<string>([]);

const REVIEW_ACTIONS_ALLOW_IMPORTS = new Set([
  "node:fs",
  "node:path",
  "../../workItem/workItemStore",
  "../../review/reviewDisk",
  "../reviewRaw",
  "../../../shared/types/review",
]);

const TRIAGE_SPEC_ROUTES_ALLOW_IMPORTS = new Set(["../../spec/specFlow"]);

const TRIAGE_SPEC_SERVICE_ALLOW_IMPORTS = new Set([
  "../../workItem/workItemStore",
  "../../workItem/jobView",
  "../../triage/triageFlow",
  "../../spec/specFlow",
]);

/** Módulos ajenos al dominio review (E1, E2-vecino, medida, avisos, definición, ejecutores, yaml). */
const REVIEW_FORBIDDEN_TOKENS = [
  "triageFlow",
  "triageAgent",
  "triagePrompt",
  "../triage/",
  "/triage/",
  "specFlow",
  "specAgent",
  "specPrompt",
  "SpecBrief",
  "../spec/",
  "/spec/",
  "verifyService",
  "verifyEvidence",
  "verifyRetry",
  "verify-retry",
  "../measure/",
  "/measure/",
  "scorerEngine",
  "scorerLoader",
  "scorerHttp",
  "benchmark",
  "improvement",
  "../notify/",
  "/notify/",
  "notif",
  "definitionValidate",
  "DefinitionIssue",
  ".yaml",
  ".yml",
  "runnerExecutor",
  "runnerService",
  "toolPolicy",
  "agentLoader",
  "getRunner",
  "reviewService",
  "reviewAgent",
  "reviewPrompt",
  "reviewModel",
  "reverifyAllowlist",
  "foremanLog",
  "foremanService",
  "implementService",
  "implement/verification",
  "VerificationPanel",
];

/** Módulos ajenos al dominio triageSpec (review, E1, medida, avisos, definición, ejecutores, yaml). */
const TRIAGE_SPEC_FORBIDDEN_TOKENS = [
  "reviewService",
  "reviewAgent",
  "reviewDisk",
  "reviewRaw",
  "reviewModel",
  "reviewPrompt",
  "checkRetryReviewGuards",
  "resolveReviewRawFileName",
  "../review/",
  "/review/",
  "verifyService",
  "verifyEvidence",
  "verifyRetry",
  "verify-retry",
  "../measure/",
  "/measure/",
  "scorerEngine",
  "scorerLoader",
  "scorerHttp",
  "benchmark",
  "improvement",
  "../notify/",
  "/notify/",
  "notif",
  "definitionValidate",
  "DefinitionIssue",
  ".yaml",
  ".yml",
  "runnerExecutor",
  "runnerService",
  "toolPolicy",
  "agentLoader",
  "getRunner",
  "reverifyAllowlist",
  "foremanLog",
  "implementService",
  "implement/verification",
  "VerificationPanel",
  "factoryServer",
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

test("F2-E2 barrido: reviewRoutes solo importa su lista blanca (cero imports)", () => {
  for (const rel of ["headless-runtime/factory/review/reviewRoutes.ts"] as const) {
    const src = readRel(rel);
    const offenders = extractImports(src).filter((spec) => !REVIEW_ROUTES_ALLOW_IMPORTS.has(spec));
    assert.deepEqual(offenders, [], `${rel} importa fuera de su lista blanca: ${offenders.join(", ")}`);
  }
});

test("F2-E2 barrido: reviewActions solo importa su lista blanca", () => {
  for (const rel of ["headless-runtime/factory/review/reviewActions.ts"] as const) {
    const src = readRel(rel);
    const offenders = extractImports(src).filter((spec) => !REVIEW_ACTIONS_ALLOW_IMPORTS.has(spec));
    assert.deepEqual(offenders, [], `${rel} importa fuera de su lista blanca: ${offenders.join(", ")}`);
  }
});

test("F2-E2 barrido: triageSpecRoutes solo importa su lista blanca", () => {
  for (const rel of ["headless-runtime/factory/triageSpec/triageSpecRoutes.ts"] as const) {
    const src = readRel(rel);
    const offenders = extractImports(src).filter((spec) => !TRIAGE_SPEC_ROUTES_ALLOW_IMPORTS.has(spec));
    assert.deepEqual(offenders, [], `${rel} importa fuera de su lista blanca: ${offenders.join(", ")}`);
  }
});

test("F2-E2 barrido: triageSpecService solo importa su lista blanca", () => {
  for (const rel of ["headless-runtime/factory/triageSpec/triageSpecService.ts"] as const) {
    const src = readRel(rel);
    const offenders = extractImports(src).filter((spec) => !TRIAGE_SPEC_SERVICE_ALLOW_IMPORTS.has(spec));
    assert.deepEqual(offenders, [], `${rel} importa fuera de su lista blanca: ${offenders.join(", ")}`);
  }
});

test("F2-E2 barrido: cero tokens ajenos en review", () => {
  const hits: string[] = [];
  for (const rel of REVIEW_FILES) {
    const body = stripImportLines(readRel(rel));
    for (const token of REVIEW_FORBIDDEN_TOKENS) {
      if (body.includes(token)) hits.push(`${rel} contiene ${JSON.stringify(token)}`);
    }
  }
  assert.deepEqual(hits, [], `tokens ajenos al dominio review:\n${hits.join("\n")}`);
});

test("F2-E2 barrido: cero tokens ajenos en triageSpec", () => {
  const hits: string[] = [];
  for (const rel of TRIAGE_SPEC_FILES) {
    const body = stripImportLines(readRel(rel));
    for (const token of TRIAGE_SPEC_FORBIDDEN_TOKENS) {
      if (body.includes(token)) hits.push(`${rel} contiene ${JSON.stringify(token)}`);
    }
  }
  assert.deepEqual(hits, [], `tokens ajenos al dominio triageSpec:\n${hits.join("\n")}`);
});

test("F2-E2 barrido: ESM cero require() y cero timers de polling en dominios nuevos", () => {
  const hits: string[] = [];
  for (const rel of [...REVIEW_FILES, ...TRIAGE_SPEC_FILES]) {
    const src = readRel(rel);
    if (/\brequire\s*\(\s*["'`]/.test(src)) hits.push(`${rel} usa require()`);
    if (/setTimeout|setInterval/.test(src)) hits.push(`${rel} crea timers (polling prohibido)`);
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("F2-E2 barrido: sin loops escritos en dominios nuevos (meta-test de cotas)", () => {
  const hits: string[] = [];
  for (const rel of [...REVIEW_FILES, ...TRIAGE_SPEC_FILES]) {
    const src = readRel(rel);
    src.split("\n").forEach((line, idx) => {
      if (/for\s*\(/.test(line)) hits.push(`${rel}:${idx + 1} usa for()`);
      if (/while\s*\(/.test(line)) hits.push(`${rel}:${idx + 1} usa while()`);
    });
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("F2-E2 barrido: el cascarón delega en E2 y conserva exports vecinas", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  for (const marker of [
    "FASE 2 E2",
    "./review/reviewActions",
    "./review/reviewRoutes",
    "./triageSpec/triageSpecService",
    "./triageSpec/triageSpecRoutes",
    "export function parseTriageRespondPath",
    "export function checkTriageRespondGuards",
    "export function parseTriageRespondBody",
    "export function applyTriageRespondTransition",
    "skipTriageSpec",
    "Triage→Foreman",
  ]) {
    assert.ok(src.includes(marker), `el cascarón debe conservar/delegar ${marker}`);
  }
});

test("F2-E2 barrido: bloques y archivos de E1 intactos (solo lectura)", () => {
  for (const rel of [
    "headless-runtime/factory/jobs/jobRoutes.ts",
    "headless-runtime/factory/jobs/jobService.ts",
    "headless-runtime/factory/verify/verifyRoutes.ts",
    "headless-runtime/factory/verify/verifyService.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `falta archivo de E1: ${rel}`);
  }
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  for (const marker of [
    "FASE 2 E1",
    "jobs/jobService",
    "jobs/jobRoutes",
    "verify/verifyService",
    "verify/verifyRoutes",
    "scheduleVerifyRetryRun",
    "readVerifyById",
    "getJobDetail",
    "listJobs",
  ]) {
    assert.ok(src.includes(marker), `el cascarón debe conservar delegación E1 en ${marker}`);
  }
});
