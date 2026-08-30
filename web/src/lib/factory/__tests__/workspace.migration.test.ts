// workspace.migration.test.ts — SRP: P0-05 persistencia LOCAL robusta
// Source: WarpFactories.md §2 · PRD P0-05 · PLAN Ola 6

import { describe, it, expect, beforeEach } from "vitest";
import { FactoryWorkspaceStore, DEFAULT_FACTORY_SEED, _resetDefaultWorkspace } from "../store/factoryWorkspace.store";
import { WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_KEY_V2, createMemoryPort } from "../store/storage.port";
import type { KeyValuePort } from "../store/storage.port";
import { isV1Payload, isV2Payload, migrateV1toV2, migrateIfNeeded } from "../store/workspace.migration";
import { exportWorkspace, importWorkspace } from "../store/workspace.export";
import { _resetUidSeq } from "../domain/factory.record";
import { WorkItemStore } from "../store/workItem.store";

function makeQuotaPort(): KeyValuePort {
  return {
    read(_key: string): string | null {
      return null;
    },
    write(_key: string, _value: string): void {
      const error = new Error("QuotaExceededError: storage quota exceeded");
      (error as unknown as { name: string }).name = "QuotaExceededError";
      throw error;
    },
  };
}

beforeEach(() => {
  _resetUidSeq();
  _resetDefaultWorkspace();
  WorkItemStore._resetIdSeq();
});

