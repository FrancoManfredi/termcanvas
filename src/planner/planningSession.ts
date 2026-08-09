import type { PlannerMode, PlanningResult } from "../types/issuePlanning.ts";
import { buildPlanningPrompt, planningOutputPath } from "./planningPrompt.ts";
import { parsePlanningPlan, describePlanError } from "./parsePlanResult.ts";
import { createTerminal, useProjectStore } from "../stores/projectStore.ts";
import {
  destroyTerminalRuntime,
  ensureTerminalRuntime,
} from "../terminal/terminalRuntimeStore.ts";
import { useNotificationStore } from "../stores/notificationStore.ts";

// Sesión REAL de planificación: crea un runtime de terminal (el mismo
// pipeline que usa el canvas: ensureTerminalRuntime spawnea el PTY de
// opencode con launch options + hooks) pero SIN meter el tile en la
// escena. El modal atachea ese runtime a su panel derecho con
// attachTerminalContainer — exactamente el renderer interactivo que ya
// funciona en el canvas (xterm + fit + wheel + input).
//
// El prompt viaja como `initialPrompt` del terminal: el runtime lo
// convierte en el flag `--prompt` del launch (ver spawnPty en
// terminalRuntimeStore.ts). La TUI de opencode pre-llena su input box con
// ese texto y lo SUBMITEA automáticamente cuando la sesión está lista
// (espera sync + modelo cargado), sin que nosotros tengamos que pegar
// bytes por el PTY — elimina la carrera de "la TUI todavía está
// booteando" que rompía la inyección manual por stdin.
//
// La sesión espera <repo>/.agents/planning/plan-<timestamp>.json que el
// agente prometió escribir. Cuando el plan aparece (o se cancela), el
// runtime se destruye con destroyTerminalRuntime y el resultado pasa al
// store como siempre.

export interface PlanningSessionHandle {
  outputPath: string;
  terminalId: string;
  stop: () => void;
}

export interface LaunchPlanningSessionOptions {
  mode: PlannerMode;
  repoPath: string;
  projectId: string;
  worktreeId: string;
  roadmapText: string;
  attachmentNames: string[];
  onResult: (result: PlanningResult, warnings: string[]) => void;
  onError: (message: string) => void;
}

export type LaunchActivePlanningSessionOptions = Pick<
  LaunchPlanningSessionOptions,
  "mode" | "roadmapText" | "attachmentNames" | "onResult" | "onError"
> & { repoPath?: string };

const POLL_INTERVAL_MS = 1500;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
// Lecturas consecutivas con el MISMO contenido inválido antes de rendirse.
// El agente puede escribir el JSON en partes (los planes con template son
// grandes y un solo write truncaría el payload): si el contenido cambia
// entre lecturas, sigue escribiendo y esperamos; si está estable e
// inválido 8 lecturas (~12s), el archivo quedó mal y fallamos con detalle.
const MAX_STALE_INVALID_READS = 8;

// Contexto libre del repo en Markdown (lo escribe el usuario desde el
// modal de contexto): se inyecta en el prompt para que el agente conozca
// el propósito y las intenciones del repositorio. La lectura compartida
// vive en utils/repoContext (misma fuente que resolve/fix/review/conflict).
import { readRepoContext } from "../utils/repoContext";

export function resolveActiveWorktree(): { projectId: string; worktreeId: string; path: string } | null {
  const { projects, focusedProjectId, focusedWorktreeId } = useProjectStore.getState();
  if (projects.length === 0) return null;
  // El foco describe la selección activa del árbol, no lo que está en el
  // canvas: puede ser null aunque haya proyectos a la vista. En ese caso
  // cae al primer proyecto del canvas activo (useProjectStore ya es el
  // live state de la escena activa).
  const project =
    projects.find((candidate) => candidate.id === focusedProjectId) ?? projects[0];
  if (!project) return null;
  const worktree =
    project.worktrees.find((candidate) => candidate.id === focusedWorktreeId) ??
    project.worktrees.find((candidate) => candidate.isPrimary) ??
    project.worktrees[0];
  if (!worktree) return null;
  return { projectId: project.id, worktreeId: worktree.id, path: worktree.path };
}

