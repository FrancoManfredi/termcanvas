// factoryWorkspace.test.ts — SRP: cubre los 8 escenarios Gherkin de Diseño §10 → T-B.
// DIP: el store se construye con puertos en memoria (determinista) salvo el test de R13.
// Source: WarpFactories.md §2, §10 Settings Identity, §14 Sizing · US-001, US-002, US-005, US-006
// ADR-003: DEFAULT_FACTORY_SEED=[] (cero absoluto)

import { describe, it, expect, beforeEach } from "vitest";
import {
  FactoryWorkspaceStore,
  DEFAULT_FACTORY_SEED,
  LEGACY_SEED_NAMES,
  _resetDefaultWorkspace,
} from "../store/factoryWorkspace.store";
import {
  WORKSPACE_STORAGE_KEY,
  createMemoryPort,
  createLocalStoragePort,
} from "../store/storage.port";
import {
  ALIAS_CHARSET_MESSAGE,
  FACTORY_NAME_MAX,
  suggestSeparateFactoryName,
  validateFactoryCreate,
  _resetUidSeq,
} from "../domain/factory.record";
import type { FactoryRecord } from "../domain/factory.record";
import {
  ALTERNATE_POLICIES,
  DEFAULT_POLICY,
  FACTORY_GLOSSARY,
  TWO_POLICIES_MESSAGE,
} from "../domain/factory.policy";
import { WorkItemStore } from "../store/workItem.store";
import { FactoryMcpStub } from "../mcp/mcp.stub";
import { getFactoryBundle } from "../hooks/useFactoryBundle";


/** Construye un record de semilla sin pasar por el store (uid y reloj fijos). */
function makeRecord(name: string, alias: string): FactoryRecord {
  const built = validateFactoryCreate(
    { name, alias },
    { existing: [], uid: () => `uid_${name}`, now: () => "2026-08-18T00:00:00.000Z" }
  );
  const record = built.value;
  if (record === undefined) {
    throw new Error(`semilla inválida: ${JSON.stringify(built.issues)}`);
  }
  return record;
}

beforeEach(() => {
  _resetUidSeq();
  _resetDefaultWorkspace();
  WorkItemStore._resetIdSeq();
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
});

describe("Escenario: Crear factory mínima (US-001)", () => {
  it("el alta aparece en la lista, queda seleccionada y su alias inicial es el nombre", () => {
    const store = new FactoryWorkspaceStore(createMemoryPort(), []);
    const created = store.create({ name: "payments-factory" });

    expect(created.ok).toBe(true);
    expect(created.value?.name).toBe("payments-factory");
    expect(created.value?.alias).toBe("payments-factory");
    expect(created.value?.policyId).toBe(DEFAULT_POLICY.id);
    expect(store.list().map((f) => f.name)).toEqual(["payments-factory"]);
    expect(store.getSelectedUid()).toBe(created.value?.uid);
    expect(store.getSelected()?.name).toBe("payments-factory");
    expect(store.getByName("Payments-Factory")?.uid).toBe(created.value?.uid);
  });

  it("el nombre vacío se rechaza con missing_name", () => {
    const result = validateFactoryCreate({ name: "   " }, { existing: [] });
    expect(result.issues.some((issue) => issue.code === "missing_name")).toBe(true);
  });
});

describe("Escenario: Alias inválido rechazado (US-001)", () => {
  it("usa el literal exacto de US-001", () => {
    const result = validateFactoryCreate(
      { name: "payments-factory", alias: "pay/mnts!" },
      { existing: [] }
    );
    const issue = result.issues.find((i) => i.code === "alias_charset");

    expect(result.ok).toBe(false);
    expect(issue?.message).toBe(ALIAS_CHARSET_MESSAGE);
    expect(ALIAS_CHARSET_MESSAGE).toBe("alias solo [A-Za-z0-9 ._-], max 60");
  });
});

describe("Escenario: Duplicado case-insensitive rechazado (US-002)", () => {
  it("rechaza por nombre y por alias sin distinguir mayúsculas", () => {
    const existing = [makeRecord("Payments", "Payments")];

    const byName = validateFactoryCreate({ name: "payments" }, { existing });
    expect(byName.issues.some((i) => i.code === "name_unique")).toBe(true);

    const byAlias = validateFactoryCreate({ name: "otra-factory", alias: "payments" }, { existing });
    expect(byAlias.issues.some((i) => i.code === "alias_unique")).toBe(true);

    const clean = validateFactoryCreate({ name: "otra-factory", alias: "otro-alias" }, { existing });
    expect(clean.ok).toBe(true);
  });
});

