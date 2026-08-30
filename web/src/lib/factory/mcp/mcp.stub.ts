// Factory MCP stub — 19 tools mock sobre WorkItemStore real
// SRP: cada tool es función pura sobre store/registry; no scopes per-factory, no claim/lock, best-effort notifications, headless bearer
// DIP: inyecta WorkItemStore y FactoryRegistry/FactoryBundle; sin crear concreciones internas
// Preparado para conectar a https://app.warp.dev/api/v1/mcp/factory real

import { z } from "zod";
import { ParseResult } from "../domain/result";
import type { FactoryBundle } from "../store/factoryRegistry";
import { FactoryRegistry } from "../store/factoryRegistry";
import type { WorkItem, WorkItemStage } from "../domain/workItem.types";
import type { WorkItemStore } from "../store/workItem.store";
import type { FactoryDefinition, RepositoryRef } from "../domain/types";
import { canTransition } from "../domain/workItem.machine";

export const MCP_ENDPOINT = "https://app.warp.dev/api/v1/mcp/factory";

// 19 tools list (WarpFactories.md §12). list_notification_routes is capability of send_task best-effort.
export const MCP_TOOL_NAMES = [
  "list_factories",
  "get_factory_file_schema",
  "validate_factory_files",
  "list_teams",
  "create_team",
  "join_team",
  "get_team_funding_status",
  "list_forge_repositories",
  "list_tracker_scopes",
  "start_connection",
  "get_connection_status",
  "create_factory",
  "list_tasks",
  "search_task",
  "get_task",
  "message_foreman",
  "get_conversation",
  "send_task",
  "complete_task",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
export type McpToolDef = { name: McpToolName; description: string; inputSchema: Record<string, unknown>; outputExample: unknown };

export interface McpTeam {
  id: string;
  name: string;
  role: "owner" | "member";
}

export interface McpForgeRepo {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
}

export interface McpTrackerScope {
  type: "linear" | "jira";
  id: string;
  name: string;
}

export interface McpConnection {
  connectionId: string;
  provider: string;
  status: "pending" | "connected" | "failed";
  browserUrl: string;
}

export interface ConversationMessage {
  id: string;
  taskId: string;
  author: string;
  body: string;
  at: string;
}

export interface NotificationRoute {
  id: string;
  type: "slack_dm" | "linear_issue";
  label: string;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "factory";
}

function gitWorktreeGuidance(taskId: string, factoryName: string, branch?: string): string {
  const b = branch ?? `factory/${slugify(taskId)}`;
  return [
    `# Worktree guidance for task ${taskId} (${factoryName})`,
    `# Factory MCP never modifies files; run these locally`,
    `git fetch origin`,
    `git worktree add ../${taskId} -b ${b} origin/main`,
    `cd ../${taskId}`,
    `# verify task: get_task(id, start_working=true) returned runHistory + dashboard link`,
  ].join("\n");
}

export class FactoryMcpStub {
  private store: WorkItemStore;
  private registry: FactoryRegistry;
  private bundle: FactoryBundle | null;
  private bearerToken: string | null;
  // in-memory mocks
  private teams: McpTeam[] = [
    { id: "team_1", name: "acme", role: "owner" },
    { id: "team_2", name: "acme-marketing", role: "member" },
  ];
  private connections = new Map<string, McpConnection>();
  private conversations = new Map<string, ConversationMessage[]>();
  private factories: Array<{ uid: string; name: string; alias?: string }> = [];
  private forgeRepos: McpForgeRepo[] = [
    { owner: "acme", name: "payments-service", fullName: "acme/payments-service", private: false },
    { owner: "acme", name: "payments-api", fullName: "acme/payments-api", private: true },
  ];
  private trackerScopes: McpTrackerScope[] = [
    { type: "linear", id: "ENG", name: "Engineering" },
    { type: "jira", id: "PROJ", name: "PROJ — payments" },
  ];

  constructor(store: WorkItemStore, bundle: FactoryBundle | null, opts?: { bearerToken?: string; registry?: FactoryRegistry }) {
    this.store = store;
    this.registry = opts?.registry ?? new FactoryRegistry();
    this.bundle = bundle;
    this.bearerToken = opts?.bearerToken ?? null;
    if (bundle) {
      this.factories = [{ uid: `uid_${bundle.factory.name}`, name: bundle.factory.name, alias: bundle.factory.alias }];
      // sync store knownFactories
      this.store.setKnownFactories([bundle.factory.name, ...this.factories.map((f) => f.name)]);
    } else {
      this.factories = [{ uid: "uid_payments-factory", name: "payments-factory", alias: "payments" }];
      this.store.setKnownFactories(this.factories.map((f) => f.name));
    }
  }

  // Auth headless bearer — best-effort, no scopes per-factory (§12)
  // En prod, bearer es requerido siempre (no bypass si !bearerToken)
  authenticate(header?: string): boolean {
    if (!this.bearerToken) {
      // @ts-ignore import.meta puede no existir en tests
      const isProd = typeof import.meta !== "undefined" && (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;
      if (isProd) return false;
      return true; // stub dev/test: no token required
    }
    if (!header) return false;
    const token = header.replace(/^Bearer\s+/i, "").trim();
    return token === this.bearerToken;
  }

  // ---- Tools ----

  list_factories(search?: string): Array<{ uid: string; name: string; alias?: string }> {
    if (!search) return [...this.factories];
    const q = search.toLowerCase();
    return this.factories.filter((f) => f.name.toLowerCase().includes(q) || (f.alias ?? "").toLowerCase().includes(q));
  }

  get_factory_file_schema(version: string = "v1alpha1"): { versions: string[]; schemaUrl: string; schema: Record<string, unknown> } {
    return {
      versions: ["v1alpha1"],
      schemaUrl: `https://app.warp.dev/api/v1/factory-files/schemas/${version}`,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: `factory-file-schema-${version}`,
        required: ["schemaVersion", "name", "repositories", "agentDefaults"],
        properties: {
          schemaVersion: { const: "v1alpha1" },
          name: { type: "string" },
          alias: { type: "string", pattern: "^[A-Za-z0-9 ._-]{1,60}$" },
          repositories: { type: "array" },
          agentDefaults: { type: "object" },
        },
      },
    };
  }

  validate_factory_files(input: { factoryYaml: { raw: string; file: string }; agents: { raw: string; file: string }[]; runners: { raw: string; file: string }[]; automations: { raw: string; file: string }[]; scorers: { raw: string; file: string }[] }): ParseResult<FactoryBundle> {
    return this.registry.parseBundle(input);
  }

  list_teams(): McpTeam[] {
    return [...this.teams];
  }

  create_team(name: string): ParseResult<McpTeam> {
    if (!name?.trim()) return ParseResult.singleFail("name", "team name required", "missing_name");
    if (!/^[A-Za-z0-9 ._-]{1,60}$/.test(name)) return ParseResult.singleFail("name", "invalid team name", "invalid_name");
    const exists = this.teams.some((t) => t.name.toLowerCase() === name.toLowerCase());
    if (exists) return ParseResult.singleFail("name", "team already exists", "duplicate");
    const team: McpTeam = { id: `team_${Date.now()}`, name, role: "owner" };
    this.teams.push(team);
    return ParseResult.ok(team);
  }

  join_team(teamId: string): ParseResult<McpTeam> {
    const t = this.teams.find((x) => x.id === teamId);
    if (!t) return ParseResult.singleFail("teamId", "team not found", "not_found");
    return ParseResult.ok(t);
  }

  get_team_funding_status(_teamId: string): { ready: boolean; checkoutUrl?: string; credits?: number } {
    return { ready: true, credits: 10000, checkoutUrl: "https://app.warp.dev/checkout?team=acme" };
  }

  list_forge_repositories(): McpForgeRepo[] {
    if (this.bundle) {
      const fromBundle: McpForgeRepo[] = this.bundle.factory.repositories.map((r) => ({
        owner: r.owner,
        name: r.name,
        fullName: `${r.owner}/${r.name}`,
        private: false,
      }));
      // merge with mocks deduplicated
      const seen = new Set(fromBundle.map((x) => x.fullName));
      const extra = this.forgeRepos.filter((x) => !seen.has(x.fullName));
      return [...fromBundle, ...extra];
    }
    return [...this.forgeRepos];
  }

  list_tracker_scopes(): McpTrackerScope[] {
    // Return all available scopes for onboarding; filtering by existing integrations is not required in stub
    return [...this.trackerScopes];
  }

  start_connection(provider: "github" | "gitlab" | "slack" | "linear" | "jira"): McpConnection {
    const id = `conn_${provider}_${Date.now()}`;
    const conn: McpConnection = { connectionId: id, provider, status: "pending", browserUrl: `https://app.warp.dev/connect/${provider}?id=${id}` };
    this.connections.set(id, conn);
    return conn;
  }

  get_connection_status(connectionId: string): McpConnection | undefined {
    return this.connections.get(connectionId);
  }

  create_factory(input: { name: string; alias?: string; repositories: RepositoryRef[] }): ParseResult<FactoryDefinition> {
    if (!input.name?.trim()) return ParseResult.singleFail("name", "factory name required", "missing_name");
    if (input.alias && !/^[A-Za-z0-9 ._-]{1,60}$/.test(input.alias)) return ParseResult.singleFail("alias", "alias solo [A-Za-z0-9 ._-], max 60", "invalid_alias");
    const exists = this.factories.some((f) => f.name.toLowerCase() === input.name.toLowerCase() || (input.alias && f.alias?.toLowerCase() === input.alias.toLowerCase()));
    if (exists) return ParseResult.singleFail("name", "factory or alias already exists", "duplicate");
    const uid = `uid_${slugify(input.name)}_${Date.now()}`;
    this.factories.push({ uid, name: input.name, alias: input.alias });
    this.store.setKnownFactories(this.factories.map((f) => f.name));
    // minimal factory definition for return
    const def: FactoryDefinition = {
      schemaVersion: "v1alpha1",
      name: input.name,
      alias: input.alias,
      repositories: input.repositories,
      agentDefaults: { model: "auto" },
    };
    return ParseResult.ok(def);
  }

  // list_tasks with filtros — creator, stage, date
  list_tasks(filter?: { creator?: string; stage?: WorkItemStage; factoryName?: string; search?: string; dateFrom?: string; dateTo?: string }): WorkItem[] {
    let items = this.store.list({ includeTerminals: true, factoryName: filter?.factoryName, stage: filter?.stage, createdBy: filter?.creator, search: filter?.search });
    if (filter?.dateFrom) {
      const from = new Date(filter.dateFrom).getTime();
      items = items.filter((w) => new Date(w.createdAt).getTime() >= from);
    }
    if (filter?.dateTo) {
      const to = new Date(filter.dateTo).getTime();
      items = items.filter((w) => new Date(w.createdAt).getTime() <= to);
    }
    return items;
  }

  search_task(query: string): WorkItem[] {
    if (!query?.trim()) return [];
    return this.store.list({ includeTerminals: true, search: query });
  }

  // get_task — accepts task ID or reference (URL, PR, branch, slack permalink, Linear/Jira issue)
  get_task(
    idOrRef: string,
    opts?: { start_working?: boolean }
  ): { workItem?: WorkItem; runHistory: WorkItem["history"]; worktreeGuidance?: string; dashboardUrl?: string; warning?: string } {
    let item = this.store.getById(idOrRef);
    if (!item) {
      // reference resolution: search by sourceRef, linkedPRs, title, branch name
      const all = this.store.list({ includeTerminals: true });
      const q = idOrRef.toLowerCase();
      item =
        all.find((w) => w.sourceRef?.toLowerCase().includes(q) || w.linkedPRs.some((pr) => pr.toLowerCase().includes(q)) || w.title.toLowerCase().includes(q) || w.id.toLowerCase() === q) ??
        undefined;
    }
    if (!item) return { workItem: undefined, runHistory: [], warning: "task not found" };
    const result: { workItem: WorkItem; runHistory: WorkItem["history"]; worktreeGuidance?: string; dashboardUrl?: string; warning?: string } = {
      workItem: item,
      runHistory: item.history,
      dashboardUrl: `https://app.warp.dev/factory/${item.factoryName}/tasks/${item.id}`,
    };
    if (opts?.start_working) {
      result.worktreeGuidance = gitWorktreeGuidance(item.id, item.factoryName, item.linkedPRs[0]?.split("/").pop());
      // no claim/lock — best-effort: warn if active runs
      if (item.stage !== "Complete" && item.stage !== "Cancelled") {
        result.warning = "Picking up task does NOT claim/lock/pause; factory may still run. Notify foreman to avoid duplication (§12).";
      }
    }
    return result;
  }

  message_foreman(taskId: string, body: string, author: string = "local-agent"): ParseResult<ConversationMessage> {
    if (!body?.trim()) return ParseResult.singleFail("body", "message body required", "missing_body");
    const item = this.store.getById(taskId);
    if (!item) return ParseResult.singleFail("taskId", "task not found", "not_found");
    const msg: ConversationMessage = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, taskId, author, body, at: new Date().toISOString() };
    const list = this.conversations.get(taskId) ?? [];
    list.push(msg);
    this.conversations.set(taskId, list);
    // messaging does NOT move task nor handoff (§12)
    return ParseResult.ok(msg);
  }

  get_conversation(taskId: string): ConversationMessage[] {
    return [...(this.conversations.get(taskId) ?? [])];
  }

  // list_notification_routes — best-effort destinations
  list_notification_routes(_factoryName?: string): NotificationRoute[] {
    return [
      { id: "route_slack_dm", type: "slack_dm", label: "Slack DM — #factory-notifications" },
      { id: "route_linear", type: "linear_issue", label: "Linear — ENG-123" },
    ];
  }

  // send_task — crea new task o hace hand-back a existente
  send_task(input: {
    factoryName: string;
    title: string;
    note: string;
    taskId?: string;
    branchOrPrUrl?: string;
    notificationRoute?: string;
  }): ParseResult<WorkItem> {
    if (!input.title?.trim()) return ParseResult.singleFail("title", "title required", "missing_title");
    if (!input.note?.trim()) return ParseResult.singleFail("note", "note required (goal + context + constraints + work done)", "missing_note");
    if (input.branchOrPrUrl) {
      const raw = input.branchOrPrUrl.trim();
      // si parece URL (contiene ://), validar con Zod URL
      if (raw.includes("://")) {
        const urlCheck = z.string().url().safeParse(raw);
        if (!urlCheck.success) {
          return ParseResult.singleFail("branchOrPrUrl", `invalid URL '${raw}'`, "invalid_url");
        }
      } else if (raw) {
        // branch name: allow alphanum / - _ . /  (no javascript:)
        if (/^\s*javascript:/i.test(raw) || /^\s*data:/i.test(raw)) {
          return ParseResult.singleFail("branchOrPrUrl", "blocked javascript: url", "blocked_url");
        }
      }
    }
    // notification best-effort: ignore invalid route, don't fail
    // if taskId provided → hand-back to same task (§12: devuelve a misma task, foreman decide next step)
    if (input.taskId) {
      const existing = this.store.getById(input.taskId);
      if (!existing) return ParseResult.singleFail("taskId", "task not found for hand-back", "not_found");
      // append branch/PR info as metadata event-like (store via direct map hack to keep stub pure)
      const updated: WorkItem = {
        ...existing,
        description: existing.description ? `${existing.description}\n\n--- hand-back ---\n${input.note}` : input.note,
        linkedPRs: input.branchOrPrUrl ? [...existing.linkedPRs, input.branchOrPrUrl] : existing.linkedPRs,
        history: [
          ...existing.history,
          {
            id: `evt_${Date.now()}_handback`,
            workItemId: existing.id,
            from: existing.stage,
            to: existing.stage,
            actor: "human",
            at: new Date().toISOString(),
            reason: `hand-back: ${input.branchOrPrUrl ?? "no branch"} — ${input.note.slice(0, 80)}`,
            metadata: { handBack: true, branchOrPrUrl: input.branchOrPrUrl, notificationRoute: input.notificationRoute, note: input.note },
          },
        ] as WorkItem["history"],
      } as WorkItem;
      (this.store as unknown as { items: Map<string, WorkItem> }).items.set(existing.id, updated);
      // best-effort notification: don't fail even if route invalid
      return ParseResult.ok(updated);
    }
    // create new factory task — foreman takes over
    const res = this.store.create({
      factoryName: input.factoryName,
      title: input.title,
      description: input.note + (input.branchOrPrUrl ? `\nBranch/PR: ${input.branchOrPrUrl}` : ""),
      source: "mcp",
      sourceRef: input.branchOrPrUrl,
      createdBy: "mcp-agent",
      linkedPRs: input.branchOrPrUrl?.startsWith("http") ? [input.branchOrPrUrl] : [],
    });
    return res;
  }

  complete_task(taskId: string): ParseResult<WorkItem> {
    const item = this.store.getById(taskId);
    if (!item) return ParseResult.singleFail("taskId", "task not found", "not_found");
    if (item.stage === "Complete") return ParseResult.ok(item);
    if (item.stage === "Cancelled") return ParseResult.singleFail("taskId", "cannot complete cancelled task", "invalid_state");
    // Respetar canTransition gate — no bypass de WorkItemMachine
    if (!canTransition(item.stage, "Complete")) {
      return ParseResult.singleFail("taskId", `cannot transition '${item.stage}' → 'Complete' (canTransition gate)`, "invalid_transition");
    }
    // Delegate to store.transition to enforce human gates (requires reviewVerdict/handoff if Reviewing→Complete)
    // For stub, attempt via store; if fails, return the machine error instead of raw complete
    const res = this.store.transition(item.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
    if (!res.ok) {
      // If machine gate blocks (e.g. not Reviewing), try direct but still respect canTransition already checked
      // For non-Reviewing stages that canTransition to Complete per TRANSITIONS (only Reviewing can), this will be empty — already blocked.
      // We return the machine's error for correctness.
      return res;
    }
    return res;
  }

  // Tool reference for UI
  getToolDefs(): McpToolDef[] {
    const examples: Record<McpToolName, McpToolDef> = {
      list_factories: { name: "list_factories", description: "Lista factories accesibles", inputSchema: { search: "string?" }, outputExample: [{ uid: "uid_payments-factory", name: "payments-factory" }] },
      get_factory_file_schema: { name: "get_factory_file_schema", description: "Retorna current schemas para factory config files", inputSchema: { version: "v1alpha1" }, outputExample: { versions: ["v1alpha1"], schemaUrl: "https://app.warp.dev/api/v1/factory-files/schemas/v1alpha1" } },
      validate_factory_files: { name: "validate_factory_files", description: "Valida un complete factory file tree sin guardar/aplicar", inputSchema: { factoryYaml: "string", agents: "string[]" }, outputExample: { ok: true } },
      list_teams: { name: "list_teams", description: "Lista current memberships y first-time joinable team choices", inputSchema: {}, outputExample: [{ id: "team_1", name: "acme" }] },
      create_team: { name: "create_team", description: "Crea first team del authenticated user con confirmed name", inputSchema: { name: "string" }, outputExample: { id: "team_3", name: "new-team" } },
      join_team: { name: "join_team", description: "Joinea un team de first-time discovery choices", inputSchema: { teamId: "string" }, outputExample: { id: "team_2" } },
      get_team_funding_status: { name: "get_team_funding_status", description: "Chequea first-team credit readiness y retorna browser checkout step si aplica", inputSchema: { teamId: "string" }, outputExample: { ready: true } },
      list_forge_repositories: { name: "list_forge_repositories", description: "Lista repos disponibles vía team's connected GitHub/GitLab account", inputSchema: {}, outputExample: [{ fullName: "acme/payments-service" }] },
      list_tracker_scopes: { name: "list_tracker_scopes", description: "Lista Linear teams o Jira projects scoping para routeo a new factory", inputSchema: {}, outputExample: [{ type: "linear", name: "Engineering" }] },
      start_connection: { name: "start_connection", description: "Inicia o chequea setup para GitHub, GitLab, Slack, Linear o Jira", inputSchema: { provider: "github|gitlab|slack|linear|jira" }, outputExample: { connectionId: "conn_github_123", status: "pending" } },
      get_connection_status: { name: "get_connection_status", description: "Chequea si el browser auth flow completó", inputSchema: { connectionId: "string" }, outputExample: { status: "pending" } },
      create_factory: { name: "create_factory", description: "Crea factory con repos, integrations y optional factory agents", inputSchema: { name: "string", repositories: "RepositoryRef[]" }, outputExample: { name: "payments-factory" } },
      list_tasks: { name: "list_tasks", description: "Lista tasks de una factory, con filtros (creator, stage, date)", inputSchema: { factoryName: "string", stage: "WorkItemStage", creator: "string", search: "string" }, outputExample: [{ id: "wi_1", title: "Fix bug" }] },
      search_task: { name: "search_task", description: "Busca task titles across todas las factories accesibles", inputSchema: { query: "string" }, outputExample: [{ id: "wi_1" }] },
      get_task: { name: "get_task", description: "Lee status, run history y outputs. Con start_working=true, también retorna local setup guidance (worktree)", inputSchema: { idOrRef: "string", start_working: "boolean?" }, outputExample: { workItem: {}, worktreeGuidance: "git worktree add ..." } },
      message_foreman: { name: "message_foreman", description: "Manda mensaje al foreman de una task", inputSchema: { taskId: "string", body: "string" }, outputExample: { id: "msg_1" } },
      get_conversation: { name: "get_conversation", description: "Lee la foreman conversation de una task", inputSchema: { taskId: "string" }, outputExample: [{ author: "foreman", body: "hi" }] },
      send_task: { name: "send_task", description: "Crea new task o hace hand-back a una existente. Usa list_notification_routes para elegir destino (best-effort)", inputSchema: { factoryName: "string", title: "string", note: "string", taskId: "string?", branchOrPrUrl: "string?" }, outputExample: { id: "wi_new" } },
      complete_task: { name: "complete_task", description: "Marca task como complete", inputSchema: { taskId: "string" }, outputExample: { stage: "Complete" } },
    };
    return MCP_TOOL_NAMES.map((n) => examples[n]);
  }
}

// Functional wrappers — SRP each tool as pure function operating on stub instance
export function createMcpStub(store: WorkItemStore, bundle: FactoryBundle | null, opts?: { bearerToken?: string }): FactoryMcpStub {
  return new FactoryMcpStub(store, bundle, opts);
}
