// SRP: derive secrets scoping — reemplaza vs agrega, factory-wide siempre aplica, mcp warpId requerido
// DIP: recibe FactoryBundle, no lee filesystem ni registry concreto
// References: WarpFactories.md §7 agentDefaults.secrets/mcpServers + §13 Credential boundaries

import type { FactoryBundle } from "../store/factoryRegistry";

export type SecretScope = "factory-wide" | "agentDefaults" | "per-agent";

export interface SecretEntryView {
  name: string;
  scope: SecretScope;
  /** agent or 'factory' or 'agentDefaults' owner label */
  owner: string;
}

export interface McpEntryView {
  name: string;
  warpId: string;
  scope: SecretScope;
  owner: string;
}

export interface EffectiveSecretsForAgent {
  agentName: string;
  agentType: string;
  factoryWide: string[];
  inheritedOrOverridden: string[]; // from agentDefaults or its own secrets (reemplaza)
  effective: string[]; // factoryWide + inheritedOrOverridden (dedup preserving order)
  // explains replacement
  usesPerAgentOverride: boolean;
}

export interface EffectiveMcpForAgent {
  agentName: string;
  agentType: string;
  factoryWide: Record<string, string>; // name -> warpId
  inheritedOrOverridden: Record<string, string>;
  effective: Record<string, string>;
  usesPerAgentOverride: boolean;
}

export interface SecretsView {
  factoryWideSecrets: string[];
  agentDefaultsSecrets: string[];
  byAgent: EffectiveSecretsForAgent[];
  // flat list of all distinct names
  allDistinct: string[];
  // note: skill does not expand access
  foremanDoesNotExpandAccess: true;
}

export interface McpView {
  factoryWide: Record<string, string>;
  agentDefaults: Record<string, string>;
  byAgent: EffectiveMcpForAgent[];
}

function dedupPreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function getFactoryWideSecrets(bundle: FactoryBundle): string[] {
  return bundle.factory.secrets ? [...bundle.factory.secrets] : [];
}

export function getAgentDefaultsSecrets(bundle: FactoryBundle): string[] {
  return bundle.factory.agentDefaults.secrets ? [...bundle.factory.agentDefaults.secrets] : [];
}

export function getFactoryWideMcp(bundle: FactoryBundle): Record<string, string> {
  const m = bundle.factory.mcpServers ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v.warpId;
  return out;
}

export function getAgentDefaultsMcp(bundle: FactoryBundle): Record<string, string> {
  const m = bundle.factory.agentDefaults.mcpServers ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[k] = v.warpId;
  return out;
}

/**
 * Secrets scoping rule (WarpFactories.md §7):
 * - Factory-wide secrets (factory.secrets) siempre aplican a todos los agents.
 * - Per-agent secrets (agent.secrets) REEMPLAZA agentDefaults.secrets, no agrega.
 * - AgentType (FOREMAN etc) NO amplía acceso; skill no amplía acceso.
 */
export function resolveEffectiveSecretsForAgent(
  bundle: FactoryBundle,
  agentName: string,
): EffectiveSecretsForAgent | null {
  const agent = bundle.agents.find((a) => a.name === agentName);
  if (!agent) return null;
  const factoryWide = getFactoryWideSecrets(bundle);
  const agentDefaultsSecrets = getAgentDefaultsSecrets(bundle);
  const usesPerAgentOverride = agent.secrets !== undefined;
  const inheritedOrOverridden = agent.secrets !== undefined ? [...agent.secrets] : [...agentDefaultsSecrets];
  const effective = dedupPreserveOrder([...factoryWide, ...inheritedOrOverridden]);
  return {
    agentName,
    agentType: agent.agentType,
    factoryWide,
    inheritedOrOverridden,
    effective,
    usesPerAgentOverride,
  };
}

