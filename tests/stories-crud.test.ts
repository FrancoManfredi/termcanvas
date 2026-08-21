import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addUserStory,
  updateUserStory,
  deleteUserStory,
  recoverUserStory,
  purgeUserStory,
} from "../headless-runtime/interview/stories.ts";
import { loadSynthesis } from "../headless-runtime/interview/requirements.ts";
import { loadLedger } from "../headless-runtime/interview/engine.ts";
import type { SynthesisResult } from "../headless-runtime/interview/schema.ts";

// ─── Fixture ───────────────────────────────────────────────────────────────
// Relación N:N: RF-001 formaliza HS-001; RF-002 formaliza HS-001 y HS-002.

function makeSynthesis(): SynthesisResult {
  return {
    proyecto_metadata: {
      nombre_proyecto: "Education Games",
      id_sesion: "ses_1",
      fecha_relevamiento: "2026-08-16T12:00:00.000Z",
      brief_contexto: "Contexto",
    },
    historias_de_usuario: [
      {
        id: "HS-001",
        titulo: "Asignar juegos por grupo",
        rol: "maestra",
        quiero: "asignar un juego a un grupo",
        para: "que cada grupo practique lo que le falta",
        criterios_de_aceptacion: ["Elige grupo y juego"],
        prioridad: "Must have",
        origen: "a1",
      },
      {
        id: "HS-002",
        titulo: "Ver progreso por alumno",
        rol: "maestra",
        quiero: "ver el progreso de cada alumno",
        para: "saber quién necesita ayuda",
        criterios_de_aceptacion: ["Lista de alumnos con progreso"],
        prioridad: "Should have",
        origen: "a2",
      },
    ],
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
      {
        id: "RF-002",
        descripcion: "Permitir seguir el progreso",
        justificacion: "Justificacion",
        prioridad: "Should have",
        criterio_de_ajuste: "Criterio",
        origen: "a2",
        historia_origen: "HS-002",
        historias_origen: ["HS-001", "HS-002"],
      },
    ],
    atributos_de_calidad_y_asrs: [],
    restricciones_globales: [],
    glosario_de_terminos: {},
  };
}

function writeProject(synthesis?: SynthesisResult): { project: string; synthesisPath: string; ledgerPath: string } {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "tc-stories-"));
  const dir = path.join(project, ".agents", "interview", "requerimientos");
  fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const synthesisPath = path.join(dir, `entrevista-${ts}-sintesis.json`);
  const ledgerPath = path.join(dir, `entrevista-${ts}.json`);
  const syn = synthesis ?? makeSynthesis();
  fs.writeFileSync(synthesisPath, JSON.stringify(syn, null, 2));
  fs.writeFileSync(
    ledgerPath,
    JSON.stringify(
      { session_id: "ses_1", project_path: project, synthesis: { at: new Date().toISOString(), data: syn } },
      null,
      2,
    ),
  );
  return { project, synthesisPath, ledgerPath };
}

// Ambas fuentes de verdad deben quedar idénticas tras cada mutación.
function assertPersisted(synthesisPath: string, ledgerPath: string) {
  const standalone = loadSynthesis(synthesisPath);
  const ledger = loadLedger(ledgerPath);
  assert.ok(standalone, "standalone synthesis must load");
  assert.ok(ledger.synthesis?.data, "ledger synthesis must load");
  assert.deepEqual(standalone, ledger.synthesis.data, "standalone and ledger must stay in sync");
}

// ─── Añadir ────────────────────────────────────────────────────────────────

test("addUserStory: creates the next id, marks origen manual and persists both files", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const res = addUserStory(synthesisPath, {
    rol: "padre",
    quiero: "ver los juegos asignados a mi hijo",
    para: "acompañar el aprendizaje",
    titulo: "Acompañar a mi hijo",
    prioridad: "Nice to have",
    criterios_de_aceptacion: ["El padre ve la lista de juegos"],
  });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const added = res.synthesis.historias_de_usuario.find((h) => h.id === "HS-003");
  assert.ok(added, "new story gets the next id HS-003");
  assert.equal(added!.origen, "manual");
  assert.equal(added!.rol, "padre");
  assert.deepEqual(added!.criterios_de_aceptacion, ["El padre ve la lista de juegos"]);
  assertPersisted(synthesisPath, ledgerPath);
});

test("addUserStory: required fields are enforced (empty rol fails without touching the file)", () => {
  const { synthesisPath } = writeProject();
  const before = fs.readFileSync(synthesisPath, "utf-8");
  const res = addUserStory(synthesisPath, { rol: "   ", quiero: "x", para: "y" });
  assert.equal(res.ok, false, "missing rol must fail");
  if (!res.ok) assert.ok(res.error.length > 0, "must carry an error message");
  assert.equal(fs.readFileSync(synthesisPath, "utf-8"), before, "file must be untouched on validation failure");
});

test("addUserStory: id does not collide with deleted stories", () => {
  const { synthesisPath, ledgerPath } = writeProject(makeSynthesis({ historias_eliminadas: [{ ...makeSynthesis().historias_de_usuario[0], eliminada_at: "2026-08-16T00:00:00.000Z", rf_ids_origen: ["RF-001"] }] }));
  const res = addUserStory(synthesisPath, { rol: "padre", quiero: "x", para: "y" });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  assert.ok(res.synthesis.historias_de_usuario.some((h) => h.id === "HS-003"), "HS-003 skips the deleted HS-001");
  assertPersisted(synthesisPath, ledgerPath);
});

