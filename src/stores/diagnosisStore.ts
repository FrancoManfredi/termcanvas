import { create } from "zustand";
import {
  launchPlanningSession,
  resolveActiveWorktree,
  type PlanningSessionHandle,
} from "../planner/planningSession";
import {
  launchToolsSession,
  newestToolFindings,
  type ToolsSessionHandle,
} from "../planner/toolsSession";
import { isAuditPlan, type AuditPlan } from "../types/issuePlanning.ts";
import { parsePlanningPlan } from "../planner/parsePlanResult.ts";

// Registro de un diagnóstico completado (mode audit) para el historial.
export interface DiagnosisRecord {
  id: string;
  timestamp: string;
  filename: string;
  repo: string;
  data: AuditPlan;
  // El prompt EXACTO que se le mandó a la sesión (trazabilidad: el usuario
  // puede verificar qué instrucción corrió). Los registros cargados desde
  // disco no lo traen (el prompt no se persiste junto al plan).
  prompt?: string;
  // Resumen de cobertura de las herramientas deterministas de esa corrida.
  // Los registros cargados desde disco lo reconstruyen desde el
  // tool-findings más reciente anterior al diagnóstico (ver loadHistory).
  toolCoverage?: ToolCoverageSummary;
}

// Cobertura del pipeline de herramientas: qué % de archivos fuente
// escanearon las herramientas y qué herramientas quedaron "no evaluadas".
export interface ToolCoverageSummary {
  filesScanned: number;
  totalFiles: number;
  pct: number | null;
  toolsOk: number;
  toolsTotal: number;
  notEvaluated: string[];
  // Detalle por paquete para el % honesto: scanned null = el paquete no
  // tiene ninguna herramienta de archivos configurada (solo tsc/audit), y
  // esos archivos NO entran al denominador del % (no es "no escaneado",
  // es "sin herramienta que escanee archivos").
  packages: Array<{ name: string; files: number; scanned: number | null }>;
}

// Runtime de la sesión headless en curso: el modal lo atachea al pane
// mientras está abierto, pero la sesión sigue viviendo aunque el modal se
// cierre (el estado está acá, a nivel módulo, no en el componente).
interface DiagnosisSessionRuntime {
  terminalId: string;
  outputPath: string;
  prompt: string;
}

interface DiagnosisStore {
  // tools = Fase A (herramientas deterministas escaneando el repo);
  // running = Fase B (LLM interpretando los findings). El paso de tools a
  // running es MANUAL: el usuario clickea "Continuar al diagnóstico LLM"
  // cuando toolsDone se habilita (archivo tool-findings + exit 0).
  phase: "idle" | "tools" | "running";
  sessionRuntime: DiagnosisSessionRuntime | null;
  error: string | null;
  history: DiagnosisRecord[];
  // Todas las herramientas terminaron de escanear (gate del botón).
  toolsDone: boolean;
  // Resumen de cobertura de la corrida de herramientas en curso (para el
  // banner del modal). Se limpia al iniciar una corrida nueva.
  toolsSummary: ToolCoverageSummary | null;
  // Último diagnóstico completado que la UI todavía no mostró (auto-open
  // del detalle). Se consume con takeLatestId para no repetir el open.
  latestDiagnosisId: string | null;
  start: () => Promise<void>;
  continueToLlm: () => Promise<void>;
  // Salteo de la Fase A: usa el tool-findings MÁS RECIENTE de
  // .agents/planning y lanza directo la fase LLM, sin re-correr las
  // herramientas deterministas (para iterar/testear el LLM).
  startLlmDirect: () => Promise<void>;
  cancel: () => void;
  // Elimina un diagnóstico del historial y su JSON del disco.
  removeRecord: (id: string, repoPath: string) => void;
  dismissError: () => void;
  takeLatestId: () => string | null;
  // Sincroniza el historial con los JSON reales de <repo>/.agents/planning/:
  // diagnostico-<ts>.json (auditorías nuevas) y plan-<ts>.json legacy con
  // mode audit (las escritas antes del rename). Los planes de roadmap no
  // entran al historial de diagnósticos.
  loadHistory: (repoPath: string) => Promise<void>;
}

