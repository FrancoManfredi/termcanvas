import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchTransport } from "../adapters/fetchTransport";

describe("FetchTransport — handle(ApiRequest)→fetch", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mapea GET /api/v1/factory?search case-insensitive via query", async () => {
    // mock fetch to return object with json and headers
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      expect(url).toContain("search=PAYMENTS");
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ factories: [{ uid: "uid_1", name: "payments-factory", alias: "payments" }] }),
      } as Response;
    });
    const transport = new FetchTransport({ baseUrl: "http://localhost:8787" });
    const res = await transport.handle({ method: "GET", path: "/api/v1/factory", query: { search: "PAYMENTS" } });
    expect(res.status).toBe(200);
    expect((res.body as { factories: { name: string }[] }).factories[0].name).toBe("payments-factory");
  });

  it("incluye Bearer header cuando apiKey está seteada y omite cuando no", async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return {
        status: 200,
        headers: new Headers(),
        json: async () => ({ factories: [] }),
      } as Response;
    });
    const withKey = new FetchTransport({ baseUrl: "http://localhost:8787", apiKey: "warp_test_key" });
    await withKey.handle({ method: "GET", path: "/api/v1/factory" });
    expect(capturedHeaders["authorization"]).toBe("Bearer warp_test_key");

    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return { status: 200, headers: new Headers(), json: async () => ({ factories: [] }) } as Response;
    });
    const withoutKey = new FetchTransport({ baseUrl: "http://localhost:8787" });
    await withoutKey.handle({ method: "GET", path: "/api/v1/factory" });
    expect(capturedHeaders["authorization"]).toBeUndefined();
  });

  it("mapea 400 invalid_ticket_ref a ParseResult code testeable", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 400,
      headers: new Headers(),
      json: async () => ({ error: "ticket_ref must match /^[a-z]+:[A-Za-z0-9-_]+$/", code: "invalid_ticket_ref" }),
    } as Response);
    const transport = new FetchTransport({ baseUrl: "http://localhost:8787" });
    const res = await transport.handle({ method: "POST", path: "/api/v1/factory/uid_payments-factory_1/runs", body: { prompt: "Fix it", ticket_ref: "PAY-123" } });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_ticket_ref");
  });

  it("expone catálogo routes() con health y factory.runs.create", () => {
    const transport = new FetchTransport({ baseUrl: "http://localhost:8787" });
    const routes = transport.routes();
    expect(routes.map((r) => r.id)).toContain("health");
    expect(routes.map((r) => r.id)).toContain("factory.runs.create");
    expect(routes.find((r) => r.id === "health")?.path).toBe("/health");
  });


});
