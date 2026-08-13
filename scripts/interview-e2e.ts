// Verificación end-to-end del motor contra el servidor REAL de opencode
// (no usa fakes). Ejercita exactamente la API pública que consumirá la UI:
// createInterview → submitAnswer → loadInterviewState → listInterviews.
//
//   npx tsx scripts/interview-e2e.ts [projectPath]
//
// Proyecto por defecto: dir temporal con un repo-context.md de ejemplo.
// Consume tokens del plan Go (gpt-5.6-luna, variante none) — ~6-8 turnos.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import type { InterviewQuestion } from "../headless-runtime/interview/types.ts";

function describe(question: InterviewQuestion): string {
  const options =
    question.kind === "free_only"
      ? "[texto libre]"
      : `[${question.options.map((o) => o.label).join(" | ")}]`;
  return `Q: (${question.topic_id}) ${question.topic_action} — ${question.question_text} ${options} ${question.contradiction_flag ? `⚠ conflicto con ${question.contradiction_flag.conflicting_answer_id}` : ""}`;
}

async function main(): Promise<void> {
  const projectPath =
    process.argv[2] ??
    fs.mkdtempSync(path.join(os.tmpdir(), "interview-e2e-"));
  const contextDir = path.join(projectPath, ".agents");
  fs.mkdirSync(contextDir, { recursive: true });
  const contextPath = path.join(contextDir, "repo-context.md");
  if (!fs.existsSync(contextPath)) {
    fs.writeFileSync(
      contextPath,
      "## Contexto del repo\nApp de gestión de tareas con recordatorios y colaboración por equipos.\n",
      "utf-8",
    );
  }

  console.log(`modelo: ${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID} (variant ${DEFAULT_MODEL_VARIANT})`);
  console.log(`proyecto: ${projectPath}\n`);

  const { ledgerPath, firstQuestion } = await createInterview(projectPath);
  console.log(`[1] ${describe(firstQuestion)}`);

  const scriptedAnswers = [
    { topic_id: firstQuestion.topic_id, selected_option_id: null as string | null, free_text: "evitar olvidar tareas y que el equipo pierda el hilo" },
    null,
    { topic_id: "nonfunctional.performance", selected_option_id: null, free_text: "que sea rápido" },
    null,
  ];

  let question = firstQuestion;
  let index = 1;
  for (const answer of scriptedAnswers) {
    index += 1;
    try {
      if (answer === null) {
        // Criterio 6: "cerrar la app" y retomar desde el ledger.
        const resumed = await loadInterviewState(ledgerPath);
        console.log(`\n— retomando: ${resumed.ledger.answers.length} respuestas en ledger, pendiente: ${resumed.lastQuestion?.topic_id ?? "ninguna"} —\n`);
        question = await submitAnswer(ledgerPath, {
          topic_id: resumed.lastQuestion?.topic_id ?? "vision.users",
          selected_option_id: null,
          free_text: "usuarios con roles: admin y editor",
        });
      } else {
        question = await submitAnswer(ledgerPath, answer);
      }
      console.log(`[${index}] ${describe(question)}`);
    } catch (err) {
      console.error(`[${index}] falló:`, err instanceof Error ? err.message : err);
    }
  }

  const summaries = await listInterviews(projectPath);
  const latest = summaries[0];
  console.log(
    `\ninterviews: ${summaries.length} — última: ${latest.answers_count} respuestas, ${latest.topics_closed}/${latest.topics_total} tópicos cerrados, ${latest.pending_contradictions} contradicciones pendientes`,
  );
  const ledger = (await loadInterviewState(ledgerPath)).ledger;
  console.log(`tópicos instanciados: ${ledger.topics.map((t) => t.id).join(", ")}`);
  console.log(`ledger: ${ledgerPath}`);

  closeInterviewServer();
  if (!process.argv[2]) {
    try {
      fs.rmSync(projectPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch {
      // Windows: el server recién muerto puede tardar en liberar handles.
    }
  }
}

main().catch((err) => {
  console.error("e2e falló:", err);
  closeInterviewServer();
  process.exit(1);
});
