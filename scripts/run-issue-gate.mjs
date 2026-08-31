#!/usr/bin/env node
// GATE DE CALIDAD (experimento aislado).
//
// Verifica un cambio (base...head) con checks deterministas ACOTADOS al diff,
// sin intervención de LLM ni consumo de tokens. Cada check tiene un umbral
// numérico; el veredicto final es PASS o FAIL según los checks bloqueantes.
//
// Uso:
//   node run-issue-gate.mjs --repo <path> --base <ref> --head <ref>
//       [--out <dir>] [--coverage-threshold <pct>] [--jscpd-min-tokens <n>]
//
// Salidas:
//   - <out>/gate-verdict-<ts>.json   (veredicto estructurado)
//   - <out>/raw/*                     (outputs crudos por herramienta)
//   - resumen legible en stdout

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Argumentos ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const REPO = path.resolve(argValue("--repo", "."));
const BASE = argValue("--base", "main");
const HEAD = argValue("--head", "HEAD");
const OUT_DIR = path.resolve(argValue("--out", path.join(process.cwd(), "outputs")));
// Umbral de cobertura por defecto (promedio de statements de los archivos
// fuente tocados por el diff, excluyendo tests). Configurable por flag.
const COVERAGE_THRESHOLD = Number(argValue("--coverage-threshold", "70"));
// jscpd: calibración compartida con el pipeline de diagnóstico de TermCanvas
// (min-tokens 120 — con 50 los repos reales explotan en clones de ~10 líneas).
const JSCPD_MIN_TOKENS = Number(argValue("--jscpd-min-tokens", "120"));
const TOOLS_DIR = path.join(__dirname, ".tools");
const RAW_DIR = path.join(OUT_DIR, "raw");

