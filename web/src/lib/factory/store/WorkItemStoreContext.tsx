import { createContext, useContext, type ReactNode } from "react";
import { WorkItemStore } from "./workItem.store";

const WorkItemStoreContext = createContext<WorkItemStore | null>(null);

let defaultStore: WorkItemStore | null = null;

export function getDefaultStore(): WorkItemStore {
  if (!defaultStore) {
    defaultStore = new WorkItemStore(undefined, ["payments-factory", "termcanvas-factory"]);
  }
  return defaultStore;
}

export function WorkItemStoreProvider({
  store,
  children,
}: {
  store?: WorkItemStore;
  children: ReactNode;
}) {
  const value = store ?? getDefaultStore();
  return <WorkItemStoreContext.Provider value={value}>{children}</WorkItemStoreContext.Provider>;
}

export function useWorkItemStore(): WorkItemStore {
  const ctx = useContext(WorkItemStoreContext);
  return ctx ?? getDefaultStore();
}

// Exposed for tests / legacy getWorkItemStore()
export function _resetDefaultStore(store?: WorkItemStore | null): void {
  defaultStore = store ?? null;
}

export { WorkItemStoreContext };