describe("Escenario: Longitud límite (US-002)", () => {
  it("61 caracteres fallan y 60 pasan, tanto en nombre como en alias", () => {
    const tooLong = "a".repeat(FACTORY_NAME_MAX + 1);
    const justLong = "a".repeat(FACTORY_NAME_MAX);

    const aliasResult = validateFactoryCreate({ name: "ok-factory", alias: tooLong }, { existing: [] });
    expect(aliasResult.issues.some((i) => i.code === "alias_length")).toBe(true);

    const nameResult = validateFactoryCreate({ name: tooLong }, { existing: [] });
    expect(nameResult.issues.some((i) => i.code === "name_length")).toBe(true);

    const okName = validateFactoryCreate({ name: justLong }, { existing: [] });
    expect(okName.issues.some((i) => i.code === "name_length")).toBe(false);

    const okAlias = validateFactoryCreate({ name: "ok-factory", alias: justLong }, { existing: [] });
    expect(okAlias.issues.some((i) => i.code === "alias_length")).toBe(false);
  });
});

describe("Escenario: Segunda policy sugiere factory separada (US-005)", () => {
  it("rechaza una policy distinta y propone una factory separada válida", () => {
    const store = new FactoryWorkspaceStore(createMemoryPort(), []);
    const created = store.create({ name: "payments-factory" });
    const uid = created.value?.uid ?? "";

    const second = store.setPolicy(uid, ALTERNATE_POLICIES[0]);
    expect(second.ok).toBe(false);
    expect(second.issues[0]?.code).toBe("two_policies");
    expect(second.issues[0]?.message).toBe(TWO_POLICIES_MESSAGE);
    expect(second.issues[0]?.path).toBe("policyId");
    expect(store.getByUid(uid)?.policyId).toBe(DEFAULT_POLICY.id);

    const record = store.getByUid(uid);
    if (record === undefined) throw new Error("la factory desapareció");
    const suggested = suggestSeparateFactoryName(record, ALTERNATE_POLICIES[0]);
    expect(suggested).toBe(`payments-factory-${ALTERNATE_POLICIES[0].id}`);
    expect(validateFactoryCreate({ name: suggested }, { existing: store.list() }).ok).toBe(true);
  });

  it("reaplicar la policy por defecto es idempotente", () => {
    const store = new FactoryWorkspaceStore(createMemoryPort(), []);
    const uid = store.create({ name: "payments-factory" }).value?.uid ?? "";
    expect(store.setPolicy(uid, DEFAULT_POLICY).ok).toBe(true);
    expect(store.setPolicy(uid, DEFAULT_POLICY).ok).toBe(true);
  });
});

describe("Escenario: Glosario de la triada (US-006)", () => {
  it("FACTORY_GLOSSARY tiene los tres términos en orden", () => {
    expect(FACTORY_GLOSSARY.map((entry) => entry.term)).toEqual([
      "Warp Factories",
      "factory",
      "foreman",
    ]);
    for (const entry of FACTORY_GLOSSARY) {
      expect(entry.definition.length).toBeGreaterThan(20);
      expect(entry.trace).toMatch(/WarpFactories\.md/);
    }
  });

  it("glosario sigue teniendo 3 términos", () => {
    expect(FACTORY_GLOSSARY).toHaveLength(3);
  });
});

describe("Escenario: Persistencia", () => {
  it("la factory creada sobrevive a una recarga sobre el mismo puerto", () => {
    const port = createMemoryPort();
    const first = new FactoryWorkspaceStore(port, []);
    const created = first.create({ name: "search-factory" });
    expect(created.ok).toBe(true);

    const reloaded = new FactoryWorkspaceStore(port, []);
    expect(reloaded.list().map((f) => f.name)).toEqual(["search-factory"]);
    expect(reloaded.getSelectedUid()).toBe(created.value?.uid ?? "");
  });

  it("R13 — el puerto de localStorage persiste bajo WORKSPACE_STORAGE_KEY", () => {
    const store = new FactoryWorkspaceStore(createLocalStoragePort(), []);
    const created = store.create({ name: "local-factory" });
    expect(created.ok).toBe(true);

    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw ?? "").toContain("local-factory");
  });

  it("un snapshot corrupto cae al seed sin romper la app (seed vacío ADR-003)", () => {
    const port = createMemoryPort({ [WORKSPACE_STORAGE_KEY]: "{ esto no es json" });
    const store = new FactoryWorkspaceStore(port, DEFAULT_FACTORY_SEED);
    expect(store.list().map((f) => f.name)).toEqual([]);
    expect(DEFAULT_FACTORY_SEED).toEqual([]);
  });
});

describe("Escenario: Crear factory no pisa las conocidas del store (R3)", () => {
  it("addKnownFactories es aditivo sobre el universo del WorkItemStore", () => {
    const workItems = new WorkItemStore(undefined, ["payments-factory", "termcanvas-factory"]);
    workItems.addKnownFactories(["search-factory"]);

    expect([...workItems.getKnownFactories()].sort()).toEqual([
      "payments-factory",
      "search-factory",
      "termcanvas-factory",
    ]);
    expect(
      workItems.create({ factoryName: "termcanvas-factory", title: "t", createdBy: "me", source: "direct" }).ok
    ).toBe(true);
  });

  it("el constructor de FactoryMcpStub ya no borra termcanvas-factory", () => {
    const workItems = new WorkItemStore(undefined, ["payments-factory", "termcanvas-factory"]);
    const bundle = getFactoryBundle();
    const stub = new FactoryMcpStub(workItems, bundle.value ?? null);

    expect(stub).toBeTruthy();
    expect(workItems.getKnownFactories()).toContain("termcanvas-factory");
    expect(
      workItems.create({ factoryName: "termcanvas-factory", title: "t", createdBy: "me", source: "direct" }).ok
    ).toBe(true);
  });
});

