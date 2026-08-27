import type { PlannerMode, PlanningResult } from "../types/issuePlanning.ts";
import type { DiagnosisCategoryId } from "../types/diagnosisCategories.ts";
import { isDiagnosisCategoryId } from "../types/diagnosisCategories.ts";
import { buildPlanningPrompt, planningOutputPath } from "./planningPrompt.ts";
import { resolveRepoContextText, resolveRequirementsText, resolveArchitectureDecisionsText } from "../utils/repoContext.ts";
import { parsePlanningPlan, describePlanError } from "./parsePlanResult.ts";
import { createTerminal, useProjectStore } from "../stores/projectStore.ts";
import {
  destroyTerminalRuntime,
  ensureTerminalRuntime,
  getTerminalPtyId,
} from "../terminal/terminalRuntimeStore.ts";
import { useNotificationStore } from "../stores/notificationStore.ts";
import { runModelFlagArgs } from "./modelPin.ts";
import { formatModelRef, type ModelRef } from "../../shared/phaseModels";
import { prepareSkillScope } from "../skills/scopedSession.ts";
import { discoverVendorSkills } from "../skills/vendorSkills.ts";

// Sesión REAL de planificación: crea un runtime de terminal (el mismo
// pipeline que usa el canvas: ensureTerminalRuntime spawnea el PTY de
// opencode con launch options + hooks) pero SIN meter el tile en la
// escena. El modal atachea ese runtime a su panel derecho con
// attachTerminalContainer — exactamente el renderer interactivo que ya
// funciona en el canvas (xterm + fit + wheel + input).
//
// Dos modos de lanzamiento:
//
// - TUI (default): el prompt viaja como `initialPrompt` del terminal; el
//   runtime lo convierte en el flag `--prompt` del launch (ver spawnPty en
//   terminalRuntimeStore.ts). La TUI de opencode pre-llena su input box con
//   ese texto y lo SUBMITEA automáticamente cuando la sesión está lista
//   (espera sync + modelo cargado), sin que nosotros tengamos que pegar
//   bytes por el PTY — elimina la carrera de "la TUI todavía está
//   booteando" que rompía la inyección manual por stdin.
//
// - Headless (options.headless): el runtime spawnea `opencode run <prompt>
//   --auto` — sin TUI, el prompt va posicional como message. El proceso
//   escribe el plan y TERMINA SOLO; el poller también observa el exit del
//   proceso para fallar rápido ante un exit != 0 temprano.
//
// La sesión espera <repo>/.agents/planning/<prefijo>-<timestamp>.json que el
// agente prometió escribir (diagnostico-<ts> para auditoría, plan-<ts> para
// roadmap). Cuando el plan aparece (o se cancela), el runtime se destruye
// con destroyTerminalRuntime y el resultado pasa al store como siempre.

export interface PlanningSessionHandle {
  outputPath: string;
  terminalId: string;
  // El prompt EXACTO que se le mandó a opencode. Se expone para que la UI
  // pueda mostrarle al usuario qué instrucción corrió la sesión ("ver
  // prompt enviado") y verificar que el contexto inyectado es el correcto.
  prompt: string;
  stop: () => void;
}

