// useFactories — SRP: puente reactivo entre FactoryWorkspaceStore y los componentes.
// DIP: el contexto inyecta el store; los componentes no lo construyen ni conocen el puerto.
// Source: WarpFactories.md §2, §10 · US-001, US-002, US-005

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { ParseResult } from "../domain/result";
import { getDefaultWorkspace } from "../store/factoryWorkspace.store";
import type { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import type { FactoryPolicy } from "../domain/factory.policy";
import type { CreateFactoryInput, FactoryRecord } from "../domain/factory.record";

export const FactoryWorkspaceContext = createContext<FactoryWorkspaceStore | null>(null);

export interface FactoryWorkspaceApi {
  readonly factories: readonly FactoryRecord[];
  readonly selected: FactoryRecord | undefined;
  select(uid: string): void;
  create(input: CreateFactoryInput): ParseResult<FactoryRecord>;
  setPolicy(uid: string, policy: FactoryPolicy): ParseResult<FactoryRecord>;
  remove(uid: string): ParseResult<void>;
  readonly store: FactoryWorkspaceStore;
}

/** Resuelve el store inyectado, cayendo al singleton cuando no hay Provider. */
export function useFactoryWorkspaceStore(): FactoryWorkspaceStore {
  const ctx = useContext(FactoryWorkspaceContext);
  return ctx ?? getDefaultWorkspace();
}

/** Lista + selección + mutaciones, reactivas vía `useSyncExternalStore`. */
export function useFactoryWorkspace(): FactoryWorkspaceApi {
  const store = useFactoryWorkspaceStore();

  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const getVersion = useCallback(() => store.getVersion(), [store]);
  const version = useSyncExternalStore(subscribe, getVersion);

  // `version` es el marcador de reactividad: sin él el memo no se revalida.
  const factories = useMemo(() => {
    void version;
    return store.list();
  }, [store, version]);

  const selected = useMemo(() => {
    void version;
    return store.getSelected();
  }, [store, version]);

  const select = useCallback((uid: string) => store.select(uid), [store]);
  const create = useCallback((input: CreateFactoryInput) => store.create(input), [store]);
  const setPolicy = useCallback(
    (uid: string, policy: FactoryPolicy) => store.setPolicy(uid, policy),
    [store]
  );
  const remove = useCallback((uid: string) => store.remove(uid), [store]);

  return { factories, selected, select, create, setPolicy, remove, store };
}

/** Factory actualmente abierta; `undefined` si el workspace está vacío. */
export function useSelectedFactory(): FactoryRecord | undefined {
  return useFactoryWorkspace().selected;
}

/** Alta de factories. El store ya valida; este hook solo expone la operación. */
export function useCreateFactory(): (input: CreateFactoryInput) => ParseResult<FactoryRecord> {
  return useFactoryWorkspace().create;
}
