import { agentFrontmatterSchema } from "../schemas/agent.schema";
import { zodToParseIssues } from "../schemas/common.schema";
import { ParseResult } from "../domain/result";
import type { AgentDefinition } from "../domain/types";
import type { IAgentParser } from "./contracts";
import { parseFrontmatter } from "./frontmatter.utils";
import { parseFrontmatterWithLineCounter } from "../domain/validation.lineCounter";

function extractNameFromPath(file: string): string {
  const parts = file.split("/").filter(Boolean);
  const idx = parts.indexOf("agents");
  if (idx !== -1 && parts[idx + 1]) {
    return parts[idx + 1];
  }
  const last = parts[parts.length - 1] ?? file;
  const name = last.replace(/\.md$/, "");
  return name;
}

export class AgentParser implements IAgentParser {
  parseAgentMd(raw: string, file: string): ParseResult<AgentDefinition> {
    if (!raw.trim()) {
      return ParseResult.singleFail(file, "empty agent.md", "empty_input");
    }
    const fmRes = parseFrontmatter<Record<string, unknown>>(raw, file);
    if (!fmRes.ok) {
      return ParseResult.fail(fmRes.issues);
    }
    const fm = fmRes.value!.data;
    const body = fmRes.value!.content;

    const validated = agentFrontmatterSchema.safeParse(fm);
    if (!validated.success) {
      // Pass raw frontmatter YAML for line resolution with LineCounter + offset
      const fmRaw = raw.split("---")[1] ?? "";
      const { lineCounter } = parseFrontmatterWithLineCounter(raw);
      return ParseResult.fail(zodToParseIssues(validated.error, file, fmRaw, lineCounter));
    }

    if (!body) {
      return ParseResult.singleFail(file, "agent.md body (instructions) must not be empty", "missing_body");
    }

    const name = extractNameFromPath(file);
    const result: AgentDefinition = {
      name,
      description: validated.data.description,
      agentType: (validated.data.agentType ?? "CUSTOM") as AgentDefinition["agentType"],
      credentialStrategy: validated.data.credentialStrategy,
      model: validated.data.model,
      harness: validated.data.harness as AgentDefinition["harness"],
      runner: validated.data.runner,
      environmentId: validated.data.environmentId,
      secrets: validated.data.secrets,
      mcpServers: validated.data.mcpServers,
      workerHost: validated.data.workerHost,
      instructions: body,
      rawPath: file,
    };
    return ParseResult.ok(result);
  }
}

export function parseAgentMd(raw: string, file: string): ParseResult<AgentDefinition> {
  return new AgentParser().parseAgentMd(raw, file);
}
