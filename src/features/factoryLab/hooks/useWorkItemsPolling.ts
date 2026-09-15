/**
 * useWorkItemsPolling — polling vivo cada 2.5s sin reload.
 * GET /factory/jobs + GET /foreman/logs con fetchWithTimeout 3s + AbortController.
 * Actualiza Zustand workItemStore sin window.reload.
 *
 * Single shared loop (module-level refcount): FactoryLabPage and
 * WarpPanelShell mount this hook from MUTUALLY EXCLUSIVE branches
 * (App.tsx), and the warp panel resolves issues via factory jobs — so the
 * poll must run while EITHER surface is open. Concurrent mounts share the
 * single 2.5s loop (zero new polls, same endpoints, same cadence); the
 * last unmount stops it. All reads/writes go through
 * `useWorkItemStore.getState()` so the shared tick never captures stale
 * closures.
 */

import { useEffect } from "react";
import { useWorkItemStore } from "@/stores/workItemStore";
import {
  isOptimisticReadyFresh,
  useIssueReviewStore,
  type LinkedPr,
} from "@/stores/issueReviewStore";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  isFactoryJobCompleted,
  readFactoryJobIssueRef,
} from "@/features/warpPanel/adapters/factoryIssueJobs";
import { activityLog } from "@/features/warpPanel/activityDebug";

const POLL_INTERVAL_MS = 2500;
const FETCH_TIMEOUT_MS = 3000;

/**
 * Poll payload view (perf Ola B).
 * - "full": `GET /factory/jobs` byte-identical shape (FactoryLab default).
 * - "summary": `GET /factory/jobs?view=summary` (sin timeline/costos; ver
 *   `toListSummary` en el daemon). El warp panel usa summary; FactoryLab
 *   sigue en full. Mismas claves leídas (`workItems ?? jobs`).
 */
export type FactoryPollView = "full" | "summary";

/** Active view for the shared loop (single owner by design, see below). */
let sharedView: FactoryPollView = "full";
/**
 * Perf P0a: `/foreman/logs` solo lo lee FactoryLab (único lector en `src/`);
 * el warp se ahorra 1 HTTP + parse + writes por tick. Default true para
 * preservar FactoryLab byte-identico.
 */
let sharedIncludeLogs = true;

/**
 * URL de logs o null (skip) — pura para tests. El warp pasa false.
 * Nunca lanza.
 */
export function foremanLogsUrl(
  port: number,
  includeLogs: boolean,
): string | null {
  try {
    if (includeLogs !== true) return null;
    if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
      return null;
    }
    return `http://127.0.0.1:${port}/foreman/logs?limit=100`;
  } catch {
    return null;
  }
}

/**
 * Perf Ola C3: circuit-breaker del poll (seguro anti-regrowth).
 * Si el fetch tarda cerca del intervalo o el payload supera ~1MB dos ticks
 * seguidos, el loop pasa a 1 de cada 4 ticks (10s) y levanta el flag
 * `pollDegraded` del store (el sidebar lo muestra ámbar). Un tick
 * rápido+chico recupera. Máquina de estados pura para tests offline.
 * Nunca lanza.
 */
export const POLL_SLOW_MS = 2000;
export const POLL_BIG_BYTES = 1_000_000;
export const POLL_DEGRADED_STREAK = 2;
export const POLL_BACKOFF_EVERY = 4;

export interface PollHealth {
  streak: number;
  skipLeft: number;
  degraded: boolean;
}

export function initialPollHealth(): PollHealth {
  return { streak: 0, skipLeft: 0, degraded: false };
}

function cleanHealth(value: unknown): PollHealth {
  try {
    const r = value as Partial<PollHealth>;
    const streak =
      typeof r?.streak === "number" && Number.isInteger(r.streak) && r.streak >= 0
        ? Math.min(r.streak, 100)
        : 0;
    const skipLeft =
      typeof r?.skipLeft === "number" && Number.isInteger(r.skipLeft) && r.skipLeft >= 0
        ? Math.min(r.skipLeft, 100)
        : 0;
    return { streak, skipLeft, degraded: r?.degraded === true };
  } catch {
    return initialPollHealth();
  }
}