const TS_SOURCE = /\.(ts|tsx|mts|cts)$/;
const JS_SOURCE = /\.(js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// En Windows, npx/npm son shims .cmd (no .exe): execFile no los resuelve y
// `shell:true` rompe args con espacios (no cotiza). La vía robusta es pasar
// por cmd.exe /d /s /c con cada argumento cotizado manualmente (misma
// estrategia que el orquestador de diagnóstico de TermCanvas).
function quoteCmdArg(s) {
  const str = String(s);
  return /[\s"&|<>^%!]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

async function run(cmd, cmdArgs, { cwd, timeoutMs = 240000, shell = false, ignoreExitCode = false } = {}) {
  const base = {
    cwd,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  };
  const exec = async () => {
    if (shell) {
      const cmdline = [cmd, ...cmdArgs].map(quoteCmdArg).join(" ");
      return execFileAsync("cmd.exe", ["/d", "/s", "/c", cmdline], base);
    }
    return execFileAsync(cmd, cmdArgs, base);
  };
  try {
    const result = await exec();
    return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0 };
  } catch (error) {
    // Herramientas que señalizan hallazgos con exit != 0 (eslint, tsc,
    // jscpd, knip, tests): el output importa aunque el exit falle.
    if (ignoreExitCode && typeof error?.code === "number") {
      return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code };
    }
    throw error;
  }
}

async function git(argsList, { cwd = REPO } = {}) {
  const res = await run("git", argsList, { cwd, timeoutMs: 30000 });
  return res.stdout;
}

async function saveRaw(name, content) {
  await mkdir(RAW_DIR, { recursive: true });
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  await writeFile(path.join(RAW_DIR, safe), String(content));
}

// ─── Diff del PR ──────────────────────────────────────────────────────────
async function computeDiff() {
  const baseSha = (await git(["rev-parse", BASE])).trim();
  const headSha = (await git(["rev-parse", HEAD])).trim();
  const nameOnly = await git(["diff", "--name-only", `${BASE}...${HEAD}`]);
  const diffFiles = nameOnly
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sourceFiles = [];
  for (const f of diffFiles) {
    if (!TS_SOURCE.test(f) && !JS_SOURCE.test(f)) continue;
    if (!(await exists(path.join(REPO, f)))) continue; // archivos borrados: no se verifican
    sourceFiles.push(f);
  }
  return { baseSha, headSha, diffFiles, sourceFiles };
}

// ─── Chequeo de paquetes del repo ─────────────────────────────────────────
async function readPackageJson() {
  try {
    return JSON.parse(await readFile(path.join(REPO, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

// ─── Descarga best-effort de binarios standalone (gitleaks) ───────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "termcanvas-gate-experiment" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          httpsGet(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} para ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function githubLatestRelease(repo) {
  const body = await httpsGet(`https://api.github.com/repos/${repo}/releases/latest`);
  return JSON.parse(body.toString("utf8"));
}

async function extractZip(zipPath, dest) {
  await run("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`,
  ]);
}

async function findExe(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.exe$/i.test(e.name)) return p;
    }
  }
  return null;
}

async function ensureGitleaks() {
  const finalPath = path.join(TOOLS_DIR, "gitleaks.exe");
  try {
    await access(finalPath);
    return finalPath;
  } catch {
    /* falta: descargar */
  }
  try {
    await mkdir(TOOLS_DIR, { recursive: true });
    const rel = await githubLatestRelease("gitleaks/gitleaks");
    const asset = (rel.assets ?? []).find((a) => /windows.*(?:x64|amd64).*\.zip/i.test(a.name));
    if (!asset) return null;
    const zipPath = path.join(TOOLS_DIR, asset.name);
    const body = await httpsGet(asset.browser_download_url);
    await writeFile(zipPath, body);
    const dest = path.join(TOOLS_DIR, "gitleaks-extract");
    await extractZip(zipPath, dest);
    const exe = await findExe(dest);
    if (!exe) return null;
    await rename(exe, finalPath).catch(() => {});
    return finalPath;
  } catch {
    return null;
  }
}

// ─── Wrapper de checks ────────────────────────────────────────────────────
function makeCheck(name, { blocking }) {
  return {
    name,
    blocking,
    status: "pending",
    findings: [],
    findings_count: 0,
    note: null,
    error: null,
  };
}

function finishCheck(check, status, { findings = [], note = null, error = null } = {}) {
  check.status = status;
  check.findings = findings;
  check.findings_count = findings.length;
  check.note = note ?? null;
  check.error = error ?? null;
  return check;
}

async function runCheck(name, { blocking }, fn) {
  const check = makeCheck(name, { blocking });
  process.stdout.write(`[gate] ${name} — corriendo…\n`);
  try {
    const out = await fn(check);
    return out; // fn ya llamó finishCheck
  } catch (error) {
    finishCheck(check, "error", { error: error instanceof Error ? error.message : String(error) });
    return check;
  }
}

// ─── Checks individuales ──────────────────────────────────────────────────

// ─── Tests (regresión base vs head) ───────────────────────────────────────
// Un PR NO debe exigir el suite completo verde: los repos reales tienen tests
// flaky o rotos por entorno (network down, artefactos, PATH). La pregunta
// justa es "¿el PR rompió algo que antes pasaba?". Por eso se corren los
// tests en el HEAD y, si fallan, en el BASE (worktree descartable): solo
// bloquean los tests que fallan en head y NO fallaban en base (regresión).
// Si la regresión es aparente, se reintenta el head una vez (mitiga flaky).

function parseFailedTests(text) {
  const names = new Set();
  const normalize = (name) => {
    // Los fallos a nivel de ARCHIVO (node:test) reportan el path absoluto:
    // en el base (worktree temporal) la ruta difiere → no matchearía. Usar
    // el basename hace la comparación base/head estable.
    if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(name)) {
      return path.basename(name);
    }
    return name;
  };
  // node:test (TAP): "not ok 101 - Nombre del test"
  const tapRe = /^not ok \d+ - (.+)$/gm;
  for (const m of text.matchAll(tapRe)) names.add(normalize(m[1].trim()));
  // vitest: "  × add > suma dos números 15ms" — el sufijo de duración se
  // descarta para que el nombre sea estable entre base y head.
  const vitestRe = /^\s*[×✗]\s+(.+?)\s*$/gm;
  for (const m of text.matchAll(vitestRe)) {
    names.add(normalize(m[1].trim().replace(/\s+\d+ms\s*$/, "")));
  }
  return names;
}

async function runTestsInTree(treePath) {
  const { stdout, stderr, code } = await run("npm", ["test"], {
    cwd: treePath,
    shell: true,
    ignoreExitCode: true,
    timeoutMs: 300000,
  });
  const text = `${stdout}\n${stderr}`;
  return { code, failed: parseFailedTests(text), text };
}

