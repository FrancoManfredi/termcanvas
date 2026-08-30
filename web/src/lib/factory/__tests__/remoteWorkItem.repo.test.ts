import { describe, it, expect } from "vitest";
import { RemoteWorkItemRepo } from "../adapters/remoteWorkItem.repo";
import type { FactoryApiTransportPort, ApiRequest, ApiResponse } from "../ports/transport.types";

function createMockTransport(handler: (req: ApiRequest) => ApiResponse | Promise<ApiResponse>): FactoryApiTransportPort {
  return {
    handle: handler,
    routes() {
      return [];
    },
  };
}

describe("RemoteWorkItemRepo — list/create/transition", () => {
  it("hydrate y list filtra por factoryName y search case-insensitive", async () => {
    const items = [
      { id: "wi_1", factoryName: "payments-factory", title: "Fix checkout race", description: "race condition", stage: "Triage", createdBy: "tester", createdAt: "2026-08-18T00:00:00.000Z", history: [], linkedPRs: [] },
      { id: "wi_2", factoryName: "termcanvas-factory", title: "Add docs", description: "docs", stage: "Complete", createdBy: "other", createdAt: "2026-08-18T00:00:01.000Z", history: [], linkedPRs: [] },
    ];
    const transport = createMockTransport(async (req) => {
      if (req.method === "GET" && req.path === "/api/v1/work-items") {
        // server returns all; repo will filter
        return { status: 200, headers: {}, body: { workItems: items } };
      }
      return { status: 404, headers: {}, body: {} };
    });
    const repo = new RemoteWorkItemRepo(transport);
    await repo.hydrate();
    expect(await repo.list()).toHaveLength(1); // default excludes Complete without includeTerminals
    expect(await repo.list({ includeTerminals: true })).toHaveLength(2);
    expect(await repo.list({ factoryName: "payments-factory" })).toHaveLength(1);
    expect(await repo.list({ search: "CHECKOUT" })).toHaveLength(1);
    expect((await repo.list({ search: "checkout" }))[0].id).toBe("wi_1");
  });

  it("create POST /api/v1/work-items persiste y notifica", async () => {
    const transport = createMockTransport(async (req) => {
      if (req.method === "GET" && req.path === "/api/v1/work-items") {
        return { status: 200, headers: {}, body: { workItems: [] } };
      }
      if (req.method === "POST" && req.path === "/api/v1/work-items") {
        const body = req.body as { factoryName: string; title: string };
        const item = { id: "wi_99", factoryName: body.factoryName, title: body.title, stage: "Triage", createdBy: "tester", createdAt: new Date().toISOString(), history: [], linkedPRs: [] };
        return { status: 201, headers: {}, body: { workItem: item } };
      }
      return { status: 404, headers: {}, body: {} };
    });
    const repo = new RemoteWorkItemRepo(transport);
    await repo.hydrate();
    let notified = 0;
    const unsub = repo.subscribe(() => {
      notified += 1;
    });
    const result = await repo.create({ factoryName: "payments-factory", title: "New task", source: "direct", createdBy: "tester" });
    expect(result.ok).toBe(true);
    expect(await repo.list({ factoryName: "payments-factory" })).toHaveLength(1);
    expect(notified).toBe(1);
    unsub();
  });

  it("transition mapea 400 human_gate_pending a ParseResult con code", async () => {
    const existing = { id: "wi_10", factoryName: "payments-factory", title: "Needs approval", stage: "Planning", createdBy: "tester", createdAt: "2026-08-18T00:00:00.000Z", history: [], linkedPRs: [], humanApproval: "pending" };
    const transport = createMockTransport(async (req) => {
      if (req.method === "GET" && req.path === "/api/v1/work-items") {
        return { status: 200, headers: {}, body: { workItems: [existing] } };
      }
      if (req.method === "POST" && req.path.includes("/transition")) {
        return { status: 400, headers: {}, body: { error: "Planning → Building requires humanApproval='approved'", code: "human_gate_pending" } };
      }
      return { status: 404, headers: {}, body: {} };
    });
    const repo = new RemoteWorkItemRepo(transport);
    await repo.hydrate();
    const res = await repo.transition("wi_10", "Building", "foreman", {});
    expect(res.ok).toBe(false);
    expect(res.issues[0].code).toBe("human_gate_pending");
  });

  it("includeTerminals true incluye Complete/Cancelled con count", async () => {
    const items = [
      { id: "wi_a", factoryName: "payments-factory", title: "Active", stage: "Triage", createdBy: "you", createdAt: "2026-08-18T00:00:00.000Z", history: [], linkedPRs: [] },
      { id: "wi_b", factoryName: "payments-factory", title: "Done", stage: "Complete", createdBy: "you", createdAt: "2026-08-18T00:00:01.000Z", history: [], linkedPRs: [] },
      { id: "wi_c", factoryName: "payments-factory", title: "Cancelled", stage: "Cancelled", createdBy: "you", createdAt: "2026-08-18T00:00:02.000Z", history: [], linkedPRs: [] },
    ];
    const transport = createMockTransport(async () => ({ status: 200, headers: {}, body: { workItems: items } }));
    const repo = new RemoteWorkItemRepo(transport);
    await repo.hydrate();
    expect(await repo.list({ factoryName: "payments-factory" })).toHaveLength(1);
    expect(await repo.list({ factoryName: "payments-factory", includeTerminals: true })).toHaveLength(3);
  });
});
