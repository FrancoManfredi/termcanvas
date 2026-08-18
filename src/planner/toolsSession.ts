import { createTerminal } from "../stores/projectStore.ts";
import {
  destroyTerminalRuntime,
  ensureTerminalRuntime,
  getTerminalPtyId,
} from "../terminal/terminalRuntimeStore.ts";

// Sesión de herramientas deterministas (Fase A del Diagnóstico): spawnea
// `node scripts/run-diagnostico-tools.mjs --repo <path> --out <path>` como
// proceso headless (sin TUI, mismo runtime de terminal que el LLM). El
// orquestador escanea el 100% del repo con ESLint/tsc/audit/knip/jscpd/
// gitleaks/git-sizer y escribe .agents/planning/tool-findings-<ts>.json.
//
// La sesión tiene DOS señales (gate manual hacia el LLM):
// - onReady(findingsPath): el tool-findings apareció. El runtime NO se
//   destruye: el log completo queda visible para que el usuario lo revise.
// - onExited(code): el proceso terminó. Con exit 0 + archivo presente,
//   TODAS las herramientas terminaron de escanear — la app habilita el
//   botón "Continuar al diagnóstico LLM".
// El runtime lo destruye la app (continueToLlm / cancel), no esta sesión.

export interface ToolsSessionHandle {
  terminalId: string;
  stop: () => void;
}

export interface LaunchToolsSessionOptions {
  repoPath: string;
  projectId: string;
  worktreeId: string;
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

const POLL_INTERVAL_MS = 1500;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

function toolsOutputDir(repoPath: string): string {
  return `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
}

// El nombre del archivo lleva el timestamp: el poller espera el tool-findings
// MÁS NUEVO de la carpeta (el que esta corrida acaba de escribir). También lo
// usa el Diagnóstico para el "LLM directo" (saltear la Fase A reutilizando la
// corrida de herramientas más reciente).
export async function newestToolFindings(dir: string): Promise<string | null> {
  try {
    const entries = await window.termcanvas.fs.listDir(dir);
    let best: string | null = null;
    let bestTs = -1;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const match = /^tool-findings-(\d+)\.json$/.exec(entry.name);
      if (!match) continue;
      const ts = Number(match[1]);
      if (Number.isFinite(ts) && ts > bestTs) {
        bestTs = ts;
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
  let fileFound = false;
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

  const startedAt = Date.now();
  const interval = setInterval(async () => {
    if (stopped) return;
    if (Date.now() > startedAt + SESSION_TIMEOUT_MS) {
      fail(
        `El pipeline de herramientas no escribió tool-findings en ${outDir} (tiempo agotado)`,
      );
      return;
    }
    // Suscripción al exit del proceso (una sola vez). El gate de "todas las
    // herramientas terminaron" es archivo presente + exit 0: el orquestador
    // escribe el tool-findings y después imprime el resumen y termina.
    if (!exitSubscribed && window.termcanvas?.terminal?.onExit) {
      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId !== null) {
        exitSubscribed = true;
        exitUnsubscribe = window.termcanvas.terminal.onExit(
          (exitedPtyId, exitCode) => {
            if (stopped || exitedPtyId !== ptyId) return;
            if (exitCode !== 0) {
              fail(
                `El pipeline de herramientas terminó con error (exit ${exitCode})${fileFound ? "" : " sin escribir tool-findings"}`,
              );
              return;
            }
            if (!fileFound) return; // el archivo aparece justo antes del exit
            options.onExited(exitCode);
          },
        );
      }
    }
    if (fileFound) return;
    const found = await newestToolFindings(outDir);
    if (!found) return;
    fileFound = true;
    clearInterval(interval);
    // El proceso sigue vivo unos segundos (resumen final): el runtime queda
    // intacto para que el log completo siga visible en el pane.
    options.onReady(found);
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
