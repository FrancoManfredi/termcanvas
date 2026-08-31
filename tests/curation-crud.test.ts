import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addCuration,
  updateCuration,
  deleteCuration,
  recoverCuration,
  purgeCuration,
} from "../headless-runtime/interview/curation.ts";
import { loadSynthesis } from "../headless-runtime/interview/requirements.ts";
import { loadLedger } from "../headless-runtime/interview/engine.ts";
import type { SynthesisResult } from "../headless-runtime/interview/schema.ts";

function makeSynthesis(): SynthesisResult {
  return {
    proyecto_metadata: {
      nombre_proyecto: "Education Games",
      id_sesion: "ses_1",
      fecha_relevamiento: "2026-08-16T12:00:00.000Z",
      brief_contexto: "Contexto",
    },
    historias_de_usuario: [],
    historias_backfilled: false,
    historias_eliminadas: [],
    requerimientos_funcionales: [
      {
        id: "RF-001",
        descripcion: "Permitir asignar un juego",
        justificacion: "Justificacion",
        prioridad: "Must have",
        criterio_de_ajuste: "Criterio",
        origen: "a1",
        historia_origen: "HS-001",
        historias_origen: ["HS-001"],
      },
    ],
    atributos_de_calidad_y_asrs: [
      {
        id: "ASR-001",
        atributo: "Rendimiento",
        es_asr_genuino: true,
        justificacion_arquitectonica: "Obliga una decision estructural",
        escenario_tecnico_6_partes: {
          fuente: "Alumno",
          estimulo: "Abre el juego",
          artefacto: "Netbook",
          entorno: "2GB RAM",
          respuesta: "Corre fluido",
          medida_de_respuesta: "< 100ms",
        },
        trade_offs_identificados: "Ninguno",
        origen: "a2",
      },
    ],
    restricciones_globales: [
      {
        id: "CON-001",
        tipo: "Stack Tecnologico",
        descripcion: "Web liviana (PWA)",
        impacto: "Sin app nativa",
      },
    ],
    glosario_de_terminos: { Netbook: "Dispositivo del Plan Ceibal" },
    rfs_eliminados: [],
    asrs_eliminados: [],
    restricciones_eliminadas: [],
    terminos_eliminados: [],
  };
}

function writeProject(synthesis?: SynthesisResult): { project: string; synthesisPath: string; ledgerPath: string } {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "tc-cur-"));
  const dir = path.join(project, ".agents", "interview", "requerimientos");
  fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const synthesisPath = path.join(dir, `entrevista-${ts}-sintesis.json`);
  const ledgerPath = path.join(dir, `entrevista-${ts}.json`);
  const syn = synthesis ?? makeSynthesis();
  fs.writeFileSync(synthesisPath, JSON.stringify(syn, null, 2));
  fs.writeFileSync(
    ledgerPath,
    JSON.stringify({ session_id: "ses_1", project_path: project, synthesis: { at: new Date().toISOString(), data: syn } }),
    null,
    2,
  );
  return { project, synthesisPath, ledgerPath };
}

function assertPersisted(synthesisPath: string, ledgerPath: string) {
  const standalone = loadSynthesis(synthesisPath);
  const ledger = loadLedger(ledgerPath);
  assert.ok(standalone, "standalone must load");
  assert.ok(ledger.synthesis?.data, "ledger synthesis must load");
  assert.deepEqual(standalone, ledger.synthesis.data, "standalone and ledger must stay in sync");
}

// ─── RF ────────────────────────────────────────────────────────────────────

test("addCuration rf: next id, origen manual, persisted in both files", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const res = addCuration(synthesisPath, "rf", { descripcion: "Permitir exportar el progreso" });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const added = res.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-002");
  assert.ok(added, "next id RF-002");
  assert.equal(added!.origen, "manual");
  assert.equal(added!.descripcion, "Permitir exportar el progreso");
  assertPersisted(synthesisPath, ledgerPath);
});

test("updateCuration rf: preserves id and origen", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const res = updateCuration(synthesisPath, "rf", "RF-001", { descripcion: "Descripcion nueva", prioridad: "Should have" });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const rf = res.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-001")!;
  assert.equal(rf.descripcion, "Descripcion nueva");
  assert.equal(rf.prioridad, "Should have");
  assert.equal(rf.id, "RF-001");
  assert.equal(rf.origen, "a1");
  assertPersisted(synthesisPath, ledgerPath);
});

test("deleteCuration rf: tombstone + removed from active, recover restores", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const del = deleteCuration(synthesisPath, "rf", "RF-001");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  assert.ok(!del.synthesis.requerimientos_funcionales.some((r) => r.id === "RF-001"));
  assert.equal(del.synthesis.rfs_eliminados.length, 1);
  const rec = recoverCuration(synthesisPath, "rf", "RF-001");
  assert.ok(rec.ok, rec.ok ? "ok" : rec.error);
  if (!rec.ok) return;
  assert.ok(rec.synthesis.requerimientos_funcionales.some((r) => r.id === "RF-001"));
  assert.equal(rec.synthesis.rfs_eliminados.length, 0);
  assertPersisted(synthesisPath, ledgerPath);
});

// ─── ASR ───────────────────────────────────────────────────────────────────

test("addCuration asr: next id with scenario, persisted", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const res = addCuration(synthesisPath, "asr", {
    atributo: "Disponibilidad",
    es_asr_genuino: true,
    escenario_tecnico_6_partes: { fuente: "Monitor", medida_de_respuesta: "< 5s/mes" },
  });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const added = res.synthesis.atributos_de_calidad_y_asrs.find((a) => a.id === "ASR-002")!;
  assert.equal(added.atributo, "Disponibilidad");
  assert.equal(added.escenario_tecnico_6_partes.fuente, "Monitor");
  assert.equal(added.escenario_tecnico_6_partes.medida_de_respuesta, "< 5s/mes");
  assert.equal(added.origen, "manual");
  assertPersisted(synthesisPath, ledgerPath);
});

