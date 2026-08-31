// Entrevista de requerimientos por consola, con Fase 0 (encuadre del
// problema) + Fase 1 (entrevista) + síntesis final.
//
//   npx tsx scripts/interview-console-user.ts [projectPath] [--brief <timestamp>]
//
// Fase 0 — el template estático del brief (9 bloques, preguntas 1-a-1) →
//           documento del brief.
// Fase 1 — la entrevista de requerimientos usa el brief como contexto.
// Final  — planilla de síntesis (RFs, ASRs, restricciones, glosario).
//
// --brief <timestamp>: saltea la Fase 0 y arranca la Fase 1 cargando un
//                      brief ya sintetizado (ej: --brief 1786764074067).
//                      Si el timestamp no existe, lista los disponibles.
// --synthesize <timestamp>: re-sintetiza la planilla final desde un ledger
//                      de entrevista ya guardado, sin repetir la entrevista
//                      (para cuando la síntesis falló por un error transitorio).
//
// Cómo responder: un NÚMERO de opción (ej: "1"), el "[id]" de una opción,
// o texto libre (cualquier otra cosa).

import fs from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import {
  BRIEF_BLOCKS,
  startBriefInterview,
  recordBriefAnswer,
  synthesizeBrief,
  formatBriefForPrompt,
  cleanupBrief,
  loadBriefDocument,
  briefLedgerPath,
  briefDocumentPath,
} from "../headless-runtime/interview/brief.ts";
import {
  startInterview,
  askQuestion,
  submitAnswer,
  synthesizeInterview,
  cleanupInterview,
  loadLedger,
  parseUserResponse,
  CONTRADICTION_TOPIC_ID,
  type TurnResult,
  type InterviewQuestion,
  type UserAnswerInput,
} from "../headless-runtime/interview/index.ts";
import type { BriefDocument } from "../headless-runtime/interview/schema.ts";

const ARGS = process.argv.slice(2);

// Valor numérico de un flag con valor (ej: --brief 123 → 123), o null si
// el flag no está o su valor es inválido.
function valorDeFlag(flag: string): number | null {
  const idx = ARGS.indexOf(flag);
  if (idx < 0) return null;
  const raw = ARGS[idx + 1];
  const n = Number(raw);
  return !raw || Number.isNaN(n) ? null : n;
}

// Índices de los VALORES de los flags (para que no se confundan con el
// path posicional del proyecto).
const FLAG_VALUE_INDEXES = new Set(
  ["--brief", "--synthesize"]
    .map((f) => ARGS.indexOf(f) + 1)
    .filter((i) => i > 0),
);

// El path del proyecto es el primer argumento posicional: que no sea un
// flag ("--...") ni el valor de un flag.
const PROJECT_PATH = ARGS.find((a, i) => !a.startsWith("--") && !FLAG_VALUE_INDEXES.has(i)) ?? process.cwd();

// Lee texto libre MULTILÍNEA hasta Enter en línea vacía (una pregunta).
// Devuelve "" si el usuario la saltea (Enter vacío directo).
async function leerPregunta(
  rl: import("node:readline/promises").Interface,
  bloqueNumero: number,
  bloqueTotal: number,
  preguntaNumero: number,
  preguntaTotal: number,
): Promise<string> {
  const lineas: string[] = [];
  for (;;) {
    const esPrimera = lineas.length === 0;
    const raw = await rl.question(
      esPrimera ? `Pregunta ${preguntaNumero}/${preguntaTotal} (bloque ${bloqueNumero}/${bloqueTotal}) — tu respuesta: ` : "  (Enter vacío para terminar): ",
    );
    if (esPrimera && raw.trim() === "") {
      const confirma = (await rl.question("  ¿Saltear esta pregunta? (s/n): ")).trim().toLowerCase();
      if (confirma === "s" || confirma === "si" || confirma === "sí") return "";
      continue;
    }
    if (!esPrimera && raw.trim() === "") break;
    lineas.push(raw);
  }
  return lineas.join("\n");
}

