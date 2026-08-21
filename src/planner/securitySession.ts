import { createTerminal } from "../stores/projectStore.ts";
import {
  destroyTerminalRuntime,
  ensureTerminalRuntime,
  getTerminalPtyId,
} from "../terminal/terminalRuntimeStore.ts";

// Sesión de aplicación de seguridad: spawnea
// `node scripts/configure-github-security.mjs --apply --repo <path>
// --selections <file> --out <dir>` como proceso headless (sin TUI, mismo
// runtime de terminal que el diagnóstico). El orquestador streamea el
// progreso por stdout (líneas > ✓ ⚠ ✗) y escribe
// .agents/planning/security-result-<ts>.json.
//
// Dos señales (mismo patrón que toolsSession):
// - onReady(resultPath): el security-result apareció. El runtime NO se
//   destruye acá: el log completo queda visible para el usuario.
// - onExited(code): con exit 0 + archivo presente, la corrida terminó.
//   El runtime lo destruye la app (store) al pasar a done, no esta sesión.

export interface SecuritySessionHandle {
  terminalId: string;
  stop: () => void;
}

export interface LaunchSecuritySessionOptions {
  repoPath: string;
  projectId: string;
  worktreeId: string;
  // Selecciones (features + subOptions) como JSON inline: viajan como un
  // argumento del spawn (tamaño chico, muy por debajo del límite de argv
  // de Windows que ya usa el prompt del diagnóstico).
  selectionsJson: string;
  // Carpeta donde el orquestador escribe security-result-<ts>.json.
  outDir: string;
  onReady: (resultPath: string) => void;
  onExited: (exitCode: number) => void;
  onError: (message: string) => void;
}

const POLL_INTERVAL_MS = 1000;
const SESSION_TIMEOUT_MS = 3 * 60 * 1000;

export async function newestSecurityResult(dir: string): Promise<string | null> {
  try {
    const entries = await window.termcanvas.fs.listDir(dir);
    let best: string | null = null;
    let bestTs = -1;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const match = /^security-result-(\d+)\.json$/.exec(entry.name);
      if (!match) continue;
      const ts = Number(match[1]);
      if (Number.isFinite(ts) && ts > bestTs) {
        bestTs = ts;
        best = entry.name;
      }
    }
    return best ? `${dir}/${best}` : null;
  } catch {
    return null;
  }
}

export async function launchSecuritySession(
  options: LaunchSecuritySessionOptions,
): Promise<SecuritySessionHandle | null> {
  const scriptsDir = window.termcanvas?.paths?.scriptsDir;
  if (!scriptsDir) {
    options.onError(
      "La app no expone la ruta de sus scripts; no se puede correr la configuración de seguridad.",
    );
    return null;
  }
  const orchestrator = `${scriptsDir.replace(/[\\/]+$/, "")}/configure-github-security.mjs`;

  const terminal = createTerminal("opencode", "Seguridad del repositorio", undefined, false, "agent");
  terminal.headlessShell = "node";
  terminal.headlessArgs = [
    orchestrator,
    "--apply",
    "--repo",
    options.repoPath,
    "--selections-json",
    options.selectionsJson,
    "--out",
    options.outDir,
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
      caller: "securitySession",
      reason: "security_session_finished",
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
        `La configuración de seguridad no escribió security-result en ${options.outDir} (tiempo agotado)`,
      );
      return;
    }
    if (!exitSubscribed && window.termcanvas?.terminal?.onExit) {
      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId !== null) {
        exitSubscribed = true;
        exitUnsubscribe = window.termcanvas.terminal.onExit(
          (exitedPtyId, exitCode) => {
            if (stopped || exitedPtyId !== ptyId) return;
            if (exitCode !== 0) {
              fail(
                `La configuración de seguridad terminó con error (exit ${exitCode})${fileFound ? "" : " sin escribir security-result"}`,
              );
              return;
            }
            if (!fileFound) return;
            options.onExited(exitCode);
          },
        );
      }
    }
    if (fileFound) return;
    const found = await newestSecurityResult(options.outDir);
    if (!found) return;
    fileFound = true;
    clearInterval(interval);
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