export interface LaunchPlanningSessionOptions {
  mode: PlannerMode;
  repoPath: string;
  projectId: string;
  worktreeId: string;
  roadmapText: string;
  attachmentNames: string[];
  // Headless: lanza `opencode run <prompt>` (sin TUI). El proceso escribe
  // el plan y termina solo; el poller observa el archivo y también el exit
  // del proceso (un exit != 0 temprano falla la sesión sin esperar el
  // timeout). Con false (default) corre la TUI interactiva con --prompt.
  headless?: boolean;
  // Hallazgos de las herramientas deterministas formateados (Fase A del
  // Diagnóstico). Solo mode audit: cambia el prompt a interpretar esos
  // hallazgos + exploración dirigida en vez de "leé todo el repo".
  toolFindingsText?: string;
  // Categoría del diagnóstico (solo mode audit): define la REGLA DE FOCO del
  // prompt y el filename diagnostico-<categoria>-<ts>.json. Un valor que no
  // pertenece al registro se ignora (queda como corrida legacy) — nunca
  // rompe el lanzamiento.
  category?: string;
  // Reintento automático (silencioso): si la sesión headless termina con
  // exit 0 SIN escribir el plan (el modelo se corta a mitad de corrida),
  // el poller busca el sessionId de opencode y lo devuelve acá para que el
  // caller relance la sesión RESUMIDA (`opencode run -s <id>` con un
  // mensaje corto, sin re-pagar el prompt completo).
  onExitedWithoutFile?: (sessionId: string | null) => void;
  // Nombres de skills especializadas permitidas en ESTA sesión: se genera un
  // scope efímero (SKILL.md + config opencode con permission.skill) para que
  // el agente vea EXACTAMENTE esas skills y ninguna otra. Vacío/ausente =
  // sesión sin scoping (comportamiento previo).
  allowedSkills?: string[];
  // Si está seteado, la sesión se lanza RESUMIDA (-s <id>): el prompt se
  // reemplaza por un mensaje corto "escribí el plan ahora" porque todo el
  // contexto ya está en la sesión de opencode.
  resumeSessionId?: string;
  // Pin de modelo por fase (routing): ref efectivo resuelto por el caller
  // (resolvePhaseModelRef). null/ausente = sin pin (default global del CLI).
  model?: ModelRef | null;
  onResult: (result: PlanningResult, warnings: string[]) => void;
  onError: (message: string) => void;
}

export type LaunchActivePlanningSessionOptions = Pick<
  LaunchPlanningSessionOptions,
  | "mode"
  | "roadmapText"
  | "attachmentNames"
  | "headless"
  | "toolFindingsText"
  | "category"
  | "allowedSkills"
  | "resumeSessionId"
  | "model"
  | "onExitedWithoutFile"
  | "onResult"
  | "onError"
> & { repoPath?: string };

