import { useMemo, useSyncExternalStore, useCallback } from "react";
import { WorkItemStore, type WorkItemFilter } from "../store/workItem.store";
import type { Actor, WorkItemStage, TransitionContext } from "../domain/workItem.types";

const store = new WorkItemStore(undefined, ["payments-factory", "termcanvas-factory"]);

export function useWorkItems(filter: WorkItemFilter = {}) {
  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion()
  );

  const items = useMemo(() => store.list(filter), [version, filter.stage, filter.createdBy, filter.search, filter.factoryName, filter.includeTerminals]);

  const create = useCallback((...args: Parameters<WorkItemStore["create"]>) => store.create(...args), []);
  const transition = useCallback((id: string, to: WorkItemStage, actor: Actor, ctx?: TransitionContext) => store.transition(id, to, actor, ctx), []);
  const cancel = useCallback((id: string, actor?: Actor, reason?: string) => store.cancel(id, actor, reason), []);

  return { items, create, transition, cancel, store };
}

export function useWorkItem(id: string) {
  const version = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion()
  );
  const item = useMemo(() => store.getById(id), [version, id]);
  const transition = useCallback((to: WorkItemStage, actor: Actor, ctx?: TransitionContext) => store.transition(id, to, actor, ctx), [id]);
  const cancel = useCallback((actor?: Actor, reason?: string) => store.cancel(id, actor, reason), [id]);
  return { item, transition, cancel };
}

export function getWorkItemStore() {
  return store;
}
