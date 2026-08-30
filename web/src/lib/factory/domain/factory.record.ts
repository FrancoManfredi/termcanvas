// FactoryRecord — SRP: solo forma y validación de una factory-instancia (§2 Factory vs Warp Factories).
// DIP: la unicidad se comprueba contra una lista inyectada; no lee stores.
// Source: WarpFactories.md §2, §10 Settings Identity, §14 Sizing · US-001, US-002

import { ParseResult } from "./result";
import type { ParseIssue } from "./result";
import { validateForemanAlias, normalizeAlias } from "./settings.derive";
import type { AliasValidationResult } from "./settings.derive";
import { DEFAULT_POLICY } from "./factory.policy";
// Solo tipo: `suggestSeparateFactoryName` vive aquí para no crear un ciclo de valores
// factory.record ↔ factory.policy (factory.record ya importa DEFAULT_POLICY como valor).
import type { FactoryPolicy } from "./factory.policy";
import type { IntegrationType, RepositoryRef } from "./types";

export const FACTORY_NAME_MAX = 60;
export const AGENT_TOGGLE_KEYS = ["triage", "spec", "implement", "review"] as const;
export type AgentToggleKey = (typeof AGENT_TOGGLE_KEYS)[number];

/** §5.2 — los cuatro especialistas vienen activados por defecto (§4 defaults). */
export const DEFAULT_AGENT_TOGGLES: Readonly<Record<AgentToggleKey, boolean>> = {
  triage: true,
  spec: true,
  implement: true,
  review: true,
};

export interface FactoryRecord {
  readonly uid: string; // "uid_<slug>_<n>"
  readonly name: string; // requerido (US-001)
  readonly alias: string; // Foreman name — auto-copia name (US-001)
  readonly description?: string;
  readonly repositories: readonly RepositoryRef[];
  readonly integrations: readonly IntegrationType[];
  readonly agentToggles: Readonly<Record<AgentToggleKey, boolean>>;
  readonly policyId: string; // una factory = una policy (US-005)
  readonly createdAt: string;
  /** §5.3: el pin del sidebar es un estado real por factory, persistido. */
  readonly pinned?: boolean;
}

/** Forma reducida que consume G2 (Factory API). */
export interface FactorySummary {
  readonly uid: string;
  readonly name: string;
  readonly alias: string;
  readonly repositoryCount: number;
  readonly integrationCount: number;
  readonly policyId: string;
  readonly createdAt: string;
}

export interface CreateFactoryInput {
  readonly name: string;
  readonly alias?: string; // ausente → defaultAliasFor(name)
  readonly description?: string;
  readonly repositories?: readonly RepositoryRef[];
  readonly integrations?: readonly IntegrationType[];
  readonly agentToggles?: Readonly<Record<AgentToggleKey, boolean>>;
  readonly pinned?: boolean;
}

export interface FactoryValidationOptions {
  readonly existing?: readonly FactoryRecord[];
  readonly now?: () => string;
  readonly uid?: (name: string) => string;
}

// ——— códigos y mensajes ———

export type FactoryNameIssueCode =
  | "missing_name"
  | "name_charset"
  | "name_length"
  | "name_unique";

export interface FactoryNameIssue {
  code: FactoryNameIssueCode;
  message: string;
}

/** Misma forma que `AliasValidationResult` de settings.derive, con los códigos propios del nombre. */
export interface FactoryNameValidationResult {
  ok: boolean;
  issues: FactoryNameIssue[];
}

/** `validateForemanAlias` devuelve códigos `alias_*`; el nombre los remapea a `name_*`. */
const NAME_CODE_BY_ALIAS_CODE = {
  alias_required: "missing_name",
  alias_charset: "name_charset",
  alias_length: "name_length",
  alias_unique: "name_unique",
} as const;

const NAME_MESSAGE_BY_ALIAS_CODE: Record<string, string> = {
  alias_required: "El nombre de la factory es obligatorio",
  alias_charset: "nombre solo [A-Za-z0-9 ._-]",
  alias_length: `nombre max ${FACTORY_NAME_MAX} caracteres`,
  alias_unique: "Ya existe una factory con ese nombre (case-insensitive)",
};

/** US-001 fija el literal para el charset del alias. */
export const ALIAS_CHARSET_MESSAGE = `alias solo [A-Za-z0-9 ._-], max ${FACTORY_NAME_MAX}`;

const ALIAS_MESSAGE_BY_CODE: Record<string, string> = {
  alias_required: "El alias (Foreman name) es obligatorio",
  alias_charset: ALIAS_CHARSET_MESSAGE,
  alias_length: `alias max ${FACTORY_NAME_MAX} caracteres`,
  alias_unique: "Ya existe una factory con ese alias (case-insensitive)",
};

// ——— helpers puros ———

/** Alias por defecto: el name recortado a 60 y con el charset saneado (§10 Identity). */
export function defaultAliasFor(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FACTORY_NAME_MAX)
    .trim();
}