const POLL_INTERVAL_MS = 1500;
// El LLM puede tardar mucho (exploración + escritura del plan): 30 min.
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
// Lecturas consecutivas con el MISMO contenido inválido antes de rendirse.
// El agente puede escribir el JSON en partes (los planes con template son
// grandes y un solo write truncaría el payload): si el contenido cambia
// entre lecturas, sigue escribiendo y esperamos; si está estable e
// inválido 8 lecturas (~12s), el archivo quedó mal y fallamos con detalle.
const MAX_STALE_INVALID_READS = 8;


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
  terminalId: string,
  worktreePath: string,
  startedAt: string,
  onResult: LaunchPlanningSessionOptions["onResult"],
  onError: LaunchPlanningSessionOptions["onError"],
  onExitedWithoutFile?: (sessionId: string | null) => void,
): () => void {
  let stopped = false;
  let staleInvalidReads = 0;
  let lastInvalidContent: string | null = null;
  let exitSubscribed = false;
  let exitUnsubscribe: (() => void) | null = null;
  let resumeChecked = false;

  // Resoluciones idempotentes: después de la primera (éxito o error) nada
  // más puede resolver la sesión (el exit del proceso no pisa un resultado
  // ya entregado).
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    exitUnsubscribe?.();
    onError(message);
  };
  const succeed = (result: PlanningResult, warnings: string[]) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    exitUnsubscribe?.();
    onResult(result, warnings);
  };

  const interval = setInterval(async () => {
    if (stopped) return;
    if (Date.now() > timeoutAt) {
      fail(`opencode no escribió el plan en ${outputPath} (tiempo agotado)`);
      return;
    }
    // Headless: `opencode run` termina solo. Un exit != 0 antes de que
    // aparezca el archivo significa que la sesión falló — fallar rápido en
    // vez de esperar el timeout. Un exit 0 con el archivo ya en disco no
    // resuelve nada (el próximo tick lo encuentra). Un exit 0 SIN archivo
    // = la corrida se cortó sola (el modelo terminó sin escribir): se hace
    // un chequeo final y, si sigue sin archivo, se dispara el reintento
    // automático resumiendo la sesión de opencode.
    if (!exitSubscribed && window.termcanvas?.terminal?.onExit) {
      const ptyId = getTerminalPtyId(terminalId);
      if (ptyId !== null) {
        exitSubscribed = true;
        exitUnsubscribe = window.termcanvas.terminal.onExit(
          (exitedPtyId, exitCode) => {
            if (stopped || exitedPtyId !== ptyId) return;
            if (exitCode !== 0) {
              fail(
                `opencode terminó con error (exit ${exitCode}) sin escribir el plan en ${outputPath}`,
              );
              return;
            }
            if (resumeChecked) return;
            resumeChecked = true;
            void (async () => {
              // Chequeo final: el archivo pudo aparecer justo antes del exit
              // (el agente escribe y termina). Si está, no hace falta
              // reintentar nada.
              const read = await window.termcanvas.fs
                .readFile(outputPath)
                .catch(() => null);
              if (read && "content" in read) {
                const parsed = parsePlanningPlan(read.content, openIssues);
                if (parsed) {
                  succeed(parsed.result, parsed.warnings);
                  return;
                }
              }
              if (stopped) return;
              if (!onExitedWithoutFile) return;
              // Busca el sessionId de opencode de ESTA corrida para poder
              // relanzar la sesión resumida (opencode run -s <id>).
              let sessionId: string | null = null;
              try {
                const found = await window.termcanvas?.session?.findOpenCode?.(
                  worktreePath,
                  startedAt,
                );
                sessionId = found?.sessionId ?? null;
              } catch {
                sessionId = null;
              }
              if (stopped) return;
              onExitedWithoutFile(sessionId);
            })();
          },
        );
      }
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
        fail(
          `El plan de ${outputPath} no cumple el contrato: ${describePlanError(read.content)}`,
        );
      }
      return;
    }
    succeed(parsed.result, parsed.warnings);
  }, POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(interval);
    exitUnsubscribe?.();
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

