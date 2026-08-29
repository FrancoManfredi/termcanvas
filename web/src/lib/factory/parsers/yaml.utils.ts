import { parse as yamlParse } from "yaml";
import type { ParseResult } from "../domain/result";
import { ParseResult as PR } from "../domain/result";


// SRP: only YAML parsing, no domain validation

export function parseYamlSafe<T>(raw: string, file: string): ParseResult<T> {
  if (!raw.trim()) {
    return PR.singleFail<T>(file, "empty YAML input", "empty_input");
  }
  try {
    const data = yamlParse(raw, { prettyErrors: true }) as T;
    // yaml can return null for empty doc
    if (data === null || data === undefined) {
      return PR.singleFail<T>(file, "YAML parsed to null/undefined", "yaml_null");
    }
    return PR.ok(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return PR.singleFail<T>(file, `YAML syntax error: ${msg}`, "yaml_syntax");
  }
}

export function parseFrontmatterSafe<T>(raw: string, file: string): ParseResult<{ data: T; body: string }> {
  void raw;
  try {
    // Use gray-matter dynamically to avoid top-level import issues in tests
    // but we import it statically where used; this util is generic
    const { parseYamlSafe: _ } = { parseYamlSafe };
    void _;
    return PR.singleFail(file, "use matter parser explicitly", "not_implemented");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return PR.singleFail(file, msg, "frontmatter_error");
  }
}
