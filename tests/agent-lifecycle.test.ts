/**
 * Alta de agentes en una pasada (Plan B1+B2): POST/PUT/GET full sobre
 * `factory/agents/` con frontmatter validado (tools/stage/blocking del
 * vocabulario cerrado, unicidad del FOREMAN). Todo contra sandbox
 * `factoryDir` — nunca toca los agentes reales. Offline, nunca lanza.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgentFile,
  deleteAgentFile,
  isValidAgentFileName,
  listAgents,
  readAgentFull,
  setMirrorTestHomeForTests,
  writeAgentFull,
} from "../headless-runtime/factory/agents/agentFileRoutes.ts";

function mkFactory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-lifecycle-"));
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function seedForeman(root: string): void {
  const dir = path.join(root, "agents", "foreman");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "agent.md"),
    "---\ndescription: Coordina\nagentType: FOREMAN\nmode: all\nmodel: x/y\ntools: {}\n---\n\nBody foreman.\n",
    "utf-8",
  );
}

/** Seed vía alta real (genera espejos): para tests de sincronización. */
function seedForemanViaCreate(root: string): void {
  const res = createAgentFile(
    "foreman",
    { description: "Coordina", agentType: "FOREMAN", mode: "all", model: "x/y", tools: [] },
    "Body foreman.",
    root,
  );
  assert.equal(res.ok, true);
}

const VERIFY_FM = {
  description: "Prueba cosas",
  agentType: "VERIFY",
  mode: "subagent",
  model: "x/y",
  tools: ["read", "glob", "grep"],
  stage: "post-review",
  blocking: false,
};
const VERIFY_BODY = "Sos el tester. Revisás con lectura.";

test("isValidAgentFileName: anti-traversal", () => {
  assert.equal(isValidAgentFileName("playwright-tester"), true);
  assert.equal(isValidAgentFileName("../secret"), false);
  assert.equal(isValidAgentFileName("a/b"), false);
  assert.equal(isValidAgentFileName(""), false);
});

test("create: alta en una pasada con frontmatter canonizado", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    const res = createAgentFile("playwright-tester", VERIFY_FM, VERIFY_BODY, root);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.name, "playwright-tester");
    assert.equal(res.value.frontmatter.agentType, "VERIFY");
    assert.deepEqual(res.value.frontmatter.tools, ["read", "glob", "grep"]);
    assert.equal(res.value.frontmatter.stage, "post-review");
    assert.equal(res.value.body, VERIFY_BODY);
    const text = fs.readFileSync(path.join(root, "agents", "playwright-tester", "agent.md"), "utf-8");
    assert.match(text, /^---\n/);
    assert.match(text, /^tools: \{read, glob, grep\}$/m);
    assert.match(text, /^stage: post-review$/m);
    assert.match(text, /^blocking: false$/m);
  } finally {
    rmRf(root);
  }
});

test("create: duplicado → duplicate; nombre malo → invalid; body vacío → invalid", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    assert.equal(createAgentFile("tester", VERIFY_FM, VERIFY_BODY, root).ok, true);
    const dup = createAgentFile("tester", VERIFY_FM, VERIFY_BODY, root);
    assert.equal(dup.ok, false);
    if (dup.ok) return;
    assert.equal(dup.code, "duplicate");
    assert.equal(createAgentFile("../x", VERIFY_FM, VERIFY_BODY, root).ok, false);
    const empty = createAgentFile("otro", VERIFY_FM, "   ", root);
    assert.equal(empty.ok, false);
  } finally {
    rmRf(root);
  }
});

test("create: 2do FOREMAN → foreman; tools/stage/blocking inválidos → invalid", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    const second = createAgentFile("otro-foreman", { description: "x", agentType: "FOREMAN" }, "Body.", root);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "foreman");
    const badTools = createAgentFile("t1", { ...VERIFY_FM, tools: ["rayos-x"] }, VERIFY_BODY, root);
    assert.equal(badTools.ok, false);
    const badStage = createAgentFile("t2", { ...VERIFY_FM, stage: "pre-lanzamiento" }, VERIFY_BODY, root);
    assert.equal(badStage.ok, false);
    const badBlocking = createAgentFile("t3", { ...VERIFY_FM, blocking: "quizás" }, VERIFY_BODY, root);
    assert.equal(badBlocking.ok, false);
    const badType = createAgentFile("t4", { ...VERIFY_FM, agentType: "JEFECITO" }, VERIFY_BODY, root);
    assert.equal(badType.ok, false);
  } finally {
    rmRf(root);
  }
});

