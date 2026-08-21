#!/usr/bin/env node
// Orquestador del diagnóstico determinista: herramientas + agregación.
// Las herramientas corren PRIMERO contra el repositorio completo; el LLM (en
// la app) recibe solo la salida estructurada de acá (tool-findings-<ts>.json).
//
// Uso: node run-diagnostico-tools.mjs --repo <path-al-repo> --out <dir>
// (La app lo invoca desde src/planner/toolsSession.ts; no se llama directo.)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  writeFile,
  readFile,
  access,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
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
const REPO = path.resolve(
  argValue("--repo", "C:\\Users\\Estudiante UCU\\OneDrive\\Escritorio\\education-games"),
);
const OUT_DIR = path.resolve(
  argValue("--out", path.join(__dirname, "salidas")),
);
const TOOLS_DIR = path.join(__dirname, ".tools");
const RAW_DIR = path.join(OUT_DIR, "raw");

// Paquetes del repo: se DETECTAN de la estructura real (package.json en la
// raíz y en subdirectorios directos), no se asumen frontend/backend. Así el
// pipeline corre igual en cualquier repo: monorepo, paquete único en la
// raíz (label "root"), o incluso sin npm (solo tools repo-level).
const TS = /\.(ts|tsx|mts|cts)$/;
const JS = /\.(js|jsx|mjs|cjs)$/;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Detecta los paquetes del repo: la raíz (si tiene package.json) y los
// subdirectorios directos con package.json. Devuelve [{dir, label}]:
// label "root" para el paquete de la raíz, el nombre del subdir para el resto.
async function detectPackages(repoPath) {
  const packages = [];
  if (await exists(path.join(repoPath, "package.json"))) {
    packages.push({ dir: ".", label: "root" });
  }
  const entries = await readdir(repoPath, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
    if (await exists(path.join(repoPath, e.name, "package.json"))) {
      packages.push({ dir: e.name, label: e.name });
    }
  }
  if (packages.length === 0) {
    // Repo sin npm (Python/Go/etc.): igual se detecta un "paquete" raíz para
    // que el conteo de cobertura muestre archivos; las tools npm no corren.
    packages.push({ dir: ".", label: "root" });
  }
  return packages;
}

// Capacidades por paquete: qué configs/tools aplican (configs del repo).
async function detectCapabilities(pkg) {
  const base = path.join(REPO, pkg.dir);
  const cap = {
    packageJson: await exists(path.join(base, "package.json")),
    eslint: null, // ruta de la config de eslint, o null
    tsconfig: null, // tsconfig a usar (tsconfig.app.json típico de Vite, si no tsconfig.json)
    depcruise: await exists(path.join(base, ".dependency-cruiser.cjs")) ||
      await exists(path.join(base, ".dependency-cruiser.js")),
  };
  for (const name of ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc.js", ".eslintrc.json", ".eslintrc"]) {
    if (await exists(path.join(base, name))) {
      cap.eslint = name;
      break;
    }
  }
  if (await exists(path.join(base, "tsconfig.app.json"))) cap.tsconfig = "tsconfig.app.json";
  else if (await exists(path.join(base, "tsconfig.json"))) cap.tsconfig = "tsconfig.json";
  return cap;
}

