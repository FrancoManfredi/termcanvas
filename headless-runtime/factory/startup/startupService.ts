/**
 * factory/startup/startupService — TANDA B: arranque + restore + bind puros.
 *
 * Dueño B en TANDA B (1 archivo): este módulo es dueño de la LÓGICA MOVIBLE
 * del arranque (`restoreJobsFromDisk`, port-file, bind con reintento, health-kick
 * `ensureClient` y snapshot mínimo ya en `health/`). El cascarón conserva
 * formas/handlers/respuestas y los efectos vivos (red/puertos); solo lo puro
 * delega, con efectos inyectados donde no se puede purificar.
 *
 * Lo atado a red/puertos vivos queda en el cascarón como carry-over pineado
 * (ver sección carry-overs abajo + suite): `http.createServer/listen`,
 * `probarBind`, `probeExistingFactory` (fetch vivo), `ensureClient` del
 * manager y `writeFactoryPortFile` real. Acá solo viven decisiones puras
 * testeables sin daemon, sin red, sin puertos.
 *
 * Reglas que honra (las 8 + C1–C10):
 * - C1 ESM y cotas: ESM puro, cero `require()`; sin temporizadores, sin
 *   polling, sin recorridos escritos a mano (solo `forEach` estructural
 *   sobre listas finitas inyectadas, como jobs/jobService).
 * - C2 puras fail-safe: cada export con try/catch; nunca lanza.
 * - C3 un escritor: no escribe nada (ni jobs, ni disco, ni puertos); solo
 *   calcula decisiones que el cascarón aplica + persiste por su punto único.
 * - C4 disco best-effort: no aplica (cero disco acá; el `existsSync`/
 *   `readdirSync` los hace el cascarón y los inyecta como datos).
 * - C5 aditivo: formas idénticas (mismos estados `queued/running/done/
 *   error`, mismos status, misma migración de dashboard por `!==`).
 * - C6/C7 vocabulario único: la migración de dashboard REUSA
 *   `jobs/jobService.resolveDashboardMigration` (no se duplica); el resto
 *   cita su espejo del cascarón.
 * - C8 rutas en tabla: no aplica (arranque, no ruta).
 * - C9 testeable sin server vivo: todo fs/red/puertos inyectado como datos
 *   o callbacks; la suite usa tmp + tienda en memoria.
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascarón.
 *
 * Lista blanca de imports (reparto TANDA B): jobs/jobService (decisión
 * única de migración dashboard) + shared/types/workItem (tipos). PROHIBIDO:
 * review, triage, spec, measure, runner-executor y sus stores, notify,
 * definitionValidate, agentLoader, VerificationPanel, package.json, `src/*`,
 * runners yaml, scorers, thresholds, persistencia directa, ping/builders
 * (dominio intake, no se toca).
 */

import path from "node:path";
import { resolveDashboardMigration } from "../jobs/jobService";
import type { WorkItemStatus } from "../../../shared/types/workItem";

/** Infra de dashboard inyectada (misma forma que jobs/, sin ciclos). */
export interface StartupDashboardInfra {
  readonly resolveDirectory: (worktree: string) => string;
  readonly buildDashboardUrl: (sessionId?: string, directory?: string) => string;
}

/** Entrada cruda de job.json para el restore (campos que lee el cascarón). */
export interface RestoreJobJson {
  readonly id?: unknown;
  readonly prompt?: unknown;
  readonly worktree?: unknown;
  readonly phase?: unknown;
  readonly state?: unknown;
  readonly status?: unknown;
  readonly timeline?: unknown;
  readonly cost?: unknown;
  readonly runnerId?: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
  readonly sessionId?: unknown;
  readonly dashboardUrl?: unknown;
  readonly directory?: unknown;
  readonly modelRef?: unknown;
  readonly reviewerRef?: unknown;
}

/** Decisión pura del restore para un jobDir (el cascarón la aplica). */
export interface RestoreJobDecision {
  readonly id: string;
  readonly prompt: string;
  readonly worktree: string;
  readonly phase: string;
  readonly finalState: "queued" | "running" | "done" | "error";
  readonly finalStatus: WorkItemStatus;
  readonly finalTimeline: Array<Record<string, unknown>>;
  readonly finalCost: Record<string, unknown>;
  readonly finalRunnerId: string;
  readonly finalDotDonePath: string;
  readonly sessionId?: string;
  readonly directory?: string;
  readonly finalDashboardUrl: string;
  readonly urlMigrated: boolean;
  readonly modelRef?: { providerID: string; modelID: string; variant?: string };
  readonly reviewerRef?: { providerID: string; modelID: string; variant?: string };
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly logs: string[];
}

