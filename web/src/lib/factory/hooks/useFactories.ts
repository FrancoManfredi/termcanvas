// useFactories — SRP: puente reactivo entre FactoryWorkspaceStore y los componentes.
// DIP: el contexto inyecta el store; los componentes no lo construyen ni conocen el puerto.
// Source: WarpFactories.md §2, §10 · US-001, US-002, US-005
// O18: await MaybePromise + useSyncExternalStore — Local sync y Remote async coexisten (MaybePromise widen OCP)

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ParseResult } from "../domain/result";
import { getDefaultWorkspace } from "../store/factoryWorkspace.store";
import type { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import type { FactoryPolicy } from "../domain/factory.policy";
import type { CreateFactoryInput, FactoryRecord } from "../domain/factory.record";
import type { FactoryRepositoryPort } from "../ports/factory.ports";

export const FactoryWorkspaceContext = createContext<FactoryWorkspaceStore | null>(null);

export interface FactoryWorkspaceApi {
  readonly factories: readonly FactoryRecord[];
  readonly selected: FactoryRecord | undefined;
  select(uid: string): void;
  create(input: CreateFactoryInput): ParseResult<FactoryRecord> | Promise<ParseResult<FactoryRecord>>;
  setPolicy(uid: string, policy: FactoryPolicy): ParseResult<FactoryRecord> | Promise<ParseResult<FactoryRecord>>;
  remove(uid: string): ParseResult<void> | Promise<ParseResult<void>>;
  readonly store: FactoryWorkspaceStore;
}

/** Resuelve el store inyectado, cayendo al singleton cuando no hay Provider. */
export function useFactoryWorkspaceStore(): FactoryWorkspaceStore {
  const ctx = useContext(FactoryWorkspaceContext);
  return ctx ?? getDefaultWorkspace();
}

/** Lista + selección + mutaciones, reactivas vía `useSyncExternalStore` + await MaybePromise (O18). */
export function useFactoryWorkspace(): FactoryWorkspaceApi {
  const rawStore = useFactoryWorkspaceStore();
  // Cast to port to handle MaybePromise uniformly; Local sync y Remote async via await
  const store = rawStore as unknown as FactoryRepositoryPort & FactoryWorkspaceStore;

  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const getVersion = useCallback(() => store.getVersion(), [store]);
  // useSyncExternalStore is required for O18 (reactive + SSR snapshot)
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);

  // Estado local hidratado async — await MaybePromise mantiene compat con sync Local
  const [factories, setFactories] = useState<readonly FactoryRecord[]>(() => {
    const maybe = (store as unknown as { list: () => unknown }).list();
    // Si es Promise (Remote), iniciar vacío y dejar que useEffect lo hidrate con await
    if (maybe instanceof Promise) return [];
    return maybe as readonly FactoryRecord[];
  });
  const [selected, setSelected] = useState<FactoryRecord | undefined>(() => {
    const maybe = (store as unknown as { getSelected?: () => unknown }).getSelected?.();
    if (maybe instanceof Promise) return undefined;
    return maybe as FactoryRecord | undefined;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // await MaybePromise: funciona para sync (Local) y async (Remote)
      const listRes = await Promise.resolve((store as unknown as { list: () => unknown }).list() as Promise<readonly FactoryRecord[]> | readonly FactoryRecord[]);
      const selRes = await Promise.resolve(
        (store as unknown as { getSelected?: () => unknown }).getSelected?.() as Promise<FactoryRecord | undefined> | FactoryRecord | undefined
      );
      if (!cancelled) {
        setFactories(listRes as readonly FactoryRecord[]);
        setSelected(selRes as FactoryRecord | undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, version]);

  // `version` es marcador de reactividad: fuerza memo revalidación tras notify()
  void version;

  const select = useCallback((uid: string) => (store as unknown as { select: (uid: string) => unknown }).select(uid), [store]);
  // create/setPolicy/remove retornan MaybePromise<ParseResult> — caller hace await
  const create = useCallback(
    (input: CreateFactoryInput) => (store as unknown as { create: (i: CreateFactoryInput) => unknown }).create(input) as ParseResult<FactoryRecord> | Promise<ParseResult<FactoryRecord>>,
    [store]
  );
  const setPolicy = useCallback(
    (uid: string, policy: FactoryPolicy) => (store as unknown as { setPolicy: (uid: string, p: FactoryPolicy) => unknown }).setPolicy(uid, policy) as ParseResult<FactoryRecord> | Promise<ParseResult<FactoryRecord>>,
    [store]
  );
  const remove = useCallback((uid: string) => (store as unknown as { remove: (uid: string) => unknown }).remove(uid) as ParseResult<void> | Promise<ParseResult<void>>, [store]);

  return { factories, selected, select, create, setPolicy, remove, store: rawStore };
}

/** Alias O18: useFactories — mismo que useFactoryWorkspace, expone await MaybePromise */
export function useFactories(): FactoryWorkspaceApi {
  return useFactoryWorkspace();
}

/** Factory actualmente abierta; `undefined` si el workspace está vacío. */
export function useSelectedFactory(): FactoryRecord | undefined {
  return useFactoryWorkspace().selected;
}

/** Alta de factories. El store ya valida; este hook solo expone la operación. */
export function useCreateFactory(): (input: CreateFactoryInput) => ParseResult<FactoryRecord> | Promise<ParseResult<FactoryRecord>> {
  return useFactoryWorkspace().create;
}
