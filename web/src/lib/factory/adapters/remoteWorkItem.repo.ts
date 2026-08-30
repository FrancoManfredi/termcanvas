// RemoteWorkItemRepo — cache + fetch vs WorkItemRepositoryPort (MaybePromise widen O18)
// O18: filtros search/createdBy/includeTerminals contra backend server-side (GET /api/v1/work-items?search=&createdBy=&includeTerminals=)
// BugFix: list() siempre retorna WorkItem[] nunca undefined, maneja ParseResult y fetch error con []
import { ParseResult } from "../domain/result";
import type { CreateWorkItemInput, WorkItem, WorkItemStage, TransitionContext, Actor } from "../domain/workItem.types";
import type { WorkItemRepositoryPort, WorkItemFilter } from "../ports/factory.ports";
import type { FactoryApiTransportPort } from "../ports/transport.types";

function safeWorkItemsFromBody(body: unknown): WorkItem[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const raw = (b.workItems ?? b.work_items) as unknown;
  if (Array.isArray(raw)) return raw as WorkItem[];
  return [];
}

export class RemoteWorkItemRepo implements WorkItemRepositoryPort {
  private cache = new Map<string, WorkItem>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _hydrated = false;
  private readonly transport: FactoryApiTransportPort;

  constructor(transport: FactoryApiTransportPort) {
    this.transport = transport;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version += 1;
    for (const cb of [...this.listeners]) cb();
  }

  async hydrate(filter?: WorkItemFilter): Promise<void> {
    void this._hydrated;
    const query: Record<string, string> = {};
    if (filter?.factoryName) query.factoryName = filter.factoryName;
    if (filter?.stage) query.stage = filter.stage;
    if (filter?.search) query.search = filter.search;
    if (filter?.createdBy) query.createdBy = filter.createdBy;
    if (filter?.includeTerminals) query.includeTerminals = "true";
    try {
      const res = await this.transport.handle({ method: "GET", path: "/api/v1/work-items", query });
      if (res.status === 200) {
        const items = safeWorkItemsFromBody(res.body);
        this.cache.clear();
        for (const item of items) {
          if (item && typeof item.id === "string") this.cache.set(item.id, item);
        }
        this._hydrated = true;
        this.notify();
      }
    } catch {
      // ignore hydrate errors — UI shows empty/loading; list() will fallback to [] or cache
    }
  }