function mostrarPregunta(question: InterviewQuestion): void {
  console.log(`\n${question.question_text}`);
  if (question.options.length > 0) {
    question.options.forEach((o, i) => {
      console.log(`  [${i + 1}] ${o.label}  (id: ${o.id})`);
    });
    console.log(`  (o escribí tu propia respuesta — cualquier texto)`);
  } else {
    console.log(`  (respuesta libre: podés escribir varias líneas; terminá con Enter en una línea vacía — no uses líneas vacías dentro del texto)`);
  }
}

// Lee la respuesta del usuario: una línea si elige una opción, o texto
// MULTILÍNEA (hasta Enter en línea vacía) si es respuesta libre.
async function leerRespuesta(
  rl: import("node:readline/promises").Interface,
  question: InterviewQuestion,
  topic: string,
): Promise<UserAnswerInput> {
  const lineas: string[] = [];
  for (;;) {
    const esPrimera = lineas.length === 0;
    const raw = await rl.question(esPrimera ? "Tu respuesta: " : "  (Enter vacío para terminar): ");
    if (esPrimera && raw.trim() === "") continue; // respuesta vacía → reingreso
    if (!esPrimera && raw.trim() === "") break; // línea vacía = fin del texto libre
    lineas.push(raw);
    if (esPrimera) {
      const parsed = parseUserResponse(question, raw);
      if (parsed && parsed.selected_option_id !== null) break; // eligió una opción → listo
      // es texto libre → se siguen acumulando líneas
    }
  }
  const parsed = parseUserResponse(question, lineas.join("\n"));
  if (!parsed) throw new Error("respuesta inválida");
  return {
    topic,
    question_text: question.question_text,
    selected_option_id: parsed.selected_option_id,
    selected_option_label: parsed.selected_option_label,
    free_text: parsed.free_text,
  };
}

// ─── Helpers del flag --brief <timestamp> ────────────────────────────────

function resolverBriefTimestamp(): number | null {
  const idx = ARGS.indexOf("--brief");
  if (idx < 0) return null;
  const ts = valorDeFlag("--brief");
  if (ts === null) {
    console.error("Uso: --brief <timestamp> (ej: --brief 1786764074067)");
    process.exit(1);
  }
  return ts;
}

function listarBriefsDisponibles(): string[] {
  const dir = path.join(PROJECT_PATH, ".agents", "interview");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith("-brief.json"))
    .sort();
}

function cargarBriefPorTimestamp(timestamp: number): BriefDocument {
  const briefPath = briefDocumentPath(briefLedgerPath(PROJECT_PATH, timestamp));
  if (!fs.existsSync(briefPath)) {
    const disponibles = listarBriefsDisponibles();
    console.error(`No existe el brief ${path.basename(briefPath)}`);
    if (disponibles.length > 0) {
      console.error("  Briefs disponibles:");
      for (const f of disponibles) {
        console.error(`  --brief ${f.replace(/^brief-/, "").replace(/-brief\.json$/, "")}`);
      }
    }
    process.exit(1);
  }
  return loadBriefDocument(briefPath);
}

// El brief a usar: el del flag --brief, o el más reciente en disco.
function resolverBriefParaSintesis(): BriefDocument {
  const ts = resolverBriefTimestamp();
  if (ts !== null) return cargarBriefPorTimestamp(ts);
  const disponibles = listarBriefsDisponibles();
  if (disponibles.length === 0) {
    console.error("No hay ningún brief en disco. Corré la Fase 0 primero (sin --brief).");
    process.exit(1);
  }
  const ultimo = disponibles[disponibles.length - 1];
  return loadBriefDocument(path.join(PROJECT_PATH, ".agents", "interview", ultimo));
}

