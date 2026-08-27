import { createTerminal } from "../stores/projectStore.ts";
import {
  destroyTerminalRuntime,
  ensureTerminalRuntime,
  getTerminalPtyId,
} from "../terminal/terminalRuntimeStore.ts";
import { createHeadlessGate } from "./headlessGate.ts";

// Sesión de herramientas deterministas (Fase A del Diagnóstico): spawnea
// `node scripts/run-diagnostico-tools.mjs --repo <path> --out <path>` como
// proceso headless (sin TUI, mismo runtime de terminal que el LLM). Con
// categoryId (diagnóstico por categorías) el orquestador corre SOLO las
// herramientas mapeadas a esa categoría y escribe
// .agents/planning/tool-findings-<categoria>-<ts>.json; sin categoría corre
// el pipeline completo (modo legacy).
//
// La sesión tiene DOS señales que el GATE reúna EN CUALQUIER ORDEN (ver
// headlessGate.ts — el orquestador escribe el archivo y sale milisegundos
// después, así que el exit suele ganarle al poller):
// - onReady(findingsPath): el tool-findings apareció. El runtime NO se
//   destruye: el log completo queda visible para que el usuario lo revise.
// - onExited(code): exit 0 + archivo presente = TODAS las herramientas
//   terminaron — la app habilita "Continuar al diagnóstico LLM".
// El runtime lo destruye la app (continueToLlm / cancel), no esta sesión.

export interface ToolsSessionHandle {
  terminalId: string;
  stop: () => void;
}

export interface LaunchToolsSessionOptions {
  repoPath: string;
  projectId: string;
  worktreeId: string;
  // Categoría del diagnóstico (src/types/diagnosisCategories.ts): el
  // orquestador corre solo sus herramientas y escribe el tool-findings con
  // el sufijo de categoría. Ausente = pipeline completo (legacy).
  categoryId?: string;
  // El tool-findings apareció (el orquestador terminó de escribirlo). El
  // runtime NO se destruye acá: queda vivo para que la UI muestre el log
  // completo; la app lo detiene al continuar al LLM o al cancelar.
  onReady: (findingsPath: string) => void;
  // El proceso de herramientas terminó (exit code). Con exit 0 + archivo
  // presente, TODAS las herramientas terminaron de escanear: ese es el gate
  // que habilita "Continuar al LLM".
  onExited: (exitCode: number) => void;
  onError: (message: string) => void;
}

// El gate se reúne por eventos, así que el período solo afecta la latencia
// con la que el poller DESCUBRE el archivo (el exit llega por evento igual):
// 500ms = gate ágil sin spamear listDir.
const POLL_INTERVAL_MS = 500;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
// Categorías con pipeline pesado (5+ tools secuenciales): necesitan margen
// extra para que la suma de timeouts por tool no mate el gate global.
const HEAVY_CATEGORIES = new Set(["seguridad", "buenas-practicas"]);
function sessionTimeoutFor(categoryId?: string): number {
  return HEAVY_CATEGORIES.has(categoryId ?? "")
    ? SESSION_TIMEOUT_MS + 5 * 60 * 1000
    : SESSION_TIMEOUT_MS;
}