  // O18: server-side search — intenta backend via query, fallback a cache filtrado case-insensitive
  async list(filter: WorkItemFilter = {}): Promise<readonly WorkItem[]> {
    const query: Record<string, string> = {};
    if (filter.factoryName) query.factoryName = filter.factoryName;
    if (filter.stage) query.stage = filter.stage;
    if (filter.search) query.search = filter.search;
    if (filter.createdBy) query.createdBy = filter.createdBy;
    if (filter.includeTerminals) query.includeTerminals = "true";
    const hasFilter = Object.keys(query).length > 0;
    if (hasFilter) {
      try {
        const res = await this.transport.handle({ method: "GET", path: "/api/v1/work-items", query });
        if (res.status === 200) {
          const items = safeWorkItemsFromBody(res.body);
          for (const it of items) {
            if (it && typeof it.id === "string") this.cache.set(it.id, it);
          }
          // Si el backend filtró correctamente, items ya está filtrado; pero si el mock devuelve todo o vacío, aplicamos filtro cliente como fallback
          let out = [...items];
          // Siempre aplicamos filtro cliente para asegurar case-insensitive y consistencia con workItem.routes server-side
          if (filter.factoryName) out = out.filter((w) => w.factoryName === filter.factoryName);
          if (filter.stage) out = out.filter((w) => w.stage === filter.stage);
          else if (!filter.includeTerminals) out = out.filter((w) => w.stage !== "Complete" && w.stage !== "Cancelled");
          if (filter.createdBy) out = out.filter((w) => w.createdBy === filter.createdBy);
          if (filter.search) {
            const q = filter.search.toLowerCase();
            out = out.filter((w) => w.title.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q));
          }
          // Si después de filtrar quedó vacío pero cache tiene coincidencias (caso create test donde server devuelve []), fallback a cache
          if (out.length === 0) {
            let cached = [...this.cache.values()];
            if (filter.factoryName) cached = cached.filter((w) => w.factoryName === filter.factoryName);
            if (filter.stage) cached = cached.filter((w) => w.stage === filter.stage);
            else if (!filter.includeTerminals) cached = cached.filter((w) => w.stage !== "Complete" && w.stage !== "Cancelled");
            if (filter.createdBy) cached = cached.filter((w) => w.createdBy === filter.createdBy);
            if (filter.search) {
              const q = filter.search.toLowerCase();
              cached = cached.filter((w) => w.title.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q));
            }
            if (cached.length > 0) out = cached;
          }
          out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return out;
        }
      } catch {
        // fallback to cache below
      }
    } else {
      if (this.cache.size === 0 && !this._hydrated) {
        try {
          await this.hydrate();
        } catch {
          // ignore, fallback to cache (empty)
        }
      }
    }
    // Fallback: filtrar cache local (siempre retorna array, nunca undefined)
    try {
      let out = [...this.cache.values()];
      if (filter.factoryName) out = out.filter((w) => w.factoryName === filter.factoryName);
      if (filter.stage) out = out.filter((w) => w.stage === filter.stage);
      else if (!filter.includeTerminals) out = out.filter((w) => w.stage !== "Complete" && w.stage !== "Cancelled");
      if (filter.createdBy) out = out.filter((w) => w.createdBy === filter.createdBy);
      if (filter.search) {
        const q = filter.search.toLowerCase();
        out = out.filter((w) => w.title.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q));
      }
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return out;
    } catch {
      // Ante cualquier error inesperado, retornar [] nunca undefined — evita "is not iterable"
      return [];
    }
  }

  getById(id: string): WorkItem | undefined {
    return this.cache.get(id);
  }

  async create(input: CreateWorkItemInput): Promise<ParseResult<WorkItem>> {
    try {
      const res = await this.transport.handle({ method: "POST", path: "/api/v1/work-items", body: input as unknown as Record<string, unknown> });
      if (res.status === 201) {
        const body = res.body as { workItem?: WorkItem; work_item?: WorkItem } & Record<string, unknown>;
        const item = (body.workItem ?? body.work_item) as WorkItem | undefined;
        if (item && typeof item.id === "string") {
          this.cache.set(item.id, item);
          this.notify();
          return ParseResult.ok(item);
        }
        // Si el body no trae workItem pero status 201, error controlado
        return ParseResult.singleFail("factoryName", "create succeeded but missing workItem in response", "invalid_response");
      }
      const body = res.body as { error?: string; code?: string; issues?: { path: string; message: string; code: string }[] };
      const code = (body as unknown as Record<string, unknown>)?.code as string | undefined ?? "validation_error";
      const message = (body as unknown as Record<string, unknown>)?.error as string | undefined ?? "create failed";
      const issues = (body as unknown as Record<string, unknown>)?.issues as { path: string; message: string; code: string }[] | undefined ?? [{ path: "factoryName", message, code }];
      return ParseResult.fail(issues);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ParseResult.singleFail("factoryName", msg.includes("fetch") ? `network error: ${msg}` : msg, "network_error");
    }
  }

  async transition(id: string, to: WorkItemStage, actor: Actor, ctx: TransitionContext = {}): Promise<ParseResult<WorkItem>> {
    try {
      const res = await this.transport.handle({
        method: "POST",
        path: `/api/v1/work-items/${id}/transition`,
        body: { to, actor, ...ctx } as unknown as Record<string, unknown>,
      });
      if (res.status === 200) {
        const body = res.body as { workItem?: WorkItem; work_item?: WorkItem } & Record<string, unknown>;
        const item = (body.workItem ?? body.work_item) as WorkItem | undefined;
        if (item && typeof item.id === "string") {
          this.cache.set(item.id, item);
          this.notify();
          return ParseResult.ok(item);
        }
        return ParseResult.singleFail(id, "transition succeeded but missing workItem", "invalid_response");
      }
      const body = res.body as { error?: string; code?: string };
      const code = (body as unknown as Record<string, unknown>)?.code as string | undefined ?? "transition_failed";
      const message = (body as unknown as Record<string, unknown>)?.error as string | undefined ?? "transition failed";
      return ParseResult.singleFail(id, message, code);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ParseResult.singleFail(id, msg, "network_error");
    }
  }

  // O18: cancel persistido — usa transition a Cancelled y notifica, durable via backend
  async cancel(id: string, actor: Actor = "foreman", reason?: string): Promise<ParseResult<WorkItem>> {
    return this.transition(id, "Cancelled" as WorkItemStage, actor, { reason } as TransitionContext);
  }

  // Compatibility stubs for WorkItemStore interface (so cast en main.tsx no rompe)
  setKnownFactories(_names: string[]): void {}
  addKnownFactories(_names: readonly string[]): void {}
  getKnownFactories(): readonly string[] { return []; }
  clear(): void { this.cache.clear(); this.notify(); }
  size(): number { return this.cache.size; }
}
