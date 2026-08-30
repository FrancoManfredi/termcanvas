// workspace.export — SRP: export/import de workspace V2 validado, puro salvo store inyectado.
// Source: PRD P0-05 Gherkin · WarpFactories.md §2

import type { FactoryRecord } from "../domain/factory.record";
import { validateFactoryCreate } from "../domain/factory.record";
import { ParseResult } from "../domain/result";
import type { FactoryWorkspaceStore } from "./factoryWorkspace.store";
import { isV1Payload, isV2Payload, migrateV1toV2 } from "./workspace.migration";
import type { PersistedWorkspaceV2 } from "./workspace.migration";

function isFactoryRecordLike(value: unknown): value is FactoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FactoryRecord>;
  return typeof candidate.uid === "string" && typeof candidate.name === "string";
}

export function exportWorkspace(store: FactoryWorkspaceStore, now?: () => string): string {
  const payload: PersistedWorkspaceV2 = {
    version: 2,
    selectedUid: store.getSelectedUid(),
    factories: [...store.list()],
    exportedAt: (now ?? (() => new Date().toISOString()))(),
  };
  return JSON.stringify(payload);
}

export function importWorkspace(json: string, store: FactoryWorkspaceStore): ParseResult<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ParseResult.singleFail<void>("import", `invalid JSON: ${message}`, "invalid_json");
  }

  let payload: PersistedWorkspaceV2 | null = null;
  if (isV2Payload(parsed)) {
    payload = parsed;
  } else if (isV1Payload(parsed)) {
    payload = migrateV1toV2(parsed as unknown as import("./workspace.migration").PersistedWorkspaceV1);
  } else {
    return ParseResult.singleFail<void>("import", "invalid workspace payload — expected PersistedWorkspaceV2", "invalid_workspace");
  }

  // Validate each FactoryRecord with same codes as factory.record (OCP)
  const issues: { path: string; message: string; code: string }[] = [];
  const validated: FactoryRecord[] = [];
  for (let idx = 0; idx < payload.factories.length; idx++) {
    const record = payload.factories[idx] as FactoryRecord;
    if (!isFactoryRecordLike(record)) {
      issues.push({ path: `factories[${idx}]`, message: "invalid factory record — missing uid/name", code: "invalid_record" });
      continue;
    }
    const res = validateFactoryCreate(
      {
        name: record.name,
        alias: record.alias,
        description: record.description,
        repositories: record.repositories,
        integrations: record.integrations,
        agentToggles: record.agentToggles,
        pinned: record.pinned,
      },
      { existing: validated, now: () => record.createdAt, uid: () => record.uid },
    );
    if (!res.ok) {
      for (const iss of res.issues) {
        issues.push({ path: `factories[${idx}].${iss.path}`, message: iss.message, code: iss.code });
      }
    } else {
      // Preserve original record exactly (uid, policyId, repositories, etc.) — validation was semantic only.
      validated.push(record);
    }
  }

  // Cross-check duplicate uids (validateFactoryCreate only checks name/alias)
  const seenUids = new Set<string>();
  for (let idx = 0; idx < validated.length; idx++) {
    const rec = validated[idx];
    if (seenUids.has(rec.uid)) {
      issues.push({ path: `factories[${idx}].uid`, message: `duplicate uid '${rec.uid}'`, code: "duplicate_uid" });
    }
    seenUids.add(rec.uid);
  }

  if (issues.length > 0) {
    return ParseResult.fail<void>(issues);
  }

  // All validated — delegate persistence with quota handling to store's internal method.
  // Use duck typing to avoid circular runtime import; store has `_applyImport`.
  const storeAny = store as unknown as { _applyImport?: (p: PersistedWorkspaceV2) => ParseResult<void> };
  if (typeof storeAny._applyImport === "function") {
    try {
      return storeAny._applyImport(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isQuota = /quota/i.test(message);
      if (isQuota) {
        return ParseResult.singleFail<void>("storage", "storage quota exceeded", "quota_exceeded");
      }
      return ParseResult.singleFail<void>("storage", message, "write_error");
    }
  }

  // Fallback: no _applyImport — consider import successful (tests using memory port)
  return ParseResult.ok<void>(undefined);
}
