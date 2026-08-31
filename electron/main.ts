import {
  app,
  BrowserWindow,
  crashReporter,
  ipcMain,
  dialog,
  nativeImage,
  shell,
  safeStorage,
  protocol,
  net,
} from "electron";
import https from "https";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { PtyManager, OutputBatcher } from "./pty-manager";
import { ProjectScanner } from "./project-scanner";
import { StatePersistence, TERMCANVAS_DIR } from "./state-persistence";
import { SnapshotHistory } from "./snapshot-history";
import { GitFileWatcher } from "./git-watcher";
import { FileTreeWatcher } from "./file-tree-watcher";
import {
  SessionWatcher,
  resolveSessionFile,
  type SessionType,
} from "./session-watcher";
import { ApiServer } from "./api-server";
import { PinStore } from "./pin-store";
import { sendToWindow } from "./window-events";
import { detectCli } from "./process-detector";
import { ensureCliLauncher } from "./cli-launchers";
import { getAgentShimDir, getTerminalExtraPathEntries } from "./agent-shims";
import {
  isCliRegistered,
  registerCli,
  unregisterCli,
} from "./cli-registration";
import {
  ensureSkillLinks,
  getSkillsSourceDir,
  installSkillLinks,
} from "./skill-manager";
import {
  readCliIntegrationState,
  syncCliIntegrationOnStartup,
  writeCliIntegrationState,
} from "./cli-integration";
import { buildLaunchSpec } from "./pty-launch.js";
import { registerInterviewIpc, closeInterviewService, setInterviewActivitySink } from "./interview-service";
import { registerModelCatalogIpc } from "./model-catalog-ipc";
import {
  createDefaultComposerSubmitDeps,
  submitComposerRequest,
} from "./composer-submit";
import {
  collectUsage,
  collectUsageRange,
  collectHeatmapData,
} from "./usage-collector";
import {
  buildGitWorktreeRemoveArgs,
  resolveMainRepoRoot,
} from "./worktree-helpers.ts";
import {
  installDownloadedUpdate,
  setupAutoUpdater,
  stopAutoUpdater,
} from "./auto-updater";
import {
  initAuth,
  login,
  logout,
  getAuthUser,
  getDeviceId,
  handleAuthCallback,
  onAuthStateChange,
  isLoggedIn,
} from "./auth";
import { toFileUrl } from "./file-url";
import {
  queryCloudUsage,
  queryCloudUsageRange,
  queryCloudHeatmap,
  backfillHistory,
  flushSyncQueue,
  syncRecentRecords,
} from "./usage-sync";
import type {
  ComposerSubmitRequest,
  ComposerSupportedTerminalType,
} from "../src/types";
import type { SecurityAuditResponse } from "../src/types/repoSecurity";
import { buildPinComposerPayload } from "./pin-dispatch";
import { getProjectDiff } from "./git-diff";
import { searchFileContents, searchSessionContents } from "./search-handlers";
import {
  invalidateSessionIndexForFile,
  listSessionsForProjects,
  listSessionsForProjectsPaged,
  type SessionSearchEntry,
} from "./session-search-index";
import {
  buildSessionHistoryScope,
  diffSessionHistoryScopes,
} from "./session-history-events.ts";
import type { SessionHistoryChangedEvent } from "../shared/sessions.ts";
import {
  REVIEW_CYCLE_LABELS,
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_CONFLICT,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_GATE_FAIL,
  REVIEW_LABEL_PENDING,
  canonicalReviewLabel,
  parseReviewBodyVerdict,
  reviewDecisionFromBodyVerdict,
  reviewDecisionWithFixApplied,
  reviewLabelsForVerdict,
} from "../src/canvas/reviewVerdict";
import type { MergeProgressEvent } from "../src/types";
import {
  checkoutGitRef,
  createCommit,
  discardFiles,
  getGitBranches,
  getGitCommitDetail,
  getGitLog,
  getGitStatus,
  gitPull,
  gitPush,
  initGitRepo,
  isGitRepo,
  stageFiles,
  unstageFiles,
  amendCommit,
  listStashes,
  createStash,
  applyStash,
  popStash,
  dropStash,
  createBranch,
  deleteBranch,
  renameBranch,
  listTags,
  createTag,
  deleteTag,
  listRemotes,
  addRemote,
  removeRemote,
  renameRemote,
  gitFetch,
  gitMerge,
  gitMergeAbort,
  gitRebase,
  gitRebaseAbort,
  gitRebaseContinue,
  gitCherryPick,
  gitCherryPickAbort,
  getMergeState,
  getFileDiff,
  stageHunk,
  unstageHunk,
  getBlame,
  resolveBranchCheckoutRef,
} from "./git-info";
import { parseNulSeparatedGitPaths } from "./git-paths";
import { createMenu } from "./menu";
import { isSelectAllShortcutInput } from "./select-all-shortcut";
import { isReloadShortcutInput } from "./reload-shortcut";
import { TelemetryService } from "./telemetry-service";
import { createRenderDiagnosticsLogger } from "./render-diagnostics";
import { RenderThrottlingCoordinator } from "./render-throttling-coordinator";
import { HookReceiver } from "./hook-receiver";
import { isSafeExternalUrl } from "./external-url";
import { WorkspaceSavePathRegistry } from "./workspace-save-path";
import {
  findBestClaudeSession,
  findBestCodebuddySession,
  findBestCodexSession,
  findBestKimiSession,
  findBestOpenCodeSession,
  findBestWuuSession,
  readClaudeSessionPermissionMode,
  readCodexSessionBypassState,
  readLatestCodexSessionId,
} from "./session-discovery";
import { AgentService, type AgentConfig } from "./agent-service";
import { SessionScanner } from "./session-scanner.ts";
import { mergeAndDedupeSessions } from "./session-list.ts";
import { buildPinRenderHtml } from "./pin-render-utils";
import { registerContextSyncIpc } from "./context-sync-ipc";
import { McpManager } from "./mcp/manager.ts";
import { McpVault } from "./mcp/vault.ts";
import { registerMcpIpc } from "./mcp/ipc.ts";
import { writeMcpToAgentsDir } from "./mcp/sync.ts";
import { getMcpEnvForCwd, registerMcpProject } from "./mcp/project-env.ts";
import { syncGlobalMcpToCodebuddy } from "./mcp/adapters/codebuddy.ts";
import { syncGlobalSkillsToCodebuddy } from "./skills/codebuddy-sync.ts";
import type { RenderDiagnosticEventInput } from "../shared/render-diagnostics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !!process.env.VITE_DEV_SERVER_URL;
if (isDev) {
  app.setPath("userData", path.join(app.getPath("appData"), "termcanvas-dev"));
}

// Capture main / renderer / GPU process crashes into local minidumps. Required
// before any window opens so main-process crashes are still recorded. We do
// not upload anywhere — dumps live under app.getPath('crashDumps') for users
// (or us) to attach to bug reports manually.
crashReporter.start({
  productName: "TermCanvas",
  uploadToServer: false,
  compress: true,
});

// Custom scheme for serving pin image attachments from disk. Renderer-side
// `<img src="tc-attachment://local/<abs-path>">` resolves through the handler
// registered after app.whenReady. Must be declared as privileged BEFORE the
// app is ready, otherwise Chromium treats it as opaque and blocks subresources.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "tc-attachment",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);
const skipLock = isDev || !!process.env.TERMCANVAS_SKIP_LOCK;
const gotLock = skipLock || app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(
    "[TermCanvas] Another instance is already running. Quitting.\n" +
      "  Kill the old process first: pkill -f Electron",
  );
  app.quit();
}

const PORT_FILE = path.join(TERMCANVAS_DIR, "port");

// Labels que ya existen por repo (cwd → nombres): evita listar labels de gh
// en cada issue de una misma corrida de creación. Ver github:create-issue.
const labelCache = new Map<string, Set<string>>();

function perfLog(label: string, details: Record<string, unknown>) {
  if (!isDev) return;
  console.log(`[Perf] ${label}`, details);
}

function writePortFile(port: number) {
  fs.writeFileSync(PORT_FILE, `${port}\n${process.pid}`, "utf-8");
}

function cleanupPortFile() {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {}
}

function emitSessionHistoryChanged(payload: SessionHistoryChangedEvent) {
  const projectDirs = payload.projectDirs
    .map((dir) => dir.trim())
    .filter(Boolean);
  if (projectDirs.length === 0) {
    return;
  }

  sendToWindow(mainWindow, "session-history:changed", {
    ...payload,
    projectDirs,
  });
}

// Returns a reason string when the resolved path is too dangerous to
// delete recursively (root, home, or an ancestor of home).
function folderDeleteRefusalReason(resolved: string): string | null {
  const home = os.homedir();
  const root = path.parse(resolved).root;
  if (
    !path.isAbsolute(resolved) ||
    resolved === root ||
    resolved === home ||
    home.startsWith(resolved + path.sep) ||
    resolved.split(path.sep).filter(Boolean).length < 2
  ) {
    return `Refusing to delete unsafe path: ${resolved}`;
  }
  return null;
}

// Deletes a folder recursively, but only when it exists and the path
// passes the safety check. Used to guarantee the worktree folder is gone
// even when git leaves remnants behind. Retries a few times because on
// Windows a recently killed terminal process may still hold the folder as
// its cwd for a few hundred milliseconds, which makes rm fail with EBUSY.
// Returns false when the folder still exists after all attempts.
async function removeFolderSafely(folderPath: string): Promise<boolean> {
  const resolved = path.resolve(folderPath);
  if (folderDeleteRefusalReason(resolved)) {
    return false;
  }
  const { access, rm } = await import("fs/promises");
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 300;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await access(resolved);
      await rm(resolved, { recursive: true, force: true });
      return true;
    } catch {
      // Folder may not exist yet (git already removed it) or is still
      // locked by a dying process; both are retryable.
      if (attempt === MAX_ATTEMPTS) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return false;
}

const HIDDEN_DIRS = new Set([".git"]);

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const outputBatcher = new OutputBatcher((ptyId, data) => {
  sendToWindow(mainWindow, "terminal:output", ptyId, data);
});
const projectScanner = new ProjectScanner();
const statePersistence = new StatePersistence();
const snapshotHistory = new SnapshotHistory();
const gitWatcher = new GitFileWatcher();
const fileTreeWatcher = new FileTreeWatcher(HIDDEN_DIRS, (dirPath) => {
  sendToWindow(mainWindow, "fs:dir-changed", dirPath);
});
const sessionWatcher = new SessionWatcher();
const telemetryService = new TelemetryService({
  onSnapshotChanged: (terminalId, snapshot) => {
    sendToWindow(mainWindow, "telemetry:snapshot-changed", {
      terminalId,
      snapshot,
    });
  },
});
const agentService = new AgentService();
const mcpVault = new McpVault();
const mcpManager = new McpManager({ vault: mcpVault });
// Conectar MCP tools al AgentService (project-scoped, extensible a terminal/agent por mcpScope)
agentService.setMcpResolver(async (projectId, scope) => {
  return mcpManager.getToolsForProject(projectId, (scope as import("../shared/mcp.ts").McpScope) ?? "project");
});
agentService.setMcpExecutor(async (projectId, serverId, toolName, args) => {
  // v1 stub executor: en v2 proxeará al MCP server real
  return { content: `[MCP ${serverId}] ${toolName} ejecutado con ${JSON.stringify(args)} — stub v1. Conectá el MCP en Ajustes > MCP.` };
});
// Resolver cwd -> projectId para cuando el renderer no manda projectId explícito (compat)
agentService.setProjectResolver((projectPath: string) => {
  // No tenemos proyecto en main de forma síncrona; el renderer debe mandar projectId.
  // Este fallback queda para futuro si statePersistence expone proyectos.
  void projectPath;
  return null;
});
const sessionScanner = new SessionScanner();
const renderDiagnostics = createRenderDiagnosticsLogger(
  app.getPath("userData"),
);
const workspaceSavePaths = new WorkspaceSavePathRegistry((filePath) =>
  path.resolve(filePath),
);
let throttlingCoordinator: RenderThrottlingCoordinator | null = null;
let hookSocketPath: string | null = null;
const hookReceiver = new HookReceiver((event) => {
  telemetryService.recordHookEvent(event.terminal_id, event);

  if (event.hook_event_name === "SessionStart" && event.session_id) {
    sendToWindow(mainWindow, "hook:session-started", {
      terminalId: event.terminal_id,
      sessionId: event.session_id,
      transcriptPath: event.transcript_path ?? null,
      cwd: event.cwd ?? null,
    });
  } else if (event.hook_event_name === "Stop") {
    sendToWindow(mainWindow, "hook:turn-complete", {
      terminalId: event.terminal_id,
      sessionId: event.session_id ?? null,
    });
  } else if (event.hook_event_name === "StopFailure") {
    sendToWindow(mainWindow, "hook:stop-failure", {
      terminalId: event.terminal_id,
      sessionId: event.session_id ?? null,
      error: event.error ?? null,
      errorDetails: event.error_details ?? null,
    });
  }
});
const taskStore = new PinStore(path.join(TERMCANVAS_DIR, "pins"));

taskStore.on("pin:created", (payload: { pin: unknown; repo: string }) => {
  sendToWindow(mainWindow, "pin:event", { type: "pin:created", ...payload });
});
taskStore.on("pin:updated", (payload: { pin: unknown; repo: string }) => {
  sendToWindow(mainWindow, "pin:event", { type: "pin:updated", ...payload });
});
taskStore.on("pin:removed", (payload: { id: string; repo: string }) => {
  sendToWindow(mainWindow, "pin:event", { type: "pin:removed", ...payload });
});

const apiServer = new ApiServer({
  getWindow: () => mainWindow,
  ptyManager,
  projectScanner,
  telemetryService,
  taskStore,
});

function openPinPreviewWindow(repo: string, pinId: string): void {
  const pin = taskStore.get(repo, pinId);
  if (!pin) {
    throw new Error(`Pin not found: ${pinId}`);
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    useContentSize: true,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: pin.title.trim() || "Pin Preview",
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  let initialUrl: string | null = null;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (initialUrl && url === initialUrl) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  const html = buildPinRenderHtml(pin);
  initialUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  void win.loadURL(initialUrl);
}

function createWindow() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: "#101010",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    ...(isMac && {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 14, y: 14 },
    }),
    ...(isWin && {
      titleBarStyle: "hidden" as const,
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#888888",
        height: 44,
      },
    }),
    ...(!isMac &&
      !isWin && {
        titleBarStyle: "hidden" as const,
      }),
  });
  const windowId = mainWindow.id;
  renderDiagnostics.recordMainEvent("browser_window_created", {
    isDev,
    window_id: windowId,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    delete webPreferences.preload;
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!isDev && isReloadShortcutInput(input)) {
      event.preventDefault();
      return;
    }

    if (!isSelectAllShortcutInput(input)) {
      return;
    }

    event.preventDefault();
    mainWindow?.webContents.send("menu:select-all");
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    renderDiagnostics.recordMainEvent("browser_window_closed", {
      window_id: windowId,
    });
    mainWindow = null;
    rendererReady = false;
  });
  mainWindow.on("focus", () => {
    renderDiagnostics.recordMainEvent("browser_window_focus", {
      window_id: windowId,
      visible: mainWindow?.isVisible() ?? null,
    });
    // macOS re-activation can leave compositor-backed sidebar layers stale
    // until the next input-driven repaint. Force a full redraw on focus so
    // fixed/overflow-hidden panels repaint immediately.
    mainWindow?.webContents.invalidate();
    for (const dirPath of fileTreeWatcher.getWatchedDirs()) {
      sendToWindow(mainWindow, "fs:dir-changed", dirPath);
    }
    // macOS Space switching does not reliably fire `visibilitychange` on the
    // renderer side, so the renderer's existing recovery path can miss the
    // return-from-Space transition entirely. Push a lifecycle ping from the
    // main process (which is never throttled) so the renderer can repaint
    // its terminals regardless of whether visibilitychange fired.
    sendToWindow(mainWindow, "tc:lifecycle:visible", {
      reason: "browser_window_focus",
      timestamp: Date.now(),
    });
  });
  mainWindow.on("blur", () => {
    renderDiagnostics.recordMainEvent("browser_window_blur", {
      window_id: windowId,
      visible: mainWindow?.isVisible() ?? null,
    });
  });
  mainWindow.on("show", () => {
    renderDiagnostics.recordMainEvent("browser_window_show", {
      window_id: windowId,
    });
    sendToWindow(mainWindow, "tc:lifecycle:visible", {
      reason: "browser_window_show",
      timestamp: Date.now(),
    });
  });
  mainWindow.on("hide", () => {
    renderDiagnostics.recordMainEvent("browser_window_hide", {
      window_id: windowId,
    });
  });
  mainWindow.on("minimize", () => {
    renderDiagnostics.recordMainEvent("browser_window_minimize", {
      window_id: windowId,
    });
  });
  mainWindow.on("restore", () => {
    renderDiagnostics.recordMainEvent("browser_window_restore", {
      window_id: windowId,
    });
  });

  createMenu(mainWindow);
  agentService.setWindow(mainWindow);

  // Disable Chromium's background-occluded throttling whenever there is
  // active work (PTY output within the last 30s). Idle stays throttled so
  // battery isn't burned when the user genuinely switched away.
  if (!throttlingCoordinator) {
    throttlingCoordinator = new RenderThrottlingCoordinator({
      target: {
        setBackgroundThrottling: (allowed) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.setBackgroundThrottling(allowed);
          }
        },
      },
      recordDiagnostic: (event) => {
        renderDiagnostics.recordMainEvent(event.kind, event.data ?? {});
      },
    });
    throttlingCoordinator.start();
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  let rendererReady = false;
  mainWindow.webContents.on("did-finish-load", async () => {
    renderDiagnostics.recordMainEvent("renderer_did_finish_load", {
      renderer_ready_before_load: rendererReady,
      window_id: windowId,
    });
    if (rendererReady) {
      console.warn("[PtyManager] renderer reloaded – destroying orphaned PTYs");
      await ptyManager.destroyAll();
    }
    rendererReady = true;
    try {
      const port = await apiServer.start();
      writePortFile(port);
      if (isDev) console.log(`[TermCanvas API] http://127.0.0.1:${port}`);
    } catch (err) {
      console.error("[TermCanvas API] Failed to start:", err);
    }
  });
  mainWindow.on("close", () => {
    renderDiagnostics.recordMainEvent("browser_window_close_requested", {
      renderer_ready: rendererReady,
      window_id: windowId,
    });
  });
}

const DEBUG_LOG = path.join(TERMCANVAS_DIR, "session-debug.log");
function dbg(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG, line);
  } catch {
    /* ignore */
  }
}

