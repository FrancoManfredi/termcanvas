// workspace.migration — SRP: migración pura v1→v2, sin I/O ni React.
// Source: WarpFactories.md §2 · D7 · PRD P0-05

import type { FactoryRecord } from "../domain/factory.record";
import { WORKSPACE_STORAGE_KEY_V2 as V2_KEY } from "./storage.port";

export const WORKSPACE_STORAGE_KEY_V2 = V2_KEY;

export interface PersistedWorkspaceV1 {
  readonly selectedUid: string;
  readonly factories: readonly FactoryRecord[];
}

export interface PersistedWorkspaceV2 {
  readonly version: 2;
  readonly selectedUid: string;
  readonly factories: readonly FactoryRecord[];
  readonly exportedAt?: string;
}

function isFactoryRecordLike(value: unknown): value is FactoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FactoryRecord>;
  return typeof candidate.uid === "string" && typeof candidate.name === "string";
}

export function isV1Payload(value: unknown): value is PersistedWorkspaceV1 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if ("version" in candidate) return false;
  if (typeof candidate.selectedUid !== "string") return false;
  if (!Array.isArray(candidate.factories)) return false;
  // V1 may be empty factories but we allow — hydrate will treat empty as seed fallback elsewhere
  // Validate at least elements look like records if non-empty
  if (candidate.factories.length > 0) {
    return (candidate.factories as unknown[]).every(isFactoryRecordLike);
  }
  return true;
}

export function isV2Payload(value: unknown): value is PersistedWorkspaceV2 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 2) return false;
  if (typeof candidate.selectedUid !== "string") return false;
  if (!Array.isArray(candidate.factories)) return false;
  if (candidate.factories.length > 0) {
    const factories = candidate.factories as unknown[];
    if (!factories.every(isFactoryRecordLike)) return false;
  }
  if ("exportedAt" in candidate && candidate.exportedAt !== undefined && typeof candidate.exportedAt !== "string") {
    return false;
  }
  return true;
}

export function migrateV1toV2(v1: PersistedWorkspaceV1, now?: () => string): PersistedWorkspaceV2 {
  return {
    version: 2,
    selectedUid: v1.selectedUid,
    factories: v1.factories,
    exportedAt: now ? now() : new Date().toISOString(),
  };
}

/**
 * Intenta parsear `raw` y migrar si es V1. Retorna V2 o null (null → seed).
 * Puro: no toca storage, solo transforma.
 */
export function migrateIfNeeded(raw: string | null): PersistedWorkspaceV2 | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isV2Payload(parsed)) return parsed;
    if (isV1Payload(parsed)) return migrateV1toV2(parsed);
    return null;
  } catch {
    return null;
  }
}
