// P4/P5: factory/agents/<name>/agent.md → agentes opencode reales.
// El generador es puro y determinista; el sync a disco se prueba en temp.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAgentDef } from "../headless-runtime/factory/agentLoader.ts";
import {
  buildOpencodeAgentMarkdown,
  checkFactoryGlobalMirrorsInSync,
  checkFactoryMirrorsInSync,
  isOpencodeModelRef,
  mirrorExists,
  parseAgentSkills,
  resetServerAgentsMemoForTests,
  resolveGlobalAgentsDir,
  resolveGlobalSkillsDir,
  resolveOpencodeAgentPath,
  serverKnowsAgent,
  sessionAgentArgs,
  syncFactoryAgentsGlobal,
  syncFactoryAgentsToOpencode,
  syncFactorySkillsGlobal,
  syncFactorySkillsToOpencode,
  toolsToPermissionLines,
} from "../headless-runtime/factory/opencodeAgentSync.ts";

test("isOpencodeModelRef: provider/model sí, internos no", () => {
  assert.equal(isOpencodeModelRef("opencode-go/muse-spark-1.2-contributor"), true);
  assert.equal(isOpencodeModelRef("auto-disjoint"), false);
  assert.equal(isOpencodeModelRef(""), false);
  assert.equal(isOpencodeModelRef(undefined), false);
  assert.equal(isOpencodeModelRef("con espacios/x"), false);
});

test("toolsToPermissionLines: default-deny primero, allows después", () => {
  assert.deepEqual(toolsToPermissionLines({}), [`  "*": deny`]);
  assert.deepEqual(toolsToPermissionLines([]), [`  "*": deny`]);
  assert.deepEqual(toolsToPermissionLines({ glob: true, grep: true }), [
    `  "*": deny`,
    "  glob: allow",
    "  grep: allow",
  ]);
  // write se pliega en edit (opencode edit cubre write/edit/apply_patch), sin duplicar
  assert.deepEqual(toolsToPermissionLines(["glob", "grep", "webfetch"]), [
    `  "*": deny`,
    "  glob: allow",
    "  grep: allow",
    "  webfetch: allow",
  ]);
});

test("toolsToPermissionLines: edit/read/bash salen anidados con denies canónicos", () => {
  const lines = toolsToPermissionLines(["read", "write", "edit", "bash", "glob", "grep", "webfetch"]);
  assert.equal(lines[0], `  "*": deny`);
  // read anidado: allow primero, denies después (en opencode gana la última)
  const readIdx = lines.indexOf("  read:");
  assert.ok(readIdx > 0, "read sale como mapa anidado");
  assert.equal(lines[readIdx + 1], `    "*": allow`);
  assert.ok(lines.includes(`    ".env": deny`), "secretos denegados en lectura");
  // edit anidado con lockfiles y estado del orquestador
  const editIdx = lines.indexOf("  edit:");
  assert.ok(editIdx > readIdx, "orden de input preservado");
  assert.equal(lines[editIdx + 1], `    "*": allow`);
  assert.ok(lines.includes(`    "pnpm-lock.yaml": deny`));
  assert.ok(lines.includes(`    ".agents/factory/**": deny`));
  assert.ok(!lines.includes("  edit: allow"), "sin allow plano duplicado");
  // bash anidado con patrones anti-cuelgue
  const bashIdx = lines.indexOf("  bash:");
  assert.ok(bashIdx > editIdx);
  assert.ok(lines.includes(`    "*--watch*": deny`));
  assert.ok(lines.includes(`    "npm run dev*": deny`));
  // planos sin denies
  assert.ok(lines.includes("  glob: allow"));
  assert.ok(lines.includes("  webfetch: allow"));
});

test("foreman: espejo deny-all con modelo válido y sin keys de factory", () => {
  const def = loadAgentDef("foreman");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  assert.match(out, /^---\n/);
  assert.ok(out.includes("mode: all"));
  assert.ok(out.includes("model: opencode-go/muse-spark-1.2-contributor"));
  assert.ok(out.includes(`"*": deny`));
  assert.ok(!out.includes("agentType"), "agentType es vocabulario factory, no opencode");
  assert.ok(!out.includes("tools:"), "tools crudo no se filtra al espejo (va permission)");
  assert.ok(out.includes("building"), "el body viaja verbatim");
  assert.ok(out.endsWith("\n"));
});