/** Gate al inicio del tick: en backoff se saltean N-1 de cada N. */
export function shouldRunPollTick(prev: PollHealth): {
  run: boolean;
  health: PollHealth;
} {
  try {
    const h = cleanHealth(prev);
    if (h.skipLeft > 0) {
      return { run: false, health: { ...h, skipLeft: h.skipLeft - 1 } };
    }
    return { run: true, health: h };
  } catch {
    return { run: true, health: initialPollHealth() };
  }
}

/** Cierre del tick: un sample malo suma racha (2 → degradado + backoff),
 * uno bueno limpia. */
export function recordPollSample(
  prev: PollHealth,
  sample: { slow: boolean; big: boolean },
): PollHealth {
  try {
    const h = cleanHealth(prev);
    const bad = sample?.slow === true || sample?.big === true;
    if (!bad) {
      if (!h.degraded && h.streak === 0) return h;
      return { streak: 0, skipLeft: 0, degraded: false };
    }
    const streak = h.streak + 1;
    if (streak >= POLL_DEGRADED_STREAK) {
      return { streak, skipLeft: POLL_BACKOFF_EVERY - 1, degraded: true };
    }
    return { ...h, streak };
  } catch {
    return initialPollHealth();
  }
}

/**
 * Perf P1a: ventana rotativa para lookups (el seed TTL refresca N jobs
 * Complete por tick en vez de todos a la vez). Pura para tests. Nunca lanza.
 */
export const SEED_FORCE_LOOKUP_PER_TICK = 8;

export function rotateWindow<T>(
  items: readonly T[],
  cursor: unknown,
  size: unknown,
): { batch: T[]; nextCursor: number } {
  try {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return { batch: [], nextCursor: 0 };
    const n =
      typeof size === "number" && Number.isInteger(size) && size > 0
        ? size
        : SEED_FORCE_LOOKUP_PER_TICK;
    const start =
      typeof cursor === "number" &&
      Number.isInteger(cursor) &&
      cursor >= 0
        ? cursor % list.length
        : 0;
    const batch: T[] = [];
    for (let i = 0; i < Math.min(n, list.length); i += 1) {
      batch.push(list[(start + i) % list.length]);
    }
    return { batch, nextCursor: (start + batch.length) % list.length };
  } catch {
    return { batch: [], nextCursor: 0 };
  }
}

/** Cursor de rotación del seed (module-level, como el resto del loop). */
let seedCursor = 0;

/**
 * TTL de re-siembra por issue cuando la lookup ya cacheó `null` ("sin PR"):
 * el daemon abrió el PR DESPUÉS de esa foto, así que el null está viejo y
 * hay que pisarlo. La ventana evita el fake-PR storm de un PR cerrado que
 * el daemon todavía reporta `pr-open` (máx. 1 siembra+lookup por minuto).
 */
const SEED_RESEED_TTL_MS = 60_000;

/** Última siembra por issue (module-level, como `seedCursor`). */
const lastSeedAtByIssue = new Map<number, number>();

/** Test seam: limpia el rate-limit del seed entre casos. Nunca en prod. */
export function resetSeedStateForTests(): void {
  try {
    lastSeedAtByIssue.clear();
  } catch {
    // noop
  }
}

/**
 * Seeds the GitHub PR association straight from the factory daemon's own
 * record: when a job lands `isolation.prUrl`, the canvas/panel needs the
 * linked-PR state immediately (the ready-to-merge status derivation
 * requires an OPEN PR for the issue) — the on-demand GitHub lookup alone
 * leaves the row in "pending" until someone happens to trigger a refresh.
 * Seeds only unknown PRs: real GitHub lookups stay authoritative afterwards
 * (they overwrite both maps with titles, labels and verdicts). Best-effort.
 *
 * Perf P1a: la rama Complete-sin-PR (refresh por TTL cada 5min) junta
 * candidatos y actúa sobre una ventana rotativa de N por tick en vez de
 * disparar N `gh` de golpe. La rama con-PR-nuevo sigue inmediata (evento
 * raro y sensible al tiempo).
 */
