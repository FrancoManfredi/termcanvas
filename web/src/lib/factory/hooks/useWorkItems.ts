import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkItemFilter } from "../ports/factory.ports";
import { useWorkItemStore, getDefaultStore } from "../store/workItemStore.context";
import type { Actor, WorkItem, WorkItemStage, TransitionContext } from "../domain/workItem.types";
import type { WorkItemRepositoryPort } from "../ports/factory.ports";

// O18: await MaybePromise + useSyncExternalStore — filtros contra backend + includeTerminals/server search
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
    const maybe = store.list({ stage, createdBy, search, factoryName, includeTerminals } as WorkItemFilter);
    if (maybe instanceof Promise) return [];
    return maybe as readonly WorkItem[];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // await MaybePromise — server-side search & includeTerminals via RemoteWorkItemRepo
        const res = await Promise.resolve(
          store.list({ stage, createdBy, search, factoryName, includeTerminals } as WorkItemFilter) as Promise<readonly WorkItem[]> | readonly WorkItem[]
        );
        if (!cancelled) {
          setItems(res as readonly WorkItem[]);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
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

  // memo para evitar re-renders innecesarios cuando filter no cambia
  const stableItems = useMemo(() => items, [items]);

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
    const maybe = store.getById(id);
    if (maybe instanceof Promise) return undefined;
    return maybe as WorkItem | undefined;
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await Promise.resolve(store.getById(id) as Promise<WorkItem | undefined> | WorkItem | undefined);
      if (!cancelled) setItem(res as WorkItem | undefined);
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