async function ensureBaseTree(baseSha) {
  const baseDir = path.join(os.tmpdir(), `termcanvas-gate-base-${Date.now()}`);
  await run("git", ["worktree", "add", "--detach", baseDir, baseSha], {
    cwd: REPO,
    timeoutMs: 120000,
  });
  // El worktree nuevo no tiene node_modules: junction al del repo principal
  // (Windows: mklink /J es un link de directorios, no sigue el target al
  // borrar). Evita un npm install completo solo para correr los tests.
  const nmSrc = path.join(REPO, "node_modules");
  if (await exists(nmSrc)) {
    await run("cmd", ["/c", "mklink", "/J", path.join(baseDir, "node_modules"), nmSrc]);
  }
  return baseDir;
}

async function cleanupBaseTree(baseDir) {
  if (!baseDir) return;
  try {
    await rm(path.join(baseDir, "node_modules"), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  try {
    await run("git", ["worktree", "remove", "--force", baseDir], {
      cwd: REPO,
      timeoutMs: 60000,
    });
  } catch {
    /* best effort */
  }
}

async function checkTests(check, pkg, diff) {
  const testScript = pkg?.scripts?.test ?? pkg?.scripts?.["test:unit"] ?? null;
  if (!testScript) {
    return finishCheck(check, "no_aplicable", { note: "sin script de test en package.json" });
  }
  process.stdout.write("[gate] tests (head) — corriendo…\n");
  const head = await runTestsInTree(REPO);
  await saveRaw("tests-head-output.txt", head.text);
  if (head.code === 0) {
    return finishCheck(check, "ok", { note: "npm test (exit 0) — sin fallos en head" });
  }

  // Head falló: ¿es regresión o preexistente/flaky? Correr el base.
  let base = null;
  let infraNote = "";
  let baseDir = null;
  try {
    baseDir = await ensureBaseTree(diff.baseSha);
    process.stdout.write("[gate] tests (base) — corriendo…\n");
    base = await runTestsInTree(baseDir);
    await saveRaw("tests-base-output.txt", base.text);
  } catch (error) {
    // No se pudo verificar el base: conservador, asumir base limpio (cualquier
    // fallo de head cuenta como regresión) pero con nota.
    base = { code: 0, failed: new Set() };
    infraNote = ` (base no verificable: ${error instanceof Error ? error.message : String(error)})`;
  } finally {
    await cleanupBaseTree(baseDir);
  }

  const regression = [...head.failed].filter((n) => !base.failed.has(n));
  if (regression.length === 0) {
    return finishCheck(check, "ok", {
      note: `${head.failed.size} fallo(s) en head, igual(es) al base: sin regresión${infraNote}`,
    });
  }

  // Regresión aparente: reintentar el head una vez (mitiga flaky).
  process.stdout.write("[gate] tests (retry head) — corriendo…\n");
  const retry = await runTestsInTree(REPO);
  await saveRaw("tests-retry-output.txt", retry.text);
  if (retry.code === 0) {
    return finishCheck(check, "ok", { note: "falló 1 vez y pasó en el retry (flaky), sin regresión persistente" });
  }

  const findings = [...regression].map((name) => ({
    tool: "tests",
    file: null,
    line: null,
    severity: "error",
    rule: "regresion",
    message: name,
  }));
  return finishCheck(check, "fail", {
    findings,
    note: `regresión: ${regression.join("; ")} (fallan en head, pasaban en base)${infraNote}`,
  });
}

// ─── Cobertura (detección de runner) ──────────────────────────────────────
// El repo puede exponer su cobertura de tres formas:
//   1. script "coverage" en package.json        → npm run coverage
//   2. vitest instalado                          → npx vitest run --coverage
//   3. node:test (node --test / tsx --test)      → node --experimental-test-coverage
//      (cobertura nativa de node >= 20.8, tabla text por archivo)
// Si ninguna aplica, el check es "no aplicable" (no bloquea): el gate no
// instala ni configura herramientas; avisa y deja pasar.

function isVitest(pkg) {
  return Boolean(
    pkg?.dependencies?.vitest || pkg?.devDependencies?.vitest,
  );
}

function isNodeTest(testScript) {
  return /(?:node|tsx)\s+.*--test\b/.test(testScript ?? "");
}

function extractTestFiles(testScript) {
  // "tsx --test tests/a.test.ts tests/b.test.ts" → archivos tras --test
  const idx = (testScript ?? "").indexOf("--test");
  if (idx < 0) return [];
  const rest = testScript.slice(idx + "--test".length);
  return rest
    .split(/\s+/)
    .filter((t) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(t) && t.trim());
}

async function checkCoverage(check, pkg, diff) {
  const sourceFiles = diff.sourceFiles.filter((f) => !TEST_FILE.test(f));
  if (sourceFiles.length === 0) {
    return finishCheck(check, "ok", { note: "sin archivos fuente en el diff (solo tests)" });
  }
  const testScript = pkg?.scripts?.test ?? null;
  if (!testScript) {
    return finishCheck(check, "no_aplicable", { note: "sin script de test en package.json" });
  }

  const readSummary = async () => {
    try {
      return JSON.parse(
        await readFile(path.join(REPO, "coverage", "coverage-summary.json"), "utf8"),
      );
    } catch {
      return null;
    }
  };

  const avgFromSummary = (report) => {
    const fileKey = (abs) => abs.replace(/\\/g, "/");
    const reportEntries = new Map(
      Object.entries(report).map(([k, v]) => [k.replace(/\\/g, "/"), v]),
    );
    let covered = 0;
    let total = 0;
    const present = [];
    for (const f of sourceFiles) {
      const key = fileKey(path.resolve(REPO, f));
      const entry = reportEntries.get(key);
      if (!entry?.statements) continue;
      present.push(f);
      covered += Number(entry.statements.covered ?? 0);
      total += Number(entry.statements.total ?? 0);
    }
    if (total === 0) return null;
    return { pct: (covered / total) * 100, present };
  };

  let report = null;
  let note = null;
  let text = "";

  if (pkg.scripts?.coverage) {
    const r = await run("npm", ["run", "coverage"], {
      cwd: REPO,
      shell: true,
      ignoreExitCode: true,
      timeoutMs: 300000,
    });
    text = `${r.stdout}\n${r.stderr}`;
    await saveRaw("coverage-output.txt", text);
    note = `npm run coverage (exit ${r.code})`;
    report = await readSummary();
  } else if (isVitest(pkg)) {
    const r = await run("npx", ["vitest", "run", "--coverage"], {
      cwd: REPO,
      shell: true,
      ignoreExitCode: true,
      timeoutMs: 300000,
    });
    text = `${r.stdout}\n${r.stderr}`;
    await saveRaw("coverage-output.txt", text);
    note = `vitest run --coverage (exit ${r.code})`;
    report = await readSummary();
  } else if (isNodeTest(testScript)) {
    const files = extractTestFiles(testScript);
    if (files.length === 0) {
      return finishCheck(check, "no_aplicable", { note: "runner node:test sin archivos de test detectables en el script" });
    }
    // node 20 solo expone --experimental-test-coverage (sin include: cubre
    // solo lo que los tests importan). node 22+ tiene --test-coverage-include;
    // si el repo quiere cobertura de archivos no importados, que exponga un
    // script "coverage" (c8/vitest) y el gate lo usa por delante.
    const r = await run(
      "node",
      ["--experimental-test-coverage", "--import", "tsx", "--test", ...files],
      { cwd: REPO, shell: true, ignoreExitCode: true, timeoutMs: 420000 },
    );
    text = `${r.stdout}\n${r.stderr}`;
    await saveRaw("coverage-output.txt", text);
    note = `node --experimental-test-coverage (exit ${r.code})`;
    // Tabla text por archivo → promedio de % stmts de los archivos del diff.
    const wanted = sourceFiles.map((f) => f.replace(/\\/g, "/"));
    const rowRe = /^\s*(\S.*?)\s+\|\s+([\d.]+)\s+\|/;
    const byFile = new Map();
    for (const line of text.split(/\r?\n/)) {
      const m = rowRe.exec(line);
      if (!m) continue;
      const name = m[1].trim();
      if (name === "All files" || name.startsWith("---")) continue;
      const rel = name.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!wanted.includes(rel)) continue;
      byFile.set(rel, Number(m[2]));
    }
    if (byFile.size === 0) {
      return finishCheck(check, "no_aplicable", {
        note: `ningún archivo del diff aparece en el reporte de coverage (node:test cubre solo lo que los tests importan); nota: ${note}`,
      });
    }
    const avg = [...byFile.values()].reduce((a, b) => a + b, 0) / byFile.size;
    const presentNote = `${avg.toFixed(1)}% de stmts promedio en ${byFile.size} archivo(s) del diff presentes en el reporte (umbral ${COVERAGE_THRESHOLD}%)`;
    if (avg >= COVERAGE_THRESHOLD) {
      return finishCheck(check, "ok", { note: `${note} — ${presentNote}` });
    }
    return finishCheck(check, "fail", { note: `${note} — ${presentNote}` });
  } else {
    return finishCheck(check, "no_aplicable", {
      note: "runner no soportado para coverage (se requiere script 'coverage', vitest o node:test)",
    });
  }

  if (!report) {
    // Si los tests fallaron, el coverage no se pudo calcular sobre código
    // roto: no es un fallo del gate — el check de tests ya lo señaló.
    if (/failed/i.test(text)) {
      return finishCheck(check, "no_aplicable", {
        note: `${note} — tests fallando en head; coverage no calculable (el check de tests ya bloquea)`,
      });
    }
    return finishCheck(check, "error", {
      error: `${note} — no se generó coverage/coverage-summary.json (config de coverage del repo ausente)`,
    });
  }
  const result = avgFromSummary(report);
  if (!result) {
    return finishCheck(check, "no_aplicable", {
      note: "ningún archivo del diff aparece en el reporte de coverage",
    });
  }
  const noteFinal = `${note} — ${result.pct.toFixed(1)}% de statements en ${result.present.length} archivo(s) del diff (umbral ${COVERAGE_THRESHOLD}%)`;
  if (result.pct >= COVERAGE_THRESHOLD) {
    return finishCheck(check, "ok", { note: noteFinal });
  }
  return finishCheck(check, "fail", { note: noteFinal });
}

// tsc --noEmit: se corre completo y se FILTRAN los errores a los archivos del
// diff (errores preexistentes fuera del diff no bloquean).
async function checkTsc(check, diff) {
  if (!(await exists(path.join(REPO, "tsconfig.json")))) {
    return finishCheck(check, "no_aplicable", { note: "sin tsconfig.json" });
  }
  const { stdout, stderr } = await run("npx", ["tsc", "--noEmit"], {
    cwd: REPO,
    shell: true,
    ignoreExitCode: true,
    timeoutMs: 180000,
  });
  const text = `${stdout}\n${stderr}`;
  await saveRaw("tsc-output.txt", text);
  const diffSet = new Set(diff.diffFiles.map((f) => f.replace(/\\/g, "/")));
  const findings = [];
  const errRe = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
  for (const line of text.split(/\r?\n/)) {
    const m = errRe.exec(line);
    if (!m) continue;
    const rel = path
      .relative(REPO, path.resolve(REPO, m[1]))
      .replace(/\\/g, "/");
    if (!diffSet.has(rel)) continue; // error fuera del diff: no bloquea
    findings.push({
      tool: "tsc",
      file: rel,
      line: Number(m[2]),
      severity: "error",
      rule: m[4],
      message: m[5],
    });
  }
  if (findings.length === 0) {
    return finishCheck(check, "ok", { note: "sin errores de tipo en los archivos del diff" });
  }
  return finishCheck(check, "fail", { findings, note: `${findings.length} error(es) de tipo en archivos del diff` });
}

// eslint sobre los archivos del diff. Solo severity "error" bloquea.
async function checkEslint(check, diff) {
  const configCandidates = [
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
    ".eslintrc.js", ".eslintrc.json", ".eslintrc",
  ];
  let hasConfig = false;
  for (const name of configCandidates) {
    if (await exists(path.join(REPO, name))) {
      hasConfig = true;
      break;
    }
  }
  if (!hasConfig) {
    return finishCheck(check, "no_aplicable", { note: "sin config de eslint" });
  }
  if (diff.sourceFiles.length === 0) {
    return finishCheck(check, "ok", { note: "sin archivos fuente en el diff" });
  }
  const { stdout } = await run("npx", ["eslint", ...diff.sourceFiles, "-f", "json"], {
    cwd: REPO,
    shell: true,
    ignoreExitCode: true,
    timeoutMs: 120000,
  });
  await saveRaw("eslint-report.json", stdout);
  let results = [];
  try {
    results = JSON.parse(stdout);
  } catch {
    return finishCheck(check, "error", { error: "eslint no devolvió JSON parseable" });
  }
  const findings = [];
  for (const file of results) {
    for (const m of file.messages) {
      if (m.severity !== 2) continue; // solo errores bloquean
      findings.push({
        tool: "eslint",
        file: path.relative(REPO, file.filePath).replace(/\\/g, "/"),
        line: m.line,
        severity: "error",
        rule: m.ruleId ?? "(parse-error)",
        message: m.message,
      });
    }
  }
  if (findings.length === 0) {
    return finishCheck(check, "ok", { note: `${diff.sourceFiles.length} archivo(s) linted sin errores` });
  }
  return finishCheck(check, "fail", { findings, note: `${findings.length} error(es) de eslint en el diff` });
}

// jscpd sobre los archivos del diff. Solo bloquean los clones cuyas partes
// caen en LÍNEAS NUEVAS del diff (los que el PR introdujo): la duplicación
// preexistente en archivos tocados es deuda del repo, no del PR. Reporte en
// temp sin espacios (bug de Windows con espacios).
async function computeNewLines(diff, opts = {}) {
  // git diff -U0 base...head -- <archivos> → Map<archivo, Set<nroLíneaNueva>>
  const repo = opts.repoPath ?? REPO;
  const base = opts.base ?? BASE;
  const head = opts.head ?? HEAD;
  const byFile = new Map();
  if (diff.sourceFiles.length === 0) return byFile;
  const { stdout } = await run(
    "git",
    ["diff", "-U0", `${base}...${head}`, "--", ...diff.sourceFiles],
    { cwd: repo, timeoutMs: 60000, ignoreExitCode: true },
  );
  let currentFile = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length).replace(/\\/g, "/");
      if (!byFile.has(currentFile)) byFile.set(currentFile, new Set());
    } else if (line.startsWith("@@") && currentFile) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        const start = Number(m[1]);
        const count = m[2] ? Number(m[2]) : 1;
        const set = byFile.get(currentFile);
        for (let i = 0; i < count; i++) set.add(start + i);
      }
    }
  }
  return byFile;
}

