// Entrevista de requerimientos INTERACTIVA por consola: vos sos el
// entrevistado. Sin UI, sin fakes — el servidor y el modelo reales.
//
//   npx tsx scripts/interview-console.ts [projectPath] [--new | --resume <ledgerPath>]
//
// - projectPath: repo del proyecto (por defecto el cwd). El modelo lee
//   <projectPath>/.agents/repo-context.md si existe.
// - Sin flags: si hay entrevistas anteriores, pregunta si retomar una o
//   crear nueva.
// - Por pregunta: elegí el número de opción, o escribí texto libre
//   (siempre disponible). Comandos: "?" repetir opciones, "q" salir.
// - Ante un error del modelo podés reintentar con la misma respuesta
//   ("r") — el motor deduplica, no se duplica el registro.
//
// Consume tokens del plan Go (gpt-5.6-luna, variant none) por cada turno.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  createInterview,
  submitAnswer,
  loadInterviewState,
  listInterviews,
  closeInterviewServer,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_VARIANT,
} from "../headless-runtime/interview/engine.ts";
import {
  InterviewEngineError,
  type InterviewQuestion,
  type UserAnswerInput,
} from "../headless-runtime/interview/types.ts";

// Dos modos de stdin:
//  - Pipe (no-TTY, tests/scripts): readline con pipe es traicionero
//    (rl.question devuelve todo el input como una sola "línea" y cierra la
//    interfaz al EOF). Se lee stdin completo de una y se reparte por líneas.
//  - TTY (interactivo): readline con rl.question.
let pipedLines: string[] | null = null;
let rl: readline.Interface | null = null;

async function initStdin(): Promise<void> {
  if (process.stdin.isTTY) return;
  let data = "";
  for await (const chunk of process.stdin) data += chunk.toString();
  pipedLines = data.split(/\r?\n/);
}

function ask(prompt: string): Promise<string> {
  if (pipedLines !== null) {
    console.log(prompt);
    const line = pipedLines.shift();
    return Promise.resolve(line === undefined ? "q" : line);
  }
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return new Promise((resolve) => rl!.question(prompt, resolve));
}

function exit(): void {
  closeInterviewServer();
  rl?.close();
  process.exit(0);
}

process.on("SIGINT", exit);

