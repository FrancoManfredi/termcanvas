import { create } from "zustand";
import {
  launchPlanningSession,
  resolveActiveWorktree,
  type PlanningSessionHandle,
} from "../planner/planningSession";
import {
  launchToolsSession,
  newestToolFindings,
  parseToolFindingsName,
  type ToolsSessionHandle,
} from "../planner/toolsSession";
import { isAuditPlan, type AuditPlan } from "../types/issuePlanning.ts";
import {
  getDiagnosisCategory,
  isDiagnosisCategoryId,
  parseDiagnosisFileName,
  LEGACY_CATEGORY_ID,
} from "../types/diagnosisCategories.ts";
import { resolveCliForPhase } from "../../shared/phaseModels";
import { usePreferencesStore } from "./preferencesStore";
import { parsePlanningPlan } from "../planner/parsePlanResult.ts";
import {
  assertPhaseModelAvailable,
  getPhaseOutputTail,
  resolvePhaseModelRef,
  shouldRunPhaseInTui,
} from "../planner/modelPin";
import { diagnosisAllowedSkills } from "../skills/registry.ts";

// Registro de un diagnóstico completado (mode audit) para el historial.
export interface DiagnosisRecord {
  id: string;
  timestamp: string;
  filename: string;
  repo: string;
  data: AuditPlan;
  // Categoría del diagnóstico (id del registro o "general" para los
  // previos al feature y los planes legacy plan-<ts> con mode audit).
  category: string;
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
  // tools = Fase A (herramientas deterministas de LA CATEGORÍA elegida
  // escaneando el repo); running = Fase B (LLLM interpretando los findings).
  // Las categorías LLM-only (sin herramientas) saltan directo a running.
  // El paso de tools a running es MANUAL: el usuario clickea "Continuar al
  // diagnóstico LLM" cuando toolsDone se habilita (archivo tool-findings +
  // exit 0).
  phase: "idle" | "tools" | "running";
  sessionRuntime: DiagnosisSessionRuntime | null;
  error: string | null;
  history: DiagnosisRecord[];
  // Categoría de la corrida en curso (para los labels del modal). Se limpia
  // al completar, cancelar o fallar la corrida.
  selectedCategory: string | null;
  // Todas las herramientas terminaron de escanear (gate del botón).
  toolsDone: boolean;
  // Resumen de cobertura de la corrida de herramientas en curso (para el
  // banner del modal). Se limpia al iniciar una corrida nueva.
  toolsSummary: ToolCoverageSummary | null;
  // Categoría → timestamp del tool-findings MÁS RECIENTE de esa categoría
  // en .agents/planning (los legacy sin categoría no entran). Alimenta la
  // habilitación del "→ LLM directo": solo tiene sentido si las herramientas
  // de ESA categoría corrieron alguna vez, aunque su LLM haya fallado después.
  toolFindingsByCategory: Record<string, number>;
  // Último diagnóstico completado que la UI todavía no mostró (auto-open
  // del detalle). Se consume con takeLatestId para no repetir el open.
  latestDiagnosisId: string | null;
  // Arranca un diagnóstico POR CATEGORÍA: con herramientas → Fase A solo con
  // las mapeadas; LLM-only → directo a la Fase B con exploración dirigida.
  start: (categoryId: string) => Promise<void>;
  continueToLlm: () => Promise<void>;
  // Salteo de la Fase A: usa el tool-findings MÁS RECIENTE DE ESA CATEGORÍA
  // de .agents/planning y lanza directo la fase LLM, sin re-correr las
  // herramientas deterministas (para iterar/testear el LLM).
  startLlmDirect: (categoryId?: string) => Promise<void>;
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

// Categoría de la corrida en curso (id validado): viaja al record al
// completar y a los labels del modal vía selectedCategory.
let activeCategory: string | null = null;

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
// (input intermedio del LLM), el sidecar del prompt
// (<plan>.json.prompt.md, trazabilidad que consume el detalle de la UI) y —
// legacy pre-categorías — prompt-<ts>.md. Para que la carpeta no acumule
// indefinidamente, al iniciar una corrida nueva se borran los que exceden los
// KEEP_RECENT más recientes. Los tool-findings se retienen POR CATEGORÍA (una
// categoría muy usada no pisa artefactos de otra); sidecars y prompts legacy
// comparten cuota global. Los diagnostico-*.json (historial) no se tocan.
const KEEP_RECENT_PLANNING_ARTIFACTS = 5;

async function listPlanningEntriesWithFallback(
  repoPath: string,
): Promise<Array<{ name: string; dir: string; isDirectory: boolean }>> {
  const base = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
  const subdirs = ["", "diagnostics", "findings", "prompts", "security"];
  const all: Array<{ name: string; dir: string; isDirectory: boolean }> = [];
  const seen = new Set<string>();
  for (const sub of subdirs) {
    const dir = sub ? `${base}/${sub}` : base;
    const entries = await window.termcanvas.fs.listDir(dir).catch(() => null);
    if (!entries) continue;
    for (const e of entries) {
      const key = sub ? `${sub}/${e.name}` : e.name;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ name: e.name, dir, isDirectory: e.isDirectory });
    }
  }
  return all;
}

