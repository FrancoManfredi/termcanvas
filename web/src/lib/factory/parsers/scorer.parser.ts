import { scorerFrontmatterSchema } from "../schemas/scorer.schema";
import { zodToParseIssues } from "../schemas/common.schema";
import { ParseResult } from "../domain/result";
import type { ScorerDefinition } from "../domain/types";
import type { IScorerParser } from "./contracts";
import { parseFrontmatter } from "./frontmatter.utils";


function extractScorerSlug(file: string): string {
  const parts = file.split("/").filter(Boolean);
  const idx = parts.indexOf("scorers");
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  return (parts.pop() ?? file).replace(/\.md$/, "");
}

export class ScorerParser implements IScorerParser {
  parseScorerMd(raw: string, file: string): ParseResult<ScorerDefinition> {
    if (!raw.trim()) return ParseResult.singleFail(file, "empty scorer.md", "empty_input");
    const fmRes = parseFrontmatter<Record<string, unknown>>(raw, file);
    if (!fmRes.ok) return ParseResult.fail(fmRes.issues);
    const fm = fmRes.value!.data;
    const rubric = fmRes.value!.content;
    const validated = scorerFrontmatterSchema.safeParse(fm);
    if (!validated.success) {
      const fmRaw = raw.split("---")[1] ?? "";
      return ParseResult.fail(zodToParseIssues(validated.error, file, fmRaw));
    }
    if (!rubric) return ParseResult.singleFail(file, "scorer.md rubric body must not be empty", "missing_body");

    const def: ScorerDefinition = {
      slug: extractScorerSlug(file),
      name: validated.data.name,
      description: validated.data.description,
      agents: validated.data.agents,
      output: validated.data.output as ScorerDefinition["output"],
      labels: validated.data.labels,
      passingScore: validated.data.passingScore,
      samplingRate: validated.data.samplingRate,
      model: validated.data.model,
      selfImprovement: validated.data.selfImprovement,
      rubric,
      rawPath: file,
    };
    return ParseResult.ok(def);
  }
}

export function parseScorerMd(raw: string, file: string): ParseResult<ScorerDefinition> {
  return new ScorerParser().parseScorerMd(raw, file);
}
