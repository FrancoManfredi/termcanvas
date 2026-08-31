// Fase 0 — Encuadre del problema (solo el brief, sin entrevista).
//
//   npx tsx scripts/interview-brief-user.ts [projectPath]
//
// El dueño del negocio responde LIBREMENTE los 9 bloques del encuadre
// (preguntas estáticas, sin IA en los turnos). Cada bloque es un campo de
// texto multilínea: escribí tu respuesta y terminá con Enter en una línea
// vacía (no uses líneas vacías dentro del texto). Enter vacío directo =
// saltear el bloque (queda marcado como incertidumbre).
//
// La IA interviene UNA vez al final: la síntesis que arma el documento del
// brief (NO OMITE NADA de lo que respondiste; las respuestas crudas quedan
// guardadas en el ledger).
//
// Salida: .agents/interview/contexto/contexto-<ts>.json (respuestas crudas) y
//         .agents/interview/contexto/contexto-<ts>-documento.json (documento).

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  BRIEF_BLOCKS,
  startBriefInterview,
  recordBriefAnswer,
  synthesizeBrief,
  cleanupBrief,
} from "../headless-runtime/interview/brief.ts";

const PROJECT_PATH = process.argv[2] ?? process.cwd();

// Lee texto libre MULTILÍNEA hasta Enter en línea vacía (una pregunta).
// Devuelve "" si el usuario la saltea (Enter vacío directo).
async function leerBloque(
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
      // Enter vacío directo: ¿saltear la pregunta?
      const confirma = (await rl.question("  ¿Saltear esta pregunta? (s/n): ")).trim().toLowerCase();
      if (confirma === "s" || confirma === "si" || confirma === "sí") return "";
      continue;
    }
    if (!esPrimera && raw.trim() === "") break; // línea vacía = fin del texto libre
    lineas.push(raw);
  }
  return lineas.join("\n");
}

async function main(): Promise<void> {
  console.log("\n=== Fase 0: Encuadre del problema (brief) ===");
  console.log("Respondé libremente cada bloque. Enter en una línea vacía termina tu respuesta.\n");

  const rl = createInterface({ input: stdin, output: stdout });
  const { ledgerPath, ledger } = await startBriefInterview(PROJECT_PATH);
  console.log(`Ledger del brief: ${ledgerPath}`);
  console.log(`session_id: ${ledger.session_id}`);

  try {
    for (let i = 0; i < BRIEF_BLOCKS.length; i++) {
      const bloque = BRIEF_BLOCKS[i];
      console.log(`\n── ${bloque.titulo} ──`);
      for (let j = 0; j < bloque.preguntas.length; j++) {
        const pregunta = bloque.preguntas[j];
        console.log(`  ${j + 1}. ${pregunta}`);
        const respuesta = await leerBloque(rl, i + 1, BRIEF_BLOCKS.length, j + 1, bloque.preguntas.length);
        if (respuesta === "") {
          console.log("  (pregunta salteada — quedará marcada como incertidumbre)");
        }
        recordBriefAnswer(ledgerPath, ledger, { bloque: bloque.id, pregunta, respuesta });
      }
    }

    // Síntesis del brief (1 llamada — la única de esta fase).
    console.log("\n── SÍNTESIS DEL BRIEF ──");
    const { brief, briefPath } = await synthesizeBrief(ledgerPath);
    console.log(`  Resumen: ${brief.resumen_proyecto.slice(0, 120)}${brief.resumen_proyecto.length > 120 ? "…" : ""}`);
    console.log(`  Misión: ${brief.mision.slice(0, 120)}${brief.mision.length > 120 ? "…" : ""}`);
    console.log(`  Problema: ${brief.problema.slice(0, 120)}${brief.problema.length > 120 ? "…" : ""}`);
    console.log(`  Usuarios objetivo: ${brief.usuarios_objetivo.slice(0, 120)}${brief.usuarios_objetivo.length > 120 ? "…" : ""}`);
    console.log(`  Propuesta de valor: ${brief.propuesta_de_valor}`);
    console.log(`  Incertidumbres críticas: ${brief.incertidumbres_criticas.map((i) => i.tema).join("; ") || "(ninguna)"}`);
    if (brief.alertas_consistencia.length > 0) {
      console.log("\n  ⚠ ALERTAS DE CONSISTENCIA:");
      for (const alerta of brief.alertas_consistencia) {
        console.log(`    [${alerta.gravedad.toUpperCase()}] ${alerta.descripcion}`);
      }
    } else {
      console.log("\n  Sin alertas de inconsistencia.");
    }
    console.log(`\n  BRIEF GUARDADO EN: ${briefPath}`);
  } finally {
    rl.close();
    await cleanupBrief(ledger);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