// ─── Helpers de proceso ──────────────────────────────────────────────────
// En Windows, npx/npm son shims .cmd (no .exe): execFile no los resuelve y
// `shell:true` rompe args con espacios (no cotiza). La vía robusta es pasar
// por cmd.exe /d /s /c con cada argumento cotizado manualmente.
function quoteCmdArg(s) {
  const str = String(s);
  // Cotiza solo lo que lo necesite; escapa comillas internas a la cmd.
  return /[\s"&|<>^%!]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

// Corre un proceso y devuelve un resultado ESTRUCTURADO. NUNCA tira por
// fallos de ejecución (exit != 0, timeout, maxBuffer, spawn): todos quedan
// en el resultado para que la herramienta decida cómo degradar. El output
// capturado (completo o parcial) viaja siempre en stdout/stderr.
//
// Devuelve { ok, stdout, stderr, code, signal, timedOut, errorMessage }:
//   - ok: la corrida salió con exit 0 (sin hallazgos señalizados).
//   - code: exit code NUMÉRICO si el proceso corrió hasta salir (0 o != 0;
//     las herramientas señalizan hallazgos con exit != 0); null si fue
//     matado por timeout, desbordó el maxBuffer o falló el spawn.
//   - timedOut: true si se cortó por timeout (el output es parcial).
//   - signal: la señal que cortó el proceso (si aplica).
//   - errorMessage: motivo legible cuando !ok.
async function run(cmd, args, { cwd, timeoutMs = 240000, shell = false, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const base = { cwd, timeout: timeoutMs, killSignal: "SIGKILL", windowsHide: true, maxBuffer, env: { ...process.env } };
  const exec = async () => {
    if (shell) {
      const cmdline = [cmd, ...args].map(quoteCmdArg).join(" ");
      return execFileAsync("cmd.exe", ["/d", "/s", "/c", cmdline], base);
    }
    return execFileAsync(cmd, args, base);
  };
  try {
    const result = await exec();
    return { ok: true, stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0, signal: null, timedOut: false, errorMessage: null };
  } catch (error) {
    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";
    if (typeof error.code === "number") {
      // Corrió y salió con exit != 0: el output es COMPLETO y las herramientas
      // señalizan hallazgos con esto (eslint, tsc, npm audit, knip, jscpd...).
      return { ok: false, stdout, stderr, code: error.code, signal: error.signal ?? null, timedOut: false, errorMessage: `exit ${error.code}` };
    }
    if (error.signal || error.killed) {
      // Matado por timeout (SIGKILL) u otra señal: el output es parcial pero
      // importa guardarlo para debug.
      return { ok: false, stdout, stderr, code: null, signal: error.signal ?? null, timedOut: true, errorMessage: `proceso cortado (${error.signal ?? "kill"}) — output parcial` };
    }
    if (String(error.message).includes("maxBuffer") || String(stderr).includes("maxBuffer")) {
      return { ok: false, stdout, stderr, code: null, signal: null, timedOut: false, errorMessage: `stdout excedió el maxBuffer (${fmtBytes(maxBuffer)}); output truncado` };
    }
    // Fallo de spawn (ENOENT, EACCES, comando no encontrado...).
    return { ok: false, stdout, stderr, code: null, signal: null, timedOut: false, errorMessage: String(error.message || error) };
  }
}

// ¿El proceso corrió hasta salir? (exit numérico = output COMPLETO, aun != 0.)
// false = matado por timeout, desbordó el buffer o falló el spawn.
function exitedNormally(res) {
  return typeof res.code === "number";
}

function safeJson(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

// Razón legible de por qué un área no se evaluó (para no_evaluada.error).
function toolFailureReason(res, label) {
  if (res.timedOut) return `${label} no terminó a tiempo (output parcial guardado en raw)`;
  if (String(res.errorMessage ?? "").startsWith("exit")) {
    const head = String(res.stderr || res.stdout || res.errorMessage).trim().split(/\r?\n/)[0];
    return `${label} falló con ${res.errorMessage}${head ? `: ${head.slice(0, 140)}` : ""}`;
  }
  return `${label} no produjo salida válida: ${res.errorMessage ?? "JSON inválido o vacío"}`;
}

// Degrada un área a "no_evaluada" con motivo legible y guarda el output
// parcial (si hay) para debug. Devuelve el retorno estándar de una tool sin
// hallazgos. El pipeline NO debe reportar "error" por fallos de herramientas.
async function degradeTool(ctx, res, label) {
  ctx.record.status = "no_evaluada";
  ctx.record.error = toolFailureReason(res, label);
  if (res.stdout || res.stderr) {
    await ctx.raw("output.partial", `${res.stdout}\n${res.stderr}`);
  }
  return { findings: [] };
}

// Corre una herramienta y captura hallazgos normalizados. Nunca aborta el
// pipeline: devuelve el estado por herramienta. Imprime progreso en vivo
// para que la terminal de la app muestre qué está corriendo en cada momento.
async function runTool(tool, fn) {
  const label = `${tool.key}${tool.pkg ? ` (${tool.pkg})` : ""}`;
  process.stdout.write(`[herramientas] ${label} — corriendo…\n`);
  const started = Date.now();
  const record = {
    tool: tool.key,
    package: tool.pkg ?? null,
    status: "ok",
    files_scanned: null,
    lines_scanned: null,
    findings_count: 0,
    duration_ms: 0,
    error: null,
    note: tool.note ?? null,
  };
  const ctx = { record, raw: (name, content) => saveRaw(`${tool.key}${tool.pkg ? "-" + tool.pkg : ""}-${name}`, content) };
  try {
    const out = await fn(ctx);
    const findings = dedupFindings(out?.findings ?? []);
    record.files_scanned = out?.files ?? null;
    record.lines_scanned = out?.lines ?? null;
    record.findings_count = findings.length;
    record.note = out?.note ?? record.note;
    record.duration_ms = Date.now() - started;
    const scanned = record.files_scanned != null ? `, ${record.files_scanned} archivos` : "";
    if (record.status === "ok") {
      process.stdout.write(`[herramientas] ${label} — ok (${record.findings_count} hallazgo(s)${scanned})\n`);
    } else {
      // no_evaluada (degradación honesta con motivo), no un "error" crudo.
      process.stdout.write(`[herramientas] ${label} — ${record.status} (${record.findings_count} hallazgo(s)): ${record.error ?? ""}\n`);
    }
    return { record, findings };
  } catch (error) {
    // Un throw acá es un BUG del orquestador (no un fallo de la herramienta):
    // las tools degradan a no_evaluada por sí solas y no tiran.
    record.status = "error";
    record.duration_ms = Date.now() - started;
    record.error = error instanceof Error ? error.message : String(error);
    process.stdout.write(`[herramientas] ${label} — error: ${record.error}\n`);
    return { record, findings: [] };
  }
}

async function saveRaw(name, content) {
  await mkdir(RAW_DIR, { recursive: true });
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  await writeFile(path.join(RAW_DIR, safe), String(content));
}

function fmtBytes(n) {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

// ─── Conteo de archivos fuente por paquete (para la columna cobertura) ──
async function countSourceFiles(pkgDir) {
  let files = 0;
  let lines = 0;
  const stack = [pkgDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (["node_modules", ".git", "dist", "build", "coverage", ".next", "public", ".agents"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (TS.test(e.name) || JS.test(e.name)) {
        files += 1;
        try {
          lines += (await readFile(p, "utf8")).split(/\r?\n/).length;
        } catch {
          /* binario o sin permiso */
        }
      }
    }
  }
  return { files, lines };
}

// ─── Descarga best-effort de binarios standalone (gitleaks, git-sizer) ──
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "termcanvas-experiment" } }, (res) => {
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

// ─── Binarios standalone pindados ─────────────────────────────────────────
// Regla de la Parte 3.6 del pipeline: fijar versiones EXACTAS y verificar el
// checksum SHA-256 del zip antes de extraer. Jamás descargar "latest" a
// ciegas: un release comprometido del upstream se instalaría solo en la
// próxima corrida sin que nadie lo note.
//
// Los checksums de gitleaks y zizmor son los digests publicados por la API
// de releases de GitHub (verificados contra el zip descargado); git-sizer
// no publica digest, así que se pina el SHA-256 del zip oficial v1.5.0.
const PINNED_BINARIES = {
  gitleaks: {
    repo: "gitleaks/gitleaks",
    version: "v8.30.1",
    assetRegex: /windows.*(?:x64|amd64).*\.zip/i,
    sha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
  },
  "git-sizer": {
    repo: "github/git-sizer",
    version: "v1.5.0",
    assetRegex: /windows-amd64.*\.zip/i,
    sha256: "52093c1cba0bb8e00da14c9eef678eb052fc729c32419415817076f06b5c85d8",
  },
  zizmor: {
    repo: "zizmorcore/zizmor",
    version: "v1.29.0",
    assetRegex: /windows.*\.zip/i,
    sha256: "68a6bc6888f10bf0d53658c75885e7c1b7a0588d4c1fbc3f0ca280ad7324bf06",
  },
};

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function githubTaggedRelease(repo, version) {
  const body = await httpsGet(
    `https://api.github.com/repos/${repo}/releases/tags/${version}`,
  );
  return JSON.parse(body.toString("utf8"));
}

async function extractZip(zipPath, dest) {
  // Windows: Expand-Archive maneja los .zip sin dependencias de Node.
  const res = await run("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`,
  ]);
  // El catch de ensureBinary convierte esto en área "no_evaluada".
  if (!exitedNormally(res)) throw new Error(`Expand-Archive falló: ${res.errorMessage ?? res.stderr.trim()}`);
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

// Descarga un binario si no esta en .tools. Devuelve la ruta o null.
// El cache es POR herramienta (<name>.exe): nunca se reutiliza el exe de
// otra herramienta (un bug real que hizo correr gitleaks como git-sizer).
// Con pin: la release de la version EXACTA y checksum SHA-256 verificado
// antes de extraer; si el checksum no coincide, el area queda sin evaluar.
async function ensureBinary(name) {
  const pinned = PINNED_BINARIES[name];
  if (!pinned) return null;
  const finalPath = path.join(TOOLS_DIR, `${name}.exe`);
  try {
    await access(finalPath);
    return finalPath;
  } catch {
    /* falta: descargar */
  }
  try {
    await mkdir(TOOLS_DIR, { recursive: true });
    const rel = await githubTaggedRelease(pinned.repo, pinned.version);
    const asset = (rel.assets ?? []).find((a) => pinned.assetRegex.test(a.name));
    if (!asset) return null;
    const zipPath = path.join(TOOLS_DIR, asset.name);
    const body = await httpsGet(asset.browser_download_url);
    const digest = sha256Hex(body);
    if (digest !== pinned.sha256) {
      process.stderr.write(
        `[herramientas] ${name} — checksum SHA-256 no coincide (esperado ${pinned.sha256.slice(0, 12)}…, obtuve ${digest.slice(0, 12)}…); área no evaluada.\n`,
      );
      return null;
    }
    await writeFile(zipPath, body);
    const dest = path.join(TOOLS_DIR, `${name}-extract`);
    await extractZip(zipPath, dest);
    const exe = await findExe(dest);
    if (!exe) return null;
    await rename(exe, finalPath).catch(() => {});
    return finalPath;
  } catch {
    return null;
  }
}

// ─── Herramientas ─────────────────────────────────────────────────────────

// ESLint: usa la config del repo (eslint.config.js/.eslintrc). La salida
// JSON de ESLint incluye TODOS los archivos linted (cobertura real).
async function eslintPkg(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  if (!pkg.cap.eslint) {
    ctx.record.status = "no_evaluada";
    ctx.record.error = "sin config de eslint en el paquete";
    return { findings: [] };
  }
  const res = await run("npx", ["eslint", ".", "-f", "json"], { cwd: pkgDir, shell: true });
  await ctx.raw("report.json", res.stdout);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "eslint");
  const results = safeJson(res.stdout);
  if (results === null) return degradeTool(ctx, res, "eslint");
  const findings = [];
  for (const file of results) {
    for (const m of file.messages) {
      findings.push({
        tool: "eslint",
        package: pkg.label,
        file: path.relative(REPO, file.filePath),
        line: m.line,
        severity: m.severity === 2 ? "error" : "warning",
        rule: m.ruleId ?? "(parse-error)",
        message: m.message,
      });
    }
  }
  // Agregación jsdoc/require-jsdoc: 1 finding por archivo con el conteo de
  // funciones públicas sin documentar (evita explotar el reporte).
  const aggregated = [];
  const jsdocByFile = new Map();
  for (const f of findings) {
    if (f.rule === "jsdoc/require-jsdoc") {
      const entry = jsdocByFile.get(f.file) ?? { count: 0, firstLine: f.line };
      entry.count += 1;
      jsdocByFile.set(f.file, entry);
    } else {
      aggregated.push(f);
    }
  }
  for (const [file, entry] of jsdocByFile) {
    aggregated.push({
      tool: "eslint",
      package: pkg.label,
      file,
      line: entry.firstLine,
      severity: "info",
      rule: "jsdoc/require-jsdoc",
      message: `${entry.count} función(es) pública(s) sin JSDoc`,
    });
  }
  return { findings: aggregated, files: results.length, note: `config: ${pkg.cap.eslint}` };
}

// tsc --noEmit: errores de tipo. Se corre en frontend (tsconfig.app.json)
// y backend (tsconfig.json). El texto de TS se parsea con regex.
async function tscPkg(ctx, pkg, tsconfig) {
  const pkgDir = path.join(REPO, pkg.dir);
  const res = await run(
    "npx",
    ["tsc", "--noEmit", "-p", tsconfig],
    { cwd: pkgDir, shell: true },
  );
  const text = `${res.stdout}\n${res.stderr}`;
  await ctx.raw("output.txt", text);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "tsc");
  const findings = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  const errRe = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
  for (const line of lines) {
    const m = errRe.exec(line);
    if (m) {
      if (current) findings.push(current.finding);
      current = {
        finding: {
          tool: "tsc",
          package: pkg.label,
          file: path.relative(REPO, path.resolve(pkgDir, m[1])),
          line: Number(m[2]),
          severity: "error",
          rule: m[4],
          message: m[5],
        },
        pending: [m[5]],
      };
    } else if (current && line.trim()) {
      current.pending.push(line.trim());
      current.finding.message = current.pending.join(" — ");
    }
  }
  if (current) findings.push(current.finding);
  const filesMatch = /Found \d+ errors in (\d+) files\./.exec(text);
  return {
    findings,
    files: filesMatch ? Number(filesMatch[1]) : null,
    note: `projecto completo (${tsconfig})`,
  };
}

// npm audit: CVEs conocidos de dependencias.
async function npmAudit(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  const res = await run("npm", ["audit", "--json"], { cwd: pkgDir, shell: true });
  await ctx.raw("report.json", res.stdout);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "npm-audit");
  const report = safeJson(res.stdout);
  if (report === null) return degradeTool(ctx, res, "npm-audit");
  const findings = [];
  const vulns = report?.vulnerabilities ?? {};
  const sevMap = { info: "info", low: "info", moderate: "warning", high: "error", critical: "critical" };
  for (const [name, v] of Object.entries(vulns)) {
    if (v.severity === "none") continue;
    const direct = v.isDirect ? "directa" : "transitiva";
    findings.push({
      tool: "npm-audit",
      package: pkg.label,
      file: `${pkg.label === "root" ? "" : pkg.dir + "/"}package.json`,
      line: null,
      severity: sevMap[v.severity] ?? "warning",
      rule: `${name} (${v.range ?? "?"})`,
      message: `${v.severity} · dependencia ${direct}${v.fixAvailable === true ? " · fix disponible" : v.fixAvailable === false ? " · sin fix" : ""}`,
    });
  }
  return { findings, files: null, note: "escaneo de dependencias (no archivos)" };
}

// knip: codigo muerto / exports sin usar.
async function knipPkg(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  const res = await run("npx", ["--yes", "knip", "--reporter", "json", "--no-progress"], { cwd: pkgDir, shell: true });
  await ctx.raw("report.json", res.stdout);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "knip");
  const report = safeJson(res.stdout);
  if (report === null) return degradeTool(ctx, res, "knip");
  const findings = [];
  // Formato actual de knip: {issues: [{file, exports[], types[], files[], ...}]}
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  for (const issue of issues) {
    const file = issue?.file ?? "?";
    const collect = (arr, rule) => {
      for (const item of Array.isArray(arr) ? arr : []) {
        findings.push({
          tool: "knip",
          package: pkg.label,
          file: path.relative(REPO, path.resolve(pkgDir, file)),
          line: item?.line ?? null,
          severity: "info",
          rule,
          message: `${item?.name ?? "?"} sin uso en el proyecto`,
        });
      }
    };
    collect(issue?.exports, "export-sin-uso");
    collect(issue?.types, "tipo-sin-uso");
    collect(issue?.files, "archivo-sin-uso");
    collect(issue?.duplicates, "duplicado");
    collect(issue?.unlisted, "dependencia-no-listed");
  }
  return { findings, files: issues.length, note: "knip (defaults)" };
}

// jscpd: duplicacion de codigo. El reporte JSON se escribe en un temp sin
// espacios: el reporter "json" de jscpd falla en Windows con rutas con
// espacios (os error 123) — el repo vive bajo una ruta con espacios, así
// que el temp (8.3, sin espacios) es la salida segura.
async function jscpdPkg(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  const outDir = path.join(os.tmpdir(), "termcanvas-jscpd", pkg.dir);
  await mkdir(outDir, { recursive: true });
  const res = await run(
    "npx",
    [
      "--yes", "jscpd", ".",
      "--reporters", "json",
      "--output", outDir,
      // Calibración: min-tokens 120 (default 50 detecta clones de ~10 líneas
      // — ruido fino); se excluyen lockfiles y artefactos (jscpd comparaba
      // package.json con package-lock.json).
      "--min-tokens", "120",
      "--ignore",
      "**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/.git/**,**/*.min.*,**/*.map,**/package-lock.json",
    ],
    { cwd: pkgDir, shell: true },
  );
  if (!exitedNormally(res)) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    return degradeTool(ctx, res, "jscpd");
  }
  let report = {};
  try {
    report = JSON.parse(await readFile(path.join(outDir, "jscpd-report.json"), "utf8"));
  } catch {
    /* sin reporte: duplicacion no evaluada para este paquete */
  }
  await rm(outDir, { recursive: true, force: true }).catch(() => {});
  const findings = [];
  const dups = report?.duplicates ?? [];
  for (const d of dups) {
    const first = d.firstFile ?? {};
    const second = d.secondFile ?? {};
    const linesCount = d.duplicationA?.start?.line != null && d.duplicationB?.end?.line != null
      ? Math.abs(d.duplicationB.end.line - d.duplicationA.start.line)
      : d.fragment?.split(/\r?\n/).length ?? 1;
    findings.push({
      tool: "jscpd",
      package: pkg.label,
      file: first.name ? path.relative(REPO, path.resolve(pkgDir, first.name)) : "?",
      line: d.duplicationA?.start?.line ?? first.startLoc?.line ?? null,
      severity: "info",
      rule: "duplicacion",
      message: `~${linesCount} líneas duplicadas con ${second.name ? path.basename(second.name) : "?"}`,
    });
  }
  const stats = report?.statistics?.total ?? {};
  return {
    findings,
    files: stats.sources ?? null,
    lines: stats.lines ?? null,
    note: `clones: ${stats.clones ?? 0}${stats.percentage != null ? ` (${Number(stats.percentage).toFixed(1)}%)` : ""}`,
  };
}

