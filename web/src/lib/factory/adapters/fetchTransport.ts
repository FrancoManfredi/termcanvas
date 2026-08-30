// FetchTransport — SRP: mapea ApiRequest → fetch → ApiResponse, mantiene handle(ApiRequest)→Promise<ApiResponse> (ADR-001 D1)
// DIP: dominio solo conoce handle, no fetch
import type { ApiRequest, ApiResponse, FactoryApiTransportPort, TransportRouteInfo } from "../ports/transport.types";

export interface FetchTransportOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export class FetchTransport implements FactoryApiTransportPort {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(opts: FetchTransportOptions) {
    const b = opts.baseUrl.trim().replace(/\/$/, "");
    this.baseUrl = b;
    this.apiKey = opts.apiKey?.trim() ? opts.apiKey.trim() : undefined;
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const url = this.buildUrl(req);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...req.headers,
    };
    if (this.apiKey) {
      headers["authorization"] = `Bearer ${this.apiKey}`;
    }
    const init: RequestInit = {
      method: req.method,
      headers,
      body: req.body !== undefined && req.body !== null && req.method === "POST" ? JSON.stringify(req.body) : undefined,
    };
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });
    return {
      status: res.status,
      headers: resHeaders,
      body,
    };
  }

  routes(): readonly TransportRouteInfo[] {
    return [
      { id: "factory.list", method: "GET", path: "/api/v1/factory" },
      { id: "factory.get", method: "GET", path: "/api/v1/factory/:uid" },
      { id: "factory.create", method: "POST", path: "/api/v1/factory" },
      { id: "factory.runs.create", method: "POST", path: "/api/v1/factory/:uid/runs" },
      { id: "factory.import", method: "POST", path: "/api/v1/factory/import" },
      { id: "workItems.list", method: "GET", path: "/api/v1/work-items" },
      { id: "workItems.create", method: "POST", path: "/api/v1/work-items" },
      { id: "workItems.transition", method: "POST", path: "/api/v1/work-items/:id/transition" },
      { id: "agent.run.get", method: "GET", path: "/agent/runs/:id" },
      { id: "agent.run.followups", method: "POST", path: "/agent/runs/:id/followups" },
      { id: "agent.run.cancel", method: "POST", path: "/agent/runs/:id/cancel" },
      { id: "agent.run.standalone", method: "POST", path: "/agent/run" },
      { id: "health", method: "GET", path: "/health" },
    ];
  }

  private buildUrl(req: ApiRequest): string {
    const query = req.query && Object.keys(req.query).length > 0 ? `?${new URLSearchParams(req.query).toString()}` : "";
    // req.path may already contain query (e.g. from router.dispatch path with ?search=) - in that case prefer req.path as is
    if (req.path.includes("?")) {
      return `${this.baseUrl}${req.path}`;
    }
    return `${this.baseUrl}${req.path}${query}`;
  }
}
