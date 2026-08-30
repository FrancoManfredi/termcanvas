// FactoryWorkspaceStore — SRP: CRUD + selección de factories.
// Observer (igual que WorkItemStore): Map + Set<listener> + version.
// DIP: persistencia inyectada por puerto; sin localStorage directo; el reloj se inyecta.
// Source: WarpFactories.md §2, §10 Deletion · US-001, US-002, US-005

import { ParseResult } from "../domain/result";
import { DEFAULT_POLICY, enforceSinglePolicy } from "../domain/factory.policy";
import type { FactoryPolicy } from "../domain/factory.policy";
import { validateFactoryCreate, renameFactory } from "../domain/factory.record";
import type { CreateFactoryInput, FactoryRecord, FactorySummary } from "../domain/factory.record";
import {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY_V2,
  createMemoryPort,
  writeJson,
} from "./storage.port";
import type { KeyValuePort } from "./storage.port";
import { isV2Payload, migrateIfNeeded } from "./workspace.migration";
import type { PersistedWorkspaceV2 } from "./workspace.migration";
import { exportWorkspace, importWorkspace } from "./workspace.export";

/**
 * Seed por defecto. Replica exactamente los dos nombres de `workItemStore.context.ts`
 * para que ningún test existente cambie de comportamiento (R4).
 */
export const DEFAULT_FACTORY_SEED: readonly FactoryRecord[] = [
  {
    uid: "uid_payments-factory_1",
    name: "payments-factory",
    alias: "payments-factory",
    description: "Processes approved work for the payments service",
    repositories: [
      { owner: "acme", name: "payments-service" },
      { owner: "acme", name: "payments-api" },
    ],
    integrations: ["slack"],
    agentToggles: { triage: true, spec: true, implement: true, review: true },
    policyId: DEFAULT_POLICY.id,
    createdAt: "2026-08-18T00:00:00.000Z",
    pinned: true,
  },
  {
    uid: "uid_termcanvas-factory_2",
    name: "termcanvas-factory",
    alias: "termcanvas-factory",
    description: "Owns the TermCanvas web app surface",
    repositories: [{ owner: "acme", name: "termcanvas-web" }],
    integrations: [],
    agentToggles: { triage: true, spec: true, implement: true, review: true },
    policyId: DEFAULT_POLICY.id,
    createdAt: "2026-08-18T00:00:01.000Z",
  },
];

export class FactoryWorkspaceStore {
  private factories = new Map<string, FactoryRecord>();
  private order: string[] = [];
  private selectedUid = "";
  private listeners = new Set<() => void>();
  private version = 0;
  private port: KeyValuePort;
  private now: () => string;

  constructor(
    port: KeyValuePort = createMemoryPort(),
    seed: readonly FactoryRecord[] = DEFAULT_FACTORY_SEED,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.port = port;
    this.now = now;
    this.hydrate(seed);
  }

  // ——— hidratación / persistencia ———

  private hydrate(seed: readonly FactoryRecord[]): void {
    // 1. Intentar leer V2 si existe (prioridad)
    const v2 = this.readPersistedV2();
    if (v2 && v2.factories.length > 0) {
      for (const record of v2.factories) {
        this.factories.set(record.uid, record);
        this.order.push(record.uid);
      }
      this.selectedUid = this.factories.has(v2.selectedUid) ? v2.selectedUid : (this.order[0] ?? "");
      return;
    }
    // 2. Si solo hay V1, migrar en memoria, escribir V2 y mantener V1 no destructivo
    const rawV1 = this.port.read(WORKSPACE_STORAGE_KEY);
    if (rawV1) {
      const migrated = migrateIfNeeded(rawV1);
      if (migrated && migrated.factories.length > 0) {
        for (const record of migrated.factories) {
          this.factories.set(record.uid, record);
          this.order.push(record.uid);
        }
        this.selectedUid = this.factories.has(migrated.selectedUid)
          ? migrated.selectedUid
          : (this.order[0] ?? "");
        // Persistir a V2 sin borrar V1
        this.persistV2(migrated);
        return;
      }
      // Si rawV1 existe pero no es V1/V2 válido (corrupto) → caer a seed
      // No propagar error, mantener OCP
    }
    for (const record of seed) {
      this.factories.set(record.uid, record);
      this.order.push(record.uid);
    }
    this.selectedUid = this.order[0] ?? "";
    this.persist();
  }

