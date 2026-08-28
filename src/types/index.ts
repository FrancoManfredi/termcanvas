import type { SceneDocument } from "./scene";
import type { SecurityAuditResponse } from "./repoSecurity";
import type {
  InitResult as ContextSyncInit,
  PullResult as ContextSyncPull,
  PushResult as ContextSyncPush,
  StatusResult as ContextSyncStatus,
  SyncConfig as ContextSyncConfig,
} from "../../cli/context-sync/operations.ts";
import type {
  TelemetryEventPage,
  TelemetryProvider,
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../../shared/telemetry";
import type {
  RenderDiagnosticEventInput,
  RenderDiagnosticsLogInfo,
} from "../../shared/render-diagnostics";
import type { SessionHistoryChangedEvent } from "../../shared/sessions";
import type {
  CatalogResult,
  ModelCatalog,
  PhaseValidation,
} from "../../shared/modelCatalog";
import type {
  ModelRef,
  PhaseActivityEvent,
  PhaseId,
} from "../../shared/phaseModels";
import type {
  Pin,
  PinLink,
  PinStatus,
  CreatePinInput,
  UpdatePinInput,
} from "../../shared/pin";
import type {
  TurnResult,
  UserAnswerInput,
  InterviewLedger,
  InterviewQuestion,
  InterviewSummary,
  BriefDocument,
  BriefInterviewPosition,
  SynthesisResult,
  StoryMutationResult,
  CurationKind,
} from "../../headless-runtime/interview/index.ts";
import type {
  TacticStatusEntry,
  TacticsAnalysisOutput,
  TacticsConsolidationOutput,
  DecisionValidationOutput,
  ConfirmTacticDecisionInput,
  ConfirmTacticDecisionResult,
  TacticaCandidata,
  EstadoAnalisisTacticas,
} from "../../headless-runtime/interview/tactics.ts";

export type { Pin, PinLink, PinStatus, CreatePinInput, UpdatePinInput };
export type { BriefInterviewPosition } from "../../headless-runtime/interview/index.ts";

// Contexto del proyecto (Fase 0) visto desde la UI: los briefs sintetizados
// del proyecto, cuál está marcado como activo (el motor lo usa en cada
// llamada) y las entrevistas de contexto en progreso. Es el shape que
// devuelve el IPC interview:briefStatus.
export interface BriefListItem {
  brief: BriefDocument;
  path: string;
  timestamp: number;
}

export interface BriefInterviewInProgress {
  ledgerPath: string;
  timestamp: number;
  answers_count: number;
  total_questions: number;
}

export interface BriefStatus {
  briefs: BriefListItem[];
  activePath: string | null;
  inProgress: BriefInterviewInProgress[];
}

type SessionTelemetryProvider = Exclude<TelemetryProvider, "unknown">;

export type PinEvent =
  | { type: "pin:created"; pin: Pin; repo: string }
  | { type: "pin:updated"; pin: Pin; repo: string }
  | { type: "pin:removed"; id: string; repo: string };

// Progress events streamed from the main process while the bulk merge runs
// (github:merge-approved-prs). The renderer maps them into the merge progress
// panel; "done"/"error" are always emitted before the invoke resolves, so the
// panel can outlive the operation for review.
export type MergePhase =
  | "label"
  | "fetch"
  | "worktree"
  | "test-merge"
  | "merge";

export type MergeProgressEvent =
  | { type: "start"; prNumbers: number[] }
  | { type: "pr-start"; prNumber: number }
  | { type: "step"; prNumber: number; phase: MergePhase }
  | { type: "pr-merged"; prNumber: number }
  | { type: "pr-conflicted"; prNumber: number; files: string[] }
  | { type: "pr-error"; prNumber: number; message: string }
  | {
      type: "done";
      merged: number[];
      conflicted: Array<{ number: number; files: string[] }>;
    }
  | { type: "error"; message: string };

export * from "./scene";

export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
  | "wuu"
  | "lazygit"
  | "tmux";

export interface Position {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export type TerminalStatus =
  | "running"
  | "active"
  | "waiting"
  | "completed"
  | "success"
  | "error"
  | "idle";

export type ComposerSupportedTerminalType = TerminalType;

export interface ComposerImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
}

export interface ComposerSubmitRequest {
  terminalId: string;
  ptyId: number;
  terminalType: ComposerSupportedTerminalType;
  worktreePath: string;
  text: string;
  images: ComposerImageAttachment[];
  /**
   * When false, paste the text and stage any images but DO NOT send the
   * Enter key — leaves the prompt in the agent's input buffer for the user
   * to review/edit/submit themselves. Defaults to true to preserve the
   * existing composer:submit behavior; pin drag-and-drop opts out.
   */
  submit?: boolean;
}

export type ComposerSubmitIssueStage =
  | "target"
  | "validate"
  | "read-images"
  | "prepare-images"
  | "paste-image"
  | "paste-text"
  | "submit";

export type ComposerSubmitIssueCode =
  | "target-not-running"
  | "unsupported-terminal"
  | "empty-submit"
  | "images-unsupported"
  | "image-read-failed"
  | "image-stage-failed"
  | "pty-write-failed"
  | "submit-key-failed"
  | "internal-error";

export interface ComposerSubmitResult {
  ok: boolean;
  requestId?: string;
  stagedImagePaths?: string[];
  error?: string;
  detail?: string;
  code?: ComposerSubmitIssueCode;
  stage?: ComposerSubmitIssueStage;
}

export type TerminalOrigin = "user" | "agent";

export interface TerminalData {
  id: string;
  title: string;
  customTitle?: string;
  starred?: boolean;
  type: TerminalType;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  tags: string[];
  origin?: TerminalOrigin;
  parentTerminalId?: string;
  scrollback?: string;
  sessionId?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  stashed?: boolean;
  stashedAt?: number;
  issueNumber?: number;
  // Set on review terminals: the runtime auto-cleans the review worktree
  // when the CLI process exits, so review sessions never leave garbage.
  reviewIssueNumber?: number;
  // Headless (non-interactive) runs: the CLI is launched with its `run`
  // subcommand and the initialPrompt passed positionally, streams its
  // output to the same PTY and exits by itself — no TUI, no resume, no
  // session capture. The caller (e.g. the planning session) observes the
  // result artifact or the process exit to finish the flow.
  headlessRun?: boolean;
  // Headless runs with a custom command (e.g. `node scripts/run-<tool>.mjs
  // --repo <path>`): overrides the shell and args of the launch entirely.
  // Same lifecycle as headlessRun (no TUI, no resume, no session capture,
  // exits by itself). Used by the deterministic-tools phase of the
  // diagnosis pipeline.
  headlessShell?: string;
  headlessArgs?: string[];
  // Pin de modelo por fase (routing): el runtime lo convierte en flags del
  // CLI al spawnear (opencode TUI: -m provider/model; --variant no existe
  // en la TUI y se ignora). Lo setean las sesiones de planificación/
  // diagnóstico; los terminales manuales nunca lo traen.
  modelOverride?: string;
  variantOverride?: string;
  // Env vars extra SOLO para el proceso de este terminal (ej:
  // OPENCODE_CONFIG del scope de skills especializadas). Lo setea el
  // launcher de la sesión; se mergea sobre el env base en electron
  // (pty-launch envOverrides) sin afectar a otros terminales.
  envOverride?: Record<string, string>;
  // Captured when the review terminal is created, so the runtime can read
  // GitHub's reviewDecision from the PR before the worktree is deleted.
  reviewPrNumber?: number;
}

export interface TerminalRuntimeState {
  ptyId: number | null;
  status: TerminalStatus;
}

export type PersistedTerminalData = Omit<
  TerminalData,
  keyof TerminalRuntimeState
>;

export interface StashedTerminal {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}

export interface PersistedStashedTerminal {
  terminal: PersistedTerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}

export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  isPrimary?: boolean;
  collapsed?: boolean;
  terminals: TerminalData[];
}