// Re-sintetiza la planilla final desde un ledger de entrevista YA guardado
// (útil cuando la síntesis falló por un error transitorio: no se repite la
// entrevista, solo la llamada de síntesis).
async function resintetizarDesdeLedger(ledgerTimestamp: number): Promise<void> {
  const ledgerPath = path.join(PROJECT_PATH, ".agents", "interview", `interview-${ledgerTimestamp}.json`);
  if (!fs.existsSync(ledgerPath)) {
    const dir = path.join(PROJECT_PATH, ".agents", "interview");
    console.error(`No existe el ledger ${path.basename(ledgerPath)}`);
    if (fs.existsSync(dir)) {
      const disponibles = fs.readdirSync(dir).filter((f) => f.startsWith("interview-") && f.endsWith(".json")).sort();
      if (disponibles.length > 0) {
        console.error("  Entrevistas disponibles:");
        for (const f of disponibles) {
          console.error(`  --synthesize ${f.replace(/^interview-/, "").replace(/\.json$/, "")}`);
        }
      }
    }
    process.exit(1);
  }
  const brief = resolverBriefParaSintesis();
  console.log(`\n=== RE-SÍNTESIS del ledger ${path.basename(ledgerPath)} ===`);
  console.log(`  Brief usado: ${brief.resumen_proyecto}`);
  const { synthesis, synthesisPath } = await synthesizeInterview(ledgerPath, formatBriefForPrompt(brief));
  console.log(`  RFs: ${synthesis.requerimientos_funcionales.length}`);
  console.log(`  ASRs/atributos: ${synthesis.atributos_de_calidad_y_asrs.length}`);
  console.log(`  Restricciones: ${synthesis.restricciones_globales.length}`);
  console.log(`  Glosario: ${Object.keys(synthesis.glosario_de_terminos).length} términos`);
  console.log(`  SÍNTESIS GUARDADA EN: ${synthesisPath}`);
  console.log(`  LEDGER ACTUALIZADO EN: ${ledgerPath}`);
}

// Muestra la propuesta de valor, incertidumbres y alertas de consistencia;
// devuelve false si el creador cancela tras ver las alertas.
async function mostrarAlertasYConfirmar(rl: ReadlineInterface, doc: BriefDocument): Promise<boolean> {
  console.log(`  Propuesta de valor: ${doc.propuesta_de_valor}`);
  console.log(`  Incertidumbres críticas: ${doc.incertidumbres_criticas.map((i) => i.tema).join("; ") || "(ninguna)"}`);
  if (doc.alertas_consistencia.length > 0) {
    console.log("\n  ⚠ ALERTAS DE CONSISTENCIA:");
    for (const alerta of doc.alertas_consistencia) {
      console.log(`    [${alerta.gravedad.toUpperCase()}] ${alerta.descripcion}`);
    }
    const seguir = (await rl.question("\n  ¿Continuar con la entrevista igual? (s/n): ")).trim().toLowerCase();
    if (seguir !== "s" && seguir !== "si" && seguir !== "sí" && seguir !== "y" && seguir !== "yes") {
      console.log("  Entrevista cancelada por el creador.");
      return false;
    }
  }
  return true;
}

// ─── Fase 1: entrevista de requerimientos (usa el brief como contexto) ───
async function correrEntrevistaDeRequerimientos(rl: ReadlineInterface, projectBrief: string): Promise<void> {
  console.log("\n=== FASE 1: Entrevista de requerimientos ===");
  console.log(`Contexto (brief):\n${projectBrief}\n`);

  const { ledgerPath, ledger } = await startInterview(PROJECT_PATH);
  console.log(`Ledger: ${ledgerPath}`);
  console.log(`session_id: ${ledger.session_id}\n`);

  try {
    const primerTopic = ledger.topics[0];
    const primera = await askQuestion(ledger, primerTopic, projectBrief);
    let turno: TurnResult = {
      done: false,
      kind: "question",
      question: primera.question,
      topic: primerTopic,
      sufficient: null,
      contradiction: null,
      usage: primera.usage,
    };

    while (!turno.done) {
      const esResolucion = turno.kind === "resolution";
      mostrarPregunta(turno.question);
      const input = await leerRespuesta(
        rl,
        turno.question,
        esResolucion ? CONTRADICTION_TOPIC_ID : turno.topic,
      );
      turno = await submitAnswer(ledgerPath, ledger, input, projectBrief);
    }

    const persistido = loadLedger(ledgerPath);
    console.log("\n=== Entrevista terminada ===");
    console.log(`  Answers: ${persistido.answers.length}`);
    console.log(`  Gap-check: ${persistido.gap_check ? `${persistido.gap_check.gaps.length} huecos` : "no corrió"}`);
    console.log(`  Contradicciones: ${persistido.contradictions.length}`);
    console.log(`  ASR reviews: ${persistido.asr_reviews.length}`);

    // ── Síntesis final (planilla de salida) ─────────────────────────────
    console.log("\n── SÍNTESIS FINAL (planilla de salida) ──");
    const { synthesis, synthesisPath } = await synthesizeInterview(ledgerPath, projectBrief);
    console.log(`  RFs: ${synthesis.requerimientos_funcionales.length}`);
    console.log(`  ASRs/atributos: ${synthesis.atributos_de_calidad_y_asrs.length}`);
    console.log(`  Restricciones: ${synthesis.restricciones_globales.length}`);
    console.log(`  Glosario: ${Object.keys(synthesis.glosario_de_terminos).length} términos`);
    console.log(`\n  SÍNTESIS GUARDADA EN: ${synthesisPath}`);
    console.log(`  LEDGER GUARDADO EN: ${ledgerPath}`);
  } finally {
    rl.close();
    await cleanupInterview(ledger);
  }
}