  private readPersistedV2(): PersistedWorkspaceV2 | null {
    const raw = this.port.read(WORKSPACE_STORAGE_KEY_V2);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isV2Payload(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const payload: PersistedWorkspaceV2 = {
      version: 2,
      selectedUid: this.selectedUid,
      factories: this.list(),
      exportedAt: this.now(),
    };
    this.persistV2(payload);
  }

  private persistV2(payload: PersistedWorkspaceV2): void {
    try {
      this.port.write(WORKSPACE_STORAGE_KEY_V2, JSON.stringify(payload));
    } catch {
      // Quota o error de storage: no throw, la app sigue en memoria (DIP)
      // Import con quota reporta via _applyImport, no via persistV2
    }
    // Compatibilidad R13: mantener V1 actualizado best-effort (dual-write)
    try {
      const v1Payload = { selectedUid: payload.selectedUid, factories: payload.factories };
      this.port.write(WORKSPACE_STORAGE_KEY, JSON.stringify(v1Payload));
    } catch {
      // best-effort, no throw
    }
  }

  /**
   * Método interno usado por `importWorkspace` para reemplazo atómico con quota handling.
   * No es parte del API público estable, pero es estable para el puerto de persistencia.
   */
  public _applyImport(payload: PersistedWorkspaceV2): ParseResult<void> {
    const previous = {
      factories: this.list(),
      order: [...this.order],
      selectedUid: this.selectedUid,
    };
    // Mutar en memoria
    this.factories.clear();
    this.order = [];
    for (const record of payload.factories) {
      this.factories.set(record.uid, record);
      this.order.push(record.uid);
    }
    this.selectedUid = this.factories.has(payload.selectedUid)
      ? payload.selectedUid
      : (this.order[0] ?? "");

    const toPersist: PersistedWorkspaceV2 = {
      version: 2,
      selectedUid: this.selectedUid,
      factories: this.list(),
      exportedAt: payload.exportedAt ?? this.now(),
    };

    const result = writeJson(this.port, WORKSPACE_STORAGE_KEY_V2, toPersist);
    if (!result.ok) {
      // Rollback
      this.factories.clear();
      this.order = [];
      for (const record of previous.factories) {
        this.factories.set(record.uid, record);
        this.order.push(record.uid);
      }
      this.selectedUid = previous.selectedUid;
      if (result.quotaExceeded) {
        return ParseResult.singleFail<void>("storage", "storage quota exceeded", "quota_exceeded");
      }
      return ParseResult.singleFail<void>("storage", result.message, "write_error");
    }
    // Best-effort dual-write a V1 para compatibilidad legacy
    try {
      const v1Payload = { selectedUid: toPersist.selectedUid, factories: toPersist.factories };
      this.port.write(WORKSPACE_STORAGE_KEY, JSON.stringify(v1Payload));
    } catch {
      // best-effort
    }
    this.notify();
    return ParseResult.ok<void>(undefined);
  }

  // ——— export/import público (delega a workspace.export) ———

  public exportJSON(now?: () => string): string {
    return exportWorkspace(this, now);
  }

  public importJSON(json: string): ParseResult<void> {
    return importWorkspace(json, this);
  }

  // ——— observer ———

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version += 1;
    for (const cb of [...this.listeners]) cb();
  }

  // ——— lectura ———

  list(): readonly FactoryRecord[] {
    const out: FactoryRecord[] = [];
    for (const uid of this.order) {
      const record = this.factories.get(uid);
      if (record) out.push(record);
    }
    return out;
  }

  getByUid(uid: string): FactoryRecord | undefined {
    return this.factories.get(uid);
  }

  /** Búsqueda case-insensitive: la unicidad del nombre es case-insensitive (US-002). */
  getByName(name: string): FactoryRecord | undefined {
    const lower = name.toLowerCase();
    return this.list().find((r) => r.name.toLowerCase() === lower);
  }

