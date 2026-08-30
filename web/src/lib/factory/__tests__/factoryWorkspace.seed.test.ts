import { describe, it, expect, beforeEach } from "vitest";
import { FactoryWorkspaceStore, DEFAULT_FACTORY_SEED, isLegacySeedRecord, classifyLegacyPayload } from "../store/factoryWorkspace.store";
import { createMemoryPort } from "../store/storage.port";
import { _resetUidSeq } from "../domain/factory.record";
import { WorkItemStore } from "../store/workItem.store";

describe("Gherkin P0-2 seed removal + migración soft", () => {
  beforeEach(() => {
    _resetUidSeq();
    WorkItemStore._resetIdSeq();
  });

  it("DEFAULT_FACTORY_SEED es cero absoluto", () => {
    expect(DEFAULT_FACTORY_SEED).toEqual([]);
  });

  it("payload solo seeds → silent clear a []", () => {
    const legacy = {
      version: 2 as const,
      selectedUid: "uid_payments-factory_1",
      factories: [
        { uid: "uid_payments-factory_1", name: "payments-factory", alias: "payments-factory", repositories: [{ owner: "acme", name: "payments-service" }], integrations: ["slack"], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-18T00:00:00.000Z", pinned: true },
        { uid: "uid_termcanvas-factory_2", name: "termcanvas-factory", alias: "termcanvas-factory", repositories: [{ owner: "acme", name: "termcanvas-web" }], integrations: [], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-18T00:00:01.000Z" },
      ],
      exportedAt: "2026-08-30T00:00:00.000Z",
    };
    const port = createMemoryPort({ "termcanvas.factory-workspace.v2": JSON.stringify(legacy) });
    const ws = new FactoryWorkspaceStore(port, []);
    expect(ws.list()).toEqual([]);
  });

  it("detecta legacy y clasifica mixed", () => {
    const mixed = [
      { uid: "uid_payments-factory_1", name: "payments-factory", alias: "payments-factory", repositories: [{ owner: "acme", name: "payments-service" }], integrations: [], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-18T00:00:00.000Z" },
      { uid: "uid_my-factory_1", name: "my-factory", alias: "my-factory", repositories: [{ owner: "wilson", name: "repo" }], integrations: [], agentToggles: { triage: true, spec: true, implement: true, review: true }, policyId: "default", createdAt: "2026-08-18T00:00:02.000Z" },
    ] as unknown as import("../domain/factory.record").FactoryRecord[];
    expect(mixed.some((r) => isLegacySeedRecord(r))).toBe(true);
    expect(classifyLegacyPayload(mixed)).toBe("mixed");
    expect(classifyLegacyPayload([])).toBe("none");
  });

  it("nunca hace localStorage.clear global", () => {
    const port = createMemoryPort();
    const ws = new FactoryWorkspaceStore(port, []);
    ws.create({ name: "user-factory" });
    // port todavía tiene solo keys del workspace, no ha borrado otras
    expect(port.read("termcanvas.factory-workspace.v2")).not.toBeNull();
  });
});
