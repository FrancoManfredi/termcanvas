/**
 * FASE 3 E2 — loaders genericos (loadSpec mas runnerLoader).
 * node:test + tsx. Offline total: sin daemon, sin red, cero LLM real.
 * Todo en tmpdirs reales; no muta `factory/` real.
 *
 * Cubre lo pedido en F3-E2:
 * - Yaml ausente o invalido equivale a fallback avisado (warn visible).
 * - Runner nuevo con yaml valido se acepta sin tocar codigo.
 * - Cache por ruta y por nombre (segunda lectura sin re-parsear; cap y TTL).
 * - Nombres inseguros (traversal) equivalen a null sin leer disco.
 * - Delegacion sin literales de puertos, modelos o imagenes (todo inyectado).
 *
 * Reglas citadas: C1 (ESM, cotas: cache con TTL y cap, sin recorridos
 * nuevos), C2 (fail-safe: nunca lanza), C3 (solo lee), C4 (best-effort),
 * C5 (aditivo), C6 y C7 (generico, nada duplicado), C10 (trazabilidad).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LOAD_SPEC_CACHE_MAX,
  clearLoadSpecCacheForTests,
  loadSpecCacheSizeForTests,
  loadSpecFile,
  resolveFactoryYamlPathFrom,
} from "../headless-runtime/factory/loaders/loadSpec.ts";
import {
  RUNNER_LOADER_CACHE_MAX,
  clearRunnerLoaderCacheForTests,
  isSafeRunnerName,
  loadRunnerByName,
  runnerLoaderCacheSizeForTests,
} from "../headless-runtime/factory/loaders/runnerLoader.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function captureWarns(fn: () => void): string[] {
  const out: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    try {
      out.push(args.map((a) => String(a)).join(" "));
    } catch {
      out.push("warn");
    }
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return out;
}

test.after(() => {
  try {
    clearLoadSpecCacheForTests();
  } catch {}
  try {
    clearRunnerLoaderCacheForTests();
  } catch {}
});

// ── A. loadSpec generico: ausente e invalido equivalen a fallback avisado ──

test("A1 yaml ausente equivale a fallback avisado (warn visible, fromFallback true)", () => {
  clearLoadSpecCacheForTests();
  const dir = tmpDir("f3e2-loadspec-");
  const missing = path.join(dir, "no-existe", "factory.yaml");
  let result: { value: string; fromFallback: boolean } | null = null;
  const warns = captureWarns(() => {
    result = loadSpecFile<string>({
      filePath: missing,
      parse: (t) => t,
      fallback: "fallback-codigo",
      warnPrefix: "[test-loadspec]",
    });
  });
  assert.ok(result);
  assert.equal(result!.value, "fallback-codigo");
  assert.equal(result!.fromFallback, true);
  assert.ok(warns.some((w) => w.includes("ausente") && w.includes("fallback")), `debió avisar, fue: ${warns.join(" | ")}`);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("A2 yaml invalido equivale a fallback avisado (parse que lanza)", () => {
  clearLoadSpecCacheForTests();
  const dir = tmpDir("f3e2-loadspec-");
  const file = path.join(dir, "factory.yaml");
  fs.writeFileSync(file, "contenido roto {{{", "utf-8");
  let result: { value: string; fromFallback: boolean } | null = null;
  const warns = captureWarns(() => {
    result = loadSpecFile<string>({
      filePath: file,
      parse: () => {
        throw new Error("forma inválida");
      },
      fallback: () => "fallback-fresco",
      warnPrefix: "[test-loadspec]",
    });
  });
  assert.ok(result);
  assert.equal(result!.value, "fallback-fresco");
  assert.equal(result!.fromFallback, true);
  assert.ok(warns.some((w) => w.includes("inválido") && w.includes("fallback")), `debió avisar, fue: ${warns.join(" | ")}`);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("A3 yaml valido equivale a valor parseado sin fallback (fromFallback false)", () => {
  clearLoadSpecCacheForTests();
  const dir = tmpDir("f3e2-loadspec-");
  const file = path.join(dir, "factory.yaml");
  fs.writeFileSync(file, "clave: valor\n", "utf-8");
  const result = loadSpecFile<{ clave: string }>({
    filePath: file,
    parse: (t) => ({ clave: t.trim() }),
    fallback: { clave: "fallback" },
  });
  assert.equal(result.fromFallback, false);
  assert.deepEqual(result.value, { clave: "clave: valor" });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("A4 cache: segunda lectura no re-parsea (parse 1 sola vez; cap acotada)", () => {
  clearLoadSpecCacheForTests();
  assert.ok(LOAD_SPEC_CACHE_MAX <= 100);
  const dir = tmpDir("f3e2-loadspec-");
  const file = path.join(dir, "spec.yaml");
  fs.writeFileSync(file, "v1", "utf-8");
  let parses = 0;
  const opts = {
    filePath: file,
    parse: (t: string) => {
      parses += 1;
      return t;
    },
    fallback: "fb",
  };
  const first = loadSpecFile(opts);
  const second = loadSpecFile(opts);
  assert.equal(first.value, "v1");
  assert.equal(second.value, "v1");
  assert.equal(parses, 1);
  assert.equal(loadSpecCacheSizeForTests(), 1);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("A5 resolveFactoryYamlPathFrom: sin literales de maquina (base inyectado)", () => {
  assert.equal(resolveFactoryYamlPathFrom(null), null);
  assert.equal(resolveFactoryYamlPathFrom(""), null);
  const resolved = resolveFactoryYamlPathFrom(os.tmpdir());
  assert.ok(resolved && resolved.endsWith(path.join("factory", "factory.yaml")));
});

// ── B. runnerLoader: runner nuevo aceptado, traversal rechazado, cache ──

function validRunnerParse(text: string, name: string): { name: string; text: string } {
  if (!text.includes("description:")) throw new Error("runner inválido: sin description");
  return { name, text };
}

test("B1 runner nuevo con yaml valido se acepta sin tocar codigo", () => {
  clearRunnerLoaderCacheForTests();
  const dir = tmpDir("f3e2-runners-");
  const name = "nuevo-test";
  fs.writeFileSync(path.join(dir, `${name}.yaml`), 'description: "runner nuevo de prueba"\n', "utf-8");
  const result = loadRunnerByName({
    name,
    runnersDir: dir,
    parse: validRunnerParse,
    fallbackFor: () => null,
  });
  assert.equal(result.fromFallback, false);
  assert.ok(result.value);
  assert.equal((result.value as { name: string }).name, name);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("B2 runner ausente con fallback conocido equivale a fallback avisado", () => {
  clearRunnerLoaderCacheForTests();
  const dir = tmpDir("f3e2-runners-");
  let result: { value: unknown; fromFallback: boolean } | null = null;
  const warns = captureWarns(() => {
    result = loadRunnerByName({
      name: "conocido-test",
      runnersDir: dir,
      parse: validRunnerParse,
      fallbackFor: (n) => (n === "conocido-test" ? { name: n, fallback: true } : null),
      warnPrefix: "[test-runner]",
    });
  });
  assert.ok(result);
  assert.equal(result!.fromFallback, true);
  assert.deepEqual(result!.value, { name: "conocido-test", fallback: true });
  assert.ok(warns.some((w) => w.includes("ausente") && w.includes("fallback")));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("B3 runner invalido con fallback conocido equivale a fallback avisado", () => {
  clearRunnerLoaderCacheForTests();
  const dir = tmpDir("f3e2-runners-");
  const name = "roto-test";
  fs.writeFileSync(path.join(dir, `${name}.yaml`), "sin description aca\n", "utf-8");
  let result: { value: unknown; fromFallback: boolean } | null = null;
  const warns = captureWarns(() => {
    result = loadRunnerByName({
      name,
      runnersDir: dir,
      parse: validRunnerParse,
      fallbackFor: (n) => ({ name: n, fallback: true }),
      warnPrefix: "[test-runner]",
    });
  });
  assert.ok(result);
  assert.equal(result!.fromFallback, true);
  assert.ok(warns.some((w) => w.includes("inválido") && w.includes("fallback")));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("B4 traversal como nombre equivale a null sin leer disco (.., slash, backslash)", () => {
  clearRunnerLoaderCacheForTests();
  assert.equal(isSafeRunnerName("../escape"), false);
  assert.equal(isSafeRunnerName("a/b"), false);
  assert.equal(isSafeRunnerName("a\\b"), false);
  assert.equal(isSafeRunnerName(""), false);
  assert.equal(isSafeRunnerName("nuevo-test"), true);
  const dir = tmpDir("f3e2-runners-");
  for (const bad of ["../escape", "a/b", "a\\b", "..", ""]) {
    const result = loadRunnerByName({
      name: bad,
      runnersDir: dir,
      parse: validRunnerParse,
      fallbackFor: () => ({ name: "no-debio-usarse" }),
    });
    assert.deepEqual(result, { value: null, fromFallback: false }, `debió rechazar ${JSON.stringify(bad)}`);
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("B5 cache por nombre: segunda carga no re-parsea (cap acotada)", () => {
  clearRunnerLoaderCacheForTests();
  assert.ok(RUNNER_LOADER_CACHE_MAX <= 100);
  const dir = tmpDir("f3e2-runners-");
  const name = "cacheado-test";
  fs.writeFileSync(path.join(dir, `${name}.yaml`), 'description: "cache"\n', "utf-8");
  let parses = 0;
  const opts = {
    name,
    runnersDir: dir,
    parse: (t: string, n: string) => {
      parses += 1;
      return { name: n, text: t };
    },
    fallbackFor: () => null as unknown as { name: string; text: string } | null,
  };
  const first = loadRunnerByName(opts);
  const second = loadRunnerByName(opts);
  assert.ok(first.value);
  assert.deepEqual(second.value, first.value);
  assert.equal(parses, 1);
  assert.equal(runnerLoaderCacheSizeForTests(), 1);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
