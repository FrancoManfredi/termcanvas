import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  VerificationService,
  detectProjectKind,
  evaluateQuarantine,
  formatQuarantineSnippet,
  parseQuarantineFromSnippet,
} from "../headless-runtime/implement/verification.ts";
import {
  hasFolderIntent,
  parseRequestedFromPrompt,
  fallbackMinimalChange,
} from "../headless-runtime/implement/minimalChange.ts";

// Ola 6 (H2+H3): parser generico de intencion, verificacion por lenguaje y
// cuarentena de fallos por evidencia. Nombres inventados neutros en asserts.

const FAIL_OUTPUT_UNRELATED = [
  "TAP version 13",
  "not ok 1 - tests/legacy-widget.test.ts renders stale snapshot",
  "    at Object.<anonymous> (src/legacy-widget.ts:42:7)",
  "# fail 1",
].join("\n");

// ── evaluateQuarantine: regla por evidencia ──

test("cuarentena sin solape → assessment con evidencia", () => {
  const a = evaluateQuarantine(FAIL_OUTPUT_UNRELATED, ["docs/Zeta.md"]);
  assert.ok(a, "debe cuarentenar cuando no hay solape");
  assert.equal(a.count, 1);
  assert.ok(a.failures[0].includes("not ok 1"), "cita la linea de fallo");
  assert.match(a.reason, /no overlap/);
  assert.match(a.reason, /legacy-widget/);
  assert.match(a.reason, /docs\/Zeta\.md/);
});

test("cuarentena con solape exacto → null (fail real)", () => {
  const a = evaluateQuarantine(FAIL_OUTPUT_UNRELATED, ["src/legacy-widget.ts"]);
  assert.equal(a, null);
});

test("cuarentena con solape por stack absoluto y case-insensitive → null", () => {
  const output = "not ok 2 - tests/legacy-widget.test.ts flaky render\n    at run (C:\\repo\\SRC\\Legacy-Widget.ts:10:3)";
  const a = evaluateQuarantine(output, ["src/legacy-widget.ts"]);
  assert.equal(a, null);
});

test("cuarentena con solape por prefijo de carpeta → null", () => {
  const a = evaluateQuarantine(FAIL_OUTPUT_UNRELATED, ["src"]);
  assert.equal(a, null);
});

test("cuarentena sin lineas de fallo → null (fail-fast como antes)", () => {
  assert.equal(evaluateQuarantine("", ["docs/Zeta.md"]), null);
  assert.equal(evaluateQuarantine("ok 1 - todo verde\n# pass 1", ["docs/Zeta.md"]), null);
});

test("cuarentena con linea FAIL generica que cita path → assessment", () => {
  const output = "FAIL tests/legacy-widget.test.ts\nok 3 - resto verde";
  const a = evaluateQuarantine(output, ["docs/Zeta.md"]);
  assert.ok(a, "falla generica con path tambien es evidencia");
  assert.equal(a.count, 1);
});

// ── format/parse round-trip: contrato snippet → timeline meta ──

test("snippet de cuarentena hace round-trip a meta {quarantine:{tests,reason}}", () => {
  const a = evaluateQuarantine(FAIL_OUTPUT_UNRELATED, ["docs/Zeta.md"]);
  assert.ok(a);
  const snippet = formatQuarantineSnippet(a, ["docs/Zeta.md"]);
  assert.match(snippet, /\[quarantine\] quarantined 1 failure\(s\)/);
  assert.match(snippet, /no overlap with change \[docs\/Zeta\.md\]/);
  const parsed = parseQuarantineFromSnippet(snippet);
  assert.ok(parsed);
  assert.equal(parsed.count, 1);
  assert.ok(parsed.tests.length >= 1);
  const meta = { quarantine: { tests: parsed.tests, reason: parsed.reason } };
  assert.ok(Array.isArray(meta.quarantine.tests));
  assert.match(meta.quarantine.reason, /no overlap with change/);
});

test("parse de snippet sin marca → null", () => {
  assert.equal(parseQuarantineFromSnippet(undefined), null);
  assert.equal(parseQuarantineFromSnippet("trivial folder verified"), null);
});

// ── detectProjectKind ──

