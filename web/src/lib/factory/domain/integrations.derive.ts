// SRP: derive integrations — tipos permitidos, mutual exclusion, provider table, mock status
// DIP: recibe FactoryBundle, no side effects

import type { FactoryBundle } from "../store/factoryRegistry";
import type { FactoryIntegration } from "./types";

type IntegrationType = FactoryIntegration["type"]; // "slack"|"linear"|"jira"

export interface ProviderRow {
  provider: string;
  bestFor: string;
  continuesIn: string;
  filters: string; // what filters per §9 mapa general
  notes: string;
  declareLocation: string; // where to declare in factory.yaml or not
}

export type ProviderStatus = "connected" | "disconnected" | "not_applicable";

// §9 mapa general — verbatim provider rows (WarpFactories.md:835 approx)
export const PROVIDER_TABLE: ProviderRow[] = [
  {
    provider: "Slack",
    bestFor: "Chat / support requests",
    continuesIn: "Slack thread/DM",
    filters: "Conversations, authors/members, keywords, emoji, reacted-message authors",
    notes: "Mentions y DMs requieren Slack account linkeada a member del factory's Warp team",
    declareLocation: "integrations: [{type: slack}]",
  },
  {
    provider: "GitHub",
    bestFor: "Issues / PRs / reviews / CI",
    continuesIn: "issue/PR/review thread",
    filters: "Repo, branches, base branches, paths, labels, authors, assignees, mentions, reviewers, review states, workflows, conclusions",
    notes: "No se declara en integrations; acceso viene de repositories + GitHub App",
    declareLocation: "repositories + GitHub App (no en integrations)",
  },
  {
    provider: "GitLab",
    bestFor: "Merge request + bot mentions",
    continuesIn: "MR thread",
    filters: "Project, actions, base branch",
    notes: "Via projects del group conectado al workspace. GitLab.com only (no self-managed). Requiere Premium/Ultimate para service accounts + group webhooks.",
    declareLocation: "GitLab group conectado (no en integrations)",
  },
  {
    provider: "Linear",
    bestFor: "Planned issues",
    continuesIn: "Linear issue + agent session",
    filters: "Teams, labels, project, workflow state, assignee, mentioned user (y specific issue para comment events)",
    notes: "Declarar integrations: [{type: linear}] — mutuamente excluyente con Jira",
    declareLocation: "integrations: [{type: linear}]",
  },
  {
    provider: "Jira",
    bestFor: "Work items assigned to Warp",
    continuesIn: "Jira agent session",
    filters: "Jira projects, assignment keywords (case-insensitive)",
    notes: "Declarar integrations: [{type: jira}]. Mutuamente excluyente con Linear. Jira Cloud only (no Server/DC), requiere Rovo agent.",
    declareLocation: "integrations: [{type: jira}]",
  },
  {
    provider: "Schedule",
    bestFor: "Recurring work",
    continuesIn: "work item",
    filters: "Cron",
    notes: "Trigger schedule / cron_fired. Ver triggers[].schedule (5-field cron o @daily/@every 1h, siempre UTC)",
    declareLocation: "automation trigger provider: schedule",
  },
  {
    provider: "Factory",
    bestFor: "Stage changes",
    continuesIn: "work item",
    filters: "—",
    notes: "Trigger factory / work_item_stage_changed — automatizar sobre el propio pipeline",
    declareLocation: "automation trigger provider: factory",
  },
  {
    provider: "Factory API",
    bestFor: "Custom scripts por UID",
    continuesIn: "work item",
    filters: "—",
    notes: "Ver §19 — GET /factory, POST /factory/{uid}/runs",
    declareLocation: "API (no en factory.yaml)",
  },
  {
    provider: "Factory MCP",
    bestFor: "Cualquier coding agent",
    continuesIn: "work item",
    filters: "—",
    notes: "Ver §12 — 19 tools, https://app.warp.dev/api/v1/mcp/factory",
    declareLocation: "MCP server (no en factory.yaml)",
  },
];

export function getIntegratedTypes(bundle: FactoryBundle): IntegrationType[] {
  return (bundle.factory.integrations ?? []).map((i) => i.type);
}

export function hasTrackerConflict(types: IntegrationType[]): boolean {
  return types.includes("linear") && types.includes("jira");
}

export function isValidIntegrationType(v: string): boolean {
  return v === "slack" || v === "linear" || v === "jira";
}

// GitHub must NOT be in integrations — if present, it's invalid (checked by schema, but derive exposes it)
export function hasGitHubInIntegrations(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some(
    (x) => typeof x === "object" && x !== null && (x as Record<string, unknown>).type === "github",
  );
}

export function deriveProviderStatuses(bundle: FactoryBundle): Record<string, ProviderStatus> {
  const types = new Set(getIntegratedTypes(bundle));
  const hasRepos = bundle.factory.repositories.length > 0;
  // mock logic: if integrations declares slack/linear/jira => connected, else disconnected; GitHub => connected if repos present (via App); GitLab disconnected in sample (no group)
  const map: Record<string, ProviderStatus> = {};
  map["Slack"] = types.has("slack") ? "connected" : "disconnected";
  map["GitHub"] = hasRepos ? "connected" : "disconnected";
  map["GitLab"] = "disconnected";
  map["Linear"] = types.has("linear") ? "disconnected" : "disconnected"; // sample has only slack, so linear disconnected; if had linear -> connected
  // adjust: if type present, treat as connected (mock)
  if (types.has("linear")) map["Linear"] = "connected";
  if (types.has("jira")) map["Jira"] = "connected";
  else map["Jira"] = "disconnected";
  map["Schedule"] = "connected"; // always available via automation triggers
  map["Factory"] = "connected";
  map["Factory API"] = "connected";
  map["Factory MCP"] = "connected";
  return map;
}

export function integrationSummaryMessage(types: IntegrationType[]): string {
  if (hasTrackerConflict(types)) return "integrations: linear and jira are mutually exclusive";
  if (types.length === 0) return "Sin tracker declarado (omitir tracker es válido)";
  const hasTracker = types.includes("linear") || types.includes("jira");
  if (!hasTracker && types.includes("slack")) return "Solo Slack (tracker omitido es válido)";
  return types.join("+");
}

export function validateAlias(alias: string): { ok: boolean; reason?: string } {
  if (alias.length > 60) return { ok: false, reason: "alias max 60 chars" };
  if (!/^[A-Za-z0-9 ._-]+$/.test(alias)) return { ok: false, reason: "alias: allowed [A-Za-z0-9 ._-]" };
  return { ok: true };
}

export function validateMcpWarpId(warpId: string): boolean {
  return warpId.length > 0;
}