// semgrep: patrones de bugs y seguridad ampliados (rules del registry).
// NATIVO en Windows desde semgrep 1.173.0 (wheel win_amd64 en PyPI); si no
// está en PATH, el área queda "no evaluada" sin bloquear el pipeline.
async function semgrep(ctx) {
  const outPath = path.join(RAW_DIR, "semgrep.json");
  const res = await run(
    "semgrep",
    ["scan", "--config", "p/security-audit", "--json", "--output", outPath, REPO],
    { cwd: REPO, timeoutMs: 420000 },
  );
  if (!exitedNormally(res)) return degradeTool(ctx, res, "semgrep");
  let report = {};
  try {
    report = JSON.parse(await readFile(outPath, "utf8"));
  } catch {
    /* sin reporte: semgrep no corrió (no instalado o falló) */
  }
  // "Ran N rules" sale en el stdout/stderr del scan — el JSON no lo expone.
  const rulesMatch = /Ran (\d+) rules?/.exec(`${res.stdout}\n${res.stderr}`);
  const sevMap = { ERROR: "error", WARNING: "warning", INFO: "info" };
  const findings = (report.results ?? []).map((r) => ({
    tool: "semgrep",
    package: null,
    file: path.relative(REPO, r.path ?? ""),
    line: r.start?.line ?? null,
    severity: sevMap[r.extra?.severity] ?? "warning",
    rule: r.check_id ?? "semgrep",
    message: r.extra?.message ?? "hallazgo de semgrep",
  }));
  return {
    findings,
    files: null,
    note: `semgrep ${report.version ?? "?"} — ${rulesMatch ? `${rulesMatch[1]} rules` : "p/security-audit"} → ${findings.length} hallazgo(s)`,
  };
}