test("detectProjectKind: node con package.json (gana ante marcador python)", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kind-node-"));
  fs.writeFileSync(path.join(cwd, "package.json"), "{}");
  fs.writeFileSync(path.join(cwd, "pyproject.toml"), "[project]");
  assert.equal(detectProjectKind(cwd, []), "node");
});

test("detectProjectKind: python por marcador", () => {
  for (const marker of ["pyproject.toml", "pytest.ini", "setup.py"]) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kind-py-"));
    fs.writeFileSync(path.join(cwd, marker), "# marker");
    assert.equal(detectProjectKind(cwd, []), "python", marker);
  }
});

test("detectProjectKind: python por createdFiles *.py, unknown resto", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kind-mix-"));
  assert.equal(detectProjectKind(cwd, ["zeta_app/main.py"]), "python");
  assert.equal(detectProjectKind(cwd, ["docs/Zeta.md"]), "unknown");
  assert.equal(detectProjectKind(cwd, []), "unknown");
});

// ── run(): python/unknown → skipped+pass con nota del kind ──

test("run(): proyecto python → test+build skipped con nota, overall pass", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-py-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-py-dir-"));
  fs.writeFileSync(path.join(worktree, "pyproject.toml"), "[project]\nname = 'zeta'");
  const svc = new VerificationService();
  const report = await svc.run(worktree, dir, "agregar app.py a carpeta Zeta");
  assert.equal(report.overall, "pass");
  assert.equal(report.steps[0].status, "skipped");
  assert.equal(report.steps[1].status, "skipped");
  assert.match(report.steps[0].logSnippet ?? "", /python project/);
  assert.match(report.steps[0].logSnippet ?? "", /JS suite N\/A/);
  const buildLog = fs.readFileSync(path.join(dir, "logs", "build.log"), "utf-8");
  assert.match(buildLog, /python project/);
});

test("run(): kind unknown → skipped+pass con nota", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-unk-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-unk-dir-"));
  const svc = new VerificationService();
  const report = await svc.run(worktree, dir, "anotar pendiente en docs");
  assert.equal(report.overall, "pass");
  assert.equal(report.steps[0].status, "skipped");
  assert.equal(report.steps[1].status, "skipped");
  assert.match(report.steps[0].logSnippet ?? "", /unknown project kind/);
});

// ── run(): skip trivial generico con nombre inventado ──

test("run(): carpeta pedida con nombre inventado → skip trivial, overall pass", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-trivial-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-trivial-dir-"));
  fs.mkdirSync(path.join(worktree, "Zeta"), { recursive: true });
  const svc = new VerificationService();
  const report = await svc.run(worktree, dir, 'crear una carpeta llamada "Zeta" en la raiz');
  assert.equal(report.overall, "pass");
  assert.ok(report.steps.every((s) => s.status === "pass"));
  assert.match(report.steps[1].logSnippet ?? "", /Zeta/);
});

// ── Parser generico (H2): cualquier nombre, typos solo en keywords ──

test("parser: typo en keyword + nombre inventado", () => {
  assert.deepEqual(parseRequestedFromPrompt("crear carepta Zeta en raiz"), {
    relPath: "Zeta",
    isFolder: true,
    content: "",
  });
});

test("parser: nombre entrecomillado cualquiera tras llamada", () => {
  const p = parseRequestedFromPrompt('cree una carpeta llamada "Demo App" en la raiz');
  assert.ok(p);
  assert.equal(p.relPath, "Demo App");
  assert.equal(p.isFolder, true);
});

test("parser: ruta .agents explicita con nombre inventado", () => {
  const p = parseRequestedFromPrompt('cree una carpeta llamada "Kappa" a nivel de .agents');
  assert.ok(p);
  assert.equal(p.relPath, ".agents/Kappa");
  assert.equal(p.isFolder, true);
});

test("parser: archivo .md generico con contenido", () => {
  const p = parseRequestedFromPrompt("crear un docs/demo-feature.md con contenido de prueba");
  assert.ok(p);
  assert.equal(p.relPath, "docs/demo-feature.md");
  assert.equal(p.isFolder, false);
  assert.match(p.content, /de prueba/);
});

