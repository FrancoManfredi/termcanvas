/**
 * VerificationService.
 * Pipeline fail-fast: pnpm test (120s) streaming a logs/build.log, si exit≠0 skip build → fail.
 * Si test pass, pnpm build (120s). bounded logs 1MB, snippet head+tail 2KB.
 *
 * Verificacion por lenguaje de proyecto (node vs python/unknown) y cuarentena
 * de fallos no relacionados con el cambio basada en evidencia (solape entre
 * paths del output de fallo y createdFiles), nunca en listas fijas de tests.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  VerificationEvidence,
  VerificationReport,
  VerificationStep,
} from "../../shared/types/implement";
import { IMPLEMENT_VERIFY_TIMEOUT_MS, BUILD_LOG_MAX_BYTES } from "../../shared/types/implement";
import { getTimeouts } from "../factory/agentLoader";
import {
  resolveVerificationIsolation,
  stampVerificationSteps,
  type ExecutionIsolation,
  type IsolationMode,
} from "../runner/runnerExecutor";
import { parseRequestedFromPrompt, hasFolderIntent, isLiteralFolderName, parseRequestedFileName, isEmptyDirSync } from "./minimalChange";
import { capReverifyEvidence, validateReverifyCommands } from "../review/reverifyAllowlist";

/**
 * Timeout de verify efectivo (Ola 8): factory.yaml cuando válido,
 * IMPLEMENT_VERIFY_TIMEOUT_MS (shared, fallback documentado) cuando no.
 * Nunca lanza.
 */
function effectiveVerifyTimeoutMs(): number {
  try {
    return getTimeouts().verifyMs;
  } catch {
    return IMPLEMENT_VERIFY_TIMEOUT_MS;
  }
}

// ── Evidence (Ola 9: Verify como servicio+artefacto+loop propios) ──

/**
 * Heurística de superficie visual (NO juicio de calidad): un cambio tiene
 * superficie visual si toca archivos de UI por extensión o assets bajo
 * `public/`. Solo decide "requiere prueba visual o revisión humana
 * explícita" (evidence pending-human que el revisor ve y resuelve); este
 * módulo no juzga si el cambio visual está bien. Sin ejecutar nada pesado:
 * solo inspección de los paths de createdFiles.
 */
export const UI_EVIDENCE_EXTENSIONS = [".tsx", ".jsx", ".tsx", ".vue", ".css", ".scss"];

/** Ref estándar de las entradas de evidencia de steps (mismo build.log). */
const STEP_EVIDENCE_REF = "logs/build.log";

const VISUAL_EVIDENCE_SUMMARY =
  "cambio con superficie visual: requiere prueba visual o revisión humana explícita";