export interface PersistedWorktreeData extends Omit<WorktreeData, "terminals"> {
  terminals: PersistedTerminalData[];
}

/**
 * A named viewport position the user can jump back to. Slots 1..9
 * are addressed by string-keyed map so the persisted JSON is stable
 * across saves (numeric object keys round-trip as strings anyway).
 */
export interface SpatialWaypoint {
  x: number;
  y: number;
  scale: number;
  savedAt: number;
}

export type SpatialWaypointSlot = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export type SpatialWaypointMap = Partial<Record<SpatialWaypointSlot, SpatialWaypoint>>;

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  collapsed?: boolean;
  worktrees: WorktreeData[];
  waypoints?: SpatialWaypointMap;
  /** MCP por proyecto (catálogo cerrado). Syncea vía sidecar privado; secretos en vault local. */
  mcp?: import("../../shared/mcp").ProjectMcpConfig;
}

export interface PersistedProjectData extends Omit<ProjectData, "worktrees"> {
  worktrees: PersistedWorktreeData[];
  mcp?: import("../../shared/mcp").ProjectMcpConfig;
}

export interface CanvasState {
  version?: 1;
  viewport: Viewport;
  projects: ProjectData[];
  drawings?: unknown[];
  browserCards?: Record<string, unknown>;
}

export interface SceneCanvasState {
  version: 2;
  scene: SceneDocument;
}

export type PersistedCanvasState =
  | CanvasState
  | SceneCanvasState
  | { skipRestore: true };

