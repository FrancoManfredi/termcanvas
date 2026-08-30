// SRP: solo tipos de puertos repository — DIP para UI/hooks
// Source: WarpFactories.md §2 · PLAN-OLAS-WARP-FACTORIES §8.3 · Apéndice B.3
// OCP: agregar método = agregar firma sin tocar dominio existente

import type { ParseResult } from "../domain/result";
import type { CreateFactoryInput, FactoryRecord, FactorySummary } from "../domain/factory.record";
import type { CreateWorkItemInput, WorkItem, WorkItemStage } from "../domain/workItem.types";
import type { Actor, TransitionContext } from "../domain/workItem.types";

/**
 * Alias de dominio — todo port que puede fallar devuelve ParseResult.
 * Reexportado para que los consumidores importen desde ports sin acoplar a result.ts.
 */
export type PortResult<T> = ParseResult<T>;

export type MaybePromise<T> = T | Promise<T>;

/**
 * FactoryRepositoryPort — DIP: UI/hooks dependen de esta abstracción, no de FactoryWorkspaceStore.
 * Responsabilidad única: CRUD + selección + observabilidad de factories.
 * Hoy: LocalAdapter (FactoryWorkspaceStore sobre KeyValuePort/memory|localStorage).
 * Futuro: RemoteFactoryRepo (fetch /api/v1/factory con Bearer).
 *
 * Case-insensitive por contrato: getByName y unicidad via validateFactoryCreate ya lo son (US-002).
 * O16: widen a MaybePromise — Local sync, Remote async; callers siempre await.
 */
export interface FactoryRepositoryPort {
  /** Lista todas las factories en orden de creación (seed + creadas). */
  list(): MaybePromise<readonly FactoryRecord[]>;

  /** Búsqueda por uid exacta (uid_<slug>_<n>). */
  getByUid(uid: string): MaybePromise<FactoryRecord | undefined>;

  /** Búsqueda case-insensitive por name (US-002). */
  getByName(name: string): MaybePromise<FactoryRecord | undefined>;

  /** Alta validada — delega en validateFactoryCreate, persiste y notifica. */
  create(input: CreateFactoryInput): MaybePromise<PortResult<FactoryRecord>>;

  /** Update parcial (alias, description, repos) — revalida contra resto. */
  update(uid: string, patch: Partial<CreateFactoryInput>): MaybePromise<PortResult<FactoryRecord>>;

  /** Borrado irreversible (§10 Deletion) — re-selecciona primera si borra la seleccionada. */
  remove(uid: string): MaybePromise<PortResult<void>>;

  /** Forma reducida para Factory API / listados (uid, name, alias, counts). */
  toSummaries(): MaybePromise<readonly FactorySummary[]>;

  /** Observer — igual que WorkItemStore: Set<listener> + version. */
  subscribe(cb: () => void): () => void;

  /** Contador monótono para useSyncExternalStore. */
  getVersion(): number;
}

/**
 * WorkItemRepositoryPort — solo work items. OCP: agregar transición = agregar método aquí,
 * no tocar FactoryRepositoryPort.
 * Hoy: WorkItemStore (Map + WorkItemMachine, sin I/O).
 * Futuro: RemoteWorkItemRepo (fetch /api/v1/work-items).
 *
 * Nota: transition delega en WorkItemMachine.canTransition + gates humanas
 * (Planning→Building humanApproval, Reviewing→Complete reviewVerdict+handoff).
 * El parámetro ctx transporta humanApproval/reviewVerdict/handoffConfirmed/reason.
 * O16: widen a MaybePromise — Local sync, Remote async; callers siempre await.
 */
export interface WorkItemRepositoryPort {
  /** Lista work items; el caller filtra por factoryName/stage/search si lo necesita. */
  list(filter?: WorkItemFilter): MaybePromise<readonly WorkItem[]>;

  /** Búsqueda por id exacta (wi_<ts>_<seq>). */
  getById(id: string): MaybePromise<WorkItem | undefined>;

  /** Alta validada — valida factoryName contra knownFactories, título, etc. */
  create(input: CreateWorkItemInput): MaybePromise<PortResult<WorkItem>>;

  /**
   * Transición validada vía WorkItemMachine.
   * @param id - work item id
   * @param to - stage destino
   * @param actor - foreman | human | triage | spec | implement | review | system
   * @param ctx - contexto con humanApproval, reviewVerdict, handoffConfirmed, reason
   */
  transition(id: string, to: WorkItemStage, actor: Actor, ctx?: TransitionContext): MaybePromise<PortResult<WorkItem>>;

  /** Observer — mismo patrón que FactoryWorkspaceStore. */
  subscribe(cb: () => void): () => void;

  /** Versión monótona para hooks. */
  getVersion(): number;
}

export interface WorkItemFilter {
  stage?: WorkItemStage;
  createdBy?: string;
  search?: string;
  factoryName?: string;
  includeTerminals?: boolean;
}
