/**
 * FASE 4 E1 — cero uso de cada símbolo enterrado (test previo de cada borrado,
 * en la misma tanda que el borrado, según docs/MASTER-PLAN-MODULARIDAD.md §4 +
 * C10 trazabilidad).
 *
 * Borrados que cubre (hecho-con-archivo:líneas en el reporte F4-E1):
 * 1. `toFactoryJobFromWorkItem` en `headless-runtime/factory/factoryServer.ts`
 *    (puente dual Ola 1, uso-cero: cero llamadas) → estático + conductual.
 * 2. Ramas legacy en `getAllJobsForList`/`getSingleJobResponse` (corte del
 *    alimento `legacy:`; `jobs/jobService` conserva su opt para vecinas) →
 *    conductual: lista/detalle pasan SOLO con la tienda, formas intactas.
 * 3. `ensureResultJson` en `headless-runtime/workItem/workItemDisk.ts`
 *    (jubilado; llamados internos mudados a `ensureResultJsonCompat`) → estático.
 * 4. Singleton público `resultWriter` en
 *    `headless-runtime/implement/resultWriter.ts` (motor interno de
 *    `resultStore`; la clase sigue exportada solo para el store) → estático.
 * 5. Re-export `isRichResultJson` en `factoryServer.ts` (casa única
 *    `resultStore`) → estático.
 *
 * Símbolos NO borrados acá (devueltos como carry-over con evidencia en el
 * reporte, jamás a ciegas): Map `jobs` residual (39 usos `jobs.` + 55
 * `writeJobJson(` + 91 `FactoryJob` en el server), `writeJobJson` como
 * escritor, variante C (`buildMvpChatParts` + dispatch, pineada por
 * `mvp-builders-allowlist`), `tools:{}` (ya `toolsetFor`; sin evidencia de
 * segundo escritor en foreman), stales `ubuntu:22.04` en yaml legacy
 * (`runners/*.yaml` con lector vivo) y `LINUX_BUILD_FALLBACK` (ya
 * imageless+obsoleto, archivo de E2: no se toca).
 *
 * Offline total (tmp + tienda en memoria, sin daemon, sin red, cero LLM real,
 * sin docker). Reglas: las 8 + C1–C10 (C1 ESM/cotas sin loops escritos a mano
 * en este archivo salvo `for...of` acotado; C5 aditivo: formas intactas).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { getJobDetail, listJobs } from "../headless-runtime/factory/jobs/jobService.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

function mkTmp(prefix = "f4e1-zero-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort (C4)
  }
}

// ── Estático: símbolos enterrados ausentes ──

test("F4-E1 uso-cero: puente toFactoryJobFromWorkItem extirpado del server", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  assert.equal(src.includes("toFactoryJobFromWorkItem"), false);
});

test("F4-E1 uso-cero: ensureResultJson jubilado fuera de workItemDisk", () => {
  const src = readRel("headless-runtime/workItem/workItemDisk.ts");
  assert.equal(src.includes("export function ensureResultJson"), false);
  // Sin llamadas al alias (el límite evita confundir con ensureResultJsonCompat):
  assert.doesNotMatch(src, /\bensureResultJson\s*\(/);
  assert.ok(
    src.includes("ensureResultJsonCompat(item)"),
    "los llamados internos van directo a la tienda única",
  );
});

test("F4-E1 uso-cero: singleton público resultWriter extirpado (clase interna viva)", () => {
  const src = readRel("headless-runtime/implement/resultWriter.ts");
  assert.equal(src.includes("export const resultWriter"), false);
  assert.ok(src.includes("export class ResultWriter"), "el motor sigue para resultStore");
  const storeSrc = readRel("headless-runtime/workItem/resultStore.ts");
  assert.ok(
    storeSrc.includes('from "../implement/resultWriter"'),
    "resultStore sigue siendo el único importador",
  );
});

test("F4-E1 uso-cero: re-export isRichResultJson extirpado del server", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  assert.doesNotMatch(src, /export\s*\{\s*isRichResultJson\s*\}/);
  assert.doesNotMatch(src, /function isRichResultJson/);
});

test("F4-E1 uso-cero: lista/detalle del server sin alimento legacy", () => {
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
    assert.equal(src.slice(start, end).includes("legacy:"), false, `${fn} ya no alimenta rama legacy`);
  }
});

// ── Conductual: lista/detalle solo con la tienda, formas intactas ──

test("F4-E1 uso-cero: listJobs sin legacy sirve la tienda con forma intacta", () => {
  const dir = mkTmp();
  const id = `job-f4e1-zero-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "prompt tienda única", worktree: dir });
  try {
    const list = listJobs();
    const found = list.find((j) => j.id === id) as Record<string, unknown> | undefined;
    assert.ok(found, "el item de la tienda aparece sin alimento legacy");
    assert.equal(found.prompt, "prompt tienda única");
    assert.equal(found.status, "Intake");
    assert.ok(Array.isArray(found.logs), "lista trae logs (compat)");
    assert.equal(typeof found.logsCount, "number", "lista trae logsCount (compat)");
    assert.ok(Array.isArray(found.timeline), "lista trae timeline");
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
    rmTmp(dir);
  }
});

test("F4-E1 uso-cero: getJobDetail sin legacy sirve jobView con forma intacta", () => {
  const dir = mkTmp();
  const id = `job-f4e1-zerod-${Date.now().toString(36)}`;
  workItemStore.create({ id, prompt: "detalle tienda única", worktree: dir });
  try {
    const detail = getJobDetail(id) as Record<string, unknown> | null;
    assert.ok(detail, "el detalle sale solo de la tienda");
    assert.equal(detail.id, id);
    assert.equal(detail.status, "Intake");
    assert.ok(Array.isArray(detail.logs), "detalle trae logs");
    assert.equal("logsCount" in detail, false, "detalle SIN logsCount (quirk compat intacto)");
    const preview = detail.resultPreview as Record<string, unknown> | undefined;
    assert.ok(preview, "detalle trae resultPreview");
    assert.equal(preview.jobId, id);
    assert.equal(getJobDetail("job-f4e1-inexistente"), null, "ausente → null honesto");
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
    rmTmp(dir);
  }
});

// ── TANDA 1 — cierre anti-God: Map dual + escritor legacy extirpados ──
// El server persiste SOLO vía la tienda única (`persistSingleStore` /
// `appendSingleStoreLog` / `syncSessionFieldsAndPersist` sobre
// `workItemStore` + `resultStore.pruneIfPoor`). Sin delegación restante:
// cero llamados en lógica (los `writeJobJson` sin paréntesis que quedan son
// comentarios de trazabilidad C10, no código).

test("T1 uso-cero: Map dual extirpado del server (sin `new Map` de FactoryJob)", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  assert.doesNotMatch(src, /new\s+Map\s*<\s*string\s*,\s*FactoryJob\s*>/);
  assert.doesNotMatch(src, /const\s+jobs\s*=\s*new\s+Map/);
});

test("T1 uso-cero: cero llamados a writeJobJson en lógica (extirpado, sin delegación)", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  const hits = src.match(/writeJobJson\s*\(/g) ?? [];
  assert.equal(hits.length, 0, `writeJobJson( debe ser 0, hallados ${hits.length}`);
});

test("T1 uso-cero: cero toques al Map dual en lógica (solo tienda única)", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  const hits = src.match(/\bjobs\s*\.\s*(get|set|has|delete|values)\s*\(?/g) ?? [];
  assert.equal(hits.length, 0, `jobs.(get|set|has|delete|values) debe ser 0, hallados ${hits.length}`);
});

test("T1 uso-cero: getAllJobsForList/getSingleJobResponse no leen el Map (tienda única confirmada)", () => {
  // Alcance quirúrgico: cuerpos de ambas funciones (cierre a columna 0).
  // (El server usa CRLF: se normaliza antes de buscar el cierre.)
  const src = readRel("headless-runtime/factory/factoryServer.ts").split("\r\n").join("\n");
  for (const fn of ["getAllJobsForList", "getSingleJobResponse"]) {
    const start = src.indexOf(`function ${fn}(`);
    assert.ok(start >= 0, `${fn} existe en el server`);
    const end = src.indexOf("\n}\n", start);
    assert.ok(end > start, `${fn} cierra a columna 0`);
    const body = src.slice(start, end);
    assert.equal(body.includes("legacy:"), false, `${fn} sin alimento legacy`);
    assert.doesNotMatch(body, /\bjobs\s*\./);
  }
  assert.ok(src.includes("listJobs({"), "la lista sigue delegando en jobs/listJobs");
  assert.ok(src.includes("getJobDetail("), "el detalle sigue delegando en jobs/getJobDetail");
});

test("T1 uso-cero: la persistencia única vive en el server (punto único documentado)", () => {
  const src = readRel("headless-runtime/factory/factoryServer.ts");
  assert.ok(src.includes("function persistSingleStore("), "existe el punto único job.json + .done + poda");
  assert.ok(src.includes("function appendSingleStoreLog("), "existe el log único sin timeline");
  assert.ok(src.includes("function syncSessionFieldsAndPersist("), "existe la sync de sesión sin pisar timeline");
  assert.match(src, /resultStore\.pruneIfPoor\(wi\.dir\)/);
});
