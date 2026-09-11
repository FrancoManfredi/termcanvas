/**
 * FASE 4 E1 — techo final de imports del daemon (lista blanca post-entierro).
 * Falla ante cualquier import prohibido en las fuentes del daemon o ante la
 * reaparición de símbolos enterrados. Offline total: lectura estática +
 * `node:test`, sin daemon, sin red, cero LLM real, sin docker.
 *
 * Lo que fija (docs/MASTER-PLAN-MODULARIDAD.md §2 FASE 4 + §3):
 * - `implement/resultWriter` (motor interno): solo `resultStore` lo importa.
 * - `ensureResultJson` de `workItemDisk` (jubilado): nadie lo importa.
 * - `isRichResultJson` desde `factoryServer` (re-export jubilado): nadie.
 * - `toFactoryJobFromWorkItem` (puente dual): cero tokens en daemon+tests.
 * - Lista/detalle del cascarón: solo tienda (`listJobs`/`getJobDetail` sin
 *   alimento legacy).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`; recorridos acotados a listas
 *   fijas + `readdirSync` de un solo nivel con `for...of` (sin recursión
 *   escrita a mano, sin timers, sin polling).
 * - C2 puras fail-safe: lectura estática, nunca lanza fuera de asserts.
 * - C5 aditivo: solo lee (jamás modifica fuentes ni formas).
 * - C6/C7 vocabulario único, nada duplicado: reutiliza el extractor de
 *   imports de las suites vecinas (misma regex), no inventa otro.
 * - C10 trazabilidad: cada test cita su borrado y su suite de uso-cero.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

/** Líneas de import (misma regex que las suites vecinas de barrido). */
function importLines(src: string): string[] {
  return src.split("\n").filter((l) => /(^|\s)import[\s(]/.test(l));
}

/**
 * Fuentes del daemon bajo entierro E1 (fijas, sin walks recursivos).
 * `implementService.ts` se incluye SOLO en lectura (vecina, no se toca).
 */
const DAEMON_SOURCES = [
  "headless-runtime/factory/factoryServer.ts",
  "headless-runtime/factory/agentLoader.ts",
  "headless-runtime/factory/jobs/jobService.ts",
  "headless-runtime/factory/jobs/jobRoutes.ts",
  "headless-runtime/factory/verify/verifyService.ts",
  "headless-runtime/factory/verify/verifyRoutes.ts",
  "headless-runtime/workItem/workItem.ts",
  "headless-runtime/workItem/workItemDisk.ts",
  "headless-runtime/workItem/workItemStore.ts",
  "headless-runtime/workItem/resultStore.ts",
  "headless-runtime/workItem/jobView.ts",
  "headless-runtime/implement/resultWriter.ts",
  "headless-runtime/implement/implementService.ts",
  "shared/types/runner.ts",
] as const;

/** Archivos tocados por F4-E1 (techo ESM: cero `require()`). */
const TOUCHED_FILES = [
  "headless-runtime/factory/factoryServer.ts",
  "headless-runtime/workItem/workItemDisk.ts",
  "headless-runtime/implement/resultWriter.ts",
  "tests/writejobjson-result-guard.test.ts",
  "tests/import-sweep-final.test.ts",
  "tests/legacy-zero-use.test.ts",
  "tests/jobview-single.test.ts",
  "tests/resultstore-single-writer.test.ts",
] as const;

test("F4-E1 barrido final: solo resultStore importa implement/resultWriter", () => {
  for (const rel of DAEMON_SOURCES) {
    if (rel.endsWith("workItem/resultStore.ts")) continue;
    const hits = importLines(readRel(rel)).filter((l) => l.includes("resultWriter"));
    assert.deepEqual(hits, [], `${rel} no debe importar resultWriter (motor interno de resultStore)`);
  }
  const storeImports = importLines(readRel("headless-runtime/workItem/resultStore.ts")).filter((l) =>
    l.includes("resultWriter"),
  );
  assert.equal(storeImports.length, 1, "resultStore sigue siendo el único importador del motor");
});

test("F4-E1 barrido final: nadie importa ensureResultJson de workItemDisk", () => {
  for (const rel of DAEMON_SOURCES) {
    // Límite de palabra: `ensureResultJsonCompat` (tienda única, viva) NO cuenta.
    const hits = importLines(readRel(rel)).filter((l) => /\bensureResultJson\b/.test(l));
    assert.deepEqual(hits, [], `${rel} no debe importar ensureResultJson (símbolo enterrado)`);
  }
});

test("F4-E1 barrido final: nadie importa isRichResultJson desde factoryServer", () => {
  for (const rel of DAEMON_SOURCES) {
    const hits = importLines(readRel(rel)).filter(
      (l) => l.includes("isRichResultJson") && !l.includes("resultStore"),
    );
    assert.deepEqual(hits, [], `${rel} no debe importar isRichResultJson fuera de resultStore`);
  }
  // La única importadora histórica era la suite vecina (ya migrada a estático):
  // ningún test debe volver a importar el predicado desde el server.
  const testDir = path.join(REPO, "tests");
  const offenders: string[] = [];
  for (const entry of fs.readdirSync(testDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".test.ts")) continue;
    const src = fs.readFileSync(path.join(testDir, entry.name), "utf-8");
    const hits = importLines(src).filter(
      (l) => l.includes("factoryServer") && l.includes("isRichResultJson"),
    );
    if (hits.length > 0) offenders.push(entry.name);
  }
  assert.deepEqual(offenders, [], `tests que reimportan el re-export enterrado: ${offenders.join(", ")}`);
});