function pollForOutput(
  outputPath: string,
  openIssues: Array<{ number: number; title: string }>,
  timeoutAt: number,
  onResult: LaunchPlanningSessionOptions["onResult"],
  onError: LaunchPlanningSessionOptions["onError"],
): () => void {
  let stopped = false;
  let staleInvalidReads = 0;
  let lastInvalidContent: string | null = null;
  const interval = setInterval(async () => {
    if (stopped) return;
    if (Date.now() > timeoutAt) {
      clearInterval(interval);
      onError(`opencode no escribió el plan en ${outputPath} (tiempo agotado)`);
      return;
    }
    const read = await window.termcanvas.fs.readFile(outputPath);
    if (!("content" in read)) return; // espera a que aparezca el archivo
    if (stopped) return;
    // openIssues llega al parse para la pasada anti-duplicado determinista:
    // los items que repiten un issue abierto se marcan con
    // existingIssueNumber en la app aunque el modelo los haya dejado sueltos.
    const parsed = parsePlanningPlan(read.content, openIssues);
    if (!parsed) {
      // Contenido presente pero inválido: puede ser una escritura a medio
      // terminar. Solo fallamos cuando el contenido inválido dejó de
      // cambiar (el agente ya no está escribiendo); mientras cambie,
      // seguimos esperando.
      if (read.content === lastInvalidContent) {
        staleInvalidReads += 1;
      } else {
        staleInvalidReads = 1;
        lastInvalidContent = read.content;
      }
      if (staleInvalidReads >= MAX_STALE_INVALID_READS) {
        clearInterval(interval);
        if (stopped) return;
        onError(
          `El plan de ${outputPath} no cumple el contrato: ${describePlanError(read.content)}`,
        );
      }
      return;
    }
    clearInterval(interval);
    if (stopped) return;
    onResult(parsed.result, parsed.warnings);
  }, POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/**
 * Lee los issues abiertos del repo activo para la deduplicación del plan.
 * Best-effort: sin gh, sin permisos o sin issues, vuelve una lista vacía —
 * el plan corre igual y solo se pierde la marca anti-duplicado.
 */
async function readOpenIssues(repoPath: string): Promise<Array<{ number: number; title: string }>> {
  if (typeof window === "undefined" || !window.termcanvas?.github?.listOpenIssues) {
    return [];
  }
  try {
    const result = await window.termcanvas.github.listOpenIssues(repoPath);
    return result.ok ? result.issues : [];
  } catch {
    return [];
  }
}

/**
 * Arranca la sesión real. El repo destino es el worktree activo de la
 * escena (el mismo al que apunta focusedProjectId/focusedWorktreeId);
 * el path se resuelve en el momento del launch para no depender de que
 * el estado de la escena haya sido persistido. El runtime es headless:
 * no se agrega ningún tile al canvas; el modal lo atachea mientras la
 * fase running esté activa.
 */
export async function launchPlanningSession(
  options: LaunchPlanningSessionOptions,
): Promise<PlanningSessionHandle | null> {
  const outputPath = planningOutputPath(options.repoPath, options.mode);
  const [repoContext, openIssues] = await Promise.all([
    readRepoContext(options.repoPath),
    readOpenIssues(options.repoPath),
  ]);
  const prompt = buildPlanningPrompt({
    mode: options.mode,
    repoPath: options.repoPath,
    roadmapText: options.roadmapText,
    attachmentNames: options.attachmentNames,
    outputPath,
    repoContext,
    openIssues,
  });

  // TerminalData sintética que solo alimenta al runtime: nunca entra a la
  // escena, así que no hay tile que renderizar ni arrastrar en el canvas.
  // El prompt viaja como initialPrompt: el runtime lo pasa como `--prompt`
  // al launch (spawnPty en terminalRuntimeStore.ts) y la TUI de opencode
  // pre-llena su input box y lo auto-submitea cuando la sesión está lista
  // (sync + modelo cargado) — sin carreras de timing, a diferencia de la
  // inyección manual por el PTY. La sesión queda interactiva de igual
  // forma que si el usuario lo hubiera tipeado.
  const terminal = createTerminal(
    "opencode",
    options.mode === "roadmap"
      ? "Planificación (roadmap)"
      : "Planificación (auditoría)",
    prompt,
    true,
    "agent",
  );
  ensureTerminalRuntime({
    projectId: options.projectId,
    worktreeId: options.worktreeId,
    worktreePath: options.repoPath,
    terminal,
  });

  // Idempotente: destruir un runtime ya destruido no rompe nada.
  let closed = false;
  const destroyRuntime = () => {
    if (closed) return;
    closed = true;
    destroyTerminalRuntime(terminal.id, {
      caller: "planningSession",
      reason: "planner_session_finished",
    });
  };

  const stopPolling = pollForOutput(
    outputPath,
    openIssues,
    Date.now() + SESSION_TIMEOUT_MS,
    (result, warnings) => {
      // El plan ya está en disco: opencode terminó su trabajo y el
      // runtime headless no tiene más razón de existir.
      destroyRuntime();
      options.onResult(result, warnings);
    },
    (message) => {
      destroyRuntime();
      options.onError(message);
    },
  );

  return {
    outputPath,
    terminalId: terminal.id,
    stop: () => {
      stopPolling();
      destroyRuntime();
    },
  };
}

export async function launchPlanningSessionForActiveWorktree(
  options: LaunchActivePlanningSessionOptions,
): Promise<PlanningSessionHandle | null> {
  const active = resolveActiveWorktree();
  if (!active) {
    useNotificationStore.getState().notify(
      "error",
      "No hay un proyecto activo para planificar; abrí un proyecto primero.",
    );
    return null;
  }
  return launchPlanningSession({
    ...options,
    repoPath: options.repoPath ?? active.path,
    projectId: active.projectId,
    worktreeId: active.worktreeId,
  });
}

export { describePlanError };
