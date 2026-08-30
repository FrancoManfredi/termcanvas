// Factory API router — SRP: matches paths and delegates to injected use cases.
// DIP: no React, no storage, and no network client.
// Source: WarpFactories.md §19 · US-149→155

import type {
  FactoryApiDependencies,
  FactoryApiError,
  FactoryApiMethod,
  FactoryApiResponse,
  FactoryGetResponse,
  FactoryListResponse,
  FollowupRequest,
  FactoryRunRequest,
  StandaloneRunRequest,
} from "./factoryApi.types";

function error(status: number, code: string, message: string, details?: readonly string[]): FactoryApiResponse<never> {
  return { status, body: { error: message, code, details } satisfies FactoryApiError };
}

function parseQuery(path: string): { pathname: string; search?: string } {
  const question = path.indexOf("?");
  if (question < 0) return { pathname: path };
  const pathname = path.slice(0, question);
  const params = new URLSearchParams(path.slice(question + 1));
  return { pathname, search: params.get("search") ?? undefined };
}

function parseJson<T>(body: unknown): T | FactoryApiResponse<never> {
  if (typeof body !== "object" || body === null) return error(400, "invalid_json", "Request body must be a JSON object");
  return body as T;
}

export class FactoryApiRouter {
  private readonly dependencies: FactoryApiDependencies;

  constructor(dependencies: FactoryApiDependencies) {
    this.dependencies = dependencies;
  }

  dispatch(method: FactoryApiMethod, path: string, body?: unknown): FactoryApiResponse<unknown> {
    const { pathname, search } = parseQuery(path);
    const segments = pathname.split("/").filter(Boolean);

    if (method === "GET" && pathname === "/api/v1/factory") {
      const response: FactoryListResponse = { factories: this.dependencies.listFactories(search) };
      return { status: 200, body: response };
    }

    if (method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "factory") {
      const factory = this.dependencies.getFactory(segments[3]);
      if (!factory) return error(404, "factory_not_found", `Factory '${segments[3]}' not found`);
      const response: FactoryGetResponse = { factory };
      return { status: 200, body: response };
    }

    if (method === "POST" && segments.length === 5 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "factory" && segments[4] === "runs") {
      const input = parseJson<FactoryRunRequest>(body);
      if ("status" in input) return input;
      return this.dependencies.createFactoryRun(segments[3], input);
    }

    if (segments.length === 3 && segments[0] === "agent" && segments[1] === "runs") {
      const runId = segments[2];
      if (method === "GET") {
        const run = this.dependencies.getAgentRun(runId);
        return run ? { status: 200, body: run } : error(404, "run_not_found", `Run '${runId}' not found`);
      }
    }

    if (method === "POST" && segments.length === 4 && segments[0] === "agent" && segments[1] === "runs" && segments[3] === "followups") {
      const input = parseJson<FollowupRequest>(body);
      if ("status" in input) return input;
      const run = this.dependencies.followupAgentRun(segments[2], input);
      return "error" in run ? { status: 404, body: run } : { status: 200, body: run };
    }

    if (method === "POST" && segments.length === 4 && segments[0] === "agent" && segments[1] === "runs" && segments[3] === "cancel") {
      const run = this.dependencies.cancelAgentRun(segments[2]);
      return "error" in run ? { status: 404, body: run } : { status: 200, body: run };
    }

    if (method === "POST" && pathname === "/agent/run") {
      const input = parseJson<StandaloneRunRequest>(body);
      if ("status" in input) return input;
      return { status: 201, body: this.dependencies.createStandaloneRun(input) };
    }

    return error(404, "route_not_found", `${method} ${pathname} is not implemented`);
  }
}
