// F14: agentes INLINE en el config del server efímero (sin espejos en disco).
// El builder es puro y determinista; la inyección se verifica por shape.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAgentDef } from "../headless-runtime/factory/agentLoader.ts";
import {
  buildFactoryAgentsConfig,
  buildOpencodeAgentConfig,
  factoryAgentExists,
  isOpencodeModelRef,
  listFactorySkills,
  parseAgentSkills,
  resetServerAgentsMemoForTests,
  resolveAgentModel,
  resolveFactorySkillsDir,
  resolveSessionAgent,
  serverKnowsAgent,
  sessionAgentArgs,
  toolsToPermissionConfig,
} from "../headless-runtime/factory/opencodeAgentSync.ts";
import {
  buildBaseServerConfig,
  getRunningAgentsRevision,
  mergeServerConfig,
} from "../headless-runtime/opencodeServerManager.ts";
import { getAgentDefsRevision } from "../headless-runtime/factory/agentLoader.ts";

test("isOpencodeModelRef: provider/model sí, internos no", () => {
  assert.equal(isOpencodeModelRef("opencode-go/muse-spark-1.2-contributor"), true);
  assert.equal(isOpencodeModelRef("auto-disjoint"), false);
  assert.equal(isOpencodeModelRef(""), false);
  assert.equal(isOpencodeModelRef(undefined), false);
  assert.equal(isOpencodeModelRef("con espacios/x"), false);
});

test("toolsToPermissionConfig: default-deny, allows, write→edit, denies anidados", () => {
  const empty = toolsToPermissionConfig({});
  assert.equal(empty["*"], "deny");

  const readOnly = toolsToPermissionConfig(["glob", "grep", "webfetch", "rayos-x"]);
  assert.equal(readOnly["*"], "deny");
  assert.equal(readOnly.glob, "allow");
  assert.equal(readOnly.grep, "allow");
  assert.equal(readOnly.webfetch, "allow");
  assert.equal("rayos-x" in readOnly, false, "desconocida descartada");

  const writer = toolsToPermissionConfig({ read: true, write: true, bash: true });
  assert.equal(writer["*"], "deny");
  const edit = writer.edit as Record<string, string>;
  assert.equal(edit["*"], "allow", "write se pliega en edit");
  assert.equal(edit["pnpm-lock.yaml"], "deny");
  assert.equal("write" in writer, false, "sin allow plano duplicado");
  const read = writer.read as Record<string, string>;
  assert.equal(read["*"], "allow");
  assert.equal(read[".env"], "deny");
  const bash = writer.bash as Record<string, string>;
  assert.equal(bash["*--watch*"], "deny");

  assert.deepEqual(toolsToPermissionConfig(42), { "*": "deny" });
});

test("buildOpencodeAgentConfig: primary, prompt=body, task deny, modelo válido", () => {
  const def = {
    name: "foreman",
    frontmatter: {
      description: "Decide el workflow.",
      agentType: "FOREMAN",
      mode: "primary",
      model: "opencode-go/muse-spark-1.3-contributor",
      tools: [],
    },
    body: "FOREMAN: reglas del rol.",
  };
  const cfg = buildOpencodeAgentConfig(def);
  assert.ok(cfg);
  assert.equal(cfg.mode, "primary");
  assert.ok(String(cfg.description).length > 0);
  assert.ok(String(cfg.prompt).includes("FOREMAN"), "el body viaja verbatim");
  const permission = cfg.permission as Record<string, unknown>;
  assert.equal(permission["*"], "deny");
  assert.deepEqual(permission.task, { "*": "deny" });
  assert.equal(cfg.model, "opencode-go/muse-spark-1.3-contributor");

  assert.equal(buildOpencodeAgentConfig(null as never), null);
  assert.equal(
    buildOpencodeAgentConfig({
      name: "x",
      frontmatter: { description: "", agentType: "FOREMAN", model: "", tools: {} },
      body: "b",
    }),
    null,
  );
});

test("review inline: skill allowlist deny-first y modelo fijo explícito", () => {
  const def = loadAgentDef("review");
  assert.ok(def);
  const cfg = buildOpencodeAgentConfig(def);
  assert.ok(cfg);
  const permission = cfg.permission as Record<string, unknown>;
  const skill = permission.skill as Record<string, string>;
  assert.equal(skill["*"], "deny");
  assert.equal(skill["code-review"], "allow");
  assert.equal(skill["repo-conventions"], "allow");
  assert.equal("ui-verification" in skill, false);
  assert.equal(cfg.model, "opencode/big-pickle", "modelo fijo explícito");
});

