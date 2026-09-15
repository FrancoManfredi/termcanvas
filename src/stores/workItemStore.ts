/**
 * Zustand store for Work Items + Foreman logs (Ola 1).
 * Polling vivo sin reload — se actualiza cada 2.5s via useWorkItemsPolling.
 */

import { create } from "zustand";
import type { WorkItem } from "../../shared/types/workItem";
import type { ForemanLog } from "../../shared/types/foreman";
import type { ImplementResultJson } from "../../shared/types/implement";

/**
 * Perf Ola 4: cheap change signatures over the poll payloads.
 * The shared 2.5s loop `set`s the full lists every tick — without a guard
 * each tick mints a new array identity (+ a fresh `lastUpdatedAt`), which
 * re-renders every `workItems` subscriber and rebuilds both warp snapshots
 * even when the daemon reported zero changes (the steady-state storm).
 * These signatures cover the fields the panel derives from (status flow,
 * timestamps, timeline growth, PR linkage); an unchanged signature keeps
 * the old array identity AND skips the `lastUpdatedAt` bump, so the tick
 * becomes a no-op downstream. Fail-open: junk/throws force the update
 * (old behavior — never hide a real change). Pure, offline-testable.
 */
export function workItemListSignature(items: unknown): string {
  try {
    if (!Array.isArray(items)) return "non-array";
    return items
      .map((raw): string => {
        try {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "?";
          const j = raw as Record<string, unknown>;
          const id = typeof j.id === "string" ? j.id : "?";
          const status = typeof j.status === "string" ? j.status : "?";
          const updatedAt =
            typeof j.updatedAt === "string" ? j.updatedAt : "?";
          const phase = typeof j.phase === "string" ? j.phase : "?";
          const reviewCount =
            typeof j.reviewCount === "number" ? String(j.reviewCount) : "?";
          const tl = Array.isArray(j.timeline) ? j.timeline : [];
          // Perf Ola B: los items summary traen `timeline: []` + escalares
          // `timelineCount`/`lastEventAt` (ver `toListSummary` en el daemon);
          // la firma prefiere el timeline real y cae a los escalares.
          const tlLen =
            tl.length > 0
              ? tl.length
              : typeof j.timelineCount === "number" &&
                  Number.isInteger(j.timelineCount) &&
                  j.timelineCount >= 0
                ? j.timelineCount
                : 0;
          const lastAt = (() => {
            try {
              if (tl.length > 0) {
                const last = tl[tl.length - 1] as Record<string, unknown>;
                if (typeof last?.at === "string" && last.at.trim() !== "") {
                  return last.at;
                }
                return "?";
              }
              if (
                typeof j.lastEventAt === "string" &&
                j.lastEventAt.trim() !== ""
              ) {
                return j.lastEventAt;
              }
              return "?";
            } catch {
              return "?";
            }
          })();
          const iso = j.isolation;
          let pr = "?";
          if (iso !== null && typeof iso === "object" && !Array.isArray(iso)) {
            const rec = iso as Record<string, unknown>;
            const pn = typeof rec.prNumber === "number" ? String(rec.prNumber) : "?";
            const pu = typeof rec.prUrl === "string" ? rec.prUrl : "?";
            pr = `${pn}/${pu}`;
          }
          // Session surface: the daemon attaches `dashboardUrl` / `sessionId`
          // / `liveSession` / `sessions` and may not bump `updatedAt` on the
          // same tick. Without these in the signature the skip would freeze
          // "View Agent" disabled forever (test: session CTA flips).
          const dashboardUrl =
            typeof j.dashboardUrl === "string" ? j.dashboardUrl : "?";
          const sessionId = typeof j.sessionId === "string" ? j.sessionId : "?";
          const live = j.liveSession;
          const liveUrl =
            live !== null &&
            typeof live === "object" &&
            !Array.isArray(live) &&
            typeof (live as Record<string, unknown>).sessionUrl === "string"
              ? ((live as Record<string, unknown>).sessionUrl as string)
              : "?";
          const sessionsLen = Array.isArray(j.sessions) ? j.sessions.length : 0;
          // Engine surface: nodeStates/nodeAgents/gate cambian sin bump de
          // updatedAt (attach de sesión al enviar, gate pendiente). Sin esto
          // el skip-guard congelaría el stepper y las filas nuevas.
          const run = j.engineRun;
          let runSig = "?";
          if (run !== null && typeof run === "object" && !Array.isArray(run)) {
            const rec = run as Record<string, unknown>;
            const states = rec.nodeStates;
            const agents = rec.nodeAgents;
            runSig = `${typeof rec.currentNodeId === "string" ? rec.currentNodeId : "?"}|${
              states !== null && typeof states === "object" && !Array.isArray(states)
                ? Object.keys(states).length
                : 0
            }|${
              agents !== null && typeof agents === "object" && !Array.isArray(agents)
                ? Object.keys(agents).length
                : 0
            }`;
          }
          const gate = j.engineGate;
          const gateNode =
            gate !== null &&
            typeof gate === "object" &&
            !Array.isArray(gate) &&
            typeof (gate as Record<string, unknown>).nodeId === "string"
              ? ((gate as Record<string, unknown>).nodeId as string)
              : "?";
          return `${id}|${status}|${updatedAt}|${phase}|${reviewCount}|${tlLen}|${lastAt}|${pr}|${dashboardUrl}|${sessionId}|${liveUrl}|${sessionsLen}|${runSig}|${gateNode}`;
        } catch {
          return `throw-${Math.random()}`;
        }
      })
      .join(";");
  } catch {
    return `throw-${Math.random()}`;
  }
}