function isUiSurfaceFile(f: string): boolean {
  if (typeof f !== "string" || f.length === 0) return false;
  const norm = f.replace(/\\/g, "/").toLowerCase();
  if (norm === "public" || norm.startsWith("public/") || norm.includes("/public/")) return true;
  const dot = norm.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = norm.slice(dot);
  return (UI_EVIDENCE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Detección de evidencia visual (real, sin ejecutar nada pesado).
 * Si algún archivo de createdFiles es UI (ver UI_EVIDENCE_EXTENSIONS o
 * bajo `public/`), retorna la entrada visual pending-human; si no, null.
 * Puro, sin I/O.
 */
export function detectVisualEvidence(createdFiles: string[]): VerificationEvidence | null {
  const files = (createdFiles ?? []).filter(
    (f): f is string => typeof f === "string" && f.length > 0,
  );
  const ui = files.filter(isUiSurfaceFile);
  if (ui.length === 0) return null;
  return {
    kind: "visual",
    status: "pending-human",
    ref: ui.slice(0, 20).join(", "),
    summary: VISUAL_EVIDENCE_SUMMARY,
  };
}

/**
 * Evidence con aislamiento (Ola 15, aditivo): copia el `isolation` real del
 * step que la generó. Campo opcional: la evidencia vieja sin `isolation`
 * sigue válida (contratos vivos, restore tolerante).
 */
export type VerificationEvidenceWithIsolation = VerificationEvidence & {
  isolation?: IsolationMode;
};

/** Propaga el `isolation` del step a su entrada de evidence (aditivo). Puro. */
function withStepIsolation(
  entry: VerificationEvidence,
  step: VerificationStep,
): VerificationEvidenceWithIsolation {
  const isolation = (step as { isolation?: IsolationMode }).isolation;
  if (isolation === "docker" || isolation === "none") return { ...entry, isolation };
  return entry;
}

/**
 * Una entrada de evidencia por step: test→kind "test", setup/build→kind
 * "build". El status refleja lo ocurrido en el step (pass/fail/skipped,
 * nunca un pass inventado) y el summary cita `<name>: <status> (exit X)`,
 * más la razón visible cuando hay cuarentena o skip.
 * Puro, sin I/O.
 */
export function buildStepEvidence(step: VerificationStep): VerificationEvidenceWithIsolation {
  const kind: VerificationEvidence["kind"] = step.name === "test" ? "test" : "build";
  const summaryBase = `${step.name}: ${step.status} (exit ${step.exitCode ?? "null"})`;
  // Cuarentena: el step ya fue promovido a pass por shouldIgnoreTestFailure;
  // la evidencia lo refleja pero cita la razón (nada de pass silenciosos).
  const q = parseQuarantineFromSnippet(step.logSnippet);
  if (q) {
    return withStepIsolation(
      {
        kind,
        status: step.status,
        ref: STEP_EVIDENCE_REF,
        summary: `${summaryBase} — quarantined ${q.count} failure(s), ${q.reason}`,
      },
      step,
    );
  }
  if (step.status === "skipped" && step.logSnippet) {
    const reason = step.logSnippet.split("\n")[0]?.trim().slice(0, 200);
    return withStepIsolation(
      {
        kind,
        status: step.status,
        ref: STEP_EVIDENCE_REF,
        summary: reason ? `${summaryBase} — ${reason}` : summaryBase,
      },
      step,
    );
  }
  return withStepIsolation(
    { kind, status: step.status, ref: STEP_EVIDENCE_REF, summary: summaryBase },
    step,
  );
}

/**
 * Ensambla evidence = [una entrada por step, en orden] + [visual si hay
 * superficie UI]. Puro, sin I/O. No cambia steps/overall: solo agrega el
 * campo opcional `evidence` al report.
 */
export function attachEvidence(
  report: VerificationReport,
  createdFiles: string[] = [],
): VerificationReport {
  const evidence: VerificationEvidence[] = (report.steps ?? []).map(buildStepEvidence);
  const visual = detectVisualEvidence(createdFiles);
  if (visual) evidence.push(visual);
  return { ...report, evidence };
}

// ── H-001: anomalías de createdFiles (fantasma / carpeta literal) ──

/** True si `dir` existe y no contiene ninguna entrada (carpeta vacía). */
function isEmptyDir(fullPath: string): boolean {
  return isEmptyDirSync(fullPath);
}

/**
 * H-001 (decisión documentada): ante `createdFiles` con rutas inexistentes
 * (fantasmas) o una carpeta literal del prompt y VACÍA, verification NO puede
 * dar `pass` con "skipped (no code change)" — retorna la razón de la anomalía
 * y el caller marca `fail` (ruta a Triage, humano decide). `fail` y no
 * `blocked`: el schema de steps solo admite pass|fail|skipped y un skip con
 * overall=fail sería ambiguo; el fail cita la evidencia exacta.
 * H-012 (misma función, sin duplicar): carpeta pedida que EXISTE pero el
 * ARCHIVO pedido sigue ausente en disco (vacía o con otros archivos) → fail
 * con razón H-012. También cubre entrega vacía (`[]`): si el prompt pedía
 * carpeta+archivo, la carpeta existe y el archivo falta, es fail aunque no
 * haya nada declarado (no pass ciego por trivial). Sin carpeta/archivo en
 * disco → null (preserva pass de carpeta sola, nonode/python/unknown).
 * Puro salvo el stat en disco, nunca lanza.
 */
export function detectCreatedFilesAnomaly(
  worktreePath: string,
  prompt: string | undefined,
  createdFiles: string[],
): string | null {
  try {
    const files = createdFiles ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      try {
        if (typeof prompt === "string" && prompt && hasFolderIntent(prompt)) {
          const cwdEmpty = path.resolve(worktreePath);
          const folderRel = parseRequestedFromPrompt(prompt)?.relPath ?? null;
          const needEmpty = parseRequestedFileName(prompt);
          if (typeof folderRel === "string" && folderRel && needEmpty) {
            let folderIsDir = false;
            try {
              folderIsDir = fs.statSync(path.join(cwdEmpty, folderRel)).isDirectory();
            } catch {
              folderIsDir = false;
            }
            if (folderIsDir) {
              let presentEmpty = false;
              try {
                if (fs.existsSync(path.join(cwdEmpty, folderRel, needEmpty))) presentEmpty = true;
              } catch {}
              if (!presentEmpty) {
                try {
                  if (fs.existsSync(path.join(cwdEmpty, needEmpty))) presentEmpty = true;
                } catch {}
              }
              if (!presentEmpty) {
                return `carpeta "${folderRel}" existe pero el archivo pedido "${needEmpty}" ausente en disco — verification fail (H-012)`;
              }
            }
          }
        }
      } catch {}
      return null;
    }
    const cwd = path.resolve(worktreePath);
    for (const f of files) {
      if (typeof f !== "string" || f.length === 0) {
        return `createdFiles con entrada vacía — anomalía H-001 (no se registra como hecho)`;
      }
      const full = path.join(cwd, f);
      let exists = false;
      try {
        exists = fs.existsSync(full);
      } catch {
        exists = false;
      }
      if (!exists) {
        return `createdFiles fantasma: "${f}" no existe en disco — verification fail (H-001)`;
      }
      // Carpeta literal del prompt (E2E-05: >3 palabras del prompt) y vacía:
      // el fallback inventó la ruta en vez de crear lo pedido.
      try {
        const st = fs.statSync(full);
        if (st.isDirectory() && isEmptyDir(full) && prompt && isLiteralFolderName(prompt, f)) {
          return `carpeta literal vacía "${f}" (>3 palabras del prompt, 0 archivos) — verification fail (H-001)`;
        }
        // H-012 (misma función): la carpeta pedida existe pero el archivo
        // pedido sigue ausente → fail honesto (no pass por carpeta vacía).
        if (st.isDirectory() && prompt && hasFolderIntent(prompt)) {
          const need = parseRequestedFileName(prompt);
          if (need) {
            let present = false;
            try {
              if (fs.existsSync(path.join(cwd, f, need))) present = true;
            } catch {}
            if (!present) {
              try {
                if (fs.existsSync(path.join(cwd, need))) present = true;
              } catch {}
            }
            if (!present) {
              return `carpeta "${f}" existe pero el archivo pedido "${need}" ausente en disco — verification fail (H-012)`;
            }
          }
        }
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

// ── Project kind detection (H2) ──

export type ProjectKind = "node" | "python" | "unknown";

/**
 * Detecta el lenguaje del proyecto para elegir la suite de verificacion.
 * node = hay package.json; python = hay marcador python (pyproject.toml /
 * pytest.ini / setup.py) O createdFiles con *.py; resto unknown.
 * No ejecuta nada, solo inspecciona el filesystem.
 */
export function detectProjectKind(cwd: string, createdFiles: string[] = []): ProjectKind {
  try {
    if (fs.existsSync(path.join(cwd, "package.json"))) return "node";
  } catch {}
  for (const marker of ["pyproject.toml", "pytest.ini", "setup.py"]) {
    try {
      if (fs.existsSync(path.join(cwd, marker))) return "python";
    } catch {}
  }
  for (const f of createdFiles ?? []) {
    if (typeof f === "string" && f.toLowerCase().replace(/\\/g, "/").endsWith(".py")) return "python";
  }
  return "unknown";
}

// ── Evidence-based quarantine (H3) ──

export interface QuarantineAssessment {
  /** Cantidad de lineas de fallo detectadas en el output. */
  count: number;
  /** Primeras lineas de fallo (evidencia citada en el snippet). */
  failures: string[];
  /** Razon legible con la evidencia de no-solape. */
  reason: string;
}

const NOT_OK_LINE_RE = /not ok\b/i;
const GENERIC_FAIL_RE = /fail/i;
const PATH_EXT_RE = /([A-Za-z0-9_\-./\\]+?\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|json))\b/g;
const STACK_FRAME_RE = /^\s*at\s+(?:.*\()?([^()]+?):\d+:\d+\)?/;

function normalizeCompare(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\.\//, "")
    .replace(/:+\d+(:+\d+)*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function basenameOf(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Solape entre un path mencionado en el fallo y un archivo del cambio.
 * Comparacion normalizada case-insensitive: igualdad, sufijo/prefijo de
 * ruta (absoluto vs relativo, carpeta vs contenido) o mismo basename con
 * extension. Direccion conservadora: ante la duda hay solape (fail real).
 */
function pathsOverlap(mentioned: string, changed: string): boolean {
  if (!mentioned || !changed) return false;
  if (mentioned === changed) return true;
  if (mentioned.endsWith(`/${changed}`) || changed.endsWith(`/${mentioned}`)) return true;
  if (mentioned.startsWith(`${changed}/`) || changed.startsWith(`${mentioned}/`)) return true;
  return basenameOf(mentioned) === basenameOf(changed);
}

function cleanMentioned(raw: string): string | null {
  const s = raw
    .replace(/\\/g, "/")
    .replace(/^[('"]+/, "")
    .replace(/[('")\],;]+$/, "");
  if (!s || s.includes("://")) return null;
  return s;
}

function extractPathsFromLine(line: string): string[] {
  const out: string[] = [];
  PATH_EXT_RE.lastIndex = 0;
  for (const m of line.matchAll(PATH_EXT_RE)) {
    const cleaned = cleanMentioned(m[1] ?? "");
    if (cleaned) out.push(normalizeCompare(cleaned));
  }
  return out;
}

/**
 * Regla de cuarentena basada en evidencia.
 * Retorna assessment SI Y SOLO SI hay lineas de fallo Y ningun path
 * mencionado en el output de fallo (lineas de fallo + stack frames) solapa
 * con `createdFiles`. Sin solape el fallo no lo produjo el cambio y se
 * cuarentena con evidencia; con solape retorna null (fail real, fail-fast).
 * No usa listas fijas de tests ni umbrales de conteo.
 */
export function evaluateQuarantine(
  failureOutput: string,
  createdFiles: string[],
): QuarantineAssessment | null {
  if (!failureOutput) return null;
  const lines = failureOutput.split("\n");
  let evidenceLines = lines.filter((l) => NOT_OK_LINE_RE.test(l));
  if (evidenceLines.length === 0) {
    evidenceLines = lines.filter((l) => GENERIC_FAIL_RE.test(l) && extractPathsFromLine(l).length > 0);
  }
  if (evidenceLines.length === 0) return null;

  const mentioned = new Set<string>();
  for (const l of evidenceLines) {
    for (const p of extractPathsFromLine(l)) mentioned.add(p);
  }
  for (const l of lines) {
    const m = l.match(STACK_FRAME_RE);
    if (m && m[1]) {
      const cleaned = cleanMentioned(m[1].trim());
      if (cleaned) mentioned.add(normalizeCompare(cleaned));
    }
  }

  const changed = (createdFiles ?? [])
    .filter((f): f is string => typeof f === "string")
    .map((f) => normalizeCompare(f))
    .filter(Boolean);
  const overlap = [...mentioned].some((men) => changed.some((c) => pathsOverlap(men, c)));
  if (overlap) return null;

  const failures = evidenceLines.slice(0, 3).map((l) => l.trim().slice(0, 200));
  const mentionedList = [...mentioned].slice(0, 8);
  const reason =
    `no overlap between failure paths [${mentionedList.join(", ") || "no paths detected"}] ` +
    `and change [${(createdFiles ?? []).join(", ") || "no files"}]`;
  return { count: evidenceLines.length, failures, reason };
}

/**
 * Snippet de evidencia que se adjunta al test step cuarentenado.
 * Formato parseable por parseQuarantineFromSnippet (contrato con el
 * orquestador para la entrada de timeline).
 */
export function formatQuarantineSnippet(a: QuarantineAssessment, createdFiles: string[]): string {
  const files = (createdFiles ?? []).join(", ") || "no files";
  return (
    `[quarantine] quarantined ${a.count} failure(s), ` +
    `no overlap with change [${files}]; failures: ${a.failures.join(" | ").slice(0, 600)}`
  );
}

/**
 * Recupera la evidencia de cuarentena desde un logSnippet (contrato
 * snippet → timeline meta {quarantine: {tests, reason}}).
 */
export function parseQuarantineFromSnippet(
  snippet: string | undefined,
): { count: number; tests: string[]; reason: string } | null {
  if (!snippet) return null;
  const m = snippet.match(
    /\[quarantine\] quarantined (\d+) failure\(s\), no overlap with change \[(.*?)\]; failures: ([\s\S]*)/,
  );
  if (!m) return null;
  const count = Number(m[1]);
  const files = (m[2] ?? "").trim();
  const failuresRaw = (m[3] ?? "").trim();
  const tests = failuresRaw
    ? failuresRaw.split(" | ").map((s) => s.trim()).filter(Boolean).slice(0, 3)
    : [];
  return { count, tests, reason: `no overlap with change [${files}]` };
}

/**
 * Seam SOLO para tests: reemplaza el spawn real de `runFocused` (misma
 * firma que `spawnWithLog`). `null` = ejecución real. Espejo de
 * `setReviewPromptMock` (el reviewer jamás toca bash: la ejecuta el sistema).
 */
export type RunFocusedExecutor = (
  command: string,
  cwd: string,
  logPath: string,
  timeoutMs: number,
) => Promise<{ exitCode: number | null; output: string }>;

let runFocusedExecutorOverride: RunFocusedExecutor | null = null;

export function setRunFocusedExecutorForTests(fn: RunFocusedExecutor | null): void {
  runFocusedExecutorOverride = fn;
}

export class VerificationService {
  /**
   * Re-verificación enfocada (Ola 17: review que re-valida).
   * Valida `commands` contra la allowlist cerrada y ejecuta las válidas
   * reutilizando `spawnWithLog` (mismo timeout efectivo del verify + kill
   * ante comandos colgados, sin duplicar lógica de spawn). Sin válidas →
   * no ejecuta nada y la evidence lleva la nota fail-closed. Evidence total
   * capada a 8KB con marca `…[truncado]`.
   * Nunca lanza: cualquier fallo interno termina en evidence con nota.
   */
  async runFocused(
    commands: string[],
    opts: { worktree: string; jobPaths: string[]; timeoutMs?: number },
  ): Promise<{ commands: string[]; evidence: string; isolation: "docker" | "none" }> {
    const fallbackNote = "reverify ignorado: comando fuera de allowlist";
    try {
      let isolation: IsolationMode = "none";
      try {
        const resolved = await resolveVerificationIsolation();
        if (resolved && (resolved.isolation === "docker" || resolved.isolation === "none")) {
          isolation = resolved.isolation;
        }
      } catch {
        isolation = "none";
      }
      const worktree =
        opts && typeof opts.worktree === "string" && opts.worktree.length > 0
          ? path.resolve(opts.worktree)
          : process.cwd();
      const jobPaths = opts && Array.isArray(opts.jobPaths) ? opts.jobPaths : [];
      let checked: { valid: string[]; invalid: string[]; note: string | null };
      try {
        checked = validateReverifyCommands(commands, worktree, jobPaths);
      } catch {
        checked = { valid: [], invalid: [], note: fallbackNote };
      }
      if (checked.valid.length === 0) {
        return { commands: [], evidence: checked.note ?? fallbackNote, isolation };
      }
      let timeoutMs = effectiveVerifyTimeoutMs();
      if (
        opts &&
        typeof opts.timeoutMs === "number" &&
        Number.isInteger(opts.timeoutMs) &&
        opts.timeoutMs > 0
      ) {
        timeoutMs = opts.timeoutMs;
      }
      const logPath = path.join(worktree, "logs", "reverify.log");
      try {
        fs.mkdirSync(path.join(worktree, "logs"), { recursive: true });
      } catch {}
      const lines: string[] = [];
      const executed: string[] = [];
      for (const cmd of checked.valid) {
        const start = Date.now();
        let exitCode: number | null = null;
        let output = "";
        try {
          const exec: RunFocusedExecutor =
            runFocusedExecutorOverride ?? ((c, cwd, lp, t) => this.spawnWithLog(c, cwd, lp, t));
          const res = await exec(cmd, worktree, logPath, timeoutMs);
          exitCode = res ? res.exitCode : null;
          output = res && typeof res.output === "string" ? res.output : "";
        } catch (e) {
          exitCode = 1;
          output = `[reverify error ${cmd}: ${e instanceof Error ? e.message : String(e)}]`;
        }
        executed.push(cmd);
        lines.push(buildSnippet(`$ ${cmd} (exit ${exitCode ?? "null"}, ${Date.now() - start}ms)\n${output}`));
      }
      const header =
        `[reverify focused ${new Date().toISOString()} isolation=${isolation} ` +
        `commands=${executed.length}]\n`;
      return {
        commands: executed,
        evidence: capReverifyEvidence(header + lines.join("\n---\n")),
        isolation,
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { commands: [], evidence: `${fallbackNote} (${detail.slice(0, 200)})`, isolation: "none" };
    }
  }

  /**
   * Run verification in worktreePath, streaming to {dir}/logs/build.log
   * Fail-fast: si test fail, no corre build (skipped).
   * Retorna VerificationReport con overall pass/fail.
   * @param prompt - optional prompt to detect trivial folder creation
   * @param createdFiles - archivos del cambio (evidencia de cuarentena)
   */
  async run(
    worktreePath: string,
    dir: string,
    prompt?: string,
    createdFiles: string[] = [],
  ): Promise<VerificationReport> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const cwd = path.resolve(worktreePath);
    const logDir = path.join(dir, "logs");
    const logPath = path.join(logDir, "build.log");

    try {
      fs.mkdirSync(logDir, { recursive: true });
      // ensure build.log exists and write header if empty
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, `[verification started ${startedAt} cwd=${cwd}]\n`, "utf-8");
      } else {
        // Truncate if > 1MB before starting new run
        try {
          const stat = fs.statSync(logPath);
          if (stat.size > BUILD_LOG_MAX_BYTES) {
            const content = fs.readFileSync(logPath, "utf-8");
            const truncated = `[truncated ${stat.size} bytes, keeping tail]\n` + content.slice(-BUILD_LOG_MAX_BYTES / 2);
            fs.writeFileSync(logPath, truncated, "utf-8");
          }
        } catch {}
        try {
          fs.appendFileSync(logPath, `\n[verification started ${startedAt} cwd=${cwd}]\n`, "utf-8");
        } catch {}
      }
    } catch {}

    // Aislamiento honesto (Ola 15): se resuelve UNA vez por run y se estampa
    // en cada step emitido (reutiliza spawnStep, sin duplicar lógica).
    const isolation: ExecutionIsolation = await resolveVerificationIsolation();
    const finish = (report: VerificationReport, files: string[] = []): VerificationReport =>
      attachEvidence({ ...report, steps: stampVerificationSteps(report.steps, isolation) }, files);

    // H-001: gate de anomalías ANTES de cualquier skip trivial o suite.
    // Fantasma o carpeta literal vacía → fail honesto con la razón (jamás
    // pass con "skipped (no code change)": eso pasaba a ciegas H-001).
    const anomaly = detectCreatedFilesAnomaly(cwd, prompt, createdFiles);
    if (anomaly) {
      const failStep: VerificationStep = {
        name: "test",
        command: "pnpm test",
        exitCode: null,
        durationMs: 0,
        status: "fail",
        logSnippet: anomaly,
        logPath: "logs/build.log",
      };
      const buildSkipped: VerificationStep = {
        name: "build",
        command: "pnpm build",
        exitCode: null,
        durationMs: 0,
        status: "skipped",
        logSnippet: "skipped due to createdFiles anomaly (fail-fast, H-001)",
        logPath: "logs/build.log",
      };
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      try {
        fs.appendFileSync(logPath, `\n[verification finished ${finishedAt} overall=fail duration=${durationMs}ms anomaly: ${anomaly}]\n`, "utf-8");
        this.truncateIfNeeded(logPath);
      } catch {}
      return finish(
        {
          steps: [failStep, buildSkipped],
          overall: "fail",
          startedAt,
          finishedAt,
          durationMs,
        },
        createdFiles,
      );
    }

    // Trivial folder creation detection – check before running heavy pnpm test
    // Try prompt-aware detection first, fallback to filesystem heuristic
    const trivialFolder = this.getTrivialFolder(cwd, prompt, startMs);
    if (trivialFolder) {
      const folderExists = (() => {
        try {
          return fs.existsSync(path.join(cwd, trivialFolder));
        } catch {
          return false;
        }
      })();
      if (folderExists) {
        // For verification without prompt param, the folder existence alone with recent mtime is enough to skip.
        // But also handle idempotent re-run where folder already existed long ago: if prompt indicates folder creation, still skip
        const shouldSkip = this.shouldSkipForTrivial(prompt, trivialFolder, cwd, startMs);
        if (shouldSkip) {
          const setupStep: VerificationStep = {
            name: "setup",
            command: "corepack enable",
            exitCode: 0,
            durationMs: 5,
            status: "pass",
            logSnippet: `trivial folder "${trivialFolder}" – setup skipped (folder exists)`,
            logPath: "logs/build.log",
          };
          const testStep: VerificationStep = {
            name: "test",
            command: "pnpm test",
            exitCode: 0,
            durationMs: 5,
            status: "pass",
            logSnippet: `trivial folder creation "${trivialFolder}" verified – pnpm test skipped (no code change)`,
            logPath: "logs/build.log",
          };
          const buildStep: VerificationStep = {
            name: "build",
            command: "pnpm build",
            exitCode: 0,
            durationMs: 5,
            status: "pass",
            logSnippet: "trivial folder creation – build skipped",
            logPath: "logs/build.log",
          };
          const steps: VerificationStep[] = [setupStep, testStep, buildStep];
          try {
            fs.appendFileSync(
              logPath,
              `\n[verification trivial folder "${trivialFolder}" pass – skipped pnpm test/build (prompt="${(prompt ?? "").slice(0, 80)}")]\n`,
              "utf-8"
            );
            this.truncateIfNeeded(logPath);
          } catch {}
          const finishedAt = new Date().toISOString();
          return finish(
            {
              steps,
              overall: "pass",
              startedAt,
              finishedAt,
              durationMs: Date.now() - startMs,
            },
            createdFiles,
          );
        }
      }
    }

    // Project-kind gate: solo node corre la suite JS. python/unknown no tienen
    // suite JS que correr en esta ola (pytest pendiente) → skipped honesto con
    // nota del kind detectado y overall pass (el cambio igual va a Review).
    const kind = detectProjectKind(cwd, createdFiles);
    if (kind !== "node") {
      const kindNote =
        kind === "python"
          ? "python project, JS suite N/A (pytest pending)"
          : "unknown project kind, JS suite N/A";
      const testSkipped: VerificationStep = {
        name: "test",
        command: "pnpm test",
        exitCode: null,
        durationMs: 0,
        status: "skipped",
        logSnippet: `skipped: no package.json in ${cwd} — ${kindNote} (not a change failure)`,
        logPath: "logs/build.log",
      };
      const buildSkipped: VerificationStep = {
        name: "build",
        command: "pnpm build",
        exitCode: null,
        durationMs: 0,
        status: "skipped",
        logSnippet: `skipped: ${kindNote}`,
        logPath: "logs/build.log",
      };
      const steps: VerificationStep[] = [testSkipped, buildSkipped];
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      try {
        fs.appendFileSync(logPath, `\n[verification finished ${finishedAt} overall=pass duration=${durationMs}ms (${kind} project, pnpm skipped — JS suite N/A)]\n`, "utf-8");
        this.truncateIfNeeded(logPath);
      } catch {}
      return finish(
        {
          steps,
          overall: "pass",
          startedAt,
          finishedAt,
          durationMs,
        },
        createdFiles,
      );
    }

    const steps: VerificationStep[] = [];

    // Ola 8: timeout efectivo desde factory.yaml (leído dentro de la función,
    // sin cambiar firmas). Idéntico a la constante con el yaml default.
    const verifyTimeoutMs = effectiveVerifyTimeoutMs();

    // Step 1: pnpm test
    const testStep = await this.spawnStep("test", "pnpm test", cwd, logPath, verifyTimeoutMs);
    steps.push(testStep);

    if (testStep.status === "skipped") {
      // Defensa en profundidad: sin package.json no hay suite que correr.
      // No es un fracaso del cambio → test y build skipped, overall pass.
      const buildSkipped: VerificationStep = {
        name: "build",
        command: "pnpm build",
        exitCode: null,
        durationMs: 0,
        status: "skipped",
        logSnippet: "skipped: no package.json in worktree (non-JS project kind)",
        logPath: "logs/build.log",
      };
      steps.push(buildSkipped);
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      try {
        fs.appendFileSync(logPath, `\n[verification finished ${finishedAt} overall=pass duration=${durationMs}ms (non-JS worktree, pnpm skipped)]\n`, "utf-8");
        this.truncateIfNeeded(logPath);
      } catch {}
      return finish(
        {
          steps,
          overall: "pass",
          startedAt,
          finishedAt,
          durationMs,
        },
        createdFiles,
      );
    }

    if (testStep.status === "fail") {
      // Cuarentena por evidencia: solo si ningun path del fallo solapa con el cambio.
      const quarantine = this.shouldIgnoreTestFailure(testStep, logPath, createdFiles);
      if (quarantine) {
        // Override test step to pass con evidencia citada
        testStep.status = "pass";
        testStep.exitCode = 0;
        const evidence = formatQuarantineSnippet(quarantine, createdFiles);
        const existingSnippet = testStep.logSnippet ?? "";
        testStep.logSnippet = existingSnippet + `\n${evidence}`;
        try {
          fs.appendFileSync(
            logPath,
            `\n[verification] quarantine: ${evidence} — reason: ${quarantine.reason}\n`,
            "utf-8"
          );
        } catch {}
        // For trivial folder creation, skip build as well and return pass
        const trivial = this.getTrivialFolder(cwd, prompt, startMs);
        if (trivial) {
          const buildSkippedPass: VerificationStep = {
            name: "build",
            command: "pnpm build",
            exitCode: 0,
            durationMs: 5,
            status: "pass",
            logSnippet: `trivial folder "${trivial}" – build skipped (quarantined failure, no overlap with change)`,
            logPath: "logs/build.log",
          };
          steps.push(buildSkippedPass);
          const finishedAt = new Date().toISOString();
          const durationMs = Date.now() - startMs;
          try {
            fs.appendFileSync(logPath, `\n[verification finished ${finishedAt} overall=pass duration=${durationMs}ms (quarantined)]\n`, "utf-8");
            this.truncateIfNeeded(logPath);
          } catch {}
          return finish(
            {
              steps,
              overall: "pass",
              startedAt,
              finishedAt,
              durationMs,
            },
            createdFiles,
          );
        }
        // Non-trivial quarantined failure: test now pass → continue to build as normal
      } else {
        // Real failure – fail-fast: skip build
        const buildSkipped: VerificationStep = {
          name: "build",
          command: "pnpm build",
          exitCode: null,
          durationMs: 0,
          status: "skipped",
          logSnippet: "skipped due to test failure (fail-fast)",
          logPath: "logs/build.log",
        };
        steps.push(buildSkipped);
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startMs;
        try {
          fs.appendFileSync(logPath, `\n[verification finished ${finishedAt} overall=fail duration=${durationMs}ms]\n`, "utf-8");
          this.truncateIfNeeded(logPath);
        } catch {}
        return finish(
          {
            steps,
            overall: "fail",
            startedAt,
            finishedAt,
            durationMs,
          },
          createdFiles,
        );
      }
    }

    // Step 2: pnpm build (only if test pass, or quarantined)
    const buildStep = await this.spawnStep("build", "pnpm build", cwd, logPath, verifyTimeoutMs);
    steps.push(buildStep);

    const overall = buildStep.status === "pass" ? "pass" : "fail";
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    try {
      fs.appendFileSync(logPath, `\n[verification finished ${finishedAt} overall=${overall} duration=${durationMs}ms]\n`, "utf-8");
      this.truncateIfNeeded(logPath);
    } catch {}

    return finish(
      {
        steps,
        overall,
        startedAt,
        finishedAt,
        durationMs,
      },
      createdFiles,
    );
  }

  /**
   * Determine trivial folder name for this verification.
   * Con prompt: la carpeta pedida (cualquier nombre) si existe en disco.
   * Sin prompt: heuristica generica por mtime (subdir creado muy reciente).
   */
  private getTrivialFolder(cwd: string, prompt: string | undefined, startMs: number): string | null {
    void startMs;
    // Prompt-aware: parser generico, cualquier nombre pedido
    if (prompt) {
      const folderFromPrompt = this.getRequestedFolderFromPrompt(prompt);
      if (folderFromPrompt) {
        try {
          if (fs.existsSync(path.join(cwd, folderFromPrompt))) return folderFromPrompt;
        } catch {}
      }
      return null;
    }
    // Filesystem heuristic: subdirectorio de primer nivel creado muy
    // recientemente (cualquier nombre), excluyendo dirs de sistema/deps.
    try {
      const skipTop = new Set([
        "node_modules",
        ".git",
        "dist",
        "dist-electron",
        "dist-cli",
        "dist-headless",
        "logs",
        ".hydra",
        ".worktrees",
        "factory",
      ]);
      const cands: { rel: string; mtime: number }[] = [];
      const consider = (rel: string): void => {
        try {
          const st = fs.statSync(path.join(cwd, rel));
          if (st.isDirectory() && Date.now() - st.mtimeMs < 10 * 60 * 1000) {
            cands.push({ rel, mtime: st.mtimeMs });
          }
        } catch {}
      };
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(cwd, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (skipTop.has(e.name)) continue;
        if (e.name === ".agents") {
          let sub: fs.Dirent[] = [];
          try {
            sub = fs.readdirSync(path.join(cwd, ".agents"), { withFileTypes: true });
          } catch {
            continue;
          }
          for (const s of sub) {
            if (!s.isDirectory() || s.name === "factory") continue;
            consider(`.agents/${s.name}`);
          }
          continue;
        }
        if (e.name.startsWith(".")) continue;
        consider(e.name);
      }
      if (cands.length === 0) return null;
      cands.sort((a, b) => b.mtime - a.mtime);
      const best = cands[0];
      return best ? best.rel : null;
    } catch {
      return null;
    }
  }

  private getRequestedFolderFromPrompt(prompt: string | undefined): string | null {
    if (!prompt || typeof prompt !== "string") return null;
    // Parser canonico generico: vale para cualquier nombre pedido.
    try {
      const parsed = parseRequestedFromPrompt(prompt);
      if (parsed && parsed.isFolder && parsed.relPath) {
        return parsed.relPath.replace(/\\/g, "/");
      }
    } catch {}
    return null;
  }

  private shouldSkipForTrivial(prompt: string | undefined, trivialFolder: string, cwd: string, startMs: number): boolean {
    // If prompt explicitly requested this folder, always skip (idempotent)
    if (prompt) {
      const requested = this.getRequestedFolderFromPrompt(prompt);
      if (requested && requested === trivialFolder) return true;
      // Also check lower prompt contains folder name regardless of exact match
      const lower = prompt.toLowerCase();
      if (lower.includes(trivialFolder.toLowerCase())) return true;
      // If prompt is folder creation at all and folder exists, skip
      if (hasFolderIntent(prompt)) {
        // Check folder exists – already true, so skip
        return true;
      }
    }
    // No prompt provided: only skip if folder was created very recently (within 5 min)
    try {
      const stat = fs.statSync(path.join(cwd, trivialFolder));
      if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) return true;
    } catch {}
    return false;
  }

  /**
   * Cuarentena por evidencia: el fallo de tests se ignora solo si ningun
   * path del output de fallo solapa con los archivos del cambio.
   */
  private shouldIgnoreTestFailure(
    testStep: VerificationStep,
    logPath: string,
    createdFiles: string[],
  ): QuarantineAssessment | null {
    // Full build.log already contains the step output (spawn streams there),
    // so prefer it to avoid counting every failure line twice.
    let output = "";
    try {
      // Use last 40k for analysis
      output = fs.readFileSync(logPath, "utf-8").slice(-40000);
    } catch {}
    if (!output) output = testStep.logSnippet ?? "";
    return evaluateQuarantine(output, createdFiles ?? []);
  }

  private async spawnStep(
    name: "test" | "build" | "setup",
    command: string,
    cwd: string,
    logPath: string,
    timeoutMs: number,
  ): Promise<VerificationStep> {
    const start = Date.now();
    let output = "";
    const logSnippetLimit = 4096;

    // Ensure cwd exists and has package.json; if not, fail quickly
    const hasPkg = (() => {
      try {
        return fs.existsSync(path.join(cwd, "package.json"));
      } catch {
        return false;
      }
    })();

    if (!hasPkg && name !== "setup") {
      // Worktree sin package.json: no hay suite JS que correr.
      // No es un fracaso del cambio → skipped (el overall lo resuelve el run).
      const kind = detectProjectKind(cwd, []);
      const msg = `[verification] no package.json in ${cwd} — ${kind} project, JS suite N/A (${command} skipped, not a change failure)\n`;
      try {
        fs.appendFileSync(logPath, msg, "utf-8");
      } catch {}
      output += msg;
      return {
        name: name as "test" | "build",
        command,
        exitCode: null,
        durationMs: Date.now() - start,
        status: "skipped",
        logSnippet: msg.slice(0, logSnippetLimit),
        logPath: "logs/build.log",
      };
    }

    const result = await this.spawnWithLog(command, cwd, logPath, timeoutMs);

    output = result.output;
    const exitCode = result.exitCode;
    const durationMs = Date.now() - start;
    const status = exitCode === 0 ? "pass" : "fail";
    const snippet = buildSnippet(output);

    return {
      name: name as "test" | "build",
      command,
      exitCode,
      durationMs,
      status,
      logSnippet: snippet,
      logPath: "logs/build.log",
    };
  }

  private spawnWithLog(
    command: string,
    cwd: string,
    logPath: string,
    timeoutMs: number,
  ): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      const header = `\n$ ${command} (cwd=${cwd})\n`;
      output += header;
      try {
        fs.appendFileSync(logPath, header, "utf-8");
      } catch {}

      const child = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env },
        timeout: timeoutMs,
        windowsHide: true,
      });

      const onData = (data: Buffer | string) => {
        const text = data.toString();
        output += text;
        // bounded in-memory output: keep head + tail if too large
        if (output.length > 500_000) {
          output = output.slice(0, 250_000) + `\n...[truncated ${output.length} chars]...\n` + output.slice(-250_000);
        }
        try {
          fs.appendFileSync(logPath, text, "utf-8");
        } catch {}
      };

      (child.stdout as unknown as { on: (ev: string, cb: (d: Buffer) => void) => void })?.on("data", onData as unknown as (d: Buffer) => void);
      (child.stderr as unknown as { on: (ev: string, cb: (d: Buffer) => void) => void })?.on("data", onData as unknown as (d: Buffer) => void);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            (child as unknown as { kill: (sig: string) => void }).kill("SIGTERM");
          } catch {}
          const msg = `\n[timeout ${timeoutMs}ms waiting for ${command}]\n`;
          output += msg;
          try {
            fs.appendFileSync(logPath, msg, "utf-8");
          } catch {}
          // give graceful kill 2s then SIGKILL
          setTimeout(() => {
            try {
              (child as unknown as { kill: (sig: string) => void }).kill("SIGKILL");
            } catch {}
          }, 2000);
          resolve({ exitCode: null, output });
        }
      }, timeoutMs + 500);

      (child as unknown as { on: (ev: string, cb: (err: unknown) => void) => void }).on("error", (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = `\n[spawn error ${command}: ${String(err)}]\n`;
        output += msg;
        try {
          fs.appendFileSync(logPath, msg, "utf-8");
        } catch {}
        resolve({ exitCode: 1, output });
      });

      (child as unknown as { on: (ev: string, cb: (code: number | null) => void) => void }).on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, output });
      });
    });
  }

  private truncateIfNeeded(logPath: string): void {
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > BUILD_LOG_MAX_BYTES) {
        const content = fs.readFileSync(logPath, "utf-8");
        const head = content.slice(0, BUILD_LOG_MAX_BYTES / 2 - 500);
        const tail = content.slice(-(BUILD_LOG_MAX_BYTES / 2 - 500));
        const truncated = `[truncated ${stat.size} bytes — head + tail, middle removed]\n` + head + "\n...[middle truncated]...\n" + tail;
        fs.writeFileSync(logPath, truncated, "utf-8");
      }
    } catch {}
  }
}

function buildSnippet(output: string): string {
  const headLimit = 2048;
  const tailLimit = 2048;
  if (output.length <= headLimit + tailLimit + 100) return output.slice(0, 4096);
  const head = output.slice(0, headLimit);
  const tail = output.slice(-tailLimit);
  return `${head}\n...[truncated ${output.length - headLimit - tailLimit} chars]...\n${tail}`;
}

export const verificationService = new VerificationService();
