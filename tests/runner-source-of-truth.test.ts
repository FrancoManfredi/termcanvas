/**
 * Runner fuente única (E2 ③): el yaml manda, el fallback nunca se usa
 * con yaml válido, y la imagen vieja desapareció del texto vivo.
 *
 * Todo offline: lectura del yaml real + loader + asserts estáticos.
 * Cero docker, cero red, cero mocks (lo único vivo es el filesystem).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getRunner,
  parseRunnerDefinition,
  resetRunnersCache,
  LINUX_BUILD_RUNNER_FALLBACK,
} from "../headless-runtime/factory/agentLoader.ts";

const REPO = new URL("..", import.meta.url);
function readSrc(rel: string): string {
  return fs.readFileSync(new URL(rel, REPO), "utf-8");
}

function captureWarns(): { warns: string[]; restore: () => void } {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(" "));
  };
  return { warns, restore: () => { console.warn = orig; } };
}

// ── 1. El yaml trae imagen con node ──

test("fuente única: linux-build.yaml declara imagen CON node", () => {
  const text = readSrc("factory/runners/linux-build.yaml");
  const def = parseRunnerDefinition(text, "linux-build");
  assert.equal(def.isolation, "docker");
  assert.ok(
    (def.platform.dockerImage ?? "").includes("node"),
    `la imagen debe traer node, es: ${def.platform.dockerImage}`,
  );
});

// ── 2. loader ≡ yaml (sin fallback en el medio) ──

test("fuente única: getRunner ≡ yaml (misma imagen, setup y shape)", () => {
  resetRunnersCache();
  try {
    const text = readSrc("factory/runners/linux-build.yaml");
    const fromYaml = parseRunnerDefinition(text, "linux-build");
    const loaded = getRunner("linux-build");
    assert.ok(loaded, "linux-build debe resolver");
    assert.equal(loaded?.platform.dockerImage, fromYaml.platform.dockerImage);
    assert.deepEqual(loaded?.setupCommands, fromYaml.setupCommands);
    assert.deepEqual(loaded?.instanceShape, fromYaml.instanceShape);
    assert.equal(loaded?.isolation, fromYaml.isolation);
  } finally {
    resetRunnersCache();
  }
});

// ── 3. El fallback en código nunca se usa si el yaml existe y es válido ──

test("fuente única: con yaml válido NO hay warn de fallback (el fallback no se usa)", () => {
  const { warns, restore } = captureWarns();
  try {
    resetRunnersCache();
    const loaded = getRunner("linux-build");
    assert.ok(loaded, "debe resolver desde el yaml");
    assert.ok(
      !warns.some((w) => w.includes("linux-build") && w.includes("fallback")),
      `con yaml válido no debe haber fallback, hubo: ${JSON.stringify(warns)}`,
    );
    // Y el fallback ya no pretende ser verdad: sin imagen embebida.
    assert.equal(
      LINUX_BUILD_RUNNER_FALLBACK.platform.dockerImage,
      undefined,
      "el fallback no embebe imagen (cero hardcodeos; la imagen manda del yaml)",
    );
  } finally {
    restore();
    resetRunnersCache();
  }
});

// ── 4. Barrido: la imagen vieja desapareció del texto vivo ──

const LIVE_FILES = [
  "headless-runtime/runner/runnerConfig.ts",
  "headless-runtime/runner/runnerExecutor.ts",
  "headless-runtime/runner/runnerService.ts",
  "headless-runtime/runner/toolPolicy.ts",
  "headless-runtime/factory/agentLoader.ts",
  "shared/types/runner.ts",
  "headless-runtime/triage/triageAgent.ts",
  "headless-runtime/spec/specAgent.ts",
  "headless-runtime/review/reviewAgent.ts",
  "headless-runtime/foreman/foreman.ts",
  "headless-runtime/implement/implementAgent.ts",
  "headless-runtime/interview/harness/opencode.ts",
];

test("barrido: imagen vieja fuera del texto vivo (código propio + yaml)", () => {
  const hits: string[] = [];
  for (const rel of LIVE_FILES) {
    const src = readSrc(rel);
    if (src.includes("ubuntu:22.04")) hits.push(rel);
  }
  assert.deepEqual(hits, [], `texto vivo con imagen vieja: ${hits.join(", ")}`);
  // El yaml canónico tampoco la trae (reverdecido H-009): trae node.
  const yaml = readSrc("factory/runners/linux-build.yaml");
  assert.equal(yaml.includes("ubuntu:22.04"), false, "el yaml ya no trae la imagen vieja");
  assert.ok(yaml.includes("node"), "el yaml trae imagen con node");
  // windows-local honesto: sin imagen porque no hay contenedor (la palabra
  // puede salir en prosa del comentario, pero jamás como clave `dockerImage:`).
  const local = readSrc("factory/runners/windows-local.yaml");
  assert.equal(local.includes("ubuntu:22.04"), false);
  assert.equal(local.includes("dockerImage:"), false, "none honesto: sin clave dockerImage");
});

test("barrido: windows-local sigue honesto (none, sin probe, con doctrina de fuente única)", () => {
  resetRunnersCache();
  try {
    const local = getRunner("windows-local");
    assert.ok(local, "windows-local debe resolver");
    assert.equal(local.isolation, "none");
    assert.equal(local.platform.dockerImage, undefined);
    const yaml = readSrc("factory/runners/windows-local.yaml");
    assert.ok(yaml.includes('"none"'), "isolation none declarado");
  } finally {
    resetRunnersCache();
  }
});

test("header honesto: el executor usa la imagen REAL del yaml (nunca literal)", () => {
  const src = readSrc("headless-runtime/runner/runnerExecutor.ts");
  assert.ok(src.includes("realImage"), "el header nace de realImage (yaml vía loader)");
  assert.ok(src.includes("runnerDef.platform?.dockerImage"), "la imagen se lee del loader");
  assert.equal(src.includes("ubuntu:22.04"), false, "cero imagen vieja en el executor");
  // Degradación honesta ante yaml ausente/roto: sin imagen → local REGISTRADO.
  assert.ok(
    src.includes("sin imagen en el runner (yaml ausente o inválido), sigo en local"),
    "fail-open honesto ante fallback sin imagen",
  );
  // Intactos: probe, fail-open clásico y reintento H-009.
  assert.ok(src.includes("SETUP_DOCKER_LOCAL_RETRY_MAX"), "reintento H-009 intacto");
  assert.ok(src.includes("docker-unavailable:"), "fail-open clásico intacto");
  assert.ok(src.includes("probeDocker"), "probe intacto");
});
test("tipo genérico: shared/types/runner.ts sin literales de imagen concreta", () => {
  const src = readSrc("shared/types/runner.ts");
  assert.equal(src.includes("ubuntu:22.04"), false, "cero nombres de imagen en el tipo");
  assert.equal(src.includes("node:22-bookworm"), false, "ni siquiera la nueva: la imagen vive en el yaml");
  assert.ok(src.includes("superRefine"), "validación zod4 con superRefine");
  assert.ok(src.includes('"none"') && src.includes('"docker"'), "enum cerrado none|docker");
});
