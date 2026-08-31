// CollectionPort — SRP/OCP: abstracción genérica de solo-lectura para colecciones de entidades.
// DIP: los hooks/componentes dependen de esta interfaz, no de MOCK_* ni de un fetch concreto.
// Hoy se satisface con createFixtureCollectionPort (datos semilla); mañana con un adapter remoto
// que implemente la misma interfaz, sin tocar los consumidores.

import type { MaybePromise } from "./factory.ports";

export interface CollectionPort<T> {
  readonly kind: string;
  list(): MaybePromise<readonly T[]>;
  subscribe(cb: () => void): () => void;
  getVersion(): number;
}

/**
 * Adaptador de colección respaldado por datos semilla (fixtures).
 * Mantiene la misma interfaz observacional que un repo remoto, de modo que
 * cambiar la fuente es solo instanciar otro `CollectionPort<T>`.
 */
export function createFixtureCollectionPort<T>(kind: string, items: readonly T[]): CollectionPort<T> {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    kind,
    list: () => items,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getVersion: () => version,
  };
}