async function prunePlanningArtifacts(repoPath: string): Promise<void> {
  const base = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
  const entries = await listPlanningEntriesWithFallback(repoPath);
  if (!entries.length) return;

  // tool-findings agrupados por categoría ("" = legacy sin categoría).
  const tfGroups = new Map<string, Array<{ name: string; dir: string; ts: number }>>();
  const prompts: Array<{ name: string; dir: string; ts: number }> = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const tf = parseToolFindingsName(entry.name);
    if (tf) {
      const key = tf.category ?? "";
      const group = tfGroups.get(key) ?? [];
      group.push({ name: entry.name, dir: entry.dir, ts: tf.ts });
      tfGroups.set(key, group);
      continue;
    }
    // Sidecar nuevo: <plan>.json.prompt.md — el ts vive dentro del nombre.
    const sidecar = /^diagnostico-(?:[a-z][a-z-]*-)?(\d+)\.json\.prompt\.md$/.exec(
      entry.name,
    );
    if (sidecar && Number.isFinite(Number(sidecar[1]))) {
      prompts.push({ name: entry.name, dir: entry.dir, ts: Number(sidecar[1]) });
      continue;
    }
    const pm = /^prompt-(\d+)\.md$/.exec(entry.name);
    if (pm && Number.isFinite(Number(pm[1]))) {
      prompts.push({ name: entry.name, dir: entry.dir, ts: Number(pm[1]) });
    }
  }

  const stale: Array<{ name: string; dir: string }> = [];
  for (const group of tfGroups.values()) {
    group.sort((a, b) => b.ts - a.ts);
    for (const item of group.slice(KEEP_RECENT_PLANNING_ARTIFACTS)) {
      stale.push({ name: item.name, dir: item.dir });
    }
  }
  prompts.sort((a, b) => b.ts - a.ts);
  for (const item of prompts.slice(KEEP_RECENT_PLANNING_ARTIFACTS)) {
    stale.push({ name: item.name, dir: item.dir });
  }
  for (const item of stale) {
    void window.termcanvas.fs.delete(`${item.dir}/${item.name}`).catch(() => {
      // Best-effort: un archivo que no se pudo borrar no rompe la corrida.
    });
  }
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
      // Gate previo del pin CLI (solo en el lanzamiento fresco): si el
      // modelo configurado no existe en el catálogo real, fallar acá.
      if (!resumeSessionId) {
        const blockReason = await assertPhaseModelAvailable("diagnosisLlm");
        if (blockReason) {
          useDiagnosisStore.setState({
            phase: "idle",
            sessionRuntime: null,
            toolsDone: false,
            toolsSummary: null,
            selectedCategory: null,
            error: `[diagnosisLlm] ${blockReason}`,
          });
          activeSession = null;
          activeCategory = null;
          return;
        }
      }
      handle = await launchPlanningSession({
        mode: "audit",
        repoPath,
        projectId,
        worktreeId,
        roadmapText: "",
        attachmentNames: [],
        category: activeCategory ?? undefined,
        allowedSkills: activeCategory
          ? diagnosisAllowedSkills(activeCategory)
          : [],
        model: resolvePhaseModelRef("diagnosisLlm"),
        cli: resolveCliForPhase("diagnosisLlm", usePreferencesStore.getState().phaseClis),
        headless: !shouldRunPhaseInTui(),
        toolFindingsText: pendingFindingsText,
        resumeSessionId,
        onResult: (result) => {
          if (!isAuditPlan(result)) {
            useDiagnosisStore.setState({
              phase: "idle",
              sessionRuntime: null,
              toolsDone: false,
              toolsSummary: null,
              selectedCategory: null,
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
            category: activeCategory ?? LEGACY_CATEGORY_ID,
            prompt: handle?.prompt,
            toolCoverage: pendingCoverage,
          };
          activeCategory = null;
          useDiagnosisStore.setState((state) => ({
            phase: "idle",
            sessionRuntime: null,
            error: null,
            toolsDone: false,
            toolsSummary: null,
            selectedCategory: null,
            history: [newRecord, ...state.history],
            latestDiagnosisId: newRecord.id,
          }));
          activeSession = null;
          // Re-sincroniza con disco: el historial queda idéntico (el plan ya
          // está escrito) y el índice toolFindingsByCategory incorpora el
          // tool-findings de ESTA corrida — habilita el "→ LLM directo" de la
          // categoría sin esperar a reabrir el modal.
          void useDiagnosisStore.getState().loadHistory(repoPath);
        },
        onError: (message) => {
          // El tail del proceso va adjunto: cuando la sesión se corta "de la
          // nada", las últimas líneas dicen por qué (cuota, crash, timeout).
          const tail = handle ? getPhaseOutputTail(handle.terminalId) : "";
          activeCategory = null;
          useDiagnosisStore.setState({
            phase: "idle",
            sessionRuntime: null,
            toolsDone: false,
            toolsSummary: null,
            selectedCategory: null,
            error: tail
              ? `${message}\n\nÚltimas líneas del proceso:\n${tail}`
              : message,
          });
          activeSession = null;
        },
        onExitedWithoutFile: (sessionId) => {
          if (stopped || flowCancelled) return;
          // Tail ANTES de stop(): destroyTerminalRuntime saca el runtime del
          // registro y el buffer del preview deja de existir.
          const tail = handle ? getPhaseOutputTail(handle.terminalId) : "";
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
            selectedCategory: null,
            error:
              (sessionId
                ? "El LLM terminó sin escribir el plan y el reintento tampoco lo escribió."
                : "El LLM terminó sin escribir el plan y no se pudo reanudar la sesión.") +
              (tail ? `\n\nÚltimas líneas del proceso:\n${tail}` : ""),
          });
          activeSession = null;
          activeCategory = null;
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
      activeCategory = null;
      useDiagnosisStore.setState({
        phase: "idle",
        sessionRuntime: null,
        toolsDone: false,
        toolsSummary: null,
        selectedCategory: null,
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
  selectedCategory: null,
  toolsDone: false,
  toolsSummary: null,
  toolFindingsByCategory: {},
  latestDiagnosisId: null,

  start: async (categoryId) => {
    if (get().phase !== "idle") return;
    const category = getDiagnosisCategory(categoryId);
    if (!category) {
      set({
        error: `Categoría de diagnóstico desconocida: "${categoryId}".`,
      });
      return;
    }

    const active = resolveActiveWorktree();
    if (!active) return;
    const { projectId, worktreeId, path: repoPath } = active;

    activeCategory = category.id;
    pendingFindingsText = "";
    pendingCoverage = undefined;
    pendingFindingsPath = "";

    // Categoría LLM-only (sin herramientas mapeadas): no hay Fase A que
    // esperar ni gate manual — directo a la exploración dirigida del LLM.
    if (category.tools.length === 0) {
      flowCancelled = false;
      set({
        phase: "running",
        sessionRuntime: null,
        error: null,
        selectedCategory: category.id,
        toolsDone: false,
        toolsSummary: null,
      });
      await launchLlmPhase({ repoPath, projectId, worktreeId });
      return;
    }

    set({
      phase: "tools",
      sessionRuntime: null,
      error: null,
      selectedCategory: category.id,
      toolsDone: false,
      toolsSummary: null,
    });

    // Retención: borra los tool-findings/prompt que exceden los N más
    // recientes ANTES de escribir los nuevos de esta corrida.
    await prunePlanningArtifacts(repoPath);

    // FASE A — solo las herramientas de la categoría (orquestador headless).
    // El paso a la Fase B es MANUAL (continueToLlm): acá solo se preparan
    // los datos.
    const toolsHandle = await launchToolsSession({
      repoPath,
      projectId,
      worktreeId,
      categoryId: category.id,
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
        set({
          phase: "idle",
          sessionRuntime: null,
          error: message,
          selectedCategory: null,
        });
        activeSession = null;
        activeCategory = null;
      },
    });
    if (!toolsHandle) {
      // launchToolsSession ya notificó el error.
      set({ phase: "idle", selectedCategory: null });
      activeCategory = null;
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
      set({
        phase: "idle",
        toolsDone: false,
        toolsSummary: null,
        selectedCategory: null,
      });
      activeCategory = null;
      return;
    }
    const { projectId, worktreeId, path: repoPath } = active;
    await launchLlmPhase({ repoPath, projectId, worktreeId });
  },

  // Salteo de la Fase A (para testing/iteración del LLM): usa el
  // tool-findings MÁS RECIENTE DE ESA CATEGORÍA en .agents/planning (el de
  // la última corrida de herramientas de esa categoría) y lanza directo la
  // Fase B sin re-correr el pipeline determinista. Sin findings previos →
  // error claro, no se inventa nada.
  startLlmDirect: async (categoryId) => {
    if (get().phase !== "idle") return;
    if (categoryId && !isDiagnosisCategoryId(categoryId)) {
      set({
        phase: "idle",
        error: `Categoría de diagnóstico desconocida: "${categoryId}".`,
      });
      return;
    }
    const active = resolveActiveWorktree();
    if (!active) {
      set({ phase: "idle" });
      return;
    }
    const { projectId, worktreeId, path: repoPath } = active;

    const findingsPath = await newestToolFindings(
      `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`,
      categoryId,
    );
    if (!findingsPath) {
      set({
        phase: "idle",
        error: categoryId
          ? `No hay hallazgos previos de la categoría "${categoryId}" en .agents/planning — corré primero ese diagnóstico completo.`
          : "No hay hallazgos de herramientas previos en .agents/planning — corré primero un diagnóstico completo.",
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
    activeCategory = categoryId ?? null;
    pendingFindingsPath = findingsPath;
    pendingFindingsText = formatToolFindingsForPrompt(json, findingsPath);
    pendingCoverage = computeToolCoverage(json);
    flowCancelled = false;
    set({
      phase: "running",
      sessionRuntime: null,
      error: null,
      selectedCategory: categoryId ?? null,
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
    activeCategory = null;
    set({
      phase: "idle",
      sessionRuntime: null,
      error: null,
      selectedCategory: null,
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
      const base = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
      const candidates = [
        `${base}/${rec.filename}`,
        `${base}/diagnostics/${rec.filename}`,
        `${base}/findings/${rec.filename}`,
        `${base}/security/${rec.filename}`,
      ];
      for (const p of candidates) {
        void window.termcanvas.fs.delete(p).catch(() => {});
      }
    }
  },

  takeLatestId: () => {
    const id = get().latestDiagnosisId;
    if (id) set({ latestDiagnosisId: null });
    return id;
  },

  loadHistory: async (repoPath: string) => {
    if (typeof window === "undefined") return;
    const base = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;
    const dirs = [base, `${base}/diagnostics`, `${base}/findings`, `${base}/prompts`, `${base}/security`];
    const allEntries: Array<{ name: string; dir: string; isDirectory: boolean }> = [];
    for (const d of dirs) {
      const entries = await window.termcanvas.fs.listDir(d).catch(() => []);
      for (const e of entries) allEntries.push({ name: e.name, dir: d, isDirectory: e.isDirectory });
    }
    const records: DiagnosisRecord[] = [];
    const toolFindings: Array<{ ts: number; category: string | null }> = [];
    for (const entry of allEntries) {
      if (entry.isDirectory) continue;
      const parsed = parseToolFindingsName(entry.name);
      if (parsed) toolFindings.push(parsed);
    }
    toolFindings.sort((a, b) => a.ts - b.ts);
    const coverageCache = new Map<string, ToolCoverageSummary>();
    const toolFindingsByCategory: Record<string, number> = {};
    for (const tf of toolFindings) {
      if (!tf.category) continue;
      const current = toolFindingsByCategory[tf.category];
      if (current === undefined || tf.ts > current) {
        toolFindingsByCategory[tf.category] = tf.ts;
      }
    }

    for (const entry of allEntries) {
      if (entry.isDirectory) continue;
      let ts: number | null = null;
      let slug: string | null = null;
      const diagParsed = parseDiagnosisFileName(entry.name);
      if (diagParsed) {
        ts = diagParsed.ts;
        slug = diagParsed.category;
      } else {
        const legacyPlan = /^plan-(\d+)\.json$/.exec(entry.name);
        if (legacyPlan && Number.isFinite(Number(legacyPlan[1]))) {
          ts = Number(legacyPlan[1]);
        }
      }
      if (ts == null || !Number.isFinite(ts)) continue;
      const read = await window.termcanvas.fs
        .readFile(`${entry.dir}/${entry.name}`)
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
        category:
          slug && isDiagnosisCategoryId(slug) ? slug : LEGACY_CATEGORY_ID,
        toolCoverage: await coverageFor(ts, slug),
      });
    }
    records.sort((a, b) => (a.id < b.id ? 1 : -1));
    set({ history: records, toolFindingsByCategory });

    // El tool-findings con mayor timestamp estrictamente anterior al
    // diagnóstico y de SU MISMA categoría es el de su corrida (cada corrida
    // escribe tools → LLM). Un slug desconocido (versión futura) no matchea
    // nada → cobertura undefined → la UI muestra "—", honesto.
    async function coverageFor(
      diagTs: number,
      slug: string | null,
    ): Promise<ToolCoverageSummary | undefined> {
      let best = -1;
      for (const tf of toolFindings) {
        if (tf.category !== slug) continue;
        if (tf.ts < diagTs && tf.ts > best) best = tf.ts;
      }
      if (best < 0) return undefined;
      const cacheKey = `${slug ?? ""}:${best}`;
      if (coverageCache.has(cacheKey)) return coverageCache.get(cacheKey);
      const candidates = [
        `${base}/tool-findings-${slug ? `${slug}-` : ""}${best}.json`,
        `${base}/findings/tool-findings-${slug ? `${slug}-` : ""}${best}.json`,
      ];
      let json: Record<string, unknown> | null = null;
      for (const p of candidates) {
        json = await readToolFindings(p);
        if (json) break;
      }
      const summary = json ? computeToolCoverage(json) : undefined;
      if (summary) coverageCache.set(cacheKey, summary);
      return summary;
    }
  },
}));