describe("P0-05 — Persistencia LOCAL robusta", () => {
  describe("isV1Payload / isV2Payload — type guards puros", () => {
    it("detecta V1 sin version y V2 con version 2", () => {
      const v1 = { selectedUid: "uid_1", factories: [] };
      const v2 = { version: 2 as const, selectedUid: "uid_1", factories: [] };
      expect(isV1Payload(v1)).toBe(true);
      expect(isV2Payload(v1)).toBe(false);
      expect(isV2Payload(v2)).toBe(true);
      expect(isV1Payload(v2)).toBe(false);
    });

    it("rechaza payloads corruptos", () => {
      expect(isV1Payload(null)).toBe(false);
      expect(isV2Payload(null)).toBe(false);
      expect(isV1Payload({ factories: [] } as unknown)).toBe(false);
      expect(isV2Payload({ version: 2, selectedUid: 123, factories: [] } as unknown)).toBe(false);
      expect(isV2Payload({ version: 1, selectedUid: "a", factories: [] } as unknown)).toBe(false);
    });
  });

  describe("migrateV1toV2 — determinista", () => {
    it("migra V1 a V2 preservando factories y selectedUid y añadiendo exportedAt", () => {
      const v1 = {
        selectedUid: "uid_payments-factory_1",
        factories: [...DEFAULT_FACTORY_SEED],
      };
      const fixedNow = () => "2026-08-30T12:00:00.000Z";
      const v2 = migrateV1toV2(v1, fixedNow);
      expect(v2.version).toBe(2);
      expect(v2.selectedUid).toBe(v1.selectedUid);
      expect(v2.factories).toEqual(v1.factories);
      expect(v2.exportedAt).toBe("2026-08-30T12:00:00.000Z");
      // Determinista: segunda llamada mismo now produce mismo resultado
      expect(migrateV1toV2(v1, fixedNow)).toEqual(v2);
    });
  });

  describe("migrateIfNeeded — null → seed", () => {
    it("retorna null para null, JSON inválido o payload desconocido", () => {
      expect(migrateIfNeeded(null)).toBeNull();
      expect(migrateIfNeeded("{ not json")).toBeNull();
      expect(migrateIfNeeded(JSON.stringify({ foo: "bar" }))).toBeNull();
    });

    it("retorna V2 directo si ya es V2 y migra V1 a V2 si es V1", () => {
      const v1 = { selectedUid: "uid_1", factories: [...DEFAULT_FACTORY_SEED] };
      const rawV1 = JSON.stringify(v1);
      const migrated = migrateIfNeeded(rawV1);
      expect(migrated).not.toBeNull();
      expect(migrated?.version).toBe(2);
      expect(migrated?.factories).toHaveLength(2);

      const v2 = { version: 2 as const, selectedUid: "uid_1", factories: [...DEFAULT_FACTORY_SEED], exportedAt: "2026-08-30T00:00:00.000Z" };
      const rawV2 = JSON.stringify(v2);
      expect(migrateIfNeeded(rawV2)).toEqual(v2);
    });
  });

  describe("Escenario: Exporto y reimporto — idéntico (Gherkin P0-05)", () => {
    it("export→import preserva 3 factories idénticas en otro port", () => {
      const portA = createMemoryPort();
      const storeA = new FactoryWorkspaceStore(portA, [], () => "2026-08-30T00:00:00.000Z");
      storeA.create({ name: "alpha-factory" });
      storeA.create({ name: "beta-factory" });
      storeA.create({ name: "gamma-factory" });
      expect(storeA.list()).toHaveLength(3);

      const json = exportWorkspace(storeA, () => "2026-08-30T12:00:00.000Z");
      const parsed = JSON.parse(json) as { version: number; exportedAt: string; factories: unknown[] };
      expect(parsed.version).toBe(2);
      expect(parsed.exportedAt).toBe("2026-08-30T12:00:00.000Z");
      expect(parsed.factories).toHaveLength(3);

      const portB = createMemoryPort();
      const storeB = new FactoryWorkspaceStore(portB, []);
      const result = importWorkspace(json, storeB);
      expect(result.ok).toBe(true);
      expect(storeB.list().map((f) => f.name)).toEqual(storeA.list().map((f) => f.name));
      expect(storeB.list()).toEqual(storeA.list());
      expect(storeB.getSelectedUid()).toBe(storeA.getSelectedUid());
    });
  });

  describe("Escenario: pin/policy preservados en export/import", () => {
    it("preserva pinned y policyId tras roundtrip", () => {
      const port = createMemoryPort();
      const store = new FactoryWorkspaceStore(port, [], () => "2026-08-30T00:00:00.000Z");
      const a = store.create({ name: "pinned-factory", pinned: true });
      expect(a.ok).toBe(true);
      const uid = a.value?.uid ?? "";
      // togglePinned ya está cubierto, pero verificamos que export lo preserva
      expect(store.getByUid(uid)?.pinned).toBe(true);
      expect(store.getByUid(uid)?.policyId).toBe("default");

      const json = store.exportJSON(() => "2026-08-30T12:00:00.000Z");
      const port2 = createMemoryPort();
      const store2 = new FactoryWorkspaceStore(port2, []);
      const imported = store2.importJSON(json);
      expect(imported.ok).toBe(true);
      expect(store2.getByUid(uid)?.pinned).toBe(true);
      expect(store2.getByUid(uid)?.policyId).toBe("default");
      // También repositories
      const withRepo = new FactoryWorkspaceStore(createMemoryPort(), [], () => "2026-08-30T00:00:00.000Z");
      withRepo.create({ name: "repo-factory", repositories: [{ owner: "acme", name: "svc" }] });
      const json2 = withRepo.exportJSON();
      const withRepo2 = new FactoryWorkspaceStore(createMemoryPort(), []);
      expect(withRepo2.importJSON(json2).ok).toBe(true);
      expect(withRepo2.list()[0]?.repositories).toEqual([{ owner: "acme", name: "svc" }]);
    });
  });

  describe("Escenario: migración v1→v2 no destructiva", () => {
    it("hydrate lee V2 si existe, ignora V1", () => {
      const v2Payload = {
        version: 2 as const,
        selectedUid: "uid_payments-factory_1",
        factories: [...DEFAULT_FACTORY_SEED],
        exportedAt: "2026-08-30T00:00:00.000Z",
      };
      const v1Payload = {
        selectedUid: "other",
        factories: [{ uid: "uid_other", name: "other", alias: "other", repositories: [], integrations: [], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-30T00:00:00.000Z" }],
      };
      const port = createMemoryPort({
        [WORKSPACE_STORAGE_KEY_V2]: JSON.stringify(v2Payload),
        [WORKSPACE_STORAGE_KEY]: JSON.stringify(v1Payload),
      });
      const store = new FactoryWorkspaceStore(port, []);
      // Debe leer V2, no V1
      expect(store.list().map((f) => f.name)).toEqual(["payments-factory", "termcanvas-factory"]);
      // V1 se mantiene (no borrado)
      expect(port.read(WORKSPACE_STORAGE_KEY)).not.toBeNull();
      expect(port.read(WORKSPACE_STORAGE_KEY_V2)).not.toBeNull();
    });

    it("si solo hay V1, migra en memoria, escribe V2 y mantiene V1", () => {
      const v1Payload = {
        selectedUid: "uid_payments-factory_1",
        factories: [...DEFAULT_FACTORY_SEED],
      };
      const port = createMemoryPort({
        [WORKSPACE_STORAGE_KEY]: JSON.stringify(v1Payload),
      });
      expect(port.read(WORKSPACE_STORAGE_KEY_V2)).toBeNull();
      const store = new FactoryWorkspaceStore(port, []);
      expect(store.list()).toHaveLength(2);
      // Debe haber escrito V2
      const rawV2 = port.read(WORKSPACE_STORAGE_KEY_V2);
      expect(rawV2).not.toBeNull();
      const parsedV2 = rawV2 ? (JSON.parse(rawV2) as { version: number }) : null;
      expect(parsedV2?.version).toBe(2);
      // V1 se mantiene
      expect(port.read(WORKSPACE_STORAGE_KEY)).not.toBeNull();
    });
  });

  describe("Escenario: snapshot corrupto → seed", () => {
    it("corrupto en ambos keys cae al seed sin throw", () => {
      const port = createMemoryPort({
        [WORKSPACE_STORAGE_KEY]: "{ esto no es json",
        [WORKSPACE_STORAGE_KEY_V2]: "{ tampoco }",
      });
      const store = new FactoryWorkspaceStore(port, DEFAULT_FACTORY_SEED);
      expect(store.list().map((f) => f.name)).toEqual(["payments-factory", "termcanvas-factory"]);
    });

    it("V2 corrupto pero V1 válido → migra V1", () => {
      const v1Payload = { selectedUid: "uid_termcanvas-factory_2", factories: [...DEFAULT_FACTORY_SEED] };
      const port = createMemoryPort({
        [WORKSPACE_STORAGE_KEY_V2]: "corrupto",
        [WORKSPACE_STORAGE_KEY]: JSON.stringify(v1Payload),
      });
      const store = new FactoryWorkspaceStore(port, []);
      expect(store.list()).toHaveLength(2);
      expect(store.getSelectedUid()).toBe("uid_termcanvas-factory_2");
    });
  });

  describe("Escenario: quota exceeded → fail sin throw", () => {
    it("importWorkspace con port en quota retorna quota_exceeded y no pisa store", () => {
      const quotaPort = makeQuotaPort();
      // Necesitamos store con port normal para tener datos, luego intentar import en quotaPort
      const sourcePort = createMemoryPort();
      const source = new FactoryWorkspaceStore(sourcePort, [], () => "2026-08-30T00:00:00.000Z");
      source.create({ name: "quota-factory" });
      const json = source.exportJSON();

      const target = new FactoryWorkspaceStore(quotaPort, [], () => "2026-08-30T00:00:00.000Z");
      // target al construir con quotaPort habrá intentado persistir pero falló silencioso, queda con seed (2)
      const before = target.list().map((f) => f.name);
      const result = target.importJSON(json);
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe("quota_exceeded");
      // No pisa: debe seguir con seed
      expect(target.list().map((f) => f.name)).toEqual(before);
    });

    it("importWorkspace con store memory no lanza aunque payload sea grande", () => {
      const port = createMemoryPort();
      const store = new FactoryWorkspaceStore(port, []);
      const largeFactories = Array.from({ length: 20 }, (_, i) => ({
        uid: `uid_factory_${i}`,
        name: `factory-${i}`,
        alias: `factory-${i}`,
        repositories: [{ owner: "acme", name: `repo-${i}` }],
        integrations: [],
        agentToggles: { triage: true, spec: true, implement: true, review: true },
        policyId: "default",
        createdAt: "2026-08-30T00:00:00.000Z",
      }));
      const payload = JSON.stringify({ version: 2, selectedUid: "uid_factory_0", factories: largeFactories });
      const result = store.importJSON(payload);
      expect(result.ok).toBe(true);
      expect(store.list()).toHaveLength(20);
    });
  });

  describe("Escenario: import valida y no pisa si hay error", () => {
    it("JSON inválido no pisa", () => {
      const port = createMemoryPort();
      const store = new FactoryWorkspaceStore(port, []);
      const before = store.list().map((f) => f.uid);
      const result = store.importJSON("{ not json");
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe("invalid_json");
      expect(store.list().map((f) => f.uid)).toEqual(before);
    });

    it("payload inválido (sin version) no pisa y retorna invalid_workspace", () => {
      const port = createMemoryPort();
      const store = new FactoryWorkspaceStore(port, []);
      const before = store.list().map((f) => f.uid);
      const result = store.importJSON(JSON.stringify({ foo: "bar" }));
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe("invalid_workspace");
      expect(store.list().map((f) => f.uid)).toEqual(before);
    });

    it("factory con nombre inválido (charset) falla validación y no pisa", () => {
      const port = createMemoryPort();
      const store = new FactoryWorkspaceStore(port, []);
      const before = store.list().map((f) => f.uid);
      const bad = {
        version: 2,
        selectedUid: "uid_bad",
        factories: [
          {
            uid: "uid_bad",
            name: "bad@name!",
            alias: "bad@alias!",
            repositories: [],
            integrations: [],
            agentToggles: { triage: true, spec: true, implement: true, review: true },
            policyId: "default",
            createdAt: "2026-08-30T00:00:00.000Z",
          },
        ],
      };
      const result = store.importJSON(JSON.stringify(bad));
      expect(result.ok).toBe(false);
      expect(result.issues.some((iss) => iss.code === "name_charset" || iss.code === "alias_charset")).toBe(true);
      expect(store.list().map((f) => f.uid)).toEqual(before);
    });

    it("import acepta V1 payload via migración", () => {
      const v1 = { selectedUid: "uid_payments-factory_1", factories: [...DEFAULT_FACTORY_SEED] };
      const jsonV1 = JSON.stringify(v1);
      // fresh tiene seed; import V1 debe reemplazar
      const fresh = new FactoryWorkspaceStore(createMemoryPort(), [], () => "2026-08-30T00:00:00.000Z");
      // fresh tiene seed; import V1 debe reemplazar
      const result = fresh.importJSON(jsonV1);
      expect(result.ok).toBe(true);
      expect(fresh.list()).toHaveLength(2);
    });
  });
});