// dependency-cruiser: ciclos y módulos huérfanos (arquitectura). Usa la
// config base del repo (.dependency-cruiser.cjs/.js): cyclic + no-orphans.
// Sin config en el repo → área "no_evaluada" (la calibración vive en el repo).
async function depcruisePkg(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  if (!pkg.cap.depcruise) {
    ctx.record.status = "no_evaluada";
    ctx.record.error = "sin config de dependency-cruiser en el paquete (.dependency-cruiser.cjs)";
    return { findings: [] };
  }
  const configName = await exists(path.join(pkgDir, ".dependency-cruiser.cjs"))
    ? ".dependency-cruiser.cjs"
    : ".dependency-cruiser.js";
  const res = await run(
    "npx",
    ["--yes", "depcruise", "src", "--config", configName, "--output-type", "json"],
    { cwd: pkgDir, shell: true },
  );
  await ctx.raw("report.json", res.stdout);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "depcruise");
  const report = safeJson(res.stdout);
  if (report === null) return degradeTool(ctx, res, "depcruise");
  const findings = [];
  for (const m of report.modules ?? []) {
    const src = m.source ?? "?";
    const rel = path.relative(REPO, path.resolve(pkgDir, src));
    if (m.orphan) {
      findings.push({
        tool: "depcruise",
        package: pkg.label,
        file: rel,
        line: null,
        severity: "info",
        rule: "no-orphans",
        message: "módulo inalcanzable desde el entry (código muerto de arquitectura)",
      });
    }
    for (const cycle of m.cycles ?? []) {
      const names = (Array.isArray(cycle) ? cycle : [String(cycle)])
        .map((p) => path.basename(String(p)))
        .join(" → ");
      findings.push({
        tool: "depcruise",
        package: pkg.label,
        file: rel,
        line: null,
        severity: "warning",
        rule: "cyclic",
        message: `ciclo de dependencias: ${names}`,
      });
    }
  }
  return {
    findings,
    files: (report.modules ?? []).length,
    note: `config base ${configName} (cyclic + no-orphans)`,
  };
}

