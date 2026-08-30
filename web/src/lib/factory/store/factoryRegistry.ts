// FactoryRegistry — SRP: aggregates parsed definitions, no I/O
// OCP: add new definition types without modifying existing code via registry pattern
// DIP: depends on parser abstractions injected via constructor

import { ParseResult } from "../domain/result";
import type { AgentDefinition, AutomationDefinition, FactoryDefinition, RunnerDefinition, ScorerDefinition } from "../domain/types";
import type { SkillDefinition } from "../domain/skill.types";
import { FactoryParser } from "../parsers/factory.parser";
import { AgentParser } from "../parsers/agent.parser";
import { RunnerParser } from "../parsers/runner.parser";
import { AutomationParser } from "../parsers/automation.parser";
import { ScorerParser } from "../parsers/scorer.parser";
import { parseSkillMd } from "../domain/skill.registry";


export interface FactoryBundle {
  factory: FactoryDefinition;
  agents: AgentDefinition[];
  runners: RunnerDefinition[];
  automations: AutomationDefinition[];
  scorers: ScorerDefinition[];
  skills: SkillDefinition[];
}

export interface RegistryInput {
  factoryYaml: { raw: string; file: string };
  agents: { raw: string; file: string }[];
  runners: { raw: string; file: string }[];
  automations: { raw: string; file: string }[];
  scorers: { raw: string; file: string }[];
  skills?: { raw: string; file: string }[];
}

export class FactoryRegistry {
  private factoryParser: FactoryParser;
  private agentParser: AgentParser;
  private runnerParser: RunnerParser;
  private automationParser: AutomationParser;
  private scorerParser: ScorerParser;

  constructor(
    factoryParser = new FactoryParser(),
    agentParser = new AgentParser(),
    runnerParser = new RunnerParser(),
    automationParser = new AutomationParser(),
    scorerParser = new ScorerParser()
  ) {
    this.factoryParser = factoryParser;
    this.agentParser = agentParser;
    this.runnerParser = runnerParser;
    this.automationParser = automationParser;
    this.scorerParser = scorerParser;
  }

  // Single Responsibility: only orchestrate parsing, not validate business rules across bundle
  parseBundle(input: RegistryInput): ParseResult<FactoryBundle> {

    const factoryRes = this.factoryParser.parseFactoryYaml(input.factoryYaml.raw, input.factoryYaml.file);
    if (!factoryRes.ok) {
      return ParseResult.fail(factoryRes.issues);
    }

    const agentResults = input.agents.map((a) => {
      return this.agentParser.parseAgentMd(a.raw, a.file);
    });
    const runnerResults = input.runners.map((r) => {
      return this.runnerParser.parseRunnerYaml(r.raw, r.file);
    });
    const automationResults = input.automations.map((a) => {
      return this.automationParser.parseAutomationMd(a.raw, a.file);
    });
    const scorerResults = input.scorers.map((s) => {
      return this.scorerParser.parseScorerMd(s.raw, s.file);
    });
    const skillResults = (input.skills ?? []).map((s) => parseSkillMd(s.raw, s.file));

    // Collect issues flat — keep ISP: caller sees single issue list
    const allResults: ParseResult<unknown>[] = [...agentResults, ...runnerResults, ...automationResults, ...scorerResults, ...skillResults];
    const failedIssues = allResults.flatMap((r) => (r.ok ? [] : r.issues));
    if (failedIssues.length > 0) {
      // also include factory issues if any (already handled)
      return ParseResult.fail([...failedIssues]);
    }

    // Validate cross-bundle invariants (LSP: these checks don't mutate definitions)
    const foremanCount = agentResults.filter((r) => r.value?.agentType === "FOREMAN" || r.value?.agentType === "MAIN").length;
    if (foremanCount !== 1) {
      return ParseResult.singleFail("agents", `exactly one FOREMAN required, found ${foremanCount}`, "foreman_count");
    }

    // Validate runner references exist
    const runnerNames = new Set(runnerResults.map((r) => r.value!.name));
    const referencedRunners = [factoryRes.value!.agentDefaults.runner, ...agentResults.map((r) => r.value!.runner)].filter(Boolean) as string[];
    for (const ref of referencedRunners) {
      if (!runnerNames.has(ref)) {
        return ParseResult.singleFail("runners", `referenced runner '${ref}' not found`, "missing_runner");
      }
    }

    const bundle: FactoryBundle = {
      factory: factoryRes.value!,
      agents: agentResults.map((r) => r.value!),
      runners: runnerResults.map((r) => r.value!),
      automations: automationResults.map((r) => r.value!),
      scorers: scorerResults.map((r) => r.value!),
      skills: skillResults.map((r) => r.value!),
    };

    return ParseResult.ok(bundle);
  }

  // Convenience: parse minimal bundle (factory + foreman) for quick smoke
  parseMinimal(factoryRaw: string, foremanRaw: string): ParseResult<FactoryBundle> {
    return this.parseBundle({
      factoryYaml: { raw: factoryRaw, file: "factory.yaml" },
      agents: [{ raw: foremanRaw, file: "agents/foreman/agent.md" }],
      runners: [],
      automations: [],
      scorers: [],
    });
  }
}

// Functional wrapper — keeps DIP: tests can use class, app can use function
export function parseFactoryBundle(input: RegistryInput): ParseResult<FactoryBundle> {
  return new FactoryRegistry().parseBundle(input);
}
