import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatRequirementsForPrompt,
  getActiveRequirements,
  listSynthesis,
  resolveRequirementsForPrompt,
  setActiveRequirements,
} from "../headless-runtime/interview/requirements.ts";
import type { SynthesisResult } from "../headless-runtime/interview/schema.ts";

function makeSynthesis(overrides: Partial<SynthesisResult> = {}): SynthesisResult {
  return {
    proyecto_metadata: {
      nombre_proyecto: "Education Games",
      id_sesion: "ses_1",
      fecha_relevamiento: "2026-08-16T12:00:00.000Z",
      brief_contexto: "Contexto",
    },
    requerimientos_funcionales: [
      {
        id: "RF-001",
        descripcion: "El sistema debe permitir a la maestra asignar un juego",
        justificacion: "Justificacion",
        prioridad: "Must have",
        criterio_de_ajuste: "Criterio",
        origen: "a1",
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
    ...overrides,
  };
}

// ─── Formateo para los prompts ────────────────────────────────────────────

test("formatRequirementsForPrompt: renders RFs, ASRs, restricciones y glosario con procedencia", () => {
  const text = formatRequirementsForPrompt(makeSynthesis(), "entrevista-1786862000000-sintesis.json", false);

  assert.ok(text.includes("Síntesis de requerimientos usada: entrevista-1786862000000-sintesis.json"));
  assert.ok(text.includes("selección activa del dueño"), "must mark explicit selection");
  assert.ok(!text.includes("FALLBACK"), "explicit selection must not say fallback");
  assert.ok(text.includes("### RF-001 [Must have]"));
  assert.ok(text.includes("El sistema debe permitir a la maestra asignar un juego"));
  assert.ok(text.includes("### ASR-001 — Rendimiento (ASR GENUINO)"));
  assert.ok(text.includes("### CON-001 — Stack Tecnologico"));
  assert.ok(text.includes("Netbook: Dispositivo del Plan Ceibal"));
});

test("formatRequirementsForPrompt: includes ALL fields of each RF (justificacion, criterio, origen)", () => {
  const text = formatRequirementsForPrompt(makeSynthesis(), "entrevista-1-sintesis.json", false);
  assert.ok(text.includes("- Justificación: Justificacion"), "RF must carry its justification");
  assert.ok(text.includes("- Criterio de ajuste: Criterio"), "RF must carry its acceptance criteria");
  assert.ok(text.includes("- Origen: a1"), "RF must carry its provenance answer id");
});

test("formatRequirementsForPrompt: includes the full 6-part technical scenario and trade-offs of each ASR", () => {
  const text = formatRequirementsForPrompt(makeSynthesis(), "entrevista-1-sintesis.json", false);
  assert.ok(text.includes("- Escenario técnico:"), "ASR must open its scenario block");
  assert.ok(text.includes("  - Fuente: Alumno"));
  assert.ok(text.includes("  - Estímulo: Abre el juego"));
  assert.ok(text.includes("  - Artefacto: Netbook"));
  assert.ok(text.includes("  - Entorno: 2GB RAM"));
  assert.ok(text.includes("  - Respuesta: Corre fluido"));
  assert.ok(text.includes("  - Medida de respuesta: < 100ms"));
  assert.ok(text.includes("- Trade-offs identificados: Ninguno"), "ASR must carry its trade-offs");
});

test("formatRequirementsForPrompt: non-genuine ASR is labeled and constraints carry their design impact", () => {
  const text = formatRequirementsForPrompt(
    makeSynthesis({
      atributos_de_calidad_y_asrs: [
        {
          id: "ASR-002",
          atributo: "Usabilidad",
          es_asr_genuino: false,
          justificacion_arquitectonica: "Se resuelve con diseno de interfaz",
          escenario_tecnico_6_partes: {
            fuente: "Chico",
            estimulo: "Juega solo",
            artefacto: "UI",
            entorno: "Aula",
            respuesta: "Sin ayuda",
            medida_de_respuesta: "Sin intervencion",
          },
          trade_offs_identificados: "Ninguno",
          origen: "a3",
        },
      ],
    }),
    "entrevista-1-sintesis.json",
    false,
  );
  assert.ok(text.includes("### ASR-002 — Usabilidad (no genuino)"), "non-genuine ASR must be labeled");
  assert.ok(text.includes("- Impacto en el diseño: Sin app nativa"), "CON must carry its design impact");
});

test("formatRequirementsForPrompt: fallback selection is marked for log traceability", () => {
  const text = formatRequirementsForPrompt(makeSynthesis(), "entrevista-1786862000000-sintesis.json", true);
  assert.ok(text.includes("FALLBACK: más reciente (sin selección activa)"), "fallback must be explicit");
});

test("formatRequirementsForPrompt: handles empty collections gracefully", () => {
  const text = formatRequirementsForPrompt(
    makeSynthesis({
      requerimientos_funcionales: [],
      atributos_de_calidad_y_asrs: [],
      restricciones_globales: [],
      glosario_de_terminos: {},
    }),
    "entrevista-1-sintesis.json",
    false,
  );
  assert.ok(text.includes("(ninguno)"), "no RFs -> (ninguno)");
  assert.ok(text.includes("(ninguna)"), "no restricciones -> (ninguna)");
  assert.ok(text.includes("(sin términos)"), "no glosario -> (sin términos)");
});

// ─── Persistencia del selector activo ─────────────────────────────────────

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tc-req-"));
}

function writeSynthesis(project: string, ts: number): string {
  const dir = path.join(project, ".agents", "interview", "requerimientos");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `entrevista-${ts}-sintesis.json`);
  fs.writeFileSync(p, JSON.stringify(makeSynthesis(), null, 2));
  return p;
}