// gitleaks: secretos/credenciales expuestas (nivel repo, git).
async function gitleaks(ctx) {
  const bin = await ensureBinary("gitleaks");
  if (!bin) {
    ctx.record.status = "no_evaluada";
    ctx.record.error = "binario no disponible (no se pudo descargar en Windows nativo)";
    return { findings: [] };
  }
  const outPath = path.join(RAW_DIR, "gitleaks.json");
  const res = await run(bin, [
    "detect", "--source", REPO, "--no-banner",
    "--report-format", "json", "--report-path", outPath,
    "--exit-code", "0",
  ]);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "gitleaks");
  let report = [];
  try {
    report = JSON.parse(await readFile(outPath, "utf8"));
  } catch {
    report = [];
  }
  const findings = report.map((r) => ({
    tool: "gitleaks",
    package: null,
    file: path.relative(REPO, path.resolve(REPO, r.File ?? "")),
    line: r.StartLine ?? null,
    severity: "critical",
    rule: r.RuleID ?? "secret",
    message: r.Description ?? (r.Secret ? `secreto detectado: ${r.Secret.slice(0, 40)}…` : "secreto detectado"),
  }));
  return { findings, files: null, note: "escaneo git (commits + working tree)" };
}

// git-sizer: bloat del repositorio (info de cobertura).
async function gitSizer(ctx) {
  const bin = await ensureBinary("git-sizer");
  if (!bin) {
    ctx.record.status = "no_evaluada";
    ctx.record.error = "binario no disponible (no se pudo descargar en Windows nativo)";
    return { findings: [] };
  }
  const res = await run(bin, ["--json", "--verbose"], { cwd: REPO });
  await ctx.raw("report.json", res.stdout);
  if (!exitedNormally(res)) return degradeTool(ctx, res, "git-sizer");
  const report = safeJson(res.stdout);
  if (report === null) return degradeTool(ctx, res, "git-sizer");
  // git-sizer mide blobs/árboles del historial: un blob gigante commiteado
  // por error es exactamente lo que esta herramienta existe para detectar.
  const findings = [];
  const maxBlob = report?.max_blob_size ?? 0;
  const maxBlobLabel = report?.max_blob_size_blob ?? "";
  const maxBlobPathMatch = /:\s*([^()]+)\)$/.exec(String(maxBlobLabel));
  const maxBlobPath = maxBlobPathMatch ? maxBlobPathMatch[1].trim() : String(maxBlobLabel);
  if (maxBlob > 5 * 1024 * 1024) {
    findings.push({
      tool: "git-sizer",
      package: null,
      file: maxBlobPath || "?",
      line: null,
      severity: "warning",
      rule: "blob-gigante",
      message: `${fmtBytes(maxBlob)} en un solo archivo commiteado al historial`,
    });
  }
  const totalBlobs = report?.unique_blob_size ?? 0;
  return {
    findings,
    files: null,
    note: `repo total ~${fmtBytes(totalBlobs)} de blobs · ${report?.unique_commit_count ?? "?"} commits`,
  };
}