test("deleteCuration asr: tombstone + recover", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const del = deleteCuration(synthesisPath, "asr", "ASR-001");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  assert.equal(del.synthesis.asrs_eliminados.length, 1);
  const rec = recoverCuration(synthesisPath, "asr", "ASR-001");
  assert.ok(rec.ok, rec.ok ? "ok" : rec.error);
  if (!rec.ok) return;
  assert.equal(rec.synthesis.asrs_eliminados.length, 0);
  assertPersisted(synthesisPath, ledgerPath);
});

// ─── Restricciones ─────────────────────────────────────────────────────────

test("addCuration constraint: next id + update + delete + recover", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const add = addCuration(synthesisPath, "constraint", { tipo: "Tiempo", descripcion: "Entrega en 60 días" });
  assert.ok(add.ok, add.ok ? "ok" : add.error);
  if (!add.ok) return;
  const con = add.synthesis.restricciones_globales.find((c) => c.id === "CON-002")!;
  assert.equal(con.descripcion, "Entrega en 60 días");
  const up = updateCuration(synthesisPath, "constraint", "CON-002", { tipo: "Tiempo", descripcion: "Entrega en 45 días", impacto: "Sin margen" });
  assert.ok(up.ok, up.ok ? "ok" : up.error);
  if (!up.ok) return;
  assert.equal(up.synthesis.restricciones_globales.find((c) => c.id === "CON-002")!.impacto, "Sin margen");
  const del = deleteCuration(synthesisPath, "constraint", "CON-002");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  assert.equal(del.synthesis.restricciones_eliminadas.length, 1);
  const rec = recoverCuration(synthesisPath, "constraint", "CON-002");
  assert.ok(rec.ok, rec.ok ? "ok" : rec.error);
  if (!rec.ok) return;
  assert.ok(rec.synthesis.restricciones_globales.some((c) => c.id === "CON-002"));
  assertPersisted(synthesisPath, ledgerPath);
});

// ─── Glosario ──────────────────────────────────────────────────────────────

test("addCuration term: adds entry; duplicate fails; update renames; delete+recover", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const add = addCuration(synthesisPath, "term", { termino: "Netbook", definicion: "Laptop educativa" });
  assert.equal(add.ok, false, "duplicate term must fail");

  const okAdd = addCuration(synthesisPath, "term", { termino: "Docente", definicion: "Maestro a cargo del grupo" });
  assert.ok(okAdd.ok, okAdd.ok ? "ok" : okAdd.error);
  if (!okAdd.ok) return;
  assert.equal(okAdd.synthesis.glosario_de_terminos["Docente"], "Maestro a cargo del grupo");

  const upd = updateCuration(synthesisPath, "term", "Docente", { termino: "Maestro", definicion: "Maestro a cargo del grupo (docente)" });
  assert.ok(upd.ok, upd.ok ? "ok" : upd.error);
  if (!upd.ok) return;
  assert.ok(!("Docente" in upd.synthesis.glosario_de_terminos), "old key removed on rename");
  assert.equal(upd.synthesis.glosario_de_terminos["Maestro"], "Maestro a cargo del grupo (docente)");

  const del = deleteCuration(synthesisPath, "term", "Maestro");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  assert.equal(del.synthesis.terminos_eliminados.length, 1);

  const rec = recoverCuration(synthesisPath, "term", "Maestro");
  assert.ok(rec.ok, rec.ok ? "ok" : rec.error);
  if (!rec.ok) return;
  assert.equal(rec.synthesis.glosario_de_terminos["Maestro"], "Maestro a cargo del grupo (docente)");
  assert.equal(rec.synthesis.terminos_eliminados.length, 0);
  assertPersisted(synthesisPath, ledgerPath);
});

// ─── Orden canónico (menor a mayor) ────────────────────────────────────────

test("purgeCuration: removes the tombstone permanently (no recovery possible)", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const del = deleteCuration(synthesisPath, "rf", "RF-001");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  const purge = purgeCuration(synthesisPath, "rf", "RF-001");
  assert.ok(purge.ok, purge.ok ? "ok" : purge.error);
  if (!purge.ok) return;
  assert.equal(purge.synthesis.rfs_eliminados.length, 0, "tombstone purged");
  const rec = recoverCuration(synthesisPath, "rf", "RF-001");
  assert.equal(rec.ok, false, "purged item cannot be recovered");
  assertPersisted(synthesisPath, ledgerPath);
});

test("purgeCuration term: purges a deleted glossary term", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const del = deleteCuration(synthesisPath, "term", "Netbook");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  const purge = purgeCuration(synthesisPath, "term", "Netbook");
  assert.ok(purge.ok, purge.ok ? "ok" : purge.error);
  if (!purge.ok) return;
  assert.equal(purge.synthesis.terminos_eliminados.length, 0);
  assertPersisted(synthesisPath, ledgerPath);
});

test("mutations keep active lists sorted by id ascending", () => {
  const base = makeSynthesis();
  base.requerimientos_funcionales = [
    base.requerimientos_funcionales[0],
    { ...base.requerimientos_funcionales[0], id: "RF-003", descripcion: "Tercero" },
  ];
  const { synthesisPath, ledgerPath } = writeProject(base);
  const res = addCuration(synthesisPath, "rf", { descripcion: "Cuarto" });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const ids = res.synthesis.requerimientos_funcionales.map((r) => r.id);
  assert.deepEqual(ids, ["RF-001", "RF-003", "RF-004"], "must be sorted even after add");
  assertPersisted(synthesisPath, ledgerPath);
});
