// Barrel — curated explicit exports to avoid wildcard collisions (e.g. SelfImprovementPR)
// Consumers import from here; concretions stay hidden.
// For domain types that could collide, export with explicit names/aliases.

export * from "./domain/types";
export * from "./domain/result";
export * from "./domain/workItem.types";
export * from "./domain/workItem.machine";
export * from "./domain/workItem.rules";
export * from "./schemas/factory.schema";
export * from "./schemas/agent.schema";
export * from "./schemas/runner.schema";
export * from "./schemas/automation.schema";
export * from "./schemas/scorer.schema";
export * from "./parsers/factory.parser";
export * from "./parsers/agent.parser";
export * from "./parsers/runner.parser";
export * from "./parsers/automation.parser";
export * from "./parsers/scorer.parser";
export * from "./parsers/contracts";
export * from "./parsers/yaml.utils";
export * from "./parsers/frontmatter.utils";
export * from "./store/factoryRegistry";
export * from "./store/workItem.store";
export * from "./store/WorkItemStoreContext";
export * from "./store/workItemStore.context";
export * from "./fixtures/samples";
export * from "./fixtures/workItem.samples";
// dashboard.types exports SelfImprovementPR — explicit to avoid collision with benchmark
export type {
  SelfImprovementPR,
  DashboardMetrics,
  DashboardDeriveInput,
  ScorerCard,
  MostExpensivePR,
  TotalRunsMetric,
  TotalRunsBreakdown,
} from "./domain/dashboard.types";
export * from "./domain/dashboard.derive";
export * from "./domain/automation.engine";
export * from "./domain/run.types";
export * from "./domain/run.derive";
export * from "./domain/scorer.derive";
export * from "./domain/skill.types";
export * from "./domain/skill.registry";
export * from "./domain/runner.derive";
export * from "./domain/secrets.derive";
export * from "./domain/integrations.derive";
export * from "./domain/factory.definition.derive";
export * from "./domain/settings.derive";
// benchmark.types exports BenchmarkSelfImprovementPR — distinct name, explicit
export type {
  BenchmarkSelfImprovementPR,
  BenchmarkDefinition,
  BenchmarkTask,
  BenchmarkConfig,
  BenchmarkTrial,
  BenchmarkDerived,
  BenchmarkConfigResult,
} from "./domain/benchmark.types";
export * from "./domain/benchmark.derive";
export * from "./domain/troubleshooting.data";
export * from "./domain/integrations.deep";
export * from "./domain/infra.derive";
export * from "./domain/validation.derive";
export * from "./domain/github.routing";
export * from "./domain/github.routing.derive";
export type {
  FactoryRunRequest,
  StandaloneRunRequest,
  FollowupRequest,
  FactoryRunResponse,
  AgentRunResponse,
  FactoryApiError,
  FactoryApiResponse,
  FactoryListResponse,
  FactoryGetResponse,
  FactoryApiDependencies,
} from "./domain/factoryApi.types";
export { TICKET_REF_PATTERN, isTicketRef } from "./domain/factoryApi.types";
export { FactoryApiRouter } from "./domain/factoryApi.router";
export { createFactoryApiRuntime, resetFactoryApiRunIds } from "./domain/factoryApi.routes";
export { FACTORY_API_SNIPPETS } from "./domain/factoryApi.snippets";
export type { ApiSnippet } from "./domain/factoryApi.snippets";
export * from "./mcp/mcp.stub";

// ——— G3 (T-B) — R16: se exporta de forma explícita. `Factory*` y `Policy*` colisionan fácil. ———

export type {
  FactoryPolicy,
  GlossaryEntry,
} from "./domain/factory.policy";
export {
  DEFAULT_POLICY,
  ALTERNATE_POLICIES,
  TWO_POLICIES_MESSAGE,
  enforceSinglePolicy,
  resolvePolicy,
  FACTORY_GLOSSARY,
} from "./domain/factory.policy";

export type {
  FactoryRecord,
  CreateFactoryInput,
  FactoryValidationOptions,
  FactorySummary,
  AgentToggleKey,
  FactoryNameIssue,
  FactoryNameIssueCode,
  FactoryNameValidationResult,
} from "./domain/factory.record";
export {
  FACTORY_NAME_MAX,
  AGENT_TOGGLE_KEYS,
  DEFAULT_AGENT_TOGGLES,
  ALIAS_CHARSET_MESSAGE,
  defaultAliasFor,
  slugifyUid,
  defaultUidFor,
  suggestSeparateFactoryName,
  validateFactoryName,
  validateFactoryAlias,
  validateFactoryCreate,
  renameFactory,
} from "./domain/factory.record";

export type { KeyValuePort } from "./store/storage.port";
export {
  WORKSPACE_STORAGE_KEY,
  createMemoryPort,
  createLocalStoragePort,
} from "./store/storage.port";

export {
  FactoryWorkspaceStore,
  DEFAULT_FACTORY_SEED,
  getDefaultWorkspace,
  _resetDefaultWorkspace,
} from "./store/factoryWorkspace.store";

export type { FactoryWorkspaceApi } from "./hooks/useFactories";
export {
  FactoryWorkspaceContext,
  useFactoryWorkspaceStore,
  useFactoryWorkspace,
  useSelectedFactory,
  useCreateFactory,
} from "./hooks/useFactories";
