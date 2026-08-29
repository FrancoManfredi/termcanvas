// SRP: pure settings validation & derive — no I/O, no React
// DIP: consumers pass FactoryBundle + workspace alias list; derive does not read stores

import type { FactoryBundle } from "../store/factoryRegistry";
import type { CredentialStrategy } from "./types";

export const ALIAS_MAX = 60;
export const ALIAS_PATTERN = /^[A-Za-z0-9 ._-]+$/;
export const CREDENTIAL_STRATEGIES: CredentialStrategy[] = ["EXECUTOR", "CREATOR"];
export const DEFAULT_CREDENTIAL_STRATEGY: CredentialStrategy = "EXECUTOR";

export interface AliasValidationIssue {
  code: "alias_required" | "alias_length" | "alias_charset" | "alias_unique";
  message: string;
}

export interface AliasValidationResult {
  ok: boolean;
  issues: AliasValidationIssue[];
}

/**
 * Validate Foreman alias per WarpFactories.md: ≤60 [A-Za-z0-9 ._-] único case-insensitive.
 * Pure — caller supplies existingAliases for uniqueness check.
 */
export function validateForemanAlias(
  alias: string | undefined,
  opts: { existingAliases?: string[]; allowEmpty?: boolean } = {}
): AliasValidationResult {
  const issues: AliasValidationIssue[] = [];
  const existing = opts.existingAliases ?? [];

  if (alias === undefined || alias === null || alias.trim() === "") {
    if (opts.allowEmpty) return { ok: true, issues: [] };
    issues.push({ code: "alias_required", message: "Foreman name (alias) is required" });
    return { ok: false, issues };
  }

  if (alias.length > ALIAS_MAX) {
    issues.push({ code: "alias_length", message: `alias max ${ALIAS_MAX} chars` });
  }

  if (!ALIAS_PATTERN.test(alias)) {
    issues.push({ code: "alias_charset", message: "alias: allowed [A-Za-z0-9 ._-]" });
  }

  const lower = alias.toLowerCase();
  const conflict = existing.some((a) => a.toLowerCase() === lower);
  if (conflict) {
    issues.push({ code: "alias_unique", message: "alias must be unique case-insensitive per workspace" });
  }

  return { ok: issues.length === 0, issues };
}

export function isAliasValid(alias: string, existingAliases: string[] = []): boolean {
  return validateForemanAlias(alias, { existingAliases }).ok;
}

export function normalizeAlias(alias: string): string {
  return alias.trim();
}

// ——— credentialStrategy ———

export function getEffectiveCredentialStrategy(bundle: FactoryBundle): CredentialStrategy {
  return bundle.factory.credentialStrategy ?? DEFAULT_CREDENTIAL_STRATEGY;
}

export function validateCredentialStrategy(value: string | undefined): { ok: boolean; strategy: CredentialStrategy | null; message?: string } {
  if (!value) return { ok: true, strategy: DEFAULT_CREDENTIAL_STRATEGY };
  if (value === "EXECUTOR" || value === "CREATOR") return { ok: true, strategy: value };
  return { ok: false, strategy: null, message: "credentialStrategy must be EXECUTOR or CREATOR" };
}

export function resolveAgentCredentialStrategy(
  agentName: string,
  bundle: FactoryBundle
): CredentialStrategy {
  const agent = bundle.agents.find((a) => a.name === agentName);
  if (agent?.credentialStrategy) return agent.credentialStrategy;
  return getEffectiveCredentialStrategy(bundle);
}

// ——— repositories ———

export function deriveRepositories(bundle: FactoryBundle): { owner: string; name: string }[] {
  return bundle.factory.repositories.map((r) => ({ owner: r.owner, name: r.name }));
}

// ——— runners (file-managed read-only) ———

export function isRunnerFileManaged(mode: "warp-managed" | "github-backed" | "live-managed"): boolean {
  return mode === "github-backed";
}

export function getRunnerSourceOfTruth(mode: "warp-managed" | "github-backed" | "live-managed"): string {
  if (mode === "github-backed") return "runners/*.yaml is source of truth (externally managed, read-only in Settings)";
  if (mode === "live-managed") return "No runners/*.yaml — managed via API";
  return "Warp-managed — editable in dashboard (warp-hosted)";
}

// ——— analysis model ———

export function deriveAnalysisModel(bundle: FactoryBundle): string {
  // For Self-improvement: use scorer judge model as analysis model (spec §10 Settings)
  const scorerModel = bundle.scorers[0]?.model;
  if (scorerModel) return scorerModel;
  return "auto";
}

// ——— integrations derive for Settings tab ———

export function deriveIntegrations(bundle: FactoryBundle): { type: "slack" | "linear" | "jira"; status: "connected" | "disconnected" }[] {
  const types = (bundle.factory.integrations ?? []).map((i) => i.type);
  const all: ("slack" | "linear" | "jira")[] = ["slack", "linear", "jira"];
  return all.map((t) => ({
    type: t,
    status: types.includes(t) ? "connected" : "disconnected",
  }));
}

// ——— deletion ———

export const DELETION_WARNING = "Borra la factory (no reversible) — en GitLab/Slack además remueve bot/app.";

export interface IdentityDerived {
  name: string;
  alias: string;
  aliasValid: AliasValidationResult;
  avatar: string;
}

export function deriveIdentity(
  bundle: FactoryBundle,
  existingAliases: string[] = []
): IdentityDerived {
  const name = bundle.factory.name;
  const alias = bundle.factory.alias ?? name;
  const aliasValid = validateForemanAlias(alias, { existingAliases });
  const avatar = name.charAt(0).toUpperCase();
  return { name, alias, aliasValid, avatar };
}