// Instrucción corta que reemplaza al prompt completo cuando este supera el
// límite de argv de Windows (~32K, ver launchPlanningSession). El prompt
// completo queda en <promptPath>; el agente debe leerlo con su herramienta
// de lectura y ejecutarlo al pie de la letra. Sin "@ruta": la TUI no expande
// menciones @ en el texto que llega por --prompt.
function buildPromptFileInstruction(promptPath: string, outputPath: string): string {
  return [
    "Ejecutá UNA auditoría de arquitectura del repositorio actual.",
    "",
    "Las instrucciones COMPLETAS (reglas del prompt, contexto del repo, veredicto de requerimientos y contrato JSON de salida) están en el archivo:",
    promptPath,
    "",
    "1. Abrí y leé ESE archivo entero con tu herramienta de lectura — es el prompt de auditoría oficial.",
    "2. Ejecutá TODAS sus instrucciones al pie de la letra: ninguna sección se omite, resume ni modifica.",
    `3. El entregable final es escribir el archivo ${outputPath} (plan JSON del contrato, mode audit, findings con template por item).`,
    "4. Validá que el JSON parsea según el contrato antes de terminar.",
    "",
    "No explores el código por tu cuenta antes de haber leído el archivo completo.",
  ].join("\n");
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
  // Categoría validada contra el registro: un valor desconocido degrada a
  // corrida legacy (sin foco en el prompt, filename sin slug) en vez de
  // romper el lanzamiento.
  const category: DiagnosisCategoryId | undefined = options.category
    ? isDiagnosisCategoryId(options.category)
      ? options.category
      : undefined
    : undefined;
  const outputPath = planningOutputPath(options.repoPath, options.mode, category);
  const openIssues = await readOpenIssues(options.repoPath);
  const repoContextText = await resolveRepoContextText(options.repoPath);
  // PLANNING redacta issues para humanos y otros agentes que los leen en
  // GitHub: recibe la narrativa completa de las historias de usuario además
  // de los RFs (ver plan: RESOLVE/FIX/REVIEW/CONFLICT corren sin historias).
  const requirementsText = await resolveRequirementsText(options.repoPath, {
    includeStories: true,
  });
  // Las decisiones ADR activas también viajan al planner: un issue que
  // contradiga una decisión aceptada se propaga río abajo a todos los RESOLVE.
  const decisionsText = await resolveArchitectureDecisionsText(options.repoPath);
  // Skills vendor del usuario para la categoría (per-proyecto):
  //   <repo>/resources/diagnosis-skills/<categoria>/<nombre>/SKILL.md
  // Descubrimiento best-effort que NUNCA bloquea el lanzamiento.
  const vendorSkills = category
    ? await discoverVendorSkills(
        typeof window !== "undefined" ? window.termcanvas?.fs : undefined,
        options.repoPath,
        category,
      )
    : [];
  // Momento de arranque: el poller lo usa para identificar la sesión de
  // opencode de ESTA corrida (findOpenCode) y poder reintentarla resumida.
  const startedAt = new Date().toISOString();
  const prompt = options.resumeSessionId
    ? // Reintento automático: la sesión ya tiene TODO el contexto (prompt
      // completo + exploración hecha). Solo falta el entregable.
      `Continuá la tarea de auditoría. Tu ÚNICA tarea ahora: escribí el archivo ${outputPath} (el plan JSON del contrato del prompt original — mode audit, findings con template por item). NO explores más código: los análisis ya están hechos. Escribí el archivo, validá que parsea y terminá.`
    : buildPlanningPrompt({
        mode: options.mode,
        category,
        repoContextText,
        requirementsText,
        decisionsText,
        roadmapText: options.roadmapText,
        attachmentNames: options.attachmentNames,
        outputPath,
        openIssues,
        toolFindingsText: options.toolFindingsText,
        vendorSkillNames: vendorSkills.map((skill) => skill.name),
      });

  // El prompt completo (contexto + requerimientos + findings + veredicto)
  // supera el límite de ~32K de argv de Windows (viaja como UN argumento del
  // spawn, tanto en `opencode run` como en `--prompt` de la TUI). Además,
  // el prompt es trazabilidad: el usuario puede verificar qué instrucción
  // corrió cada diagnóstico desde la UI ("Ver prompt enviado").
  //
  // Por eso el prompt SIEMPRE se persiste como sidecar junto al plan:
  // <outputPath>.prompt.md (ej. diagnostico-seguridad-123.json.prompt.md) —
  // nombre determinista derivado del outputPath, así el detalle de un
  // diagnóstico del historial lo encuentra sin metadatos extra. Cuando además
  // supera PROMPT_FILE_THRESHOLD, opencode recibe una instrucción corta que
  // le ordena al agente LEER ese archivo y ejecutar TODO su contenido.
  // NOTA: NO se referencia con "@ruta" — la expansión de @archivo pertenece
  // al sistema de COMMANDS de opencode (tipear /nombre en vivo o
  // `run --command`); el texto que llega por --prompt es literal (verificado:
  // el modelo recibió "@C:/.../prompt-<ts>.md" tal cual, sin expandir).
  // El caso resume (-s <sessionId>) no escribe sidecar: no hay prompt nuevo.
  const PROMPT_FILE_THRESHOLD = 12000;
  let promptRef = prompt;
  if (!options.resumeSessionId) {
    const promptPath = `${outputPath}.prompt.md`;
    try {
      await window.termcanvas.fs.writeFile(promptPath, prompt);
      if (prompt.length > PROMPT_FILE_THRESHOLD) {
        promptRef = buildPromptFileInstruction(promptPath, outputPath);
      }
    } catch {
      promptRef = prompt; // fallback inline: sin sidecar, el flujo sigue igual
    }
  }

  // Pin de modelo por fase: en headless viaja como flags de `opencode run`
  // (verificados contra la CLI instalada); en TUI viaja por metadatos del
  // terminal y el runtime lo inyecta al spawnear.
  const modelPinFlags = options.model ? runModelFlagArgs(options.model) : [];

  // Scope de skills especializadas: materializa SKILL.md + config opencode
  // efímeros y devuelve el env con OPENCODE_CONFIG. Con null (allowlist
  // vacía o bridge ausente) la sesión corre sin scoping, igual que siempre.
  // El release va atado a destroyRuntime: cubre éxito, error, cancel y
  // timeout del poller.
  const skillScope =
    options.allowedSkills?.length || vendorSkills.length > 0
      ? await prepareSkillScope({
          repoPath: options.repoPath,
          allow: options.allowedSkills ?? [],
          vendorSkills,
        })
      : null;

  // TerminalData sintética que solo alimenta al runtime: nunca entra a la
  // escena, así que no hay tile que renderizar ni arrastrar en el canvas.
  // Con TUI (headless=false) el prompt viaja como initialPrompt → el runtime
  // lo pasa como `--prompt` y la TUI lo auto-submitea cuando está lista; con
  // headless=true va como mensaje posicional de `opencode run <prompt> --auto`.
  const terminal = createTerminal(
    "opencode",
    options.mode === "roadmap"
      ? "Planificación (roadmap)"
      : "Planificación (auditoría)",
    promptRef,
    true,
    "agent",
  );
  if (options.model) {
    terminal.modelOverride = formatModelRef(options.model);
    terminal.variantOverride = options.model.variant;
  }
  if (skillScope) {
    terminal.envOverride = skillScope.env;
  }
  if (options.resumeSessionId) {
    // Reintento resumido: `opencode run -s <id> --auto <mensaje corto>`.
    // El contexto completo ya está en la sesión; no se re-paga el prompt.
    terminal.headlessArgs = [
      "run",
      ...modelPinFlags,
      "-s",
      options.resumeSessionId,
      "--auto",
      promptRef,
    ];
  } else if (options.headless) {
    // Headless: `opencode run @<prompt-file> --auto` (sin TUI). El proceso
    // escribe el plan y termina solo; el poller resuelve con el archivo o el
    // exit del proceso.
    terminal.headlessArgs = ["run", ...modelPinFlags, "--auto", promptRef];
  }
  // else: TUI interactiva (initialPrompt ya está en el terminal) — el
  // usuario ve la sesión y puede intervenir; el poller la cierra cuando el
  // plan aparece.
  try {
    ensureTerminalRuntime({
      projectId: options.projectId,
      worktreeId: options.worktreeId,
      worktreePath: options.repoPath,
      terminal,
    });
  } catch (error) {
    // El runtime no arrancó: sin sesión que limpiar, pero el scope efímero
    // sí (y el error sigue su curso hacia onError del caller).
    void skillScope?.release();
    throw error;
  }

  // Idempotente: destruir un runtime ya destruido no rompe nada.
  let closed = false;
  const destroyRuntime = () => {
    if (closed) return;
    closed = true;
    void skillScope?.release();
    destroyTerminalRuntime(terminal.id, {
      caller: "planningSession",
      reason: "planner_session_finished",
    });
  };

  const stopPolling = pollForOutput(
    outputPath,
    openIssues,
    Date.now() + SESSION_TIMEOUT_MS,
    terminal.id,
    options.repoPath,
    startedAt,
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
    options.onExitedWithoutFile,
  );

  return {
    outputPath,
    terminalId: terminal.id,
    prompt,
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