test("buildFactoryAgentsConfig: lee factory/agents real, todos primary", () => {
  const agents = buildFactoryAgentsConfig();
  for (const name of ["foreman", "triage", "spec", "implement", "review"]) {
    const cfg = agents[name];
    assert.ok(cfg, `${name} presente`);
    assert.equal(cfg.mode, "primary", `${name} primary`);
    assert.ok((cfg.permission as Record<string, unknown>).task, `${name} task deny`);
  }
});

test("buildFactoryAgentsConfig: root temp con agente válido y roto", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-config-"));
  try {
    const demo = path.join(root, "factory", "agents", "demo");
    const roto = path.join(root, "factory", "agents", "roto");
    fs.mkdirSync(demo, { recursive: true });
    fs.mkdirSync(roto, { recursive: true });
    fs.writeFileSync(
      path.join(demo, "agent.md"),
      [
        "---",
        'description: "Hace demo."',
        "agentType: VERIFY",
        "mode: primary",
        "model: opencode-go/muse-spark-1.2-contributor",
        "tools: {read,glob,grep}",
        "---",
        "",
        "Reglas de demo.",
        "",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(path.join(roto, "agent.md"), "sin frontmatter", "utf-8");
    const agents = buildFactoryAgentsConfig(root);
    assert.ok(agents.demo, "demo entra");
    assert.equal(agents.demo.mode, "primary");
    assert.equal("roto" in agents, false, "roto se saltea sin romper");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("factoryAgentExists/sessionAgentArgs/resolveSessionAgent sin mirrors", () => {
  assert.equal(factoryAgentExists("foreman"), true);
  assert.equal(factoryAgentExists("no-existe-agent"), false);
  assert.equal(factoryAgentExists("../foreman"), false, "anti-traversal");

  assert.deepEqual(sessionAgentArgs("foreman"), { agent: "foreman" });
  assert.deepEqual(sessionAgentArgs("no-existe-agent"), {});
  assert.deepEqual(resolveSessionAgent("review"), { agent: "review" });
  assert.equal(resolveSessionAgent("no-existe-agent"), null);
});

test("resolveFactorySkillsDir: factory/skills del repo o null", () => {
  const real = resolveFactorySkillsDir();
  assert.equal(typeof real, "string");
  assert.ok(real !== null && fs.existsSync(real));
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), "skills-dir-"));
  try {
    assert.equal(resolveFactorySkillsDir(vacio), null);
    fs.mkdirSync(path.join(vacio, "factory", "skills"), { recursive: true });
    assert.equal(resolveFactorySkillsDir(vacio), path.join(vacio, "factory", "skills"));
  } finally {
    fs.rmSync(vacio, { recursive: true, force: true });
  }
});

test("buildBaseServerConfig inyecta agentes + skills; mergeServerConfig conserva agentes", () => {
  const base = buildBaseServerConfig();
  const agents = base.agent as Record<string, Record<string, unknown>>;
  assert.ok(agents.foreman, "foreman inline");
  assert.equal(agents.foreman.mode, "primary");
  const basePermission = base.permission as Record<string, unknown>;
  assert.ok(basePermission.bash, "guardrails base presentes");
  assert.ok(basePermission.glob, "allow operativo del daemon presente");
  const skills = base.skills as { paths?: string[] };
  assert.ok(Array.isArray(skills.paths) && skills.paths.length > 0, "skills.paths inyectado");

  const merged = mergeServerConfig({
    permission: { skill: { "*": "deny", "code-review": "allow" } },
    mcp: "demo",
  });
  const mergedAgents = merged.agent as Record<string, Record<string, unknown>>;
  assert.ok(mergedAgents.foreman, "el server scopeado conserva los agentes");
  const mergedPermission = merged.permission as Record<string, unknown>;
  assert.ok(mergedPermission.bash, "guardrail base conservado");
  assert.ok(mergedPermission.skill, "permission del scope fusionada");
  assert.equal(merged.mcp, "demo");
});

test("serverKnowsAgent: confirma por app.agents, memoiza, nunca lanza", async () => {
  resetServerAgentsMemoForTests();
  let calls = 0;
  const client = { app: { agents: async () => { calls += 1; return [{ name: "foreman" }, "build"]; } } };
  assert.equal(await serverKnowsAgent(client, "srv-1", "foreman"), true);
  assert.equal(await serverKnowsAgent(client, "srv-1", "foreman"), true);
  assert.equal(calls, 1, "el positivo se memoiza por URL");
  assert.equal(await serverKnowsAgent(client, "srv-1", "triage"), false);
  assert.equal(await serverKnowsAgent(client, "srv-2", "foreman"), true, "otra URL rechequea");
  assert.equal(calls, 3);
  resetServerAgentsMemoForTests();
  assert.equal(await serverKnowsAgent({ app: {} }, "srv-1", "foreman"), false, "sin agents → false");
  assert.equal(await serverKnowsAgent({ app: { agents: async () => { throw new Error("down"); } } }, "srv-1", "foreman"), false);
  assert.equal(await serverKnowsAgent(null, "srv-1", "foreman"), false);
  assert.equal(await serverKnowsAgent(client, "", "foreman"), true, "sin serverKey: chequeo vivo sin memo");
  assert.equal(await serverKnowsAgent(client, "srv-1", ""), false);
  resetServerAgentsMemoForTests();
});

test("parseAgentSkills: lista plana, solo nombres válidos", () => {
  assert.deepEqual(parseAgentSkills("{code-review, repo-conventions, ui-verification}"), [
    "code-review",
    "repo-conventions",
    "ui-verification",
  ]);
  assert.deepEqual(parseAgentSkills("{}"), []);
  assert.deepEqual(parseAgentSkills(["a", "MAL_NOMBRE", "b"]), ["a", "b"]);
  assert.deepEqual(parseAgentSkills(undefined), []);
  assert.deepEqual(parseAgentSkills(42), []);
});

test("mergeServerConfig: skills.paths une scopeDir + factory/skills sin duplicar", () => {
  const merged = mergeServerConfig({ skills: { paths: ["/scope/node-a"] } });
  const paths = (merged.skills as { paths: string[] }).paths;
  assert.equal(paths[0], "/scope/node-a", "el scope primero");
  assert.ok(paths.length >= 2, "factory/skills presente");
  assert.equal(new Set(paths).size, paths.length, "sin duplicados");
  const onlyBase = mergeServerConfig({ permission: { skill: { "*": "deny" } } });
  const basePaths = (onlyBase.skills as { paths: string[] }).paths;
  assert.ok(basePaths.length >= 1, "sin scope de skills, la base no se pierde");
});

test("listFactorySkills: catálogo real ordenado con nombre y descripción", () => {
  const skills = listFactorySkills();
  const names = skills.map((s) => s.name);
  assert.ok(names.includes("code-review"), "code-review presente");
  assert.ok(names.includes("repo-conventions"), "repo-conventions presente");
  for (const skill of skills) {
    assert.equal(typeof skill.description, "string");
    assert.ok(skill.path.includes("factory"), "path dentro de factory");
  }
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skills-empty-"));
  try {
    assert.deepEqual(listFactorySkills(emptyRoot), []);
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test("toolsToPermissionConfig v2: list/websearch/todowrite/lsp + write legacy plegado", () => {
  const cfg = toolsToPermissionConfig(["read", "list", "websearch", "todowrite", "lsp", "write", "task"]);
  assert.equal(cfg["*"], "deny");
  for (const key of ["list", "websearch", "todowrite", "lsp"]) {
    assert.equal(cfg[key], "allow", key);
  }
  const editRule = cfg.edit as Record<string, string>;
  assert.equal(editRule["*"], "allow", "write viejo pliega en edit");
  assert.equal("task" in cfg, false, "task nunca se otorga a un agente factory");
  assert.equal("write" in cfg, false, "write no queda como key propia");
});

test("resolveAgentModel: provider/model v�lido s�, internos/ausentes/traversal no", () => {
  const foreman = resolveAgentModel("foreman");
  assert.ok(typeof foreman === "string" && foreman.includes("/"), "foreman pinea provider/model");
  assert.equal(resolveAgentModel("review"), "opencode/big-pickle");
  assert.equal(resolveAgentModel("no-existe-agent"), null);
  assert.equal(resolveAgentModel("../foreman"), null);
  assert.equal(resolveAgentModel(""), null);
  assert.equal(resolveAgentModel(42), null);
});

test("revision de agentes: n�mero vigente y null sin singleton", () => {
  assert.equal(typeof getAgentDefsRevision(), "number");
  assert.equal(getRunningAgentsRevision(), null, "sin singleton no hay revisi�n sellada");
});
