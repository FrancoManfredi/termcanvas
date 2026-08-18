// Puente IPC entre la UI (renderer) y el motor de entrevista
// (headless-runtime/interview, motor v4). El renderer NO puede correr el
// motor: nodeIntegration está apagado y el motor necesita node:fs + el SDK
// de opencode (que spawnea `opencode serve` como child process). Acá en el
// proceso principal corre igual que en los scripts (tsx), con el projectPath
// real del proyecto abierto en el Canvas.
//
// Fases que se orquestan desde la UI:
//   - Fase 0 (brief): el CONTEXTO del proyecto se releva con la entrevista
//     del contexto y queda como documento .agents/interview/contexto/contexto-*-documento.json.
//   - Fase 1 (requerimientos): cada llamada del motor recibe el brief más
//     reciente del proyecto formateado como {projectBrief}.
//
// El estado de la entrevista vive en el ledger en disco
// (<projectPath>/.agents/interview/requerimientos/entrevista-<timestamp>.json), así que
// cerrar el modal no pierde nada: al reabrir se lista y se retoma.

import { ipcMain } from "electron";
import path from "node:path";
import {
  startInterview,
  askQuestion,
  submitAnswer,
  resumeInterview,
  loadLedger,
  saveLedger,
  listInterviews,
  deleteInterview,
  interviewProgress,
  closeInterviewServer,
  findLatestBriefDocument,
  getActiveBrief,
  setActiveBrief,
  listBriefDocuments,
  listBriefInterviews,
  deleteBriefDocument,
  formatBriefForPrompt,
  synthesizeInterview,
  startBriefInterview,
  briefInterviewState,
  recordBriefAnswer,
  synthesizeBrief,
  loadBriefLedger,
  listSynthesis,
  getActiveRequirements,
  setActiveRequirements,
  resolveRequirementsForPrompt,
  type TurnResult,
  type UserAnswerInput,
} from "../headless-runtime/interview/index.ts";

// El contexto para el motor: el brief ACTIVO del proyecto (elegido por el
// dueño en el modal de contexto), o el más reciente si no hay selección.
// "" si el proyecto todavía no tiene brief (la entrevista igual funciona,
// sin contexto de negocio).
function resolveProjectBrief(projectPath: string): string {
  const activo = getActiveBrief(projectPath);
  const found = activo ?? findLatestBriefDocument(projectPath);
  return found ? formatBriefForPrompt(found.brief) : "";
}

function projectPathOf(ledgerPath: string): string {
  return loadLedger(ledgerPath).project_path;
}