function toolsOutputDir(repoPath: string): string {
  return `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
}

// Nombre de una corrida de herramientas: tool-findings-<categoria>-<ts>.json
// (por categoría) o tool-findings-<ts>.json (legacy). El slug es siempre
// [a-z][a-z-]* (sin dígitos), así que no hay ambigüedad con el timestamp.
export function parseToolFindingsName(
  name: string,
): { category: string | null; ts: number } | null {
  const match = /^tool-findings-(?:([a-z][a-z-]*)-)?(\d+)\.json$/.exec(name);
  if (!match) return null;
  const ts = Number(match[2]);
  if (!Number.isFinite(ts)) return null;
  return { category: match[1] ?? null, ts };
}

// El nombre del archivo lleva el timestamp: el poller espera el tool-findings
// MÁS NUEVO de la carpeta (el que esta corrida acaba de escribir). Con
// categoryId solo considera archivos DE ESA categoría — sin este filtro,
// "LLM directo" de Documentación inyectaría los hallazgos de la última
// corrida de Seguridad. Sin categoryId solo considera legacy sin categoría.
// También lo usa el Diagnóstico para reconstruir cobertura por categoría en
// loadHistory.
export async function newestToolFindings(
  dir: string,
  categoryId?: string,
): Promise<string | null> {
  try {
    const entries = await window.termcanvas.fs.listDir(dir);
    let best: string | null = null;
    let bestTs = -1;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const parsed = parseToolFindingsName(entry.name);
      if (!parsed) continue;
      const matchesCategory = categoryId
        ? parsed.category === categoryId
        : parsed.category === null;
      if (!matchesCategory) continue;
      if (parsed.ts > bestTs) {
        bestTs = parsed.ts;
        best = entry.name;
      }
    }
    return best ? `${dir}/${best}` : null;
  } catch {
    return null; // carpeta aún no existe
  }
}

export async function launchToolsSession(
  options: LaunchToolsSessionOptions,
): Promise<ToolsSessionHandle | null> {
  const outDir = toolsOutputDir(options.repoPath);
  const scriptsDir = window.termcanvas?.paths?.scriptsDir;
  if (!scriptsDir) {
    options.onError(
      "La app no expone la ruta de sus scripts; no se puede correr el pipeline de herramientas.",
    );
    return null;
  }
  const orchestrator = `${scriptsDir.replace(/[\\/]+$/, "")}/run-diagnostico-tools.mjs`;

  const terminal = createTerminal("opencode", "Diagnóstico (herramientas)", undefined, false, "agent");
  terminal.headlessShell = "node";
  terminal.headlessArgs = [
    orchestrator,
    "--repo",
    options.repoPath,
    "--out",
    outDir,
    ...(options.categoryId ? ["--category", options.categoryId] : []),
  ];
  ensureTerminalRuntime({
    projectId: options.projectId,
    worktreeId: options.worktreeId,
    worktreePath: options.repoPath,
    terminal,
  });

  let closed = false;
  const destroyRuntime = () => {
    if (closed) return;
    closed = true;
    destroyTerminalRuntime(terminal.id, {
      caller: "toolsSession",
      reason: "tools_session_finished",
    });
  };

  let stopped = false;
  let exitSubscribed = false;
  let exitUnsubscribe: (() => void) | null = null;

  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    exitUnsubscribe?.();
    destroyRuntime();
    options.onError(message);
  };

  // Gate independiente del orden: la corrida completa requiere artefacto +
  // exit 0, lleguen en el orden que lleguen (el caso exit-antes-de-archivo
  // era el que trababa el botón "Continuar" para siempre).
  const gate = createHeadlessGate<string>({
    onArtifactReady: (foundPath) => {
      if (!stopped) options.onReady(foundPath);
    },
    onCompleted: (exitCode) => {
      if (!stopped) {
        clearInterval(interval);
        options.onExited(exitCode);
      }
    },
    onFailed: (message) => fail(message),
  });

  const startedAt = Date.now();
  const timeoutMs = sessionTimeoutFor(options.categoryId);
  const interval = setInterval(async () => {
    if (stopped) return;
    if (Date.now() > startedAt + timeoutMs) {
      fail(
        `El pipeline de herramientas no cerró su corrida en ${outDir} (tiempo agotado tras ${Math.round(timeoutMs / 60000)} min)`,
      );
      return;
    }
    // Suscripción al exit del proceso (una sola vez). El gate reúne las dos
    // señales en el orden que lleguen.
    if (!exitSubscribed && window.termcanvas?.terminal?.onExit) {
      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId !== null) {
        exitSubscribed = true;
        exitUnsubscribe = window.termcanvas.terminal.onExit(
          (exitedPtyId, exitCode) => {
            if (stopped || exitedPtyId !== ptyId) return;
            gate.markExit(exitCode, (artifactReady) =>
              `El pipeline de herramientas terminó con error (exit ${exitCode})${artifactReady ? "" : " sin escribir tool-findings"}`,
            );
            if (exitCode === 0) {
              // Lectura defensiva INMEDIATA (mismo patrón que planningSession
              // al exit): si el exit ganó la carrera, entrega el gate acá
              // mismo sin esperar al próximo tick del poller. markArtifact es
              // idempotente — si el poller ya lo vio, esto no hace nada.
              void newestToolFindings(outDir, options.categoryId).then((found) => {
                if (found) gate.markArtifact(found);
              });
            }
          },
        );
      }
    }
    const found = await newestToolFindings(outDir, options.categoryId);
    if (!found) return;
    // Idempotente: si el gate ya completó o falló, esto no hace nada.
    // Mientras espere el exit, el interval sigue vivo como backstop del
    // timeout; cuando el gate se resuelve, onCompleted/fail lo limpian.
    gate.markArtifact(found);
  }, POLL_INTERVAL_MS);

  return {
    terminalId: terminal.id,
    stop: () => {
      stopped = true;
      clearInterval(interval);
      exitUnsubscribe?.();
      destroyRuntime();
    },
  };
}
