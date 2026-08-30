// FactoryWorkspaceStore — SRP: CRUD + selección de factories.
// Observer (igual que WorkItemStore): Map + Set<listener> + version.
// DIP: persistencia inyectada por puerto; sin localStorage directo; el reloj se inyecta.
// Source: WarpFactories.md §2, §10 Deletion · US-001, US-002, US-005
// ADR-003: DEFAULT_FACTORY_SEED=[] + detectLegacySeeds() + soft migration

import { ParseResult } from "../domain/result";
import { enforceSinglePolicy } from "../domain/factory.policy";
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
 * ADR-003 P0-2: cero absoluto — sin seeds.
 * DEFAULT_FACTORY_SEED=[] es hard removal; tests y devs con legacy storage
 * son migrados por detectLegacySeeds() en hydrate().
 */
export const DEFAULT_FACTORY_SEED: readonly FactoryRecord[] = [];

/**
 * Legacy seeds que se detectan para migración soft.
 * Estos son los nombres hardcodeados históricos que deben desaparecer.
 */
export const LEGACY_SEED_NAMES = ["payments-factory", "termcanvas-factory"] as const;
export const LEGACY_SEED_UID_PREFIXES = ["uid_payments-factory_", "uid_termcanvas-factory_"] as const;

/**
 * Detecta si un record es uno de los seeds legacy.
 * Criterio ADR-003 Q5: name ∈ seeds && repositories ⊆ acme/* && uid prefix match
 */
export function isLegacySeedRecord(record: FactoryRecord): boolean {
  const isLegacyName = (LEGACY_SEED_NAMES as readonly string[]).includes(record.name);
  if (!isLegacyName) return false;
  const hasLegacyUid = LEGACY_SEED_UID_PREFIXES.some((p) => record.uid.startsWith(p));
  if (!hasLegacyUid) return false;
  // Repos deben ser acme/* si existen (o vacío)
  if (record.repositories.length > 0) {
    const allAcme = record.repositories.every((r) => r.owner === "acme");
    if (!allAcme) return false;
  }
  return true;
}

export function detectLegacySeeds(factories: readonly FactoryRecord[]): boolean {
  return factories.some(isLegacySeedRecord);
}

/**
 * Clasifica el payload para decidir estrategia de migración soft:
 * - "only-seeds" → solo seeds legacy (silent clear a [])
 * - "mixed" → seeds + factories de usuario (requiere banner confirmar)
 * - "none" → sin seeds
 */
export function classifyLegacyPayload(factories: readonly FactoryRecord[]): "only-seeds" | "mixed" | "none" {
  if (factories.length === 0) return "none";
  const hasLegacy = factories.some(isLegacySeedRecord);
  if (!hasLegacy) return "none";
  const allLegacy = factories.every(isLegacySeedRecord);
  return allLegacy ? "only-seeds" : "mixed";
}

/**
 * Filtra los seeds legacy dejando solo factories de usuario.
 */
export function stripLegacySeeds(factories: readonly FactoryRecord[]): readonly FactoryRecord[] {
  return factories.filter((r) => !isLegacySeedRecord(r));
}