test("parser: sin pedido claro → null (no inventa rutas)", () => {
  assert.equal(parseRequestedFromPrompt("cual es el estado del repo"), null);
  assert.equal(parseRequestedFromPrompt("crea una carpeta"), null);
  assert.equal(parseRequestedFromPrompt(""), null);
});

test("hasFolderIntent: solo keywords de idioma", () => {
  assert.equal(hasFolderIntent("crear carepta Zeta"), true);
  assert.equal(hasFolderIntent("nuevo directorio Demo"), true);
  assert.equal(hasFolderIntent("crear archivo de notas"), false);
});

test("fallback crea la carpeta pedida exacta (nombre inventado)", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fallback-gen-"));
  const files = fallbackMinimalChange({
    id: "job-test-quar1",
    prompt: "crear carepta Zeta en raiz",
    worktree,
  });
  assert.deepEqual(files, ["Zeta"]);
  assert.ok(fs.existsSync(path.join(worktree, "Zeta")));
});

// ── E2E cuarentena con suite node real que falla (gateado a pnpm) ──

function hasPnpm(): boolean {
  try {
    const r = spawnSync("pnpm", ["--version"], { encoding: "utf-8", timeout: 8000, shell: false });
    return r.status === 0;
  } catch {
    return false;
  }
}

const PNPM_AVAILABLE = hasPnpm();

function makeFailingNodeProject(): { worktree: string; dir: string } {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "verif-quar-node-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verif-quar-dir-"));
  fs.writeFileSync(
    path.join(worktree, "package.json"),
    JSON.stringify({
      name: "quar-fixture",
      version: "0.0.0",
      // Pin al pnpm que funciona en este entorno (corepack cacheado);
      // sin pin, corepack usa el default que exige Node 22+.
      packageManager: "pnpm@10.33.0",
      scripts: { test: "node ./scripts/fail-suite.js", build: "node ./scripts/ok-build.js" },
    }),
  );
  fs.mkdirSync(path.join(worktree, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "scripts", "ok-build.js"), "process.exit(0);\n");
  // H-001: los createdFiles de los fixtures deben existir en disco
  // (invariante: fantasma → fail antes de la cuarentena).
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "docs", "Zeta.md"), "# Zeta\n", "utf-8");
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "src", "legacy-widget.ts"), "export const w = 1;\n", "utf-8");
  fs.writeFileSync(
    path.join(worktree, "scripts", "fail-suite.js"),
    [
      "console.log('TAP version 13');",
      "console.log('not ok 1 - tests/legacy-widget.test.ts renders stale snapshot');",
      "console.log('    at Object.<anonymous> (src/legacy-widget.ts:42:7)');",
      "console.log('# fail 1');",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  return { worktree, dir };
}

test("run(): fallo sin solape → quarantine pass con evidencia", { skip: !PNPM_AVAILABLE }, async () => {
  const { worktree, dir } = makeFailingNodeProject();
  const svc = new VerificationService();
  const report = await svc.run(worktree, dir, "corregir render de widget heredado", ["docs/Zeta.md"]);
  assert.equal(report.overall, "pass");
  const testStep = report.steps.find((s) => s.name === "test");
  assert.ok(testStep);
  assert.equal(testStep.status, "pass");
  assert.match(testStep.logSnippet ?? "", /\[quarantine\] quarantined 1 failure\(s\)/);
  assert.match(testStep.logSnippet ?? "", /no overlap with change \[docs\/Zeta\.md\]/);
  const buildLog = fs.readFileSync(path.join(dir, "logs", "build.log"), "utf-8");
  assert.match(buildLog, /quarantine/);
});

test("run(): fallo con solape → fail real con fail-fast", { skip: !PNPM_AVAILABLE }, async () => {
  const { worktree, dir } = makeFailingNodeProject();
  const svc = new VerificationService();
  const report = await svc.run(worktree, dir, "corregir render de widget heredado", ["src/legacy-widget.ts"]);
  assert.equal(report.overall, "fail");
  const testStep = report.steps.find((s) => s.name === "test");
  const buildStep = report.steps.find((s) => s.name === "build");
  assert.equal(testStep?.status, "fail");
  assert.equal(buildStep?.status, "skipped");
  assert.doesNotMatch(testStep?.logSnippet ?? "", /\[quarantine\]/);
});
