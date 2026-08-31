// useCollection — SRP: puente reactivo sobre CollectionPort (sync Local | async Remote).
// DIP: ignora la procedencia de los datos; solo consume la interfaz.
// O18: await MaybePromise + useSyncExternalStore para coexistencia sync/async.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { CollectionPort } from "../ports/collection.port";

export function useCollection<T>(port: CollectionPort<T>): readonly T[] {
  const version = useSyncExternalStore(
    (cb) => port.subscribe(cb),
    () => port.getVersion(),
    () => port.getVersion(),
  );

  const [items, setItems] = useState<readonly T[]>(() => {
    const maybe = port.list();
    return maybe instanceof Promise ? [] : (maybe as readonly T[]);
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const res = await Promise.resolve(port.list() as readonly T[] | Promise<readonly T[]>);
      if (!cancelled) setItems(Array.isArray(res) ? res : []);
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, version]);

  void version;
  return items;
}
