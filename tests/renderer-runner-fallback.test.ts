/**
 * F4-E2 — fallback renderer imageless (punto 4).
 *
 * `src/lib/runnerConfig.ts:30` traía `dockerImage: "ubuntu:22.04"` (stale que
 * E1 devolvió por ser zona E2). Esta suite fija el fix F4-E2:
 * - El fallback es local honesto: `isolation: "none"` SIN imagen (la imagen
 *   vive SOLO en el yaml fuente única `factory/runners/linux-build.yaml`,
 *   que manda con `node:22-bookworm` tras H-009; C7: cero literales de imagen
 *   en TS). Paridad con el fallback daemon ya imageless
 *   (`headless-runtime/runner/runnerConfig.ts`, solo lectura acá).
 * - Sigue siendo un `RunnerSpec` válido (id + shape + setup intactos): no se
 *   rompe su fallback (`fetchRunnerSpec` lo devuelve ante yaml inalcanzable;
 *   degradación probada con mocks, offline).
 * - Quién lo lee (evidencia): `getRunnerYamlPath` es daemon y lee
 *   `runners/{id}.yaml`, NO este espejo renderer; en `src/` nadie importa
 *   `lib/runnerConfig` (cero lectores vivos → el cambio no rompe llamadas).
 *
 * Offline total: mocks + `node:test`. Cero red, cero LLM, daemon intacto
 * (el archivo daemon solo se LEE, jamás se edita). ESM puro, cero `require()`.
 * Reglas: las 8 + C1–C10 (C1: recorrido iterativo con pila, sin recursión
 * escrita a mano, sin timers salvo los del mock bajo test).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LINUX_BUILD_FALLBACK,
  fetchRunnerSpec,
  validateRunnerSpec,
} from "../src/lib/runnerConfig.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

const RENDERER_PATH = path.join(REPO, "src", "lib", "runnerConfig.ts");
const DAEMON_PATH = path.join(REPO, "headless-runtime", "runner", "runnerConfig.ts");

// ── Forma: válido + honesto + sin stale ──

test("F4-E2 fallback renderer: sigue siendo un RunnerSpec válido (contrato intacto)", () => {
  assert.doesNotThrow(() => validateRunnerSpec(LINUX_BUILD_FALLBACK));
  const parsed = validateRunnerSpec(LINUX_BUILD_FALLBACK);
  assert.equal(parsed.id, "linux-build");
  assert.deepEqual(parsed.setupCommands, ["corepack enable"]);
  assert.equal(parsed.instanceShape.cpuCount, 4);
  assert.equal(parsed.instanceShape.memoryGB, 8);
});

test("F4-E2 fallback renderer: local honesto (isolation none, sin imagen)", () => {
  assert.equal(LINUX_BUILD_FALLBACK.isolation, "none");
  assert.ok(!("dockerImage" in LINUX_BUILD_FALLBACK), "sin dockerImage inventada");
});

test("F4-E2 fallback renderer: estática sin stale ubuntu en el espejo", () => {
  const src = fs.readFileSync(RENDERER_PATH, "utf-8");
  assert.equal(src.includes("ubuntu"), false, "cero token ubuntu en el espejo renderer");
});

// ── Comportamiento: degradación intacta (mocks, offline) ──

test("F4-E2 fallback renderer: fetchRunnerSpec degrada al fallback ante !ok", async () => {
  const notOk = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const got = await fetchRunnerSpec(notOk, "linux-build", 1000);
  assert.deepEqual(got, LINUX_BUILD_FALLBACK);
});

test("F4-E2 fallback renderer: fetchRunnerSpec degrada al fallback ante red caída", async () => {
  const down = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  const got = await fetchRunnerSpec(down, "linux-build", 1000);
  assert.deepEqual(got, LINUX_BUILD_FALLBACK);
});

// ── Coherencia: paridad daemon (solo lectura) + lector yaml ajeno ──

test("F4-E2 fallback renderer: paridad con el fallback daemon ya imageless (solo lectura)", () => {
  const src = fs.readFileSync(DAEMON_PATH, "utf-8");
  const start = src.indexOf("export const LINUX_BUILD_FALLBACK");
  assert.ok(start >= 0, "el fallback daemon existe");
  const end = src.indexOf("\n};", start);
  assert.ok(end > start, "el fallback daemon cierra");
  const block = src.slice(start, end);
  assert.ok(block.includes('isolation: "none"'), "el daemon también es local honesto");
  assert.equal(block.includes("ubuntu"), false, "el daemon tampoco trae el stale");
  assert.equal(block.includes("dockerImage"), false, "el daemon tampoco inventa imagen");
});

test("F4-E2 fallback renderer: getRunnerYamlPath es daemon y no lee este espejo (cero lectores en src)", () => {
  const daemon = fs.readFileSync(DAEMON_PATH, "utf-8");
  assert.ok(daemon.includes("function getRunnerYamlPath"), "el lector yaml vive en el daemon");
  // Recorrido iterativo de src/ (C1): ¿quién importa lib/runnerConfig?
  const readers: string[] = [];
  const stack: string[] = [path.join(REPO, "src")];
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
      } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
        let src = "";
        try {
          src = fs.readFileSync(abs, "utf-8");
        } catch {
          continue;
        }
        const imports = src.split("\n").filter((l) => /(^|\s)import[\s(]/.test(l));
        if (imports.some((l) => l.includes("lib/runnerConfig"))) {
          readers.push(path.relative(REPO, abs).split(path.sep).join("/"));
        }
      }
    }
  }
  assert.deepEqual(readers, [], `lectores vivos en src (el cambio no rompe llamadas): ${readers.join(", ")}`);
});