async function checkJscpd(check, diff) {
  if (diff.sourceFiles.length === 0) {
    return finishCheck(check, "ok", { note: "sin archivos fuente en el diff" });
  }
  const outDir = path.join(os.tmpdir(), "termcanvas-gate-jscpd");
  await mkdir(outDir, { recursive: true });
  const filesArg = diff.sourceFiles.map((f) => f.replace(/\\/g, "/"));
  await run(
    "npx",
    [
      "--yes", "jscpd", ...filesArg,
      "--reporters", "json",
      "--output", outDir,
      "--min-tokens", String(JSCPD_MIN_TOKENS),
      "--ignore", "**/node_modules/**,**/coverage/**,**/dist/**",
    ],
    { cwd: REPO, shell: true, ignoreExitCode: true, timeoutMs: 120000 },
  );
  let report = {};
  try {
    report = JSON.parse(await readFile(path.join(outDir, "jscpd-report.json"), "utf8"));
  } catch {
    /* sin reporte: duplicación no detectada o error */
  }
  const newLines = await computeNewLines(diff);
  // jscpd reporta el nombre como basename ("lib.ts"): resolver al path real
  // del diff para poder cruzar contra las líneas nuevas.
  const fileByBasename = new Map(
    diff.sourceFiles.map((f) => [path.basename(f), f]),
  );
  const dups = report?.duplicates ?? [];
  const findings = [];
  for (const d of dups) {
    const first = d.firstFile ?? {};
    const second = d.secondFile ?? {};
    const firstRel = first.name ? fileByBasename.get(path.basename(first.name)) ?? null : null;
    const secondRel = second.name ? fileByBasename.get(path.basename(second.name)) ?? null : null;
    const aLine = first.startLoc?.line ?? first.start ?? null;
    const bLine = second.startLoc?.line ?? second.start ?? null;
    const aNew = Boolean(firstRel && aLine && newLines.get(firstRel)?.has(aLine));
    const bNew = Boolean(secondRel && bLine && newLines.get(secondRel)?.has(bLine));
    if (!aNew && !bNew) continue; // clon preexistente: no bloquea
    const linesCount = d.lines ?? (aLine != null && bLine != null ? Math.abs(bLine - aLine) : 1);
    findings.push({
      tool: "jscpd",
      file: firstRel ?? "?",
      line: aLine,
      severity: "info",
      rule: "duplicacion-nueva",
      message: `~${linesCount} líneas duplicadas con ${second.name ? path.basename(second.name) : "?"} (introducido por el diff)`,
    });
  }
  if (findings.length === 0) {
    return finishCheck(check, "ok", { note: "sin clones nuevos en los archivos del diff" });
  }
  return finishCheck(check, "fail", { findings, note: `${findings.length} clon(es) nuevo(s) en el diff` });
}

