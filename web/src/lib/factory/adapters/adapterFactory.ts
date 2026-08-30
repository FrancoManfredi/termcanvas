// adapterFactory — composition root helper: un único sitio elige Local vs Remote (ADR-002 9.4)
// Dominio/UI no conocen la elección; flag solo aquí y en main.tsx (fail-closed local)

import { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import { createLocalStoragePort } from "../store/storage.port";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";
import { createFactoryApiRuntime } from "../domain/factoryApi.routes";
import type { FactoryRepositoryPort, WorkItemRepositoryPort } from "../ports/factory.ports";
import type { FactoryApiTransportPort } from "../ports/transport.types";
import { getBackendConfig } from "../config/featureFlags";
import type { BackendMode } from "../config/featureFlags";
import { FetchTransport } from "./fetchTransport";
import { RemoteFactoryRepo } from "./remoteFactory.repo";
import { RemoteWorkItemRepo } from "./remoteWorkItem.repo";

export interface FactoryAdapters {
  readonly factoryRepo: FactoryRepositoryPort;
  readonly workItemRepo: WorkItemRepositoryPort;
  readonly transport: FactoryApiTransportPort;
  readonly mode: BackendMode;
}

function createLocalAdapters(): FactoryAdapters {
  const workspaceStore = new FactoryWorkspaceStore(createLocalStoragePort());
  const wiStore = new WorkItemStore(new WorkItemMachine(), workspaceStore.list().map((f) => f.name));
  // keep knownFactories in sync (same effect as FactoryWorkspaceProvider)
  workspaceStore.subscribe(() => {
    wiStore.addKnownFactories(workspaceStore.list().map((f) => f.name));
  });
  const runtime = createFactoryApiRuntime(workspaceStore, wiStore);
  const transport: FactoryApiTransportPort = {
    handle(req) {
      const query = req.query && Object.keys(req.query).length > 0 ? `?${new URLSearchParams(req.query).toString()}` : "";
      const fullPath = `${req.path}${query}`;
      const res = runtime.router.dispatch(req.method, fullPath, req.body);
      return {
        status: res.status,
        headers: { "content-type": "application/json" },
        body: res.body,
      };
    },
    routes() {
      return [
        { id: "factory.list", method: "GET", path: "/api/v1/factory" },
        { id: "factory.get", method: "GET", path: "/api/v1/factory/:uid" },
        { id: "factory.runs.create", method: "POST", path: "/api/v1/factory/:uid/runs" },
        { id: "agent.run.get", method: "GET", path: "/agent/runs/:id" },
        { id: "agent.run.followups", method: "POST", path: "/agent/runs/:id/followups" },
        { id: "agent.run.cancel", method: "POST", path: "/agent/runs/:id/cancel" },
        { id: "agent.run.standalone", method: "POST", path: "/agent/run" },
      ];
    },
  };
  return {
    factoryRepo: workspaceStore as unknown as FactoryRepositoryPort,
    workItemRepo: wiStore as unknown as WorkItemRepositoryPort,
    transport,
    mode: "local",
  };
}

function createRemoteAdapters(): FactoryAdapters {
  const cfg = getBackendConfig();
  const transport = new FetchTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
  const factoryRepo = new RemoteFactoryRepo(transport);
  const workItemRepo = new RemoteWorkItemRepo(transport);
  // hydrate cache best-effort (don't block composition)
  void factoryRepo.hydrate().catch(() => {
    // ignore hydrating errors in composition — UI will show empty until retry
  });
  void workItemRepo.hydrate().catch(() => {
    // ignore
  });
  return {
    factoryRepo,
    workItemRepo,
    transport,
    mode: "remote",
  };
}

export function createFactoryAdapters(mode: BackendMode): FactoryAdapters {
  if (mode === "remote") {
    return createRemoteAdapters();
  }
  return createLocalAdapters();
}

// Re-export for tests
export { createLocalAdapters, createRemoteAdapters };