// ─── Editar ────────────────────────────────────────────────────────────────

test("updateUserStory: edits fields but preserves id and origen", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const res = updateUserStory(synthesisPath, "HS-001", {
    rol: "docente",
    quiero: "asignar y reasignar juegos",
    para: "ajustar los grupos cada semana",
    prioridad: "Must have",
  });
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const updated = res.synthesis.historias_de_usuario.find((h) => h.id === "HS-001");
  assert.ok(updated);
  assert.equal(updated!.rol, "docente");
  assert.equal(updated!.quiero, "asignar y reasignar juegos");
  assert.equal(updated!.origen, "a1", "origen (trazabilidad) is preserved");
  assert.equal(updated!.id, "HS-001", "id is preserved");
  assertPersisted(synthesisPath, ledgerPath);
});

test("updateUserStory: unknown story fails without touching the file", () => {
  const { synthesisPath } = writeProject();
  const before = fs.readFileSync(synthesisPath, "utf-8");
  const res = updateUserStory(synthesisPath, "HS-999", { rol: "x", quiero: "y", para: "z" });
  assert.equal(res.ok, false, "unknown story must fail");
  assert.equal(fs.readFileSync(synthesisPath, "utf-8"), before, "file must be untouched");
});

// ─── Eliminar (soft delete, N:N) ───────────────────────────────────────────

test("deleteUserStory: moves to tombstones and detaches ALL referencing RFs", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const res = deleteUserStory(synthesisPath, "HS-001");
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  assert.ok(!res.synthesis.historias_de_usuario.some((h) => h.id === "HS-001"), "story removed from active");
  const tomb = res.synthesis.historias_eliminadas.find((d) => d.id === "HS-001");
  assert.ok(tomb, "tombstone created");
  assert.deepEqual(tomb!.rf_ids_origen.sort(), ["RF-001", "RF-002"], "both referencing RFs recorded");
  const rf1 = res.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-001")!;
  const rf2 = res.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-002")!;
  assert.deepEqual(rf1.historias_origen, [], "RF-001 fully detached");
  assert.deepEqual(rf2.historias_origen, ["HS-002"], "RF-002 keeps the other story");
  assertPersisted(synthesisPath, ledgerPath);
});

test("deleteUserStory: unknown story fails cleanly", () => {
  const { synthesisPath } = writeProject();
  const res = deleteUserStory(synthesisPath, "HS-999");
  assert.equal(res.ok, false, "unknown story must fail");
});

// ─── Recuperar ─────────────────────────────────────────────────────────────

test("recoverUserStory: restores the story and re-links the N:N references", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const del = deleteUserStory(synthesisPath, "HS-001");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  const res = recoverUserStory(synthesisPath, "HS-001");
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  if (!res.ok) return;
  const restored = res.synthesis.historias_de_usuario.find((h) => h.id === "HS-001");
  assert.ok(restored, "story restored");
  assert.equal(restored!.titulo, "Asignar juegos por grupo", "content preserved through delete/recover");
  assert.ok(!("eliminada_at" in (restored as Record<string, unknown>)), "tombstone fields stripped");
  assert.ok(!res.synthesis.historias_eliminadas.some((d) => d.id === "HS-001"), "tombstone removed");
  const rf1 = res.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-001")!;
  const rf2 = res.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-002")!;
  assert.ok(rf1.historias_origen.includes("HS-001"), "RF-001 re-linked");
  assert.ok(rf2.historias_origen.includes("HS-001"), "RF-002 re-linked (alongside HS-002)");
  assertPersisted(synthesisPath, ledgerPath);
});

test("recoverUserStory: unknown tombstone fails cleanly", () => {
  const { synthesisPath } = writeProject();
  const res = recoverUserStory(synthesisPath, "HS-999");
  assert.equal(res.ok, false, "unknown tombstone must fail");
});

test("delete → recover is idempotent (second recover fails, no duplicate links)", () => {
  const { synthesisPath } = writeProject();
  const del = deleteUserStory(synthesisPath, "HS-002");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  const rec = recoverUserStory(synthesisPath, "HS-002");
  assert.ok(rec.ok, rec.ok ? "ok" : rec.error);
  if (!rec.ok) return;
  const second = recoverUserStory(synthesisPath, "HS-002");
  assert.equal(second.ok, false, "second recover fails (no tombstone)");
  const rf2 = rec.synthesis.requerimientos_funcionales.find((r) => r.id === "RF-002")!;
  assert.equal(rf2.historias_origen.filter((id) => id === "HS-002").length, 1, "no duplicated link");
});

test("purgeUserStory: removes the tombstone permanently (no recovery possible)", () => {
  const { synthesisPath, ledgerPath } = writeProject();
  const del = deleteUserStory(synthesisPath, "HS-001");
  assert.ok(del.ok, del.ok ? "ok" : del.error);
  if (!del.ok) return;
  const purge = purgeUserStory(synthesisPath, "HS-001");
  assert.ok(purge.ok, purge.ok ? "ok" : purge.error);
  if (!purge.ok) return;
  assert.equal(purge.synthesis.historias_eliminadas.length, 0, "tombstone purged");
  const rec = recoverUserStory(synthesisPath, "HS-001");
  assert.equal(rec.ok, false, "purged story cannot be recovered");
  assertPersisted(synthesisPath, ledgerPath);
});