describe("Regresiones de diseño", () => {
  it("R4 — DEFAULT_FACTORY_SEED es cero absoluto (ADR-003 P0-2)", () => {
    expect(DEFAULT_FACTORY_SEED).toEqual([]);
    expect(LEGACY_SEED_NAMES).toEqual(["payments-factory", "termcanvas-factory"]);
  });

  it("R5 — getFactoryBundle() sin args mantiene payments-factory/payments", () => {
    const plain = getFactoryBundle();
    expect(plain.ok).toBe(true);
    expect(plain.value?.factory.name).toBe("payments-factory");
    expect(plain.value?.factory.alias).toBe("payments");

    const custom = getFactoryBundle({ name: "search-factory", alias: "search" });
    expect(custom.ok).toBe(true);
    expect(custom.value?.factory.name).toBe("search-factory");
    expect(custom.value?.factory.alias).toBe("search");
  });

  it("toSummaries expone la forma reducida para G2 (Factory API)", () => {
    const store = new FactoryWorkspaceStore(createMemoryPort(), []);
    store.create({ name: "payments-factory" });
    const summaries = store.toSummaries();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.name).toBe("payments-factory");
    expect(summaries[0]?.alias).toBe("payments-factory");
    expect(summaries[0]?.repositoryCount).toBe(0);
  });

  it("renameFactory preserva uid, policyId y createdAt", () => {
    const store = new FactoryWorkspaceStore(createMemoryPort(), []);
    const created = store.create({ name: "payments-factory" });
    const uid = created.value?.uid ?? "";
    const renamed = store.update(uid, { name: "billing-factory" });
    expect(renamed.ok).toBe(true);
    expect(renamed.value?.uid).toBe(uid);
    expect(renamed.value?.name).toBe("billing-factory");
    expect(renamed.value?.policyId).toBe(DEFAULT_POLICY.id);
    expect(renamed.value?.createdAt).toBe(created.value?.createdAt);
  });

  it("remove es irreversible y re-selecciona la primera disponible (§10 Deletion)", () => {
    const port = createMemoryPort();
    const store = new FactoryWorkspaceStore(port, []);
    const a = store.create({ name: "alpha-factory" });
    const b = store.create({ name: "beta-factory" });
    const firstUid = a.value?.uid ?? "";
    const secondUid = b.value?.uid ?? "";

    expect(store.getSelectedUid()).toBe(secondUid);
    expect(store.remove(firstUid).ok).toBe(true);
    expect(store.getByUid(firstUid)).toBeUndefined();
    expect(store.remove(firstUid).ok).toBe(false);
    expect(store.getSelectedUid()).toBe(secondUid);
    // si borramos la seleccionada, cae a la primera
    expect(store.remove(secondUid).ok).toBe(true);
    expect(store.list()).toHaveLength(1 - 1 + 1 - 1); // 0
    expect(store.getSelectedUid()).toBe("");
  });

  it("togglePinned persiste el pin por factory (§5.3)", () => {
    const port = createMemoryPort();
    const store = new FactoryWorkspaceStore(port, []);
    const created = store.create({ name: "my-factory" });
    const uid = created.value?.uid ?? "";

    expect(store.getByUid(uid)?.pinned).not.toBe(true);
    expect(store.togglePinned(uid).ok).toBe(true);
    expect(store.getByUid(uid)?.pinned).toBe(true);

    const reloaded = new FactoryWorkspaceStore(port, []);
    expect(reloaded.getByUid(uid)?.pinned).toBe(true);
  });
});

describe("ADR-003 P0-2 — migración legacy seeds", () => {
  it("payload solo seeds → silent clear a vacío", () => {
    const legacyPayload = {
      version: 2 as const,
      selectedUid: "uid_payments-factory_1",
      factories: [
        { uid: "uid_payments-factory_1", name: "payments-factory", alias: "payments-factory", description: "Processes approved work for the payments service", repositories: [{ owner: "acme", name: "payments-service" }, { owner: "acme", name: "payments-api" }], integrations: ["slack"], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-18T00:00:00.000Z", pinned: true },
        { uid: "uid_termcanvas-factory_2", name: "termcanvas-factory", alias: "termcanvas-factory", description: "Owns the TermCanvas web app surface", repositories: [{ owner: "acme", name: "termcanvas-web" }], integrations: [], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-18T00:00:01.000Z" },
      ],
      exportedAt: "2026-08-30T00:00:00.000Z",
    };
    const port = createMemoryPort({ "termcanvas.factory-workspace.v2": JSON.stringify(legacyPayload) });
    const store = new FactoryWorkspaceStore(port, []);
    expect(store.list()).toEqual([]);
  });
});