// gitleaks: secretos en el historial del cambio. Findings filtrados a los
// archivos del diff. Binario standalone (se descarga si falta).
async function checkGitleaks(check, diff) {
  const bin = await ensureGitleaks();
  if (!bin) {
    return finishCheck(check, "no_aplicable", { error: "binario no disponible (no se pudo descargar)" });
  }
  const outPath = path.join(RAW_DIR, "gitleaks.json");
  await run(
    bin,
    ["detect", "--source", REPO, "--no-banner", "--report-format", "json", "--report-path", outPath, "--exit-code", "0"],
    { cwd: REPO, timeoutMs: 120000, ignoreExitCode: true },
  );
  let report = [];
  try {
    report = JSON.parse(await readFile(outPath, "utf8"));
  } catch {
    report = [];
  }
  const diffSet = new Set(diff.diffFiles.map((f) => f.replace(/\\/g, "/")));
  const findings = report
    .filter((r) => diffSet.has(path.relative(REPO, path.resolve(REPO, r.File ?? "")).replace(/\\/g, "/")))
    .map((r) => ({
      tool: "gitleaks",
      file: path.relative(REPO, path.resolve(REPO, r.File ?? "")).replace(/\\/g, "/"),
      line: r.StartLine ?? null,
      severity: "critical",
      rule: r.RuleID ?? "secret",
      message: r.Description ?? (r.Secret ? `secreto detectado: ${r.Secret.slice(0, 40)}…` : "secreto detectado"),
    }));
  if (findings.length === 0) {
    return finishCheck(check, "ok", { note: "sin secretos en el historial del diff" });
  }
  return finishCheck(check, "fail", { findings, note: `${findings.length} secreto(s) en el diff` });
}