/** Append-only log window: length + edge ids/cursor catch every append or rotation. */
export function foremanLogsSignature(logs: unknown): string {
  try {
    if (!Array.isArray(logs)) return "non-array";
    const first = logs.length > 0 ? logs[0] : null;
    const last = logs.length > 0 ? logs[logs.length - 1] : null;
    const edge = (v: unknown): string => {
      try {
        if (!v || typeof v !== "object" || Array.isArray(v)) return "?";
        const r = v as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : "?";
        const at = typeof r.at === "string" ? r.at : "?";
        return `${id}@${at}`;
      } catch {
        return `throw-${Math.random()}`;
      }
    };
    return `${logs.length}|${edge(first)}|${edge(last)}`;
  } catch {
    return `throw-${Math.random()}`;
  }
}

interface WorkItemState {
  workItems: WorkItem[];
  foremanLogs: ForemanLog[];
  isLoadingWorkItems: boolean;
  isLoadingForemanLogs: boolean;
  workItemsError: string | null;
  foremanLogsError: string | null;
  lastUpdatedAt: string | null;
  selectedWorkItemId: string | null;
  resultCache: Record<string, ImplementResultJson>;
  /** Ola C3: true mientras el circuit-breaker corre 1 de cada N ticks. */
  pollDegraded: boolean;
  setPollDegraded: (degraded: boolean) => void;
  setWorkItems: (items: WorkItem[]) => void;
  setForemanLogs: (logs: ForemanLog[]) => void;
  setLoadingWorkItems: (loading: boolean) => void;
  setLoadingForemanLogs: (loading: boolean) => void;
  setWorkItemsError: (err: string | null) => void;
  setForemanLogsError: (err: string | null) => void;
  setLastUpdatedAt: (iso: string | null) => void;
  setSelectedWorkItemId: (id: string | null) => void;
  setResultCache: (id: string, result: ImplementResultJson) => void;
  clearResultCache: (id: string) => void;
}

export const useWorkItemStore = create<WorkItemState>((set) => ({
  workItems: [],
  foremanLogs: [],
  isLoadingWorkItems: false,
  isLoadingForemanLogs: false,
  workItemsError: null,
  foremanLogsError: null,
  lastUpdatedAt: null,
  selectedWorkItemId: null,
  resultCache: {},
  pollDegraded: false,
  setPollDegraded: (degraded) =>
    set((s) => (s.pollDegraded === degraded ? {} : { pollDegraded: degraded })),
  setWorkItems: (items) =>
    set((s) => {
      try {
        // Perf Ola 4: unchanged payload → keep identity, skip the
        // `lastUpdatedAt` bump. Steady-state ticks become downstream no-ops
        // (no subscriber re-render, no snapshot rebuild).
        if (workItemListSignature(s.workItems) === workItemListSignature(items)) {
          return {};
        }
      } catch {
        // Fail-open: fall through to the update below.
      }
      return { workItems: items, lastUpdatedAt: new Date().toISOString() };
    }),
  setForemanLogs: (logs) =>
    set((s) => {
      try {
        if (foremanLogsSignature(s.foremanLogs) === foremanLogsSignature(logs)) {
          return {};
        }
      } catch {
        // Fail-open: fall through to the update below.
      }
      return { foremanLogs: logs };
    }),
  setLoadingWorkItems: (loading) => set({ isLoadingWorkItems: loading }),
  setLoadingForemanLogs: (loading) => set({ isLoadingForemanLogs: loading }),
  setWorkItemsError: (err) => set({ workItemsError: err }),
  setForemanLogsError: (err) => set({ foremanLogsError: err }),
  setLastUpdatedAt: (iso) => set({ lastUpdatedAt: iso }),
  setSelectedWorkItemId: (id) => set({ selectedWorkItemId: id }),
  setResultCache: (id, result) => set((s) => ({ resultCache: { ...s.resultCache, [id]: result } })),
  clearResultCache: (id) =>
    set((s) => {
      const copy = { ...s.resultCache };
      delete copy[id];
      return { resultCache: copy };
    }),
}));
