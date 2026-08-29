import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentsMdIntoBlocks, concatBlocksToAgentsMd } from "../shared/neutral/instructions.ts";
import { isValidSkillName, toNeutralSkillFromRegistry } from "../shared/neutral/skills.ts";
import { MCP_CATALOG, sanitizeProjectMcpConfig, defaultProjectMcpConfig } from "../shared/neutral/mcp.ts";

describe("neutral harness contracts", () => {
  it("MCP catalog preserves engram and codegraph", () => {
    // codegraph and engram are NOT in shared/mcp.ts catalog by default (they are opencode-level)
    // but our neutral adapter must handle them as custom servers.
    // Here we test the neutral catalog still validates and can be extended.
    const cfg = defaultProjectMcpConfig();
    assert.ok(cfg.servers.length >= 4);
    assert.ok(cfg.servers.some((s) => s.id === "github"));
    // Hydrate with engram-like custom entry should succeed
    const withCustom = sanitizeProjectMcpConfig({
      version: 1,
      servers: [...cfg.servers, { id: "engram", enabled: true, updatedAt: Date.now() }],
      customServers: [
        { id: "engram", name: "Engram", description: "Persistent memory", transport: "stdio", defaultCommand: "engram", defaultArgs: ["mcp", "--tools=agent"], auth: null },
        { id: "codegraph", name: "CodeGraph", description: "Code intelligence", transport: "stdio", defaultCommand: "codegraph", defaultArgs: ["serve", "--mcp"], auth: null },
      ],
    });
    assert.ok(withCustom.customServers?.some((c) => c.id === "engram"));
    assert.ok(withCustom.customServers?.some((c) => c.id === "codegraph"));
  });

  it("instructions round-trip preserves engram/codegraph blocks", async () => {
    const raw = await import("node:fs").then((fs) => {
      try { return fs.readFileSync(`${process.env.USERPROFILE}/.config/opencode/AGENTS.md`, "utf-8"); } catch { return "<!-- gentle-ai:codegraph-guidance -->\ncodegraph\n<!-- gentle-ai:engram-protocol -->\nengram\n<!-- gentle-ai:persona -->\npersona"; }
    });
    const blocks = parseAgentsMdIntoBlocks(raw);
    assert.ok(blocks.some((b) => b.id === "codegraph"));
    assert.ok(blocks.some((b) => b.id === "engram"));
    assert.ok(blocks.some((b) => b.id === "persona"));
    const recon = concatBlocksToAgentsMd(blocks);
    const reparsed = parseAgentsMdIntoBlocks(recon);
    assert.equal(reparsed.length, blocks.length);
  });

  it("neutral skills validate diag- prefix reserved", () => {
    assert.ok(isValidSkillName("my-skill"));
    assert.ok(!isValidSkillName("Diag-bad"));
    const neutral = toNeutralSkillFromRegistry({ name: "diag-seguridad", title: "Seguridad", description: "x", categoryId: "seguridad", body: "# body" });
    assert.equal(neutral.name, "diag-seguridad");
    assert.equal(neutral.source, "registry");
  });

  it("codebuddy adapter stub does not throw on sync", async () => {
    const { codebuddyMcpAdapter } = await import("../electron/mcp/adapters/codebuddy.ts");
    assert.equal(codebuddyMcpAdapter.harnessId, "codebuddy");
    // Should not throw when projectPath empty (graceful no-op)
    codebuddyMcpAdapter.syncToHarness("", "github" as any, true, null, []);
    assert.ok(true);
  });

  it("opencode adapter preserves contract", async () => {
    const { opencodeMcpAdapter } = await import("../electron/mcp/adapters/opencode.ts");
    assert.equal(opencodeMcpAdapter.harnessId, "opencode");
    assert.ok(typeof opencodeMcpAdapter.syncToHarness === "function");
  });
});