// ─── Definicion del pipeline (dinamico: por-paquete segun la estructura) ──
// Se detectan los paquetes reales del repo (raiz con package.json y
// subdirectorios directos). Cada tool npm corre solo donde aplica su config:
// eslint donde hay config de eslint, tsc donde hay tsconfig, depcruise donde
// hay .dependency-cruiser.*; el resto degrada a "no_evaluada" con motivo.
async function buildPipeline() {
  const packages = await detectPackages(REPO);
  const pipeline = [];
  for (const p of packages) {
    const cap = await detectCapabilities(p);
    const pkg = { ...p, cap };
    if (cap.eslint) {
      pipeline.push({ key: "eslint", pkg: pkg.label, run: (c) => eslintPkg(c, pkg) });
    }
    if (cap.tsconfig) {
      pipeline.push({ key: "tsc", pkg: pkg.label, run: (c) => tscPkg(c, pkg, cap.tsconfig) });
    }
    if (cap.packageJson) {
      pipeline.push({ key: "npm-audit", pkg: pkg.label, run: (c) => npmAudit(c, pkg) });
      pipeline.push({ key: "npm-outdated", pkg: pkg.label, run: (c) => npmOutdated(c, pkg) });
      pipeline.push({ key: "license-checker", pkg: pkg.label, run: (c) => licenseCheck(c, pkg) });
      pipeline.push({ key: "knip", pkg: pkg.label, run: (c) => knipPkg(c, pkg) });
      pipeline.push({ key: "jscpd", pkg: pkg.label, run: (c) => jscpdPkg(c, pkg) });
      pipeline.push({ key: "depcruise", pkg: pkg.label, run: (c) => depcruisePkg(c, pkg) });
    }
  }
  // Repo-level: corren en cualquier repo git (y semgrep sin git igual).
  pipeline.push({ key: "semgrep", pkg: null, run: semgrep });
  pipeline.push({ key: "gitleaks", pkg: null, run: gitleaks });
  pipeline.push({ key: "git-sizer", pkg: null, run: gitSizer });
  pipeline.push({ key: "zizmor", pkg: null, run: zizmor });
  return { pipeline, packages };
}

