/**
 * Bundles MCP por agente (`factory/mcps/*.json`): CRUD, validación y
 * bloqueo de borrado cuando un agente los referencia.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMcpBundle,
  deleteMcpBundle,
  isValidMcpBundleName,
  listAgentsReferencingMcp,
  listMcpBundles,
  normalizeMcpServers,
  parseMcpBundlePath,
  readMcpBundle,
  writeMcpBundle,
} from "../headless-runtime/factory/mcps/mcpFileRoutes.ts";

function sandbox(): { root: string; mcpsDir: string; factoryDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-routes-"));
  return { root, mcpsDir: path.join(root, "mcps"), factoryDir: root };
}

test("normalizeMcpServers: remoto, local y env; inválidos rechazados", () => {
  const ok = normalizeMcpServers({
    github: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
    fs: { command: "npx", args: ["-y", "server-fs"], env: { TOKEN: "t" } },
  });
  assert.ok(ok);
  assert.deepEqual(ok.github, { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } });
  assert.deepEqual(ok.fs, { command: "npx", args: ["-y", "server-fs"], env: { TOKEN: "t" } });

  assert.equal(normalizeMcpServers({}), null);
  assert.equal(normalizeMcpServers({ x: { nada: true } }), null);
  assert.equal(normalizeMcpServers({ x: { url: "u", headers: { h: 1 } } }), null);
  assert.equal(normalizeMcpServers({ x: { command: "c", args: "no-array" } }), null);
  assert.equal(normalizeMcpServers(null), null);
});

test("nombres y paths: anti-traversal", () => {
  assert.equal(isValidMcpBundleName("github"), true);
  assert.equal(isValidMcpBundleName("my-bundle_2"), true);
  assert.equal(isValidMcpBundleName("../evil"), false);
  assert.equal(isValidMcpBundleName("a/b"), false);
  assert.equal(isValidMcpBundleName(""), false);

  assert.deepEqual(parseMcpBundlePath("/factory/mcps/github"), { name: "github" });
  assert.ok("error" in parseMcpBundlePath("/factory/mcps/a/b"));
  assert.ok("error" in parseMcpBundlePath("/factory/mcps/../x"));
  assert.ok("error" in parseMcpBundlePath("/factory/agents/x"));
});

test("CRUD: create, list, read, write y delete con sandbox", () => {
  const { mcpsDir, factoryDir } = sandbox();

  const created = createMcpBundle(
    "github",
    { github: { url: "https://example.com/mcp" } },
    mcpsDir,
  );
  assert.ok(created.ok);
  assert.ok(fs.existsSync(path.join(mcpsDir, "github.json")));

  const listed = listMcpBundles(mcpsDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "github");
  assert.equal(listed[0].serverCount, 1);
  assert.equal(listed[0].servers[0].type, "remote");

  const read = readMcpBundle("github", mcpsDir);
  assert.ok(read.ok);
  assert.deepEqual(read.value.servers.github, { url: "https://example.com/mcp" });

  const updated = writeMcpBundle(
    "github",
    { github: { command: "npx", args: ["-y", "server"] } },
    mcpsDir,
  );
  assert.ok(updated.ok);
  const after = readMcpBundle("github", mcpsDir);
  assert.ok(after.ok);
  assert.equal((after.value.servers.github as Record<string, unknown>).command, "npx");

  const deleted = deleteMcpBundle("github", mcpsDir, factoryDir);
  assert.ok(deleted.ok);
  assert.deepEqual(listMcpBundles(mcpsDir), []);
});

test("CRUD: duplicado 409, ausente 404, inválido 400", () => {
  const { mcpsDir } = sandbox();
  const input = { github: { url: "https://example.com/mcp" } };
  assert.ok(createMcpBundle("github", input, mcpsDir).ok);

  const dup = createMcpBundle("github", input, mcpsDir);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.code, "duplicate");

  const missing = writeMcpBundle("ghost", input, mcpsDir);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "not-found");

  const dinv = deleteMcpBundle("../evil", mcpsDir);
  assert.equal(dinv.ok, false);
  if (!dinv.ok) assert.equal(dinv.code, "invalid");

  const badCreate = createMcpBundle("ok-name", { server: { nada: 1 } }, mcpsDir);
  assert.equal(badCreate.ok, false);
  if (!badCreate.ok) assert.equal(badCreate.code, "invalid");
});

test("delete bloqueado si un agente referencia el bundle", () => {
  const { mcpsDir, factoryDir } = sandbox();
  fs.mkdirSync(path.join(mcpsDir), { recursive: true });
  fs.writeFileSync(
    path.join(mcpsDir, "github.json"),
    JSON.stringify({ mcpServers: { github: { url: "https://example.com/mcp" } } }),
    "utf-8",
  );
  const agentDir = path.join(factoryDir, "agents", "verifier");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "agent.md"),
    [
      "---",
      "description: Verifica.",
      "agentType: VERIFY",
      "tools: {read}",
      "mcps: {github}",
      "---",
      "",
      "Cuerpo.",
      "",
    ].join("\n"),
    "utf-8",
  );

  assert.deepEqual(listAgentsReferencingMcp("github", factoryDir), ["verifier"]);
  const blocked = deleteMcpBundle("github", mcpsDir, factoryDir);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, "referenced");
    assert.match(blocked.error, /verifier/);
  }
  assert.ok(fs.existsSync(path.join(mcpsDir, "github.json")), "no se borró");
});

test("listMcpBundles omite archivos rotos", () => {
  const { mcpsDir } = sandbox();
  fs.mkdirSync(mcpsDir, { recursive: true });
  fs.writeFileSync(path.join(mcpsDir, "ok.json"), JSON.stringify({ mcpServers: { s: { url: "u" } } }), "utf-8");
  fs.writeFileSync(path.join(mcpsDir, "roto.json"), "{no json", "utf-8");
  const listed = listMcpBundles(mcpsDir);
  assert.deepEqual(listed.map((b) => b.name), ["ok"]);
});
