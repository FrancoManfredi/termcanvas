import { parseYamlSafe } from "./yaml.utils";
import { factoryYamlSchema } from "../schemas/factory.schema";
import { zodToParseIssues } from "../schemas/common.schema";
import { ParseResult } from "../domain/result";
import type { FactoryDefinition } from "../domain/types";
import type { IFactoryParser } from "./contracts";


// SRP: only factory.yaml parsing + validation
// OCP: accepts raw string, not file system — extend via wrapper for file I/O later
// DIP: depends on zod schema abstraction, not concrete file access

export class FactoryParser implements IFactoryParser {
  parseFactoryYaml(raw: string, file = "factory.yaml"): ParseResult<FactoryDefinition> {
    const yamlRes = parseYamlSafe<unknown>(raw, file);
    if (!yamlRes.ok) {
      return ParseResult.fail(yamlRes.issues);
    }

    const parsed = factoryYamlSchema.safeParse(yamlRes.value);
    if (!parsed.success) {
      const issues = zodToParseIssues(parsed.error, file);
      return ParseResult.fail(issues);
    }

    // Narrowing: zod output already matches FactoryDefinition shape
    return ParseResult.ok(parsed.data as FactoryDefinition);
  }
}

// Convenience functional wrapper (keeps interface segregation — callers can use function directly)
export function parseFactoryYaml(raw: string, file = "factory.yaml"): ParseResult<FactoryDefinition> {
  return new FactoryParser().parseFactoryYaml(raw, file);
}
