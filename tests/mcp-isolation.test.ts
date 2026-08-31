import { describe, it } from "node:test";
import assert from "node:assert";
import { McpManager } from "../electron/mcp/manager.ts";
import { McpVault } from "../electron/mcp/vault.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("MCP isolation", () => {
  it("one MCP failure does not affect others", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-isolation-"));
    const vault = new McpVault(tmpDir);
    const manager = new McpManager({ vault });
    const pid = "test-proj";

    // Enable supabase with token + filesystem (fetch was removed from catalog)
    manager.hydrateConfig(pid, {
      version: 1,
      servers: [
        { id: "supabase", enabled: true, updatedAt: Date.now() },
        { id: "postgres", enabled: true, updatedAt: Date.now() },
        { id: "filesystem", enabled: true, updatedAt: Date.now() },
      ],
    });
    await manager.setSecret(pid, "supabase", "sbp_test_token");
    await manager.setSecret(pid, "postgres", "postgresql://test");

    // Mock connector that fails only for postgres
    // @ts-ignore
    manager.connector = async (projectId, serverId, config) => {
      if (serverId === "postgres") return { ok: false, error: "Connection closed" };
      if (serverId === "supabase") return { ok: true, toolCount: 8 };
      if (serverId === "filesystem") return { ok: true, toolCount: 5 };
      return { ok: true, toolCount: 1 };
    };

    const postgresRes = await manager.connect(pid, "postgres");
    assert.strictEqual(postgresRes.ok, false);
    assert.strictEqual(postgresRes.error, "Connection closed");

    const status = await manager.getStatus(pid, "/tmp/test");
    const supabaseStatus = status.servers.find((s) => s.catalog.id === "supabase")?.status;
    const postgresStatus = status.servers.find((s) => s.catalog.id === "postgres")?.status;
    const fsStatus = status.servers.find((s) => s.catalog.id === "filesystem")?.status;

    // Supabase and filesystem should not be affected by postgres failure
    assert.notStrictEqual(supabaseStatus, "error", "supabase should not be error due to postgres");
    assert.strictEqual(postgresStatus, "error");
    // filesystem should be either connected or disconnected, not error
    assert.notStrictEqual(fsStatus, "error");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("health check for disabled MCP returns disabled, not error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-health-disabled-"));
    const vault = new McpVault(tmpDir);
    const manager = new McpManager({ vault });
    const pid = "test-proj2";

    manager.hydrateConfig(pid, {
      version: 1,
      servers: [
        { id: "postgres", enabled: false, updatedAt: 0 },
      ],
    });

    const health = await manager.checkHealth(pid, "postgres", "/tmp/test");
    assert.strictEqual(health.ok, false);
    assert.strictEqual(health.error, "MCP desactivado");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("health check for postgres when enabled checks npx availability", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-health-postgres-"));
    const vault = new McpVault(tmpDir);
    const manager = new McpManager({ vault });
    const pid = "test-proj3";

    manager.hydrateConfig(pid, {
      version: 1,
      servers: [
        { id: "postgres", enabled: true, updatedAt: Date.now() },
      ],
    });
    await manager.setSecret(pid, "postgres", "postgresql://test");

    const health = await manager.checkHealth(pid, "postgres", tmpDir);
    // Should either be ok (npx available) or error with details, but not throw
    assert.ok(typeof health.ok === "boolean");
    assert.ok(health.error === undefined || typeof health.error === "string");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
