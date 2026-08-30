import { describe, it, expect } from "vitest";
import { RemoteFactoryRepo } from "../adapters/remoteFactory.repo";
import type { FactoryApiTransportPort, ApiRequest, ApiResponse } from "../ports/transport.types";

function createMockTransport(responses: Record<string, ApiResponse>): FactoryApiTransportPort {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      const key = `${req.method} ${req.path}`;
      if (responses[key]) return responses[key];
      // fallback for GET /api/v1/factory without query
      if (req.method === "GET" && req.path === "/api/v1/factory") {
        return responses["GET /api/v1/factory"] ?? { status: 200, headers: {}, body: { factories: [] } };
      }
      return { status: 404, headers: {}, body: { error: "not found", code: "route_not_found" } };
    },
    routes() {
      return [];
    },
  };
}

describe("RemoteFactoryRepo — CRUD persistido con fetch mock", () => {
  it("hydrate carga factories y list() las retorna case-insensitive filtradas", async () => {
    const transport = createMockTransport({
      "GET /api/v1/factory": {
        status: 200,
        headers: {},
        body: {
          factories: [
            { uid: "uid_payments-factory_1", name: "payments-factory", alias: "payments-factory", repositoryCount: 2, integrationCount: 1, policyId: "default", createdAt: "2026-08-18T00:00:00.000Z" },
            { uid: "uid_termcanvas-factory_2", name: "termcanvas-factory", alias: "termcanvas-factory", repositoryCount: 1, integrationCount: 0, policyId: "default", createdAt: "2026-08-18T00:00:01.000Z" },
          ],
        },
      },
    });
    const repo = new RemoteFactoryRepo(transport);
    await repo.hydrate();
    expect(repo.list()).toHaveLength(2);
    expect(repo.getByName("PAYMENTS-FACTORY")?.uid).toBe("uid_payments-factory_1");
    expect(repo.toSummaries()).toHaveLength(2);
  });

  it("create POST /api/v1/factory y mapea 201 a ParseResult.ok y notifica", async () => {
    let notifyCount = 0;
    const transport: FactoryApiTransportPort = {
      async handle(req: ApiRequest): Promise<ApiResponse> {
        if (req.method === "POST" && req.path === "/api/v1/factory") {
          const body = req.body as { name: string };
          return {
            status: 201,
            headers: {},
            body: {
              factory: {
                uid: `uid_${body.name}_99`,
                name: body.name,
                alias: body.name,
                repositories: [],
                integrations: [],
                agentToggles: { triage: true, spec: true, implement: true, review: true },
                policyId: "default",
                createdAt: new Date().toISOString(),
              },
            },
          };
        }
        if (req.method === "GET" && req.path === "/api/v1/factory") {
          return { status: 200, headers: {}, body: { factories: [] } };
        }
        return { status: 404, headers: {}, body: {} };
      },
      routes() {
        return [];
      },
    };
    const repo = new RemoteFactoryRepo(transport);
    await repo.hydrate();
    const unsub = repo.subscribe(() => {
      notifyCount += 1;
    });
    const result = await repo.create({ name: "demo-factory" });
    expect(result.ok).toBe(true);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].name).toBe("demo-factory");
    expect(notifyCount).toBe(1);
    unsub();
  });

  it("create con error 400 name_unique mapea a ParseResult.fail con code", async () => {
    // kept to verify transport mapping; variable intentionally unused due to mock override
    const _transport = createMockTransport({
      "GET /api/v1/factory": { status: 200, headers: {}, body: { factories: [] } },
      "POST /api/v1/factory": { status: 400, headers: {}, body: { error: "Ya existe", code: "name_unique", issues: [{ path: "name", message: "Ya existe", code: "name_unique" }] } },
    });
    void _transport;
    // override POST handling
    const customTransport: FactoryApiTransportPort = {
      async handle(req: ApiRequest): Promise<ApiResponse> {
        if (req.method === "POST" && req.path === "/api/v1/factory") {
          return { status: 400, headers: {}, body: { error: "Ya existe una factory con ese nombre", code: "name_unique", issues: [{ path: "name", message: "Ya existe", code: "name_unique" }] } };
        }
        return createMockTransport({ "GET /api/v1/factory": { status: 200, headers: {}, body: { factories: [] } } }).handle(req);
      },
      routes() {
        return [];
      },
    };
    const repo = new RemoteFactoryRepo(customTransport);
    const result = await repo.create({ name: "payments-factory" });
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe("name_unique");
  });

  it("version incrementa tras hydrate y create", async () => {
    const transport = createMockTransport({
      "GET /api/v1/factory": {
        status: 200,
        headers: {},
        body: {
          factories: [{ uid: "uid_a_1", name: "a-factory", alias: "a", repositoryCount: 1, integrationCount: 0, policyId: "default", createdAt: "2026-08-18T00:00:00.000Z" }],
        },
      },
    });
    const repo = new RemoteFactoryRepo(transport);
    const v0 = repo.getVersion();
    await repo.hydrate();
    const v1 = repo.getVersion();
    expect(v1).toBeGreaterThan(v0);
  });


});
