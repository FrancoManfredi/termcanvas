// DIP: abstractions for parsers — high-level depends on these, not concretions
import type { ParseResult } from "../domain/result";
import type { AgentDefinition, AutomationDefinition, FactoryDefinition, RunnerDefinition, ScorerDefinition } from "../domain/types";

export interface IYamlParser {
  parseYaml<T>(raw: string, file: string): ParseResult<T>;
}

export interface IMarkdownParser {
  parseMarkdownWithFrontmatter<T>(raw: string, file: string): ParseResult<{ frontmatter: T; body: string }>;
}

export interface IFactoryParser {
  parseFactoryYaml(raw: string, file?: string): ParseResult<FactoryDefinition>;
}

export interface IAgentParser {
  parseAgentMd(raw: string, file: string): ParseResult<AgentDefinition>;
}

export interface IRunnerParser {
  parseRunnerYaml(raw: string, file: string): ParseResult<RunnerDefinition>;
}

export interface IAutomationParser {
  parseAutomationMd(raw: string, file: string): ParseResult<AutomationDefinition>;
}

export interface IScorerParser {
  parseScorerMd(raw: string, file: string): ParseResult<ScorerDefinition>;
}
