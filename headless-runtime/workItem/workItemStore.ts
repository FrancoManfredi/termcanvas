/**
 * WorkItemStore — Map<string, WorkItem> + CRUD + transitions + persist hooks.
 * Single source of truth en memoria + disco ({worktree}/.agents/factory/{id}/).
 * Reutiliza lógica de restoreJobsFromDisk pero migrada a WorkItem.
 */

import path from "node:path";
import type {
  WorkItem,
  WorkItemStatus,
  WorkItemTimelineEntry,
  ModelRef,
  CostSummary,
} from "../../shared/types/workItem";
import {
  canTransition,
  assertTransition,
  mapStatusToLegacyState,
} from "../../shared/types/workItem";
import {
  ensureWorkItemDir,
  writeWorkItemJsonAtomic,
  appendWorkItemLog,
  recordJobDirInIndex,
  resolveJobDir,
  readWorkItemFromDir,
  scanAndRestoreBases,
} from "./workItemDisk";
import {
  reconcileCreatedFiles,
  writeResult,
  buildResultPayload,
} from "./resultStore";
import { toStoreJson } from "./jobView";
import { createWorkItem } from "./workItem";
import {
  recordLlmCall,
  getCostSummary,
  getActualSummaryForJob,
  asValidActual,
  resolveCostRateForModelRef,
  isCostTrackingEnabled,
  calcUSD,
} from "../cost/costTracker";
import type { CostRate } from "../cost/costTracker";

import { isSessionAgentRole } from "../../shared/roles";

/**
 * Predicado de rol con sesión propia por job (Ola 16 E1).
 * FASE 1 E2 (C6/C7): delega en `isSessionAgentRole` de `shared/roles`
 * (fuente única, semántica intacta: case-sensitive, fail-closed). El store
 * SIGUE sin importar `headless-runtime/sessions/*` (ese módulo importa al
 * store; importarlo acá crearía un ciclo): la fuente vive en `shared/`.
 */
function isKnownAgentRole(role: unknown): boolean {
  try {
    return isSessionAgentRole(role);
  } catch {
    return false;
  }
}

/**
 * FU-4d: fusiona un resumen recién calculado (`fresh`, totales del contador
 * a la tarifa de ESTA llamada) con el resumen ya persistido (`prev`).
 *
 * El contador es agregado (calls + chars totales, sin split por modelo), así
 * que re-tasar el total a la tarifa del último caller destruye el USD cuando
 * los modelos se mezclan (bug FU-4c: 3 calls spark rateadas → 4ª call del
 * reviewer `opencode/big-pickle` sin tarifa pisaba USD a null/null).
 * En vez de reemplazar, se ACUMULA por llamada:
 * - delta = tokens(fresh) − tokens(prev) tasado a la tarifa de ESTA llamada.
 * - historial rated + delta rated (mismo u otro modelo) → suma. La ref
 *   conserva la primera tarifa rateada; el detalle por llamada queda en los
 *   eventos `cost:` del timeline.
 * - historial rated + llamada sin tarifa → la llamada suma 0 y preserva lo
 *   acumulado (NUNCA null sobre número, NUNCA 0.00 como dato).
 * - sin historial rated + delta rated → solo el delta (no se re-tarifa
 *   retroactivamente lo ya contado sin tarifa).
 * - sin tarifa en ningún lado → `fresh` tal cual (sin tarifa honesto).
 * Pura, nunca lanza (ante anomalía devuelve `fresh`: comportamiento previo).
 */
function mergeCostWithPrevious(
  prev: CostSummary | null | undefined,
  fresh: CostSummary | null,
  rate: CostRate | null,
  ref: string | null,
): CostSummary | null {
  try {
    if (fresh === null) return null;
    const prevUSD =
      prev &&
      typeof prev.estimatedUSD === "number" &&
      Number.isFinite(prev.estimatedUSD)
        ? prev.estimatedUSD
        : null;
    const prevRef =
      prev &&
      typeof prev.ratesRef === "string" &&
      prev.ratesRef.trim().length > 0
        ? prev.ratesRef
        : null;
    const prevIn =
      prev &&
      typeof prev.estimatedInputTokens === "number" &&
      Number.isFinite(prev.estimatedInputTokens) &&
      prev.estimatedInputTokens >= 0
        ? Math.floor(prev.estimatedInputTokens)
        : 0;
    const prevOut =
      prev &&
      typeof prev.estimatedOutputTokens === "number" &&
      Number.isFinite(prev.estimatedOutputTokens) &&
      prev.estimatedOutputTokens >= 0
        ? Math.floor(prev.estimatedOutputTokens)
        : 0;
    const deltaIn = Math.max(0, fresh.estimatedInputTokens - prevIn);
    const deltaOut = Math.max(0, fresh.estimatedOutputTokens - prevOut);
    let deltaUSD: number | null = null;
    try {
      deltaUSD = calcUSD(deltaIn, deltaOut, rate);
    } catch {
      deltaUSD = null;
    }
    if (prevUSD !== null) {
      if (deltaUSD !== null) {
        return {
          llmCalls: fresh.llmCalls,
          estimatedInputTokens: fresh.estimatedInputTokens,
          estimatedOutputTokens: fresh.estimatedOutputTokens,
          estimatedUSD: prevUSD + deltaUSD,
          basis: fresh.basis,
          ratesRef: prevRef ?? fresh.ratesRef ?? ref ?? "custom",
        };
      }
      return {
        llmCalls: fresh.llmCalls,
        estimatedInputTokens: fresh.estimatedInputTokens,
        estimatedOutputTokens: fresh.estimatedOutputTokens,
        estimatedUSD: prevUSD,
        basis: fresh.basis,
        ratesRef: prevRef ?? fresh.ratesRef ?? ref ?? "custom",
      };
    }
    if (deltaUSD !== null) {
      return {
        llmCalls: fresh.llmCalls,
        estimatedInputTokens: fresh.estimatedInputTokens,
        estimatedOutputTokens: fresh.estimatedOutputTokens,
        estimatedUSD: deltaUSD,
        basis: fresh.basis,
        ratesRef: ref ?? fresh.ratesRef ?? "custom",
      };
    }
    return fresh;
  } catch {
    return fresh;
  }
}

