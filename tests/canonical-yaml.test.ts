/**
 * TANDA 3 — yaml canónico + redirección legacy + barrido ubuntu (puntos 1, 3 y 6).
 *
 * Fija:
 * - El canónico `factory/runners/linux-build.yaml` existe y declara imagen
 *   CON node (`node:22-bookworm`, H-009) + `isolation: "docker"`.
 * - El legacy `runners/linux-build.yaml` es nota de redirección de 1–3 líneas
 *   al canónico (NO fuente, NO borrado: el lector vivo `getRunnerYamlPath`
 *   en `headless-runtime/runner/runnerConfig.ts` sigue resolviendo esa ruta;
 *   el borrado rompería su `fs.existsSync`/lectura — redirección, no borrado).
 * - El path caliente lee el canónico: `runnerService` delega en
 *   `agentLoader.getRunner` (`factory/runners/`); evento `runner:prepared`,
 *   header del executor y perfil del prompt nacen del yaml real (nunca
 *   literal en TS).
 * - Barrido: `ubuntu:22.04` = 0 en código vivo (`headless-runtime`, `src`,
 *   `server`, `shared`, `factory`, `electron`, `cli`) + `runners/*.yaml`.
 *   Exclusiones honestas (NO barren): `tests/` (fijan el contrato y nombran
 *   el stale en asserts), `docs/` (históricas), `.agents/` (historial de
 *   jobs), `dist-headless/` (build-output sin trackear, regenerable con
 *   `pnpm build:headless`; carry-over T3, jamás borrado a mano).
 *
 * Offline total: lectura estática + `node:test`. Cero red, cero LLM, daemon
 * intacto (los backends solo se LEEN, jamás se editan). ESM puro, cero
 * `require()`. Reglas: las 8 + C1–C10 (recorrido iterativo con pila).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

function relExists(rel: string): boolean {
  try {
    return fs.existsSync(path.join(REPO, rel));
  } catch {
    return false;
  }
}

// ── 1. Canónico ──

test("T3 canónico: factory/runners/linux-build.yaml declara imagen CON node", () => {
  assert.ok(relExists("factory/runners/linux-build.yaml"), "el canónico existe");
  const yaml = readRel("factory/runners/linux-build.yaml");
  assert.ok(yaml.includes("node:22-bookworm"), "imagen con node (H-009)");
  assert.equal(yaml.includes("ubuntu:22.04"), false, "el canónico ya no trae la imagen vieja");
  assert.ok(yaml.includes('isolation: "docker"'), "aislamiento docker declarado");
});

// ── 2. Redirección legacy (no borrado: lector vivo) ──

test("T3 redirección: runners/linux-build.yaml es nota de 1-3 líneas al canónico", () => {
  assert.ok(relExists("runners/linux-build.yaml"), "el legacy sigue existiendo (no borrado)");
  const raw = readRel("runners/linux-build.yaml");
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  assert.ok(
    lines.length >= 1 && lines.length <= 3,
    `nota de redirección de 1-3 líneas, hay ${lines.length}`,
  );
  assert.ok(raw.includes("factory/runners/"), "apunta al canónico");
  assert.equal(raw.includes("dockerImage:"), false, "ya no declara imagen (no es fuente)");
  assert.equal(raw.includes("ubuntu:22.04"), false, "ya no trae el stale");
});

test("T3 no-borrado: el lector vivo getRunnerYamlPath resuelve runners/{id}.yaml (evidencia)", () => {
  const daemon = readRel("headless-runtime/runner/runnerConfig.ts");
  assert.ok(daemon.includes("function getRunnerYamlPath"), "el lector existe");
  assert.ok(daemon.includes('"runners"'), "resuelve contra el dir legacy");
  // Único consumidor vivo cae al fallback ante spec inválido (la nota no es
  // spec válido → getSpec usa LINUX_BUILD_FALLBACK, mismos shape/setup).
  const exec = readRel("headless-runtime/runner/runnerExecutor.ts");
  assert.ok(exec.includes('loadRunnerSpecSync("linux-build")'), "único lector vía getSpec");
  assert.ok(exec.includes("this.spec = LINUX_BUILD_FALLBACK"), "degrada al fallback ante nota");
});

// ── 3. El path caliente manda del canónico ──

test("T3 canónico manda: runnerService delega en agentLoader.getRunner (factory/runners/)", () => {
  const svc = readRel("headless-runtime/runner/runnerService.ts");
  assert.ok(svc.includes("../factory/agentLoader"), "el service importa el loader");
  assert.ok(svc.includes("getRunner(id.trim())"), "resuelve vía getRunner (canónico)");
  const loader = readRel("headless-runtime/factory/agentLoader.ts");
  assert.ok(loader.includes('"factory", "runners"'), "getRunner lee factory/runners/");
});

test("T3 stales vivos: evento runner:prepared + header + perfil nacen del yaml real", () => {
  const server = readRel("headless-runtime/factory/factoryServer.ts");
  assert.ok(
    server.includes('getRunner("linux-build")?.platform?.dockerImage'),
    "el evento usa la imagen REAL del loader",
  );
  const exec = readRel("headless-runtime/runner/runnerExecutor.ts");
  assert.ok(
    exec.includes("runnerDef.platform?.dockerImage"),
    "el header usa la imagen REAL del loader",
  );
  const prompt = readRel("headless-runtime/implement/implementPrompt.ts");
  assert.ok(prompt.includes('getRunner("linux-build")'), "el perfil del prompt sale del loader");
});

// ── 4. Barrido ubuntu:22.04 ──

const T3_LIVE_DIRS = [
  "headless-runtime",
  "src",
  "server",
  "shared",
  "factory",
  "electron",
  "cli",
];

function t3LiveFiles(): string[] {
  const out: string[] = [];
  const stack: string[] = [
    ...T3_LIVE_DIRS.map((d) => path.join(REPO, d)),
    path.join(REPO, "runners"),
  ];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (e.isFile()) {
        // Fuera del barrido: suites (fijan el contrato), docs (históricas).
        if (e.name.endsWith(".test.ts") || e.name.endsWith(".test.tsx")) continue;
        if (e.name.endsWith(".md")) continue;
        out.push(path.relative(REPO, abs).split(path.sep).join("/"));
      }
    }
  }
  return out.sort();
}

test("T3 barrido: ubuntu:22.04 = 0 en código vivo + runners/*.yaml", () => {
  const hits: string[] = [];
  for (const rel of t3LiveFiles()) {
    let src = "";
    try {
      src = fs.readFileSync(path.join(REPO, rel), "utf-8");
    } catch {
      continue;
    }
    if (src.includes("ubuntu:22.04")) hits.push(rel);
  }
  assert.deepEqual(hits, [], `stale ubuntu:22.04 en vivo:\n${hits.join("\n")}`);
});

// ── 5. ESM ──

test("T3 ESM: cero require() en archivos tocados", () => {
  const touched = [
    "src/features/factoryLab/components/ReviewPanel.tsx",
    "src/lib/runnerConfig.ts",
    "tests/no-direct-fetch.test.ts",
    "tests/canonical-yaml.test.ts",
  ];
  const hits: string[] = [];
  for (const rel of touched) {
    if (/\brequire\s*\(\s*["'`]/.test(readRel(rel))) hits.push(rel);
  }
  assert.deepEqual(hits, [], `require() prohibido (ESM, C1) en:\n${hits.join("\n")}`);
});
