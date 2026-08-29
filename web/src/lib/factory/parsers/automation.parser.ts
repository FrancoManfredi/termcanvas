import { automationFrontmatterSchema } from "../schemas/automation.schema";
import { zodToParseIssues } from "../schemas/common.schema";
import { ParseResult } from "../domain/result";
import type { AutomationDefinition } from "../domain/types";
import type { IAutomationParser } from "./contracts";
import { parseFrontmatter } from "./frontmatter.utils";


function extractAutomationName(file: string): string {
  const parts = file.split("/").filter(Boolean);
  const idx = parts.indexOf("automations");
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  return (parts.pop() ?? file).replace(/\.md$/, "");
}

export class AutomationParser implements IAutomationParser {
  parseAutomationMd(raw: string, file: string): ParseResult<AutomationDefinition> {
    if (!raw.trim()) return ParseResult.singleFail(file, "empty automation.md", "empty_input");
    const fmRes = parseFrontmatter<Record<string, unknown>>(raw, file);
    if (!fmRes.ok) return ParseResult.fail(fmRes.issues);
    const fm = fmRes.value!.data;
    const body = fmRes.value!.content;
    const validated = automationFrontmatterSchema.safeParse(fm);
    if (!validated.success) {
      return ParseResult.fail(zodToParseIssues(validated.error, file));
    }
    if (!body) return ParseResult.singleFail(file, "automation.md body (prompt) must not be empty", "missing_body");

    const def: AutomationDefinition = {
      name: extractAutomationName(file),
      enabled: validated.data.enabled ?? true,
      agent: validated.data.agent ?? "foreman",
      triggers: validated.data.triggers as AutomationDefinition["triggers"],
      model: validated.data.model,
      harness: validated.data.harness as AutomationDefinition["harness"],
      runner: validated.data.runner,
      environmentId: validated.data.environmentId,
      secrets: validated.data.secrets,
      mcpServers: validated.data.mcpServers as AutomationDefinition["mcpServers"],
      workerHost: validated.data.workerHost,
      prompt: body,
      rawPath: file,
    };
    return ParseResult.ok(def);
  }
}

export function parseAutomationMd(raw: string, file: string): ParseResult<AutomationDefinition> {
  return new AutomationParser().parseAutomationMd(raw, file);
}
