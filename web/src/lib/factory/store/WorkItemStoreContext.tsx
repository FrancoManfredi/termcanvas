// WorkItemStoreProvider — SRP: injects a WorkItemStore through React context (DIP).
// Source: WarpFactories.md §10

import type { ReactNode } from "react";
import type { WorkItemStore } from "./workItem.store";
import { WorkItemStoreContext, getDefaultStore } from "./workItemStore.context";

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