/**
 * Tope de terminales (Complete/Cancelled) en memoria (retención C1).
 * Sin este tope el daemon acumula todos los jobs desde el primer arranque
 * (446 medidos 2026-09-09) y cada lista los recorre/serializa. Evictar es
 * solo-memoria: el job.json queda en disco y `get()` rehidrata bajo
 * demanda, así que ningún detalle/lock/guard cambia de semántica.
 */
export const WORK_ITEM_MEMORY_TERMINAL_CAP = 200;

export class WorkItemStore {
  private items = new Map<string, WorkItem>();
  private buildingLocks = new Set<string>();
  private reviewLocks = new Set<string>();

  /**
   * Creates a new WorkItem in Intake status and persists to disk.
   * Does NOT auto-transition; caller decides Foreman/Building flow.
   */
  create(input: {
    id: string;
    prompt: string;
    worktree: string;
    modelRef?: ModelRef;
    reviewerRef?: ModelRef;
    phase?: string;
    runnerId?: string;
    sessionId?: string;
    dashboardUrl?: string;
    directory?: string;
  }): WorkItem {
    const worktreeResolved = path.resolve(input.worktree);
    const dir = path.join(worktreeResolved, ".agents", "factory", input.id);
    const dotDonePath = path.join(dir, ".done");
    const base = createWorkItem({
      id: input.id,
      prompt: input.prompt,
      worktree: worktreeResolved,
      modelRef: input.modelRef,
      reviewerRef: input.reviewerRef,
      phase: input.phase,
      runnerId: input.runnerId,
    });
    const item: WorkItem = {
      ...base,
      dir,
      dotDonePath,
      logsNdjsonPath: path.join(dir, "logs.ndjson"),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.dashboardUrl ? { dashboardUrl: input.dashboardUrl } : {}),
      ...(input.directory ? { directory: input.directory } : {}),
      logs: [`[${new Date().toISOString()}] workItem ${input.id} created Intake worktree=${worktreeResolved} phase=${input.phase ?? "diagnosisLlm"}`],
    };
    this.items.set(item.id, item);
    ensureWorkItemDir(item);
    // P3b: el job nace durable (job.json ya escrito por ensureWorkItemDir) y
    // registrado en el índice para que el restore lo encuentre aunque el
    // worktree esté fuera de las bases fijas. Best-effort, nunca lanza.
    try {
      recordJobDirInIndex(item.id, dir);
    } catch {}
    // Also persist logs initial via append
    if (item.logs && item.logs.length > 0) {
      for (const line of item.logs) {
        appendWorkItemLog(item, line);
      }
    }
    return item;
  }

  get(id: string): WorkItem | undefined {
    try {
      const hit = this.items.get(id);
      if (hit) return hit;
      // Retención C1: el item salió de memoria pero sigue en disco —
      // se rehidrata transparente para que el detalle de jobs viejos
      // siga 200 honesto (locks/guards ven el item igual que antes).
      if (typeof id !== "string" || id.length === 0) return undefined;
      const dir = resolveJobDir(id);
      if (!dir) return undefined;
      const restored = readWorkItemFromDir(dir);
      if (!restored || restored.id !== id) return undefined;
      this.items.set(id, restored);
      return restored;
    } catch {
      return undefined;
    }
  }

  list(): WorkItem[] {
    return [...this.items.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /**
   * Retención C1: evicta de MEMORIA los terminales más viejos por encima
   * del tope (orden por updatedAt asc). Nunca toca no-terminales ni el
   * disco; `get()` rehidrata bajo demanda. Se corre al aterrizar en
   * terminal y tras el restore. Retorna evictados. Nunca lanza.
   */
  pruneTerminalFromMemory(
    maxKeep: number = WORK_ITEM_MEMORY_TERMINAL_CAP,
  ): number {
    try {
      const cap =
        typeof maxKeep === "number" &&
        Number.isInteger(maxKeep) &&
        maxKeep >= 0
          ? maxKeep
          : WORK_ITEM_MEMORY_TERMINAL_CAP;
      const terminal: Array<{ id: string; at: number }> = [];
      this.items.forEach((item, id) => {
        try {
          if (item.status === "Complete" || item.status === "Cancelled") {
            const at = new Date(item.updatedAt).getTime();
            terminal.push({ id, at: Number.isFinite(at) ? at : 0 });
          }
        } catch {
          // item roto: no se evicta a ciegas
        }
      });
      if (terminal.length <= cap) return 0;
      terminal.sort((a, b) => a.at - b.at);
      let evicted = 0;
      for (let i = 0; i < terminal.length - cap; i += 1) {
        try {
          if (this.items.delete(terminal[i].id)) evicted += 1;
        } catch {
          // best-effort
        }
      }
      return evicted;
    } catch {
      return 0;
    }
  }

  /**
   * Saca el item de MEMORIA (el job.json y el índice quedan: `get()`
   * rehidrata bajo demanda y el restore lo trae de vuelta — ver C1).
   * Para la vista solo-memoria, `has()`/`list()`.
   */
  delete(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
    this.buildingLocks.clear();
    this.reviewLocks.clear();
  }

  // ── Building locks (Ola 3) ──
  acquireBuildingLock(id: string): boolean {
    if (this.buildingLocks.has(id)) return false;
    this.buildingLocks.add(id);
    return true;
  }

  releaseBuildingLock(id: string): void {
    this.buildingLocks.delete(id);
  }

  isBuildingLocked(id: string): boolean {
    return this.buildingLocks.has(id);
  }

  // ── Review locks (Ola 4) — evita doble trigger Building→Review ──
  acquireReviewLock(id: string): boolean {
    if (this.reviewLocks.has(id)) return false;
    this.reviewLocks.add(id);
    return true;
  }

  releaseReviewLock(id: string): void {
    this.reviewLocks.delete(id);
  }

  isReviewLocked(id: string): boolean {
    return this.reviewLocks.has(id);
  }

  /**
   * Persiste reviewCount + lastReview sin cambiar status.
   * Añade evento timeline (from=to=current) y log, escribe job.json.
   */
  setReview(
    id: string,
    result: import("../../shared/types/review").ReviewResult,
    reviewCount: number,
  ): WorkItem {
    const current = this.items.get(id);
    if (!current) {
      throw Object.assign(new Error(`workItem not found: ${id}`), { status: 404 });
    }
    const clamped = Math.max(0, reviewCount);
    const nowIso = new Date().toISOString();
    const entry: WorkItemTimelineEntry = {
      id: `${id}-t${current.timeline.length}`,
      from: current.status,
      to: current.status,
      at: nowIso,
      actor: "system",
      message: `review ${result.verdict} intento ${result.reviewAttempt} (${result.findings.length} findings)`,
      meta: { review: result, reviewCount: clamped } as unknown as Record<string, unknown>,
    };
    const next: WorkItem = {
      ...current,
      reviewCount: clamped,
      lastReview: result,
      updatedAt: nowIso,
      timeline: [...current.timeline, entry],
      logs: [...(current.logs ?? []), `[${nowIso}] system: review ${result.verdict} intento ${result.reviewAttempt} — ${result.summary.slice(0, 80)}`],
    };
    this.items.set(id, next);
    writeWorkItemJsonAtomic(next);
    appendWorkItemLog(next, `[${nowIso}] system: review ${result.verdict} intento ${result.reviewAttempt}`);
    return next;
  }

  /**
   * Transition with verification meta convenience (Ola 3).
   * Persists verification report in timeline meta.
   * H-001 (aditivo): además espeja `createdFiles` como clave top-level del
   * WorkItem (vive en job.json, no solo en la meta) para igualdad exacta
   * contra disco. Solo cuando el array trae ≥1 ruta: un [] nunca borra la
   * evidencia previa (ej. rutas de error que pasan [] intactas) — salvo
   * H-012: declarado no-vacío con cero kept → `[]` honesto (no éxito).
   * Refactor ① E1 (A3): concilia `createdFiles` contra disco en el punto
   * `reconcileCreatedFiles` (filtra inexistentes "como hoy" + H-012 quita la
   * carpeta vacía sin archivo pedido, con el prompt del job) con nota en
   * timeline si hubo descartes, y persiste `result.json` rico vía la tienda
   * única (best-effort: disco nunca rompe la transición). Cero kept no
   * inventa transición: el caller lleva a Triage con la verificación en
   * fail (humano decide).
   */
  transitionWithVerification(
    id: string,
    to: WorkItemStatus,
    verification: import("../../shared/types/implement").VerificationReport,
    createdFiles: string[],
    message?: string,
  ): WorkItem {
    const declared = Array.isArray(createdFiles)
      ? createdFiles.map(String).slice(0, 50)
      : [];
    const current = this.items.get(id);
    const reconciled = reconcileCreatedFiles(
      declared,
      current?.worktree ?? "",
      current?.prompt ?? "",
    );
    const kept = reconciled.kept;
    const msg =
      message ??
      (verification.overall === "pass"
        ? "verification passed"
        : `verification failed: ${verification.steps.find((s) => s.status === "fail")?.command ?? "unknown"} exit ${verification.steps.find((s) => s.status === "fail")?.exitCode ?? "?"}`);
    const moved = this.transition(id, to, "runner", msg, {
      verification,
      createdFiles: kept,
      runnerId: "linux-build",
    } as unknown as Record<string, unknown>);
    // Refactor ① E1: la tienda única persiste el `result.json` rico de esta
    // verificación (best-effort: disco nunca rompe la transición; ids o
    // reportes no-válidos para el schema se omiten en silencio).
    try {
      const stored = this.items.get(id) ?? moved;
      if (stored.dir) {
        const payload = buildResultPayload({
          workItemId: stored.id,
          ...(stored.modelRef ? { modelRef: stored.modelRef } : {}),
          worktreePath: stored.worktree,
          verification,
          createdFiles: kept.slice(0, 50),
        });
        writeResult(stored.dir, payload);
      }
    } catch {
      // best-effort: result.json nunca rompe la transición
    }
    try {
      if (kept.length > 0) {
        const next: WorkItem = {
          ...(this.items.get(id) ?? moved),
          createdFiles: kept.slice(0, 50),
          updatedAt: moved.updatedAt,
        };
        this.items.set(id, next);
        writeWorkItemJsonAtomic(next);
      } else if (declared.length > 0) {
        // H-012: se declaró algo pero nada quedó en disco (cero kept) → `[]`
        // honesto (no éxito, no fantasma). No borra cuando nada se declaró.
        try {
          const next: WorkItem = {
            ...(this.items.get(id) ?? moved),
            createdFiles: [],
            updatedAt: moved.updatedAt,
          };
          this.items.set(id, next);
          writeWorkItemJsonAtomic(next);
        } catch {}
      } else {
        // H-012: entrega vacía honesta sin evidencia previa → `[]` (no éxito
        // silencioso con clave ausente). Con evidencia previa se preserva
        // (no se borra lo ya conciliado).
        try {
          const prev = (this.items.get(id) ?? moved).createdFiles;
          if (!prev || prev.length === 0) {
            const next: WorkItem = {
              ...(this.items.get(id) ?? moved),
              createdFiles: [],
              updatedAt: moved.updatedAt,
            };
            this.items.set(id, next);
            writeWorkItemJsonAtomic(next);
          }
        } catch {}
      }
      if (reconciled.dropped.length > 0) {
        try {
          this.appendEvent(
            id,
            "runner",
            `createdFiles: descartadas ${reconciled.dropped.length} ruta(s) inexistente(s) o vacía(s) sin archivo pedido (H-001/H-012): ${reconciled.dropped.slice(0, 5).join(", ").slice(0, 200)}`,
            {
              droppedCreatedFiles: reconciled.dropped.slice(0, 10),
            } as unknown as Record<string, unknown>,
          );
        } catch {
          // best-effort: la nota nunca rompe la transición
        }
      }
    } catch {}
    return this.items.get(id) ?? moved;
  }

  /**
   * Transitions a WorkItem to a new status, appending timeline and persisting atomically.
   * Throws 409 if invalid transition.
   */
  transition(
    id: string,
    to: WorkItemStatus,
    actor: WorkItemTimelineEntry["actor"],
    message: string,
    meta?: Record<string, unknown>,
  ): WorkItem {
    const current = this.items.get(id);
    if (!current) {
      throw Object.assign(new Error(`workItem not found: ${id}`), { status: 404 });
    }
    assertTransition(current.status, to);
    const nowIso = new Date().toISOString();
    const entry: WorkItemTimelineEntry = {
      id: `${id}-t${current.timeline.length}`,
      from: current.status,
      to,
      at: nowIso,
      actor,
      message,
      ...(meta ? { meta } : {}),
    };
    const next: WorkItem = {
      ...current,
      status: to,
      state: mapStatusToLegacyState(to),
      updatedAt: nowIso,
      timeline: [...current.timeline, entry],
    };
    // Append log line for this transition
    const logLine = `[${nowIso}] ${actor}: ${current.status} → ${to} — ${message}`;
    next.logs = [...(next.logs ?? []), logLine];
    this.items.set(id, next);
    writeWorkItemJsonAtomic(next);
    appendWorkItemLog(next, logLine);
    // Retención C1: al aterrizar en terminal se poda el excedente.
    // Best-effort y fuera del camino feliz (nunca rompe la transición).
    if (to === "Complete" || to === "Cancelled") {
      try {
        this.pruneTerminalFromMemory();
      } catch {
        // noop
      }
    }
    return next;
  }

  /**
   * Appends a non-transition event (e.g., runner:prepared) without changing status.
   */
  appendEvent(
    id: string,
    actor: WorkItemTimelineEntry["actor"],
    message: string,
    meta?: Record<string, unknown>,
  ): WorkItem {
    const current = this.items.get(id);
    if (!current) {
      throw Object.assign(new Error(`workItem not found: ${id}`), { status: 404 });
    }
    const nowIso = new Date().toISOString();
    const entry: WorkItemTimelineEntry = {
      id: `${id}-t${current.timeline.length}`,
      from: current.status,
      to: current.status,
      at: nowIso,
      actor,
      message,
      ...(meta ? { meta } : {}),
    };
    const next: WorkItem = {
      ...current,
      updatedAt: nowIso,
      timeline: [...current.timeline, entry],
      logs: [...(current.logs ?? []), `[${nowIso}] ${actor}: ${message}`],
    };
    this.items.set(id, next);
    writeWorkItemJsonAtomic(next);
    appendWorkItemLog(next, `[${nowIso}] ${actor}: ${message}`);
    return next;
  }

  /**
   * Directly sets an item (for migration or external restore). Persists.
   */
  set(item: WorkItem): void {
    this.items.set(item.id, item);
    writeWorkItemJsonAtomic(item);
  }

  /**
   * Restores from disk scanning known bases. Returns count restored.
   */
  restoreFromDisk(): number {
    const count = scanAndRestoreBases(this.items);
    if (count > 0) console.log(`[WorkItemStore] restaurados ${count} workItems desde disco`);
    else console.log(`[WorkItemStore] no hay workItems previos en disco para restaurar`);
    // Retención C1: el restore puede traer cientos de terminales viejos —
    // se poda el excedente en el acto (disco intacto, `get()` rehidrata).
    try {
      const evicted = this.pruneTerminalFromMemory();
      if (evicted > 0) console.log(`[WorkItemStore] retención: ${evicted} terminales fuera de memoria`);
    } catch {
      // noop
    }
    return count;
  }

  /**
   * Returns serializable JSON for API responses.
   * Refactor ① E1 (A3): delega en la proyección única `jobView.toStoreJson`
   * (forma idéntica, implementación única).
   */
  toListJSON(): unknown[] {
    return this.list().map((w) => this.toJSON(w));
  }

  toJSON(item: WorkItem): Record<string, unknown> {
    return toStoreJson(item);
  }

  /**
   * Ola 15 E2: registra costo LLM para un job (best-effort, nunca lanza).
   * Llama a `recordLlmCall` (contador por jobId con cap FIFO), resuelve la
   * tarifa por el modelo REAL del job (FU-4b: `modelRefOrKey` explícito si
   * el caller lo trae a mano, si no el `modelRef` guardado en el job;
   * exact-key trimmed vía `resolveCostRateForModelRef`) y persiste el
   * resumen en `costSummary` + job.json + evento de timeline (evidencia en
   * disco, Regla 5). Sin modelo o sin tarifa → USD null honesto (NUNCA
   * 0.00). Si tracking apagado, persiste `costSummary: null` ("—").
   * FU-4d: el USD se ACUMULA por llamada (`mergeCostWithPrevious`): una
   * llamada sin tarifa suma 0 y preserva el USD ya acumulado, nunca lo
   * pisa a null.
   * Retorna el WorkItem actualizado o null si no existe / fallo interno.
   */
  incrementCost(
    jobId: string,
    inputChars: number,
    outputChars: number,
    modelRefOrKey?: unknown,
  ): WorkItem | null {
    try {
      const current = this.items.get(jobId);
      if (!current) return null;
      const prev: CostSummary | null = current.costSummary ?? null;
      let summary: CostSummary | null = null;
      try {
        recordLlmCall(jobId, inputChars, outputChars);
        const { rate, ref } = resolveCostRateForModelRef(
          modelRefOrKey ?? current.modelRef ?? null,
        );
        summary = mergeCostWithPrevious(
          prev,
          getCostSummary(jobId, rate, ref),
          rate,
          ref,
        );
      } catch {
        return current;
      }
      return this.persistCostSummary(jobId, summary);
    } catch {
      return null;
    }
  }

  /**
   * Ola 15 cierre: re-persiste el resumen de costo YA contado en memoria, SIN
   * re-grabar (`recordLlmCall`). Lo llama el wrapper único
   * `promptInSessionWithCost` DESPUÉS de contar, para llevar el contador a
   * `costSummary` + `job.json` + evento timeline sin doble conteo (ver
   * `incrementCost`: ese método SÍ cuenta, por eso el wrapper NO lo usa —
   * llamarlo desde el wrapper grabaría 2 veces y rompería los tests del
   * wrapper que no usan store).
   *
   * Historia null definida: job con 0 llamadas registradas + tracking
   * encendido → se deja como está (retorna el item sin tocar timeline ni
   * disco: no hay nada que persistir y un evento "seguimiento apagado"
   * sería falso). Con tracking apagado → persiste `null` honesto ("—"),
   * igual que `incrementCost`. Job inexistente → null.
   * FU-4b: la tarifa se resuelve por el modelo real igual que
   * `incrementCost` (`modelRefOrKey` explícito o `modelRef` del job).
   * FU-4d: el USD se ACUMULA por llamada (`mergeCostWithPrevious`): el
   * reviewer hila SU modelo (`reviewAgent.ts:627`, p. ej.
   * `opencode/big-pickle` sin tarifa) y esa llamada suma 0 preservando el
   * USD rateado del implement, en vez de pisarlo a null (bug FU-4c).
   * Best-effort, nunca lanza.
   */
  refreshCostSummary(jobId: string, modelRefOrKey?: unknown): WorkItem | null {
    try {
      const current = this.items.get(jobId);
      if (!current) return null;
      const prev: CostSummary | null = current.costSummary ?? null;
      let summary: CostSummary | null = null;
      try {
        const { rate, ref } = resolveCostRateForModelRef(
          modelRefOrKey ?? current.modelRef ?? null,
        );
        summary = mergeCostWithPrevious(
          prev,
          getCostSummary(jobId, rate, ref),
          rate,
          ref,
        );
      } catch {
        return current;
      }
      if (summary === null) {
        if (!isCostTrackingEnabled()) return this.persistCostSummary(jobId, null);
        return current;
      }
      return this.persistCostSummary(jobId, summary);
    } catch {
      return null;
    }
  }

  /**
   * Bloque de persistencia compartido por `incrementCost` y
   * `refreshCostSummary`: escribe `costSummary` + evento timeline `cost: …` +
   * `job.json` atómico + log (todo best-effort, evidencia en disco Regla 5).
   * FU-4d (última defensa): un resumen entrante sin tarifa NUNCA pisa un USD
   * ya acumulado — preserva USD/ratesRef con los conteos nuevos (los callers
   * ya fusionan vía `mergeCostWithPrevious`; esto cubre futuros callers).
   * `null` explícito (tracking apagado) sí persiste: es "—", no "sin tarifa".
   * Nunca lanza (null ante job inexistente o fallo interno).
   */  /**
   * Fase 9: persiste un resumen de costo calculado FUERA del contador legacy
   * (p. ej. los totals de un run del engine). Delega en persistCostSummary con
   * la misma defensa FU-4d. Best-effort, nunca lanza.
   */
  applyExternalCost(jobId: string, summary: CostSummary | null): WorkItem | null {
    return this.persistCostSummary(jobId, summary);
  }

  private persistCostSummary(jobId: string, summary: CostSummary | null): WorkItem | null {
    try {
      const current = this.items.get(jobId);
      if (!current) return null;
      let effective: CostSummary | null = summary;
      try {
        const prev = current.costSummary;
        if (
          effective !== null &&
          (effective.estimatedUSD === null ||
            effective.estimatedUSD === undefined) &&
          prev &&
          typeof prev.estimatedUSD === "number" &&
          Number.isFinite(prev.estimatedUSD) &&
          typeof prev.ratesRef === "string" &&
          prev.ratesRef.trim().length > 0
        ) {
          effective = {
            ...effective,
            estimatedUSD: prev.estimatedUSD,
            ratesRef: prev.ratesRef,
          };
        }
      } catch {
        // best-effort: la guarda nunca rompe la persistencia
      }
      // T4: el `actual` medido viaja con el resumen (contadores primero,
      // restaurado previo como respaldo tras un restart con contadores
      // vacíos). `mergeCostWithPrevious` no lo acarrea: se re-adjunta acá,
      // único punto de persistencia.
      try {
        if (effective !== null) {
          const prevActual = asValidActual(
            (current.costSummary as unknown as { actual?: unknown } | null | undefined)?.actual,
          );
          let actual = prevActual;
          try {
            const { rate: actualRate } = resolveCostRateForModelRef(
              current.modelRef ?? null,
            );
            actual = getActualSummaryForJob(jobId, actualRate) ?? prevActual;
          } catch {
            // sin contadores: vale el previo
          }
          if (actual !== undefined) {
            effective = { ...effective, actual };
          }
        }
      } catch {
        // best-effort: el actual nunca rompe la persistencia
      }
      const nowIso = new Date().toISOString();
      const totalTokens =
        (effective?.estimatedInputTokens ?? 0) + (effective?.estimatedOutputTokens ?? 0);
      // Sufijo medido (exactitud dashboard opencode): cuando hay `actual`
      // válido se cita junto al estimado para que el timeline no contradiga
      // a los badges (que prefieren lo medido). Mismo vocabulario que el
      // display: total sin caché + caché aparte.
      let measuredSuffix = "";
      try {
        const a = (effective as unknown as { actual?: unknown } | null | undefined)?.actual as
          | {
              inputTokens?: unknown;
              outputTokens?: unknown;
              reasoningTokens?: unknown;
              cacheReadTokens?: unknown;
              cacheWriteTokens?: unknown;
              calls?: unknown;
              usd?: unknown;
              usdSource?: unknown;
            }
          | null
          | undefined;
        const num = (v: unknown): number | null =>
          typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
        const mIn = num(a?.inputTokens);
        const mOut = num(a?.outputTokens);
        const mRea = num(a?.reasoningTokens);
        const mCr = num(a?.cacheReadTokens);
        const mCw = num(a?.cacheWriteTokens);
        const mCalls = num(a?.calls);
        if (
          mIn !== null && mOut !== null && mRea !== null &&
          mCr !== null && mCw !== null && mCalls !== null && mCalls > 0
        ) {
          const mTotal = mIn + mOut + mRea;
          const mCache = mCr + mCw;
          const mTokens =
            mCache > 0 ? `~${mTotal} tokens (+${mCache} caché)` : `~${mTotal} tokens`;
          const mUsd =
            typeof a?.usd === "number" && Number.isFinite(a.usd) && (a.usd as number) >= 0
              ? ` · ~USD ${(a.usd as number).toFixed(4)} (${a?.usdSource === "server" ? "server" : "rates"})`
              : "";
          measuredSuffix = ` · medido: ${mCalls} llamadas · ${mTokens}${mUsd}`;
        }
      } catch {
        measuredSuffix = "";
      }
      const costMsg =
        effective === null
          ? "cost: seguimiento apagado (costTracking: false)"
          : effective.estimatedUSD !== null && effective.estimatedUSD !== undefined
            ? `cost: ${effective.llmCalls} llamadas · ~${totalTokens} tokens · ~USD ${effective.estimatedUSD.toFixed(4)} (est., ${effective.basis}${effective.ratesRef ? `, ${effective.ratesRef}` : ""})${measuredSuffix}`
            : `cost: ${effective.llmCalls} llamadas · ~${totalTokens} tokens · sin tarifa (${effective.basis})${measuredSuffix}`;
      const entry: WorkItemTimelineEntry = {
        id: `${jobId}-t${current.timeline.length}`,
        from: current.status,
        to: current.status,
        at: nowIso,
        actor: "system",
        message: costMsg,
        meta: { cost: effective } as unknown as Record<string, unknown>,
      };
      const next: WorkItem = {
        ...current,
        costSummary: effective,
        updatedAt: nowIso,
        timeline: [...current.timeline, entry],
        logs: [...(current.logs ?? []), `[${nowIso}] system: ${costMsg}`],
      };
      this.items.set(jobId, next);
      try {
        writeWorkItemJsonAtomic(next);
      } catch {
        // best-effort: disco nunca rompe el flujo
      }
      try {
        appendWorkItemLog(next, `[${nowIso}] system: ${costMsg}`);
      } catch {
        // noop
      }
      return next;
    } catch {
      return null;
    }
  }

  /**
   * Ola 16 E1: lee el sessionId guardado para (job, rol).
   * Respaldo del helper `getAgentSession` (la memoria vive en
   * `headless-runtime/sessions/agentSessions.ts`; este archivo NO lo importa:
   * el store nunca importa sessions, sin ciclo). Best-effort, nunca lanza
   * (null ante job inexistente, rol inválido o fallo interno).
   */
  getAgentSession(jobId: string, role: string): string | null {
    try {
      if (typeof jobId !== "string" || jobId.length === 0) return null;
      if (!isKnownAgentRole(role)) return null;
      const current = this.items.get(jobId);
      const sid = current?.agentSessions?.[role as keyof NonNullable<WorkItem["agentSessions"]>];
      return typeof sid === "string" && sid.length > 0 ? sid : null;
    } catch {
      return null;
    }
  }

  /**
   * Ola 16 E1: guarda el sessionId para (job, rol) en el item + job.json.
   * Respaldo del helper `setAgentSession`. Job inexistente → no-op (el
   * caller ya guardó en memoria: "memoria solo"). Sin evento timeline (el
   * guardado normal es silencioso; solo la RENOVACIÓN lleva evento visible).
   * Best-effort, nunca lanza.
   */
  setAgentSession(jobId: string, role: string, sessionId: string): void {
    try {
      if (typeof jobId !== "string" || jobId.length === 0) return;
      if (!isKnownAgentRole(role)) return;
      if (typeof sessionId !== "string" || sessionId.length === 0) return;
      const current = this.items.get(jobId);
      if (!current) return;
      const sessions = { ...(current.agentSessions ?? {}) } as Record<string, string>;
      sessions[role] = sessionId;
      const next: WorkItem = {
        ...current,
        agentSessions: sessions as WorkItem["agentSessions"],
        updatedAt: new Date().toISOString(),
      };
      this.items.set(jobId, next);
      try {
        writeWorkItemJsonAtomic(next);
      } catch {
        // best-effort: disco nunca rompe el flujo
      }
    } catch {
      // nunca lanza
    }
  }

  /**
   * Ola 16 E1: evento timeline visible de renovación lazy de sesión
   * ("sesión renovada (la anterior expiró)", nunca silenciosa, riesgo §3.5).
   * Reutiliza el patrón de `persistCostSummary`: item + evento + job.json
   * atómico + log, todo best-effort. También deja el sessionId nuevo
   * guardado (defensivo: el helper ya llamó a `setAgentSession` antes).
   * Nunca lanza (null ante job inexistente o fallo interno).
   */
  appendAgentSessionRenewed(
    jobId: string,
    role: string,
    oldSessionId: string,
    newSessionId: string,
  ): WorkItem | null {
    try {
      if (typeof jobId !== "string" || jobId.length === 0) return null;
      if (!isKnownAgentRole(role)) return null;
      const current = this.items.get(jobId);
      if (!current) return null;
      const nowIso = new Date().toISOString();
      const short = (s: unknown): string => {
        try {
          const t = String(s ?? "");
          return t.length <= 12 ? t : t.slice(0, 8);
        } catch {
          return "?";
        }
      };
      const message =
        `sesión renovada (la anterior expiró) rol=${role} ${short(oldSessionId)}→${short(newSessionId)}`;
      const entry: WorkItemTimelineEntry = {
        id: `${jobId}-t${current.timeline.length}`,
        from: current.status,
        to: current.status,
        at: nowIso,
        actor: "system",
        message,
        meta: {
          agentSessions: {
            role,
            renewed: true,
            oldSessionId: String(oldSessionId ?? ""),
            newSessionId: String(newSessionId ?? ""),
          },
        } as unknown as Record<string, unknown>,
      };
      const sessions = { ...(current.agentSessions ?? {}) } as Record<string, string>;
      if (typeof newSessionId === "string" && newSessionId.length > 0) {
        sessions[role] = newSessionId;
      }
      const next: WorkItem = {
        ...current,
        agentSessions: sessions as WorkItem["agentSessions"],
        updatedAt: nowIso,
        timeline: [...current.timeline, entry],
        logs: [...(current.logs ?? []), `[${nowIso}] system: ${message}`],
      };
      this.items.set(jobId, next);
      try {
        writeWorkItemJsonAtomic(next);
      } catch {
        // best-effort
      }
      try {
        appendWorkItemLog(next, `[${nowIso}] system: ${message}`);
      } catch {
        // noop
      }
      return next;
    } catch {
      return null;
    }
  }

  /**
   * Registra la última corrida de un hook declarativo (una entrada por
   * nombre: la nueva reemplaza a la anterior). Cap HOOK_RUNS_MAX (Regla 7).
   * No emite evento timeline (el corredor ya anexa el suyo); persiste
   * job.json best-effort. Nunca lanza.
   */
  recordHookRun(
    jobId: string,
    run: {
      name: string;
      stage: string;
      status: string;
      blocking?: boolean;
      sessionId?: string;
    },
  ): void {
    try {
      if (typeof jobId !== "string" || jobId.length === 0) return;
      if (!run || typeof run !== "object") return;
      const name = typeof run.name === "string" ? run.name.trim().slice(0, 64) : "";
      const stage = typeof run.stage === "string" ? run.stage.trim().slice(0, 32) : "";
      const status = typeof run.status === "string" ? run.status.trim().slice(0, 16) : "";
      if (!name || !stage || !status) return;
      const current = this.items.get(jobId);
      if (!current) return;
      const entry = {
        name,
        stage,
        status,
        ...(typeof run.blocking === "boolean" ? { blocking: run.blocking } : {}),
        ...(typeof run.sessionId === "string" && run.sessionId.length > 0
          ? { sessionId: run.sessionId.slice(0, 128) }
          : {}),
        at: new Date().toISOString(),
      };
      const prev = Array.isArray((current as unknown as Record<string, unknown>).hookRuns)
        ? ((current as unknown as Record<string, unknown>).hookRuns as Array<Record<string, unknown>>)
        : [];
      const merged = [
        ...prev.filter((r) => { try { return (r as Record<string, unknown>).name !== name; } catch { return true; } }),
        entry as unknown as Record<string, unknown>,
      ].slice(-20);
      const next = {
        ...current,
        hookRuns: merged,
        updatedAt: new Date().toISOString(),
      } as WorkItem;
      this.items.set(jobId, next);
      try {
        writeWorkItemJsonAtomic(next);
      } catch {
        // best-effort: disco nunca rompe el flujo
      }
    } catch {
      // nunca lanza
    }
  }

  /**
   * Exposes internal map for direct integration with legacy factoryServer jobs Map.
   */
  getMap(): Map<string, WorkItem> {
    return this.items;
  }
}

// Singleton for daemon
export const workItemStore = new WorkItemStore();
