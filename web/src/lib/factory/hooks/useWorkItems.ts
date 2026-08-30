import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkItemFilter } from "../ports/factory.ports";
import { useWorkItemStore, getDefaultStore } from "../store/workItemStore.context";
import type { Actor, WorkItem, WorkItemStage, TransitionContext } from "../domain/workItem.types";
import type { WorkItemRepositoryPort } from "../ports/factory.ports";
import type { ParseResult } from "../domain/result";

// O18: await MaybePromise + useSyncExternalStore — filtros contra backend + includeTerminals/server search
// BugFix: garantizar que `items` siempre sea array (nunca undefined) incluso si el repo remoto falla o retorna ParseResult
function toWorkItemArray(raw: unknown): readonly WorkItem[] {
  if (Array.isArray(raw)) return raw as readonly WorkItem[];
  if (raw == null) return [];
  // Defensive: si por error el repo retornó ParseResult<WorkItem[]> (create vs list confusión)
  if (typeof raw === "object" && raw !== null && "ok" in (raw as Record<string, unknown>)) {
    const pr = raw as unknown as ParseResult<readonly WorkItem[]>;
    if (pr.ok && Array.isArray(pr.value)) return pr.value as readonly WorkItem[];
    return [];
  }
  // Any other truthy non-array → []
  return [];
}

export function useWorkItems(filter: WorkItemFilter = {}) {
  const rawStore = useWorkItemStore();
  const store = rawStore as unknown as WorkItemRepositoryPort & {
    create: (...args: unknown[]) => unknown;
    transition: (...args: unknown[]) => unknown;
    cancel: (...args: unknown[]) => unknown;
    getById: (id: string) => unknown;
    list: (f?: WorkItemFilter) => unknown;
    subscribe: (cb: () => void) => () => void;
    getVersion: () => number;
  };

  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion()
  );

  const { stage, createdBy, search, factoryName, includeTerminals } = filter;
  const filterKey = JSON.stringify({ stage, createdBy, search, factoryName, includeTerminals });

  // Estado reactivo hidratado via await MaybePromise (Local sync | Remote async)
  const [items, setItems] = useState<readonly WorkItem[]>(() => {
    try {
      const maybe = store.list({ stage, createdBy, search, factoryName, includeTerminals } as WorkItemFilter);
      if (maybe instanceof Promise) return [];
      const arr = toWorkItemArray(maybe as unknown);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // await MaybePromise — server-side search & includeTerminals via RemoteWorkItemRepo
        const raw = await Promise.resolve(
          store.list({ stage, createdBy, search, factoryName, includeTerminals } as WorkItemFilter) as
            | Promise<readonly WorkItem[]>
            | readonly WorkItem[]
            | unknown
        );
        const resolved = toWorkItemArray(raw as unknown);
        if (!cancelled) {
          setItems(Array.isArray(resolved) ? resolved : []);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) {
          // Garantizar nunca undefined: ante error, [] + mensaje
          setItems([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, filterKey]);

  // version es marcador de reactividad para useSyncExternalStore
  void version;

  const create = useCallback((...args: Parameters<(typeof rawStore)["create"]>) => store.create(...(args as unknown[])) as unknown, [store]);
  const transition = useCallback(
    (id: string, to: WorkItemStage, actor: Actor, ctx?: TransitionContext) => store.transition(id, to, actor, ctx) as unknown,
    [store]
  );
  const cancel = useCallback(
    (id: string, actor?: Actor, reason?: string) => {
      // WorkItemStore tiene cancel; RemoteWorkItemRepo lo implementa como transition a Cancelled
      const maybeCancel = (store as unknown as { cancel?: (id: string, actor?: Actor, reason?: string) => unknown }).cancel;
      if (maybeCancel) return maybeCancel.call(store, id, actor, reason) as unknown;
      return store.transition(id, "Cancelled" as WorkItemStage, (actor ?? "foreman") as Actor, { reason } as TransitionContext) as unknown;
    },
    [store]
  );

  // memo para evitar re-renders innecesarios cuando filter no cambia + guard Array.isArray
  const stableItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  return { items: stableItems as WorkItem[], create, transition, cancel, store: rawStore, loading, error };
}

export function useWorkItem(id: string) {
  const rawStore = useWorkItemStore();
  const store = rawStore as unknown as WorkItemRepositoryPort & {
    getById: (id: string) => unknown;
    transition: (...args: unknown[]) => unknown;
    cancel: (...args: unknown[]) => unknown;
    subscribe: (cb: () => void) => () => void;
    getVersion: () => number;
  };
  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion()
  );
  const [item, setItem] = useState<WorkItem | undefined>(() => {
    try {
      const maybe = store.getById(id);
      if (maybe instanceof Promise) return undefined;
      return maybe as WorkItem | undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await Promise.resolve(store.getById(id) as Promise<WorkItem | undefined> | WorkItem | undefined);
        if (!cancelled) setItem(res as WorkItem | undefined);
      } catch {
        if (!cancelled) setItem(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, version, id]);

  void version;

  const transition = useCallback(
    (to: WorkItemStage, actor: Actor, ctx?: TransitionContext) => store.transition(id, to, actor, ctx) as unknown,
    [store, id]
  );
  const cancel = useCallback(
    (actor?: Actor, reason?: string) => {
      const maybeCancel = (store as unknown as { cancel?: (id: string, a?: Actor, r?: string) => unknown }).cancel;
      if (maybeCancel) return maybeCancel.call(store, id, actor, reason) as unknown;
      return store.transition(id, "Cancelled" as WorkItemStage, (actor ?? "foreman") as Actor, { reason } as TransitionContext) as unknown;
    },
    [store, id]
  );
  return { item, transition, cancel };
}

export function getWorkItemStore() {
  return getDefaultStore();
}