function setupIpc() {
  ipcMain.handle(
    "terminal:create",
    async (
      _event,
      options: {
        cwd: string;
        shell?: string;
        args?: string[];
        terminalId?: string;
        terminalType?: string;
        theme?: "dark" | "light";
        workflowId?: string;
        assignmentId?: string;
        repoPath?: string;
        envOverrides?: Record<string, string>;
      },
    ) => {
      dbg(
        `terminal:create shell=${options.shell ?? "(default)"} args=${JSON.stringify(options.args)} cwd=${options.cwd}`,
      );
      const cliDir = getCliDir();
      // Asegurar que CodeBuddy vea skills globales en cualquier proyecto donde se abra una shell
      // (ej. education-games). Es idempotente y no bloquea — si falla, la shell igual abre.
      try {
        const { syncGlobalSkillsToCodebuddy } = await import("./skills/codebuddy-sync.ts");
        // Fire-and-forget, no await para no demorar la creación del PTY
        void syncGlobalSkillsToCodebuddy(options.cwd).catch(() => {});
      } catch {}
      // Inyectar tokens MCP del proyecto como env vars para que `opencode` los vea vía {env:VAR}
      // Los tokens quedan en vault cifrado, no en opencode.json del proyecto.
      let mcpEnv: Record<string, string> = {};
      try {
        mcpEnv = await getMcpEnvForCwd(options.cwd, mcpManager);
      } catch {}
      const envOverrides: Record<string, string> = {};
      if (hookSocketPath) envOverrides.TERMCANVAS_SOCKET = hookSocketPath;
      Object.assign(envOverrides, mcpEnv);
      const ptyId = await ptyManager.create({
        ...options,
        extraPathEntries: getTerminalExtraPathEntries(
          cliDir,
          options.terminalType,
        ),
        // Merge caller envOverrides (ej: OPENCODE_CONFIG del scope de skills)
        // con el override interno (hookSocketPath + mcpEnv). El socket de hooks
        // nunca se pisa.
        ...(Object.keys(envOverrides).length || Object.keys(options.envOverrides ?? {}).length
          ? {
              envOverrides: {
                ...envOverrides,
                ...(options.envOverrides ?? {}),
                ...(hookSocketPath ? { TERMCANVAS_SOCKET: hookSocketPath } : {}),
              },
            }
          : {}),
      });
      const pid = ptyManager.getPid(ptyId);
      dbg(`terminal:create => ptyId=${ptyId} pid=${pid ?? "null"}`);
      const terminalId = options.terminalId ?? `pty-${ptyId}`;
      telemetryService.registerTerminal({
        terminalId,
        worktreePath: options.cwd,
        provider:
          options.terminalType === "claude" ||
          options.terminalType === "codex" ||
          options.terminalType === "wuu"
            ? options.terminalType
            : "unknown",
        workflowId: options.workflowId,
        assignmentId: options.assignmentId,
        repoPath: options.repoPath,
        ptyId,
        shellPid: pid ?? null,
      });
      telemetryService.recordPtyCreated({
        terminalId,
        ptyId,
        shellPid: pid ?? null,
      });
      ptyManager.onData(ptyId, (data: string) => {
        ptyManager.captureOutput(ptyId, data);
        telemetryService.recordPtyOutputByPtyId(ptyId, data);
        outputBatcher.push(ptyId, data);
        throttlingCoordinator?.markActivity("pty");
      });
      ptyManager.onExit(ptyId, (exitCode: number) => {
        dbg(
          `terminal:exit ptyId=${ptyId} pid=${pid ?? "null"} exitCode=${exitCode}`,
        );
        telemetryService.recordPtyExitByPtyId(ptyId, exitCode);
        sendToWindow(mainWindow, "terminal:exit", ptyId, exitCode);
      });
      return ptyId;
    },
  );

ipcMain.on("terminal:input", (_event, ptyId: number, data: string) => {
    ptyManager.write(ptyId, data);
    telemetryService.recordPtyInputByPtyId(ptyId, data);
  });

  // Ruta de los scripts de soporte de la app (ej. run-diagnostico-tools.mjs
  // del pipeline de herramientas del Diagnóstico). El preload corre
  // sandboxed y no puede require('node:path'), así que la ruta se resuelve
  // acá (proceso principal, Node completo) y se expone por IPC síncrono.
  ipcMain.on("paths:get-scripts-dir", (event) => {
    event.returnValue = path.join(__dirname, "..", "scripts");
  });

  ipcMain.on(
    "terminal:resize",
    (_event, ptyId: number, cols: number, rows: number) => {
      ptyManager.resize(ptyId, cols, rows);
    },
  );

  ipcMain.on("terminal:theme-changed", (_event, ptyId: number) => {
    ptyManager.notifyThemeChanged(ptyId);
  });

  ipcMain.handle("terminal:destroy", async (_event, ptyId: number) => {
    await ptyManager.destroy(ptyId);
  });

  ipcMain.handle("terminal:get-pid", (_event, ptyId: number) => {
    const pid = ptyManager.getPid(ptyId) ?? null;
    dbg(`terminal:get-pid ptyId=${ptyId} => pid=${pid}`);
    return pid;
  });

  ipcMain.handle("terminal:detect-cli", async (_event, ptyId: number) => {
    const shellPid = ptyManager.getPid(ptyId);
    if (!shellPid) return null;
    return detectCli(shellPid);
  });

  ipcMain.handle("session:get-codex-latest", () => {
    try {
      return readLatestCodexSessionId();
    } catch (err) {
      console.warn(
        "[session:get-codex-latest] failed to read session index:",
        err,
      );
      return null;
    }
  });

  ipcMain.handle(
    "session:find-codex",
    (_event, cwd: string, startedAt?: string) => {
      return findBestCodexSession(cwd, startedAt);
    },
  );

  ipcMain.handle("session:get-claude-by-pid", (_event, pid: number) => {
    try {
      const sessionFile = path.join(
        os.homedir(),
        ".claude",
        "sessions",
        `${pid}.json`,
      );
      const exists = fs.existsSync(sessionFile);
      dbg(
        `session:get-claude-by-pid pid=${pid} file=${sessionFile} exists=${exists}`,
      );
      if (!exists) {
        const sessDir = path.join(os.homedir(), ".claude", "sessions");
        try {
          const files = fs
            .readdirSync(sessDir)
            .filter((f) => f.endsWith(".json"));
          dbg(`  session files in dir: ${files.join(", ")}`);
        } catch {
          /* ignore */
        }
        return null;
      }
      const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      dbg(`  found sessionId=${data.sessionId}`);
      return data.sessionId as string;
    } catch (err) {
      dbg(`  ERROR: ${err}`);
      return null;
    }
  });

  ipcMain.handle(
    "session:find-claude",
    (_event, cwd: string, startedAt?: string, pid?: number | null) => {
      return findBestClaudeSession(cwd, startedAt, pid);
    },
  );

  ipcMain.handle(
    "session:find-wuu",
    (_event, cwd: string, startedAt?: string) => {
      return findBestWuuSession(cwd, startedAt);
    },
  );

  ipcMain.handle(
    "session:find-kimi",
    (_event, cwd: string, startedAt?: string) => {
      return findBestKimiSession(cwd, startedAt);
    },
  );

  ipcMain.handle(
    "session:find-opencode",
    (_event, cwd: string, startedAt?: string) => {
      return findBestOpenCodeSession(cwd, startedAt);
    },
  );

  ipcMain.handle(
    "session:find-codebuddy",
    (_event, cwd: string, startedAt?: string) => {
      return findBestCodebuddySession(cwd, startedAt);
    },
  );

  ipcMain.handle(
    "session:get-permission-mode",
    (_event, sessionId: string, cwd: string) => {
      return readClaudeSessionPermissionMode(sessionId, cwd);
    },
  );

  ipcMain.handle(
    "session:get-bypass-state",
    (_event, type: string, sessionId: string, cwd: string) => {
      if (type === "claude") {
        return (
          readClaudeSessionPermissionMode(sessionId, cwd) ===
          "bypassPermissions"
        );
      }
      if (type === "codex") {
        return readCodexSessionBypassState(sessionId, cwd);
      }
      return false;
    },
  );

  ipcMain.handle("project:select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("project:scan", async (_event, dirPath: string) => {
    return await projectScanner.scanAsync(dirPath);
  });

  ipcMain.handle(
    "project:list-child-git-repos",
    async (_event, dirPath: string) => {
      return await projectScanner.listChildGitReposAsync(dirPath);
    },
  );

  ipcMain.handle("project:diff", async (_event, worktreePath: string) => {
    const startedAt = Date.now();
    try {
      const result = await getProjectDiff(worktreePath);
      perfLog("project:diff", {
        worktreePath,
        ms: Date.now() - startedAt,
        files: result.files.length,
        diffLength: result.diff.length,
      });
      return result;
    } catch {
      perfLog("project:diff:error", {
        worktreePath,
        ms: Date.now() - startedAt,
      });
      return { diff: "", files: [] };
    }
  });

  ipcMain.handle(
    "project:rescan-worktrees",
    async (_event, dirPath: string) => {
      return await projectScanner.listWorktreesAsync(dirPath);
    },
  );

  ipcMain.handle(
    "project:create-worktree",
    async (_event, repoPath: string, branch: string) => {
      const trimmedBranch = (branch ?? "").trim();
      if (!trimmedBranch) {
        return { ok: false as const, error: "Branch name is required" };
      }
      if (
        /[\s~^:?*\[\\]/.test(trimmedBranch) ||
        trimmedBranch.startsWith("-")
      ) {
        return { ok: false as const, error: "Invalid branch name" };
      }

      const resolvedRepo = path.resolve(repoPath);
      const sanitizedDirName = trimmedBranch.replace(/[\\/]/g, "-");
      // Always create under the MAIN repo's .worktrees. repoPath may be a
      // linked worktree (e.g. resolving an issue while another issue's
      // worktree is focused); nesting worktrees inside it blows Windows'
      // MAX_PATH (260 chars) on long file names.
      const repoRoot = resolveMainRepoRoot(resolvedRepo);
      const worktreePath = path.join(
        repoRoot,
        ".worktrees",
        sanitizedDirName,
      );

      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        const branchExists = async (ref: string) => {
          try {
            await execFileAsync("git", ["rev-parse", "--verify", ref], {
              cwd: resolvedRepo,
            });
            return true;
          } catch {
            return false;
          }
        };
        if (await branchExists(`refs/heads/${trimmedBranch}`)) {
          // The branch already exists without a worktree (e.g. a removed
          // worktree or work started on another machine). Attach it instead
          // of failing with "branch already exists".
          await execFileAsync(
            "git",
            ["worktree", "add", worktreePath, trimmedBranch],
            { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
          );
        } else if (await branchExists(`refs/remotes/origin/${trimmedBranch}`)) {
          // Branch only exists on the remote: create the local branch
          // tracking the remote head.
          await execFileAsync(
            "git",
            ["worktree", "add", "-b", trimmedBranch, worktreePath, `origin/${trimmedBranch}`],
            { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
          );
        } else {
          await execFileAsync(
            "git",
            ["worktree", "add", "-b", trimmedBranch, worktreePath],
            { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
          );
        }
        const worktrees = await projectScanner.listWorktreesAsync(resolvedRepo);
        return { ok: true as const, path: worktreePath, worktrees };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // git errors often include stderr on a trailing line
        return { ok: false as const, error: message };
      }
    },
  );

  // Re-create a worktree for a branch whose implementer worktree no longer
  // exists (deleted terminal, pruned checkout). The branch must already
  // exist — locally or on origin — because this restores the PR head ref
  // instead of creating a fresh branch: the fix/conflict session pushes
  // back onto the same PR. Used by the RESOLVER CONFLICTO / IMPLEMENTAR
  // FIX flows when their branch lookup comes up empty.
  ipcMain.handle(
    "project:restore-worktree",
    async (_event, repoPath: string, branch: string) => {
      const trimmedBranch = (branch ?? "").trim();
      if (!trimmedBranch) {
        return { ok: false as const, error: "Branch name is required" };
      }
      if (
        /[\s~^:?*\[\\]/.test(trimmedBranch) ||
        trimmedBranch.startsWith("-")
      ) {
        return { ok: false as const, error: "Invalid branch name" };
      }

      const resolvedRepo = path.resolve(repoPath);
      const sanitizedDirName = trimmedBranch.replace(/[\\/]/g, "-");
      // Always create under the MAIN repo's .worktrees (see
      // project:create-worktree for the MAX_PATH rationale).
      const repoRoot = resolveMainRepoRoot(resolvedRepo);
      const worktreePath = path.join(
        repoRoot,
        ".worktrees",
        sanitizedDirName,
      );

      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        // Same self-healing as the review flow: a branch that only exists on
        // origin is fetched and checked out from its remote-tracking ref.
        const resolved = await resolveBranchCheckoutRef(resolvedRepo, trimmedBranch);
        if (!resolved.ok) {
          return { ok: false as const, error: resolved.error };
        }
        if (resolved.hasLocal) {
          // Attach the existing local branch: `-b` would die with
          // "fatal: a branch named '...' already exists".
          await execFileAsync(
            "git",
            ["worktree", "add", worktreePath, trimmedBranch],
            { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
          );
        } else {
          await execFileAsync(
            "git",
            ["worktree", "add", "-b", trimmedBranch, worktreePath, `origin/${trimmedBranch}`],
            { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
          );
        }
        const worktrees = await projectScanner.listWorktreesAsync(resolvedRepo);
        return { ok: true as const, path: worktreePath, worktrees };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "project:create-review-worktree",
    async (_event, repoPath: string, baseName: string, branch: string) => {
      const trimmedBase = (baseName ?? "").trim();
      if (!trimmedBase) {
        return { ok: false as const, error: "Worktree base name is required" };
      }
      if (/[\\/:*?"<>|]/.test(trimmedBase)) {
        return { ok: false as const, error: "Invalid worktree base name" };
      }
      const trimmedBranch = (branch ?? "").trim();
      if (!trimmedBranch) {
        return { ok: false as const, error: "Branch name is required" };
      }
      if (
        /[\s~^:?*\[\]\\]/.test(trimmedBranch) ||
        trimmedBranch.startsWith("-")
      ) {
        return { ok: false as const, error: "Invalid branch name" };
      }

      const resolvedRepo = path.resolve(repoPath);
      // Reuse the implementer's worktree directory name with a "-review"
      // suffix so both worktrees of one issue share a base name and cleanup
      // can target the reviewer by suffix alone.
      const sanitizedDirName = trimmedBase.replace(/[\\/]/g, "-");
      // Always create under the MAIN repo's .worktrees (see
      // project:create-worktree for the MAX_PATH rationale).
      const repoRoot = resolveMainRepoRoot(resolvedRepo);
      const worktreePath = path.join(
        repoRoot,
        ".worktrees",
        `${sanitizedDirName}-review`,
      );

      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        // Self-heal ORPHANED review directories. A killed session can leave
        // <repo>/.worktrees/<base>-review on disk while git no longer
        // registers it as a worktree at all (admin metadata lost, so
        // `git worktree list` — and the scanner that feeds the store — never
        // sees it). The renderer's leftover prune only knows registered
        // worktrees, so without this step `git worktree add` fails with
        // "already exists" on the orphaned directory forever. Registered
        // worktrees (a live review) are never touched here — the renderer's
        // in-use guard handles those.
        const { stdout: registeredOut } = await execFileAsync(
          "git", ["worktree", "list", "--porcelain"],
          { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
        );
        const registered = new Set(
          registeredOut
            .split(/\r?\n/)
            .filter((line) => line.startsWith("worktree "))
            .map((line) => path.resolve(line.slice("worktree ".length))),
        );
        if (!fs.existsSync(worktreePath)) {
          // Nothing in the way — normal path.
        } else if (!registered.has(path.resolve(worktreePath))) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
      } catch {
        // Worktree listing failed; let the create below surface the error.
      }

      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        // Resolve before creating: the PR head may exist only on GitHub when
        // this clone never fetched the branch, which used to fail the whole
        // review with "fatal: invalid reference".
        const resolved = await resolveBranchCheckoutRef(resolvedRepo, trimmedBranch);
        if (!resolved.ok) {
          return { ok: false as const, error: resolved.error };
        }
        // The PR branch stays bound to the implementer's worktree and the
        // reviewer must never create its own branch or PR, so the review
        // copy is a detached checkout of the PR branch's commit.
        await execFileAsync(
          "git",
          ["worktree", "add", "--detach", worktreePath, resolved.ref],
          { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
        );
        // Persist the source branch so the scanner can display
        // "<branch> (review)" instead of "(detached)". Stored in git's
        // per-worktree admin dir, where the scanner reads it back on every
        // worktree listing.
        try {
          const adminDir = path.join(
            repoRoot,
            ".git",
            "worktrees",
            path.basename(worktreePath),
          );
          fs.mkdirSync(adminDir, { recursive: true });
          fs.writeFileSync(
            path.join(adminDir, "review-source-branch"),
            trimmedBranch,
            "utf-8",
          );
        } catch {
          // Cosmetic only — the review worktree still works without it.
        }
        const worktrees = await projectScanner.listWorktreesAsync(resolvedRepo);
        return { ok: true as const, path: worktreePath, worktrees };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // git errors often include stderr on a trailing line
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "project:remove-worktree",
    async (_event, repoPath: string, worktreePath: string, force?: boolean) => {
      const resolvedRepo = path.resolve(repoPath);
      const resolvedWorktree = path.resolve(worktreePath);

      if (resolvedWorktree === resolvedRepo) {
        // The primary worktree cannot be removed via git, and the manual
        // fallback would delete the whole repository. Refuse up front.
        return {
          ok: false as const,
          error: "Cannot remove the primary worktree",
        };
      }

      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      // git status --porcelain is locale-independent, so dirty detection
      // cannot break when git runs in a non-English language.
      const hasUncommittedChanges = async (): Promise<boolean> => {
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["status", "--porcelain"],
            { cwd: resolvedWorktree, maxBuffer: 10 * 1024 * 1024 },
          );
          return stdout.trim().length > 0;
        } catch {
          // Worktree missing or inaccessible: nothing left to protect.
          return false;
        }
      };

      const pruneWorktrees = async (): Promise<void> => {
        try {
          await execFileAsync("git", ["worktree", "prune"], {
            cwd: resolvedRepo,
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch {
          // Prune is best-effort; a stale git record is harmless.
        }
      };

      // git worktree remove leaves the branch behind, so recreating an
      // issue worktree fails with "branch already exists". Capture the
      // branch before removing anything, then delete it best-effort on
      // success — same contract hydra cleanup relies on.
      const getWorktreeBranch = async (): Promise<string | null> => {
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["worktree", "list", "--porcelain"],
            { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
          );
          let currentPath = "";
          for (const line of stdout.split("\n")) {
            if (line.startsWith("worktree ")) {
              currentPath = path.resolve(line.slice("worktree ".length));
            } else if (
              line.startsWith("branch ") &&
              // Windows paths can differ in case and separator style
              // between git output and the renderer; compare normalized
              // forms instead of raw strings.
              currentPath.toLowerCase() === resolvedWorktree.toLowerCase()
            ) {
              return line.slice("branch ".length).replace("refs/heads/", "");
            }
          }
          return null;
        } catch (error) {
          console.error("[removeWorktree] failed to list worktrees:", error);
          return null;
        }
      };

      // TermCanvas always creates worker worktrees under
      // .worktrees/<branch-name> (see api-server.ts), so the folder name
      // is a reliable fallback when git cannot tell us the branch — e.g.
      // after a failed first remove attempt left the worktree unlisted
      // but its branch alive.
      const worktreeFolderName = path.basename(resolvedWorktree);

      const deleteWorktreeBranch = async (branch: string): Promise<void> => {
        try {
          await execFileAsync("git", ["branch", "-D", branch], {
            cwd: resolvedRepo,
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch (error) {
          // Branch already deleted or checked out in another worktree;
          // git refuses and nothing needs doing.
          console.error(`[removeWorktree] failed to delete branch ${branch}:`, error);
        }
      };

      try {
        const branch = await getWorktreeBranch();
        // Never delete the branch that the primary worktree lives on.
        const isPrimary = path.resolve(resolvedWorktree) === resolvedRepo;
        // git is the primary source for the branch name; fall back to the
        // worktree folder name (TermCanvas convention: .worktrees/<branch>)
        // when git cannot tell us — e.g. a previous remove attempt already
        // unlisted the worktree while its branch survived. The branch must
        // be deleted only AFTER the worktree is gone, because git refuses
        // to delete a branch that is still checked out.
        const branchToDelete = branch ?? (isPrimary ? null : worktreeFolderName);
        // Reuse the shared --force builder so the renderer/IPC path matches
        // the CLI, hydra, and headless paths exactly. Without --force, git
        // refuses to remove worktrees containing modified or untracked files
        // — which is exactly what worker worktrees produce by design.
        const args = force
          ? buildGitWorktreeRemoveArgs(resolvedWorktree)
          : ["worktree", "remove", resolvedWorktree];
        try {
          await execFileAsync("git", args, {
            cwd: resolvedRepo,
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!force && (await hasUncommittedChanges())) {
            // git refused because the worktree has uncommitted changes.
            // Report dirty so the renderer can ask for explicit
            // confirmation before any data is destroyed.
            return { ok: false as const, dirty: true as const, error: message };
          }
          // "not a working tree" means git already unregistered the
          // worktree (e.g. a previous remove attempt); there is nothing
          // left for git to do, so fall through to folder + branch cleanup.
          const alreadyUnregistered = /is not a working tree/i.test(message);
          if (!alreadyUnregistered) {
            // git could not remove the worktree (locked files, stale
            // registration, ignored files): delete the folder manually and
            // prune the stale git record so disk state matches the panel.
            const folderRemoved = await removeFolderSafely(resolvedWorktree);
            await pruneWorktrees();
            if (!folderRemoved) {
              // The folder may be held open by a live terminal process.
              // Still delete the branch so recreating the worktree is not
              // blocked, and report the folder problem separately.
              if (branchToDelete !== null) {
                await deleteWorktreeBranch(branchToDelete);
              }
              return {
                ok: false as const,
                error: `Could not remove the worktree folder (a terminal may still be using it). ${message}`,
              };
            }
          }
        }
        // git removes the folder on success, but on Windows locked files
        // can leave remnants behind — guarantee the cleanup either way.
        await removeFolderSafely(resolvedWorktree);
        await pruneWorktrees();
        // Without this the orphaned branch blocks recreating the worktree
        // for the same issue ("a branch named ... already exists").
        if (branchToDelete !== null) {
          await deleteWorktreeBranch(branchToDelete);
        }
        const worktrees = await projectScanner.listWorktreesAsync(resolvedRepo);
        return { ok: true as const, worktrees };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "project:delete-folder",
    async (_event, projectPath: string) => {
      try {
        const resolved = path.resolve(projectPath);
        const refusal = folderDeleteRefusalReason(resolved);
        if (refusal) {
          return { ok: false as const, error: refusal };
        }
        const { rm } = await import("fs/promises");
        await rm(resolved, { recursive: true, force: true });
        return { ok: true as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle("git:watch", (_event, worktreePath: string) => {
    gitWatcher.watch(worktreePath, {
      onChanged: () => {
        sendToWindow(mainWindow, "git:changed", worktreePath);
      },
      onLogChanged: () => {
        sendToWindow(mainWindow, "git:log-changed", worktreePath);
      },
      onPresenceChanged: (repoState) => {
        sendToWindow(mainWindow, "git:presence-changed", worktreePath, {
          isGitRepo: repoState,
        });
      },
    });
  });

  ipcMain.handle("git:unwatch", (_event, worktreePath: string) => {
    gitWatcher.unwatch(worktreePath);
  });

  ipcMain.handle("git:is-repo", async (_event, dirPath: string) => {
    return isGitRepo(dirPath);
  });

  ipcMain.handle("git:branches", async (_event, worktreePath: string) => {
    try {
      return await getGitBranches(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:log",
    async (_event, worktreePath: string, count?: number) => {
      try {
        return await getGitLog(worktreePath, count);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    "git:commit-detail",
    async (_event, worktreePath: string, hash: string) => {
      return getGitCommitDetail(worktreePath, hash);
    },
  );

  ipcMain.handle(
    "git:checkout",
    async (_event, worktreePath: string, ref: string) => {
      return checkoutGitRef(worktreePath, ref);
    },
  );

  ipcMain.handle("git:init", async (_event, worktreePath: string) => {
    return initGitRepo(worktreePath);
  });

  ipcMain.handle("git:status", async (_event, worktreePath: string) => {
    try {
      return await getGitStatus(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:stage",
    async (_event, worktreePath: string, paths: string[]) => {
      return stageFiles(worktreePath, paths);
    },
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, worktreePath: string, paths: string[]) => {
      return unstageFiles(worktreePath, paths);
    },
  );

  ipcMain.handle(
    "git:discard",
    async (
      _event,
      worktreePath: string,
      tracked: string[],
      untracked: string[],
    ) => {
      return discardFiles(worktreePath, tracked, untracked);
    },
  );

  ipcMain.handle(
    "git:commit",
    async (_event, worktreePath: string, message: string) => {
      return createCommit(worktreePath, message);
    },
  );

  ipcMain.handle("git:push", async (_event, worktreePath: string) => {
    return gitPush(worktreePath);
  });

  ipcMain.handle("git:pull", async (_event, worktreePath: string) => {
    return gitPull(worktreePath);
  });

  // ── New git handlers ──

  ipcMain.handle(
    "git:amend",
    async (_event, worktreePath: string, message: string) => {
      return amendCommit(worktreePath, message);
    },
  );

  ipcMain.handle("git:stash-list", async (_event, worktreePath: string) => {
    try {
      return await listStashes(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:stash-create",
    async (
      _event,
      worktreePath: string,
      message: string,
      includeUntracked: boolean,
    ) => {
      return createStash(worktreePath, message, includeUntracked);
    },
  );

  ipcMain.handle(
    "git:stash-apply",
    async (_event, worktreePath: string, index: number) => {
      return applyStash(worktreePath, index);
    },
  );

  ipcMain.handle(
    "git:stash-pop",
    async (_event, worktreePath: string, index: number) => {
      return popStash(worktreePath, index);
    },
  );

  ipcMain.handle(
    "git:stash-drop",
    async (_event, worktreePath: string, index: number) => {
      return dropStash(worktreePath, index);
    },
  );

  ipcMain.handle(
    "git:branch-create",
    async (_event, worktreePath: string, name: string, startPoint?: string) => {
      return createBranch(worktreePath, name, startPoint);
    },
  );

  ipcMain.handle(
    "git:branch-delete",
    async (_event, worktreePath: string, name: string, force: boolean) => {
      return deleteBranch(worktreePath, name, force);
    },
  );

  ipcMain.handle(
    "git:branch-rename",
    async (_event, worktreePath: string, oldName: string, newName: string) => {
      return renameBranch(worktreePath, oldName, newName);
    },
  );

  ipcMain.handle("git:tag-list", async (_event, worktreePath: string) => {
    try {
      return await listTags(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:tag-create",
    async (
      _event,
      worktreePath: string,
      name: string,
      ref: string,
      message?: string,
    ) => {
      return createTag(worktreePath, name, ref, message);
    },
  );

  ipcMain.handle(
    "git:tag-delete",
    async (_event, worktreePath: string, name: string) => {
      return deleteTag(worktreePath, name);
    },
  );

  ipcMain.handle("git:remote-list", async (_event, worktreePath: string) => {
    try {
      return await listRemotes(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:remote-add",
    async (_event, worktreePath: string, name: string, url: string) => {
      return addRemote(worktreePath, name, url);
    },
  );

  ipcMain.handle(
    "git:remote-remove",
    async (_event, worktreePath: string, name: string) => {
      return removeRemote(worktreePath, name);
    },
  );

  ipcMain.handle(
    "git:remote-rename",
    async (_event, worktreePath: string, oldName: string, newName: string) => {
      return renameRemote(worktreePath, oldName, newName);
    },
  );

  ipcMain.handle(
    "git:fetch",
    async (_event, worktreePath: string, remote?: string) => {
      return gitFetch(worktreePath, remote);
    },
  );

  ipcMain.handle(
    "git:merge",
    async (_event, worktreePath: string, ref: string) => {
      return gitMerge(worktreePath, ref);
    },
  );

  ipcMain.handle("git:merge-abort", async (_event, worktreePath: string) => {
    return gitMergeAbort(worktreePath);
  });

  ipcMain.handle(
    "git:rebase",
    async (_event, worktreePath: string, ref: string) => {
      return gitRebase(worktreePath, ref);
    },
  );

  ipcMain.handle("git:rebase-abort", async (_event, worktreePath: string) => {
    return gitRebaseAbort(worktreePath);
  });

  ipcMain.handle(
    "git:rebase-continue",
    async (_event, worktreePath: string) => {
      return gitRebaseContinue(worktreePath);
    },
  );

  ipcMain.handle(
    "git:cherry-pick",
    async (_event, worktreePath: string, hash: string) => {
      return gitCherryPick(worktreePath, hash);
    },
  );

  ipcMain.handle(
    "git:cherry-pick-abort",
    async (_event, worktreePath: string) => {
      return gitCherryPickAbort(worktreePath);
    },
  );

  ipcMain.handle("git:merge-state", async (_event, worktreePath: string) => {
    return getMergeState(worktreePath);
  });

  ipcMain.handle(
    "git:file-diff",
    async (_event, worktreePath: string, filePath: string, staged: boolean) => {
      return getFileDiff(worktreePath, filePath, staged);
    },
  );

  ipcMain.handle(
    "git:stage-hunk",
    async (
      _event,
      worktreePath: string,
      filePath: string,
      hunkHeader: string,
    ) => {
      return stageHunk(worktreePath, filePath, hunkHeader);
    },
  );

  ipcMain.handle(
    "git:unstage-hunk",
    async (
      _event,
      worktreePath: string,
      filePath: string,
      hunkHeader: string,
    ) => {
      return unstageHunk(worktreePath, filePath, hunkHeader);
    },
  );

  ipcMain.handle(
    "git:blame",
    async (_event, worktreePath: string, filePath: string) => {
      return getBlame(worktreePath, filePath);
    },
  );

  // ── Search handlers ──

  ipcMain.handle(
    "search:file-contents",
    async (_event, query: string, worktreePath?: string) => {
      try {
        return await searchFileContents(worktreePath ?? "", query);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle("search:session-contents", async (_event, query: string) => {
    try {
      return await searchSessionContents(query);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "search:sessions:list",
    async (_event, projectDirs: string[]): Promise<SessionSearchEntry[]> => {
      try {
        return await listSessionsForProjects(projectDirs ?? []);
      } catch (err) {
        // Surface to main-process logs rather than silently returning
        // an empty list — a bug in listSessionsForProjects used to
        // look exactly like "no history exists", which made the
        // `findKimiSessionFiles` missing-import regression in v0.31.0
        // almost impossible to track down.
        console.error("[search:sessions:list] failed", err);
        return [];
      }
    },
  );

  ipcMain.handle(
    "search:sessions:list-page",
    async (
      _event,
      projectDirs: string[],
      options: { limit: number; offset?: number },
    ): Promise<{ entries: SessionSearchEntry[]; total: number }> => {
      try {
        return await listSessionsForProjectsPaged(projectDirs ?? [], options);
      } catch (err) {
        console.error("[search:sessions:list-page] failed", err);
        return { entries: [], total: 0 };
      }
    },
  );

  ipcMain.handle(
    "session:watch",
    (_event, type: SessionType, sessionId: string, cwd: string) => {
      return sessionWatcher.watch(sessionId, type, cwd, () => {
        sendToWindow(mainWindow, "session:turn-complete", sessionId);
      });
    },
  );

  ipcMain.handle("session:unwatch", (_event, sessionId: string) => {
    sessionWatcher.unwatch(sessionId);
  });

  ipcMain.handle(
    "telemetry:attach-session",
    (
      _event,
      input: {
        terminalId: string;
        provider: "claude" | "codex" | "kimi" | "wuu" | "opencode" | "codebuddy";
        sessionId: string;
        cwd: string;
        confidence: "strong" | "medium" | "weak";
      },
    ) => {
      const sessionFile = resolveSessionFile(
        input.sessionId,
        input.provider,
        input.cwd,
      );
      telemetryService.attachSessionSource({
        terminalId: input.terminalId,
        provider: input.provider,
        sessionId: input.sessionId,
        confidence: input.confidence,
        sessionFile: sessionFile ?? undefined,
      });
      if (sessionFile) {
        invalidateSessionIndexForFile(sessionFile);
        emitSessionHistoryChanged({
          reason: "session_attached",
          projectDirs: [input.cwd],
        });
      }
      return {
        ok: sessionFile !== null,
        sessionFile,
      };
    },
  );

  ipcMain.handle("telemetry:detach-session", (_event, terminalId: string) => {
    const snapshot = telemetryService.getTerminalSnapshot(terminalId);
    telemetryService.detachSessionSource(terminalId);
    if (snapshot?.session_file) {
      invalidateSessionIndexForFile(snapshot.session_file);
    }
    emitSessionHistoryChanged({
      reason: "session_detached",
      projectDirs: snapshot?.worktree_path ? [snapshot.worktree_path] : [],
    });
  });

  ipcMain.handle(
    "telemetry:update-terminal",
    (
      _event,
      input: {
        terminalId: string;
        worktreePath?: string;
        provider?: "claude" | "codex" | "kimi" | "wuu" | "opencode" | "codebuddy" | "unknown";
        ptyId?: number | null;
        shellPid?: number | null;
      },
    ) => {
      return telemetryService.updateTerminal(input);
    },
  );

  ipcMain.handle("telemetry:get-terminal", (_event, terminalId: string) => {
    return telemetryService.getTerminalSnapshot(terminalId);
  });

  ipcMain.handle(
    "telemetry:get-workflow",
    (_event, workflowId: string, repoPath: string) => {
      return telemetryService.getWorkflowSnapshot(repoPath, workflowId);
    },
  );

  ipcMain.handle(
    "telemetry:list-events",
    (
      _event,
      input: {
        terminalId: string;
        limit?: number;
        cursor?: string;
      },
    ) => {
      return telemetryService.listTerminalEvents(input);
    },
  );

  ipcMain.handle(
    "diagnostics:record-render-event",
    (_event, input: RenderDiagnosticEventInput) => {
      renderDiagnostics.recordRendererEvent(input);
    },
  );

  ipcMain.handle("diagnostics:get-render-log-info", () => {
    return renderDiagnostics.getLogInfo();
  });

  ipcMain.handle("hook:get-socket-path", () => hookSocketPath);
  ipcMain.handle("hook:get-health", () => hookReceiver.getHealth());

  ipcMain.handle("sessions:load-replay", async (_event, filePath: string) => {
    return sessionScanner.loadReplay(filePath);
  });

  ipcMain.handle(
    "sessions:fork",
    async (
      _event,
      sourceFilePath: string,
      turnIndex: number,
      targetProvider?: "claude" | "codex",
    ) => {
      const { forkSession } = await import("./session-fork.js");
      return forkSession(sourceFilePath, turnIndex, targetProvider);
    },
  );

  ipcMain.handle("state:load", () => {
    return statePersistence.load();
  });

  ipcMain.handle("state:save", (_event, state: unknown) => {
    statePersistence.save(state);
  });

  ipcMain.handle("snapshots:list", () => {
    return snapshotHistory.list();
  });

  ipcMain.handle("snapshots:read", (_event, id: string) => {
    return snapshotHistory.read(id);
  });

  ipcMain.handle(
    "snapshots:append",
    (
      _event,
      args: {
        savedAt: number;
        terminalCount: number;
        projectCount: number;
        label?: string;
        body: unknown;
      },
    ) => {
      return snapshotHistory.append(args);
    },
  );

  ipcMain.handle("memory:scan", async (_event, worktreePath: string) => {
    const { getMemoryDirForWorktree, scanMemoryDir } =
      await import("./memory-service.js");
    const memDir = getMemoryDirForWorktree(worktreePath);
    return scanMemoryDir(memDir);
  });

  ipcMain.handle("memory:watch", async (_event, worktreePath: string) => {
    const { getMemoryDirForWorktree, watchMemoryDir, scanMemoryDir } =
      await import("./memory-service.js");
    const { generateEnhancedIndex, MemoryIndexCache } =
      await import("./memory-index-generator.js");
    const memDir = getMemoryDirForWorktree(worktreePath);
    const cache = new MemoryIndexCache(TERMCANVAS_DIR);

    const initialGraph = scanMemoryDir(memDir);
    cache.update(generateEnhancedIndex(initialGraph.nodes));

    watchMemoryDir(memDir, () => {
      try {
        const graph = scanMemoryDir(memDir);
        sendToWindow(mainWindow, "memory:changed", graph);
        cache.update(generateEnhancedIndex(graph.nodes));
      } catch {}
    });
  });

  ipcMain.handle("memory:unwatch", async (_event, worktreePath: string) => {
    const { getMemoryDirForWorktree, unwatchMemoryDir } =
      await import("./memory-service.js");
    const memDir = getMemoryDirForWorktree(worktreePath);
    unwatchMemoryDir(memDir);
  });

  ipcMain.handle("workspace:save", async (_event, data: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Workspace",
      defaultPath: "workspace.termcanvas",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = workspaceSavePaths.register(result.filePath);
    fs.writeFileSync(filePath, data, "utf-8");
    return filePath;
  });

  ipcMain.handle(
    "workspace:save-to-path",
    (_event, filePath: string, data: string) => {
      fs.writeFileSync(workspaceSavePaths.assertAllowed(filePath), data, "utf-8");
    },
  );

  ipcMain.handle("workspace:set-title", (_event, title: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title);
    }
  });

  ipcMain.handle("workspace:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Open Workspace",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return fs.readFileSync(result.filePaths[0], "utf-8");
  });

  const IMAGE_EXTS_FS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".bmp",
    ".ico",
    ".avif",
    ".apng",
  ]);
  const MIME_MAP_FS: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".apng": "image/apng",
  };
  // 512 KB is fine for text files but tiny for images — a typical
  // screenshot is 1-2 MB and GIFs easily hit 5-10 MB. Use a separate
  // larger cap for images so clicking an image in the file tree
  // isn't silently blocked most of the time.
  const MAX_FILE_SIZE = 512 * 1024;
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

  ipcMain.handle("fs:list-dir", (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !HIDDEN_DIRS.has(e.name))
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return filtered;
    } catch {
      return [];
    }
  });

  ipcMain.handle("fs:read-file", (_event, filePath: string) => {
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const isImage = IMAGE_EXTS_FS.has(ext);
      // Image files get a 10-MB ceiling since a 5-MB GIF or
      // 2-MB screenshot is perfectly normal and rejecting those
      // just makes the editor look broken. Text keeps the tight
      // 512-KB cap.
      const ceiling = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
      if (stat.size > ceiling) {
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        return { error: "too-large", size: `${sizeMB} MB` };
      }

      if (isImage) {
        const buf = fs.readFileSync(filePath);
        const mime = MIME_MAP_FS[ext] ?? "image/png";
        return {
          type: "image",
          content: `data:${mime};base64,${buf.toString("base64")}`,
        };
      }

      const fd = fs.openSync(filePath, "r");
      const probe = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, probe, 0, 8192, 0);
      fs.closeSync(fd);
      if (probe.subarray(0, bytesRead).includes(0)) {
        return { type: "binary" };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const type = ext === ".md" ? "markdown" : "text";
      return { type, content };
    } catch {
      return { error: "read-error" };
    }
  });

  ipcMain.handle(
    "fs:write-file",
    (_event, filePath: string, content: string) => {
      try {
        const existing = fs.readFileSync(filePath, "utf-8");
        if (existing === content) return { changed: false };
      } catch {}
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return { changed: true };
    },
  );

  ipcMain.handle(
    "fs:copy",
    async (_event, sources: string[], destDir: string) => {
      const { copyFiles } = await import("./fs-copy.js");
      return copyFiles(sources, destDir);
    },
  );

  ipcMain.handle("fs:rename", (_event, oldPath: string, newName: string) => {
    const basename = path.basename(newName);
    if (basename !== newName || !newName) throw new Error("Invalid name");
    const newPath = path.join(path.dirname(oldPath), newName);
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle("fs:move", (_event, oldPath: string, newPath: string) => {
    if (!oldPath || !newPath) throw new Error("Invalid path");
    if (fs.existsSync(newPath)) throw new Error("Destination already exists");
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle("fs:delete", (_event, targetPath: string) => {
    fs.rmSync(targetPath, { recursive: true, force: true });
  });

  ipcMain.handle("fs:mkdir", (_event, dirPath: string, name: string) => {
    const basename = path.basename(name);
    if (basename !== name || !name) throw new Error("Invalid name");
    fs.mkdirSync(path.join(dirPath, name), { recursive: true });
  });

  ipcMain.handle("fs:create-file", (_event, dirPath: string, name: string) => {
    const basename = path.basename(name);
    if (basename !== name || !name) throw new Error("Invalid name");
    const filePath = path.join(dirPath, name);
    if (fs.existsSync(filePath)) throw new Error("File already exists");
    fs.writeFileSync(filePath, "", "utf-8");
  });

  ipcMain.handle("fs:reveal", (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle("fs:watch-dir", (_event, dirPath: string) => {
    fileTreeWatcher.watch(dirPath);
  });
  ipcMain.handle("fs:unwatch-dir", (_event, dirPath: string) => {
    fileTreeWatcher.unwatch(dirPath);
  });
  ipcMain.handle("fs:unwatch-all-dirs", () => {
    fileTreeWatcher.unwatchAll();
  });

  // ─── Diagnosis Skills (vendor) ────────────────────────────────────────────
  const DIAGNOSIS_CATEGORIES = [
    "diseno-patrones",
    "organizacion",
    "documentacion",
    "seguridad",
    "proteccion",
    "rendimiento",
    "buenas-practicas",
    "requerimientos",
  ] as const;
  const getSharedSkillsRoot = () => path.join(__dirname, "..", "resources", "diagnosis-skills");
  const getPrivateSkillsRoot = () => path.join(app.getPath("userData"), "diagnosis-skills");

  const parseSkillNameFromContent = (content: string, fallback: string): string => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const kv = /^\s*name:\s*(.*)$/.exec(line);
        if (kv) return kv[1].trim() || fallback;
      }
    }
    return fallback;
  };

  ipcMain.handle("skills:get-roots", () => {
    return { sharedRoot: getSharedSkillsRoot(), privateRoot: getPrivateSkillsRoot() };
  });

  ipcMain.handle("skills:list", async () => {
    const sharedRoot = getSharedSkillsRoot();
    const privateRoot = getPrivateSkillsRoot();
    const out: Array<{ categoryId: string; skills: Array<{ name: string; description: string; shared: boolean; dirPath: string }> }> = [];
    for (const cat of DIAGNOSIS_CATEGORIES) {
      const catSkills: Array<{ name: string; description: string; shared: boolean; dirPath: string }> = [];
      const seen = new Set<string>();
      for (const [root, shared] of [[sharedRoot, true], [privateRoot, false]] as const) {
        const base = path.join(root, cat);
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(base, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name === ".gitkeep") continue;
          const skillDir = path.join(base, e.name);
          const skillMd = path.join(skillDir, "SKILL.md");
          if (!fs.existsSync(skillMd)) continue;
          let content = "";
          try {
            content = fs.readFileSync(skillMd, "utf-8");
          } catch {
            continue;
          }
          const name = parseSkillNameFromContent(content, e.name);
          if (seen.has(name) || seen.has(e.name)) continue;
          // simple description extract
          let description = "";
          const dm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
          if (dm) {
            for (const line of dm[1].split(/\r?\n/)) {
              const kv = /^\s*description:\s*(.*)$/.exec(line);
              if (kv) { description = kv[1].trim(); break; }
            }
          }
          if (!description) description = "Skill provista por el usuario";
          seen.add(name);
          seen.add(e.name);
          catSkills.push({ name, description: description.slice(0, 200), shared, dirPath: skillDir });
        }
      }
      catSkills.sort((a, b) => a.name.localeCompare(b.name));
      out.push({ categoryId: cat, skills: catSkills });
    }
    return out;
  });

  ipcMain.handle("skills:remove", async (_event, categoryId: string, skillName: string) => {
    const roots = [getSharedSkillsRoot(), getPrivateSkillsRoot()];
    for (const root of roots) {
      const candidates = [path.join(root, categoryId, skillName), path.join(root, categoryId)];
      // also need to handle folder name vs skill name mismatch: scan
      const base = path.join(root, categoryId);
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(base, { withFileTypes: true });
      } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name === ".gitkeep") continue;
        const p = path.join(base, e.name, "SKILL.md");
        if (!fs.existsSync(p)) continue;
        let content = "";
        try { content = fs.readFileSync(p, "utf-8"); } catch { continue; }
        const resolved = parseSkillNameFromContent(content, e.name);
        if (resolved === skillName || e.name === skillName) {
          fs.rmSync(path.join(base, e.name), { recursive: true, force: true });
          return { ok: true };
        }
      }
    }
    return { ok: false, error: "Skill no encontrada" };
  });

  ipcMain.handle("skills:toggle-share", async (_event, categoryId: string, skillName: string) => {
    const sharedRoot = getSharedSkillsRoot();
    const privateRoot = getPrivateSkillsRoot();
    let found: { root: string; folder: string; shared: boolean } | null = null;
    for (const [root, shared] of [[sharedRoot, true], [privateRoot, false]] as const) {
      const base = path.join(root, categoryId);
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name === ".gitkeep") continue;
        const p = path.join(base, e.name, "SKILL.md");
        if (!fs.existsSync(p)) continue;
        let content = "";
        try { content = fs.readFileSync(p, "utf-8"); } catch { continue; }
        const resolved = parseSkillNameFromContent(content, e.name);
        if (resolved === skillName || e.name === skillName) {
          found = { root, folder: e.name, shared };
          break;
        }
      }
      if (found) break;
    }
    if (!found) return { ok: false, error: "Skill no encontrada" };
    const srcBase = path.join(found.root, categoryId, found.folder);
    const destRoot = found.shared ? privateRoot : sharedRoot;
    const destBase = path.join(destRoot, categoryId, found.folder);
    try {
      fs.mkdirSync(path.join(destRoot, categoryId), { recursive: true });
      if (fs.existsSync(destBase)) return { ok: false, error: "Ya existe una skill con ese nombre en el destino" };
      fs.cpSync(srcBase, destBase, { recursive: true });
      fs.rmSync(srcBase, { recursive: true, force: true });
      return { ok: true, shared: !found.shared };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("skills:save-from-content", async (_event, categoryId: string, skillName: string, content: string, shared: boolean) => {
    if (!DIAGNOSIS_CATEGORIES.includes(categoryId as never)) return { ok: false, error: "Categoría inválida" };
    const slugOk = /^[a-z][a-z0-9-]*$/.test(skillName);
    if (!slugOk) return { ok: false, error: "Nombre debe ser slug [a-z0-9-]" };
    if (skillName.startsWith("diag-")) return { ok: false, error: "Prefijo diag- reservado" };
    if (!content.trim()) return { ok: false, error: "Contenido vacío" };
    const root = shared ? getSharedSkillsRoot() : getPrivateSkillsRoot();
    const dest = path.join(root, categoryId, skillName);
    try {
      fs.mkdirSync(path.join(root, categoryId), { recursive: true });
      if (fs.existsSync(dest)) return { ok: false, error: "Ya existe una skill con ese nombre en esa categoría" };
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "SKILL.md"), content, "utf-8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("skills:save-from-file", async (_event, categoryId: string, filePath: string, shared: boolean) => {
    if (!DIAGNOSIS_CATEGORIES.includes(categoryId as never)) return { ok: false, error: "Categoría inválida" };
    let content = "";
    try { content = fs.readFileSync(filePath, "utf-8"); } catch (e) { return { ok: false, error: String(e) }; }
    const parsedName = parseSkillNameFromContent(content, path.basename(path.dirname(filePath)) || "skill");
    // fallback to file's folder name or spec
    let skillName = parsedName;
    if (!/^[a-z][a-z0-9-]*$/.test(skillName) || skillName.startsWith("diag-")) {
      skillName = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (!skillName || skillName.startsWith("diag-")) skillName = `skill-${Date.now()}`;
    }
    const root = shared ? getSharedSkillsRoot() : getPrivateSkillsRoot();
    const dest = path.join(root, categoryId, skillName);
    try {
      fs.mkdirSync(path.join(root, categoryId), { recursive: true });
      if (fs.existsSync(dest)) return { ok: false, error: `Ya existe ${skillName} en ${categoryId}` };
      fs.mkdirSync(dest, { recursive: true });
      // if filePath is already a SKILL.md inside a folder, copy whole folder; else just write file
      const srcDir = path.dirname(filePath);
      const srcSkillMd = path.join(srcDir, "SKILL.md");
      if (fs.existsSync(srcSkillMd) && path.basename(filePath) === "SKILL.md") {
        fs.cpSync(srcDir, dest, { recursive: true });
      } else {
        fs.writeFileSync(path.join(dest, "SKILL.md"), content, "utf-8");
      }
      return { ok: true, skillName };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("skills:fetch-by-spec", async (_event, spec: string, categoryId: string, shared: boolean) => {
    const trimmed = String(spec).trim();
    if (!trimmed) return { ok: false, error: "Spec vacío" };
    if (!DIAGNOSIS_CATEGORIES.includes(categoryId as never)) return { ok: false, error: "Categoría inválida" };
    // Supports:
    // - npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
    // - https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
    // - vercel-labs/agent-skills@vercel-react-best-practices
    // - owner/repo@skill
    let ownerRepo = trimmed;
    let skillPart: string | null = null;
    const skillFlagMatch = trimmed.match(/--skill\s+([^\s"'`]+)/) || trimmed.match(/--skill=([^\s"'`]+)/);
    const urlMatch = trimmed.match(/https:\/\/github\.com\/[^\s"'`]+/);
    if (skillFlagMatch) {
      skillPart = skillFlagMatch[1].replace(/['"`]/g, "");
      if (urlMatch) {
        ownerRepo = urlMatch[0];
      } else {
        const addMatch = trimmed.match(/skills\s+add\s+([^\s"'`]+)/);
        if (addMatch) ownerRepo = addMatch[1];
        else {
          // fallback: first token that looks like owner/repo
          const repoMatch = trimmed.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
          if (repoMatch) ownerRepo = repoMatch[1];
        }
      }
    } else if (urlMatch) {
      ownerRepo = urlMatch[0];
      // check for @skill after url e.g. https://github.com/o/r@skill
      const afterUrl = trimmed.slice((urlMatch.index ?? 0) + urlMatch[0].length);
      const atAfter = afterUrl.match(/@([^\s"'`]+)/);
      if (atAfter) skillPart = atAfter[1];
    } else if (trimmed.includes("@")) {
      const idx = trimmed.lastIndexOf("@");
      ownerRepo = trimmed.slice(0, idx);
      skillPart = trimmed.slice(idx + 1);
    }
    ownerRepo = ownerRepo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").split(/\s+/)[0] ?? ownerRepo;
    const candidates: string[] = [];
    const skillVariants = new Set<string>();
    if (skillPart) {
      skillVariants.add(skillPart);
      // vercel-labs/agent-skills stores skill as react-best-practices on disk but advertises as vercel-react-best-practices
      if (skillPart.startsWith("vercel-")) skillVariants.add(skillPart.slice(7));
      else skillVariants.add(`vercel-${skillPart}`);
    }
    if (skillPart) {
      for (const variant of skillVariants) {
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/skills/${variant}/SKILL.md`);
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/skills/${variant}/SKILL.md`);
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/${variant}/SKILL.md`);
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/${variant}/SKILL.md`);
        // nested category folders like claude-dev-suite/skills/best-practices/solid-principles
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/skills/best-practices/${variant}/SKILL.md`);
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/skills/best-practices/${variant}/SKILL.md`);
      }
      candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/SKILL.md`);
      candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/SKILL.md`);
    } else {
      candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/SKILL.md`);
      candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/SKILL.md`);
    }
    const fetchWithTimeout = (url: string, ms = 10000) => new Promise<Buffer>((resolve, reject) => {
      const req = https.get(url, { headers: { "User-Agent": "termcanvas-skills" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchWithTimeout(res.headers.location as string, ms).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      });
      req.setTimeout(ms, () => { req.destroy(new Error("timeout")); });
      req.on("error", reject);
    });
    let content: string | null = null;
    let lastErr = "";
    for (const url of candidates) {
      try {
        const buf = await fetchWithTimeout(url);
        const text = buf.toString("utf-8");
        if (text.includes("---") && text.length > 50) { content = text; break; }
      } catch (e) { lastErr = String(e); }
    }
    // Fallback: try npx skills add to temp and copy (handles nested paths like best-practices/solid-principles)
    if (!content) {
      try {
        const { execFile } = await import("child_process");
        const tmp = path.join(os.tmpdir(), `termcanvas-skill-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        const targetSpec = skillPart ? `${ownerRepo}@${skillPart}` : ownerRepo;
        const isWin = process.platform === "win32";
        await new Promise<void>((resolve, reject) => {
          const child = execFile(isWin ? "npx.cmd" : "npx", ["-y", "skills", "add", targetSpec, "-y", "--copy"], { cwd: tmp, timeout: 60000, shell: isWin, windowsHide: true } as never, (err: Error | null) => err ? reject(err) : resolve());
          child.on?.("error", reject);
        });
        const findSkillMd = (root: string): string | null => {
          const stack = [root];
          while (stack.length) {
            const dir = stack.pop()!;
            let entries: fs.Dirent[] = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
            for (const e of entries) {
              const p = path.join(dir, e.name);
              if (e.isDirectory()) stack.push(p);
              else if (e.isFile() && e.name === "SKILL.md") {
                try {
                  const c = fs.readFileSync(p, "utf-8");
                  // match by skillPart in frontmatter or folder name
                  if (skillPart && (c.includes(`name: ${skillPart}`) || p.toLowerCase().includes(skillPart.toLowerCase()))) return p;
                  if (!skillPart) return p;
                } catch {}
              }
            }
          }
          return null;
        };
        const probeRoots = [tmp, path.join(os.homedir(), ".agents", "skills"), path.join(os.homedir(), ".config", "opencode", "skills")];
        for (const pr of probeRoots) {
          const found = findSkillMd(pr);
          if (found && fs.existsSync(found)) { content = fs.readFileSync(found, "utf-8"); break; }
          // also try direct paths as fallback
          const tryPaths = skillPart ? [path.join(pr, skillPart, "SKILL.md"), path.join(pr, skillPart.toLowerCase(), "SKILL.md"), path.join(pr, "best-practices", skillPart, "SKILL.md")] : [];
          for (const tp of tryPaths) {
            if (fs.existsSync(tp)) { content = fs.readFileSync(tp, "utf-8"); break; }
          }
          if (content) break;
        }
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch (e) { lastErr = String(e); }
    }
    if (!content) return { ok: false, error: `No se pudo descargar la skill (probé ${candidates.length} URLs). Último error: ${lastErr}` };
    let folderName = skillPart || ownerRepo.split("/").pop() || `skill-${Date.now()}`;
    folderName = folderName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    if (!folderName || !/^[a-z][a-z0-9-]*$/.test(folderName) || folderName.startsWith("diag-")) folderName = `skill-${Date.now()}`;
    const root = shared ? getSharedSkillsRoot() : getPrivateSkillsRoot();
    const dest = path.join(root, categoryId, folderName);
    try {
      fs.mkdirSync(path.join(root, categoryId), { recursive: true });
      if (fs.existsSync(dest)) return { ok: false, error: `Ya existe ${folderName} en ${categoryId}` };
      fs.mkdirSync(dest, { recursive: true });
      // ensure frontmatter has correct name if needed
      fs.writeFileSync(path.join(dest, "SKILL.md"), content, "utf-8");
      return { ok: true, skillName: folderName };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // ─── Diagnosis Skills — per-project (valija por repo) ───────────────────────
  ipcMain.handle("skills:listForProject", async (_event, repoPath: string) => {
    const clean = repoPath.replace(/[\\/]+$/, "");
    const primaryRoot = path.join(clean, ".agents", "diagnosis-skills");
    const legacyRoot = path.join(clean, "resources", "diagnosis-skills");
    const out: Array<{ categoryId: string; skills: Array<{ name: string; description: string; shared: boolean; dirPath: string }> }> = [];
    for (const cat of DIAGNOSIS_CATEGORIES) {
      const bases = [path.join(primaryRoot, cat), path.join(legacyRoot, cat)];
      const seen = new Set<string>();
      const catSkills: Array<{ name: string; description: string; shared: boolean; dirPath: string }> = [];
      for (const base of bases) {
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (!e.isDirectory() || e.name === ".gitkeep") continue;
          if (seen.has(e.name)) continue;
          const p = path.join(base, e.name, "SKILL.md");
          if (!fs.existsSync(p)) continue;
          let content = "";
          try { content = fs.readFileSync(p, "utf-8"); } catch { continue; }
          const name = parseSkillNameFromContent(content, e.name);
          if (seen.has(name)) continue;
          let description = "";
          const dm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
          if (dm) { for (const line of dm[1].split(/\r?\n/)) { const kv = /^\s*description:\s*(.*)$/.exec(line); if (kv) { description = kv[1].trim(); break; } } }
          if (!description) description = "Skill del proyecto";
          seen.add(e.name);
          seen.add(name);
          catSkills.push({ name, description: description.slice(0, 200), shared: true, dirPath: path.join(base, e.name) });
        }
      }
      catSkills.sort((a, b) => a.name.localeCompare(b.name));
      out.push({ categoryId: cat, skills: catSkills });
    }
    return out;
  });

  ipcMain.handle("skills:saveFromContentForProject", async (_event, repoPath: string, categoryId: string, skillName: string, content: string) => {
    if (!DIAGNOSIS_CATEGORIES.includes(categoryId as never)) return { ok: false, error: "Categoría inválida" };
    if (!/^[a-z][a-z0-9-]*$/.test(skillName) || skillName.startsWith("diag-")) return { ok: false, error: "Nombre inválido" };
    if (!content.trim()) return { ok: false, error: "Contenido vacío" };
    const dest = path.join(repoPath.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills", categoryId, skillName);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) return { ok: false, error: "Ya existe" };
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "SKILL.md"), content, "utf-8");
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  ipcMain.handle("skills:saveFromFileForProject", async (_event, repoPath: string, categoryId: string, filePath: string) => {
    if (!DIAGNOSIS_CATEGORIES.includes(categoryId as never)) return { ok: false, error: "Categoría inválida" };
    let content = "";
    try { content = fs.readFileSync(filePath, "utf-8"); } catch (e) { return { ok: false, error: String(e) }; }
    let skillName = parseSkillNameFromContent(content, path.basename(path.dirname(filePath)) || "skill");
    if (!/^[a-z][a-z0-9-]*$/.test(skillName) || skillName.startsWith("diag-")) {
      skillName = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (!skillName || skillName.startsWith("diag-")) skillName = `skill-${Date.now()}`;
    }
    const dest = path.join(repoPath.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills", categoryId, skillName);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) return { ok: false, error: `Ya existe ${skillName}` };
      fs.mkdirSync(dest, { recursive: true });
      const srcDir = path.dirname(filePath);
      if (fs.existsSync(path.join(srcDir, "SKILL.md")) && path.basename(filePath) === "SKILL.md") fs.cpSync(srcDir, dest, { recursive: true });
      else fs.writeFileSync(path.join(dest, "SKILL.md"), content, "utf-8");
      return { ok: true, skillName };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  ipcMain.handle("skills:fetchBySpecForProject", async (_event, spec: string, repoPath: string, categoryId: string) => {
    // Reuse the same fetch logic as skills:fetch-by-spec but save to repoPath
    const res = await (async () => {
      // Call the existing handler logic by invoking via internal function
      // For now, delegate to the same URL candidates and npx fallback, then save to repo
      const trimmed = String(spec).trim();
      if (!trimmed) return { ok: false as const, error: "Spec vacío" };
      if (!DIAGNOSIS_CATEGORIES.includes(categoryId as never)) return { ok: false as const, error: "Categoría inválida" };
      let ownerRepo = trimmed;
      let skillPart: string | null = null;
      const skillFlagMatch = trimmed.match(/--skill\s+([^\s"'`]+)/) || trimmed.match(/--skill=([^\s"'`]+)/);
      const urlMatch = trimmed.match(/https:\/\/github\.com\/[^\s"'`]+/);
      if (skillFlagMatch) {
        skillPart = skillFlagMatch[1].replace(/['"`]/g, "");
        if (urlMatch) ownerRepo = urlMatch[0];
        else {
          const addMatch = trimmed.match(/skills\s+add\s+([^\s"'`]+)/);
          if (addMatch) ownerRepo = addMatch[1];
          else { const m = trimmed.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/); if (m) ownerRepo = m[1]; }
        }
      } else if (urlMatch) {
        ownerRepo = urlMatch[0];
        const after = trimmed.slice((urlMatch.index ?? 0) + urlMatch[0].length);
        const at = after.match(/@([^\s"'`]+)/);
        if (at) skillPart = at[1];
      } else if (trimmed.includes("@")) {
        const idx = trimmed.lastIndexOf("@");
        ownerRepo = trimmed.slice(0, idx);
        skillPart = trimmed.slice(idx + 1);
      }
      ownerRepo = ownerRepo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").split(/\s+/)[0] ?? ownerRepo;
      const candidates: string[] = [];
      const variants = new Set<string>();
      if (skillPart) {
        variants.add(skillPart);
        if (skillPart.startsWith("vercel-")) variants.add(skillPart.slice(7));
        else variants.add(`vercel-${skillPart}`);
      }
      if (skillPart) {
        for (const v of variants) {
          candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/skills/${v}/SKILL.md`);
          candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/skills/${v}/SKILL.md`);
          candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/${v}/SKILL.md`);
          candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/${v}/SKILL.md`);
          candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/skills/best-practices/${v}/SKILL.md`);
          candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/skills/best-practices/${v}/SKILL.md`);
        }
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/SKILL.md`);
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/SKILL.md`);
      } else {
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/main/SKILL.md`);
        candidates.push(`https://raw.githubusercontent.com/${ownerRepo}/master/SKILL.md`);
      }
      const fetchWithTimeout = (url: string, ms = 10000) => new Promise<Buffer>((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "termcanvas-skills" } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { fetchWithTimeout(res.headers.location as string, ms).then(resolve, reject); return; }
          if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.setTimeout(ms, () => { req.destroy(new Error("timeout")); });
        req.on("error", reject);
      });
      let content: string | null = null;
      let lastErr = "";
      for (const url of candidates) {
        try {
          const buf = await fetchWithTimeout(url);
          const text = buf.toString("utf-8");
          if (text.includes("---") && text.length > 50) { content = text; break; }
        } catch (e) { lastErr = String(e); }
      }
      if (!content) {
        try {
          const { execFile } = await import("child_process");
          const tmp = path.join(os.tmpdir(), `termcanvas-skill-${Date.now()}`);
          fs.mkdirSync(tmp, { recursive: true });
          const targetSpec = skillPart ? `${ownerRepo}@${skillPart}` : ownerRepo;
          const isWin = process.platform === "win32";
          await new Promise<void>((resolve, reject) => {
            const child = execFile(isWin ? "npx.cmd" : "npx", ["-y", "skills", "add", targetSpec, "-y", "--copy"], { cwd: tmp, timeout: 60000, shell: isWin, windowsHide: true } as never, (err: Error | null) => err ? reject(err) : resolve());
            child.on?.("error", reject);
          });
          const findSkillMd = (root: string): string | null => {
            const stack = [root];
            while (stack.length) {
              const dir = stack.pop()!;
              let entries: fs.Dirent[] = [];
              try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
              for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (e.isFile() && e.name === "SKILL.md") {
                  try {
                    const c = fs.readFileSync(p, "utf-8");
                    if (skillPart && (c.includes(`name: ${skillPart}`) || p.toLowerCase().includes(skillPart.toLowerCase()))) return p;
                    if (!skillPart) return p;
                  } catch {}
                }
              }
            }
            return null;
          };
          const probeRoots = [tmp, path.join(os.homedir(), ".agents", "skills"), path.join(os.homedir(), ".config", "opencode", "skills")];
          for (const pr of probeRoots) {
            const found = findSkillMd(pr);
            if (found && fs.existsSync(found)) { content = fs.readFileSync(found, "utf-8"); break; }
            const tryPaths = skillPart ? [path.join(pr, skillPart, "SKILL.md"), path.join(pr, skillPart.toLowerCase(), "SKILL.md"), path.join(pr, "best-practices", skillPart, "SKILL.md")] : [];
            for (const tp of tryPaths) if (fs.existsSync(tp)) { content = fs.readFileSync(tp, "utf-8"); break; }
            if (content) break;
          }
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch (e) { lastErr = String(e); }
      }
      if (!content) return { ok: false as const, error: `No se pudo descargar (probé ${candidates.length} URLs). Último error: ${lastErr}` };
      let folderName = skillPart || ownerRepo.split("/").pop() || `skill-${Date.now()}`;
      folderName = folderName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
      if (!folderName || !/^[a-z][a-z0-9-]*$/.test(folderName) || folderName.startsWith("diag-")) folderName = `skill-${Date.now()}`;
      const dest = path.join(repoPath.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills", categoryId, folderName);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest)) return { ok: false as const, error: `Ya existe ${folderName} en ${categoryId}` };
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "SKILL.md"), content, "utf-8");
        return { ok: true as const, skillName: folderName };
      } catch (e) { return { ok: false as const, error: String(e) }; }
    })();
    return res;
  });

  ipcMain.handle("skills:removeForProject", async (_event, repoPath: string, categoryId: string, skillName: string) => {
    const candidates = [
      path.join(repoPath.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills", categoryId),
      path.join(repoPath.replace(/[\\/]+$/, ""), "resources", "diagnosis-skills", categoryId),
    ];
    for (const base of candidates) {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name === ".gitkeep") continue;
        const p = path.join(base, e.name, "SKILL.md");
        if (!fs.existsSync(p)) continue;
        let content = "";
        try { content = fs.readFileSync(p, "utf-8"); } catch { continue; }
        const resolved = parseSkillNameFromContent(content, e.name);
        if (resolved === skillName || e.name === skillName) {
          fs.rmSync(path.join(base, e.name), { recursive: true, force: true });
          return { ok: true };
        }
      }
    }
    return { ok: false, error: "Skill no encontrada" };
  });

  ipcMain.handle("skills:copyAll", async (_event, fromRepo: string, toRepo: string) => {
    const resolveRoot = (rp: string, preferAgents: boolean) => {
      const agents = path.join(rp.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills");
      const legacy = path.join(rp.replace(/[\\/]+$/, ""), "resources", "diagnosis-skills");
      if (preferAgents) return fs.existsSync(agents) ? agents : legacy;
      return fs.existsSync(legacy) ? legacy : agents;
    };
    const fromRoot = (() => {
      const a = path.join(fromRepo.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills");
      const l = path.join(fromRepo.replace(/[\\/]+$/, ""), "resources", "diagnosis-skills");
      if (fs.existsSync(a)) return a;
      if (fs.existsSync(l)) return l;
      return a;
    })();
    const toRoot = path.join(toRepo.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills");
    if (!fs.existsSync(fromRoot)) return { ok: false, error: "Origen sin skills" };
    let copied = 0;
    for (const cat of DIAGNOSIS_CATEGORIES) {
      const srcCat = path.join(fromRoot, cat);
      const dstCat = path.join(toRoot, cat);
      if (!fs.existsSync(srcCat)) continue;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(srcCat, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name === ".gitkeep") continue;
        const src = path.join(srcCat, e.name);
        const dst = path.join(dstCat, e.name);
        if (fs.existsSync(dst)) continue;
        try {
          fs.mkdirSync(dstCat, { recursive: true });
          fs.cpSync(src, dst, { recursive: true });
          copied++;
        } catch {}
      }
    }
    return { ok: true, copied };
  });

  ipcMain.handle("skills:setShareAll", async (_event, repoPath: string, shared: boolean) => {
    // Por ahora es un flag en .agents/diagnosis-skills.json — no mueve archivos.
    // Si shared=false, el repo no commitea resources/diagnosis-skills (se espera .gitignore).
    // Mantenemos compatibilidad: solo persistimos la preferencia.
    try {
      const cfgPath = path.join(repoPath.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills.json");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify({ shared, updatedAt: Date.now() }, null, 2), "utf-8");
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  });

  ipcMain.handle("skills:getShareAll", async (_event, repoPath: string) => {
    try {
      const cfgPath = path.join(repoPath.replace(/[\\/]+$/, ""), ".agents", "diagnosis-skills.json");
      if (!fs.existsSync(cfgPath)) return { shared: true };
      const raw = fs.readFileSync(cfgPath, "utf-8");
      const j = JSON.parse(raw);
      return { shared: j.shared !== false };
    } catch { return { shared: true }; }
  });

  ipcMain.handle("dialog:open-skill-file", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (res.canceled || res.filePaths.length === 0) return { canceled: true as const };
    return { canceled: false as const, filePath: res.filePaths[0] };
  });

  ipcMain.handle("fs:list-all-files", async (_event, dirPath: string) => {
    const { execFile } = await import("child_process");
    let trackedOutput: string;
    try {
      // Tracked + non-ignored untracked. Small (~1k paths in typical repos)
      // so the tree can paint immediately. Ignored files are fetched
      // separately via fs:list-ignored-files and streamed into the tree by
      // the renderer's chunked batch-add so the UI stays responsive on
      // huge node_modules trees.
      trackedOutput = await new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
          { cwd: dirPath, timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
      });
    } catch {
      // Non-git repo: walk the directory tree recursively
      const paths: string[] = [];
      const visited = new Set<string>();
      // Returns number of file entries added from this subtree. When a
      // directory subtree is entirely empty, emit the directory itself with a
      // trailing "/" so @pierre/trees can still display it.
      const collect = (dir: string, prefix: string): number => {
        let added = 0;
        try {
          const realDir = fs.realpathSync(dir);
          if (visited.has(realDir)) return 0;
          visited.add(realDir);
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (HIDDEN_DIRS.has(entry.name)) continue;
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              added += collect(path.join(dir, entry.name), relPath);
            } else {
              paths.push(relPath);
              added++;
            }
          }
          if (added === 0 && prefix) paths.push(`${prefix}/`);
        } catch (err) {
          console.error(`[fs:list-all-files] failed to read ${dir}:`, err);
        }
        return added;
      };
      collect(dirPath, "");
      return { type: "dir" as const, paths };
    }

    return {
      type: "git" as const,
      paths: parseNulSeparatedGitPaths(trackedOutput),
    };
  });

  ipcMain.handle("fs:list-ignored-files", async (_event, dirPath: string) => {
    const { execFile } = await import("child_process");
    const runGit = (args: string[]) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          args,
          { cwd: dirPath, timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
          (err, out) => (err ? reject(err) : resolve(out)),
        );
      });
    try {
      const [filesOutput, dirsOutput] = await Promise.all([
        runGit(["ls-files", "-z", "--others", "--ignored", "--exclude-standard"]),
        runGit([
          "ls-files",
          "-z",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--directory",
        ]),
      ]);
      return [
        ...new Set([
          ...parseNulSeparatedGitPaths(dirsOutput),
          ...parseNulSeparatedGitPaths(filesOutput),
        ]),
      ];
    } catch (err) {
      console.warn(`[fs:list-ignored-files] failed:`, err);
      return [] as string[];
    }
  });

  ipcMain.handle("cli:is-registered", () => isCliRegistered(getCliDir()));
  ipcMain.handle("cli:register", () => {
    const cliOk = registerCli(getCliDir());
    if (!cliOk) {
      return { ok: false, skillInstalled: false };
    }
    writeCliIntegrationState({ autoRegister: true });
    const skillInstalled = installSkill();
    return { ok: true, skillInstalled };
  });
  ipcMain.handle("cli:unregister", () => {
    const ok = unregisterCli(getCliDir());
    if (ok) {
      writeCliIntegrationState({ autoRegister: false });
    }
    return ok;
  });

  ipcMain.handle(
    "cli:validate-command",
    async (_event, command: string, _args?: string[]) => {
      try {
        const spec = await buildLaunchSpec({
          cwd: process.cwd(),
          shell: command,
          extraPathEntries: [getCliDir()],
        });
        const { execFile } = await import("child_process");
        const version = await new Promise<string | null>((resolve) => {
          execFile(
            spec.file,
            ["--version"],
            { timeout: 5000, env: spec.env },
            (err, stdout) => {
              if (err) {
                resolve(null);
                return;
              }
              const line = stdout.toString().trim().split("\n")[0];
              resolve(line || null);
            },
          );
        });
        return { ok: true as const, resolvedPath: spec.file, version };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "composer:submit",
    async (_event, request: ComposerSubmitRequest) => {
      if (!ptyManager.getPid(request.ptyId)) {
        return {
          ok: false,
          code: "target-not-running",
          stage: "target",
          error: "Target terminal is not running.",
        };
      }

      try {
        const result = await submitComposerRequest(
          request,
          createDefaultComposerSubmitDeps(
            process.platform as "darwin" | "win32" | "linux",
            dataUrlToPngBuffer,
            (ptyId: number, data: string) => {
              ptyManager.write(ptyId, data);
            },
          ),
        );

        if (!result.ok) {
          console.error("[Composer] Submit failed:", {
            terminalId: request.terminalId,
            ptyId: request.ptyId,
            terminalType: request.terminalType,
            stage: result.stage,
            code: result.code,
            detail: result.detail ?? result.error,
            requestId: result.requestId,
          });
        }

        return result;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[Composer] Submit crashed:", {
          terminalId: request.terminalId,
          ptyId: request.ptyId,
          terminalType: request.terminalType,
          detail,
        });
        return {
          ok: false,
          code: "internal-error",
          stage: "submit",
          error: detail,
          detail,
        };
      }
    },
  );

  ipcMain.handle("usage:query", async (_event, dateStr: string) => {
    const startedAt = Date.now();
    const result = await collectUsage(dateStr);
    perfLog("usage:query", {
      dateStr,
      ms: Date.now() - startedAt,
      sessions: result.sessions,
      totalCost: result.totalCost,
    });
    return result;
  });

  ipcMain.handle(
    "usage:query-range",
    async (_event, startDate: string, endDate: string) => {
      const startedAt = Date.now();
      const result = await collectUsageRange(startDate, endDate);
      perfLog("usage:query-range", {
        startDate,
        endDate,
        ms: Date.now() - startedAt,
        sessions: result.sessions,
        totalCost: result.totalCost,
      });
      return result;
    },
  );

  ipcMain.handle("usage:heatmap", async () => {
    const startedAt = Date.now();
    const result = await collectHeatmapData();
    perfLog("usage:heatmap", {
      ms: Date.now() - startedAt,
      days: Object.keys(result).length,
    });
    return result;
  });

  ipcMain.handle("usage:query-cloud", async (_event, dateStr: string) => {
    return await queryCloudUsage(dateStr);
  });

  ipcMain.handle(
    "usage:query-range-cloud",
    async (_event, startDate: string, endDate: string) => {
      return await queryCloudUsageRange(startDate, endDate);
    },
  );

  ipcMain.handle("usage:heatmap-cloud", async () => {
    return await queryCloudHeatmap();
  });

  ipcMain.handle("quota:fetch", async () => {
    const { fetchQuota } = await import("./quota-fetcher");
    const startedAt = Date.now();
    const result = await fetchQuota();
    perfLog("quota:fetch", {
      ms: Date.now() - startedAt,
      ok: result.ok,
      rateLimited: result.ok ? false : result.rateLimited,
    });
    return result;
  });

  ipcMain.handle("codex-quota:fetch", async () => {
    const { fetchCodexQuota } = await import("./codex-quota-fetcher");
    const startedAt = Date.now();
    const result = await fetchCodexQuota();
    perfLog("codex-quota:fetch", {
      ms: Date.now() - startedAt,
      ok: result.ok,
      rateLimited: result.ok ? false : result.rateLimited,
    });
    return result;
  });

  ipcMain.handle(
    "summary:generate",
    async (
      _event,
      input: {
        terminalId: string;
        sessionId: string;
        sessionType: "claude" | "codex";
        cwd: string;
        summaryCli: "claude" | "codex";
      },
    ) => {
      const { generateSummary } = await import("./summary-service.js");
      return generateSummary(input);
    },
  );

  let activeInsightsJobId: string | null = null;
  ipcMain.handle(
    "insights:generate",
    async (_event, cliTool: "claude" | "codex", jobId: string) => {
      if (activeInsightsJobId && activeInsightsJobId !== jobId) {
        return {
          ok: false as const,
          jobId,
          error: {
            code: "job_in_progress",
            message: "Another insights job is already running",
          },
        };
      }

      activeInsightsJobId = jobId;
      try {
        const { generateInsights } = await import("./insights-engine");
        return await generateInsights(cliTool, jobId, (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("insights:progress", progress);
          }
        });
      } finally {
        if (activeInsightsJobId === jobId) {
          activeInsightsJobId = null;
        }
      }
    },
  );

  ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    await shell.openExternal(toFileUrl(filePath));
  });

  ipcMain.handle("insights:get-last-report", async () => {
    const reportsDir = path.join(TERMCANVAS_DIR, "insights-reports");
    try {
      if (!fs.existsSync(reportsDir)) return null;
      const files = fs
        .readdirSync(reportsDir)
        .filter((f) => f.startsWith("insights-") && f.endsWith(".html"));
      if (files.length === 0) return null;
      files.sort().reverse();
      const filePath = path.join(reportsDir, files[0]);
      if (!fs.existsSync(filePath)) return null;
      return filePath;
    } catch {
      return null;
    }
  });

  const fontsDir = path.join(app.getPath("userData"), "fonts");

  ipcMain.handle("font:get-path", () => fontsDir);

  ipcMain.handle("font:list-downloaded", () => {
    try {
      if (!fs.existsSync(fontsDir)) return [];
      return fs.readdirSync(fontsDir);
    } catch {
      return [];
    }
  });

  ipcMain.handle("font:check", (_event, fileName: string) => {
    return fs.existsSync(path.join(fontsDir, fileName));
  });

  ipcMain.handle(
    "font:download",
    async (_event, url: string, fileName: string) => {
      if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
      }
      const destPath = path.join(fontsDir, fileName);
      if (fs.existsSync(destPath)) {
        return { ok: true, path: destPath };
      }

      try {
        const tmpZip = path.join(fontsDir, `_download_${Date.now()}.zip`);

        const buf = await new Promise<Buffer>((resolve, reject) => {
          const follow = (u: string, redirects = 0) => {
            if (redirects > 5) {
              reject(new Error("Too many redirects"));
              return;
            }
            https
              .get(u, (res) => {
                if (
                  (res.statusCode === 301 || res.statusCode === 302) &&
                  res.headers.location
                ) {
                  follow(res.headers.location, redirects + 1);
                  return;
                }
                if (res.statusCode !== 200) {
                  reject(new Error(`HTTP ${res.statusCode}`));
                  return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => resolve(Buffer.concat(chunks)));
                res.on("error", reject);
              })
              .on("error", reject);
          };
          follow(url);
        });
        if (buf.length < 100) {
          return {
            ok: false,
            error: "Downloaded file is too small, likely not a valid archive",
          };
        }
        fs.writeFileSync(tmpZip, buf);

        const zip = new AdmZip(tmpZip);
        const zipEntries = zip.getEntries();
        const matchEntry = zipEntries.find((e) =>
          e.entryName.endsWith(fileName),
        );
        if (!matchEntry) {
          fs.unlinkSync(tmpZip);
          return {
            ok: false,
            error: `Font file "${fileName}" not found in archive`,
          };
        }
        fs.writeFileSync(destPath, matchEntry.getData());
        fs.unlinkSync(tmpZip);

        return { ok: true, path: destPath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("auth:login", async () => {
    return login();
  });

  ipcMain.handle("auth:logout", async () => {
    await logout();
  });

  ipcMain.handle("auth:get-user", () => {
    return getAuthUser();
  });

  ipcMain.handle("auth:get-device-id", () => {
    return getDeviceId();
  });

  ipcMain.on("app:request-close", () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  ipcMain.handle(
    "agent:send",
    async (
      _event,
      sessionId: string,
      text: string,
      config: {
        type: "anthropic" | "openai" | "claude-code";
        baseURL: string;
        apiKey: string;
        model: string;
        cwd?: string;
        resumeSessionId?: string;
        projectId?: string;
        mcpScope?: "project" | "terminal" | "agent";
      },
    ) => {
      await agentService.send(sessionId, text, config as AgentConfig);
    },
  );

  ipcMain.handle("agent:abort", (_event, sessionId: string) => {
    agentService.abort(sessionId);
  });

  ipcMain.handle("agent:clear", (_event, sessionId: string) => {
    agentService.clearSession(sessionId);
  });

  ipcMain.handle("agent:delete", (_event, sessionId: string) => {
    agentService.deleteSession(sessionId);
  });

  ipcMain.handle(
    "agent:start",
    (_event, sessionId: string, config: AgentConfig) => {
      agentService.startClaudeCode(sessionId, config);
      const { getSlashCommandNames } =
        require("./slash-commands") as typeof import("./slash-commands");
      return { slashCommands: getSlashCommandNames(config.cwd) };
    },
  );

  ipcMain.handle(
    "agent:approve",
    (_event, sessionId: string, requestId: string) => {
      agentService.approve(sessionId, requestId);
    },
  );

  ipcMain.handle(
    "agent:deny",
    (_event, sessionId: string, requestId: string, reason?: string) => {
      agentService.deny(sessionId, requestId, reason);
    },
  );

  ipcMain.handle("secure:is-available", () =>
    safeStorage.isEncryptionAvailable(),
  );

  ipcMain.handle("secure:encrypt", (_event, plaintext: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage unavailable");
    }
    return safeStorage.encryptString(plaintext).toString("base64");
  });

  ipcMain.handle("secure:decrypt", (_event, base64: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage unavailable");
    }
    return safeStorage.decryptString(Buffer.from(base64, "base64"));
  });

  ipcMain.handle("pin:list", (_event, repo: string) => {
    return taskStore.list(repo);
  });

  ipcMain.handle(
    "pin:create",
    (_event, input: Parameters<typeof taskStore.create>[0]) => {
      return taskStore.create(input);
    },
  );

  ipcMain.handle(
    "pin:update",
    (
      _event,
      repo: string,
      id: string,
      patch: Parameters<typeof taskStore.update>[2],
    ) => {
      return taskStore.update(repo, id, patch);
    },
  );

  ipcMain.handle("pin:remove", (_event, repo: string, id: string) => {
    taskStore.remove(repo, id);
  });

  ipcMain.handle("pin:open-preview", (_event, repo: string, id: string) => {
    openPinPreviewWindow(repo, id);
  });

  // ── GitHub Issues ──

  ipcMain.handle(
    "github:fetch-issues",
    async (_event, cwd: string) => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      // Ensure gh CLI inherits auth tokens from the parent process.
      // Electron on Windows/macOS may not inherit shell env vars.
      const execEnv = { ...process.env };
      // gh reads GH_TOKEN or GITHUB_TOKEN; ensure both are forwarded if either is set
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      console.log("[gh-issues] GH_TOKEN set:", !!execEnv.GH_TOKEN, "GITHUB_TOKEN set:", !!execEnv.GITHUB_TOKEN);

      try {
        // Step 1: resolve owner/repo from git remote
        let owner: string;
        let repo: string;
        try {
          const { stdout: remoteUrl } = await execFileAsync(
            "git", ["remote", "get-url", "origin"],
            { cwd, timeout: 10_000, env: execEnv },
          );
          const match = remoteUrl.trim().match(
            /github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/i,
          );
          if (!match) {
            return {
              ok: false as const,
              error: `Could not parse GitHub owner/repo from remote: ${remoteUrl.trim()}`,
              code: "parse-error",
            };
          }
          owner = match[1];
          repo = match[2];
        } catch {
          return {
            ok: false as const,
            error: "No git remote 'origin' found. Add a GitHub remote first.",
            code: "no-remote",
          };
        }

        // Step 2: GraphQL query for ALL issue data including project fields,
        // sub-issues, relationships, and linked PRs
        const query = `
          query($owner: String!, $repo: String!, $cursor: String) {
            repository(owner: $owner, name: $repo) {
              issues(first: 50, states: [OPEN, CLOSED], after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
                nodes {
                  number
                  title
                  body
                  url
                  state
                  stateReason
                  createdAt
                  updatedAt
                  closedAt
                  author { login avatarUrl }
                  labels(first: 30) { nodes { name color } }
                  assignees(first: 10) { nodes { login name avatarUrl } }
                  milestone { title number dueOn description }
                  projectItems(first: 20) {
                    nodes {
                      project { title number url }
                      fieldValues(first: 30) {
                        nodes {
                          ... on ProjectV2ItemFieldTextValue {
                            text
                            field { ... on ProjectV2FieldCommon { name } }
                          }
                          ... on ProjectV2ItemFieldNumberValue {
                            number
                            field { ... on ProjectV2FieldCommon { name } }
                          }
                          ... on ProjectV2ItemFieldDateValue {
                            date
                            field { ... on ProjectV2FieldCommon { name } }
                          }
                          ... on ProjectV2ItemFieldSingleSelectValue {
                            name
                            field { ... on ProjectV2FieldCommon { name } }
                          }
                          ... on ProjectV2ItemFieldIterationValue {
                            title
                            startDate
                            duration
                            field { ... on ProjectV2FieldCommon { name } }
                          }
                        }
                      }
                    }
                  }
                  subIssues(first: 20) {
                    nodes { number title url state }
                  }
                  parent { number title url state }
                  blockedBy(first: 20) {
                    nodes { number title url state }
                  }
                  blocking(first: 20) {
                    nodes { number title url state }
                  }
                  closedByPullRequestsReferences(first: 10) {
                    nodes { number title state url headRefName headRefOid }
                  }
                  comments(first: 100) {
                    nodes {
                      author { login avatarUrl }
                      body
                      createdAt
                    }
                  }
                  timelineItems(first: 30, itemTypes: [CONNECTED_EVENT, DISCONNECTED_EVENT, CROSS_REFERENCED_EVENT, LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, CLOSED_EVENT, REOPENED_EVENT, MILESTONED_EVENT, RENAMED_TITLE_EVENT]) {
                    nodes {
                      ... on LabeledEvent {
                        createdAt
                        actor { login }
                        label { name color }
                      }
                      ... on UnlabeledEvent {
                        createdAt
                        actor { login }
                        label { name color }
                      }
                      ... on AssignedEvent {
                        createdAt
                        actor { login }
                      }
                      ... on UnassignedEvent {
                        createdAt
                        actor { login }
                      }
                      ... on ClosedEvent {
                        createdAt
                        actor { login }
                      }
                      ... on ReopenedEvent {
                        createdAt
                        actor { login }
                      }
                      ... on MilestonedEvent {
                        createdAt
                        actor { login }
                        milestoneTitle
                      }
                      ... on RenamedTitleEvent {
                        createdAt
                        actor { login }
                        currentTitle
                        previousTitle
                      }
                      ... on ConnectedEvent {
                        createdAt
                        actor { login }
                        subject { ... on Issue { number title url } }
                        isCrossRepository
                      }
                      ... on DisconnectedEvent {
                        createdAt
                        actor { login }
                        subject { ... on Issue { number title url } }
                      }
                      ... on CrossReferencedEvent {
                        createdAt
                        actor { login }
                        source {
                          ... on PullRequest { number title url state }
                          ... on Issue { number title url state }
                        }
                      }
                    }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }`;

        const { stdout } = await execFileAsync(
          "gh", [
            "api", "graphql",
            "--paginate",
            "-F", `owner=${owner}`,
            "-F", `repo=${repo}`,
            "-f", `query=${query}`,
          ],
          { cwd, timeout: 60_000, maxBuffer: 50 * 1024 * 1024, env: execEnv },
        );

        // gh api graphql --paginate returns concatenated JSON; parse each page
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const allIssues: Array<Record<string, unknown>> = [];
        let graphqlErrors: Array<{ message: string }> = [];

        for (const line of lines) {
          try {
            const page = JSON.parse(line);
            // Check for GraphQL-level errors even on HTTP 200
            if (Array.isArray(page.errors)) {
              graphqlErrors.push(...page.errors);
              for (const e of page.errors) {
                console.error("[gh-issues] GraphQL error:", JSON.stringify(e));
              }
            }
            const issues = page?.data?.repository?.issues?.nodes;
            if (Array.isArray(issues)) {
              for (const issue of issues) {
                allIssues.push(issue);
              }
            }
          } catch {
            // skip unparseable lines
          }
        }

        if (graphqlErrors.length > 0) {
          console.error("[gh-issues] GraphQL errors in response:", JSON.stringify(graphqlErrors));
        }
        if (graphqlErrors.length > 0 || allIssues.length > 0) {
          return { ok: true as const, issues: allIssues };
        }

        // No issues and no GraphQL errors — assume the repo exists but has no open issues
        return { ok: true as const, issues: [] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err instanceof Error && "code" in err
            ? (err as NodeJS.ErrnoException).code ?? "unknown"
            : "unknown";

        // Extract stderr from the promisified execFile error
        const stderrOutput =
          err instanceof Error && "stderr" in err
            ? String((err as NodeJS.ErrnoException & { stderr?: unknown }).stderr ?? "")
            : "";
        const stdoutOutput =
          err instanceof Error && "stdout" in err
            ? String((err as NodeJS.ErrnoException & { stdout?: unknown }).stdout ?? "")
            : "";

        console.error("[gh-issues] RAW ERROR:", {
          code,
          message,
          stderr: stderrOutput.slice(0, 500),
          stdout: stdoutOutput.slice(0, 500),
        });

        if (code === "ENOENT") {
          return {
            ok: false as const,
            error: "GitHub CLI (gh) is not installed. Install from https://cli.github.com",
            code: "not-installed",
          };
        }

        // Include raw stderr in error so user can diagnose
        const combined = `${message}\n${stderrOutput}`;

        if (
          combined.includes("not logged") ||
          combined.includes("401") ||
          combined.includes("Bad credentials") ||
          combined.includes("unauthorized") ||
          combined.includes("Resource protected") ||
          combined.includes("HTTP 403") ||
          combined.includes("Must have push") ||
          combined.includes("Personal access token") ||
          combined.includes("OAuth") ||
          combined.includes("requires authentication") ||
          combined.includes("resolve repository") ||
          combined.includes("Could not resolve to a Repository")
        ) {
          return {
            ok: false as const,
            error: `GitHub authentication failed.\n\nRaw gh output:\n${stderrOutput.slice(0, 400)}\n\nMake sure your GH_TOKEN has repo scope and SSO is enabled for the target org.`,
            code: "not-authenticated",
          };
        }

        if (
          combined.includes("ENOTFOUND") ||
          combined.includes("ECONNREFUSED") ||
          combined.includes("network") ||
          combined.includes("timeout") ||
          combined.includes("Could not resolve")
        ) {
          return {
            ok: false as const,
            error: "Network error fetching issues",
            code: "network",
          };
        }

        return { ok: false as const, error: message, code: "unknown" };
      }
    },
  );

  ipcMain.handle("github:open-url", async (_event, url: string) => {
    if (isSafeExternalUrl(url)) {
      await shell.openExternal(url);
    }
  });

  // Detect the pull request linked to an issue (the "Development" panel
  // data). Uses the native `closedByPullRequestsReferences` field — the
  // older `development.pulls` field no longer exists on Issue and made this
  // handler fail silently. Returns the OPEN PR, else the most recent one,
  // else null. GraphQL errors are surfaced as `ok: false` instead of being
  // mistaken for "no PR".
  ipcMain.handle(
    "github:find-pr-for-issue",
    async (
      _event,
      cwd: string,
      issueNumber: number,
    ): Promise<
      | {
          ok: true;
          pr: {
            number: number;
            title: string;
            url: string;
            state: string;
            headRefName: string;
            headRefOid: string;
          } | null;
        }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        let owner: string;
        let repo: string;
        try {
          const { stdout: remoteUrl } = await execFileAsync(
            "git", ["remote", "get-url", "origin"],
            { cwd, timeout: 10_000, env: execEnv },
          );
          const match = remoteUrl.trim().match(
            /github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/i,
          );
          if (!match) {
            return {
              ok: false as const,
              error: `Could not parse GitHub owner/repo from remote: ${remoteUrl.trim()}`,
            };
          }
          owner = match[1];
          repo = match[2];
        } catch {
          return {
            ok: false as const,
            error: "No git remote 'origin' found. Add a GitHub remote first.",
          };
        }

        const query = `
          query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              issue(number: $number) {
                closedByPullRequestsReferences(first: 10) {
                  nodes {
                    number
                    title
                    url
                    state
                    headRefName
                    headRefOid
                  }
                }
              }
            }
          }`;

        const { stdout } = await execFileAsync(
          "gh", [
            "api", "graphql",
            "-F", `owner=${owner}`,
            "-F", `repo=${repo}`,
            "-F", `number=${issueNumber}`,
            "-f", `query=${query}`,
          ],
          { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
        );

        const data = JSON.parse(stdout);
        const graphqlErrors: Array<{ message: string }> = data?.errors ?? [];
        if (graphqlErrors.length > 0) {
          return {
            ok: false as const,
            error: `GitHub GraphQL: ${graphqlErrors[0].message}`,
          };
        }
        const pulls: Array<{
          number: number;
          title: string;
          url: string;
          state: string;
          headRefName: string;
          headRefOid: string;
        }> =
          data?.data?.repository?.issue?.closedByPullRequestsReferences
            ?.nodes ?? [];
        if (pulls.length === 0) {
          return { ok: true as const, pr: null };
        }
        const openPr = pulls.find((p) => p.state === "OPEN") ?? pulls[0];
        return { ok: true as const, pr: openPr };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Detect EVERY open PR linked to an issue ("Development" panel data, the
  // `closedByPullRequestsReferences` field). The review flow runs on each open
  // PR of the issue, not just the first one, so this returns the full OPEN
  // list instead of picking a single candidate. GraphQL errors are surfaced
  // as `ok: false`; an issue without open PRs returns an empty list.
  ipcMain.handle(
    "github:find-open-prs-for-issue",
    async (
      _event,
      cwd: string,
      issueNumber: number,
    ): Promise<
      | {
          ok: true;
          prs: {
            number: number;
            title: string;
            url: string;
            state: string;
            headRefName: string;
            headRefOid: string;
          }[];
        }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        let owner: string;
        let repo: string;
        try {
          const { stdout: remoteUrl } = await execFileAsync(
            "git", ["remote", "get-url", "origin"],
            { cwd, timeout: 10_000, env: execEnv },
          );
          const match = remoteUrl.trim().match(
            /github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/i,
          );
          if (!match) {
            return {
              ok: false as const,
              error: `Could not parse GitHub owner/repo from remote: ${remoteUrl.trim()}`,
            };
          }
          owner = match[1];
          repo = match[2];
        } catch {
          return {
            ok: false as const,
            error: "No git remote 'origin' found. Add a GitHub remote first.",
          };
        }

        const query = `
          query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              issue(number: $number) {
                closedByPullRequestsReferences(first: 10) {
                  nodes {
                    number
                    title
                    url
                    state
                    headRefName
                    headRefOid
                  }
                }
              }
            }
          }`;

        const { stdout } = await execFileAsync(
          "gh", [
            "api", "graphql",
            "-F", `owner=${owner}`,
            "-F", `repo=${repo}`,
            "-F", `number=${issueNumber}`,
            "-f", `query=${query}`,
          ],
          { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
        );

        const data = JSON.parse(stdout);
        const graphqlErrors: Array<{ message: string }> = data?.errors ?? [];
        if (graphqlErrors.length > 0) {
          return {
            ok: false as const,
            error: `GitHub GraphQL: ${graphqlErrors[0].message}`,
          };
        }
        const pulls: Array<{
          number: number;
          title: string;
          url: string;
          state: string;
          headRefName: string;
          headRefOid: string;
        }> =
          data?.data?.repository?.issue?.closedByPullRequestsReferences
            ?.nodes ?? [];
        const openPrs = pulls.filter((p) => p.state === "OPEN");
        return { ok: true as const, prs: openPrs };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Read the aggregate review decision of a PR. The review terminal persists
  // this right before the runtime deletes the worktree, so the issue card can
  // show whether the reviewer approved or requested changes.
  //
  // The binary verdict ("VEREDICTO: APROBADO" / "VEREDICTO: CAMBIOS_PEDIDOS")
  // that reviews are now required to lead with takes precedence over GitHub's
  // own reviewDecision: a PR reviewed with event=COMMENT still records
  // reviewDecision="COMMENTED", but the body line is the actual contract that
  // TermCanvas parses to flip the issue label and gate the fix/merge buttons.
  ipcMain.handle(
    "github:get-pr-review-decision",
    async (
      _event,
      cwd: string,
      prNumber: number,
    ): Promise<
      | {
          ok: true;
          reviewDecision:
            | "APPROVED"
            | "CHANGES_REQUESTED"
            | "REVIEW_REQUIRED"
            | "COMMENTED"
            | "FIX_APPLIED"
            | null;
          bodyVerdict: "APROBADO" | "CAMBIOS_PEDIDOS" | null;
          labels: string[];
          headRefOid: string | null;
          lastReviewCommitId: string | null;
        }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        const { stdout } = await execFileAsync(
          "gh",
          [
            "pr", "view", String(prNumber),
            "--json", "reviewDecision,reviews,labels,headRefOid",
            "--jq", "{ decision: .reviewDecision, headRefOid: .headRefOid, reviews: [.reviews[] | { state: .state, body: .body, submittedAt: .submittedAt, commitOid: .commit.oid }], labels: [.labels[].name] }",
          ],
          { cwd, timeout: 15_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
        );
        const parsed = JSON.parse(stdout);
        const decision = parsed?.decision;
        const headRefOid: string | null =
          typeof parsed?.headRefOid === "string" ? parsed.headRefOid : null;
        const reviews: Array<{ state: string; body: string; submittedAt: string; commitOid: string | null }> =
          Array.isArray(parsed?.reviews) ? parsed.reviews : [];
        const labels: string[] = Array.isArray(parsed?.labels)
          ? (parsed.labels as string[])
          : [];

        // The NEWEST review whose body carries the binary verdict line wins.
        // gh returns reviews oldest-first (verified empirically), so keep
        // scanning and let the last match override — a re-review must beat
        // the original verdict, otherwise a stale "changes requested" would
        // block the merge after the fix round.
        let bodyVerdict: "APROBADO" | "CAMBIOS_PEDIDOS" | null = null;
        for (const review of reviews) {
          const parsed = parseReviewBodyVerdict(review.body);
          if (parsed) {
            bodyVerdict = parsed;
          }
        }

        const states: string[] = reviews.map((r) => r.state);
        const fallbackDecision =
          decision === "APPROVED" ||
          decision === "CHANGES_REQUESTED" ||
          decision === "REVIEW_REQUIRED"
            ? (decision as "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED")
            // A human review that only commented leaves reviewDecision empty
            // but still counts as feedback: surface it instead of "sin veredicto".
            : states.includes("COMMENTED")
              ? "COMMENTED"
              : null;

        // The commit the NEWEST review evaluated (gh returns reviews
        // oldest-first, so the last entry wins). Drives the fix-applied fold:
        // a head that moved past that commit means a fix (or conflict
        // resolution) was pushed since the review — awaiting re-review.
        const lastReviewCommitId: string | null =
          reviews.length > 0 ? (reviews[reviews.length - 1].commitOid ?? null) : null;

        const reviewDecision = reviewDecisionWithFixApplied(
          reviewDecisionFromBodyVerdict(bodyVerdict) ?? fallbackDecision,
          headRefOid,
          lastReviewCommitId,
        );

        return {
          ok: true as const,
          reviewDecision,
          bodyVerdict,
          labels,
          headRefOid,
          lastReviewCommitId,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Return the review thread of a PR (bodies of submitted reviews and inline
  // comments) as plain text. Injected into the implementer's resume prompt
  // after a "changes requested" verdict so they address the feedback.
  ipcMain.handle(
    "github:get-pr-comments",
    async (
      _event,
      cwd: string,
      prNumber: number,
    ): Promise<
      | { ok: true; text: string }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        const { stdout } = await execFileAsync(
          "gh",
          ["pr", "view", String(prNumber), "--comments"],
          { cwd, timeout: 20_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
        );
        const full = stdout.trim();
        const MAX_COMMENT_CHARS = 5000;
        const text =
          full.length > MAX_COMMENT_CHARS
            ? `${full.slice(0, MAX_COMMENT_CHARS)}... (feedback truncado — revisá el PR en GitHub para el resto)`
            : full;
        return { ok: true as const, text };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Snapshot the PR state the review/fix prompt needs, so the agent receives
  // deterministic facts instead of re-deriving them with gh calls that are
  // easy to get wrong (headRefOid, the last review, the latest inline batch).
  //
  // Returns a single flattened text block (newlines stripped — the opencode
  // prompt breaks on them on Windows) plus the path of a worktree-local diff
  // file that holds the real diff, because a full diff cannot survive the
  // one-line prompt transform. The agent reads that file instead of fetching
  // the diff itself.
  ipcMain.handle(
    "github:get-review-context",
    async (
      _event,
      cwd: string,
      prNumber: number,
      targetDir: string,
    ): Promise<
      | {
          ok: true;
          context: string;
          diffFilePath: string | null;
          templateFilePath: string | null;
          headRefOid: string | null;
          lastReviewCommitId: string | null;
        }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        const execFileAsync = promisify(execFile);
        const run = (
          args: string[],
          timeout = 15_000,
        ): Promise<string> =>
          execFileAsync("gh", args, {
            cwd,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            env: execEnv,
          }).then((r) => r.stdout);

        const viewOut = await run([
          "pr", "view", String(prNumber),
          "--json", "headRefOid,title,reviews",
          "--jq", "{ headRefOid: .headRefOid, title: .title, reviews: [.reviews[] | { state: .state, body: .body, submittedAt: .submittedAt, commitOid: .commit.oid }] }",
        ]);
        const view = JSON.parse(viewOut);
        const headRefOid: string | null =
          typeof view?.headRefOid === "string" ? view.headRefOid : null;
        const reviews: Array<{ state: string; body: string; submittedAt: string; commitOid: string | null }> =
          Array.isArray(view?.reviews) ? view.reviews : [];

        // gh returns reviews oldest-first (verified empirically): the last
        // entry is the most recent round, which the fix prompt must answer.
        const latestReview =
          reviews.length > 0 ? reviews[reviews.length - 1] : null;
        const flatten = (s: string | undefined | null): string =>
          (s ?? "").replace(/\s*\n\s*/g, " | ").replace(/\s+/g, " ").trim();

        // The latest batch of inline review comments, newest first — this is
        // what the fix prompt should address, not every historical comment.
        const nameWithOwner = (
          await run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
            .catch(() => "")
        ).trim();
        let latestInlineComments: Array<{
          path: string;
          line: number | null;
          body: string;
        }> = [];
        if (nameWithOwner) {
          const commentsOut = await run(
            [
              "api", `repos/${nameWithOwner}/pulls/${prNumber}/comments`,
            ],
            20_000,
          ).catch(() => "[]");
          const parsedComments = JSON.parse(commentsOut);
          if (Array.isArray(parsedComments)) {
            // Pull review comments come out chronological ascending; reverse
            // to the newest batch and cap it so the prompt stays tight.
            latestInlineComments = (parsedComments as Array<{
              path?: string;
              line?: number;
              start_line?: number;
              body?: string;
            }>)
              .slice(-10)
              .reverse()
              .map((c) => ({
                path: c.path ?? "?",
                line: typeof c.line === "number" ? c.line : (c.start_line ?? null),
                body: flatten(c.body).slice(0, 400),
              }));
          }
        }

        // Write the real diff to a worktree-local file so the agent anchors
        // comments to actual line numbers without running gh (the prompt is
        // one line, so the diff cannot be embedded in it directly).
        let diffFilePath: string | null = null;
        let templateFilePath: string | null = null;
        if (targetDir) {
          const diffOut = await run(["pr", "diff", String(prNumber)], 20_000);
          const { join } = await import("path");
          const { writeFile } = await import("fs/promises");
          const diffAbs = join(targetDir, `review-context-${prNumber}.diff`);
          await writeFile(diffAbs, diffOut, "utf8");
          diffFilePath = `review-context-${prNumber}.diff`;

          // Pre-generate the fixed review JSON skeleton with the real
          // commit_id so the agent only fills in body and comments — the
          // schema (event: COMMENT, line/side) never changes, so the app
          // owns it instead of letting the agent reinvent it per round.
          const reviewTemplate = {
            commit_id: headRefOid ?? "el hash actual (git rev-parse HEAD)",
            event: "COMMENT" as const,
            body: "primera línea: VEREDICTO: APROBADO o VEREDICTO: CAMBIOS_PEDIDOS; después el resumen general del review",
            comments: [
              {
                path: "ruta/relativa/al/archivo.ext",
                line: 42,
                side: "RIGHT",
                body: "observación específica de esa fila (si es opcional, empezá con 'no bloqueante: ')",
              },
            ],
          };
          const templateAbs = join(targetDir, `review-template-${prNumber}.json`);
          await writeFile(templateAbs, JSON.stringify(reviewTemplate, null, 2), "utf8");
          templateFilePath = `review-template-${prNumber}.json`;
        }

        const context = [
          headRefOid ? `PR head (headRefOid): ${headRefOid}` : "",
          latestReview
            ? `Última review: ${latestReview.state} (commit ${latestReview.commitOid ?? "?"}) — ${flatten(latestReview.body).slice(0, 800)}`
            : "Sin reviews aún",
          latestInlineComments.length > 0
            ? `Última tanda de comentarios inline: ${latestInlineComments
                .map((c) => `${c.path}${c.line != null ? `:${c.line}` : ""} → ${c.body}`)
                .join(" ; ")}`
            : "",
          diffFilePath
            ? `Diff del PR disponible en ${diffFilePath} (dentro del worktree) con números de línea reales — usalo como referencia, no corras gh pr diff para leerlo.`
            : "",
          templateFilePath
            ? `Esqueleto del review listo en ${templateFilePath} (dentro del worktree): completá body y comments, NO cambies event ni la estructura — subilo con gh api ... --input ${templateFilePath}.`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        return {
          ok: true as const,
          context,
          diffFilePath,
          templateFilePath,
          headRefOid,
          lastReviewCommitId: latestReview?.commitOid ?? null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Detect the ACTUAL conflict state of a "conflicto:main"-flagged PR before
  // the runner opens a resolution session. Runs the same throwaway test-merge
  // the mergeador uses (--no-commit --no-ff against origin/main, zero risk to
  // the implementer worktree: the temp worktree is force-removed afterwards)
  // and returns the unmerged file list. An empty list means the branch already
  // integrates cleanly — the runner skips the session. The result is also what
  // the prompt injects, so the agent never re-derives the list with gh.
  ipcMain.handle(
    "github:get-conflict-files",
    async (
      _event,
      cwd: string,
      branch: string,
      prNumber: number,
    ): Promise<
      | { ok: true; conflictFiles: string[] }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const gitOpts = {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      };
      const worktreePath = path.join(
        cwd,
        ".worktrees",
        `conflict-check-${prNumber}`,
      );
      try {
        // Same fetch pattern as the mergeador: the PR branch is fetched by
        // ref so the detached throwaway worktree can be created at it.
        await execFileAsync("git", ["fetch", "origin", "main"], {
          cwd,
          ...gitOpts,
        });
        await execFileAsync(
          "git",
          ["fetch", "origin", `refs/heads/${branch}`],
          { cwd, ...gitOpts },
        );
        await execFileAsync(
          "git",
          ["worktree", "add", "--detach", worktreePath, `origin/${branch}`],
          { cwd, ...gitOpts },
        );
        let conflictFiles: string[] = [];
        try {
          await execFileAsync(
            "git",
            ["merge", "origin/main", "--no-commit", "--no-ff"],
            { cwd: worktreePath, ...gitOpts },
          );
          // Clean merge → the branch already integrates with main.
        } catch {
          // Conflict (expected) or a real failure: the unmerged file list is
          // the ground truth either way. A broken non-conflict failure (e.g.
          // the throwaway checkout is dirty) yields zero files, which the
          // runner treats as "no conflict".
          const { stdout } = await execFileAsync(
            "git",
            ["diff", "--name-only", "--diff-filter=U"],
            { cwd: worktreePath, ...gitOpts },
          );
          conflictFiles = stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return { ok: true as const, conflictFiles };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      } finally {
        // Best-effort cleanup: abort does nothing on a clean merge, and the
        // worktree remove clears the temp checkout regardless. A failure here
        // never blocks the result — a leftover detached worktree is harmless.
        try {
          await execFileAsync("git", ["merge", "--abort"], {
            cwd: worktreePath,
            ...gitOpts,
          });
        } catch {
          // No MERGE_HEAD — nothing to abort.
        }
        try {
          await execFileAsync(
            "git",
            ["worktree", "remove", "--force", worktreePath],
            { cwd, ...gitOpts },
          );
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  );

  // ── GitHub Issue Mutations ──

  ipcMain.handle("github:list-labels", async (_event, cwd: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync("gh", ["label", "list", "--json", "name,color,description"], { cwd, timeout: 15_000, env: { ...process.env } });
      const labels = JSON.parse(stdout);
      return { ok: true as const, labels: labels as Array<{ name: string; color: string; description: string }> };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

  // Issues abiertos del repo (título + número) para la deduplicación del
  // plan: el prompt los ve y marca de plano los items que reescriben un
  // problema que ya fue pedido en otro issue. Best-effort: sin gh o sin
  // issues, devuelve ok con lista vacía.
  ipcMain.handle("github:list-open-issues", async (_event, cwd: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync("gh", ["issue", "list", "--state", "open", "--limit", "50", "--json", "number,title"], { cwd, timeout: 15_000, env: { ...process.env } });
      const issues = JSON.parse(stdout);
      return { ok: true as const, issues: issues as Array<{ number: number; title: string }> };
    } catch {
      // Sin gh o sin permisos: el plan corre igual sin la sección de
      // issues existentes (solo se pierde la marca anti-duplicado).
      return { ok: true as const, issues: [] };
    }
  });

  ipcMain.handle("github:list-milestones", async (_event, cwd: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync("gh", ["api", "/repos/{owner}/{repo}/milestones", "--jq", ".[] | {number, title, due_on}"], { cwd, timeout: 15_000, env: { ...process.env } });
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const milestones = lines.map((l) => JSON.parse(l));
      return { ok: true as const, milestones: milestones as Array<{ number: number; title: string; due_on: string | null }> };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

  ipcMain.handle("github:mutate-issue", async (_event, cwd: string, number: number, action: string, params: Record<string, unknown>) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    try {
      const args: string[] = ["issue", "edit", String(number)];

      if (action === "add-labels" && Array.isArray(params.labels)) {
        for (const l of params.labels as string[]) args.push("--add-label", l);
      }
      if (action === "remove-label" && typeof params.label === "string") {
        args.push("--remove-label", params.label);
      }
      if (action === "add-assignees" && Array.isArray(params.assignees)) {
        for (const a of params.assignees as string[]) args.push("--add-assignee", a);
      }
      if (action === "remove-assignee" && typeof params.assignee === "string") {
        args.push("--remove-assignee", params.assignee);
      }
      if (action === "set-milestone" && typeof params.milestone === "string") {
        args.push("--milestone", params.milestone);
      }
      if (action === "clear-milestone") {
        args.push("--milestone", "");
      }
      if (action === "close") {
        args.splice(1, 0, "close"); // gh issue close {n}
      }
      if (action === "reopen") {
        args.splice(1, 0, "reopen");
      }

      await execFileAsync("gh", args, { cwd, timeout: 15_000, env: { ...process.env } });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

  ipcMain.handle("github:add-comment", async (_event, cwd: string, number: number, body: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    try {
      await execFileAsync("gh", ["issue", "comment", String(number), "--body", body], { cwd, timeout: 15_000, env: { ...process.env } });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

  // Crea un issue real en GitHub y devuelve el número y URL que GitHub
  // asignó (NO el índice local del plan). El body va por archivo temporal
  // porque puede tener miles de caracteres y newlines que romperían el
  // argumento. gh issue create NO tiene --json: imprime la URL del issue
  // en stdout, de ahí se extrae el número con formato .../issues/N.
  //
  // Los labels del plan no siempre existen en el repo: se aseguran ANTES
  // del create (gh label create --force, que no falla si ya existen) para
  // que el issue salga siempre etiquetado. Si la redacción del label falla
  // igualmente (repo sin permisos), el reintento sin labels garantiza que
  // el issue nunca se pierda. La lista de labels existentes se cachea por
  // repo para no consultar gh en cada issue de la misma corrida.
  ipcMain.handle("github:create-issue", async (_event, cwd: string, title: string, body: string, labels: string[]) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const { writeFile, unlink } = await import("fs/promises");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const execFileAsync = promisify(execFile);
    const bodyFile = join(tmpdir(), `termcanvas-issue-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
    const ghArgs = (args: string[]) =>
      execFileAsync("gh", args, { cwd, timeout: 30_000, env: { ...process.env } });
    const parseCreated = (stdout: string) => {
      const url = stdout.trim();
      const match = url.match(/\/issues\/(\d+)\s*$/);
      if (!match) {
        return { ok: false as const, error: `gh no devolvió una URL de issue válida: "${url}"` };
      }
      return { ok: true as const, number: Number(match[1]), url };
    };
    const ensureLabels = async () => {
      if (labels.length === 0) return;
      let existing = labelCache.get(cwd);
      if (!existing) {
        try {
          const { stdout } = await ghArgs(["label", "list", "--json", "name", "--jq", ".[].name"]);
          existing = new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean));
          labelCache.set(cwd, existing);
        } catch {
          return; // sin lista de labels no se puede asegurar ninguno
        }
      }
      for (const label of labels) {
        if (existing.has(label)) continue;
        try {
          await ghArgs(["label", "create", label, "--color", "0366d6", "--force"]);
          existing.add(label);
        } catch {
          // El reintento sin labels de abajo cubre el caso sin permisos.
        }
      }
    };
    try {
      await writeFile(bodyFile, body, "utf8");
      await ensureLabels();
      const labelsArgs = labels.flatMap((label) => ["--label", label]);
      try {
        const { stdout } = await execFileAsync("gh", ["issue", "create", "--title", title, "--body-file", bodyFile, ...labelsArgs], { cwd, timeout: 30_000, env: { ...process.env } });
        return parseCreated(stdout);
      } catch {
        // Labels inexistentes en el repo: crear igual sin ellos.
        const { stdout } = await execFileAsync("gh", ["issue", "create", "--title", title, "--body-file", bodyFile], { cwd, timeout: 30_000, env: { ...process.env } });
        return parseCreated(stdout);
      }
    } catch (err) {
      return { ok: false as const, error: String(err) };
    } finally {
      try { await unlink(bodyFile); } catch { /* best-effort */ }
    }
  });

  // Último número de issue/PR asignado en el repo: el número que le tocará
  // al próximo issue a crear es ese + 1. Se usa para previsualizar los
  // números del plan ANTES de crear (GitHub asigna números secuenciales
  // globales por repo, issues y PRs comparten la misma secuencia). Devolver
  // null si no se puede resolver (repo sin remote, sin gh, sin issues).
  ipcMain.handle("github:last-issue-number", async (_event, cwd: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    try {
      const { stdout: remoteUrl } = await execFileAsync(
        "git", ["remote", "get-url", "origin"],
        { cwd, timeout: 10_000, env: { ...process.env } },
      );
      const match = remoteUrl.trim().match(
        /github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/i,
      );
      if (!match) return null;
      const { stdout } = await execFileAsync(
        "gh",
        ["api", `repos/${match[1]}/${match[2]}/issues?state=all&per_page=1&sort=created&direction=desc`, "--jq", ".[0].number"],
        { cwd, timeout: 15_000, env: { ...process.env } },
      );
      const number = Number(stdout.trim());
      return Number.isFinite(number) ? number : null;
    } catch {
      return null;
    }
  });

  // Reviso si el repo tiene un config de Project v2 y, si lo tiene, integro
  // el issue recién creado al proyecto y relleno los fields declarados.
  // Best-effort: si no hay config, si gh no lo encuentra o si un field no
  // existe, no se interrumpe la corrida (el issue ya quedó creado).
  //
  // Config: <cwd>/.agents/planning/project-config.json
  //   { "project": "Nombre del Project v2",
  //     "owner": "@me",              // opcional: default = owner del repo
  //     "fields": { "Status": "Todo", "Iteración": "Sprint 12" } }
  // El valor de un single-select se pasa por NAME (gh resuelve la opción);
  // los demás campos se tratan como texto.
  const projectFieldTypes = new Map<string, Map<string, { singleSelectOptions: Set<string> }>>();
  async function resolveProjectFieldTypes(
    ghArgs: (args: string[]) => Promise<{ stdout: string }>,
    cwd: string,
    owner: string,
    projectNumber: number,
  ): Promise<Map<string, { singleSelectOptions: Set<string> }>> {
    const key = `${owner}#${projectNumber}`;
    const cached = projectFieldTypes.get(key);
    if (cached) return cached;
    try {
      const { stdout } = await ghArgs([
        "project", "field-list", String(projectNumber), "--owner", owner, "--format", "json",
      ]);
      const data = JSON.parse(stdout) as {
        fields: Array<{
          name: string;
          type: string;
          options?: Array<{ name: string }>;
        }>;
      };
      const byName = new Map<string, { singleSelectOptions: Set<string> }>();
      for (const field of data.fields) {
        const singleSelectOptions =
          field.type === "ProjectV2SingleSelectField"
            ? new Set((field.options ?? []).map((o) => o.name))
            : new Set<string>();
        byName.set(field.name, { singleSelectOptions });
      }
      projectFieldTypes.set(key, byName);
      return byName;
    } catch {
      return new Map();
    }
  }

  ipcMain.handle("github:add-to-project", async (_event, cwd: string, issueUrl: string) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const execFileAsync = promisify(execFile);
    const ghArgs = (args: string[]) =>
      execFileAsync("gh", args, { cwd, timeout: 30_000, env: { ...process.env } });

    const configPath = join(cwd, ".agents", "planning", "project-config.json");
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch {
      return { ok: true as const, applied: false as const };
    }
    let config: { project: string; owner?: string; fields?: Record<string, string> };
    try {
      config = JSON.parse(raw);
    } catch (err) {
      return { ok: false as const, error: `project-config.json inválido: ${String(err)}` };
    }
    if (!config.project || typeof config.project !== "string") {
      return { ok: false as const, error: "project-config.json: falta 'project'" };
    }

    try {
      let owner = config.owner;
      if (!owner) {
        const { stdout: remoteUrl } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd, timeout: 10_000, env: { ...process.env } });
        const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\//i);
        if (!match) {
          return { ok: false as const, error: "No se pudo deducir el owner del remote" };
        }
        owner = match[1];
      }

      const { stdout: projectsOut } = await ghArgs(["project", "list", "--owner", owner, "--format", "json"]);
      const projects = (JSON.parse(projectsOut) as { projects: Array<{ number: number; title: string }> }).projects;
      const project = projects.find((p) => p.title === config.project);
      if (!project) {
        return { ok: false as const, error: `Project "${config.project}" no encontrado en ${owner}` };
      }

      await ghArgs(["project", "item-add", String(project.number), "--owner", owner, "--url", issueUrl, "--format", "json"]);

      const fields = config.fields ?? {};
      const types = await resolveProjectFieldTypes(ghArgs, cwd, owner, project.number);
      for (const [name, value] of Object.entries(fields)) {
        const kind = types.get(name);
        let fieldArgs: string[];
        if (kind?.singleSelectOptions.has(value)) {
          fieldArgs = ["--single-select-option-id", value];
        } else {
          fieldArgs = ["--text", value];
        }
        try {
          await ghArgs(["project", "item-edit", String(project.number), "--owner", owner, "--url", issueUrl, "--field", name, ...fieldArgs]);
        } catch (err) {
          console.warn(`[planner] campo "${name}" no aplicado:`, String(err));
        }
      }
      return { ok: true as const, applied: true as const };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

// Review labels are a real repo-level state: they live on the PR itself, so
  // anyone looking at the repo (or the card after a reload) can tell whether
  // the last review approved or asked for changes. The label is flipped from
  // the binary verdict line the review prompt is contractually required to
  // lead with ("VEREDICTO: APROBADO"/"VEREDICTO: CAMBIOS_PEDIDOS"). FUENTE DE
  // VERDAD: the review-cycle labels live on the PR, and the associated issue
  // mirrors the canonical one (syncReviewLabelToIssue) so the status shows
  // everywhere; the issue conserves its own labels (outside the review
  // cycle) untouched. Every label is created on demand with gh label
  // create so a missing label can never silently break a flow again.
  const REVIEW_LABEL_COLORS: Record<string, string> = {
    [REVIEW_LABEL_PENDING]: "d4a017",
    [REVIEW_LABEL_CHANGES]: "e5534b",
    [REVIEW_LABEL_FIX_APPLIED]: "d4c5f9",
    [REVIEW_LABEL_APPROVED]: "0e8a16",
    [REVIEW_LABEL_CONFLICT]: "b60205",
  };

  // Create a label in the repo if it does not exist yet (gh label create
  // errors when the label is already there — ignore that specific case).
  type ExecFileAsync = (
    file: string,
    args: string[],
    opts: object,
  ) => Promise<{ stdout: string }>;
  async function ensureReviewLabel(
    execFileAsync: ExecFileAsync,
    cwd: string,
    labelName: string,
  ): Promise<void> {
    try {
      await execFileAsync(
        "gh",
        ["label", "create", labelName, "--color", REVIEW_LABEL_COLORS[labelName] ?? "d4c5f9", "--force"],
        { cwd, timeout: 15_000, env: { ...process.env } },
      );
    } catch {
      // Already exists (or the repo is read-only) — applying the label below
      // will surface the real problem if there is one.
    }
  }

  // Resolve the issue a PR will close from its body ("Closes #N" / "fixes #N"
  // contract of the SDD pipeline). Returns null when the PR does not
  // reference an issue — the issue mirror is skipped then.
  async function issueNumberForPr(
    execFileAsync: ExecFileAsync,
    cwd: string,
    prNumber: number,
  ): Promise<number | null> {
    try {
      const { stdout: prBody } = await execFileAsync(
        "gh",
        ["pr", "view", String(prNumber), "--json", "body", "--jq", ".body"],
        { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
      );
      const match = prBody.match(
        /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i,
      );
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }

  // Mirror the canonical review-cycle label onto the associated issue: the PR
  // owns the state, the issue reflects it so the repo shows the status
  // everywhere. A null canonical clears every cycle label from the issue.
  // Best-effort by design — the mirror must never break the main flow.
  async function syncReviewLabelToIssue(
    execFileAsync: ExecFileAsync,
    cwd: string,
    issueNumber: number,
    canonical: string | null,
  ): Promise<void> {
    try {
      for (const labelName of REVIEW_CYCLE_LABELS) {
        await ensureReviewLabel(execFileAsync, cwd, labelName);
      }
      const args = ["issue", "edit", String(issueNumber)];
      if (canonical) {
        args.push("--add-label", canonical);
      }
      for (const other of REVIEW_CYCLE_LABELS) {
        if (other !== canonical) {
          args.push("--remove-label", other);
        }
      }
      await execFileAsync("gh", args, {
        cwd,
        timeout: 15_000,
        env: { ...process.env },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[review] failed to sync issue #${issueNumber} label: ${message}`);
    }
  }

  ipcMain.handle(
    "github:apply-review-label",
    async (
      _event,
      cwd: string,
      prNumber: number,
      verdict: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "REVIEW_REQUIRED" | "FIX_APPLIED" | null,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        // The review prompts always post with event=COMMENT (GitHub refuses
        // self-approval), so the PR's own reviewDecision is not enough: the
        // verdict line in the review body is the source of truth.
        const labels = reviewLabelsForVerdict(verdict);
        if (!labels) {
          return { ok: true as const };
        }
        await ensureReviewLabel(execFileAsync, cwd, labels.target);
        // A fresh review supersedes the "fix applied, awaiting re-review"
        // state, so the fix label must be cleared along with the opposite
        // verdict label — otherwise it would stick on the PR forever. The
        // "no review yet" label also goes away: the PR now has one.
        await ensureReviewLabel(execFileAsync, cwd, labels.other);
        await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_FIX_APPLIED);
        await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_PENDING);
        const args = [
          "issue", "edit", String(prNumber),
          "--add-label", labels.target,
          "--remove-label", labels.other,
          "--remove-label", REVIEW_LABEL_FIX_APPLIED,
          "--remove-label", REVIEW_LABEL_PENDING,
        ];
        await execFileAsync("gh", args, { cwd, timeout: 15_000, env: execEnv });
        // Mirror the new state onto the associated issue (best-effort).
        const issueNumber = await issueNumberForPr(execFileAsync, cwd, prNumber);
        if (issueNumber !== null) {
          await syncReviewLabelToIssue(
            execFileAsync,
            cwd,
            issueNumber,
            labels.target,
          );
        }
        return { ok: true as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "github:sync-issue-review-label",
    async (
      _event,
      cwd: string,
      issueNumber: number,
      prLabels: string[],
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        // The canonical label is derived from the PR's raw labels (conflict
        // beats approved, etc.), so any stale combination self-corrects on
        // the next card refresh. null canonical clears the cycle labels.
        const canonical = canonicalReviewLabel(prLabels);
        await syncReviewLabelToIssue(
          execFileAsync,
          cwd,
          issueNumber,
          canonical,
        );
        return { ok: true as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Apply an exact review-cycle label to a PR and mirror it to the issue.
  // Unlike apply-review-label this accepts the final label directly (not a
  // verdict), which lets the renderer materialize derived states such as
  // "review:fix-aplicado" — a label the review prompts never post, but that
  // code can detect when a push landed after the last review. Any other cycle
  // label on the PR is removed so the canonical state stays unambiguous.
  ipcMain.handle(
    "github:apply-cycle-label",
    async (
      _event,
      cwd: string,
      prNumber: number,
      issueNumber: number | null,
      label: (typeof REVIEW_CYCLE_LABELS)[number],
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        if (!REVIEW_CYCLE_LABELS.includes(label)) {
          return { ok: false as const, error: `Label fuera del ciclo de review: ${label}` };
        }
        await ensureReviewLabel(execFileAsync, cwd, label);
        const args = ["issue", "edit", String(prNumber), "--add-label", label];
        for (const other of REVIEW_CYCLE_LABELS) {
          if (other !== label) args.push("--remove-label", other);
        }
        await execFileAsync("gh", args, { cwd, timeout: 15_000, env: execEnv });
        // The PR may be brand-new and not reference its issue yet; only sync
        // when the renderer already resolved it.
        if (issueNumber !== null) {
          await syncReviewLabelToIssue(execFileAsync, cwd, issueNumber, label);
        }
        return { ok: true as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "github:merge-pr",
    async (
      _event,
      cwd: string,
      prNumber: number,
    ): Promise<{ ok: true; prUrl: string } | { ok: false; error: string }> => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      try {
        // gh pr merge has no --comment flag; --squash -b sets the body of the
        // squash commit. The PR body is kept (it carries "Closes #N", which is
        // what auto-closes the issue) and the suffix documents who merged.
        // The body is passed via --body-file, NEVER via -b: a body containing
        // markdown checkboxes ("- [x]") would be parsed by gh as flags and the
        // merge would fail with "unknown shorthand flag".
        const { stdout: prBody } = await execFileAsync(
          "gh",
          ["pr", "view", String(prNumber), "--json", "body", "--jq", ".body"],
          { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
        );
        const mergeBody = [prBody.trim(), "Merged via TermCanvas"]
          .filter(Boolean)
          .join("\n\n");
        const bodyFile = path.join(
          os.tmpdir(),
          `termcanvas-merge-body-${prNumber}-${Date.now()}.md`,
        );
        fs.writeFileSync(bodyFile, mergeBody, "utf8");
        try {
          const { stdout } = await execFileAsync(
            "gh",
            ["pr", "merge", String(prNumber), "--squash", "--body-file", bodyFile],
            { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
          );
          const prUrl = stdout.trim() || `https://github.com/owner/repo/pull/${prNumber}`;
          return { ok: true as const, prUrl };
        } finally {
          try {
            fs.unlinkSync(bodyFile);
          } catch {
            // Temp file cleanup is best-effort.
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  // Bulk-merge every open PR carrying the "review:aprobado" label. Each PR is
  // test-merged against origin/main in a throwaway worktree first: clean PRs
  // are merged with --squash, conflicting PRs are left untouched but get a
  // [mergeador] comment listing the conflicting files plus the
  // "conflicto:main" label so the card can offer RESOLVER CONFLICTO.
  // Processing is strictly sequential (never parallel): the next PR must see
  // a main already updated by the previous merge.
  ipcMain.handle(
    "github:merge-approved-prs",
    async (
      _event,
      cwd: string,
    ): Promise<
      | {
          ok: true;
          summary: {
            merged: number[];
            conflicted: Array<{ number: number; files: string[] }>;
          };
        }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      const gitOpts = {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      };
      const ghOpts = {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env: execEnv,
      };

      // Live progress stream for the merge progress panel: the bulk merge is
      // a batch of slow operations (fetch, throwaway worktree, test merge),
      // so the renderer shows per-PR state instead of a silent spinner.
      const emitMergeProgress = (event: MergeProgressEvent) => {
        mainWindow?.webContents.send("merge:progress", event);
      };

      try {
        // The approved label must exist before any PR can receive it via
        // `gh issue edit --add-label` below (gh errors on unknown labels).
        await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_APPROVED);
        // List ALL open PRs (not filtered by label): the label is the primary
        // contract, but the review verdict line is the fallback — the label
        // flip only runs when the review terminal exits, and if that never
        // happened (closed app, crashed terminal) an approved PR would be
        // invisible to the bulk merge. A PR is approved when it carries the
        // label OR its newest review body says "VEREDICTO: APROBADO".
        const { stdout } = await execFileAsync(
          "gh",
          [
            "pr", "list",
            "--state", "open",
            "--json", "number,headRefName,title,labels,reviews",
            "--jq", "[.[] | {number, headRefName, title, labels: [.labels[].name], reviews: [.reviews[] | .body]}]",
            "--limit", "100",
          ],
          { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, env: execEnv },
        );
        const openPrs = JSON.parse(stdout) as Array<{
          number: number;
          headRefName: string;
          title: string;
          labels: string[];
          reviews: Array<string | null>;
        }>;
        // Same contract as getPrReviewDecision: the NEWEST review whose body
        // carries the verdict line wins (gh returns reviews oldest-first).
        const prs = openPrs
          .filter((pr) => {
            // Un PR con el gate fallido nunca se mergea: primero hay que
            // resolver (push nuevo) o forzar la review (quita gate:fallo).
            if (pr.labels.includes(REVIEW_LABEL_GATE_FAIL)) return false;
            if (pr.labels.includes(REVIEW_LABEL_APPROVED)) return true;
            let approved = false;
            for (const body of pr.reviews) {
              approved = parseReviewBodyVerdict(body) === "APROBADO";
            }
            return approved;
          })
          .map(({ number, headRefName, title }) => ({ number, headRefName, title }))
          .sort((a, b) => a.number - b.number);

        const merged: number[] = [];
        const conflicted: Array<{ number: number; files: string[] }> = [];
        if (prs.length === 0) {
          console.log("[mergeador] No approved PRs to merge");
          return { ok: true as const, summary: { merged, conflicted } };
        }
        emitMergeProgress({ type: "start", prNumbers: prs.map((p) => p.number) });

        // The conflict label must exist before any PR can receive it.
        await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_CONFLICT);

        for (const pr of prs) {
          const worktreePath = path.join(
            cwd,
            ".worktrees",
            `merge-check-${pr.number}`,
          );
          const log = (message: string) =>
            console.log(`[mergeador] PR #${pr.number}: ${message}`);
          try {
            emitMergeProgress({ type: "pr-start", prNumber: pr.number });
            // Materialize the approved label before merging: a PR approved by
            // verdict (not by label) must end up labeled too, so the repo
            // state matches the contract for future runs.
            await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_CHANGES);
            await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_FIX_APPLIED);
            await ensureReviewLabel(execFileAsync, cwd, REVIEW_LABEL_PENDING);
            await execFileAsync(
              "gh",
              [
                "issue", "edit", String(pr.number),
                "--add-label", REVIEW_LABEL_APPROVED,
                "--remove-label", REVIEW_LABEL_CHANGES,
                "--remove-label", REVIEW_LABEL_FIX_APPLIED,
                "--remove-label", REVIEW_LABEL_PENDING,
              ],
              { cwd, ...ghOpts },
            );
            // Mirror the approved state onto the associated issue so the
            // issue reflects the PR in every state, not just conflict.
            const approvedIssueNumber = await issueNumberForPr(
              execFileAsync,
              cwd,
              pr.number,
            );
            if (approvedIssueNumber !== null) {
              await syncReviewLabelToIssue(
                execFileAsync,
                cwd,
                approvedIssueNumber,
                REVIEW_LABEL_APPROVED,
              );
            }
            log("fetching main and branch");
            emitMergeProgress({ type: "step", prNumber: pr.number, phase: "fetch" });
            await execFileAsync("git", ["fetch", "origin", "main"], {
              cwd,
              ...gitOpts,
            });
            await execFileAsync(
              "git",
              ["fetch", "origin", `refs/heads/${pr.headRefName}`],
              { cwd, ...gitOpts },
            );
            // --detach is required: the PR branch is checked out in the
            // implementer worktree, and git refuses a second checkout of the
            // same branch.
            log("creating throwaway worktree");
            emitMergeProgress({ type: "step", prNumber: pr.number, phase: "worktree" });
            await execFileAsync(
              "git",
              [
                "worktree", "add", "--detach",
                worktreePath, `origin/${pr.headRefName}`,
              ],
              { cwd, ...gitOpts },
            );
            let mergeClean = false;
            try {
              emitMergeProgress({ type: "step", prNumber: pr.number, phase: "test-merge" });
              await execFileAsync(
                "git",
                ["merge", "origin/main", "--no-commit", "--no-ff"],
                { cwd: worktreePath, ...gitOpts },
              );
              mergeClean = true;
            } catch {
              // Conflict (or a real failure): handled below from the
              // worktree state.
            }
            if (mergeClean) {
              log("merging with --squash");
              emitMergeProgress({ type: "step", prNumber: pr.number, phase: "merge" });
              // Preserve the PR body in the squash commit: it carries
              // "Closes #N" (the issue auto-close contract) and documenting
              // who merged. Passed via --body-file, never -b (a body with
              // markdown checkboxes would be parsed as gh flags).
              let bodyFile: string | null = null;
              try {
                const { stdout: prBody } = await execFileAsync(
                  "gh",
                  ["pr", "view", String(pr.number), "--json", "body", "--jq", ".body"],
                  { cwd, ...ghOpts },
                );
                const mergeBody = [prBody.trim(), "Merged via TermCanvas"]
                  .filter(Boolean)
                  .join("\n\n");
                bodyFile = path.join(
                  os.tmpdir(),
                  `termcanvas-merge-body-${pr.number}-${Date.now()}.md`,
                );
                fs.writeFileSync(bodyFile, mergeBody, "utf8");
              } catch {
                // Best-effort: fall back to a bare squash merge without a
                // custom body if the body read fails.
              }
              try {
                await execFileAsync(
                  "gh",
                  bodyFile
                    ? ["pr", "merge", String(pr.number), "--squash", "--body-file", bodyFile]
                    : ["pr", "merge", String(pr.number), "--squash"],
                  { cwd, ...ghOpts },
                );
              } finally {
                if (bodyFile) {
                  try {
                    fs.unlinkSync(bodyFile);
                  } catch {
                    // Temp file cleanup is best-effort.
                  }
                }
              }
              merged.push(pr.number);
              emitMergeProgress({ type: "pr-merged", prNumber: pr.number });
              log("merged");
            } else {
              // Capture the conflicting files WHILE the merge is still in
              // progress: `git merge --abort` below clears the index, after
              // which --diff-filter=U would find nothing to report.
              let files: string[] = [];
              try {
                const { stdout: diffOut } = await execFileAsync(
                  "git",
                  ["diff", "--name-only", "--diff-filter=U"],
                  { cwd: worktreePath, ...gitOpts },
                );
                files = diffOut
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean);
              } catch {
                // Aborting below will surface any real problem.
              }
              // Best-effort abort: it is a no-op when the test merge was
              // "Already up to date" (no MERGE_HEAD was created, e.g. main has
              // not advanced past the branch) and required when the merge left
              // the index dirty.
              try {
                await execFileAsync("git", ["merge", "--abort"], {
                  cwd: worktreePath,
                  ...gitOpts,
                });
              } catch {
                // MERGE_HEAD missing — nothing to abort, state is already
                // clean. Not a merge blocker.
              }
              if (files.length > 0) {
                await ensureReviewLabel(
                  execFileAsync,
                  cwd,
                  REVIEW_LABEL_CONFLICT,
                );
                const body = [
                  "[mergeador] Conflicto al integrar con main. El test-merge falló en estos archivos:",
                  "",
                  ...files.map((f) => `- ${f}`),
                  "",
                  "Para resolverlo, en tu rama local: `git merge origin/main`, resolvé los marcadores <<<<<<< / ======= / >>>>>>> preservando la intención de ambos lados, después `git add` los archivos y `git commit`. Pusheá el resultado (`git push`) y el mergeador reintentará cuando el PR vuelva a quedar aprobado.",
                ].join("\n");
                await execFileAsync(
                  "gh",
                  ["issue", "comment", String(pr.number), "--body", body],
                  { cwd, ...ghOpts },
                );
                await execFileAsync(
                  "gh",
                  [
                    "issue", "edit", String(pr.number),
                    "--add-label", REVIEW_LABEL_CONFLICT,
                    // A conflicting PR must never stay approved: dropping the
                    // approved label (and every other cycle label) prevents a
                    // future run from merging it again before a re-review.
                    "--remove-label", REVIEW_LABEL_APPROVED,
                    "--remove-label", REVIEW_LABEL_CHANGES,
                    "--remove-label", REVIEW_LABEL_FIX_APPLIED,
                    "--remove-label", REVIEW_LABEL_PENDING,
                  ],
                  { cwd, ...ghOpts },
                );
                // Mirror the conflict state onto the associated issue.
                const conflictIssueNumber = await issueNumberForPr(
                  execFileAsync,
                  cwd,
                  pr.number,
                );
                if (conflictIssueNumber !== null) {
                  await syncReviewLabelToIssue(
                    execFileAsync,
                    cwd,
                    conflictIssueNumber,
                    REVIEW_LABEL_CONFLICT,
                  );
                }
                conflicted.push({ number: pr.number, files });
                emitMergeProgress({ type: "pr-conflicted", prNumber: pr.number, files });
                log(`conflict in ${files.length} file(s)`);
              } else {
                // A failed test merge with zero unmerged files means the
                // checkout itself is broken (e.g. local changes in the
                // throwaway worktree). Surface it as an error so the PR never
                // stalls silently in "Procesando".
                const message =
                  "El test-merge falló sin archivos en conflicto detectables. Revisá el estado del worktree de prueba.";
                log("merge check failed (no conflicting files)");
                emitMergeProgress({ type: "pr-error", prNumber: pr.number, message });
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`check failed: ${message}`);
            emitMergeProgress({ type: "pr-error", prNumber: pr.number, message });
          } finally {
            try {
              await execFileAsync(
                "git",
                ["worktree", "remove", "--force", worktreePath],
                { cwd, ...gitOpts },
              );
            } catch {
              // Best-effort cleanup: a failed add leaves nothing to remove.
            }
            try {
              await execFileAsync("git", ["worktree", "prune"], {
                cwd,
                ...gitOpts,
              });
            } catch {
              // Prune is cosmetic.
            }
          }
        }

        console.log(
          `[mergeador] Done: merged ${merged.length}, conflicted ${conflicted.length}`,
        );
        emitMergeProgress({ type: "done", merged, conflicted });
        return { ok: true as const, summary: { merged, conflicted } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitMergeProgress({ type: "error", message });
        return { ok: false as const, error: message };
      }
    },
  );

  // GATE DE CALIDAD (issues): corre scripts/run-issue-gate.mjs contra el PR
  // en un worktree descartable (patrón del mergeador: fetch → worktree
  // detached + junction de node_modules) para no interferir con el agente
  // implementador. El renderer (issueGate.ts) aplica la política de labels:
  // PASS → review:pendiente; FAIL → gate:fallo; error de infra → review
  // igual (el gate no debe romper el flujo por problemas de entorno).
  ipcMain.handle(
    "github:run-issue-gate",
    async (
      _event,
      cwd: string,
      prNumber: number,
    ): Promise<
      | {
          ok: true;
          verdict: "PASS" | "FAIL";
          failedChecks: string[];
          checks: Array<{ name: string; status: string; note: string | null }>;
          reportPath: string;
          headRefOid: string;
        }
      | { ok: false; error: string }
    > => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      const gitOpts = { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 };
      const ghOpts = {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env: execEnv,
      };
      const log = (message: string) => console.log(`[issue-gate] PR #${prNumber}: ${message}`);

      let worktreePath: string | null = null;
      try {
        // 1) Shas del PR: el gate trabaja con shas explícitos (base/head),
        // sin depender de refs locales ni de la rama checked out.
        const { stdout: prJson } = await execFileAsync(
          "gh",
          [
            "pr", "view", String(prNumber),
            "--json", "state,headRefName,headRefOid,baseRefOid",
            "--jq", "{ state: .state, headRefName: .headRefName, headRefOid: .headRefOid, baseRefOid: .baseRefOid }",
          ],
          { cwd, ...ghOpts },
        );
        const pr = JSON.parse(prJson) as {
          state: string;
          headRefName: string;
          headRefOid: string;
          baseRefOid: string;
        };
        if (pr.state !== "OPEN") {
          return {
            ok: false as const,
            error: `PR #${prNumber} no está abierto (state: ${pr.state})`,
          };
        }
        if (!pr.headRefOid || !pr.baseRefOid) {
          return { ok: false as const, error: `PR #${prNumber} sin shas (headRefOid/baseRefOid)` };
        }
        log(`head ${pr.headRefOid.slice(0, 8)} (${pr.headRefName}) → base ${pr.baseRefOid.slice(0, 8)}`);

        // 2) Fetch de main + rama del PR (mismo contrato que el mergeador).
        await execFileAsync("git", ["fetch", "origin", "main"], { cwd, ...gitOpts });
        await execFileAsync(
          "git",
          ["fetch", "origin", `refs/heads/${pr.headRefName}`],
          { cwd, ...gitOpts },
        );

        // 3) Worktree descartable detached del head (nunca toca la rama local
        // del implementador) + junction de node_modules para correr los tests
        // sin un npm install completo.
        worktreePath = path.join(cwd, ".worktrees", `gate-check-${prNumber}`);
        await execFileAsync(
          "git",
          ["worktree", "add", "--detach", worktreePath, `origin/${pr.headRefName}`],
          { cwd, ...gitOpts },
        );
        const nmSrc = path.join(cwd, "node_modules");
        if (fs.existsSync(nmSrc)) {
          try {
            await execFileAsync(
              "cmd",
              ["/c", "mklink", "/J", path.join(worktreePath, "node_modules"), nmSrc],
              { cwd, timeout: 30_000 },
            );
          } catch {
            log("junction de node_modules falló; el gate degradará los checks que lo requieran");
          }
        }

        // 4) Correr el orquestador del gate (proceso headless, sin tokens).
        const outDir = path.join(cwd, ".agents", "planning");
        fs.mkdirSync(outDir, { recursive: true });
        const orchestrator = path.join(__dirname, "..", "scripts", "run-issue-gate.mjs");
        const before = new Set(
          fs.existsSync(outDir)
            ? fs.readdirSync(outDir).filter((f) => /^gate-verdict-\d+\.json$/.test(f))
            : [],
        );
        log("corriendo el gate (puede tardar 2-6 min)…");
        await execFileAsync(
          "node",
          [
            orchestrator,
            "--repo", worktreePath,
            "--base", pr.baseRefOid,
            "--head", pr.headRefOid,
            "--out", outDir,
          ],
          { cwd, timeout: 900_000, maxBuffer: 64 * 1024 * 1024, env: execEnv },
        );
        const after = fs
          .readdirSync(outDir)
          .filter((f) => /^gate-verdict-\d+\.json$/.test(f) && !before.has(f))
          .sort();
        const newest = after[after.length - 1];
        if (!newest) {
          return {
            ok: false as const,
            error: "El gate terminó sin escribir gate-verdict-*.json (revisá scripts/run-issue-gate.mjs)",
          };
        }
        const reportPath = path.join(outDir, newest);
        const verdictJson = JSON.parse(
          fs.readFileSync(reportPath, "utf8"),
        ) as {
          verdict: "PASS" | "FAIL";
          failed_checks: string[];
          checks: Array<{ name: string; status: string; note: string | null }>;
        };

        // 5) Copia con nombre estable (cache por sha): gate-pr-<N>-<sha>.json.
        const stableName = `gate-pr-${prNumber}-${pr.headRefOid.slice(0, 12)}.json`;
        try {
          fs.copyFileSync(reportPath, path.join(outDir, stableName));
        } catch {
          /* best effort: el reporte original queda como audit trail */
        }
        log(`veredicto ${verdictJson.verdict}${verdictJson.failed_checks.length ? ` (${verdictJson.failed_checks.join(", ")})` : ""} → ${stableName}`);
        return {
          ok: true as const,
          verdict: verdictJson.verdict,
          failedChecks: verdictJson.failed_checks,
          checks: verdictJson.checks,
          reportPath: path.join(outDir, stableName),
          headRefOid: pr.headRefOid,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`error: ${message}`);
        return { ok: false as const, error: message };
      } finally {
        if (worktreePath) {
          try {
            fs.rmSync(path.join(worktreePath, "node_modules"), {
              recursive: true,
              force: true,
            });
          } catch {
            /* best effort */
          }
          try {
            await execFileAsync(
              "git",
              ["worktree", "remove", "--force", worktreePath],
              { cwd, ...gitOpts },
            );
          } catch {
            /* best effort */
          }
          try {
            await execFileAsync("git", ["worktree", "prune"], { cwd, ...gitOpts });
          } catch {
            /* best effort */
          }
        }
      }
    },
  );

  // Auditoría de seguridad del repo: delega en
  // scripts/configure-github-security.mjs --audit (resuelve owner/repo del
  // remote, detecta visibilidad/permisos y el estado actual por feature).
  ipcMain.handle(
    "github:security-audit",
    async (_event, cwd: string): Promise<SecurityAuditResponse> => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const execEnv: NodeJS.ProcessEnv = { ...process.env };
      if (!execEnv.GH_TOKEN && process.env.GITHUB_TOKEN) {
        execEnv.GH_TOKEN = process.env.GITHUB_TOKEN;
      }
      if (!execEnv.GITHUB_TOKEN && process.env.GH_TOKEN) {
        execEnv.GITHUB_TOKEN = process.env.GH_TOKEN;
      }
      const orchestrator = path.join(__dirname, "..", "scripts", "configure-github-security.mjs");
      try {
        const { stdout } = await execFileAsync(
          "node",
          [orchestrator, "--audit", "--repo", cwd],
          { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: execEnv },
        );
        const parsed = JSON.parse(stdout) as SecurityAuditResponse;
        return parsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[security-audit] error: ${message}`);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    "pin:save-attachment",
    (
      _event,
      repo: string,
      id: string,
      fileName: string,
      data: ArrayBuffer | Uint8Array,
    ) => {
      const buffer = Buffer.from(
        data instanceof Uint8Array ? data : new Uint8Array(data),
      );
      return taskStore.saveAttachment(repo, id, fileName, buffer);
    },
  );

  // Inject a pin's body + image attachments into a terminal via the existing
  // composer-submit pipeline. We deliberately do not mutate pin.status here:
  // dispatching the same pin to multiple terminals is a supported flow, and
  // status changes stay manual.
  ipcMain.handle(
    "pin:dispatch-to-terminal",
    async (
      _event,
      repo: string,
      pinId: string,
      target: {
        terminalId: string;
        ptyId: number;
        terminalType: ComposerSupportedTerminalType;
        worktreePath: string;
      },
    ) => {
      const pin = taskStore.get(repo, pinId);
      if (!pin) {
        return {
          ok: false,
          code: "internal-error" as const,
          stage: "validate" as const,
          error: `Pin not found: ${pinId}`,
          detail: `Pin not found: ${pinId}`,
        };
      }

      if (!ptyManager.getPid(target.ptyId)) {
        return {
          ok: false,
          code: "target-not-running" as const,
          stage: "target" as const,
          error: "Target terminal is not running.",
          detail: "Target terminal is not running.",
        };
      }

      const { text, images } = await buildPinComposerPayload(
        pin,
        taskStore.attachmentsDir(repo, pinId),
      );

      // Paste-only — fill the agent's input buffer with the title + body
      // (and stage attachments) but leave submission to the user. They
      // review the prompt in context, edit if needed, and hit Enter
      // themselves.
      const request: ComposerSubmitRequest = {
        terminalId: target.terminalId,
        ptyId: target.ptyId,
        terminalType: target.terminalType,
        worktreePath: target.worktreePath,
        text,
        images,
        submit: false,
      };

      try {
        const result = await submitComposerRequest(
          request,
          createDefaultComposerSubmitDeps(
            process.platform as "darwin" | "win32" | "linux",
            dataUrlToPngBuffer,
            (ptyId: number, data: string) => {
              ptyManager.write(ptyId, data);
            },
          ),
        );

        if (!result.ok) {
          console.error("[Pin] Dispatch failed:", {
            pinId,
            terminalId: target.terminalId,
            ptyId: target.ptyId,
            terminalType: target.terminalType,
            stage: result.stage,
            code: result.code,
            detail: result.detail ?? result.error,
          });
        }

        return result;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[Pin] Dispatch crashed:", {
          pinId,
          terminalId: target.terminalId,
          detail,
        });
        return {
          ok: false,
          code: "internal-error" as const,
          stage: "submit" as const,
          error: detail,
          detail,
        };
      }
    },
  );
}

function getCliDir(): string {
  const prodDir = path.join(process.resourcesPath, "cli");
  if (fs.existsSync(prodDir)) return prodDir;
  return path.resolve(__dirname, "..", "dist-cli");
}

function dataUrlToPngBuffer(dataUrl: string): Buffer {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Invalid image data.");
  }
  return image.toPNG();
}

const CLI_NAMES = ["termcanvas", "browse"];
const AGENT_SHIM_NAMES = ["codex", "claude"];

function ensureCliLinks(): void {
  const cliDir = getCliDir();
  if (!fs.existsSync(cliDir)) return;

  for (const name of CLI_NAMES) {
    const jsFile = path.join(cliDir, `${name}.js`);
    try {
      ensureCliLauncher(jsFile);
    } catch {}
  }

  const shimDir = getAgentShimDir(cliDir);
  if (!fs.existsSync(shimDir)) return;
  for (const name of AGENT_SHIM_NAMES) {
    const jsFile = path.join(shimDir, `${name}.js`);
    try {
      ensureCliLauncher(jsFile);
    } catch {}
  }
}

function getSkillSourceDir(): string {
  return getSkillsSourceDir(process.resourcesPath, __dirname);
}

function installSkill(): boolean {
  return installSkillLinks({
    sourceDir: getSkillSourceDir(),
    appVersion: app.getVersion(),
  });
}

function ensureSkillInstalled(): boolean {
  return ensureSkillLinks({
    sourceDir: getSkillSourceDir(),
    appVersion: app.getVersion(),
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("termcanvas", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("termcanvas");
}

app.whenReady().then(async () => {
  renderDiagnostics.recordMainEvent("app_ready", {
    app_version: app.getVersion(),
    isDev,
    platform: process.platform,
    user_data_path: app.getPath("userData"),
  });

  // Serve pin attachment images. Path-traversal guard: resolved disk path
  // must stay under TERMCANVAS_DIR/pins/. Renderer constructs URLs as
  // tc-attachment://local/<abs-path>; handler decodes pathname back to a
  // real path and streams the file via Electron's net.fetch.
  const ATTACHMENTS_ROOT = path.join(TERMCANVAS_DIR, "pins");
  protocol.handle("tc-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const requestedPath = decodeURIComponent(url.pathname);
      const resolved = path.resolve(requestedPath);
      if (
        resolved !== ATTACHMENTS_ROOT &&
        !resolved.startsWith(ATTACHMENTS_ROOT + path.sep)
      ) {
        return new Response("forbidden", { status: 403 });
      }
      return await net.fetch(pathToFileURL(resolved).toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(message, { status: 500 });
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      contents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url)) {
          void shell.openExternal(url);
        }
        return { action: "deny" };
      });
      // Strip Electron/app identifiers from UA to avoid being blocked by sites
      const ua = contents
        .getUserAgent()
        .replace(/\s*Electron\/\S+/, "")
        .replace(/\s*termcanvas\/\S+/i, "");
      contents.setUserAgent(ua);
    }
  });

  try {
    hookSocketPath = await hookReceiver.start();
  } catch (error) {
    hookSocketPath = null;
    console.error("[HookReceiver] Startup disabled:", error);
  }
  let previousSessionHistoryScope = new Map<string, string>();
  sessionScanner.start((sessions) => {
    const nextSessionHistoryScope = buildSessionHistoryScope(sessions);
    const { projectDirs, invalidatedFilePaths } = diffSessionHistoryScopes(
      previousSessionHistoryScope,
      nextSessionHistoryScope,
    );
    previousSessionHistoryScope = nextSessionHistoryScope;
    for (const filePath of invalidatedFilePaths) {
      invalidateSessionIndexForFile(filePath);
    }

    const managed = telemetryService.getManagedSessions();
    const merged = mergeAndDedupeSessions(managed, sessions);
    sendToWindow(mainWindow, "sessions:list-changed", merged);
    emitSessionHistoryChanged({
      reason: "session_scan_changed",
      projectDirs,
    });
  });
  ensureCliLinks();
  syncCliIntegrationOnStartup({
    autoRegisterEnabled: readCliIntegrationState().autoRegister,
    cliRegistered: isCliRegistered(getCliDir()),
    registerCli: () => registerCli(getCliDir()),
    ensureSkills: ensureSkillInstalled,
    persistAutoRegisterEnabled: (enabled) => {
      writeCliIntegrationState({ autoRegister: enabled });
    },
  });
  setupIpc();
  registerContextSyncIpc();
  registerMcpIpc(mcpManager);
  // Sync global opencode MCPs (context7, engram, codegraph) to CodeBuddy user scope
  // and global skills to .codebuddy/skills so `codebuddy` in any shell sees them
  // without per-project toggle. Run after window creation and non-blocking.
  setTimeout(() => {
    try {
      syncGlobalMcpToCodebuddy();
    } catch (err) {
      console.warn("[mcp:codebuddy] global sync on startup failed:", err);
    }
    const defaultProject = "C:\\Users\\Estudiante UCU\\OneDrive\\Escritorio\\termcanvas";
    void syncGlobalSkillsToCodebuddy(defaultProject).catch(() => {});
    void syncGlobalSkillsToCodebuddy(process.cwd()).catch(() => {});
    try {
      const statePath = path.join(TERMCANVAS_DIR, "state.json");
      if (fs.existsSync(statePath)) {
        const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        const projects = Array.isArray(raw) ? raw : (raw as { projects?: unknown[] }).projects ?? [];
        for (const p of projects as Array<{ path?: unknown }>) {
          if (p?.path && typeof p.path === "string") {
            void syncGlobalSkillsToCodebuddy(p.path).catch(() => {});
          }
        }
      }
    } catch {}
  }, 1000);
  registerInterviewIpc();
  // Catálogo de modelos + routing por fase (models:*).
  registerModelCatalogIpc();
  await initAuth();
  createWindow();
  // Feed "IA actuando": los eventos del motor viajan a la ventana.
  setInterviewActivitySink((payload) =>
    sendToWindow(mainWindow, "interview:activity", payload),
  );
  if (mainWindow) setupAutoUpdater(mainWindow);

  onAuthStateChange((user) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:state-changed", user);
    }
    if (user) {
      backfillHistory().catch((err) =>
        console.error("[Auth] Backfill error:", err),
      );
      flushSyncQueue().catch((err) =>
        console.error("[Auth] Queue flush error:", err),
      );
    }
  });

  setInterval(() => {
    if (isLoggedIn()) {
      flushSyncQueue().catch((err) =>
        console.error("[UsageSync] Periodic flush error:", err),
      );
      syncRecentRecords().catch((err) =>
        console.error("[UsageSync] Periodic sync error:", err),
      );
    }
  }, 5 * 60_000);

  app.on("open-url", async (_event, url) => {
    if (url.startsWith("termcanvas://auth/callback")) {
      await handleAuthCallback(url);
    }
  });

  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const authUrl = argv.find((arg) =>
      arg.startsWith("termcanvas://auth/callback"),
    );
    if (authUrl) {
      handleAuthCallback(authUrl);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let isQuitting = false;
app.on("will-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  renderDiagnostics.recordMainEvent("app_will_quit", {
    platform: process.platform,
  });
  void (async () => {
    outputBatcher.dispose();
    await ptyManager.destroyAll();
    gitWatcher.unwatchAll();
    fileTreeWatcher.unwatchAll();
    sessionWatcher.unwatchAll();
    hookReceiver.stop();
    stopAutoUpdater();
    apiServer.stop();
    closeInterviewService();
    cleanupPortFile();
    app.quit();
  })();
});

// macOS convention: keep the process alive in the dock when the last window
// closes; the `activate` handler above re-creates a window when the user
// clicks the dock icon. Other platforms still quit. The preference is set
// from the renderer via `app:set-quit-on-last-window-closed` and lets the
// user opt out of the macOS behavior.
let quitOnLastWindowClosed = false;
ipcMain.on("app:set-quit-on-last-window-closed", (_event, value: unknown) => {
  quitOnLastWindowClosed = value === true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitOnLastWindowClosed) {
    app.quit();
  }
});