test("getActiveRequirements: null without marker, follows the marker when set", () => {
  const project = makeProject();
  assert.equal(getActiveRequirements(project), null, "no marker -> null");

  const latest = writeSynthesis(project, 2000);
  const older = writeSynthesis(project, 1000);
  setActiveRequirements(project, older);
  const activo = getActiveRequirements(project);
  assert.ok(activo, "marker must resolve");
  assert.equal(activo!.path, older, "must follow the explicit marker, not the latest");
  assert.equal(activo!.timestamp, 1000);

  // Borrar el archivo apuntado: el marcador queda huerfano y degrada a null.
  fs.unlinkSync(older);
  assert.equal(getActiveRequirements(project), null, "orphan marker -> null");
  void latest;
});

test("listSynthesis: only synthesis files, sorted oldest to newest", () => {
  const project = makeProject();
  writeSynthesis(project, 3000);
  writeSynthesis(project, 1000);
  writeSynthesis(project, 2000);
  const all = listSynthesis(project);
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((s) => s.timestamp),
    [1000, 2000, 3000],
    "must be sorted by timestamp ascending",
  );
});

test("resolveRequirementsForPrompt: active wins, then fallback to latest, then null", () => {
  const project = makeProject();
  assert.equal(resolveRequirementsForPrompt(project), null, "no synthesis -> null");

  const older = writeSynthesis(project, 1000);
  const latest = writeSynthesis(project, 2000);

  const fallback = resolveRequirementsForPrompt(project);
  assert.ok(fallback, "fallback must resolve");
  assert.equal(fallback!.isFallback, true, "without marker it is a fallback");
  assert.ok(fallback!.text.includes("FALLBACK"), "fallback text must say so");

  setActiveRequirements(project, older);
  const activo = resolveRequirementsForPrompt(project);
  assert.ok(activo, "active must resolve");
  assert.equal(activo!.isFallback, false, "explicit selection is not a fallback");
  assert.ok(activo!.text.includes("selección activa del dueño"));
  assert.ok(activo!.sourcePath.endsWith("entrevista-1000-sintesis.json"), "must use the selected one");
  void latest;
});