// semgrep sobre los archivos del diff (p/security-audit). Solo severidad
// error/critical bloquea. Si semgrep no está en PATH → no aplicable.
async function checkSemgrep(check, diff) {
  if (diff.sourceFiles.length === 0) {
    return finishCheck(check, "ok", { note: "sin archivos fuente en el diff" });
  }
  try {
    await run("semgrep", ["--version"], { cwd: REPO, timeoutMs: 30000 });
  } catch {
    return finishCheck(check, "no_aplicable", { error: "semgrep no está en PATH" });
  }
  const outPath = path.join(RAW_DIR, "semgrep.json");
  await run(
    "semgrep",
    [
      "scan", "--config", "p/security-audit",
      ...diff.sourceFiles.map((f) => f.replace(/\\/g, "/")),
      "--json", "--output", outPath,
    ],
    { cwd: REPO, timeoutMs: 300000, ignoreExitCode: true },
  );
  let report = {};
  try {
    report = JSON.parse(await readFile(outPath, "utf8"));
  } catch {
    return finishCheck(check, "error", { error: "semgrep no devolvió JSON parseable" });
  }
  const sevMap = { ERROR: "error", WARNING: "warning", INFO: "info" };
  const findings = (report.results ?? [])
    .filter((r) => (sevMap[r.extra?.severity] ?? "warning") === "error")
    .map((r) => ({
      tool: "semgrep",
      file: path.relative(REPO, r.path ?? "").replace(/\\/g, "/"),
      line: r.start?.line ?? null,
      severity: "error",
      rule: r.check_id ?? "semgrep",
      message: r.extra?.message ?? "hallazgo de semgrep",
    }));
  if (findings.length === 0) {
    return finishCheck(check, "ok", { note: "sin hallazgos de severidad alta" });
  }
  return finishCheck(check, "fail", { findings, note: `${findings.length} hallazgo(s) de severidad alta` });
}

