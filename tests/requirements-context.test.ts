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
  backfillStoriesForSynthesis,
  normalizeSynthesis,
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
    historias_de_usuario: [
      {
        id: "HS-001",
        titulo: "Asignar juegos por grupo",
        rol: "maestra",
        quiero: "asignar un juego a un grupo",
        para: "que cada grupo practique los ejercicios que le faltan",
        criterios_de_aceptacion: ["La maestra elige grupo y juego", "El grupo ve el juego asignado al entrar"],
        prioridad: "Must have",
        origen: "a1",
      },
    ],
    historias_backfilled: false,
    requerimientos_funcionales: [
      {
        id: "RF-001",
        descripcion: "El sistema debe permitir a la maestra asignar un juego",
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

test("formatRequirementsForPrompt: compact mode (default) omits stories and the RF→story link", () => {
  const text = formatRequirementsForPrompt(makeSynthesis(), "entrevista-1-sintesis.json", false);
  assert.ok(!text.includes("HISTORIAS DE USUARIO"), "compact mode must not emit the stories section");
  assert.ok(!text.includes("Formaliza la historia"), "compact mode must not emit the RF→story link");
  assert.ok(text.includes("### RF-001 [Must have]"), "compact mode keeps the RF section");
  assert.ok(text.includes("- Origen: a1"), "compact mode keeps the RF provenance line");
});

test("formatRequirementsForPrompt: includeStories adds stories and the RF→story link", () => {
  const text = formatRequirementsForPrompt(makeSynthesis(), "entrevista-1-sintesis.json", false, {
    includeStories: true,
  });
  assert.ok(text.includes("HISTORIAS DE USUARIO"), "stories mode must emit the stories section");
  assert.ok(text.includes("### HS-001 [Must have]"), "stories mode must list the story id and priority");
  assert.ok(
    text.includes("Como maestra, quiero asignar un juego a un grupo, para que cada grupo practique los ejercicios que le faltan."),
    "stories mode must render the full Como/quiere/para narrative",
  );
  assert.ok(text.includes("La maestra elige grupo y juego"), "stories mode must include acceptance criteria");
  assert.ok(text.includes("- Formaliza las historias: HS-001"), "stories mode must link the RF to its story");
});

test("formatRequirementsForPrompt: includeStories with empty stories degrades to the compact shape", () => {
  const text = formatRequirementsForPrompt(
    makeSynthesis({ historias_de_usuario: [] }),
    "entrevista-1-sintesis.json",
    false,
    { includeStories: true },
  );
  assert.ok(!text.includes("HISTORIAS DE USUARIO"), "no stories -> section omitted even in stories mode");
  assert.ok(text.includes("REQUERIMIENTOS FUNCIONALES"), "RF section always present");
});

test("formatRequirementsForPrompt: N:N relation renders ALL the stories of an RF", () => {
  const text = formatRequirementsForPrompt(
    makeSynthesis({
      requerimientos_funcionales: [
        {
          id: "RF-001",
          descripcion: "El sistema debe permitir a la maestra asignar un juego",
          justificacion: "Justificacion",
          prioridad: "Must have",
          criterio_de_ajuste: "Criterio",
          origen: "a1",
          historia_origen: "(sin historia)",
          historias_origen: ["HS-001", "HS-002"],
        },
      ],
    }),
    "entrevista-1-sintesis.json",
    false,
    { includeStories: true },
  );
  assert.ok(
    text.includes("- Formaliza las historias: HS-001, HS-002"),
    "an RF formalizing several stories must list all of them",
  );
});

test("normalizeSynthesis: legacy single historia_origen is derived into historias_origen", () => {
  const legacy = makeSynthesis({
    requerimientos_funcionales: [
      {
        id: "RF-001",
        descripcion: "El sistema debe permitir a la maestra asignar un juego",
        justificacion: "Justificacion",
        prioridad: "Must have",
        criterio_de_ajuste: "Criterio",
        origen: "a1",
        historia_origen: "HS-001",
        historias_origen: [],
      },
    ],
  });
  const normalized = normalizeSynthesis(legacy);
  assert.deepEqual(normalized.requerimientos_funcionales[0].historias_origen, ["HS-001"]);
  assert.deepEqual(normalizeSynthesis(makeSynthesis()).requerimientos_funcionales[0].historias_origen, ["HS-001"]);
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

test("resolveRequirementsForPrompt: opts propagate to the formatted text", () => {
  const project = makeProject();
  writeSynthesis(project, 2000);

  const compact = resolveRequirementsForPrompt(project);
  assert.ok(compact, "compact must resolve");
  assert.ok(!compact!.text.includes("HISTORIAS DE USUARIO"), "default opts stay compact");

  const withStories = resolveRequirementsForPrompt(project, { includeStories: true });
  assert.ok(withStories, "stories mode must resolve");
  assert.ok(withStories!.text.includes("HISTORIAS DE USUARIO"), "includeStories adds the stories section");
});

test("backfillStoriesForSynthesis: already-migrated synthesis is repaired (ledger synced) without calling the model", async () => {
  const project = makeProject();
  const path = writeSynthesis(project, 2000);
  const before = fs.readFileSync(path, "utf-8");

  const res = await backfillStoriesForSynthesis(project, path);
  assert.ok(res.ok, "already-migrated must resolve ok (no model call)");
  if (res.ok) {
    assert.ok(res.synthesis.historias_de_usuario.length > 0, "returned synthesis carries the stories");
  }
  assert.equal(fs.readFileSync(path, "utf-8"), before, "standalone must be untouched when already migrated");
});

test("backfillStoriesForSynthesis: repairs the ledger copy of an already-migrated synthesis", async () => {
  // Escenario real del bug: la migración vieja escribió el JSON standalone pero
  // NO el ledger (la UI lee del ledger). La reparación debe sincronizar el
  // ledger con el standalone sin tocar el standalone.
  const project = makeProject();
  const path = writeSynthesis(project, 2000);
  const ledgerPath = path.replace(/-sintesis\.json$/, ".json");
  // Ledger sin historias (estado roto previo a la reparación).
  fs.writeFileSync(
    ledgerPath,
    JSON.stringify({
      session_id: "ses_1",
      project_path: project,
      synthesis: { at: new Date().toISOString(), data: { ...makeSynthesis(), historias_de_usuario: [] } },
    }),
  );

  const res = await backfillStoriesForSynthesis(project, path);
  assert.ok(res.ok, res.ok ? "ok" : res.error);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
  assert.ok(
    Array.isArray(ledger.synthesis.data.historias_de_usuario) &&
      ledger.synthesis.data.historias_de_usuario.length > 0,
    "ledger must be synced with the standalone stories",
  );
});

test("backfillStoriesForSynthesis: missing synthesis returns no_synthesis", async () => {
  const project = makeProject();
  const res = await backfillStoriesForSynthesis(project, path.join(project, "nope.json"));
  assert.equal(res.ok, false, "missing synthesis must fail cleanly");
  if (!res.ok) {
    assert.equal(res.reason, "no_synthesis", "reason must be no_synthesis");
  }
});