export function seedOpenPrsFromFactoryJobs(list: unknown[]): void {
  try {
    const store = useIssueReviewStore.getState();
    const ttlRefresh: number[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const job = raw as {
        isolation?: { prUrl?: unknown; prNumber?: unknown; branch?: unknown };
        // `?view=summary` (warp panel) projects the newest `pr` meta instead
        // of `isolation` — without reading it the seed was dead in the panel.
        pr?: { prUrl?: unknown; prNumber?: unknown };
      };
      const iso = job.isolation;
      const isoUrl =
        iso && typeof iso.prUrl === "string" ? iso.prUrl : "";
      const projectedUrl =
        job.pr && typeof job.pr.prUrl === "string" ? job.pr.prUrl : "";
      const prUrl = isoUrl !== "" ? isoUrl : projectedUrl;
      if (prUrl.length === 0) {
        // Sin PR todavía pero job Complete con issueRef: ventana
        // Complete→PR opened (el hook del daemon corre en setImmediate).
        // Se junta para la ventana rotativa (abajo), una vez por TTL.
        try {
          if (isFactoryJobCompleted(raw)) {
            const ref = readFactoryJobIssueRef(raw);
            const n = ref?.issueNumber;
            if (typeof n === "number" && Number.isInteger(n) && n > 0) {
              const at = store.optimisticReadyByIssue[n];
              if (!isOptimisticReadyFresh(at)) {
                ttlRefresh.push(n);
              }
            }
          }
        } catch {
          // best-effort
        }
        continue;
      }
      const rawPrNumber =
        typeof iso?.prNumber === "number" ? iso.prNumber : job.pr?.prNumber;
      if (
        typeof rawPrNumber !== "number" ||
        !Number.isInteger(rawPrNumber) ||
        rawPrNumber <= 0
      ) {
        continue;
      }
      const prNumber = rawPrNumber;
      const branch = typeof iso?.branch === "string" ? iso.branch : "";
      // Issue number: the branch pattern when known (full view), else the
      // daemon `issueRef` (present in the summary projection too).
      const m = branch.match(/^issue-(\d+)/);
      const ref = readFactoryJobIssueRef(raw);
      const issueNumber = m
        ? Number.parseInt(m[1] as string, 10)
        : ref?.issueNumber ?? Number.NaN;
      if (!Number.isInteger(issueNumber) || issueNumber <= 0) continue;
      const existing = store.openPrsByIssue[issueNumber] ?? [];
      if (existing.some((p) => p.number === prNumber)) continue;
      const cached = store.prsByIssue[issueNumber];
      // Un PR REAL cacheado o una lookup en vuelo mandan: GitHub es la
      // fuente autoritativa y el seed jamás la pisa.
      if (cached !== undefined && cached !== null) continue;
      // `null` = "sin PR" cacheado ANTES de que el daemon abriera el PR
      // (típico: la fila se miró durante el run). El daemon ya lo vio, así
      // que el null está viejo: se re-siembra y se fuerza el lookup. La
      // ventana por issue evita el fake-PR storm (1 siembra/min máx).
      const now = Date.now();
      const seededAt = lastSeedAtByIssue.get(issueNumber) ?? 0;
      if (now - seededAt < SEED_RESEED_TTL_MS) continue;
      lastSeedAtByIssue.set(issueNumber, now);
      const linked: LinkedPr = {
        number: prNumber,
        title: `Pull request #${prNumber}`,
        url: prUrl,
        state: "OPEN",
        headRefName: branch,
        headRefOid: "",
      };
      store.setOpenPrs(issueNumber, [...existing, linked]);
      store.setPrStatus(issueNumber, linked);
      // PR recién conocido por el daemon pero GitHub aún puede no indexar
      // el `Closes #N`: marca optimista (Ready con Merge deshabilitado) +
      // un lookup forzado para reconciliar (eventual consistency).
      try {
        store.setOptimisticReady(issueNumber);
        store.requestPrLookup(issueNumber, undefined, true);
      } catch {
        // best-effort
      }
    }
    // Perf P1a: ventana rotativa del refresh TTL (N por tick, sin tormenta).
    try {
      if (ttlRefresh.length > 0) {
        const { batch, nextCursor } = rotateWindow(
          ttlRefresh,
          seedCursor,
          SEED_FORCE_LOOKUP_PER_TICK,
        );
        seedCursor = nextCursor;
        for (const n of batch) {
          try {
            store.setOptimisticReady(n);
            store.requestPrLookup(n, undefined, true);
          } catch {
            // best-effort por fila
          }
        }
      }
    } catch {
      // best-effort
    }
  } catch {
    // Best-effort: the GitHub lookup remains the authoritative path.
  }
}

// TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const externalSignal = init.signal as AbortSignal | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Enabled mounts holding the shared loop open. */
let sharedWatcherCount = 0;
/** Shared interval handle (null = loop stopped). Single owner by design. */
let sharedInterval: number | null = null;
/** In-flight shared tick abort (chained cancel, same as before). */
let sharedAbort: AbortController | null = null;
/** Generation: late responses after the last unmount are dropped. */
let sharedGen = 0;
/** Circuit-breaker state (Ola C3). Module-level like the rest here. */
let pollHealth: PollHealth = initialPollHealth();

async function sharedTick(): Promise<void> {
  const gen = sharedGen;
  const alive = (): boolean => gen === sharedGen && sharedWatcherCount > 0;
  // Ola C3: en backoff se corre 1 de cada N ticks.
  try {
    const gate = shouldRunPollTick(pollHealth);
    pollHealth = gate.health;
    if (!gate.run) return;
  } catch {
    // fail-open: ante duda se corre el tick
  }
  // Cancel previous tick's abort if still pending
  if (sharedAbort) {
    try { sharedAbort.abort(); } catch {}
  }
  const abort = new AbortController();
  sharedAbort = abort;

  const port = await discoverFactoryPort();
  if (!alive() || abort.signal.aborted) return;
  if (port === null) {
    // No factory available — don't spam error, just set empty
    if (alive()) {
      try {
        useWorkItemStore.getState().setWorkItemsError(null);
        useWorkItemStore.getState().setForemanLogsError(null);
      } catch {}
    }
    return;
  }

  // Fetch WorkItems
  // Ola C3: el sample del breaker sale de este fetch (el dominante).
  let jobsSlow = false;
  let jobsBig = false;
  try {
    useWorkItemStore.getState().setLoadingWorkItems(true);
  } catch {}
  try {
    const url =
      sharedView === "summary"
        ? `http://127.0.0.1:${port}/factory/jobs?view=summary`
        : `http://127.0.0.1:${port}/factory/jobs`;
    const t0 = Date.now();
    const res = await fetchWithTimeout(url, { signal: abort.signal }, FETCH_TIMEOUT_MS);
    try {
      if (Date.now() - t0 >= POLL_SLOW_MS) jobsSlow = true;
    } catch {
      // sin reloj no se declara lento
    }
    try {
      const len = res.headers?.get?.("content-length");
      const bytes = typeof len === "string" ? Number.parseInt(len, 10) : Number.NaN;
      if (Number.isFinite(bytes) && (bytes as number) >= POLL_BIG_BYTES) {
        jobsBig = true;
      }
    } catch {
      // sin header no se declara grande
    }
    if (!res.ok) throw new Error(`GET /factory/jobs → ${res.status}`);
    const data = (await res.json()) as { jobs?: unknown[]; workItems?: unknown[] };
    const list = (data.workItems ?? data.jobs ?? []) as unknown[];
    if (alive() && !abort.signal.aborted) {
      // Cast to WorkItem — trust server shape
      useWorkItemStore.getState().setWorkItems(list as unknown as import("../../../../shared/types/workItem").WorkItem[]);
      useWorkItemStore.getState().setWorkItemsError(null);
      seedOpenPrsFromFactoryJobs(list);
      try {
        activityLog("poll factory jobs → store", {
          count: list.length,
        });
      } catch {
        // el log nunca rompe el poll
      }
    }
  } catch (e) {
    if (alive() && !abort.signal.aborted) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
        // Ola C3: abort/timeout ⇒ slow por definición (timeout 3s > intervalo
        // 2.5s). Se ignoraba en silencio; ahora alimenta el breaker.
        jobsSlow = true;
      } else {
        try {
          useWorkItemStore.getState().setWorkItemsError(msg);
        } catch {}
      }
    }
  } finally {
    if (alive()) {
      try {
        useWorkItemStore.getState().setLoadingWorkItems(false);
      } catch {}
    }
    // Ola C3: cierre del tick para el breaker + sync del flag (solo al
    // cambiar, para no re-renderizar suscriptores en cada tick).
    try {
      pollHealth = recordPollSample(pollHealth, { slow: jobsSlow, big: jobsBig });
      const store = useWorkItemStore.getState();
      if (store.pollDegraded !== pollHealth.degraded) {
        store.setPollDegraded(pollHealth.degraded);
      }
    } catch {
      // best-effort
    }
  }

  // Fetch Foreman logs (P0a: solo FactoryLab — el warp no lo lee).
  const logsUrl = foremanLogsUrl(port, sharedIncludeLogs);
  if (logsUrl === null) return;
  try {
    useWorkItemStore.getState().setLoadingForemanLogs(true);
  } catch {}
  try {
    const res2 = await fetchWithTimeout(logsUrl, { signal: abort.signal }, FETCH_TIMEOUT_MS);
    if (!res2.ok) throw new Error(`GET /foreman/logs → ${res2.status}`);
    const data2 = (await res2.json()) as { logs?: unknown[] };
    const logs = (data2.logs ?? []) as unknown[];
    if (alive() && !abort.signal.aborted) {
      useWorkItemStore.getState().setForemanLogs(logs as unknown as import("../../../../shared/types/foreman").ForemanLog[]);
      useWorkItemStore.getState().setForemanLogsError(null);
    }
  } catch (e) {
    if (alive() && !abort.signal.aborted) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
        // ignore
      } else {
        try {
          useWorkItemStore.getState().setForemanLogsError(msg);
        } catch {}
      }
    }
  } finally {
    if (alive()) {
      try {
        useWorkItemStore.getState().setLoadingForemanLogs(false);
      } catch {}
    }
  }
}