export interface UsageBucket {
  label: string;
  hourStart: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface ProjectUsage {
  path: string;
  name: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export type HydraInstructionFileName = "CLAUDE.md" | "AGENTS.md";
export type HydraInstructionStatus =
  | "created"
  | "appended"
  | "updated"
  | "unchanged";

export interface ProjectEnableHydraFileResult {
  fileName: HydraInstructionFileName;
  filePath: string;
  status: HydraInstructionStatus;
}

export interface ProjectEnableHydraSuccess {
  ok: true;
  repoPath: string;
  changed: boolean;
  files: ProjectEnableHydraFileResult[];
}

export interface ProjectEnableHydraFailure {
  ok: false;
  error: string;
}

export type ProjectEnableHydraResult =
  | ProjectEnableHydraSuccess
  | ProjectEnableHydraFailure;

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface UsageSummary {
  date: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate5m: number;
  totalCacheCreate1h: number;
  totalCost: number;
  buckets: UsageBucket[];
  projects: ProjectUsage[];
  models: ModelUsage[];
}

export interface UsageRangeDay {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface UsageRangeSummary {
  startDate: string;
  endDate: string;
  days: UsageRangeDay[];
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate5m: number;
  totalCacheCreate1h: number;
  totalCost: number;
  projects: ProjectUsage[];
  models: ModelUsage[];
}

export interface CloudUsageRangeSummary extends UsageRangeSummary {
  devices: DeviceUsage[];
}

export interface QuotaData {
  fiveHour: { utilization: number; resetsAt: string };
  sevenDay: { utilization: number; resetsAt: string };
  fetchedAt: number;
}

export type QuotaFetchResult =
  | { ok: true; data: QuotaData }
  | { ok: false; rateLimited: boolean };

export interface DeviceUsage {
  deviceId: string;
  tokens: number;
  cost: number;
  calls: number;
}

export interface CloudUsageSummary extends UsageSummary {
  devices: DeviceUsage[];
}

export interface InsightsProgressEvent {
  jobId: string;
  stage:
    | "validating"
    | "scanning"
    | "extracting_facets"
    | "aggregating"
    | "analyzing"
    | "generating_report";
  current: number;
  total: number;
  message: string;
}

export type InsightsGenerateResult =
  | { ok: true; jobId: string; reportPath: string }
  | {
      ok: false;
      jobId: string;
      error: { code: string; message: string; detail?: string };
    };

export interface GitBranchInfo {
  name: string;
  hash: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  message: string;
}

export interface GitCommitFile {
  name: string;
  additions: number;
  deletions: number;
  binary: boolean;
  isImage: boolean;
  imageOld: string | null;
  imageNew: string | null;
}

export interface GitCommitDetail {
  message: string;
  diff: string;
  files: GitCommitFile[];
}

export type GitFileStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?";

export interface GitStatusEntry {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  originalPath?: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  hash: string;
  date: string;
}

export interface GitTagInfo {
  name: string;
  hash: string;
  isAnnotated: boolean;
  message: string;
  date: string;
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitBlameEntry {
  hash: string;
  author: string;
  date: string;
  lineStart: number;
  lineCount: number;
  content: string;
}

export interface GitFileDiff {
  hunks: string[];
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
}

export type GitMergeState =
  | { type: "none" }
  | { type: "merge" }
  | { type: "rebase"; current: string; total: string }
  | { type: "cherry-pick" };

export type AgentStreamEvent =
  | { type: "stream_start" }
  | { type: "stream_end" }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; content: string; is_error?: boolean }
  | { type: "turn_start"; turn: number }
  | { type: "turn_end"; turn: number }
  | { type: "error"; error: { message: string } }
  | {
      type: "message_start";
      usage?: { input_tokens: number; output_tokens: number };
    }
  | { type: "message_delta"; stop_reason: string | null }
  | {
      type: "approval_request";
      request_id: string;
      tool_name: string;
      tool_input: Record<string, unknown>;
    }
  | {
      type: "system_init";
      model?: string;
      tools_count?: number;
      session_id?: string;
      slash_commands?: string[];
    }
  | {
      type: "result_info";
      cost_usd?: number;
      input_tokens?: number;
      output_tokens?: number;
      duration_ms?: number;
      num_turns?: number;
    };

export type IpcEnvelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export type {
  ContextSyncInit,
  ContextSyncPull,
  ContextSyncPush,
  ContextSyncStatus,
  ContextSyncConfig,
};

export type { ProjectMcpConfig, ProjectMcpStatus, McpServerState, McpCatalogEntry } from "../../shared/mcp.ts";

export interface TermCanvasAPI {
  // Rutas del lado de la app (proceso principal): scriptsDir es donde viven
  // los scripts de soporte (ej. run-diagnostico-tools.mjs del pipeline de
  // herramientas deterministas del Diagnóstico).
  paths: {
    scriptsDir: string;
  };
  // Sincronización del contexto (.agents) vía el sidecar privado
  // termcanvas-context. Misma lógica que `termcanvas context ...` en el CLI.
  contextSync: {
    status: (repoPath: string) => Promise<IpcEnvelope<ContextSyncStatus>>;
    init: (repoPath: string) => Promise<IpcEnvelope<ContextSyncInit>>;
    pull: (repoPath: string) => Promise<IpcEnvelope<ContextSyncPull>>;
    push: (repoPath: string) => Promise<IpcEnvelope<ContextSyncPush>>;
    /** Pull + push en un click; push se omite si el pull falla. */
    sync: (
      repoPath: string,
    ) => Promise<IpcEnvelope<{ pulled: ContextSyncPull; pushed: ContextSyncPush }>>;
    getConfig: (repoPath: string) => Promise<IpcEnvelope<ContextSyncConfig>>;
    setConfig: (repoPath: string, cfg: ContextSyncConfig) => Promise<IpcEnvelope<ContextSyncConfig>>;
  };
  mcp: {
    status: (projectId: string, projectPath: string) => Promise<IpcEnvelope<import("../../shared/mcp.ts").ProjectMcpStatus>>;
    setEnabled: (projectId: string, serverId: string, enabled: boolean, projectPath?: string) => Promise<IpcEnvelope<{ ok: boolean; status: string; error?: string }>>;
    setSecret: (projectId: string, serverId: string, token: string | null, projectPath?: string) => Promise<IpcEnvelope<{ ok: boolean; status: string; error?: string }>>;
    connect: (projectId: string, serverId: string) => Promise<IpcEnvelope<{ ok: boolean; status: string; error?: string }>>;
    disconnect: (projectId: string, serverId: string) => Promise<IpcEnvelope<{ ok: boolean }>>;
    getConfig: (projectId: string) => Promise<IpcEnvelope<import("../../shared/mcp.ts").ProjectMcpConfig>>;
    hydrateConfig: (projectId: string, config: import("../../shared/mcp.ts").ProjectMcpConfig, projectPath?: string) => Promise<IpcEnvelope<{ ok: boolean }>>;
    globalStatus: () => Promise<IpcEnvelope<Array<{ name: string; type: string; enabled: boolean; command?: string[]; url?: string; source: string; sourcePath: string }>>>;
    projectOpencodeStatus: (projectPath: string) => Promise<IpcEnvelope<Array<{ name: string; type: string; enabled: boolean; command?: string[]; url?: string; source: string; sourcePath: string }>>>;
    healthCheck: (projectId: string, serverId: string, projectPath: string) => Promise<IpcEnvelope<{ ok: boolean; latencyMs?: number; error?: string; details?: string }>>;
    addCustom: (projectId: string, projectPath: string, entry: import("../../shared/mcp.ts").McpCatalogEntry) => Promise<IpcEnvelope<{ ok: boolean }>>;
    updateCustom: (projectId: string, projectPath: string, id: string, patch: Partial<import("../../shared/mcp.ts").McpCatalogEntry>) => Promise<IpcEnvelope<{ ok: boolean }>>;
    removeCustom: (projectId: string, projectPath: string, id: string) => Promise<IpcEnvelope<{ ok: boolean }>>;
  };
  terminal: {
    create: (options: {
      cwd: string;
      shell?: string;
      args?: string[];
      terminalId?: string;
      terminalType?: string;
      theme?: "dark" | "light";
    }) => Promise<number>;
    destroy: (ptyId: number) => Promise<void>;
    getPid: (ptyId: number) => Promise<number | null>;
    input: (ptyId: number, data: string) => void;
    resize: (ptyId: number, cols: number, rows: number) => void;
    notifyThemeChanged: (ptyId: number) => void;
    onOutput: (callback: (ptyId: number, data: string) => void) => () => void;
    onExit: (callback: (ptyId: number, exitCode: number) => void) => () => void;
    detectCli: (ptyId: number) => Promise<{
      cliType: TerminalType;
      pid?: number;
      sessionName?: string;
      autoApprove?: boolean;
    } | null>;
  };
  session: {
    getCodexLatest: () => Promise<string | null>;
    findCodex: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "medium" | "weak";
    } | null>;
    findClaude: (
      cwd: string,
      startedAt?: string,
      pid?: number | null,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "strong" | "medium" | "weak";
    } | null>;
    findWuu: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "medium" | "weak";
    } | null>;
    getPermissionMode: (
      sessionId: string,
      cwd: string,
    ) => Promise<string | null>;
    getBypassState: (
      type: string,
      sessionId: string,
      cwd: string,
    ) => Promise<boolean>;
    getClaudeByPid: (pid: number) => Promise<string | null>;
    findKimi: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "medium" | "weak";
    } | null>;
    findOpenCode: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "medium" | "weak";
    } | null>;
    watch: (
      type: string,
      sessionId: string,
      cwd: string,
    ) => Promise<{ ok: boolean; reason?: string }>;
    unwatch: (sessionId: string) => Promise<void>;
    onTurnComplete: (callback: (sessionId: string) => void) => () => void;
  };
  telemetry: {
    attachSession: (input: {
      terminalId: string;
      provider: SessionTelemetryProvider;
      sessionId: string;
      cwd: string;
      confidence: "strong" | "medium" | "weak";
    }) => Promise<{ ok: boolean; sessionFile: string | null }>;
    detachSession: (terminalId: string) => Promise<void>;
    updateTerminal: (input: {
      terminalId: string;
      worktreePath?: string;
      provider?: TelemetryProvider;
      ptyId?: number | null;
      shellPid?: number | null;
    }) => Promise<TerminalTelemetrySnapshot>;
    getTerminal: (
      terminalId: string,
    ) => Promise<TerminalTelemetrySnapshot | null>;
    getWorkflow: (
      workflowId: string,
      repoPath: string,
    ) => Promise<WorkflowTelemetrySnapshot | null>;
    listEvents: (input: {
      terminalId: string;
      limit?: number;
      cursor?: string;
    }) => Promise<TelemetryEventPage>;
    onSnapshotChanged: (
      callback: (payload: {
        terminalId: string;
        snapshot: TerminalTelemetrySnapshot;
      }) => void,
    ) => () => void;
  };
  diagnostics: {
    recordRenderEvent: (input: RenderDiagnosticEventInput) => Promise<void>;
    getRenderLogInfo: () => Promise<RenderDiagnosticsLogInfo>;
  };
  lifecycle: {
    onVisible: (
      callback: (payload: { reason: string; timestamp: number }) => void,
    ) => () => void;
  };
  project: {
    selectDirectory: () => Promise<string | null>;
    scan: (dirPath: string) => Promise<{
      name: string;
      path: string;
      worktrees: { path: string; branch: string; isPrimary: boolean }[];
    } | null>;
    listChildGitRepos: (
      dirPath: string,
    ) => Promise<{ name: string; path: string }[]>;
    rescanWorktrees: (
      dirPath: string,
    ) => Promise<{ path: string; branch: string; isPrimary: boolean }[]>;
    createWorktree: (
      repoPath: string,
      branch: string,
    ) => Promise<
      | {
          ok: true;
          path: string;
          worktrees: { path: string; branch: string; isPrimary: boolean }[];
        }
      | { ok: false; error: string }
    >;
    restoreWorktree: (
      repoPath: string,
      branch: string,
    ) => Promise<
      | {
          ok: true;
          path: string;
          worktrees: { path: string; branch: string; isPrimary: boolean }[];
        }
      | { ok: false; error: string }
    >;
    createReviewWorktree: (
      repoPath: string,
      baseName: string,
      branch: string,
    ) => Promise<
      | {
          ok: true;
          path: string;
          worktrees: { path: string; branch: string; isPrimary: boolean }[];
        }
      | { ok: false; error: string }
    >;
    removeWorktree: (
      repoPath: string,
      worktreePath: string,
      force?: boolean,
    ) => Promise<
      | {
          ok: true;
          worktrees: { path: string; branch: string; isPrimary: boolean }[];
        }
      | { ok: false; error: string; dirty?: boolean }
    >;
    deleteFolder: (
      projectPath: string,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    enableHydra: (dirPath: string) => Promise<ProjectEnableHydraResult>;
    checkHydra: (
      dirPath: string,
    ) => Promise<"missing" | "outdated" | "current">;
    diff: (worktreePath: string) => Promise<{
      diff: string;
      files: {
        name: string;
        additions: number;
        deletions: number;
        binary: boolean;
        isImage: boolean;
        imageOld: string | null;
        imageNew: string | null;
      }[];
    }>;
  };
  git: {
    watch: (worktreePath: string) => Promise<void>;
    unwatch: (worktreePath: string) => Promise<void>;
    branches: (worktreePath: string) => Promise<GitBranchInfo[]>;
    log: (worktreePath: string, count?: number) => Promise<GitLogEntry[]>;
    isRepo: (dirPath: string) => Promise<boolean>;
    commitDetail: (
      worktreePath: string,
      hash: string,
    ) => Promise<GitCommitDetail | null>;
    checkout: (worktreePath: string, ref: string) => Promise<void>;
    init: (worktreePath: string) => Promise<void>;
    status: (worktreePath: string) => Promise<GitStatusEntry[]>;
    stage: (worktreePath: string, paths: string[]) => Promise<void>;
    unstage: (worktreePath: string, paths: string[]) => Promise<void>;
    discard: (
      worktreePath: string,
      trackedPaths: string[],
      untrackedPaths: string[],
    ) => Promise<void>;
    commit: (worktreePath: string, message: string) => Promise<string>;
    push: (worktreePath: string) => Promise<string>;
    pull: (worktreePath: string) => Promise<string>;
    amend: (worktreePath: string, message: string) => Promise<string>;
    fetch: (worktreePath: string, remote?: string) => Promise<string>;
    // Stash
    stashList: (worktreePath: string) => Promise<GitStashEntry[]>;
    stashCreate: (
      worktreePath: string,
      message: string,
      includeUntracked: boolean,
    ) => Promise<void>;
    stashApply: (worktreePath: string, index: number) => Promise<void>;
    stashPop: (worktreePath: string, index: number) => Promise<void>;
    stashDrop: (worktreePath: string, index: number) => Promise<void>;
    // Branch management
    branchCreate: (
      worktreePath: string,
      name: string,
      startPoint?: string,
    ) => Promise<void>;
    branchDelete: (
      worktreePath: string,
      name: string,
      force: boolean,
    ) => Promise<void>;
    branchRename: (
      worktreePath: string,
      oldName: string,
      newName: string,
    ) => Promise<void>;
    // Tags
    tagList: (worktreePath: string) => Promise<GitTagInfo[]>;
    tagCreate: (
      worktreePath: string,
      name: string,
      ref: string,
      message?: string,
    ) => Promise<void>;
    tagDelete: (worktreePath: string, name: string) => Promise<void>;
    // Remotes
    remoteList: (worktreePath: string) => Promise<GitRemoteInfo[]>;
    remoteAdd: (
      worktreePath: string,
      name: string,
      url: string,
    ) => Promise<void>;
    remoteRemove: (worktreePath: string, name: string) => Promise<void>;
    remoteRename: (
      worktreePath: string,
      oldName: string,
      newName: string,
    ) => Promise<void>;
    // Merge / Rebase / Cherry-pick
    merge: (worktreePath: string, ref: string) => Promise<string>;
    mergeAbort: (worktreePath: string) => Promise<void>;
    rebase: (worktreePath: string, ref: string) => Promise<string>;
    rebaseAbort: (worktreePath: string) => Promise<void>;
    rebaseContinue: (worktreePath: string) => Promise<string>;
    cherryPick: (worktreePath: string, hash: string) => Promise<string>;
    cherryPickAbort: (worktreePath: string) => Promise<void>;
    mergeState: (worktreePath: string) => Promise<GitMergeState>;
    // File diff & partial staging
    fileDiff: (
      worktreePath: string,
      filePath: string,
      staged: boolean,
    ) => Promise<GitFileDiff>;
    stageHunk: (
      worktreePath: string,
      filePath: string,
      hunkHeader: string,
    ) => Promise<void>;
    unstageHunk: (
      worktreePath: string,
      filePath: string,
      hunkHeader: string,
    ) => Promise<void>;
    // Blame
    blame: (worktreePath: string, filePath: string) => Promise<GitBlameEntry[]>;
    // Events
    onChanged: (callback: (worktreePath: string) => void) => () => void;
    onLogChanged: (callback: (worktreePath: string) => void) => () => void;
    onPresenceChanged: (
      callback: (worktreePath: string, payload: { isGitRepo: boolean }) => void,
    ) => () => void;
  };
  search: {
    fileContents: (
      query: string,
      worktreePath?: string,
    ) => Promise<Array<{ filePath: string; line: number; preview: string }>>;
    sessionContents: (
      query: string,
    ) => Promise<
      Array<{
        sessionId: string;
        filePath: string;
        lineNumber: number;
        preview: string;
      }>
    >;
    listSessions: (projectDirs: string[]) => Promise<
      Array<{
        sessionId: string;
        provider: "claude" | "codex" | "kimi";
        projectDir: string;
        filePath: string;
        firstPrompt: string;
        startedAt: string;
        lastActivityAt: string;
        estimatedMessageCount: number;
        fileSize: number;
      }>
    >;
    listSessionsPage: (
      projectDirs: string[],
      options: { limit: number; offset?: number },
    ) => Promise<{
      entries: Array<{
        sessionId: string;
        provider: "claude" | "codex" | "kimi";
        projectDir: string;
        filePath: string;
        firstPrompt: string;
        startedAt: string;
        lastActivityAt: string;
        estimatedMessageCount: number;
        fileSize: number;
      }>;
      total: number;
    }>;
  };
  state: {
    load: () => Promise<PersistedCanvasState | null>;
    save: (state: unknown) => Promise<void>;
  };
  snapshots: {
    list: () => Promise<
      Array<{
        id: string;
        savedAt: number;
        terminalCount: number;
        projectCount: number;
        label?: string;
      }>
    >;
    read: (id: string) => Promise<unknown | null>;
    append: (args: {
      savedAt: number;
      terminalCount: number;
      projectCount: number;
      label?: string;
      body: unknown;
    }) => Promise<{
      id: string;
      savedAt: number;
      terminalCount: number;
      projectCount: number;
      label?: string;
    }>;
  };
  workspace: {
    save: (data: string) => Promise<string | null>;
    open: () => Promise<string | null>;
    saveToPath: (filePath: string, data: string) => Promise<void>;
    setTitle: (title: string) => Promise<void>;
  };
  fs: {
    listDir: (
      dirPath: string,
    ) => Promise<{ name: string; isDirectory: boolean }[]>;
    listAllFiles: (
      dirPath: string,
    ) => Promise<{
      type: "git" | "dir";
      paths: string[];
    }>;
    listIgnoredFiles: (dirPath: string) => Promise<string[]>;
    readFile: (
      filePath: string,
    ) => Promise<
      { type: string; content: string } | { error: string; size?: string }
    >;
    writeFile: (
      filePath: string,
      content: string,
    ) => Promise<{ changed: boolean }>;
    copy: (
      sources: string[],
      destDir: string,
    ) => Promise<{
      copied: string[];
      skipped: string[];
    }>;
    getFilePath: (file: File) => string;
    rename: (oldPath: string, newName: string) => Promise<void>;
    move: (oldPath: string, newPath: string) => Promise<void>;
    delete: (targetPath: string) => Promise<void>;
    mkdir: (dirPath: string, name: string) => Promise<void>;
    createFile: (dirPath: string, name: string) => Promise<void>;
    reveal: (targetPath: string) => Promise<void>;
    watchDir: (dirPath: string) => Promise<void>;
    unwatchDir: (dirPath: string) => Promise<void>;
    unwatchAllDirs: () => Promise<void>;
    onDirChanged: (callback: (dirPath: string) => void) => () => void;
  };
  skills: {
    list: () => Promise<Array<{ categoryId: string; skills: Array<{ name: string; description: string; shared: boolean; dirPath: string }> }>>;
    listForProject: (repoPath: string) => Promise<Array<{ categoryId: string; skills: Array<{ name: string; description: string; shared: boolean; dirPath: string }> }>>;
    getRoots: () => Promise<{ sharedRoot: string; privateRoot: string }>;
    getShareAll: (repoPath: string) => Promise<{ shared: boolean }>;
    setShareAll: (repoPath: string, shared: boolean) => Promise<{ ok: boolean; error?: string }>;
    copyAll: (fromRepo: string, toRepo: string) => Promise<{ ok: boolean; error?: string; copied?: number }>;
    saveFromContent: (categoryId: string, skillName: string, content: string, shared: boolean) => Promise<{ ok: boolean; error?: string }>;
    saveFromContentForProject: (repoPath: string, categoryId: string, skillName: string, content: string) => Promise<{ ok: boolean; error?: string }>;
    saveFromFile: (categoryId: string, filePath: string, shared: boolean) => Promise<{ ok: boolean; error?: string; skillName?: string }>;
    saveFromFileForProject: (repoPath: string, categoryId: string, filePath: string) => Promise<{ ok: boolean; error?: string; skillName?: string }>;
    fetchBySpec: (spec: string, categoryId: string, shared: boolean) => Promise<{ ok: boolean; error?: string; skillName?: string }>;
    fetchBySpecForProject: (spec: string, repoPath: string, categoryId: string) => Promise<{ ok: boolean; error?: string; skillName?: string }>;
    remove: (categoryId: string, skillName: string) => Promise<{ ok: boolean; error?: string }>;
    removeForProject: (repoPath: string, categoryId: string, skillName: string) => Promise<{ ok: boolean; error?: string }>;
    toggleShare: (categoryId: string, skillName: string) => Promise<{ ok: boolean; error?: string; shared?: boolean }>;
  };
  dialog: {
    openSkillFile: () => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  };
  models: {
    // Catálogo de modelos de opencode + routing por fase. Los handlers viven
    // en electron/model-catalog-ipc.ts (server efímero + cache TTL).
    listAvailable: (force?: boolean) => Promise<CatalogResult<ModelCatalog>>;
    validatePhase: (
      phaseId: PhaseId,
      overrides?: Partial<Record<PhaseId, ModelRef>> | null,
    ) => Promise<CatalogResult<PhaseValidation>>;
    invalidate: () => Promise<CatalogResult<{ invalidated: true }>>;
    setPhaseOverrides: (
      overrides: Partial<Record<PhaseId, ModelRef>> | null,
    ) => Promise<CatalogResult<{ applied: number }>>;
  };
  /** Feed "IA actuando": eventos start/end de las llamadas del motor. */
  onPhaseActivity: (callback: (event: PhaseActivityEvent) => void) => () => void;
  interview: {
    // Motor de entrevista de requerimientos (v4): corre en el proceso
    // principal (el renderer no puede correr node:fs + el SDK). El estado
    // vive en el ledger <projectPath>/.agents/interview/requerimientos/entrevista-*.json y
    // el contexto (Fase 0) en contexto-*-documento.json — cada llamada del motor
    // usa el brief más reciente del proyecto como projectBrief.
    create: (projectPath: string) => Promise<{
      ledgerPath: string;
      firstQuestion: TurnResult;
    }>;
    submit: (ledgerPath: string, answer: UserAnswerInput) => Promise<TurnResult>;
    resume: (ledgerPath: string) => Promise<TurnResult>;
    finish: (ledgerPath: string) => Promise<{
      synthesis: SynthesisResult;
      synthesisPath: string;
    }>;
    state: (ledgerPath: string) => Promise<{
      ledger: InterviewLedger;
      lastQuestion: InterviewQuestion | null;
      progress: { answered: number; closed: number; total: number; pct: number };
    }>;
    list: (projectPath: string) => Promise<InterviewSummary[]>;
    delete: (ledgerPath: string) => Promise<{ ok: boolean }>;
    /** Aborta la llamada al modelo en vuelo de esa entrevista/brief. */
    cancel: (ledgerPath: string) => Promise<boolean>;
    briefStatus: (projectPath: string) => Promise<{
      briefs: { brief: BriefDocument; path: string; timestamp: number }[];
      activePath: string | null;
      inProgress: {
        ledgerPath: string;
        timestamp: number;
        answers_count: number;
        total_questions: number;
      }[];
    }>;
    setActiveBrief: (projectPath: string, briefPath: string) => Promise<{ ok: boolean }>;
    activeBriefText: (projectPath: string) => Promise<string>;
    requirementsStatus: (projectPath: string) => Promise<{
      synthesis: { path: string; timestamp: number; resumen: string }[];
      activePath: string | null;
    }>;
    setActiveRequirements: (projectPath: string, synthesisPath: string) => Promise<{ ok: boolean }>;
    activeRequirementsText: (projectPath: string, opts?: { includeStories?: boolean }) => Promise<string>;
    activeDecisionsText: (projectPath: string) => Promise<string>;
    backfillStories: (
      projectPath: string,
      synthesisPath: string,
    ) => Promise<
      | { ok: true; synthesis: SynthesisResult }
      | { ok: false; reason: "no_synthesis" | "already_migrated" | "generation_failed"; error: string }
    >;
    tacticsStatus: (
      projectPath: string,
      synthesisPath: string,
    ) => Promise<{ asrs: TacticStatusEntry[] }>;
    // Arranca el análisis como trabajo de fondo (vuelve al instante); el
    // progreso se lee con tacticsAnalysisState.
    analyzeTactics: (
      projectPath: string,
      synthesisPath: string,
    ) => Promise<{ started: boolean; motivo?: string }>;
    tacticsAnalysisState: (
      projectPath: string,
      synthesisPath: string,
    ) => Promise<EstadoAnalisisTacticas>;
    validateTacticText: (
      projectPath: string,
      synthesisPath: string,
      asrId: string,
      textoLibre: string,
    ) => Promise<
      | { ok: true; data: DecisionValidationOutput }
      | { ok: false; error: string }
    >;
    confirmTacticDecision: (
      projectPath: string,
      input: ConfirmTacticDecisionInput,
    ) => Promise<ConfirmTacticDecisionResult>;
    analyzeOneTactic: (
      projectPath: string,
      synthesisPath: string,
      asrId: string,
      categoriaExplicita?: string,
    ) => Promise<{ started: boolean; motivo?: string }>;
    consolidateTactics: (
      projectPath: string,
      recomendadas: Array<{
        asrId: string;
        atributo: string;
        candidata: TacticaCandidata;
      }>,
    ) => Promise<
      | { ok: true; skipped: true }
      | { ok: true; skipped: false; data: TacticsConsolidationOutput }
      | { ok: false; error: string }
    >;
    addStory: (
      synthesisPath: string,
      input: {
        titulo?: string;
        rol: string;
        quiero: string;
        para: string;
        prioridad?: string;
        criterios_de_aceptacion?: string[];
      },
    ) => Promise<StoryMutationResult>;
    updateStory: (
      synthesisPath: string,
      storyId: string,
      input: {
        titulo?: string;
        rol: string;
        quiero: string;
        para: string;
        prioridad?: string;
        criterios_de_aceptacion?: string[];
      },
    ) => Promise<StoryMutationResult>;
    deleteStory: (synthesisPath: string, storyId: string) => Promise<StoryMutationResult>;
    recoverStory: (synthesisPath: string, storyId: string) => Promise<StoryMutationResult>;
    addCuration: (synthesisPath: string, kind: CurationKind, input: unknown) => Promise<StoryMutationResult>;
    updateCuration: (
      synthesisPath: string,
      kind: CurationKind,
      id: string,
      input: unknown,
    ) => Promise<StoryMutationResult>;
    deleteCuration: (synthesisPath: string, kind: CurationKind, id: string) => Promise<StoryMutationResult>;
    recoverCuration: (synthesisPath: string, kind: CurationKind, id: string) => Promise<StoryMutationResult>;
    purgeCuration: (synthesisPath: string, kind: CurationKind, id: string) => Promise<StoryMutationResult>;
    purgeStory: (synthesisPath: string, storyId: string) => Promise<StoryMutationResult>;
    briefCreate: (projectPath: string) => Promise<{
      ledgerPath: string;
      position: BriefInterviewPosition | null;
    }>;
    briefState: (ledgerPath: string) => Promise<{
      position: BriefInterviewPosition | null;
    }>;
    briefSubmit: (
      ledgerPath: string,
      input: { bloque: string; pregunta: string; respuesta: string },
    ) => Promise<{
      position: BriefInterviewPosition | null;
    }>;
    briefSynthesize: (ledgerPath: string) => Promise<{
      brief: BriefDocument;
      briefPath: string;
    }>;
    briefDelete: (projectPath: string, briefPath: string) => Promise<{ ok: boolean }>;
  };
  memory: {
    scan: (worktreePath: string) => Promise<{
      nodes: Array<{
        fileName: string;
        filePath: string;
        name: string;
        description: string;
        type: string;
        body: string;
        mtime: number;
        ctime: number;
      }>;
      edges: Array<{
        source: string;
        target: string;
        label: string;
      }>;
      dirPath: string;
    }>;
    watch: (worktreePath: string) => Promise<void>;
    unwatch: (worktreePath: string) => Promise<void>;
    onChanged: (
      callback: (graph: {
        nodes: Array<{
          fileName: string;
          filePath: string;
          name: string;
          description: string;
          type: string;
          body: string;
          mtime: number;
          ctime: number;
        }>;
        edges: Array<{
          source: string;
          target: string;
          label: string;
        }>;
        dirPath: string;
      }) => void,
    ) => () => void;
  };
  fonts: {
    getPath: () => Promise<string>;
    listDownloaded: () => Promise<string[]>;
    check: (fileName: string) => Promise<boolean>;
    download: (
      url: string,
      fileName: string,
    ) => Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  };
  cli: {
    isRegistered: () => Promise<boolean>;
    register: () => Promise<{ ok: boolean; skillInstalled: boolean }>;
    unregister: () => Promise<boolean>;
    validateCommand: (
      command: string,
      args?: string[],
    ) => Promise<
      | { ok: true; resolvedPath: string; version: string | null }
      | { ok: false; error: string }
    >;
  };
  composer: {
    submit: (request: ComposerSubmitRequest) => Promise<ComposerSubmitResult>;
  };
  usage: {
    query: (dateStr: string) => Promise<UsageSummary>;
    queryRange: (
      startDate: string,
      endDate: string,
    ) => Promise<UsageRangeSummary>;
    queryCloud?: (dateStr: string) => Promise<CloudUsageSummary | null>;
    queryRangeCloud?: (
      startDate: string,
      endDate: string,
    ) => Promise<CloudUsageRangeSummary | null>;
    heatmap: () => Promise<Record<string, { tokens: number; cost: number }>>;
    heatmapCloud?: () => Promise<Record<string, { tokens: number; cost: number }> | null>;
  };
  quota: {
    fetch: () => Promise<QuotaFetchResult>;
  };
  codexQuota: {
    fetch: () => Promise<QuotaFetchResult>;
  };
  summary: {
    generate: (input: {
      terminalId: string;
      sessionId: string;
      sessionType: "claude" | "codex";
      cwd: string;
      summaryCli: "claude" | "codex";
      locale: "en" | "zh";
    }) => Promise<{
      ok: boolean;
      summary?: string;
      error?: string;
      sessionFileSize?: number;
    }>;
  };
  insights: {
    generate: (
      cliTool: "claude" | "codex",
      jobId: string,
    ) => Promise<InsightsGenerateResult>;
    onProgress: (
      callback: (progress: InsightsProgressEvent) => void,
    ) => () => void;
    openReport: (filePath: string) => Promise<void>;
    getLastReport: () => Promise<string | null>;
  };
  secure: {
    isAvailable: () => Promise<boolean>;
    encrypt: (plaintext: string) => Promise<string>;
    decrypt: (base64: string) => Promise<string>;
  };
  github: {
    fetchIssues: (cwd: string) => Promise<
      | { ok: true; issues: Array<Record<string, unknown>> }
      | { ok: false; error: string; code: string }
    >;
    openUrl: (url: string) => Promise<void>;
    listLabels: (cwd: string) => Promise<
      | { ok: true; labels: Array<{ name: string; color: string; description: string }> }
      | { ok: false; error: string }
    >;
    listOpenIssues: (cwd: string) => Promise<
      | { ok: true; issues: Array<{ number: number; title: string }> }
      | { ok: false; error: string }
    >;
    listMilestones: (cwd: string) => Promise<
      | { ok: true; milestones: Array<{ number: number; title: string; due_on: string | null }> }
      | { ok: false; error: string }
    >;
    mutateIssue: (cwd: string, number: number, action: string, params: Record<string, unknown>) => Promise<
      | { ok: true }
      | { ok: false; error: string }
    >;
    addComment: (cwd: string, number: number, body: string) => Promise<
      | { ok: true }
      | { ok: false; error: string }
    >;
    createIssue: (cwd: string, title: string, body: string, labels: string[]) => Promise<
      | { ok: true; number: number; url: string }
      | { ok: false; error: string }
    >;
    addToProject: (cwd: string, issueUrl: string) => Promise<
      | { ok: true; applied: boolean }
      | { ok: false; error: string }
    >;
    lastIssueNumber: (cwd: string) => Promise<number | null>;
    findPrForIssue: (
      cwd: string,
      issueNumber: number,
    ) => Promise<
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
    >;
    findOpenPrsForIssue: (
      cwd: string,
      issueNumber: number,
    ) => Promise<
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
    >;
    getPrReviewDecision: (
      cwd: string,
      prNumber: number,
    ) => Promise<
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
    >;
    getPrComments: (
      cwd: string,
      prNumber: number,
    ) => Promise<
      | { ok: true; text: string }
      | { ok: false; error: string }
    >;
    getReviewContext: (
      cwd: string,
      prNumber: number,
      targetDir: string,
    ) => Promise<
      | {
          ok: true;
          context: string;
          diffFilePath: string | null;
          templateFilePath: string | null;
          headRefOid: string | null;
          lastReviewCommitId: string | null;
        }
      | { ok: false; error: string }
    >;
    getConflictFiles: (
      cwd: string,
      branch: string,
      prNumber: number,
    ) => Promise<
      | { ok: true; conflictFiles: string[] }
      | { ok: false; error: string }
    >;
    applyReviewLabel: (
      cwd: string,
      prNumber: number,
      verdict:
        | "APPROVED"
        | "CHANGES_REQUESTED"
        | "COMMENTED"
        | "REVIEW_REQUIRED"
        | "FIX_APPLIED"
        | null,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    applyCycleLabel: (
      cwd: string,
      prNumber: number,
      issueNumber: number | null,
      label:
        | "review:pendiente"
        | "review:comentado"
        | "review:fix-aplicado"
        | "review:aprobado"
        | "conflicto:main"
        | "gate:fallo",
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    syncIssueReviewLabel: (
      cwd: string,
      issueNumber: number,
      prLabels: string[],
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    mergePr: (
      cwd: string,
      prNumber: number,
    ) => Promise<{ ok: true; prUrl: string } | { ok: false; error: string }>;
    mergeApprovedPrs: (
      cwd: string,
    ) => Promise<
      | {
          ok: true;
          summary: {
            merged: number[];
            conflicted: Array<{ number: number; files: string[] }>;
          };
        }
      | { ok: false; error: string }
    >;
    onMergeProgress: (callback: (event: MergeProgressEvent) => void) => () => void;
    runIssueGate: (
      cwd: string,
      prNumber: number,
    ) => Promise<
      | {
          ok: true;
          verdict: "PASS" | "FAIL";
          failedChecks: string[];
          checks: Array<{ name: string; status: string; note: string | null }>;
          reportPath: string;
          headRefOid: string;
        }
      | { ok: false; error: string }
    >;
    securityAudit: (cwd: string) => Promise<SecurityAuditResponse>;
  };
  agent: {
    start: (
      sessionId: string,
      config: {
        type: "claude-code";
        cwd?: string;
        resumeSessionId?: string;
        baseURL: string;
        apiKey: string;
        model: string;
      },
    ) => Promise<{ slashCommands: string[] }>;
    send: (
      sessionId: string,
      text: string,
      config: {
        type: "anthropic" | "openai" | "claude-code";
        baseURL: string;
        apiKey: string;
        model: string;
        cwd?: string;
        resumeSessionId?: string;
      },
    ) => Promise<void>;
    abort: (sessionId: string) => Promise<void>;
    clear: (sessionId: string) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
    approve: (sessionId: string, requestId: string) => Promise<void>;
    deny: (
      sessionId: string,
      requestId: string,
      reason?: string,
    ) => Promise<void>;
    onEvent: (
      callback: (sessionId: string, event: AgentStreamEvent) => void,
    ) => () => void;
  };
  app: {
    homePath: string;
    platform: "darwin" | "win32" | "linux";
    requestClose: () => void;
    setQuitOnLastWindowClosed: (value: boolean) => void;
  };
  hooks: {
    getSocketPath: () => Promise<string | null>;
    getHealth: () => Promise<{
      socketPath: string | null;
      lastEventAt: string | null;
      eventsReceived: number;
      parseErrors: number;
    }>;
    onSessionStarted: (
      callback: (payload: {
        terminalId: string;
        sessionId: string;
        transcriptPath: string | null;
        cwd: string | null;
      }) => void,
    ) => () => void;
    onTurnComplete: (
      callback: (payload: {
        terminalId: string;
        sessionId: string | null;
      }) => void,
    ) => () => void;
    onStopFailure: (
      callback: (payload: {
        terminalId: string;
        sessionId: string | null;
        error: string | null;
        errorDetails: string | null;
      }) => void,
    ) => () => void;
  };
  sessions: {
    onListChanged: (
      callback: (
        sessions: import("../../shared/sessions").SessionInfo[],
      ) => void,
    ) => () => void;
    onHistoryChanged: (
      callback: (payload: SessionHistoryChangedEvent) => void,
    ) => () => void;
    loadReplay: (
      filePath: string,
    ) => Promise<import("../../shared/sessions").ReplayTimeline>;
    forkSession: (
      sourceFilePath: string,
      turnIndex: number,
      targetProvider?: "claude" | "codex",
    ) => Promise<{ newSessionId: string; newFilePath: string }>;
  };
  menu: {
    onOpenFolder: (callback: (dirPath: string) => void) => () => void;
    onSelectAll: (callback: () => void) => () => void;
  };
  pins: {
    list: (repo: string) => Promise<Pin[]>;
    create: (input: CreatePinInput) => Promise<Pin>;
    update: (repo: string, id: string, patch: UpdatePinInput) => Promise<Pin>;
    remove: (repo: string, id: string) => Promise<void>;
    openPreview: (repo: string, id: string) => Promise<void>;
    saveAttachment: (
      repo: string,
      id: string,
      fileName: string,
      data: ArrayBuffer,
    ) => Promise<{ relativePath: string; absolutePath: string }>;
    dispatchToTerminal: (
      repo: string,
      pinId: string,
      target: {
        terminalId: string;
        ptyId: number;
        terminalType: ComposerSupportedTerminalType;
        worktreePath: string;
      },
    ) => Promise<ComposerSubmitResult>;
    subscribe: (handler: (event: PinEvent) => void) => () => void;
  };
  updater: {
    check: () => Promise<import("../../shared/updater-types").UpdateCheckOutcome>;
    install: () => void;
    getVersion: () => Promise<string>;
    onUpdateAvailable: (
      callback: (info: UpdateEventInfo) => void,
    ) => () => void;
    onDownloadProgress: (
      callback: (progress: { percent: number }) => void,
    ) => () => void;
    onUpdateDownloaded: (
      callback: (info: UpdateEventInfo) => void,
    ) => () => void;
    onError: (callback: (error: { message: string }) => void) => () => void;
    onLocationWarning?: (
      callback: (info: { bundlePath: string }) => void,
    ) => () => void;
  };
}

export interface UpdateEventInfo {
  version: string;
  releaseNotes: string;
  releaseDate: string;
}

declare global {
  interface Window {
    termcanvas: TermCanvasAPI;
  }
}