test("F4-E1 barrido final: cero token toFactoryJobFromWorkItem en daemon+tests", () => {
  // Estas dos suites nombran el símbolo solo como literal de aserción (uso-cero),
  // no como código: se excluyen del barrido con motivo documentado. El comentario
  // de entierro del server tampoco usa el literal (cita la suite, C10).
  const SELF_EXEMPT = new Set(["import-sweep-final.test.ts", "legacy-zero-use.test.ts"]);
  const hits: string[] = [];
  for (const rel of DAEMON_SOURCES) {
    if (readRel(rel).includes("toFactoryJobFromWorkItem")) hits.push(rel);
  }
  const testDir = path.join(REPO, "tests");
  for (const entry of fs.readdirSync(testDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".test.ts")) continue;
    if (SELF_EXEMPT.has(entry.name)) continue;
    const src = fs.readFileSync(path.join(testDir, entry.name), "utf-8");
    if (src.includes("toFactoryJobFromWorkItem")) hits.push(`tests/${entry.name}`);
  }
  assert.deepEqual(hits, [], `puente dual reaparecido en:\n${hits.join("\n")}`);
});

test("F4-E1 barrido final: ESM cero require() en archivos tocados", () => {
  const hits: string[] = [];
  for (const rel of TOUCHED_FILES) {
    if (/\brequire\s*\(\s*["'`]/.test(readRel(rel))) hits.push(rel);
  }
  assert.deepEqual(hits, [], `require() prohibido (ESM, C1) en:\n${hits.join("\n")}`);
});

test("F4-E1 barrido final: el cascarón delega lista/detalle solo en la tienda", () => {
  // Alcance quirúrgico: SOLO los cuerpos de getAllJobsForList/getSingleJobResponse
  // (dueñas E1). Los `legacy: jobs.get(...)` de handlers de review/verify son de
  // E2 y no se tocan (reparto sin solape); el cierre a columna 0 delimita.
  // (El server usa CRLF: se normaliza antes de buscar el cierre.)
  const src = readRel("headless-runtime/factory/factoryServer.ts").split("\r\n").join("\n");
  for (const fn of ["getAllJobsForList", "getSingleJobResponse"]) {
    const start = src.indexOf(`function ${fn}(`);
    assert.ok(start >= 0, `${fn} existe en el server`);
    const end = src.indexOf("\n}\n", start);
    assert.ok(end > start, `${fn} cierra a columna 0`);
    const body = src.slice(start, end);
    assert.equal(body.includes("legacy:"), false, `${fn} ya no alimenta rama legacy`);
  }
  assert.ok(src.includes("listJobs({"), "la lista sigue delegando en jobs/listJobs");
  assert.ok(src.includes("getJobDetail("), "el detalle sigue delegando en jobs/getJobDetail");
});