export function registerInterviewIpc(): void {
  // Crea una entrevista de requerimientos nueva y devuelve la primera
  // pregunta (con el brief del proyecto como contexto si existe).
  ipcMain.handle("interview:create", async (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:create requiere projectPath");
    }
    const { ledgerPath, ledger } = await startInterview(projectPath);
    const primera = await askQuestion(ledger, ledger.topics[0], resolveProjectBrief(projectPath));
    // La primera pregunta queda como pendiente: cerrar sin responder y
    // retomar devuelve la MISMA pregunta (no se regenera).
    ledger.pending_question = { topic: ledger.topics[0], question: primera.question };
    saveLedger(ledgerPath, ledger);
    // TurnResult completo: el store espera topic/done/kind para armar el
    // turno (un {question, usage} crudo rompe el flujo de la UI).
    const firstQuestion: TurnResult = {
      done: false,
      kind: "question",
      question: primera.question,
      topic: ledger.topics[0],
      sufficient: null,
      contradiction: null,
      usage: primera.usage,
    };
    return { ledgerPath, firstQuestion };
  });

  // Envía una respuesta y devuelve la siguiente pregunta o el fin.
  ipcMain.handle(
    "interview:submit",
    async (_event, ledgerPath: string, answer: UserAnswerInput) => {
      if (typeof ledgerPath !== "string" || !answer || typeof answer !== "object") {
        throw new Error("interview:submit requiere ledgerPath y answer");
      }
      return submitAnswer(
        ledgerPath,
        loadLedger(ledgerPath),
        answer,
        resolveProjectBrief(projectPathOf(ledgerPath)),
      );
    },
  );

  // Reanuda una entrevista guardada: el scheduler decide el próximo tópico
  // pendiente y el motor genera su pregunta (una llamada al modelo).
  ipcMain.handle("interview:resume", async (_event, ledgerPath: string) => {
    if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
      throw new Error("interview:resume requiere ledgerPath");
    }
    return resumeInterview(
      ledgerPath,
      resolveProjectBrief(projectPathOf(ledgerPath)),
    ) as Promise<TurnResult>;
  });

  // Estado actual del ledger (SIN llamadas al modelo): para refrescar el
  // progreso/contradicciones después de cada turno.
  ipcMain.handle("interview:state", (_event, ledgerPath: string) => {
    if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
      throw new Error("interview:state requiere ledgerPath");
    }
    const ledger = loadLedger(ledgerPath);
    return { ledger, lastQuestion: null, progress: interviewProgress(ledger) };
  });

  // Síntesis final: UNA llamada que arma la planilla (RFs, ASRs,
  // restricciones, glosario) y la guarda en el ledger + el JSON standalone.
  ipcMain.handle("interview:finish", async (_event, ledgerPath: string) => {
    if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
      throw new Error("interview:finish requiere ledgerPath");
    }
    const { synthesis, synthesisPath } = await synthesizeInterview(
      ledgerPath,
      resolveProjectBrief(projectPathOf(ledgerPath)),
    );
    return { synthesis, synthesisPath };
  });

  // Entrevistas existentes del proyecto, ordenadas por actividad.
  ipcMain.handle("interview:list", (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:list requiere projectPath");
    }
    return listInterviews(projectPath);
  });

  // Elimina una entrevista guardada (ledger + síntesis standalone).
  ipcMain.handle("interview:delete", (_event, ledgerPath: string) => {
    if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
      throw new Error("interview:delete requiere ledgerPath");
    }
    deleteInterview(ledgerPath);
    return { ok: true };
  });

  // Estado de las síntesis de requerimientos: TODAS las planillas (para que
  // la UI deje elegir) + cuál es la activa, si hay.
  ipcMain.handle("interview:requirementsStatus", (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:requirementsStatus requiere projectPath");
    }
    const synthesis = listSynthesis(projectPath).map((s) => ({
      path: s.path,
      timestamp: s.timestamp,
      // Resumen corto para la lista de la UI (de la planilla, no del ledger).
      resumen: s.synthesis.proyecto_metadata?.nombre_proyecto ?? "(sin nombre)",
    }));
    const activo = getActiveRequirements(projectPath);
    return { synthesis, activePath: activo?.path ?? null };
  });

  // Marca la síntesis que el dueño eligió como vigente para los prompts.
  ipcMain.handle(
    "interview:setActiveRequirements",
    (_event, projectPath: string, synthesisPath: string) => {
      if (typeof projectPath !== "string" || projectPath.length === 0) {
        throw new Error("interview:setActiveRequirements requiere projectPath");
      }
      if (typeof synthesisPath !== "string" || synthesisPath.length === 0) {
        throw new Error("interview:setActiveRequirements requiere synthesisPath");
      }
      setActiveRequirements(projectPath, synthesisPath);
      return { ok: true };
    },
  );

  // Texto formateado de la síntesis activa (o fallback a la más reciente)
  // para inyectar INLINE en los prompts de orquestador. "" si el proyecto
  // no tiene ninguna síntesis: el prompt corre sin sección.
  ipcMain.handle("interview:activeRequirementsText", (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:activeRequirementsText requiere projectPath");
    }
    return resolveRequirementsForPrompt(projectPath)?.text ?? "";
  });

  // Estado del contexto del proyecto (Fase 0): TODOS los briefs sintetizados
  // (para que la UI deje elegir) + cuál es el activo, si hay.
  ipcMain.handle("interview:briefStatus", (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:briefStatus requiere projectPath");
    }
    const briefs = listBriefDocuments(projectPath).map((b) => ({
      brief: b.brief,
      path: b.path,
      timestamp: b.timestamp,
    }));
    const activo = getActiveBrief(projectPath);
    const inProgress = listBriefInterviews(projectPath);
    return { briefs, activePath: activo?.path ?? null, inProgress };
  });

  // Marca el brief que el dueño eligió como contexto del proyecto.
  ipcMain.handle(
    "interview:setActiveBrief",
    (_event, projectPath: string, briefPath: string) => {
      if (typeof projectPath !== "string" || projectPath.length === 0) {
        throw new Error("interview:setActiveBrief requiere projectPath");
      }
      if (typeof briefPath !== "string" || briefPath.length === 0) {
        throw new Error("interview:setActiveBrief requiere briefPath");
      }
      setActiveBrief(projectPath, briefPath);
      return { ok: true };
    },
  );

  // Texto del contexto ACTIVO del proyecto (el que eligió el dueño en el
  // modal de contexto), formateado para inyectar INLINE en los prompts de
  // orquestador (planning, resolve, fix, review, conflict). "" si el
  // proyecto no tiene un contexto activo: el prompt corre sin sección.
  ipcMain.handle("interview:activeBriefText", (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:activeBriefText requiere projectPath");
    }
    const activo = getActiveBrief(projectPath);
    return activo ? formatBriefForPrompt(activo.brief) : "";
  });

  // ── Entrevista de CONTEXTO (Fase 0, brief) ─────────────────────────────

  // Crea una entrevista de contexto nueva y devuelve la primera pregunta.
  ipcMain.handle("interview:briefCreate", async (_event, projectPath: string) => {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      throw new Error("interview:briefCreate requiere projectPath");
    }
    const { ledgerPath, ledger } = await startBriefInterview(projectPath);
    void ledger;
    return { ledgerPath, position: briefInterviewState(ledgerPath) };
  });

  // Posición actual de una entrevista de contexto (retomar): la siguiente
  // pregunta pendiente, o null si todas fueron respondidas.
  ipcMain.handle("interview:briefState", (_event, ledgerPath: string) => {
    if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
      throw new Error("interview:briefState requiere ledgerPath");
    }
    return { position: briefInterviewState(ledgerPath) };
  });

  // Registra la respuesta de UNA pregunta y devuelve la siguiente (o null
  // si la entrevista quedó completa y lista para sintetizar).
  ipcMain.handle(
    "interview:briefSubmit",
    (
      _event,
      ledgerPath: string,
      input: { bloque: string; pregunta: string; respuesta: string },
    ) => {
      if (typeof ledgerPath !== "string" || !input || typeof input !== "object") {
        throw new Error("interview:briefSubmit requiere ledgerPath e input");
      }
      const ledger = loadBriefLedger(ledgerPath);
      recordBriefAnswer(ledgerPath, ledger, {
        bloque: input.bloque,
        pregunta: input.pregunta,
        respuesta: input.respuesta,
      });
      return { position: briefInterviewState(ledgerPath) };
    },
  );

  // Sintetiza el documento del brief (UNA llamada al modelo).
  ipcMain.handle("interview:briefSynthesize", async (_event, ledgerPath: string) => {
    if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
      throw new Error("interview:briefSynthesize requiere ledgerPath");
    }
    const { brief, briefPath } = await synthesizeBrief(ledgerPath);
    return { brief, briefPath };
  });

  // Elimina un contexto sintetizado (contexto-*-documento.json + su borrador de
  // origen). La UI bloquea borrar el activo, pero acá se valida igual.
  ipcMain.handle(
    "interview:briefDelete",
    (_event, projectPath: string, briefPath: string) => {
      if (typeof projectPath !== "string" || projectPath.length === 0) {
        throw new Error("interview:briefDelete requiere projectPath");
      }
      if (typeof briefPath !== "string" || briefPath.length === 0) {
        throw new Error("interview:briefDelete requiere briefPath");
      }
      const activo = getActiveBrief(projectPath);
      if (activo && path.normalize(activo.path) === path.normalize(briefPath)) {
        throw new Error("No se puede eliminar el contexto activo.");
      }
      deleteBriefDocument(projectPath, briefPath);
      return { ok: true };
    },
  );
}

// Cierra el servidor de opencode levantado por el motor (si lo levantó este
// proceso). Best-effort: se llama al salir de la app; los child processes
// huérfanos mueren igual con el proceso principal.
export function closeInterviewService(): void {
  try {
    closeInterviewServer();
  } catch {
    // No crítico en el shutdown.
  }
}