async function main(): Promise<void> {
  const timestamp = resolverBriefTimestamp();

  // ── Modo --synthesize <timestamp>: re-sintetizar sin repetir entrevista ─
  if (ARGS.indexOf("--synthesize") >= 0) {
    const ledgerTs = valorDeFlag("--synthesize");
    if (ledgerTs === null) {
      console.error("Uso: --synthesize <timestamp-del-ledger> [--brief <timestamp>]");
      process.exit(1);
    }
    await resintetizarDesdeLedger(ledgerTs);
    return;
  }

  // ── Modo --brief: cargar un brief ya sintetizado, sin Fase 0 ──────────
  if (timestamp !== null) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const brief = cargarBriefPorTimestamp(timestamp);
      console.log(`\n=== BRIEF CARGADO: brief-${timestamp}-brief.json ===`);
      console.log(`  Resumen: ${brief.resumen_proyecto}\n`);
      if (!(await mostrarAlertasYConfirmar(rl, brief))) return;
      await correrEntrevistaDeRequerimientos(rl, formatBriefForPrompt(brief));
    } finally {
      rl.close();
    }
    return;
  }

  // ── Modo completo: Fase 0 (brief interactivo) + Fase 1 ────────────────
  console.log("\n=== FASE 0: Encuadre del problema (brief) ===");
  console.log("Respondé libremente cada bloque. Enter en una línea vacía termina tu respuesta.\n");
  const rl = createInterface({ input: stdin, output: stdout });

  const { ledgerPath: briefLedgerPath, ledger: briefLedger } = await startBriefInterview(PROJECT_PATH);
  console.log(`Ledger del brief: ${briefLedgerPath}`);
  let brief: BriefDocument | undefined;
  let briefPath: string | undefined;
  try {
    for (let i = 0; i < BRIEF_BLOCKS.length; i++) {
      const bloque = BRIEF_BLOCKS[i];
      console.log(`\n── ${bloque.titulo} ──`);
      for (let j = 0; j < bloque.preguntas.length; j++) {
        const pregunta = bloque.preguntas[j];
        console.log(`  ${j + 1}. ${pregunta}`);
        const respuesta = await leerPregunta(rl, i + 1, BRIEF_BLOCKS.length, j + 1, bloque.preguntas.length);
        if (respuesta === "") {
          console.log("  (pregunta salteada — quedará marcada como incertidumbre)");
        }
        recordBriefAnswer(briefLedgerPath, briefLedger, { bloque: bloque.id, pregunta, respuesta });
      }
    }

    console.log("\n── SÍNTESIS DEL BRIEF ──");
    const sintesis = await synthesizeBrief(briefLedgerPath);
    brief = sintesis.brief;
    briefPath = sintesis.briefPath;
    if (!(await mostrarAlertasYConfirmar(rl, sintesis.brief))) return;
    console.log(`  BRIEF GUARDADO EN: ${briefPath}\n`);
  } finally {
    await cleanupBrief(briefLedger);
  }

  if (!brief) return; // el creador canceló tras las alertas
  await correrEntrevistaDeRequerimientos(rl, formatBriefForPrompt(brief));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