// La sesión real en curso (tools O LLM): su polling y el runtime se
// detienen en cancel. Vive a nivel módulo para que el cierre del modal no
// la pierda (el modal se desmonta con isOpen=false y el componente no
// puede retener el handle).
let activeSession: (ToolsSessionHandle | PlanningSessionHandle) | null = null;

// Datos de la corrida de herramientas, preparados en onReady y consumidos
// por continueToLlm (entre el tool-findings y el exit del proceso).
let pendingFindingsText = "";
let pendingCoverage: ToolCoverageSummary | undefined;
let pendingFindingsPath = "";

// Cancelar durante la ventana del reintento (entre el exit del LLM y el
// relanzamiento resumido) no debe resucitar la fase running.
let flowCancelled = false;

function formatTimestamp(ts: number): string {
  return new Date(ts)
    .toLocaleString("es-AR", {
      day: "2-digit",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", " ·");
}

// Un diagnóstico terminado en esta sesión (en memoria) o cargado desde
// disco; el nombre del archivo da el timestamp sin abrir el contenido.
function diagnosisIdFor(ts: number): string {
  return `diag-${ts}`;
}

// Formatea el tool-findings como la sección que se inyecta al prompt del
// LLM: una entrada por herramienta con sus hallazgos (o "sin hallazgos").
// CAP por tamaño: el prompt viaja como UN argumento del spawn de Windows
// (límite ~32K de CreateProcess), así que se muestran los primeros N por
// herramienta y se apunta al archivo completo para el resto.
const MAX_FINDINGS_PER_TOOL = 25;
const MAX_TOTAL_FINDINGS = 160;

// Política de retención de .agents/planning: cada corrida deja tool-findings
// (input intermedio del LLM) y prompt-*.md (trazabilidad del prompt). Para
// que la carpeta no acumule indefinidamente, al iniciar una corrida nueva se
// borran los que exceden los KEEP_RECENT más recientes por tipo. Los
// diagnostico-*.json (historial) no se tocan.
const KEEP_RECENT_PLANNING_ARTIFACTS = 5;

async function prunePlanningArtifacts(repoPath: string): Promise<void> {
  const dir = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
  const entries = await window.termcanvas.fs.listDir(dir).catch(() => null);
  if (!entries) return;

  const kinds = [
    { prefix: "tool-findings-", ext: "json" },
    { prefix: "prompt-", ext: "md" },
  ];
  const byTs = new Map<string, number>();
  const kept: string[][] = kinds.map(() => []);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    kinds.forEach((kind, i) => {
      const m = new RegExp(`^${kind.prefix}(\\d+)\\.${kind.ext}$`).exec(entry.name);
      if (!m) return;
      const ts = Number(m[1]);
      if (Number.isFinite(ts)) {
        byTs.set(entry.name, ts);
        kept[i].push(entry.name);
      }
    });
  }
  kept.forEach((names, i) => {
    names.sort((a, b) => (byTs.get(b) ?? 0) - (byTs.get(a) ?? 0));
    for (const name of names.slice(KEEP_RECENT_PLANNING_ARTIFACTS)) {
      void window.termcanvas.fs.delete(`${dir}/${name}`).catch(() => {
        // Best-effort: un archivo que no se pudo borrar no rompe la corrida.
      });
    }
  });
}

function formatToolFindingsForPrompt(
  json: Record<string, unknown>,
  findingsPath: string,
): string {
  const coverage = Array.isArray(json.coverage) ? json.coverage : [];
  const findings = Array.isArray(json.findings) ? json.findings : [];
  const lines: string[] = [];
  let shown = 0;
  let capped = false;
  for (const c of coverage) {
    const label = c.package ? `${c.tool} (${c.package})` : `${c.tool} (repo)`;
    if (c.status !== "ok") {
      lines.push(`### ${label} — ${c.status}`);
      lines.push(`> ${c.error ?? "no evaluada"}`);
      lines.push("");
      continue;
    }
    const items = findings.filter(
      (f) => f.tool === c.tool && f.package === c.package,
    );
    lines.push(`### ${label} — ${items.length} hallazgo(s)`);
    if (items.length === 0) {
      lines.push("_sin hallazgos_");
    } else {
      const budget = Math.max(0, Math.min(MAX_FINDINGS_PER_TOOL, MAX_TOTAL_FINDINGS - shown));
      const visible = budget > 0 ? items.slice(0, budget) : [];
      for (const f of visible) {
        const loc = f.line != null ? `${f.file}:${f.line}` : f.file;
        lines.push(`- [${f.severity}] ${loc} — **${f.rule}** — ${f.message}`);
        shown += 1;
      }
      if (items.length > visible.length) {
        lines.push(`… y ${items.length - visible.length} hallazgos más`);
        capped = true;
      }
    }
    lines.push("");
  }
  if (capped && findingsPath) {
    lines.push(
      `> El listado COMPLETO de hallazgos está en ${findingsPath} — leelo si necesitás ver los que no se muestran arriba.`,
    );
  }
  return lines.join("\n").trim();
}

// Cobertura calculada por la app desde el tool-findings. El % es HONESTO
// sobre qué cubren las herramientas de archivos: el denominador son los
// archivos de los paquetes que TIENEN al menos una herramienta de archivos
// (eslint/knip/jscpd reportan files_scanned). Un paquete sin herramienta
// de archivos (solo tsc/audit, ej. backend sin ESLint) NO cuenta como "no
// escaneado": se lista aparte como "sin herramienta de archivos".
function computeToolCoverage(json: Record<string, unknown>): ToolCoverageSummary {
  const rawPackages = Array.isArray(json.packages) ? json.packages : [];
  const packages: ToolCoverageSummary["packages"] = rawPackages.map((p) => ({
    name: String(p?.path ?? ""),
    files: Number(p?.files) || 0,
    scanned: null,
  }));
  const coverage = Array.isArray(json.coverage) ? json.coverage : [];
  for (const c of coverage) {
    if (!c.package || typeof c.files_scanned !== "number") continue;
    const entry = packages.find((p) => p.name === c.package);
    if (!entry) continue;
    entry.scanned = Math.max(entry.scanned ?? 0, c.files_scanned);
  }
  const covered = packages.filter((p) => p.scanned != null);
  // El conteo de la herramienta puede superar el nuestro (jscpd cuenta
  // configs/formatos que nuestro conteo de fuente no): se clampea para que
  // "122/122" y "100%" sean coherentes.
  let filesScanned = covered.reduce((sum, p) => sum + (p.scanned ?? 0), 0);
  let totalFiles = covered.reduce((sum, p) => sum + p.files, 0);
  if (filesScanned > totalFiles) filesScanned = totalFiles;
  const pct = totalFiles > 0 ? Math.round((filesScanned / totalFiles) * 100) : null;
  const notEvaluated = coverage
    .filter((c) => c.status !== "ok")
    .map((c) => `${c.tool}${c.package ? ` (${c.package})` : ""}${c.error ? `: ${c.error}` : ""}`);
  return {
    filesScanned,
    totalFiles,
    pct,
    toolsOk: coverage.filter((c) => c.status === "ok").length,
    toolsTotal: coverage.length,
    notEvaluated,
    packages,
  };
}

async function readToolFindings(path: string): Promise<Record<string, unknown> | null> {
  try {
    const read = await window.termcanvas.fs.readFile(path);
    if (!("content" in read)) return null;
    const parsed = JSON.parse(read.content) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Fase B del Diagnóstico: lanza la sesión LLM REAL (TUI interactiva) con los
// findings pendientes (pendingFindingsText) y el reintento automático por si
// la corrida termina sin escribir el plan (exit 0 sin archivo → relanzado
// resumido con -s <sessionId>). La comparten continueToLlm (después de la
// Fase A) y startLlmDirect (con findings de disco, salteando herramientas).
async function launchLlmPhase(options: {
  repoPath: string;
  projectId: string;
  worktreeId: string;
}): Promise<void> {
  const { repoPath, projectId, worktreeId } = options;
  let retryUsed = false;
  let stopped = false;

  const startLlm = async (resumeSessionId?: string) => {
    if (stopped) return;
    let handle: PlanningSessionHandle | null = null;
    try {
      handle = await launchPlanningSession({
        mode: "audit",
        repoPath,
        projectId,
        worktreeId,
        roadmapText: "",
        attachmentNames: [],
        // TUI interactiva (no headless): el usuario ve la sesión de opencode
        // y puede intervenir (errores de cuota, corridas que se cortan). El
        // poller la cierra solo cuando el plan aparece.
        headless: false,
        toolFindingsText: pendingFindingsText,
        resumeSessionId,
        onResult: (result) => {
          if (!isAuditPlan(result)) {
            useDiagnosisStore.setState({
              phase: "idle",
              sessionRuntime: null,
              toolsDone: false,
              toolsSummary: null,
              error:
                "El plan generado no corresponde a una auditoría (mode != audit).",
            });
            activeSession = null;
            return;
          }
          const now = Date.now();
          const newRecord: DiagnosisRecord = {
            id: diagnosisIdFor(now),
            timestamp: formatTimestamp(now),
            filename:
              handle?.outputPath.split(/[\\/]/).pop() ??
              `diagnostico-${now}.json`,
            repo: result.repo,
            data: result,
            prompt: handle?.prompt,
            toolCoverage: pendingCoverage,
          };
          useDiagnosisStore.setState((state) => ({
            phase: "idle",
            sessionRuntime: null,
            error: null,
            toolsDone: false,
            toolsSummary: null,
            history: [newRecord, ...state.history],
            latestDiagnosisId: newRecord.id,
          }));
          activeSession = null;
        },
        onError: (message) => {
          useDiagnosisStore.setState({
            phase: "idle",
            sessionRuntime: null,
            toolsDone: false,
            toolsSummary: null,
            error: message,
          });
          activeSession = null;
        },
        onExitedWithoutFile: (sessionId) => {
          if (stopped || flowCancelled) return;
          // La corrida se cortó sin entregar el plan: mata el runtime
          // viejo y, si hay sesión para reanudar y queda reintento,
          // relanza resumido. Silencioso para el usuario.
          activeSession?.stop();
          activeSession = null;
          useDiagnosisStore.setState({ sessionRuntime: null });
          if (sessionId && !retryUsed) {
            retryUsed = true;
            void startLlm(sessionId);
            return;
          }
          useDiagnosisStore.setState({
            phase: "idle",
            sessionRuntime: null,
            toolsDone: false,
            toolsSummary: null,
            error: sessionId
              ? "El LLM terminó sin escribir el plan y el reintento tampoco lo escribió."
              : "El LLM terminó sin escribir el plan y no se pudo reanudar la sesión.",
          });
        },
      });
      if (!handle) {
        useDiagnosisStore.setState({
          phase: "idle",
          sessionRuntime: null,
          toolsDone: false,
          toolsSummary: null,
        });
        activeSession = null;
        return;
      }
      if (stopped || flowCancelled) {
        handle.stop();
        return;
      }
      activeSession = handle;
      useDiagnosisStore.setState({
        phase: "running",
        sessionRuntime: {
          terminalId: handle.terminalId,
          outputPath: handle.outputPath,
          prompt: handle.prompt,
        },
      });
    } catch (error) {
      useDiagnosisStore.setState({
        phase: "idle",
        sessionRuntime: null,
        toolsDone: false,
        toolsSummary: null,
        error: error instanceof Error ? error.message : String(error),
      });
      activeSession = null;
    }
  };

  await startLlm();
}

export const useDiagnosisStore = create<DiagnosisStore>((set, get) => ({
  phase: "idle",
  sessionRuntime: null,
  error: null,
  history: [],
  toolsDone: false,
  toolsSummary: null,
  latestDiagnosisId: null,

  start: async () => {
    if (get().phase !== "idle") return;
    set({
      phase: "tools",
      sessionRuntime: null,
      error: null,
      toolsDone: false,
      toolsSummary: null,
    });
    pendingFindingsText = "";
    pendingCoverage = undefined;
    pendingFindingsPath = "";

    const active = resolveActiveWorktree();
    if (!active) {
      set({ phase: "idle" });
      return;
    }
    const { projectId, worktreeId, path: repoPath } = active;

    // Retención: borra los tool-findings/prompt que exceden los N más
    // recientes ANTES de escribir los nuevos de esta corrida.
    await prunePlanningArtifacts(repoPath);

    // FASE A — herramientas deterministas (orquestador headless). El paso a
    // la Fase B es MANUAL (continueToLlm): acá solo se preparan los datos.
    const toolsHandle = await launchToolsSession({
      repoPath,
      projectId,
      worktreeId,
      onReady: (findingsPath) => {
        void (async () => {
          const json = await readToolFindings(findingsPath);
          pendingFindingsPath = findingsPath;
          pendingFindingsText = json
            ? formatToolFindingsForPrompt(json, findingsPath)
            : "";
          pendingCoverage = json ? computeToolCoverage(json) : undefined;
          set({ toolsSummary: pendingCoverage ?? null });
        })();
      },
      onExited: (exitCode) => {
        if (exitCode === 0) set({ toolsDone: true });
      },
      onError: (message) => {
        set({ phase: "idle", sessionRuntime: null, error: message });
        activeSession = null;
      },
    });
    if (!toolsHandle) {
      // launchToolsSession ya notificó el error.
      set({ phase: "idle" });
      return;
    }
    activeSession = toolsHandle;
    set({
      sessionRuntime: {
        terminalId: toolsHandle.terminalId,
        outputPath: "",
        prompt: "",
      },
    });
  },

  // Gate manual: destruye el runtime de herramientas y arranca la Fase B
  // (LLM) con los findings que las herramientas dejaron listos. Si la
  // sesión LLM termina sin escribir el plan (exit 0 sin archivo — el modelo
  // se corta a mitad), se relanza UNA vez resumida (-s <sessionId>) con un
  // mensaje corto "escribí el plan ahora", sin re-pagar el prompt completo.
  continueToLlm: async () => {
    const { phase, toolsDone } = get();
    if (phase !== "tools" || !toolsDone) return;

    activeSession?.stop(); // destruye el runtime de herramientas (log ya visto)
    activeSession = null;
    set({ sessionRuntime: null });
    flowCancelled = false;

    const active = resolveActiveWorktree();
    if (!active) {
      set({ phase: "idle", toolsDone: false, toolsSummary: null });
      return;
    }
    const { projectId, worktreeId, path: repoPath } = active;
    await launchLlmPhase({ repoPath, projectId, worktreeId });
  },

  // Salteo de la Fase A (para testing/iteración del LLM): usa el
  // tool-findings MÁS RECIENTE de .agents/planning (el de la última corrida
  // de herramientas) y lanza directo la Fase B sin re-correr el pipeline
  // determinista. Sin findings previos → error claro, no se inventa nada.
  startLlmDirect: async () => {
    if (get().phase !== "idle") return;
    const active = resolveActiveWorktree();
    if (!active) {
      set({ phase: "idle" });
      return;
    }
    const { projectId, worktreeId, path: repoPath } = active;

    const findingsPath = await newestToolFindings(
      `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`,
    );
    if (!findingsPath) {
      set({
        phase: "idle",
        error:
          "No hay hallazgos de herramientas previos en .agents/planning — corré primero un diagnóstico completo.",
      });
      return;
    }
    const json = await readToolFindings(findingsPath);
    if (!json) {
      set({
        phase: "idle",
        error: `No se pudo leer ${findingsPath.split(/[\\/]/).pop() ?? findingsPath} (JSON inválido o ilegible).`,
      });
      return;
    }
    pendingFindingsPath = findingsPath;
    pendingFindingsText = formatToolFindingsForPrompt(json, findingsPath);
    pendingCoverage = computeToolCoverage(json);
    flowCancelled = false;
    set({
      phase: "running",
      sessionRuntime: null,
      error: null,
      toolsDone: false,
      toolsSummary: null,
    });
    await launchLlmPhase({ repoPath, projectId, worktreeId });
  },

  // Cancela la sesión en curso (tools o LLM): destruye el runtime y deja de
  // pollear. La sesión deja de correr (headless, sin tile en el canvas).
  cancel: () => {
    flowCancelled = true;
    activeSession?.stop();
    activeSession = null;
    set({
      phase: "idle",
      sessionRuntime: null,
      error: null,
      toolsDone: false,
      toolsSummary: null,
    });
  },

  dismissError: () => set({ error: null }),

  removeRecord: (id: string, repoPath: string) => {
    const { history } = get();
    const rec = history.find((r) => r.id === id);
    if (!rec) return;
    set({ history: history.filter((r) => r.id !== id) });
    if (typeof window !== "undefined") {
      const dir = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
      void window.termcanvas.fs
        .delete(`${dir}/${rec.filename}`)
        .catch(() => {
          // El archivo ya no existe o no se pudo borrar: el registro sale
          // igual del historial, no es un error que deba molestar.
        });
    }
  },

  takeLatestId: () => {
    const id = get().latestDiagnosisId;
    if (id) set({ latestDiagnosisId: null });
    return id;
  },

  loadHistory: async (repoPath: string) => {
    if (typeof window === "undefined") return;
    const dir = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
    const entries = await window.termcanvas.fs.listDir(dir).catch(() => []);
    const records: DiagnosisRecord[] = [];
    // tool-findings ordenados por timestamp, para reconstruir la cobertura
    // de cada diagnóstico (el más reciente ANTERIOR al diagnóstico).
    const toolFindingsTs: number[] = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const m = /^tool-findings-(\d+)\.json$/.exec(entry.name);
      if (m) {
        const ts = Number(m[1]);
        if (Number.isFinite(ts)) toolFindingsTs.push(ts);
      }
    }
    toolFindingsTs.sort((a, b) => a - b);
    const coverageCache = new Map<number, ToolCoverageSummary>();

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      // diagnostico-<ts>.json (auditorías nuevas) + plan-<ts>.json legacy
      // con mode audit (las escritas antes del rename). El prefijo plan-<ts>
      // de roadmap NO entra al historial de diagnósticos.
      const match = /^(diagnostico|plan)-(\d+)\.json$/.exec(entry.name);
      if (!match) continue;
      const ts = Number(match[2]);
      if (!Number.isFinite(ts)) continue;
      const read = await window.termcanvas.fs
        .readFile(`${dir}/${entry.name}`)
        .catch(() => null);
      if (!read || !("content" in read)) continue;
      const parsed = parsePlanningPlan(read.content);
      if (!parsed || parsed.result.mode !== "audit") continue;
      records.push({
        id: diagnosisIdFor(ts),
        timestamp: formatTimestamp(ts),
        filename: entry.name,
        repo: parsed.result.repo,
        data: parsed.result,
        toolCoverage: await coverageFor(ts),
      });
    }
    records.sort((a, b) => (a.id < b.id ? 1 : -1));
    set({ history: records });

    // El tool-findings con mayor timestamp estrictamente anterior al
    // diagnóstico es el de su corrida (cada corrida escribe tools → LLM).
    async function coverageFor(diagTs: number): Promise<ToolCoverageSummary | undefined> {
      let best = -1;
      for (const tf of toolFindingsTs) {
        if (tf < diagTs && tf > best) best = tf;
      }
      if (best < 0) return undefined;
      if (coverageCache.has(best)) return coverageCache.get(best);
      const json = await readToolFindings(`${dir}/tool-findings-${best}.json`);
      const summary = json ? computeToolCoverage(json) : undefined;
      if (summary) coverageCache.set(best, summary);
      return summary;
    }
  },
}));