function startSharedPoll(): void {
  if (sharedInterval !== null) return;
  void sharedTick();
  sharedInterval = window.setInterval(() => {
    void sharedTick();
  }, POLL_INTERVAL_MS);
}

function stopSharedPoll(): void {
  sharedGen += 1;
  if (sharedInterval !== null) {
    clearInterval(sharedInterval);
    sharedInterval = null;
  }
  if (sharedAbort) {
    try { sharedAbort.abort(); } catch {}
    sharedAbort = null;
  }
  // Ola C3: loop detenido = pizarrón limpio (un remount re-evalúa).
  pollHealth = initialPollHealth();
  try {
    useWorkItemStore.getState().setLoadingWorkItems(false);
    useWorkItemStore.getState().setLoadingForemanLogs(false);
    if (useWorkItemStore.getState().pollDegraded === true) {
      useWorkItemStore.getState().setPollDegraded(false);
    }
  } catch {}
}

export function useWorkItemsPolling(
  enabled: boolean = true,
  view: FactoryPollView = "full",
  includeLogs = true,
) {
  useEffect(() => {
    if (!enabled) return;
    sharedView = view;
    sharedIncludeLogs = includeLogs === true;
    sharedWatcherCount += 1;
    if (sharedWatcherCount === 1) startSharedPoll();
    return () => {
      sharedWatcherCount = Math.max(0, sharedWatcherCount - 1);
      if (sharedWatcherCount === 0) stopSharedPoll();
    };
  }, [enabled, view, includeLogs]);
}
