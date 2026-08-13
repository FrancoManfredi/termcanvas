// Probe empírico de manejo de structured output (json_schema) entre los
// modelos del plan Go. Uso:
//
//   npx tsx scripts/interview-model-probe.ts [provider/model ...]
//
// Por defecto prueba los candidatos definidos abajo. Para cada modelo
// levanta (o reusa) el servidor de opencode, crea una sesión y pide la
// primera pregunta de la entrevista con el schema real del contrato.
// Reporta: OK/FAIL, tiempo, y un extracto de la pregunta. El resultado se
// usa para fijar DEFAULT_MODEL_ID en headless-runtime/interview/engine.ts.
//
// Nota: corre contra un servidor real y consume tokens del plan Go —
// mantener la lista de candidatos corta.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLedger, saveLedger } from "../headless-runtime/interview/ledger.ts";
import { buildTurnPrompt } from "../headless-runtime/interview/prompt.ts";
import {
  OpenCodeModelGateway,
  closeInterviewServer,
  ensureInterviewServer,
} from "../headless-runtime/interview/open-code-client.ts";
import { InterviewEngineError, type InterviewQuestion } from "../headless-runtime/interview/types.ts";

// provider/modelID[variant]. Los providers del plan Go: "opencode"
// (gateway de opencode.ai con API key) y "opencode-go" (suscripción Go
// vía OPENCODE_GO_AUTH_COOKIE + OPENCODE_GO_WORKSPACE_ID). La variante
// "none" desactiva thinking, requerido para json_schema/tool_choice.
//
// ESTADO ACTUAL (verificado el 13/8/2026, opencode 1.18.18):
//   - opencode-go/gpt-5.6-luna + variant none: FUNCIONA (default del motor).
//   - opencode-go/deepseek-v4-flash: NO puede usar json_schema. Sin
//     variante falla con "Thinking mode does not support this tool_choice"
//     (no tiene variante sin thinking en el catálogo) y CUALQUIER variante
//     (low/high/max o una inyectada por config) crashea el server con
//     "Unexpected server error" — bug de opencode 1.18.18 en la familia
//     deepseek-flash. Se deja en la lista como evidencia de la limitación.
const CANDIDATES = [
  "opencode-go/gpt-5.6-luna/none",
  "opencode-go/deepseek-v4-flash",
];

interface ProbeResult {
  modelID: string;
  ok: boolean;
  kind?: string;
  error?: string;
  durationMs: number;
  snippet?: string;
}

function snippet(question: InterviewQuestion): string {
  return `[${question.topic_id}] (${question.topic_action}, ${question.kind}, ${question.options.length} opciones) ${question.question_text.slice(0, 140)}…`;
}

async function probeModel(model: string, projectPath: string): Promise<ProbeResult> {
  const parts = model.split("/");
  const providerID = parts[0];
  const modelID = parts[1];
  const variant = parts[2];
  const started = Date.now();
  try {
    const gateway = new OpenCodeModelGateway(modelID, providerID, variant);
    const sessionId = await gateway.createSession(`Probe json_schema — ${model}`, projectPath);
    const ledger = createLedger({ projectPath, sessionId });
    const ledgerPath = path.join(projectPath, ".agents", "interview", `probe-${model.replace(/[^a-z0-9]+/gi, "-")}.json`);
    saveLedger(ledgerPath, ledger);
    const prompt = buildTurnPrompt(ledger);
    const question = await gateway.nextQuestion({ sessionId, turnPrompt: prompt });
    return {
      modelID: model,
      ok: true,
      durationMs: Date.now() - started,
      snippet: snippet(question),
    };
  } catch (err) {
    const interviewError = err instanceof InterviewEngineError ? err : null;
    const payload = interviewError?.payload;
    return {
      modelID: model,
      ok: false,
      kind: interviewError?.kind,
      error: interviewError?.message ?? String(err),
      durationMs: Date.now() - started,
      snippet:
        payload !== undefined
          ? `raw=${JSON.stringify(payload).slice(0, 500)}`
          : undefined,
    };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const candidates = argv.length > 0 ? argv : CANDIDATES;

  const server = await ensureInterviewServer();
  console.log(`servidor de opencode: ${server.url}`);
  console.log(`probando modelos: ${candidates.join(", ")}\n`);

  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "interview-probe-"));
  fs.mkdirSync(path.join(tmpProject, ".agents"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProject, ".agents", "repo-context.md"),
    "Proyecto de prueba: un gestor de tareas con recordatorios.\n",
    "utf-8",
  );

  const results: ProbeResult[] = [];
  for (const modelID of candidates) {
    const result = await probeModel(modelID, tmpProject);
    results.push(result);
    console.log(
      `${result.ok ? "OK " : "FAIL"}  ${modelID.padEnd(28)} ${String(result.durationMs).padStart(6)}ms  ${
        result.ok ? result.snippet : `[${result.kind}] ${result.error}${result.snippet ? ` ${result.snippet}` : ""}`
      }`,
    );
  }

  closeInterviewServer();
  try {
    fs.rmSync(tmpProject, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch {
    // Windows: el server recién muerto puede tardar en liberar handles.
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} modelos generaron una pregunta válida contra el schema.`);
}

main().catch((err) => {
  console.error("probe falló:", err);
  closeInterviewServer();
  process.exit(1);
});