// knip: código muerto. NO bloquea (info) — solo informa.
async function checkKnip(check, diff) {
  if (diff.sourceFiles.length === 0) {
    return finishCheck(check, "ok", { note: "sin archivos fuente en el diff" });
  }
  const { stdout, code } = await run(
    "npx",
    ["--yes", "knip", "--reporter", "json", "--no-progress"],
    { cwd: REPO, shell: true, ignoreExitCode: true, timeoutMs: 120000 },
  );
  await saveRaw("knip-report.json", stdout);
  let report = {};
  try {
    report = JSON.parse(stdout);
  } catch {
    return finishCheck(check, "ok", { note: "knip sin reporte parseable (no bloquea)" });
  }
  const diffSet = new Set(diff.diffFiles.map((f) => f.replace(/\\/g, "/")));
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  const findings = [];
  for (const issue of issues) {
    const rel = path.relative(REPO, path.resolve(REPO, issue?.file ?? "")).replace(/\\/g, "/");
    if (!diffSet.has(rel)) continue;
    for (const item of Array.isArray(issue?.exports) ? issue.exports : []) {
      findings.push({
        tool: "knip",
        file: rel,
        line: item?.line ?? null,
        severity: "info",
        rule: "export-sin-uso",
        message: `${item?.name ?? "?"} sin uso en el proyecto`,
      });
    }
  }
  return finishCheck(check, "ok", { findings, note: `${findings.length} hallazgo(s) de código muerto (no bloquea)` });
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  const started = Date.now();

  const diff = await computeDiff();
  const pkg = await readPackageJson();

  const lines = [];
  lines.push("GATE DE CALIDAD — EXPERIMENTO");
  lines.push(`repo: ${REPO}`);
  lines.push(`base: ${BASE} (${diff.baseSha.slice(0, 8)}) → head: ${HEAD} (${diff.headSha.slice(0, 8)})`);
  lines.push(`diff: ${diff.diffFiles.length} archivo(s)`);
  for (const f of diff.diffFiles) lines.push(`  - ${f}`);
  lines.push("");

  const checks = [];
  checks.push(await runCheck("tests", { blocking: true }, (c) => checkTests(c, pkg, diff)));
  checks.push(await runCheck("cobertura", { blocking: true }, (c) => checkCoverage(c, pkg, diff)));
  checks.push(await runCheck("tsc", { blocking: true }, (c) => checkTsc(c, diff)));
  checks.push(await runCheck("eslint", { blocking: true }, (c) => checkEslint(c, diff)));
  checks.push(await runCheck("jscpd", { blocking: true }, (c) => checkJscpd(c, diff)));
  checks.push(await runCheck("gitleaks", { blocking: true }, (c) => checkGitleaks(c, diff)));
  checks.push(await runCheck("semgrep", { blocking: true }, (c) => checkSemgrep(c, diff)));
  checks.push(await runCheck("knip", { blocking: false }, (c) => checkKnip(c, diff)));

  const failingBlocking = checks.filter(
    (c) => c.blocking && (c.status === "fail" || c.status === "error"),
  );
  const verdict = failingBlocking.length === 0 ? "PASS" : "FAIL";
  const failedChecks = failingBlocking.map((c) => c.name);

  lines.push(`check        | estado        | hallazgos | nota`);
  lines.push(`-------------|---------------|-----------|-----`);
  for (const c of checks) {
    const name = c.name.padEnd(12);
    const status = c.status.padEnd(13);
    const count = String(c.findings_count).padEnd(9);
    const note = c.note ?? c.error ?? "";
    lines.push(`${name}| ${status} | ${count} | ${note}`);
  }
  lines.push("");
  lines.push(`VEREDICTO: ${verdict}${failedChecks.length ? ` — checks bloqueantes fallando: ${failedChecks.join(", ")}` : ""}`);

  // Detalle de findings por check (primeros 10 de cada uno).
  for (const c of checks) {
    if (!c.findings.length) continue;
    lines.push(`[${c.name}] ${c.findings.length} hallazgo(s):`);
    for (const f of c.findings.slice(0, 10)) {
      const loc = f.file + (f.line != null ? `:${f.line}` : "");
      lines.push(`   ${f.severity.toUpperCase().padEnd(8)} ${loc}  [${f.rule}] ${f.message}`);
    }
  }
  lines.push(`duración total: ${Math.round((Date.now() - started) / 1000)}s`);

  const summary = lines.join("\n") + "\n";
  process.stdout.write(summary);

  const ts = Date.now();
  const output = {
    timestamp: ts,
    repo: REPO,
    base: diff.baseSha,
    head: diff.headSha,
    branch: HEAD,
    diff_files: diff.diffFiles,
    checks,
    verdict,
    failed_checks: failedChecks,
    thresholds: { coverage: COVERAGE_THRESHOLD, jscpd_min_tokens: JSCPD_MIN_TOKENS },
  };
  const verdictPath = path.join(OUT_DIR, `gate-verdict-${ts}.json`);
  await writeFile(verdictPath, JSON.stringify(output, null, 2));
  process.stdout.write(`\nVeredicto JSON: ${verdictPath}\n`);
}

// Solo ejecutar main() cuando el archivo corre como CLI (no al importarlo
// como módulo: la Fase 2 importará funciones puras para testearlas).
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`\nError fatal del gate: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

// Exports para tests: funciones puras que la app importa (Fase 2).
export { parseFailedTests, computeNewLines, isNodeTest, extractTestFiles };
