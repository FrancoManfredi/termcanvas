// WorkItemStoreContext — SRP: holds the React context, the default singleton and the accessor hook.
// Source: WarpFactories.md §10

import { createContext, useContext } from "react";
import { WorkItemStore } from "./workItem.store";

export const WorkItemStoreContext = createContext<WorkItemStore | null>(null);

let defaultStore: WorkItemStore | null = null;

/** Process-wide singleton used when no provider is mounted (DIP fallback). */
export function getDefaultStore(): WorkItemStore {
  if (!defaultStore) {
    defaultStore = new WorkItemStore(undefined, ["payments-factory", "termcanvas-factory"]);
  }
  return defaultStore;
}

/** Resolves the injected store, falling back to the singleton. */
export function useWorkItemStore(): WorkItemStore {
  const ctx = useContext(WorkItemStoreContext);
  return ctx ?? getDefaultStore();
}

// Exposed for tests / legacy getWorkItemStore()
export function _resetDefaultStore(store?: WorkItemStore | null): void {
  defaultStore = store ?? null;
}
