import { parse as yamlParse } from "yaml";
import { ParseResult } from "../domain/result";


// Browser-safe frontmatter parser — replaces gray-matter (which needs Buffer)
// Extracts YAML between --- delimiters and returns { data, content }
// SRP: only string splitting + YAML parse, no domain validation

export function parseFrontmatter<T extends object>(raw: string, file: string): ParseResult<{ data: T; content: string }> {

  // Normalize line endings
  const normalized = raw.replace(/\r\n/g, "\n");

  // Must start with --- (allow leading whitespace/newlines)
  const trimmedStart = normalized.trimStart();
  if (!trimmedStart.startsWith("---")) {
    return ParseResult.singleFail(file, "missing frontmatter opening '---'", "frontmatter_syntax");
  }

  // Find second --- delimiter (on its own line)
  const firstDelimEnd = trimmedStart.indexOf("\n");
  if (firstDelimEnd === -1) {
    return ParseResult.singleFail(file, "invalid frontmatter: opening '---' without newline", "frontmatter_syntax");
  }

  const afterFirst = trimmedStart.slice(firstDelimEnd + 1);
  const match = afterFirst.match(/^---\s*$/m);

  if (!match || match.index === undefined) {
    return ParseResult.singleFail(file, "missing frontmatter closing '---'", "frontmatter_syntax");
  }

  const yamlContent = afterFirst.slice(0, match.index);
  const content = afterFirst.slice(match.index + match[0].length).replace(/^\n/, "");


  if (!yamlContent.trim()) {
    return ParseResult.ok({ data: {} as T, content: content.trim() });
  }

  try {
    const data = yamlParse(yamlContent) as T;
    if (data === null || data === undefined) {
      return ParseResult.ok({ data: {} as T, content: content.trim() });
    }
    if (typeof data !== "object" || Array.isArray(data)) {
      return ParseResult.singleFail(file, "frontmatter must be a YAML object", "frontmatter_syntax");
    }
    return ParseResult.ok({ data, content: content.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return ParseResult.singleFail(file, `frontmatter YAML error: ${msg}`, "frontmatter_syntax");
  }
}