test("deny-all va ANTES que los allows (en opencode gana la última regla)", () => {
  const def = loadAgentDef("triage");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  const denyIdx = out.indexOf(`"*": deny`);
  const allowIdx = out.indexOf(`"*": allow`);
  assert.ok(denyIdx >= 0 && allowIdx > denyIdx);
});

test("implement: espejo con webfetch + denies anidados (guardrails en el mirror)", () => {
  const def = loadAgentDef("implement");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  assert.ok(out.includes("  webfetch: allow"), "webfetch llega al espejo");
  assert.ok(out.includes(`    ".env": deny`), "secretos denegados");
  assert.ok(out.includes(`    "**/result.json": deny`), "estado del orquestador denegado");
  assert.ok(out.includes(`    "*--watch*": deny`), "anti-cuelgue en el espejo");
  assert.ok(!out.includes("tools:"), "tools crudo no se filtra (regla existente)");
});

test("foreman: sin allows no hay bloques anidados (el deny-all ya cubre)", () => {
  const def = loadAgentDef("foreman");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  assert.ok(out.includes(`"*": deny`));
  assert.ok(!out.includes("  edit:"), "sin bloque edit sin allow");
  assert.ok(!out.includes("  bash:"), "sin bloque bash sin allow");
});

test("review: modelo interno auto-disjoint se omite (opencode usaría su default)", () => {
  const def = loadAgentDef("review");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  assert.ok(!out.match(/^model:/m), "la key model no debe emitirse para modelos internos");
  assert.ok(out.includes("mode: all"), "review directo en picker");
});

test("buildOpencodeAgentMarkdown inválido → vacío, nunca lanza", () => {
  assert.equal(buildOpencodeAgentMarkdown(null as never), "");
  assert.equal(
    buildOpencodeAgentMarkdown({ name: "x", frontmatter: { description: "", agentType: "FOREMAN", model: "", tools: {} }, body: "" } as never),
    "",
  );
});

test("resolveOpencodeAgentPath apunta a .opencode/agents/<name>.md", () => {
  const p = resolveOpencodeAgentPath("foreman", "/repo");
  assert.equal(p, path.join("/repo", ".opencode", "agents", "foreman.md"));
});

test("sync a root temp: escribe válidos, skipea rotos, nunca lanza", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-"));
  try {
    const goodDir = path.join(root, "factory", "agents", "demo");
    fs.mkdirSync(goodDir, { recursive: true });
    fs.writeFileSync(
      path.join(goodDir, "agent.md"),
      "---\ndescription: Demo agent\nagentType: VERIFY\nmode: subagent\nmodel: opencode-go/muse-spark-1.2-contributor\ntools: {read}\n---\n\nHace demo.\n",
      "utf-8",
    );
    const badDir = path.join(root, "factory", "agents", "roto");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "agent.md"), "sin frontmatter", "utf-8");
    const report = syncFactoryAgentsToOpencode(root);
    assert.deepEqual(report.written, ["demo"]);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].name, "roto");
    const mirror = fs.readFileSync(path.join(root, ".opencode", "agents", "demo.md"), "utf-8");
    assert.ok(mirror.includes("mode: subagent"));
    assert.ok(mirror.includes("  read:"), "read sale anidado con denies");
    assert.ok(mirror.includes(`    "*": allow`));
    assert.ok(mirror.includes(`    ".env": deny`));
    assert.ok(mirror.includes("Hace demo."));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test("review: espejo emite permission.skill deny-first + allows (sin ui-verification)", () => {
  const def = loadAgentDef("review");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  assert.ok(out.includes("  skill:"), "mapa skill presente");
  const denyIdx = out.indexOf(`"*": deny`);
  const skillIdx = out.indexOf("  skill:");
  const allowIdx = out.indexOf('"code-review": allow');
  assert.ok(skillIdx > denyIdx, "el mapa va después del deny top-level");
  assert.ok(allowIdx > skillIdx, "allows dentro del mapa");
  assert.ok(out.includes('"repo-conventions": allow'));
  assert.ok(!out.includes('"ui-verification": allow'), "ui-verification removida del frontmatter");
});

test("foreman: espejo sin mapa skill (deny top-level alcanza)", () => {
  const def = loadAgentDef("foreman");
  assert.ok(def);
  const out = buildOpencodeAgentMarkdown(def);
  assert.ok(!out.match(/^\s+skill:/m), "sin mapa skill");
  assert.ok(out.includes("  task:"), "task deny presente");
});

