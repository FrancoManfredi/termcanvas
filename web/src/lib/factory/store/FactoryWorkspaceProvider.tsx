// FactoryWorkspaceProvider — SRP: inyecta el FactoryWorkspaceStore por contexto y lo sincroniza.
// DIP: es la raíz de composición: recibe el store por props y el WorkItemStore por contexto.
// Source: WarpFactories.md §2, §10 · US-001, US-002

import { useEffect } from "react";
import type { ReactNode } from "react";
import { FactoryWorkspaceContext } from "../hooks/useFactories";
import { useWorkItemStore } from "./workItemStore.context";
import { getDefaultWorkspace } from "./factoryWorkspace.store";
import type { FactoryWorkspaceStore } from "./factoryWorkspace.store";

export function FactoryWorkspaceProvider({
  store,
  children,
}: {
  store?: FactoryWorkspaceStore;
  children: ReactNode;
}) {
  const workspace = store ?? getDefaultWorkspace();
  const workItems = useWorkItemStore();

  // Crear una factory no debe pisar las conocidas del WorkItemStore (R3): el alta es aditiva.
  // Suscribirse (y no solo sincronizar al montar) cubre también las factories hidratadas.
  useEffect(() => {
    const sync = () => {
      workItems.addKnownFactories(workspace.list().map((f) => f.name));
    };
    sync();
    return workspace.subscribe(sync);
  }, [workspace, workItems]);

  return (
    <FactoryWorkspaceContext.Provider value={workspace}>{children}</FactoryWorkspaceContext.Provider>
  );
}
