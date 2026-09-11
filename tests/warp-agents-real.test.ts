/**
 * warp-agents-real — body real de factory/agents + nombres cortos.
 * Offline total (fs real solo en sandbox tmp + fetch inyectado), cero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAgentFilePath,
  readAgentBody,
  setMirrorTestHomeForTests,
  splitAgentRaw,
  writeAgentBody,
} from "../headless-runtime/factory/agents/agentFileRoutes.ts";
import { parseAgentFile } from "../headless-runtime/factory/agentLoader.ts";
import {
  createFactoryAgent,
  getFactoryAgentBody,
  getFactoryAgentFull,
  listFactoryAgents,
  saveFactoryAgentBody,
  saveFactoryAgentFull,
} from "../src/lib/factoryClient.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── 1. Rutas puras: parse + rechazos ──

test("parseAgentFilePath: extrae el nombre y rechaza traversal/extra", () => {
  assert.deepEqual(parseAgentFilePath("/factory/agents/triage"), { name: "triage" });
  assert.deepEqual(parseAgentFilePath("/factory/agents/foreman"), { name: "foreman" });
  assert.ok("error" in parseAgentFilePath("/factory/agents/../secret"));
  assert.ok("error" in parseAgentFilePath("/factory/agents/a%2fb"));
  assert.ok("error" in parseAgentFilePath("/factory/agents/triage/extra"));
  assert.ok("error" in parseAgentFilePath("/factory/agents/triage/"));
  assert.ok("error" in parseAgentFilePath("/factory/agents/"));
  assert.ok("error" in parseAgentFilePath("/factory/jobs/abc"));
});

// ── 2. Lectura real del repo (solo lectura, sin escritura) ──

test("readAgentBody: el body de triage es el del agent.md real (no el seed inglés)", () => {
  const got = readAgentBody("triage");
  assert.equal(got.ok, true);
  if (!got.ok) return;
  const raw = fs.readFileSync(path.join(REPO_ROOT, "factory", "agents", "triage", "agent.md"), "utf-8");
  const parsed = parseAgentFile(raw);
  assert.equal(got.value.body, parsed.body);
  assert.ok(got.value.body.includes("TRIAGE"), "el body real habla del TRIAGE en rioplatense");
  assert.ok(!got.value.body.includes("You are the triage agent of the TermCanvas software factory"), "sin seed ficticio");
});

test("readAgentBody: los 5 agentes leen con body no vacío", () => {
  for (const name of ["foreman", "triage", "spec", "implement", "review"]) {
    const got = readAgentBody(name);
    assert.equal(got.ok, true, name);
    if (got.ok) assert.ok(got.value.body.trim().length > 50, name);
  }
});

test("readAgentBody: nombre inválido o inexistente → error honesto", () => {
  assert.equal(readAgentBody("../secret").ok, false);
  assert.equal(readAgentBody("no-existe-xyz").ok, false);
});

// ── 3. Escritura en sandbox: frontmatter preservado, validación ──

function makeSandbox(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-real-"));
  for (const name of ["triage"]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, "factory", "agents", name, "agent.md"), "utf-8");
    fs.mkdirSync(path.join(dir, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(dir, "agents", name, "agent.md"), src, "utf-8");
  }
  return dir;
}

test("writeAgentBody: guarda solo el body y preserva el frontmatter byte por byte", () => {
  const sandbox = makeSandbox();
  const before = fs.readFileSync(path.join(sandbox, "agents", "triage", "agent.md"), "utf-8");
  const splitBefore = splitAgentRaw(before);
  assert.ok(splitBefore);
  const edited = "Edited body línea 1.\n\nEdited body línea 2.";
  const saved = writeAgentBody("triage", edited, sandbox);
  assert.equal(saved.ok, true);
  const after = fs.readFileSync(path.join(sandbox, "agents", "triage", "agent.md"), "utf-8");
  const splitAfter = splitAgentRaw(after);
  assert.ok(splitAfter);
  assert.equal(splitAfter?.frontmatterRaw, splitBefore?.frontmatterRaw, "frontmatter intacto");
  assert.equal(splitAfter?.body, edited.replace(/\s+$/, ""));
  // El reconstruido sigue validando como agent.md.
  parseAgentFile(after);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("writeAgentBody: espejo local+global verificados y mirrorSynced honesto", () => {
  const sandbox = makeSandbox();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agents-home-"));
  try {
    setMirrorTestHomeForTests(home);
    const edited = "Solo respondé HOLA. No importa el resto.";
    const saved = writeAgentBody("triage", edited, sandbox);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.mirrorSynced, true, "ambos espejos verificados");
    const local = fs.readFileSync(
      path.join(sandbox, ".opencode", "agents", "triage.md"),
      "utf-8",
    );
    const global = fs.readFileSync(
      path.join(home, ".config", "opencode", "agents", "triage.md"),
      "utf-8",
    );
    assert.ok(local.includes(edited), "espejo local con el body nuevo");
    assert.ok(global.includes(edited), "espejo global con el body nuevo");
  } finally {
    setMirrorTestHomeForTests(null);
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("writeAgentBody: body vacío o nombre inválido → 400 sin tocar disco", () => {
  const sandbox = makeSandbox();
  const before = fs.readFileSync(path.join(sandbox, "agents", "triage", "agent.md"), "utf-8");
  assert.equal(writeAgentBody("triage", "   \n  ", sandbox).ok, false);
  assert.equal(writeAgentBody("../evil", "hola", sandbox).ok, false);
  assert.equal(writeAgentBody("triage", 123 as unknown as string, sandbox).ok, false);
  const after = fs.readFileSync(path.join(sandbox, "agents", "triage", "agent.md"), "utf-8");
  assert.equal(after, before, "disco intacto");
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// ── 4. Nombres cortos en el mock (lectura de fuente, sin react) ──

test("4 principales sin skills: sin frontmatter skills ni mapa en espejo", () => {
  for (const name of ["foreman", "triage", "spec", "implement"]) {
    const md = fs.readFileSync(path.join(REPO_ROOT, "factory", "agents", name, "agent.md"), "utf-8");
    assert.doesNotMatch(md, /^skills:/m, `${name}: sin skills en frontmatter`);
    const mirror = path.join(REPO_ROOT, ".opencode", "agents", `${name}.md`);
    if (fs.existsSync(mirror)) {
      const out = fs.readFileSync(mirror, "utf-8");
      assert.ok(!/^\s+skill:/m.test(out), `${name}: espejo sin mapa skill`);
    }
  }
});

test("mockAgents: nombres cortos sin prefijo TermCanvas", () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "src", "features", "warpPanel", "adapters", "mockAgents.ts"),
    "utf-8",
  );
  for (const short of ['name: "Foreman"', 'name: "Triage"', 'name: "Spec"', 'name: "Implement"', 'name: "Review"']) {
    assert.ok(src.includes(short), `falta ${short}`);
  }
  assert.ok(!src.includes("TermCanvas Foreman Agent"), "sin prefijo largo en foreman");
  assert.ok(!src.includes("TermCanvas Triage Agent"), "sin prefijo largo en triage");
  assert.ok(!src.includes("TermCanvas Spec Agent"), "sin prefijo largo en spec");
  assert.ok(!src.includes("TermCanvas Implement Agent"), "sin prefijo largo en implement");
  assert.ok(!src.includes("TermCanvas Review Agent"), "sin prefijo largo en review");
});

// ── 5. Cliente: GET/PUT con fetch inyectado (offline) ──

function jsonResponse(status: number, json: unknown): Response {
  return {
    status,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

test("getFactoryAgentBody: devuelve el body del daemon con fetch inyectado", async () => {
  const fetchFn = async (url: string) => {
    assert.ok(url.endsWith("/factory/agents/triage"), url);
    return jsonResponse(200, { name: "triage", body: "live body" });
  };
  const res = await getFactoryAgentBody("triage", { fetchFn: fetchFn as never, port: 17680 });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.body, "live body");
});

test("listFactoryAgents: GET exacto devuelve la lista con fetch inyectado", async () => {
  let seenUrl = "";
  const fetchFn = async (url: string) => {
    seenUrl = url;
    return jsonResponse(200, { agents: [{ name: "playwright-tester", description: "d", agentType: "VERIFY" }] });
  };
  const res = await listFactoryAgents({ fetchFn: fetchFn as never, port: 17680 });
  assert.ok(seenUrl.endsWith("/factory/agents"), seenUrl);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0]?.agentType, "VERIFY");
  }
  const bad = await listFactoryAgents({
    fetchFn: (async () => jsonResponse(200, { agents: [{ nope: 1 }] })) as never,
    port: 17680,
  });
  assert.equal(bad.ok, false);
});

test("createFactoryAgent: POST { name, frontmatter, body } → 201 con eco", async () => {
  let seenInit: RequestInit | undefined;
  let seenUrl = "";
  const fetchFn = async (url: string, init?: RequestInit) => {
    seenUrl = url;
    seenInit = init;
    return jsonResponse(201, { name: "tester", body: "Body.", frontmatter: { description: "d" } });
  };
  const res = await createFactoryAgent(
    { name: "tester", frontmatter: { description: "d" }, body: "Body." },
    { fetchFn: fetchFn as never, port: 17680 },
  );
  assert.ok(seenUrl.endsWith("/factory/agents"), seenUrl);
  assert.equal(seenInit?.method, "POST");
  assert.ok(String(seenInit?.body).includes("tester"));
  assert.equal(res.ok, true);
  const dup = await createFactoryAgent(
    { name: "tester", frontmatter: {}, body: "Body." },
    { fetchFn: (async () => jsonResponse(409, { error: "el agente ya existe: tester" })) as never, port: 17680 },
  );
  assert.equal(dup.ok, false);
  const empty = await createFactoryAgent(
    { name: "tester", frontmatter: {}, body: "   " },
    { fetchFn: fetchFn as never, port: 17680 },
  );
  assert.equal(empty.ok, false, "body vacío no sale a red");
});

test("getFactoryAgentFull: trae frontmatter aditivo sin romper body", async () => {
  const fetchFn = async () => jsonResponse(200, { name: "triage", body: "b", frontmatter: { stage: "none" } });
  const res = await getFactoryAgentFull("triage", { fetchFn: fetchFn as never, port: 17680 });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.body, "b");
    assert.equal(res.data.frontmatter.stage, "none");
  }
});

test("saveFactoryAgentFull: PUT con body+frontmatter; vacío → error local", async () => {
  let seenBody = "";
  const fetchFn = async (_url: string, init?: RequestInit) => {
    seenBody = String(init?.body ?? "");
    return jsonResponse(200, { name: "triage", body: "b2", frontmatter: { stage: "none" } });
  };
  const res = await saveFactoryAgentFull("triage", "b2", { stage: "none" }, { fetchFn: fetchFn as never, port: 17680 });
  assert.equal(res.ok, true);
  assert.ok(seenBody.includes("b2") && seenBody.includes("frontmatter"));
  const empty = await saveFactoryAgentFull("triage", undefined, undefined, { fetchFn: fetchFn as never, port: 17680 });
  assert.equal(empty.ok, false, "sin nada para guardar no sale a red");
});

test("saveFactoryAgentBody: PUT con { body } y forma inesperada → error honesto", async () => {
  let seenInit: RequestInit | undefined;
  const fetchFn = async (_url: string, init?: RequestInit) => {
    seenInit = init;
    return jsonResponse(200, { name: "spec", body: "saved body" });
  };
  const res = await saveFactoryAgentBody("spec", "nuevo body", { fetchFn: fetchFn as never, port: 17680 });
  assert.equal(res.ok, true);
  assert.equal(seenInit?.method, "PUT");
  assert.ok(String(seenInit?.body).includes("nuevo body"));
  const bad = await saveFactoryAgentBody("spec", "x", {
    fetchFn: (async () => jsonResponse(200, { nope: 1 })) as never,
    port: 17680,
  });
  assert.equal(bad.ok, false);
  const empty = await saveFactoryAgentBody("spec", "  ", {
    fetchFn: (async () => jsonResponse(200, { name: "spec", body: "x" })) as never,
    port: 17680,
  });
  assert.equal(empty.ok, false);
});
