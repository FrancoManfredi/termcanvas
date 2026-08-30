import { describe, it, expect } from "vitest";
import { createFactoryAdapters } from "../adapters/adapterFactory";
import { isBackendEnabledFor } from "../config/featureFlags";
import { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import { WorkItemStore } from "../store/workItem.store";

describe("adapterFactory — isBackendEnabled fail-closed y MaybePromise", () => {
  it("isBackendEnabledFor local=false remote=true", () => {
    expect(isBackendEnabledFor("local")).toBe(false);
    expect(isBackendEnabledFor("remote")).toBe(true);
  });

  it("createFactoryAdapters local retorna LocalAdapter sync", async () => {
    const adapters = createFactoryAdapters("local");
    expect(adapters.mode).toBe("local");
    expect(adapters.factoryRepo).toBeInstanceOf(FactoryWorkspaceStore);
    expect(adapters.workItemRepo).toBeInstanceOf(WorkItemStore);
    // MaybePromise: await syncValue sigue funcionando
    const factories = await adapters.factoryRepo.list();
    expect(Array.isArray(factories)).toBe(true);
    expect(factories.length).toBeGreaterThanOrEqual(2);
  });

  it("createFactoryAdapters remote retorna RemoteAdapter con FetchTransport", async () => {
    const adapters = createFactoryAdapters("remote");
    expect(adapters.mode).toBe("remote");
    // transport routes includes health
    expect(adapters.transport.routes().map((r) => r.id)).toContain("health");
    // remote list initially empty (hydrate async)
    const factories = await adapters.factoryRepo.list();
    expect(Array.isArray(factories)).toBe(true);
  });

  it("FACTORY_BACKEND_API_URL default http://localhost:8787", async () => {
    const { FACTORY_BACKEND_API_URL, getBackendConfig } = await import("../config/featureFlags");
    expect(FACTORY_BACKEND_API_URL).toBe("http://localhost:8787");
    const cfg = getBackendConfig();
    expect(cfg.baseUrl).toBe("http://localhost:8787");
    expect(cfg.mode).toBe("local"); // sin env, fail-closed local
  });


});
