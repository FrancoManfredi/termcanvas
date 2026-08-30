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
export * from "./mcp/mcp.stub";
