import { parse as yamlParse } from "yaml";
import type { ParseResult } from "../domain/result";
import { ParseResult as PR } from "../domain/result";


// SRP: only YAML parsing, no domain validation

function hasProtoPollution(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some(hasProtoPollution);
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key.startsWith("__proto__") || key === "constructor" || key === "prototype") return true;
    if (hasProtoPollution(obj[key])) return true;
  }
  return false;
}

export function parseYamlSafe<T>(raw: string, file: string): ParseResult<T> {
  if (!raw.trim()) {
    return PR.singleFail<T>(file, "empty YAML input", "empty_input");
  }
  try {
    const data = yamlParse(raw, { prettyErrors: true, customTags: [], merge: false, maxAliasCount: 50 } as unknown as Record<string, unknown>) as T;
    // yaml can return null for empty doc
    if (data === null || data === undefined) {
      return PR.singleFail<T>(file, "YAML parsed to null/undefined", "yaml_null");
    }
    if (hasProtoPollution(data)) {
      return PR.singleFail<T>(file, "YAML contains forbidden prototype key (__proto__)", "proto_pollution");
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