  getSelectedUid(): string {
    return this.selectedUid;
  }

  getSelected(): FactoryRecord | undefined {
    return this.factories.get(this.selectedUid);
  }

  /** Forma reducida para G2 (Factory API). */
  toSummaries(): readonly FactorySummary[] {
    return this.list().map((r) => ({
      uid: r.uid,
      name: r.name,
      alias: r.alias,
      repositoryCount: r.repositories.length,
      integrationCount: r.integrations.length,
      policyId: r.policyId,
      createdAt: r.createdAt,
    }));
  }

  // ——— escritura ———

  select(uid: string): void {
    if (!this.factories.has(uid)) return;
    if (this.selectedUid === uid) return;
    this.selectedUid = uid;
    this.persist();
    this.notify();
  }

  create(input: CreateFactoryInput): ParseResult<FactoryRecord> {
    const result = validateFactoryCreate(input, { existing: this.list(), now: this.now });
    if (!result.ok || result.value === undefined) {
      return ParseResult.fail<FactoryRecord>(result.issues);
    }
    const record = result.value;
    this.factories.set(record.uid, record);
    this.order.push(record.uid);
    this.selectedUid = record.uid;
    this.persist();
    this.notify();
    return ParseResult.ok(record);
  }

  update(uid: string, patch: Partial<CreateFactoryInput>): ParseResult<FactoryRecord> {
    const current = this.factories.get(uid);
    if (!current) {
      return ParseResult.singleFail<FactoryRecord>(uid, `factory '${uid}' not found`, "not_found");
    }
    const result = renameFactory(current, patch, this.list());
    if (!result.ok || result.value === undefined) {
      return ParseResult.fail<FactoryRecord>(result.issues);
    }
    this.factories.set(uid, result.value);
    this.persist();
    this.notify();
    return result;
  }

  setPolicy(uid: string, policy: FactoryPolicy): ParseResult<FactoryRecord> {
    const current = this.factories.get(uid);
    if (!current) {
      return ParseResult.singleFail<FactoryRecord>(uid, `factory '${uid}' not found`, "not_found");
    }
    const result = enforceSinglePolicy(current, policy);
    if (!result.ok || result.value === undefined) {
      return ParseResult.fail<FactoryRecord>(result.issues);
    }
    this.factories.set(uid, result.value);
    this.persist();
    this.notify();
    return result;
  }

  togglePinned(uid: string): ParseResult<FactoryRecord> {
    const current = this.factories.get(uid);
    if (!current) {
      return ParseResult.singleFail<FactoryRecord>(uid, `factory '${uid}' not found`, "not_found");
    }
    const next: FactoryRecord = { ...current, pinned: !(current.pinned ?? false) };
    this.factories.set(uid, next);
    this.persist();
    this.notify();
    return ParseResult.ok(next);
  }

  /** §10 Deletion — irreversible: borra el record y re-selecciona el primero disponible. */
  remove(uid: string): ParseResult<void> {
    if (!this.factories.has(uid)) {
      return ParseResult.singleFail<void>(uid, `factory '${uid}' not found`, "not_found");
    }
    this.factories.delete(uid);
    this.order = this.order.filter((id) => id !== uid);
    if (this.selectedUid === uid) {
      this.selectedUid = this.order[0] ?? "";
    }
    this.persist();
    this.notify();
    return ParseResult.ok<void>(undefined);
  }

  /** Test seam: descarta el singleton por defecto. */
  static _reset(): void {
    _resetDefaultWorkspace();
  }
}

let defaultWorkspace: FactoryWorkspaceStore | null = null;

/** Singleton de proceso — mismo patrón que `getDefaultStore()`. */
export function getDefaultWorkspace(): FactoryWorkspaceStore {
  if (!defaultWorkspace) {
    defaultWorkspace = new FactoryWorkspaceStore();
  }
  return defaultWorkspace;
}

/** Inyecta (o descarta con `null`) el singleton; usado por `main.tsx` y por los tests. */
export function _resetDefaultWorkspace(store?: FactoryWorkspaceStore | null): void {
  defaultWorkspace = store ?? null;
}
