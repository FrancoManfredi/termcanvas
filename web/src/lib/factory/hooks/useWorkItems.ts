import { useMemo, useSyncExternalStore, useCallback } from "react";
import { type WorkItemFilter } from "../store/workItem.store";
import { useWorkItemStore } from "../store/WorkItemStoreContext";
import type { Actor, WorkItemStage, TransitionContext } from "../domain/workItem.types";

export function useWorkItems(filter: WorkItemFilter = {}) {
  const store = useWorkItemStore();
  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion()
  );

  const items = useMemo(() => store.list(filter), [version, filter.stage, filter.createdBy, filter.search, filter.factoryName, filter.includeTerminals]);

  const create = useCallback((...args: Parameters<(typeof store)["create"]>) => store.create(...args), [store]);
  const transition = useCallback((id: string, to: WorkItemStage, actor: Actor, ctx?: TransitionContext) => store.transition(id, to, actor, ctx), [store]);
  const cancel = useCallback((id: string, actor?: Actor, reason?: string) => store.cancel(id, actor, reason), [store]);

  return { items, create, transition, cancel, store };
}

export function useWorkItem(id: string) {
  const store = useWorkItemStore();
  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion()
  );
  const item = useMemo(() => store.getById(id), [version, id]);
  const transition = useCallback((to: WorkItemStage, actor: Actor, ctx?: TransitionContext) => store.transition(id, to, actor, ctx), [store, id]);
  const cancel = useCallback((actor?: Actor, reason?: string) => store.cancel(id, actor, reason), [store, id]);
  return { item, transition, cancel };
}

export function getWorkItemStore() {
  return useWorkItemStore();
}
