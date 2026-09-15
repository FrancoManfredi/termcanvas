/**
 * Capacidades por nodo (Fase 2): tools, skills y MCP.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildToolsRecord,
  listMcpBundleNames,
  materializeNodeCapabilities,
  normalizeMcpNames,
  parseMcpConfigFile,
  resolveAgentMcps,
  resolveSkills,
  skillRoots,
} from "../headless-runtime/workflows/capabilities.ts";

function sandbox(): { tmp: string; repoRoot: string; workflowDir: string; scopeDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-caps-"));
  return {
    tmp,
    repoRoot: tmp,
    workflowDir: tmp,
    scopeDir: path.join(tmp, "scope"),
  };
}

test("tools: allowlist exacta", () => {
  const record = buildToolsRecord({ allowed_tools: ["read", "grep"] });
  assert.deepEqual(record, { read: true, grep: true });
});

test("tools: denied sin allowlist parte del set completo", () => {
  const record = buildToolsRecord({ denied_tools: ["write", "edit", "bash"] });
  assert.equal(record?.read, true);
  assert.equal(record?.webfetch, true);
  assert.equal(record?.write, undefined);
  assert.equal(record?.edit, undefined);
  assert.equal(record?.bash, undefined);
});

test("tools: allowed + denied combinan (deny gana)", () => {
  const record = buildToolsRecord({
    allowed_tools: ["read", "grep", "write"],
    denied_tools: ["write"],
  });
  assert.deepEqual(record, { read: true, grep: true });
});

test("tools: sin declaración → undefined (hereda default)", () => {
  assert.equal(buildToolsRecord({}), undefined);
});

test("skills: resuelve desde factory/skills y falla si no existe", () => {
  const { repoRoot, workflowDir } = sandbox();
  const dir = path.join(repoRoot, "factory", "skills", "code-review");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: code-review\n---\nRevisá.\n", "utf-8");

  const resolved = resolveSkills(["code-review"], { repoRoot, workflowDir });
  assert.equal(resolved.length, 1);
  assert.match(resolved[0].raw, /Revisá/);

  assert.throws(
    () => resolveSkills(["nope"], { repoRoot, workflowDir }),
    /skill "nope" no encontrada/,
  );
});

test("mcp: convierte local y remote al shape de OpenCode", () => {
  const { tmp } = sandbox();
  const file = path.join(tmp, "mcp.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      mcpServers: {
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
        github: { url: "https://api.githubcopilot.com/mcp", headers: { Authorization: "Bearer x" } },
      },
    }),
    "utf-8",
  );
  const config = parseMcpConfigFile(file);
  const fsEntry = config.fs as Record<string, unknown>;
  assert.equal(fsEntry.type, "local");
  assert.ok(Array.isArray(fsEntry.command));
  assert.equal((fsEntry.command as string[]).includes("npx"), true);
  const githubEntry = config.github as Record<string, unknown>;
  assert.equal(githubEntry.type, "remote");
  assert.equal(githubEntry.url, "https://api.githubcopilot.com/mcp");
});

test("mcp: archivo inexistente o inválido falla con mensaje claro", () => {
  const { tmp } = sandbox();
  assert.throws(() => parseMcpConfigFile(path.join(tmp, "nope.json")), /mcp file no existe/);
  const bad = path.join(tmp, "bad.json");
  fs.writeFileSync(bad, "{no json", "utf-8");
  assert.throws(() => parseMcpConfigFile(bad), /mcp file inválido/);
});

test("materialize: sin capacidades devuelve null", () => {
  const { repoRoot, workflowDir, scopeDir } = sandbox();
  assert.equal(
    materializeNodeCapabilities({}, { repoRoot, workflowDir, scopeDir }),
    null,
  );
});

test("materialize: skills + mcp escriben scope y config deny/allow", () => {
  const { repoRoot, workflowDir, scopeDir } = sandbox();
  const skillDir = path.join(repoRoot, "factory", "skills", "repo-conventions");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: repo-conventions\n---\nCuerpo.\n", "utf-8");
  const mcpFile = path.join(workflowDir, "mcp.json");
  fs.writeFileSync(
    mcpFile,
    JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "server-fs"] } } }),
    "utf-8",
  );

  const scope = materializeNodeCapabilities(
    { skills: ["repo-conventions"], mcp: "mcp.json" },
    { repoRoot, workflowDir, scopeDir },
  );
  assert.ok(scope);
  assert.ok(fs.existsSync(path.join(scopeDir, "repo-conventions", "SKILL.md")));
  const config = scope!.config as {
    skills: { paths: string[] };
    permission: { skill: Record<string, string> };
    mcp: Record<string, unknown>;
  };
  assert.deepEqual(config.skills.paths, [scopeDir]);
  assert.equal(config.permission.skill["*"], "deny");
  assert.equal(config.permission.skill["repo-conventions"], "allow");
  assert.equal((config.mcp.fs as Record<string, unknown>).type, "local");
});

test("materialize: skill faltante es fatal (no corre a medias)", () => {
  const { repoRoot, workflowDir, scopeDir } = sandbox();
  assert.throws(
    () =>
      materializeNodeCapabilities(
        { skills: ["ghost"] },
        { repoRoot, workflowDir, scopeDir },
      ),
    /skill "ghost" no encontrada/,
  );
});

test("skillRoots: incluye workflow, factory, project y global", () => {
  const roots = skillRoots({ repoRoot: "R", workflowDir: "W" });
  assert.equal(roots.length, 4);
  assert.ok(roots[0].startsWith("W"));
  assert.ok(roots[1].includes("factory"));
});

test("normalizeMcpNames: lista, record, string plano y basura", () => {
  assert.deepEqual(normalizeMcpNames(["github", " fs "]), ["github", "fs"]);
  assert.deepEqual(normalizeMcpNames({ github: true, fs: true }), ["github", "fs"]);
  assert.deepEqual(normalizeMcpNames("{github, fs}"), ["github", "fs"]);
  assert.deepEqual(normalizeMcpNames(""), []);
  assert.deepEqual(normalizeMcpNames(undefined), []);
  assert.deepEqual(normalizeMcpNames(42), []);
  assert.deepEqual(normalizeMcpNames(["../evil", "ok-name", "a b"]), ["ok-name"]);
});

test("resolveAgentMcps: resuelve factory/mcps y falla con los disponibles", () => {
  const { repoRoot } = sandbox();
  const dir = path.join(repoRoot, "factory", "mcps");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "github.json"),
    JSON.stringify({ mcpServers: { github: { url: "https://example.com/mcp" } } }),
    "utf-8",
  );

  const config = resolveAgentMcps(["github"], { repoRoot });
  assert.equal((config.github as Record<string, unknown>).type, "remote");
  assert.deepEqual(listMcpBundleNames({ repoRoot }), ["github"]);

  assert.throws(
    () => resolveAgentMcps(["ghost"], { repoRoot }),
    /mcp bundle "ghost" no existe.*github/,
  );
});

test("materialize: mcp del agente scopea aunque el nodo no declare nada", () => {
  const { repoRoot, workflowDir, scopeDir } = sandbox();
  const dir = path.join(repoRoot, "factory", "mcps");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "github.json"),
    JSON.stringify({ mcpServers: { github: { url: "https://example.com/mcp" } } }),
    "utf-8",
  );

  const scope = materializeNodeCapabilities(
    {},
    { repoRoot, workflowDir, scopeDir, agentMcps: ["github"] },
  );
  assert.ok(scope, "el mcp del agente fuerza server scopeado");
  const config = scope!.config as { mcp: Record<string, unknown> };
  assert.equal((config.mcp.github as Record<string, unknown>).type, "remote");
});

test("materialize: mcp del nodo pisa claves homónimas del agente", () => {
  const { repoRoot, workflowDir, scopeDir } = sandbox();
  const dir = path.join(repoRoot, "factory", "mcps");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "bundle.json"),
    JSON.stringify({ mcpServers: { shared: { url: "https://agent.example/mcp" } } }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(workflowDir, "node-mcp.json"),
    JSON.stringify({ mcpServers: { shared: { command: "npx", args: ["node-mcp"] } } }),
    "utf-8",
  );

  const scope = materializeNodeCapabilities(
    { mcp: "node-mcp.json" },
    { repoRoot, workflowDir, scopeDir, agentMcps: ["bundle"] },
  );
  assert.ok(scope);
  const config = scope!.config as { mcp: Record<string, Record<string, unknown>> };
  assert.equal(config.mcp.shared.type, "local", "el nodo gana en claves homónimas");
});