/** Slug estable para el uid: minúsculas, sin caracteres fuera de [a-z0-9._-]. */
export function slugifyUid(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let uidSeq = 0;

/** Generador por defecto de uids — `uid_<slug>_<n>`. Los tests inyectan `opts.uid`. */
export function defaultUidFor(name: string): string {
  uidSeq += 1;
  return `uid_${slugifyUid(name) || "factory"}_${uidSeq}`;
}

/** Test seam: deja el contador de uids en cero. */
export function _resetUidSeq(): void {
  uidSeq = 0;
}

// ——— validación ———

/**
 * Valida el nombre de la factory delegando las reglas en `settings.derive`
 * (≤60, charset `[A-Za-z0-9 ._-]`, único case-insensitive) y remapeando los códigos.
 */
export function validateFactoryName(
  name: string,
  existing: readonly FactoryRecord[] = []
): FactoryNameValidationResult {
  const result = validateForemanAlias(name, { existingAliases: existing.map((r) => r.name) });
  const issues: FactoryNameIssue[] = result.issues.map((issue) => ({
    code: NAME_CODE_BY_ALIAS_CODE[issue.code],
    message: NAME_MESSAGE_BY_ALIAS_CODE[issue.code] ?? issue.message,
  }));
  return { ok: issues.length === 0, issues };
}

/** Delega en `settings.derive.validateForemanAlias`; solo traduce el mensaje al español de UI. */
export function validateFactoryAlias(
  alias: string,
  existing: readonly FactoryRecord[] = []
): AliasValidationResult {
  const result = validateForemanAlias(alias, { existingAliases: existing.map((r) => r.alias) });
  return {
    ok: result.ok,
    issues: result.issues.map((issue) => ({
      code: issue.code,
      message: ALIAS_MESSAGE_BY_CODE[issue.code] ?? issue.message,
    })),
  };
}

/** Alta: valida nombre + alias y devuelve el record inmutable listo para persistir. */
export function validateFactoryCreate(
  input: CreateFactoryInput,
  opts: FactoryValidationOptions = {}
): ParseResult<FactoryRecord> {
  const existing = opts.existing ?? [];
  const now = opts.now ?? (() => new Date().toISOString());
  const uidFor = opts.uid ?? defaultUidFor;

  const name = input.name?.trim() ?? "";
  const issues: ParseIssue[] = [];

  const nameResult = validateFactoryName(name, existing);
  for (const issue of nameResult.issues) {
    issues.push({ path: "name", message: issue.message, code: issue.code });
  }

  const rawAlias = input.alias?.trim() ?? "";
  const alias = rawAlias === "" ? defaultAliasFor(name) : normalizeAlias(input.alias ?? "");
  const aliasResult = validateFactoryAlias(alias, existing);
  for (const issue of aliasResult.issues) {
    issues.push({ path: "alias", message: issue.message, code: issue.code });
  }

  if (issues.length > 0) {
    return ParseResult.fail<FactoryRecord>(issues);
  }

  const record: FactoryRecord = {
    uid: uidFor(name),
    name,
    alias,
    description: input.description?.trim() ? input.description.trim() : undefined,
    repositories: input.repositories ?? [],
    integrations: input.integrations ?? [],
    agentToggles: { ...DEFAULT_AGENT_TOGGLES, ...(input.agentToggles ?? {}) },
    policyId: DEFAULT_POLICY.id,
    createdAt: now(),
    pinned: input.pinned,
  };
  return ParseResult.ok(record);
}

/**
 * US-005: atajo para el error `two_policies`. Devuelve el nombre sugerido de la factory
 * separada que sí puede llevar la policy candidata, ya saneado y recortado al máximo
 * para que entre derecho en la validación de alta.
 */
export function suggestSeparateFactoryName(
  record: FactoryRecord,
  candidate: FactoryPolicy
): string {
  return defaultAliasFor(`${record.name}-${candidate.id}`);
}

/** Renombrar: revalida el record mergeado contra el resto de las factories (excluyéndose a sí mismo). */
export function renameFactory(
  record: FactoryRecord,
  patch: Partial<CreateFactoryInput>,
  existing: readonly FactoryRecord[]
): ParseResult<FactoryRecord> {
  const others = existing.filter((r) => r.uid !== record.uid);
  const merged: CreateFactoryInput = {
    name: patch.name ?? record.name,
    alias: patch.alias ?? record.alias,
    description: patch.description ?? record.description,
    repositories: patch.repositories ?? record.repositories,
    integrations: patch.integrations ?? record.integrations,
    agentToggles: patch.agentToggles ?? record.agentToggles,
    pinned: patch.pinned ?? record.pinned,
  };
  // El uid, el policyId y el createdAt se preservan: renombrar no crea una factory nueva.
  const result = validateFactoryCreate(merged, {
    existing: others,
    now: () => record.createdAt,
    uid: () => record.uid,
  });
  if (!result.ok || result.value === undefined) {
    return ParseResult.fail<FactoryRecord>(result.issues);
  }
  return ParseResult.ok<FactoryRecord>({
    ...result.value,
    createdAt: record.createdAt,
    policyId: record.policyId,
    pinned: merged.pinned,
  });
}
