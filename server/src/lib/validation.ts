// validation.ts — server side re-exports of domain validation (no import from web to keep server isolated)
// Keeps same codes as web/domain for test parity

export const TICKET_REF_PATTERN = /^[a-z]+:[A-Za-z0-9-_]+$/;

export function isTicketRef(value: string): boolean {
  return TICKET_REF_PATTERN.test(value);
}

export const FACTORY_NAME_MAX = 60;
export const ALIAS_PATTERN = /^[A-Za-z0-9 ._-]+$/;

export function defaultAliasFor(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FACTORY_NAME_MAX)
    .trim();
}

export function slugifyUid(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let uidSeq = 0;
export function defaultUidFor(name: string): string {
  uidSeq += 1;
  return `uid_${slugifyUid(name) || "factory"}_${uidSeq}`;
}
export function resetUidSeq(): void {
  uidSeq = 0;
}

export type FactoryValidationIssue = { path: string; message: string; code: string };

function validateForemanAlias(
  alias: string | undefined,
  opts: { existingAliases?: string[] } = {}
): { ok: boolean; issues: { code: string; message: string }[] } {
  const issues: { code: string; message: string }[] = [];
  const existing = opts.existingAliases ?? [];
  if (alias === undefined || alias === null || alias.trim() === "") {
    issues.push({ code: "alias_required", message: "alias required" });
    return { ok: false, issues };
  }
  if (alias.length > FACTORY_NAME_MAX) {
    issues.push({ code: "alias_length", message: `alias max ${FACTORY_NAME_MAX}` });
  }
  if (!ALIAS_PATTERN.test(alias)) {
    issues.push({ code: "alias_charset", message: "alias: allowed [A-Za-z0-9 ._-]" });
  }
  const lower = alias.toLowerCase();
  if (existing.some((a) => a.toLowerCase() === lower)) {
    issues.push({ code: "alias_unique", message: "alias unique case-insensitive" });
  }
  return { ok: issues.length === 0, issues };
}

const NAME_CODE_BY_ALIAS_CODE: Record<string, string> = {
  alias_required: "missing_name",
  alias_charset: "name_charset",
  alias_length: "name_length",
  alias_unique: "name_unique",
};

const NAME_MESSAGE_BY_ALIAS_CODE: Record<string, string> = {
  alias_required: "El nombre de la factory es obligatorio",
  alias_charset: "nombre solo [A-Za-z0-9 ._-]",
  alias_length: `nombre max ${FACTORY_NAME_MAX} caracteres`,
  alias_unique: "Ya existe una factory con ese nombre (case-insensitive)",
};

const ALIAS_MESSAGE_BY_CODE: Record<string, string> = {
  alias_required: "El alias (Foreman name) es obligatorio",
  alias_charset: `alias solo [A-Za-z0-9 ._-], max ${FACTORY_NAME_MAX}`,
  alias_length: `alias max ${FACTORY_NAME_MAX} caracteres`,
  alias_unique: "Ya existe una factory con ese alias (case-insensitive)",
};

export interface FactoryRecord {
  uid: string;
  name: string;
  alias: string;
  description?: string;
  repositories: readonly { owner: string; name: string }[];
  integrations: readonly string[];
  agentToggles: Record<string, boolean>;
  policyId: string;
  createdAt: string;
  pinned?: boolean;
}

export interface FactorySummary {
  uid: string;
  name: string;
  alias: string;
  repositoryCount: number;
  integrationCount: number;
  policyId: string;
  createdAt: string;
}

export interface CreateFactoryInput {
  name: string;
  alias?: string;
  description?: string;
  repositories?: readonly { owner: string; name: string }[];
  integrations?: readonly string[];
  agentToggles?: Record<string, boolean>;
  pinned?: boolean;
}

export function validateFactoryCreate(
  input: CreateFactoryInput,
  opts: { existing?: readonly FactoryRecord[]; now?: () => string; uid?: (name: string) => string } = {}
): { ok: boolean; issues: FactoryValidationIssue[]; value?: FactoryRecord } {
  const existing = opts.existing ?? [];
  const now = opts.now ?? (() => new Date().toISOString());
  const uidFor = opts.uid ?? defaultUidFor;

  const name = input.name?.trim() ?? "";
  const issues: FactoryValidationIssue[] = [];

  // validate name via alias logic
  const nameResult = validateForemanAlias(name, { existingAliases: existing.map((r) => r.name) });
  for (const iss of nameResult.issues) {
    const code = NAME_CODE_BY_ALIAS_CODE[iss.code] ?? iss.code;
    const message = NAME_MESSAGE_BY_ALIAS_CODE[iss.code] ?? iss.message;
    issues.push({ path: "name", message, code });
  }

  const rawAlias = input.alias?.trim() ?? "";
  const alias = rawAlias === "" ? defaultAliasFor(name) : (input.alias ?? "").trim();
  const aliasResult = validateForemanAlias(alias, { existingAliases: existing.map((r) => r.alias) });
  for (const iss of aliasResult.issues) {
    const message = ALIAS_MESSAGE_BY_CODE[iss.code] ?? iss.message;
    issues.push({ path: "alias", message, code: iss.code });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const record: FactoryRecord = {
    uid: uidFor(name),
    name,
    alias,
    description: input.description?.trim() ? input.description.trim() : undefined,
    repositories: input.repositories ?? [],
    integrations: input.integrations ?? [],
    agentToggles: { triage: true, spec: true, implement: true, review: true, ...(input.agentToggles ?? {}) },
    policyId: "default",
    createdAt: now(),
    pinned: input.pinned,
  };
  return { ok: true, issues: [], value: record };
}

export function toFactorySummary(record: FactoryRecord): FactorySummary {
  return {
    uid: record.uid,
    name: record.name,
    alias: record.alias,
    repositoryCount: record.repositories.length,
    integrationCount: record.integrations.length,
    policyId: record.policyId,
    createdAt: record.createdAt,
  };
}

// search helper case-insensitive
export function matchesSearch(record: FactoryRecord | FactorySummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (record as FactoryRecord).name ?? (record as FactorySummary).name;
  const alias = (record as FactoryRecord).alias ?? (record as FactorySummary).alias;
  return name.toLowerCase().includes(q) || alias.toLowerCase().includes(q);
}