function coverageBar(estimate: number): string {
  const filled = Math.round(estimate * 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${Math.round(estimate * 100)}%`;
}

function printQuestion(question: InterviewQuestion, index: number): void {
  console.log("\n" + "=".repeat(70));
  console.log(`PREGUNTA ${index}  (cobertura estimada: ${coverageBar(question.coverage_estimate)})`);
  console.log(`Topico: ${question.topic_id}  [${question.topic_action}]`);
  if (question.topic_action === "close_topic") {
    console.log("  (pregunta de cierre del topico)");
  }
  console.log(`Pregunta: ${question.question_text}`);
  if (question.why_asking) {
    console.log(`Por que: ${question.why_asking}`);
  }
  if (question.contradiction_flag) {
    console.log(
      `ADVERTENCIA - CONTRADICCION: ${question.contradiction_flag.explanation}` +
        " — respondé con la version que prevalece.",
    );
  }
  if (question.options.length > 0) {
    console.log("\nOpciones:");
    question.options.forEach((option, i) => {
      console.log(`  ${i + 1}) ${option.label}`);
    });
  }
  console.log("\n[ numero de opcion | texto libre (siempre disponible) | \"?\" repetir | \"q\" salir ]");
}

function toAnswer(question: InterviewQuestion, raw: string): UserAnswerInput {
  const input = raw.trim();
  const byId = question.options.find((option) => option.id === input);
  if (byId) {
    return { topic_id: question.topic_id, selected_option_id: byId.id, free_text: null };
  }
  const asNumber = Number.parseInt(input, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= question.options.length) {
    return {
      topic_id: question.topic_id,
      selected_option_id: question.options[asNumber - 1].id,
      free_text: null,
    };
  }
  return { topic_id: question.topic_id, selected_option_id: null, free_text: input };
}

async function chooseStart(projectPath: string, forceNew: boolean, resumePath: string | null): Promise<string | null> {
  if (forceNew) return null;
  if (resumePath) return resumePath;

  const existing = await listInterviews(projectPath);
  if (existing.length === 0) return null;

  console.log("\nEntrevistas anteriores de este proyecto:");
  existing.forEach((interview, i) => {
    const created = new Date(interview.created_at).toLocaleString();
    console.log(
      `  ${i + 1}) ${created} — ${interview.answers_count} respuestas, ` +
        `${interview.topics_closed}/${interview.topics_total} topicos cerrados, ` +
        `${interview.pending_contradictions} contradicciones pendientes`,
    );
  });
  const raw = await ask(`\nCrear nueva (n) o retomar (1-${existing.length})? > `);
  const input = raw.trim();
  if (input === "n" || input === "") return null;
  const index = Number.parseInt(input, 10);
  if (Number.isInteger(index) && index >= 1 && index <= existing.length) {
    return existing[index - 1].ledgerPath;
  }
  console.log("Opcion invalida — creando entrevista nueva.");
  return null;
}

async function runInterview(
  ledgerPath: string,
  resuming: boolean,
  initialQuestion: InterviewQuestion | null = null,
): Promise<void> {
  let question: InterviewQuestion | null = initialQuestion;
  let index = 0;

  if (resuming) {
    const resumed = await loadInterviewState(ledgerPath);
    question = resumed.lastQuestion;
    index = resumed.ledger.answers.length;
    if (!question) {
      throw new InterviewEngineError("ledger_corrupt", "El ledger no tiene ninguna pregunta pendiente");
    }
    console.log(`\nRetomando entrevista (${resumed.ledger.answers.length} respuestas ya registradas).`);
  }

  while (true) {
    if (!question) {
      throw new InterviewEngineError("ledger_corrupt", "El ledger no tiene ninguna pregunta pendiente");
    }
    index += 1;
    printQuestion(question, index);

    let answer: UserAnswerInput | null = null;
    while (answer === null) {
      const raw = await ask("Tu respuesta> ");
      const input = raw.trim();
      if (input === "q" || input === "salir") {
        console.log("Entrevista guardada en el ledger. Hasta la proxima.");
        exit();
      }
      if (input === "?") {
        printQuestion(question, index);
        continue;
      }
      if (input === "") continue;
      answer = toAnswer(question, input);
    }

    try {
      question = await submitAnswer(ledgerPath, answer);
    } catch (err) {
      if (err instanceof InterviewEngineError) {
        console.error(`\n[error] ${err.kind}: ${err.message}`);
        if (err.payload !== undefined && err.payload !== null) {
          const raw = JSON.stringify(err.payload);
          console.error(`  raw: ${raw.slice(0, 400)}${raw.length > 400 ? "…" : ""}`);
        }
        const retry = await ask('Reintentar con la misma respuesta (r) o salir (q)? > ');
        if (retry.trim() === "r" || retry.trim() === "") {
          continue; // answer no se pierde: el motor deduplica el reintento
        }
        exit();
      }
      throw err;
    }
  }
}

function parseArgs(): { projectPath: string; forceNew: boolean; resumePath: string | null } {
  const argv = process.argv.slice(2);
  let forceNew = false;
  let resumePath: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--new") forceNew = true;
    else if (arg === "--resume") {
      resumePath = argv[i + 1] ?? "";
      i += 1;
    } else if (arg.startsWith("-")) {
      continue;
    } else {
      positional.push(arg);
    }
  }
  const projectPath = positional[0] ?? process.cwd();
  if (!fs.existsSync(projectPath)) {
    console.error(`El proyecto ${projectPath} no existe.`);
    process.exit(1);
  }
  if (resumePath !== null && !fs.existsSync(resumePath)) {
    console.error(`El ledger ${resumePath} no existe.`);
    process.exit(1);
  }
  return { projectPath, forceNew, resumePath };
}

async function main(): Promise<void> {
  await initStdin();
  const { projectPath, forceNew, resumePath } = parseArgs();
  console.log(`Modelo: ${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID} (variant ${DEFAULT_MODEL_VARIANT})`);
  console.log(`Proyecto: ${projectPath}`);
  console.log('Comandos: "?" repetir opciones, "q" salir (la entrevista queda guardada en el ledger).');

  const ledgerPath = await chooseStart(projectPath, forceNew, resumePath);
  if (ledgerPath === null) {
    const created = await createInterview(projectPath);
    await runInterview(created.ledgerPath, false, created.firstQuestion);
  } else {
    await runInterview(ledgerPath, true);
  }
}

main().catch((err) => {
  console.error("La entrevista fallo:", err instanceof Error ? err.message : err);
  closeInterviewServer();
  process.exit(1);
});
