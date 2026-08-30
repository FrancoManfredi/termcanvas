// SRP: solo tipos de puertos transport — dominio no conoce fetch/localStorage/WebSocket
// Source: WarpFactories.md §19 · PLAN-OLAS-WARP-FACTORIES §8.3 · Apéndice B.3
// DIP: InMemoryTransport (factoryApi.router + mcp.stub) y futuro FetchTransport satisfacen estas interfaces

import type { ParseResult } from "../domain/result";

/**
 * ApiRequest — objeto tipado que atraviesa el puerto transport.
 * No usa Request de DOM para que el dominio permanezca puro y testeable sin polyfill.
 * Hoy lo consume createFactoryApi vía router.dispatch; futuro FetchTransport lo mapea a fetch().
 */
export interface ApiRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  /** Query separada para que search case-insensitive se centralice en un sitio (factoryApi.routes). */
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/**
 * ApiResponse — shape mínimo compatible con FactoryApiResponse y con fetch Response.
 * Permite toCurl / toOzApiSnippet sin serializar Request/Response nativos.
 */
export interface ApiResponse<T = unknown> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

/**
 * Info de ruta expuesta por el transport para UI (FactoryApiPage) y tests.
 */
export interface TransportRouteInfo {
  readonly id: string;
  readonly method: string;
  readonly path: string;
}

/**
 * FactoryApiTransportPort — transport para Factory API + Agent API.
 * Decisión ADR-001: handle(ApiRequest)→ApiResponse en lugar de fetch-like Request→Response.
 * Razones: (1) ya existe como FactoryApiRouter.dispatch, (2) evita Request/Response DOM en dominio,
 * (3) centraliza TICKET_REF_PATTERN y search case-insensitive, (4) permite toCurl sin serializar.
 *
 * Hoy: InMemoryTransport = createFactoryApiRuntime(...).router.dispatch adaptado a handle().
 * Futuro: FetchTransport = fetch("https://app.warp.dev" + req.path, { headers: { Authorization: "Bearer "+WARP_API_KEY } }).
 */
export interface FactoryApiTransportPort {
  /** Despacha la request y devuelve la response — síncrona en LOCAL, async en remote. */
  handle(req: ApiRequest): ApiResponse | Promise<ApiResponse>;
  /** Catálogo de rutas para UI y para validar contrato en tests. */
  routes(): readonly TransportRouteInfo[];
}

/**
 * McpTransportPort — transport para Factory MCP (19 tools, headless Bearer, best-effort sin scopes).
 * Hoy: FactoryMcpStub (WorkItemStore real + FactoryRegistry).
 * Futuro: McpFetchTransport (POST https://app.warp.dev/api/v1/mcp/factory streamable).
 */
export interface McpTransportPort {
  /**
   * Invoca una tool por nombre. El stub valida que el tool exista y delega a la implementación
   * concreta (list_factories, validate_factory_files, send_task, etc.).
   * Siempre devuelve ParseResult — el caller decide cómo pintar path/message/code.
   */
  call(tool: string, args: unknown): Promise<ParseResult<unknown>>;
  /** Catálogo de 19 tools con descripción para UI (McpStubPage) y tests. */
  listTools(): readonly { name: string; description: string }[];
}