test("los 5 agentes espejan mode all (picker directo)", () => {
  for (const name of ["foreman", "triage", "spec", "implement", "review"]) {
    const def = loadAgentDef(name);
    assert.ok(def, name);
    assert.equal(def.frontmatter.mode, "all", name);
    const out = buildOpencodeAgentMarkdown(def);
    assert.ok(out.includes("mode: all"), name);
    assert.ok(out.includes("  task:"), `${name}: task deny presente`);
  }
});

test("checkFactoryMirrorsInSync: detecta falta, drift y huérfanos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-check-"));
  try {
    const agDir = path.join(root, "factory", "agents", "demo");
    fs.mkdirSync(agDir, { recursive: true });
    fs.writeFileSync(
      path.join(agDir, "agent.md"),
      "---\ndescription: Demo\nagentType: VERIFY\nmode: all\nmodel: x/y\ntools: {read}\n---\n\nHace demo.\n",
      "utf-8",
    );
    const skDir = path.join(root, "factory", "skills", "demo");
    fs.mkdirSync(skDir, { recursive: true });
    fs.writeFileSync(path.join(skDir, "SKILL.md"), "---\nname: demo\ndescription: d\n---\n\ncuerpo\n", "utf-8");
    const r1 = checkFactoryMirrorsInSync(root);
    assert.equal(r1.ok, false);
    assert.ok(r1.diffs.some((d) => d.includes("falta")), "reporta faltantes");
    syncFactoryAgentsToOpencode(root);
    syncFactorySkillsToOpencode(root);
    const r2 = checkFactoryMirrorsInSync(root);
    assert.deepEqual(r2, { ok: true, diffs: [] });
    fs.writeFileSync(path.join(root, ".opencode", "agents", "demo.md"), "tampered", "utf-8");
    fs.writeFileSync(path.join(root, ".opencode", "agents", "fantasma.md"), "x", "utf-8");
    const r3 = checkFactoryMirrorsInSync(root);
    assert.equal(r3.ok, false);
    assert.ok(r3.diffs.some((d) => d.includes("difiere")), "reporta drift");
    assert.ok(r3.diffs.some((d) => d.includes("huérfano")), "reporta huérfanos");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkFactoryMirrorsInSync nunca lanza ante root inexistente", () => {
  const r = checkFactoryMirrorsInSync(path.join(os.tmpdir(), "no-existe-def-xyz"));
  assert.equal(r.ok, false);
  assert.ok(r.diffs.length >= 1);
});

test("review real: mode all + task deny (picker directo, sin delegación)", () => {
  const def = loadAgentDef("review");
  assert.ok(def);
  assert.equal(def.frontmatter.mode, "all");
  const out = buildOpencodeAgentMarkdown(def);
  assert.ok(out.includes("mode: all"));
  assert.ok(out.includes("  task:"), "task deny presente");
  assert.ok(out.includes("No delegués lectura en subagentes"), "anti-delegación en el body");
});