// npm outdated: dependencias desactualizadas (no vulnerables, solo viejas).
// Usa el built-in de npm — no requiere instalar npm-check-updates.
async function npmOutdated(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  const res = await run("npm", ["outdated", "--json"], {
    cwd: pkgDir,
    shell: true,
    timeoutMs: 180000,
  });
  if (!exitedNormally(res)) return degradeTool(ctx, res, "npm-outdated");
  const parsed = safeJson(res.stdout);
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  const findings = [];
  for (const [name, v] of Object.entries(data ?? {})) {
    findings.push({
      tool: "npm-outdated",
      package: pkg.label,
      file: `${pkg.label === "root" ? "" : pkg.dir + "/"}package.json`,
      line: null,
      severity: "info",
      rule: "desactualizado",
      message: `${name}: ${v.current ?? "?"} → ${v.latest ?? "?"} (wanted ${v.wanted ?? "?"})`,
    });
  }
  return {
    findings,
    files: null,
    note: findings.length > 0 ? `${findings.length} dep(s) desactualizada(s)` : "sin desactualizadas",
  };
}

// license-checker: compliance de licencias (copyleft = warning, UNKNOWN =
// info). Para un producto que se piensa vender/abrir, el copyleft infecta.
async function licenseCheck(ctx, pkg) {
  const pkgDir = path.join(REPO, pkg.dir);
  const res = await run("npx", ["--yes", "license-checker", "--json"], {
    cwd: pkgDir,
    shell: true,
    timeoutMs: 300000,
  });
  if (!exitedNormally(res)) return degradeTool(ctx, res, "license-checker");
  const parsed = safeJson(res.stdout);
  const data = parsed && typeof parsed === "object" ? parsed : {};
  const findings = [];
  for (const [name, info] of Object.entries(data)) {
    const lic = String(info?.licenses ?? "UNKNOWN");
    if (/GPL|AGPL|EPL|MPL|LGPL/.test(lic)) {
      findings.push({
        tool: "license-checker",
        package: pkg.label,
        file: `${pkg.label === "root" ? "" : pkg.dir + "/"}package.json`,
        line: null,
        severity: "warning",
        rule: "licencia-copyleft",
        message: `${name}: ${lic}`,
      });
    } else if (lic === "UNKNOWN") {
      findings.push({
        tool: "license-checker",
        package: pkg.label,
        file: `${pkg.label === "root" ? "" : pkg.dir + "/"}package.json`,
        line: null,
        severity: "info",
        rule: "licencia-desconocida",
        message: `${name}: sin licencia verificable`,
      });
    }
  }
  return {
    findings,
    files: null,
    note: `licencias: ${Object.keys(data).length} paquetes`,
  };
}

