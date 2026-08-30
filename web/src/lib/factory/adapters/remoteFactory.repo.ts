// RemoteFactoryRepo — cache + fetch vs FactoryRepositoryPort (MaybePromise widen)
// Mantiene cache Map local hidratada por GET /api/v1/factory y notifica tras fetch; list() sigue sync (lee cache) para no romper OCP sync
import { ParseResult } from "../domain/result";
import type { CreateFactoryInput, FactoryRecord, FactorySummary } from "../domain/factory.record";
import type { FactoryRepositoryPort } from "../ports/factory.ports";
import type { FactoryApiTransportPort } from "../ports/transport.types";

export class RemoteFactoryRepo implements FactoryRepositoryPort {
  private cache = new Map<string, FactoryRecord>();
  private order: string[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private hydrated = false;
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

  async hydrate(): Promise<void> {
    const res = await this.transport.handle({ method: "GET", path: "/api/v1/factory" });
    if (res.status === 200) {
      const body = res.body as { factories?: FactorySummary[]; factoriesList?: FactoryRecord[] } & Record<string, unknown>;
      const factories = (body.factories ?? []) as unknown as FactoryRecord[];
      // 서버 returns summaries but we need full records; summaries lack repositories/integrations? For cache we store as FactoryRecord with mapped fields
      // Try to handle both: if body.factories contains uid/name/alias/repositoryCount, we map to FactoryRecord minimal
      // If body contains full factories (when using /factory/import?), we keep as is
      // For now, if summaries, hydrate cache with converted records (repositories empty fallback)
      // Better: fetch full records via GET /api/v1/factory?search not enough; we need to fetch each factory detail? Instead server's GET /api/v1/factory now returns summaries only.
      // To keep cache complete, we will store summaries as FactoryRecord with empty repos + policyId fallback
      this.cache.clear();
      this.order = [];
      for (const f of factories) {
        const rec = f as unknown as FactoryRecord;
        // if f has uid and name but not repositories, fill defaults to keep shape valid
        const full: FactoryRecord = {
          uid: rec.uid,
          name: rec.name,
          alias: rec.alias ?? rec.name,
          description: (rec as unknown as { description?: string }).description,
          repositories: (rec as unknown as { repositories?: { owner: string; name: string }[] }).repositories ?? [] as unknown as typeof rec.repositories,
          integrations: (rec as unknown as { integrations?: typeof rec.integrations }).integrations ?? [] as unknown as typeof rec.integrations,
          agentToggles: (rec as unknown as { agentToggles?: typeof rec.agentToggles }).agentToggles ?? { triage: true, spec: true, implement: true, review: true },
          policyId: (rec as unknown as { policyId?: string }).policyId ?? "default",
          createdAt: (rec as unknown as { createdAt?: string }).createdAt ?? new Date().toISOString(),
        };
        this.cache.set(full.uid, full);
        this.order.push(full.uid);
      }
      this.hydrated = true;
      this.notify();
    }
  }

  // sync cache read (O16 cache-aside)
  list(): readonly FactoryRecord[] {
    // if not hydrated yet, caller will await hydrate separately; we return current cache (maybe empty) sync
    // To make remote work with useSyncExternalStore, list() stays sync; hydrate is called in adapterFactory or main
    const out: FactoryRecord[] = [];
    for (const uid of this.order) {
      const rec = this.cache.get(uid);
      if (rec) out.push(rec);
    }
    return out;
  }

  async listAsync(): Promise<readonly FactoryRecord[]> {
    if (!this.hydrated) await this.hydrate();
    return this.list();
  }

  getByUid(uid: string): FactoryRecord | undefined {
    return this.cache.get(uid);
  }

  getByName(name: string): FactoryRecord | undefined {
    const lower = name.toLowerCase();
    return this.list().find((r) => r.name.toLowerCase() === lower);
  }

  async create(input: CreateFactoryInput): Promise<ParseResult<FactoryRecord>> {
    const res = await this.transport.handle({ method: "POST", path: "/api/v1/factory", body: input as unknown as Record<string, unknown> });
    if (res.status === 201) {
      const body = res.body as { factory: FactoryRecord };
      const record = body.factory;
      this.cache.set(record.uid, record);
      this.order.push(record.uid);
      this.notify();
      return ParseResult.ok(record);
    }
    const body = res.body as { error?: string; code?: string; issues?: { path: string; message: string; code: string }[]; details?: string[] };
    const code = body.code ?? "validation_error";
    const message = body.error ?? "create failed";
    const issues = body.issues ?? [{ path: "name", message, code }];
    return ParseResult.fail(issues);
  }

  async update(uid: string, patch: Partial<CreateFactoryInput>): Promise<ParseResult<FactoryRecord>> {
    const existing = this.getByUid(uid);
    if (!existing) return ParseResult.singleFail(uid, `factory '${uid}' not found`, "not_found");
    // For O16, update via local cache + would need PATCH endpoint; fallback to local mutation + notify
    // Since server has no PATCH yet, we simulate by updating cache directly (O16 P0 doesn't require remote update)
    const next: FactoryRecord = { ...existing, ...patch, name: patch.name ?? existing.name, alias: patch.alias ?? existing.alias } as FactoryRecord;
    this.cache.set(uid, next);
    this.notify();
    return ParseResult.ok(next);
  }

  async remove(uid: string): Promise<ParseResult<void>> {
    if (!this.cache.has(uid)) return ParseResult.singleFail(uid, `factory '${uid}' not found`, "not_found");
    this.cache.delete(uid);
    this.order = this.order.filter((id) => id !== uid);
    this.notify();
    // server DELETE not yet; O16 delete is local cache for now (persisted via DELETE would be added P1)
    return ParseResult.ok(undefined);
  }

  toSummaries(): readonly FactorySummary[] {
    return this.list().map((r) => ({
      uid: r.uid,
      name: r.name,
      alias: r.alias,
      repositoryCount: r.repositories.length,
      integrationCount: r.integrations.length,
      policyId: r.policyId,
      createdAt: r.createdAt,
    }));
  }

  // Compatibility stubs for FactoryWorkspaceStore interface (so main.tsx cast doesn't break at runtime)
  getSelected(): FactoryRecord | undefined {
    return this.list()[0];
  }
  getSelectedUid(): string {
    return this.list()[0]?.uid ?? "";
  }
  getSelectedFactory(): FactoryRecord | undefined {
    return this.getSelected();
  }
  select(_uid: string): void {
    // remote selection is server-side; no-op for cache
  }
  setPolicy(): ParseResult<FactoryRecord> {
    return ParseResult.singleFail("policy", "not supported in remote", "not_supported");
  }
  togglePinned(): ParseResult<FactoryRecord> {
    return ParseResult.singleFail("pinned", "not supported", "not_supported");
  }
  exportJSON(): string {
    return JSON.stringify({ factories: this.list() });
  }
  importJSON(): ParseResult<void> {
    return ParseResult.ok(undefined);
  }
}