test("create: acepta tools como string y mapa; skills y secrets viajan", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    const res = createAgentFile(
      "tester2",
      { ...VERIFY_FM, tools: "{read, glob}", skills: ["code-review"], secrets: ["GITHUB_TOKEN"] },
      VERIFY_BODY,
      root,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.frontmatter.tools, ["read", "glob"]);
    assert.deepEqual(res.value.frontmatter.skills, ["code-review"]);
    assert.deepEqual(res.value.frontmatter.secrets, ["GITHUB_TOKEN"]);
  } finally {
    rmRf(root);
  }
});

test("listAgents: ordenados, con description+agentType; rotos se omiten", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    createAgentFile("zeta-tester", VERIFY_FM, VERIFY_BODY, root);
    createAgentFile("alpha-tester", VERIFY_FM, VERIFY_BODY, root);
    fs.mkdirSync(path.join(root, "agents", "roto"), { recursive: true });
    fs.writeFileSync(path.join(root, "agents", "roto", "agent.md"), "sin frontmatter", "utf-8");
    const list = listAgents(root);
    assert.deepEqual(list.map((a) => a.name), ["alpha-tester", "foreman", "zeta-tester"]);
    assert.equal(list[0]?.agentType, "VERIFY");
    assert.equal(list[1]?.agentType, "FOREMAN");
    assert.deepEqual(listAgents(path.join(root, "no-existe")), []);
  } finally {
    rmRf(root);
  }
});

test("CRUD sin mirrors: factory/agents es la fuente; mirrorSynced honesto", () => {
  const root = mkFactory();
  try {
    seedForemanViaCreate(root);
    const created = createAgentFile("tester", VERIFY_FM, VERIFY_BODY, root);
    assert.equal(created.ok, true);
    assert.ok(
      fs.existsSync(path.join(root, "agents", "tester", "agent.md")),
      "definición factory creada",
    );
    assert.equal(
      fs.existsSync(path.join(root, ".opencode", "agents", "tester.md")),
      false,
      "sin espejo local (los agentes viajan inline en el server)",
    );
    const patched = writeAgentFull("tester", { description: "Nuevo texto" }, undefined, root);
    assert.equal(patched.ok, true);
    if (patched.ok) {
      assert.equal(patched.value.mirrorSynced, true, "synced = definición válida");
    }
    const deleted = deleteAgentFile("tester", root);
    assert.equal(deleted.ok, true);
    assert.equal(
      fs.existsSync(path.join(root, "agents", "tester", "agent.md")),
      false,
      "definición eliminada",
    );
    // Core protegido también en sandbox.
    const core = deleteAgentFile("foreman", root);
    assert.equal(core.ok, false);
    assert.ok(fs.existsSync(path.join(root, "agents", "foreman", "agent.md")), "core intacto");
  } finally {
    rmRf(root);
  }
});

test("readAgentFull: frontmatter + body; ausente → error", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    createAgentFile("tester", VERIFY_FM, VERIFY_BODY, root);
    const found = readAgentFull("tester", root);
    assert.equal(found.ok, true);
    if (!found.ok) return;
    assert.equal(found.value.frontmatter.description, "Prueba cosas");
    assert.equal(found.value.body, VERIFY_BODY);
    assert.equal(readAgentFull("no-existe", root).ok, false);
  } finally {
    rmRf(root);
  }
});

test("writeAgentFull: patch de frontmatter preserva formato ajeno + valida", () => {
  const root = mkFactory();
  try {
    seedForeman(root);
    createAgentFile("tester", VERIFY_FM, VERIFY_BODY, root);
    const patched = writeAgentFull("tester", { stage: "post-build", blocking: true }, undefined, root);
    assert.equal(patched.ok, true);
    if (!patched.ok) return;
    assert.equal(patched.value.frontmatter.stage, "post-build");
    assert.equal(patched.value.frontmatter.blocking, true);
    assert.deepEqual(patched.value.frontmatter.tools, ["read", "glob", "grep"]);
    assert.equal(patched.value.body, VERIFY_BODY, "body intacto sin patch de body");
    const bad = writeAgentFull("tester", { stage: "al-espacio" }, undefined, root);
    assert.equal(bad.ok, false);
    const toForeman = writeAgentFull("tester", { agentType: "FOREMAN" }, undefined, root);
    assert.equal(toForeman.ok, false, "no se puede crear 2do foreman por PUT");
    const withBody = writeAgentFull("tester", null, "Nuevo body.", root);
    assert.equal(withBody.ok, true);
    if (!withBody.ok) return;
    assert.equal(withBody.value.body, "Nuevo body.");
    assert.equal(writeAgentFull("no-existe", { stage: "none" }, undefined, root).ok, false);
  } finally {
    rmRf(root);
  }
});