function asTrimmedString(v: unknown): string {
  try {
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function parseModelRefDisk(raw: unknown): { providerID: string; modelID: string; variant?: string } | undefined {
  try {
    if (raw !== null && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const p = typeof o.providerID === "string" ? o.providerID.trim() : "";
      const m = typeof o.modelID === "string" ? o.modelID.trim() : "";
      const v = typeof o.variant === "string" ? o.variant.trim() : "";
      if (p.length > 0 && m.length > 0) {
        return { providerID: p, modelID: m, ...(v.length > 0 ? { variant: v } : {}) };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toIsoOrNow(v: unknown, fallback: string): string {
  // Espejo exacto del cascarón: `new Date(x).getTime() ? iso : fallback`
  // (getTime() 0 —época— cae a fallback por falsy, igual que acá).
  try {
    if (typeof v === "string" && v.length > 0) {
      const d = new Date(v);
      if (d.getTime()) return d.toISOString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Decide el restore de un job.json (espejo del cuerpo del loop de
 * `restoreJobsFromDisk` del cascarón: state/status/timeline/cost/runnerId/
 * sessionId/dashboardUrl/directory/modelRef/reviewerRef/logs + migración de
 * dashboard por `!==` vía el dominio jobs). Puro salvo `infa` inyectada;
 * nunca lanza (retorna null ante entrada rota).
 */
export function decideRestoreJob(
  parsed: RestoreJobJson,
  fallbackId: string,
  jobDir: string,
  infra: StartupDashboardInfra & { readonly getBaseUrl: () => string },
): RestoreJobDecision | null {
  try {
    if (!parsed || typeof parsed !== "object") return null;
    // Espejos exactos del cascarón (sin cheques de longitud extra: `""`
    // pasa igual que en el loop original; solo no-objeto es null).
    const id = typeof parsed.id === "string" ? parsed.id : fallbackId;
    if (!id || typeof id !== "string") return null;
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
    const worktree = typeof parsed.worktree === "string" ? parsed.worktree : "";
    const phase = typeof parsed.phase === "string" ? parsed.phase : "diagnosisLlm";
    const stateRaw = typeof parsed.state === "string" ? parsed.state : "queued";
    const statusRaw = typeof parsed.status === "string" ? parsed.status : undefined;
    let finalState: RestoreJobDecision["finalState"] =
      stateRaw === "queued" || stateRaw === "running" || stateRaw === "done" || stateRaw === "error"
        ? stateRaw
        : "queued";
    let finalStatus: WorkItemStatus;
    // Los 7 estados del ciclo de vida (un bug histórico solo reconocía 5:
    // Triage volvía como Intake y Review como Building al reiniciar).
    if (statusRaw === "Intake" || statusRaw === "Foreman" || statusRaw === "Triage" || statusRaw === "Building" || statusRaw === "Review" || statusRaw === "Complete" || statusRaw === "Cancelled") {
      finalStatus = statusRaw;
    } else {
      switch (finalState) {
        case "queued":
          finalStatus = "Intake";
          break;
        case "running":
          finalStatus = "Building";
          break;
        case "done":
          finalStatus = "Complete";
          break;
        case "error":
          finalStatus = "Cancelled";
          break;
        default:
          finalStatus = "Intake";
      }
    }
    if (finalState === "done" || finalStatus === "Complete") {
      // El cascarón además fuerza done ante `.done` en disco; ese chequeo de
      // fs lo hace el caller y lo pasa vía `hasDotDone` (ver overload abajo).
      // Acá se deja el estado del json; el caller lo eleva si corresponde.
      void 0;
    }
    const nowIso = new Date().toISOString();
    const createdAtIso = toIsoOrNow(parsed.createdAt, nowIso);
    const updatedAtIso = toIsoOrNow(parsed.updatedAt, createdAtIso);
    // Espejo exacto: el cascarón NO chequea longitud (`""` pasa y cae a los
    // fallbacks por falsy, igual que acá vía `||`/`?:` del caller).
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : undefined;
    const dashboardUrl = typeof parsed.dashboardUrl === "string" ? parsed.dashboardUrl : undefined;
    let directory: string | undefined;
    try {
      const dirRaw = asTrimmedString(parsed.directory);
      directory = dirRaw.length > 0 ? dirRaw : worktree ? infra.resolveDirectory(worktree) : undefined;
    } catch {
      directory = undefined;
    }
    const modelRef = parseModelRefDisk(parsed.modelRef);
    const reviewerRef = parseModelRefDisk(parsed.reviewerRef);
    // Migración dashboard: REUSA el dominio jobs (misma regla `||` + `!==`;
    // equivale al bloque `finalDashboardUrl` + encode-check del cascarón).
    let finalDashboardUrl: string;
    try {
      const mig = resolveDashboardMigration(
        { sessionId, dashboardUrl, worktree, directory },
        { resolveDirectory: infra.resolveDirectory, buildDashboardUrl: infra.buildDashboardUrl },
      );
      if (mig) {
        finalDashboardUrl = mig.dashboardUrl;
        directory = mig.directory;
      } else if (sessionId) {
        finalDashboardUrl = infra.buildDashboardUrl(sessionId, directory);
      } else {
        finalDashboardUrl = dashboardUrl ?? infra.getBaseUrl();
      }
    } catch {
      try {
        finalDashboardUrl = sessionId ? infra.buildDashboardUrl(sessionId, directory) : (dashboardUrl ?? infra.getBaseUrl());
      } catch {
        finalDashboardUrl = dashboardUrl ?? "";
      }
    }
    let urlMigrated = false;
    try {
      urlMigrated = !!sessionId && finalDashboardUrl !== dashboardUrl;
    } catch {
      urlMigrated = false;
    }
    let finalTimeline: Array<Record<string, unknown>>;
    // Espejo exacto: el timeline usa los strings CRUDOS del json (aunque la
    // fecha sea inválida); solo el store escribe ISO validado.
    const createdAtRawStr = typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso;
    const updatedAtRawStr = typeof parsed.updatedAt === "string" ? parsed.updatedAt : createdAtRawStr;
    try {
      if (Array.isArray(parsed.timeline) && (parsed.timeline as unknown[]).length > 0) {
        finalTimeline = parsed.timeline as Array<Record<string, unknown>>;
      } else if (finalStatus === "Complete") {
        finalTimeline = [
          { id: `${id}-t0`, from: "Intake", to: "Foreman", at: createdAtRawStr, actor: "system", message: "migrated Intake→Foreman" },
          { id: `${id}-t1`, from: "Foreman", to: "Building", at: createdAtRawStr, actor: "foreman", message: "migrated Foreman→Building" },
          { id: `${id}-t2`, from: "Building", to: "Complete", at: updatedAtRawStr, actor: "system", message: "migrated Building→Complete" },
        ];
      } else if (finalStatus === "Intake") {
        finalTimeline = [{ id: `${id}-t0`, from: "Intake", to: "Intake", at: createdAtRawStr, actor: "user", message: "migrated Intake" }];
      } else {
        finalTimeline = [{ id: `${id}-t0`, from: "Intake", to: finalStatus, at: createdAtRawStr, actor: "system", message: `migrated ${finalStatus}` }];
      }
    } catch {
      finalTimeline = [{ id: `${id}-t0`, from: "Intake", to: "Intake", at: nowIso, actor: "user", message: "migrated Intake" }];
    }
    let finalCost: Record<string, unknown>;
    try {
      const c = parsed.cost as Record<string, unknown> | undefined;
      finalCost =
        c && typeof c.estimatedUSD === "number"
          ? (c as Record<string, unknown>)
          : { estimatedUSD: 0, currency: "USD", breakdown: [] };
    } catch {
      finalCost = { estimatedUSD: 0, currency: "USD", breakdown: [] };
    }
    // Espejo exacto: `""` pasa como runnerId (solo `??` cae al default).
    const runnerIdRaw = typeof parsed.runnerId === "string" ? parsed.runnerId : undefined;
    const finalRunnerId = runnerIdRaw ?? "linux-build";
    return {
      id,
      prompt,
      worktree,
      phase,
      finalState,
      finalStatus,
      finalTimeline,
      finalCost,
      finalRunnerId,
      finalDotDonePath: path.join(jobDir, ".done"),
      ...(sessionId ? { sessionId } : {}),
      ...(directory ? { directory } : {}),
      finalDashboardUrl,
      urlMigrated,
      ...(modelRef ? { modelRef } : {}),
      ...(reviewerRef ? { reviewerRef } : {}),
      createdAtIso,
      updatedAtIso,
      logs: [],
    };
  } catch {
    return null;
  }
}

/**
 * Eleva la decisión ante `.done` en disco (espejo del `existsSync(.done)` del
 * cascarón: fuerza `done/Complete`). Puro, nunca lanza.
 */
export function applyDotDone(decision: RestoreJobDecision | null): RestoreJobDecision | null {
  try {
    if (!decision) return null;
    if (decision.finalState === "done" && decision.finalStatus === "Complete") return decision;
    return { ...decision, finalState: "done", finalStatus: "Complete" };
  } catch {
    return decision;
  }
}

/**
 * Bases del restore (espejo de la construcción de `bases` del cascarón:
 * repoRoot + lab externo + tmpdir + `C:\tmp` + `.worktrees`). Recibe listas
 * ya leídas (el `readdirSync/existsSync` los hace el cascarón); solo compone
 * y deduplica. Puro, nunca lanza.
 */
export function collectRestoreBases(input: {
  readonly repoRoot: string;
  readonly tmpdir: string;
  readonly tmpEntries?: readonly string[];
  readonly cTmpEntries?: readonly string[];
  readonly worktreeEntries?: readonly string[];
}): string[] {
  try {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (p: string): void => {
      try {
        if (!p || typeof p !== "string") return;
        if (seen.has(p)) return;
        seen.add(p);
        out.push(p);
      } catch {}
    };
    const repo = input.repoRoot;
    const tmp = input.tmpdir;
    // Espejo del cascarón con `path.join` (mismos separadores por SO).
    push(path.join(repo, ".agents", "factory"));
    push(path.resolve("C:\\tmp\\factory-lab-test\\.agents\\factory"));
    push(path.join(tmp, "factory-lab-test", ".agents", "factory"));
    (input.tmpEntries ?? []).forEach((name) => {
      try {
        if (
          typeof name === "string" &&
          (name.startsWith("playground-") || name.startsWith("factory-lab") || name.startsWith("tmp-") || name.startsWith("factory-"))
        ) {
          push(path.join(tmp, name, ".agents", "factory"));
          push(path.join("C:\\tmp", name, ".agents", "factory"));
        }
      } catch {}
    });
    (input.cTmpEntries ?? []).forEach((name) => {
      try {
        // Espejo: el cascarón solo agrega las que existen (`existsSync` por
        // entrada); el `continue` del loop ante base ausente lo hace el
        // caller, así que acá se componen todas y el caller filtra.
        if (typeof name === "string" && name.length > 0) push(path.resolve(path.join("C:\\tmp", name, ".agents", "factory")));
      } catch {}
    });
    (input.worktreeEntries ?? []).forEach((name) => {
      try {
        if (typeof name === "string" && name.length > 0) push(path.join(repo, ".worktrees", name, ".agents", "factory"));
      } catch {}
    });
    return out;
  } catch {
    return [];
  }
}

/**
 * Ruta del port-file (espejo `getFactoryPortFile` del cascarón:
 * `<dataDir>/factory-port`). Pura, nunca lanza.
 */
export function buildPortFilePath(dataDir: string): string {
  try {
    return path.join(dataDir, "factory-port");
  } catch {
    return "factory-port";
  }
}

/** Contenido del port-file (espejo `writeFactoryPortFile`: `puerto\npid`). */
export function formatPortFile(port: number, pid: number): string {
  try {
    return `${Math.floor(port)}\n${Math.floor(pid)}`;
  } catch {
    return `${String(port)}\n${String(pid)}`;
  }
}

/**
 * Decide si el error de `listen` amerita reintento en otro puerto (espejo del
 * `isAddrInUse` del cascarón: `EADDRINUSE` por código o mensaje). Puro.
 */
export function shouldRetryBind(code: unknown, message: unknown): boolean {
  try {
    if (typeof code === "string" && code === "EADDRINUSE") return true;
    const msg = typeof message === "string" ? message : String(message ?? "");
    return msg.includes("EADDRINUSE") || msg.includes("already in use");
  } catch {
    return false;
  }
}

/**
 * Debounce del self-heal del manager desde GET /factory/health (espejo
 * `lastManagerKickMs` 15s del cascarón). Puro, nunca lanza.
 */
export function shouldKickManager(lastKickMs: unknown, nowMs: unknown): boolean {
  try {
    const last = typeof lastKickMs === "number" && Number.isFinite(lastKickMs) ? lastKickMs : 0;
    const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
    return now - last > 15_000;
  } catch {
    return false;
  }
}

/**
 * Backoff exponencial del self-heal: base 15s y luego 15s·2^streak con techo
 * de 5min. Evita que un binario de opencode faltante/roto convierta cada
 * poll de /factory/health en un burst de spawns (3 retries por intento).
 * `streak` = kicks consecutivos sin URL (se resetea al volver healthy).
 * Puro, nunca lanza.
 */
export function shouldKickManagerWithBackoff(
  lastKickMs: unknown,
  nowMs: unknown,
  streak: unknown,
): boolean {
  try {
    if (!shouldKickManager(lastKickMs, nowMs)) return false;
    const s =
      typeof streak === "number" && Number.isFinite(streak) && streak > 0
        ? Math.floor(streak)
        : 0;
    if (s === 0) return true;
    const last = typeof lastKickMs === "number" && Number.isFinite(lastKickMs) ? lastKickMs : 0;
    const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
    const interval = Math.min(15_000 * Math.pow(2, s), 300_000);
    return now - last >= interval;
  } catch {
    return false;
  }
}
