import { parseYamlSafe } from "./yaml.utils";
import { runnerYamlSchema } from "../schemas/runner.schema";
import { zodToParseIssues } from "../schemas/common.schema";
import { ParseResult } from "../domain/result";
import type { RunnerDefinition } from "../domain/types";
import type { IRunnerParser } from "./contracts";


function extractRunnerName(file: string): string {
  const base = file.split("/").pop() ?? file;
  const name = base.replace(/\.ya?ml$/, "");
  return name;
}

export class RunnerParser implements IRunnerParser {
  parseRunnerYaml(raw: string, file: string): ParseResult<RunnerDefinition> {
    const yamlRes = parseYamlSafe<unknown>(raw, file);
    if (!yamlRes.ok) {
      return ParseResult.fail(yamlRes.issues);
    }
    const validated = runnerYamlSchema.safeParse(yamlRes.value);
    if (!validated.success) {
      return ParseResult.fail(zodToParseIssues(validated.error, file));
    }
    const def: RunnerDefinition = {
      name: extractRunnerName(file),
      description: validated.data.description,
      setupCommands: validated.data.setupCommands,
      instanceShape: validated.data.instanceShape,
      platform: validated.data.platform as RunnerDefinition["platform"],
      rawPath: file,
    };
    return ParseResult.ok(def);
  }
}

export function parseRunnerYaml(raw: string, file: string): ParseResult<RunnerDefinition> {
  return new RunnerParser().parseRunnerYaml(raw, file);
}