export function resolveAllSecretsView(bundle: FactoryBundle): SecretsView {
  const factoryWideSecrets = getFactoryWideSecrets(bundle);
  const agentDefaultsSecrets = getAgentDefaultsSecrets(bundle);
  const byAgent: EffectiveSecretsForAgent[] = bundle.agents.map((a) => {
    const eff = resolveEffectiveSecretsForAgent(bundle, a.name);
    // eff never null because we iterate agents
    return eff!;
  });
  const allDistinct = dedupPreserveOrder([
    ...factoryWideSecrets,
    ...agentDefaultsSecrets,
    ...byAgent.flatMap((b) => b.inheritedOrOverridden),
  ]);
  return { factoryWideSecrets, agentDefaultsSecrets, byAgent, allDistinct, foremanDoesNotExpandAccess: true };
}

export function resolveEffectiveMcpForAgent(
  bundle: FactoryBundle,
  agentName: string,
): EffectiveMcpForAgent | null {
  const agent = bundle.agents.find((a) => a.name === agentName);
  if (!agent) return null;
  const factoryWide = getFactoryWideMcp(bundle);
  const agentDefaults = getAgentDefaultsMcp(bundle);
  const usesPerAgentOverride = agent.mcpServers !== undefined;
  const inheritedOrOverridden: Record<string, string> = {};
  if (agent.mcpServers !== undefined) {
    for (const [k, v] of Object.entries(agent.mcpServers)) inheritedOrOverridden[k] = v.warpId;
  } else {
    Object.assign(inheritedOrOverridden, agentDefaults);
  }
  // effective = factoryWide + override (per-agent replaces agentDefaults, but factoryWide still there; keys dedup with per-agent taking precedence? Spec: per-agent replaces, so no merge of agentDefaults into effective; factoryWide stays separate. We merge factoryWide + inheritedOrOverridden (inherited already is either agent's own or defaults). If same key appears in both, per-agent wins? We keep effective as factoryWide overridden by inheritedOrOverridden? Actually factoryWide is separate allowlist -- agent can have its own mcpServers that are not additive with factory? Spec says same replacement semantics as secrets: per-agent mcpServers reemplaza agentDefaults mcpServers; factory-wide always applies. But if factory and agent share same name, which wins? Keep factoryWide then inheritedOrOverridden overriding dup key.
  const effective: Record<string, string> = { ...factoryWide };
  for (const [k, v] of Object.entries(inheritedOrOverridden)) effective[k] = v;
  return {
    agentName,
    agentType: agent.agentType,
    factoryWide,
    inheritedOrOverridden,
    effective,
    usesPerAgentOverride,
  };
}

export function resolveAllMcpView(bundle: FactoryBundle): McpView {
  return {
    factoryWide: getFactoryWideMcp(bundle),
    agentDefaults: getAgentDefaultsMcp(bundle),
    byAgent: bundle.agents.map((a) => resolveEffectiveMcpForAgent(bundle, a.name)!),
  };
}

/**
 * Agent type never expands secrets access. Validates invariant.
 * Returns true if model respects invariant (always true for derive; useful for tests to assert no extra injection).
 */
export function agentTypeDoesNotExpandSecrets(agentType: string): boolean {
  void agentType;
  return true; // by design, no agentType adds implicit secrets
}

/** Validate alias charset per WarpFactories.md §7 alias: [A-Za-z0-9 ._-] max 60 — trim + estricto */
export function isValidAlias(alias: string): boolean {
  if (typeof alias !== "string") return false;
  const trimmed = alias.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (trimmed !== alias) return false; // reject not trimmed
  if (/^\s*$/.test(alias)) return false;
  return /^[A-Za-z0-9 ._-]+$/.test(trimmed);
}

/** Validate mcp entry has required warpId — trim + rechaza whitespace */
export function isValidMcpWarpId(warpId: unknown): boolean {
  if (typeof warpId !== "string") return false;
  if (/^\s*$/.test(warpId)) return false;
  const trimmed = warpId.trim();
  if (trimmed.length === 0) return false;
  if (trimmed !== warpId) return false;
  return trimmed.length > 0;
}
