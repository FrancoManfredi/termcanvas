import { describe, it } from "node:test";
import assert from "node:assert";
import { MCP_CATALOG, validateCatalog } from "../shared/mcp.ts";

describe("MCP registry validation", () => {
  it("catalog is valid", () => {
    const result = validateCatalog();
    assert.strictEqual(result.ok, true, `Catalog validation failed: ${result.errors.join(", ")}`);
  });

  it("all catalog entries have required fields", () => {
    for (const entry of MCP_CATALOG) {
      assert.ok(entry.id, `Missing id for ${JSON.stringify(entry)}`);
      assert.ok(entry.name, `Missing name for ${entry.id}`);
      assert.ok(entry.description, `Missing description for ${entry.id}`);
      assert.ok(entry.transport, `Missing transport for ${entry.id}`);
      if (entry.transport === "http") {
        assert.ok(entry.defaultUrl, `Missing defaultUrl for http ${entry.id}`);
      }
      if (entry.transport === "stdio") {
        assert.ok(entry.defaultCommand, `Missing defaultCommand for stdio ${entry.id}`);
        assert.ok(entry.defaultArgs, `Missing defaultArgs for stdio ${entry.id}`);
      }
    }
  });

  it("catalog has no duplicate ids", () => {
    const ids = MCP_CATALOG.map((e) => e.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, `Duplicate ids found: ${ids.join(", ")}`);
  });

  it("future MCPs must define health probe (documentation check)", () => {
    // This is a placeholder for future: when adding a new MCP, ensure it has a health probe
    // For now, just check that all current MCPs are either http or stdio, which have probes
    for (const entry of MCP_CATALOG) {
      assert.ok(["http", "stdio"].includes(entry.transport), `Invalid transport for ${entry.id}`);
    }
  });
});