test("sync skills a dirs temp: escribe, respeta clobber y mismatch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-skills-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-skills-out-"));
  try {
    const mk = (name: string, frontmatterName: string, body: string) => {
      const dir = path.join(root, "factory", "skills", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${frontmatterName}\ndescription: d\n---\n\n${body}\n`, "utf-8");
    };
    mk("buena", "buena", "cuerpo");
    mk("mala", "otro-nombre", "cuerpo");
    const r1 = syncFactorySkillsToOpencode(root, out);
    assert.deepEqual(r1.written, ["buena"]);
    assert.ok(r1.skipped.some((s) => s.name === "mala"), "name≠dir se skipea");
    assert.equal(
      fs.readFileSync(path.join(out, "buena", "SKILL.md"), "utf-8").includes("cuerpo"),
      true,
      "espejo verbatim",
    );
    // Idempotente: segunda vez ya sincronizado.
    const r2 = syncFactorySkillsToOpencode(root, out);
    assert.deepEqual(r2.written, []);
    // No-clobber: contenido ajeno se preserva y se reporta.
    fs.writeFileSync(path.join(out, "buena", "SKILL.md"), "contenido ajeno", "utf-8");
    const r3 = syncFactorySkillsToOpencode(root, out);
    assert.ok(r3.skipped.some((s) => s.name === "buena" && s.reason.includes("no se pisa")));
    assert.equal(fs.readFileSync(path.join(out, "buena", "SKILL.md"), "utf-8"), "contenido ajeno");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("resolveGlobalSkillsDir cuelga de .config/opencode/skills", () => {
  assert.equal(
    resolveGlobalSkillsDir("/home/falso"),
    path.join("/home/falso", ".config", "opencode", "skills"),
  );
});

test("sync skills global a home temp escribe", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-skills-r-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-skills-h-"));
  try {
    const dir = path.join(root, "factory", "skills", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: demo\ndescription: d\n---\n\ncuerpo\n", "utf-8");
    const report = syncFactorySkillsGlobal(root, home);
    assert.deepEqual(report.written, ["demo"]);
    assert.ok(fs.existsSync(path.join(home, ".config", "opencode", "skills", "demo", "SKILL.md")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("sync a root inexistente: skip, nunca lanza", () => {
  const report = syncFactoryAgentsToOpencode(path.join(os.tmpdir(), "no-existe-xyz-123"));
  assert.deepEqual(report.written, []);
  assert.ok(report.skipped.length >= 1);
});

test("resolveGlobalAgentsDir apunta a ~/.config/opencode/agents", () => {
  const dir = resolveGlobalAgentsDir("/home/falso");
  assert.equal(dir, path.join("/home/falso", ".config", "opencode", "agents"));
});

test("checkFactoryGlobalMirrorsInSync: en sync, drift y raíz rota", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-g-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-gh-"));
  try {
    const dir = path.join(root, "factory", "agents", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "agent.md"),
      "---\ndescription: Demo agent\nagentType: VERIFY\nmode: subagent\nmodel: x/y\ntools: {read}\n---\n\nHace demo.\n",
      "utf-8",
    );
    // Vacío = todo falta.
    const missing = checkFactoryGlobalMirrorsInSync(root, home);
    assert.equal(missing.ok, false);
    assert.ok(missing.diffs.some((d) => d.includes("demo.md") && d.includes("falta")));
    // Tras sync global → en sync.
    syncFactoryAgentsGlobal(root, home);
    const synced = checkFactoryGlobalMirrorsInSync(root, home);
    assert.deepEqual(synced, { ok: true, diffs: [] });
    // Drift (el caso punto-12: edición a mano del espejo) → difiere.
    fs.appendFileSync(path.join(home, ".config", "opencode", "agents", "demo.md"), "\n12. Cerrá con JSON.\n");
    const drifted = checkFactoryGlobalMirrorsInSync(root, home);
    assert.equal(drifted.ok, false);
    assert.ok(drifted.diffs.some((d) => d.includes("difiere") && d.includes("sync:agents --global")));
    // Huérfano se reporta.
    fs.writeFileSync(path.join(home, ".config", "opencode", "agents", "huerfano.md"), "x\n");
    const orphan = checkFactoryGlobalMirrorsInSync(root, home);
    assert.ok(orphan.diffs.some((d) => d.includes("huérfano")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("checkFactoryGlobalMirrorsInSync nunca lanza ante root inexistente", () => {
  const out = checkFactoryGlobalMirrorsInSync(path.join(os.tmpdir(), "no-existe-xyz-123"));
  assert.equal(out.ok, false);
});

test("mirrorExists: true con espejo en root temp, false sin él, nunca lanza", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-mirror-"));
  try {
    assert.equal(mirrorExists("demo", root), false);
    const dir = path.join(root, ".opencode", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "demo.md"), "---\ndescription: x\n---\nbody\n", "utf-8");
    assert.equal(mirrorExists("demo", root), true);
    assert.equal(mirrorExists("../demo", root), false);
    assert.equal(mirrorExists("", root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionAgentArgs: {} sin espejo (create queda byte-idéntico), nunca lanza", () => {
  assert.deepEqual(sessionAgentArgs("agente-que-no-existe-xyz"), {});
  assert.deepEqual(sessionAgentArgs(""), {});
  assert.deepEqual(sessionAgentArgs(null as never), {});
});

test("sync global a home temp: escribe espejos, nunca lanza", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-root-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-sync-home-"));
  try {
    const goodDir = path.join(root, "factory", "agents", "demo");
    fs.mkdirSync(goodDir, { recursive: true });
    fs.writeFileSync(
      path.join(goodDir, "agent.md"),
      "---\ndescription: Demo agent\nagentType: VERIFY\nmode: subagent\nmodel: x/y\ntools: {}\n---\n\nHace demo.\n",
      "utf-8",
    );
    const report = syncFactoryAgentsGlobal(root, home);
    assert.deepEqual(report.written, ["demo"]);
    const mirror = fs.readFileSync(
      path.join(home, ".config", "opencode", "agents", "demo.md"),
      "utf-8",
    );
    assert.ok(mirror.includes("mode: subagent"));
    assert.ok(mirror.includes(`"*": deny`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