export class FactoryWorkspaceStore {
  private factories = new Map<string, FactoryRecord>();
  private order: string[] = [];
  private selectedUid = "";
  private listeners = new Set<() => void>();
  private version = 0;
  private port: KeyValuePort;
  private now: () => string;
  /** Si la última hidratación detectó mixed legacy+user */
  private pendingLegacyMixed: readonly FactoryRecord[] | null = null;

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
    if (v2) {
      const classification = classifyLegacyPayload(v2.factories);
      if (classification === "only-seeds") {
        // Silent clear: payload solo tenía seeds → limpiar a vacío
        this.factories.clear();
        this.order = [];
        this.selectedUid = "";
        this.persist();
        return;
      }
      if (classification === "mixed") {
        // Guardar pending para banner; por ahora mantener todo pero marcar pending
        this.pendingLegacyMixed = v2.factories;
        // No auto-clear; UI mostrará banner. Cargar todo por ahora.
        for (const record of v2.factories) {
          this.factories.set(record.uid, record);
          this.order.push(record.uid);
        }
        this.selectedUid = this.factories.has(v2.selectedUid) ? v2.selectedUid : (this.order[0] ?? "");
        return;
      }
      // No legacy o ya limpio
      if (v2.factories.length > 0) {
        for (const record of v2.factories) {
          this.factories.set(record.uid, record);
          this.order.push(record.uid);
        }
        this.selectedUid = this.factories.has(v2.selectedUid) ? v2.selectedUid : (this.order[0] ?? "");
        return;
      }
      // V2 existe pero vacío explícito (cero absoluto) → respetar vacío, no caer a seed
      if (v2.factories.length === 0) {
        this.selectedUid = "";
        this.persistV2(v2);
        return;
      }
    }
    // 2. Si solo hay V1, migrar en memoria, escribir V2 y mantener V1 no destructivo
    const rawV1 = this.port.read(WORKSPACE_STORAGE_KEY);
    if (rawV1) {
      const migrated = migrateIfNeeded(rawV1);
      if (migrated) {
        const classification = classifyLegacyPayload(migrated.factories);
        if (classification === "only-seeds") {
          this.factories.clear();
          this.order = [];
          this.selectedUid = "";
          this.persist();
          return;
        }
        if (classification === "mixed") {
          this.pendingLegacyMixed = migrated.factories;
          for (const record of migrated.factories) {
            this.factories.set(record.uid, record);
            this.order.push(record.uid);
          }
          this.selectedUid = this.factories.has(migrated.selectedUid)
            ? migrated.selectedUid
            : (this.order[0] ?? "");
          this.persistV2(migrated);
          return;
        }
        if (migrated.factories.length > 0) {
          for (const record of migrated.factories) {
            this.factories.set(record.uid, record);
            this.order.push(record.uid);
          }
          this.selectedUid = this.factories.has(migrated.selectedUid)
            ? migrated.selectedUid
            : (this.order[0] ?? "");
          this.persistV2(migrated);
          return;
        }
        // V1 vacío explícito → respetar
        if (migrated.factories.length === 0) {
          this.selectedUid = "";
          this.persistV2(migrated);
          return;
        }
      }
      // Si rawV1 existe pero no es V1/V2 válido (corrupto) → caer a seed
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
      // Quota o error de storage: no throw
    }
    try {
      const v1Payload = { selectedUid: payload.selectedUid, factories: payload.factories };
      this.port.write(WORKSPACE_STORAGE_KEY, JSON.stringify(v1Payload));
    } catch {
      // best-effort
    }
  }

  /** Retorna el pending mixed legacy para que UI muestre banner */
  getPendingLegacyMixed(): readonly FactoryRecord[] | null {
    return this.pendingLegacyMixed;
  }

  /** Confirma limpieza: borra seeds legacy dejando solo user factories */
  confirmClearLegacySeeds(): void {
    if (!this.pendingLegacyMixed) return;
    const cleaned = stripLegacySeeds(this.list());
    this.factories.clear();
    this.order = [];
    for (const r of cleaned) {
      this.factories.set(r.uid, r);
      this.order.push(r.uid);
    }
    if (!this.factories.has(this.selectedUid)) {
      this.selectedUid = this.order[0] ?? "";
    }
    this.pendingLegacyMixed = null;
    this.persist();
    this.notify();
  }

  /** Conserva todo (descarta banner sin borrar) */
  dismissLegacyBanner(): void {
    this.pendingLegacyMixed = null;
  }

  /**
   * Método interno usado por `importWorkspace` para reemplazo atómico con quota handling.
   */
  public _applyImport(payload: PersistedWorkspaceV2): ParseResult<void> {
    const previous = {
      factories: this.list(),
      order: [...this.order],
      selectedUid: this.selectedUid,
    };
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