// zizmor: seguridad de workflows de GitHub Actions (nivel repo). Binario
// standalone con binario Windows publicado (v1.29.0+). Sintaxis v1.29:
// `zizmor --format json <INPUT>` (el path es posicional, no hay subcomando).
async function zizmor(ctx) {
  const bin = await ensureBinary("zizmor");
  if (!bin) {
    ctx.record.status = "no_evaluada";
    ctx.record.error = "binario no disponible (no se pudo descargar en Windows nativo)";
    return { findings: [] };
  }
  const res = await run(bin, ["--format", "json", "."], {
    cwd: REPO,
    timeoutMs: 180000,
  });
  if (!exitedNormally(res)) return degradeTool(ctx, res, "zizmor");
  const parsed = safeJson(res.stdout);
  const items = Array.isArray(parsed) ? parsed : [];
  const sevMap = { high: "error", medium: "warning", low: "info", informational: "info" };
  const findings = [];
  for (const f of items) {
    const loc = f?.locations?.[0];
    const verbatim = loc?.symbolic?.key?.Local?.verbatim_path ?? "";
    const relFile = path.relative(REPO, path.resolve(REPO, verbatim.replace(/^\.\//, "")));
    findings.push({
      tool: "zizmor",
      package: null,
      file: relFile,
      line: loc?.start_line ?? loc?.line ?? null,
      severity: sevMap[String(f?.determinations?.severity ?? "").toLowerCase()] ?? "warning",
      rule: f?.ident ?? "zizmor",
      message: f?.desc ?? "hallazgo de seguridad en workflow de CI",
    });
  }
  return {
    findings,
    files: null,
    note: findings.length > 0 ? `${findings.length} auditoría(s) de CI` : "sin hallazgos de CI",
  };
}

// Quita duplicados EXACTOS (misma tool/paquete/archivo/línea/regla). Los
// hallazgos SIN línea (deps, licencias) no tienen posición que los distinga:
// se incluye el mensaje en la clave para que cada dep/licencia sea única.
function dedupFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key =
      f.line != null
        ? [f.tool, f.package, f.file, f.line, f.rule].join("|")
        : [f.tool, f.package, f.file, "nl", f.rule, f.message].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });

  const started = Date.now();
  const { pipeline, packages } = await buildPipeline();
  const results = [];

  for (const tool of pipeline) {
    const { record, findings } = await runTool(tool, (ctx) => tool.run(ctx));
    const deduped = dedupFindings(findings);
    record.findings_count = deduped.length;
    results.push({ record, findings: deduped });
  }

  const allFindings = dedupFindings(results.flatMap((r) => r.findings));
  const coverage = results.map((r) => r.record);
  const notEvaluated = coverage
    .filter((c) => c.status === "no_evaluada" || c.status === "error")
    .map((c) => ({ area: `${c.tool}${c.package ? ` (${c.package})` : ""}`, reason: c.error ?? "falló" }));

  // Conteo fuente por paquete (columna cobertura del resumen).
  const pkgStats = {};
  for (const p of packages) {
    pkgStats[p.label] = await countSourceFiles(path.join(REPO, p.dir));
  }

  const ts = Date.now();
  const output = {
    timestamp: ts,
    repo: REPO,
    packages: packages.map((p) => ({ path: p.label, ...pkgStats[p.label] })),
    findings: allFindings,
    coverage,
    not_evaluated: notEvaluated,
  };

  const findingsPath = path.join(OUT_DIR, `tool-findings-${ts}.json`);
  await writeFile(findingsPath, JSON.stringify(output, null, 2));

  // Resumen legible (lo que el usuario me pasa de vuelta).
  const lines = [];
  lines.push(`PIPELINE DE DIAGNOSTICO — HERRAMIENTAS DETERMINISTICAS`);
  lines.push(`repo: ${REPO}`);
  lines.push(`fecha: ${new Date(ts).toLocaleString("es-AR")}`);
  lines.push("");
  lines.push(`Cobertura de archivos fuente por paquete:`);
  for (const p of packages) {
    lines.push(`  ${p.label}: ${pkgStats[p.label].files} archivos, ${pkgStats[p.label].lines} líneas`);
  }
  lines.push("");
  lines.push(`Herramienta        | paquete  | estado        | archivos | hallazgos | nota`);
  lines.push(`-------------------|----------|---------------|----------|-----------|-----`);
  for (const c of coverage) {
    const tool = c.tool.padEnd(18);
    const pkg = (c.package ?? "repo").padEnd(8);
    const status = c.status.padEnd(13);
    const files = c.files_scanned != null ? String(c.files_scanned).padEnd(8) : "—".padEnd(8);
    const count = String(c.findings_count).padEnd(9);
    const note = c.note ?? c.error ?? "";
    lines.push(`${tool}| ${pkg} | ${status} | ${files} | ${count} | ${note}`);
  }
  lines.push("");
  lines.push(`TOTAL hallazgos estructurados: ${allFindings.length}`);
  lines.push(`Áreas no evaluadas: ${notEvaluated.length ? notEvaluated.map((n) => `${n.area} (${n.reason})`).join("; ") : "ninguna"}`);
  lines.push("");
  lines.push(`Salidas:`);
  lines.push(`  ${findingsPath}`);
  lines.push(`duración total: ${Math.round((Date.now() - started) / 1000)}s`);
  lines.push("");

  // Resumen por herramienta detallado (primeros N hallazgos de cada una).
  for (const r of results) {
    if (!r.findings.length) continue;
    lines.push(`[${r.record.tool}${r.record.package ? ` ${r.record.package}` : ""}] ${r.findings.length} hallazgo(s):`);
    const shown = r.findings.slice(0, 15);
    for (const f of shown) {
      const loc = f.file + (f.line != null ? `:${f.line}` : "");
      lines.push(`   ${f.severity.toUpperCase().padEnd(8)} ${loc}  [${f.rule}] ${f.message}`);
    }
    if (r.findings.length > shown.length) lines.push(`   … y ${r.findings.length - shown.length} más (ver JSON)`);
  }

  const summary = lines.join("\n") + "\n";
  process.stdout.write(summary);
}

// Solo corre como script (la app lo invoca con `node run-diagnostico-tools.mjs`);
// al importarlo (tests) no arranca el pipeline.
const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`\nError fatal del orquestador: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

// Expuestos para los tests (tests/run-diagnostico-tools.test.ts): run() es el
// corazón de la robustez del pipeline (nunca tira por fallos de ejecución).
export {
  run,
  exitedNormally,
  safeJson,
  toolFailureReason,
  degradeTool,
  dedupFindings,
  runTool,
};
