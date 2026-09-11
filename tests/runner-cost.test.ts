/**
 * Ola 15 (E1, parte runner): runners honestos + aislamiento en evidence.
 *
 * Cubre SOLO la parte runner (el costo real es de E2 y vive en su suite):
 * - Loader: yaml válido / inválido / ausente → fallback en código con warn
 *   visible, NUNCA throw (patrón parse/validate/cache/fallback).
 * - Probe docker: selector probado con stub de función (NO docker real: test
 *   del selector, no del daemon). Cotas explícitas: 1 intento, timeout 5s,
 *   cache con TTL 60s (regla 7: cero loops sin cota).
 * - Evidence: cada step lleva `isolation: "docker"|"none"` en ambos modos
 *   (docker disponible vs no disponible → fallback local REGISTRADO).
 * - Interruptor (regla 8): si el yaml dice isolation none, NUNCA se intenta
 *   docker (ni siquiera el probe).
 *
 * Ningún test toca daemon real, red ni docker: `corepack enable` en tmp es lo
 * único que se ejecuta de verdad (comando local, acotado a 15s).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getRunner,
  getRunners,
  parseRunnerDefinition,
  getFactoryConfig,
  resetRunnersCache,
  resetFactoryConfigCache,
  LINUX_BUILD_RUNNER_FALLBACK,
  WINDOWS_LOCAL_RUNNER_FALLBACK,
} from "../headless-runtime/factory/agentLoader.ts";
import {
  resolveExecutionMode,
  probeDocker,
  setDockerProbeOverride,
  resetDockerProbeCache,
  stampVerificationSteps,
  DOCKER_PROBE_TIMEOUT_MS,
  DOCKER_PROBE_TTL_MS,
  DOCKER_PROBE_MAX_ATTEMPTS,
  runnerExecutor,
} from "../headless-runtime/runner/runnerExecutor.ts";
import { buildStepEvidence } from "../headless-runtime/implement/verification.ts";
import type { VerificationStep } from "../shared/types/implement.ts";

function captureWarns(): { warns: string[]; restore: () => void } {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(" "));
  };
  return { warns, restore: () => { console.warn = orig; } };
}

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-cost-"));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // noop: limpieza best-effort
      }
    },
  };
}

function stepFixture(over: Partial<VerificationStep> & { name: VerificationStep["name"] }): VerificationStep {
  return {
    command: `pnpm ${over.name}`,
    exitCode: 0,
    durationMs: 10,
    status: "pass",
    logPath: "logs/build.log",
    ...over,
  };
}

// ── Loader: yaml válido del repo ──

test("runners reales del repo: windows-local honesto (none) y linux-build (docker)", () => {
  resetRunnersCache();
  const local = getRunner("windows-local");
  assert.ok(local, "windows-local debe resolver");
  assert.equal(local.isolation, "none");
  assert.ok(local.setupCommands.length > 0, "setupCommands no vacía");
  assert.ok(local.instanceShape.vcpus > 0 && local.instanceShape.memoryGb > 0);
  assert.equal(local.platform.os, "windows");
  assert.equal(local.platform.dockerImage, undefined, "honesto: sin imagen porque no hay contenedor");

  const linux = getRunner("linux-build");
  assert.ok(linux, "linux-build debe resolver");
  assert.equal(linux.isolation, "docker");
  assert.deepEqual(linux.setupCommands, ["corepack enable"]);
  assert.deepEqual(linux.instanceShape, { vcpus: 4, memoryGb: 8 });
  // H-009 (2026-09-04): ubuntu:22.04 no trae node/corepack y el setup moría
  // con exit 127 dentro de docker (E2E-12 FAIL 2/2). La imagen con node es
  // definition-as-code: este assert es el test de contenido del yaml.
  assert.equal(linux.platform.dockerImage, "node:22-bookworm");
});

test("getRunners incluye ambos runners conocidos y nunca lanza", () => {
  resetRunnersCache();
  const all = getRunners();
  assert.ok(all.length >= 2);
  const names = all.map((r) => r.name);
  assert.ok(names.includes("windows-local"), `falta windows-local en [${names.join(", ")}]`);
  assert.ok(names.includes("linux-build"), `falta linux-build en [${names.join(", ")}]`);
});

// ── Loader: inválido / ausente → fallback con warn, sin throw ──

test("parseRunnerDefinition rechaza isolation inválida, setup vacío y vcpus 0", () => {
  const base = [
    'description: "x"',
    "setupCommands:",
    '  - "corepack enable"',
    "instanceShape:",
    "  vcpus: 4",
    "  memoryGb: 8",
    "platform:",
    '  os: "linux"',
    '  arch: "x86_64"',
  ];
  assert.throws(
    () => parseRunnerDefinition([...base, 'isolation: "vm"', '  dockerImage: "img"'].join("\n"), "r1"),
    /runner parse error/,
    "isolation fuera del enum cerrado debe rechazar",
  );
  assert.throws(
    () =>
      parseRunnerDefinition(
        ['description: "x"', "setupCommands:", "instanceShape:", "  vcpus: 4", "  memoryGb: 8", 'isolation: "none"', "platform:", '  os: "windows"', '  arch: "x64"'].join("\n"),
        "r2",
      ),
    /setupCommands no puede estar vacía/,
  );
  assert.throws(
    () =>
      parseRunnerDefinition(
        ['description: "x"', "setupCommands:", '  - "cmd"', "instanceShape:", "  vcpus: 0", "  memoryGb: 8", 'isolation: "none"', "platform:", '  os: "windows"', '  arch: "x64"'].join("\n"),
        "r3",
      ),
    /vcpus debe ser número > 0/,
  );
  assert.throws(
    () =>
      parseRunnerDefinition(
        ['description: "x"', "setupCommands:", '  - "cmd"', "instanceShape:", "  vcpus: 4", "  memoryGb: 8", 'isolation: "docker"', "platform:", '  os: "linux"', '  arch: "x86_64"'].join("\n"),
        "r4",
      ),
    /dockerImage requerido/,
    "docker sin imagen debe rechazar (la imagen es la promesa del modo docker)",
  );
});

test("yaml ausente → fallback en código con warn visible, sin throw", () => {
  const tmp = withTempDir();
  const { warns, restore } = captureWarns();
  try {
    resetRunnersCache();
    const def = getRunner("linux-build", tmp.dir);
    assert.ok(def, "debe caer al fallback, no a null");
    assert.deepEqual(def, { ...LINUX_BUILD_RUNNER_FALLBACK });
    assert.ok(warns.some((w) => w.includes("linux-build") && w.includes("fallback")), `warn visible esperado, hubo: ${JSON.stringify(warns)}`);
  } finally {
    restore();
    tmp.cleanup();
  }
});

test("yaml inválido → fallback en código con warn visible, sin throw", () => {
  const tmp = withTempDir();
  const { warns, restore } = captureWarns();
  try {
    fs.writeFileSync(path.join(tmp.dir, "windows-local.yaml"), 'isolation: "vm"\n', "utf-8");
    resetRunnersCache();
    const def = getRunner("windows-local", tmp.dir);
    assert.ok(def, "debe caer al fallback, no a null");
    assert.equal(def?.isolation, WINDOWS_LOCAL_RUNNER_FALLBACK.isolation);
    assert.ok(warns.some((w) => w.includes("windows-local") && w.includes("fallback")), `warn visible esperado, hubo: ${JSON.stringify(warns)}`);
  } finally {
    restore();
    tmp.cleanup();
  }
});

test("nombre desconocido → null sin throw (sin fallback que inventar)", () => {
  resetRunnersCache();
  assert.equal(getRunner("no-existe-xyz"), null);
  assert.equal(getRunner(""), null);
  assert.equal(getRunner("../escape"), null, "anti-traversal: nombre con path no resuelve");
});

// ── factory.yaml: secciones nuevas aditivas ──

test("factory.yaml declara runners.default windows-local + costTracking + 27 tarifas FU-4 + sellos", () => {
  resetFactoryConfigCache();
  const cfg = getFactoryConfig();
  assert.equal(cfg.runners.default, "windows-local");
  assert.equal(cfg.costTracking, true);
  // FU-4 evolved (was: costRates {}): 27 user-confirmed tariffs + seals.
  assert.equal(Object.keys(cfg.costRates).length, 27);
  assert.deepEqual(cfg.costRates["opencode-go/muse-spark-1.2-contributor"], {
    inputUSDper1M: 0.1,
    outputUSDper1M: 0.2,
  });
  assert.deepEqual(cfg.costRates["opencode-go/grok-4.6"], {
    inputUSDper1M: 2,
    outputUSDper1M: 6,
  });
  assert.ok(
    typeof cfg.ratesAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.ratesAsOf),
    `ratesAsOf must be YYYY-MM-DD, got ${String(cfg.ratesAsOf)}`,
  );
  assert.equal(cfg.ratesSource, "https://opencode.ai/docs/go/");
});

// ── Probe: cotas explícitas (regla 7) ──

test("cotas del probe docker explícitas y sanas", () => {
  assert.equal(DOCKER_PROBE_TIMEOUT_MS, 5000);
  assert.equal(DOCKER_PROBE_TTL_MS, 60_000);
  assert.equal(DOCKER_PROBE_MAX_ATTEMPTS, 1, "un solo intento: cero reintentos");
});

// ── Selector con stub (nunca docker real) ──

test("selector: daemon disponible → docker, sin fallback", async () => {
  setDockerProbeOverride(async () => ({ available: true, reason: "stub ok" }));
  resetDockerProbeCache();
  try {
    const mode = await resolveExecutionMode(LINUX_BUILD_RUNNER_FALLBACK);
    assert.equal(mode.isolation, "docker");
    assert.ok(!("isolationFallback" in mode) || mode.isolationFallback === undefined);
  } finally {
    setDockerProbeOverride(null);
    resetDockerProbeCache();
  }
});

test("selector: daemon no disponible → local + fallback registrado", async () => {
  setDockerProbeOverride(async () => ({ available: false, reason: "stub sin daemon" }));
  resetDockerProbeCache();
  try {
    const mode = await resolveExecutionMode(LINUX_BUILD_RUNNER_FALLBACK);
    assert.equal(mode.isolation, "none");
    assert.equal(mode.isolationFallback, "docker-unavailable: stub sin daemon");
  } finally {
    setDockerProbeOverride(null);
    resetDockerProbeCache();
  }
});

test("interruptor: isolation none NUNCA probea docker (regla 8)", async () => {
  let calls = 0;
  setDockerProbeOverride(async () => {
    calls++;
    return { available: true, reason: "no debería llamarse" };
  });
  resetDockerProbeCache();
  try {
    const mode = await resolveExecutionMode(WINDOWS_LOCAL_RUNNER_FALLBACK);
    assert.equal(mode.isolation, "none");
    assert.equal(calls, 0, "el probe no debe correr cuando isolation es none");
    assert.ok(!("isolationFallback" in mode) || mode.isolationFallback === undefined);
  } finally {
    setDockerProbeOverride(null);
    resetDockerProbeCache();
  }
});

test("probe cacheado con TTL: N llamadas → 1 probe; reset → otro (termina, sin loops)", async () => {
  let calls = 0;
  setDockerProbeOverride(async () => {
    calls++;
    return { available: false, reason: "stub" };
  });
  resetDockerProbeCache();
  try {
    await probeDocker();
    await probeDocker();
    await probeDocker();
    assert.equal(calls, 1, "el cache TTL 60s evita re-probar en la misma ventana");
    resetDockerProbeCache();
    await probeDocker();
    assert.equal(calls, 2, "tras reset hay exactamente 1 probe más (sin reintentos)");
  } finally {
    setDockerProbeOverride(null);
    resetDockerProbeCache();
  }
});

// ── executeSetup: fail-open real + evidence ──

test("executeSetup sin daemon → step local con fallback registrado (fail-open, no rompe)", async () => {
  const tmp = withTempDir();
  setDockerProbeOverride(async () => ({ available: false, reason: "stub sin daemon" }));
  resetDockerProbeCache();
  resetRunnersCache();
  try {
    const wt = path.join(tmp.dir, "wt");
    const out = path.join(tmp.dir, "job");
    fs.mkdirSync(wt, { recursive: true });
    const raw = await runnerExecutor.executeSetup(wt, out);
    const step = raw as VerificationStep & { isolation?: string; isolationFallback?: string };
    assert.equal(step.isolation, "none");
    assert.match(step.isolationFallback ?? "", /^docker-unavailable: /);
    assert.ok(fs.existsSync(path.join(out, "logs", "build.log")), "evidencia en disco: build.log existe");
  } finally {
    setDockerProbeOverride(null);
    resetDockerProbeCache();
    tmp.cleanup();
  }
});

test("executeSetup con espacios en el path no rompe el job (cita + fallback local)", async () => {
  const tmp = withTempDir();
  setDockerProbeOverride(async () => ({ available: false, reason: "stub" }));
  resetDockerProbeCache();
  resetRunnersCache();
  try {
    const wt = path.join(tmp.dir, "dir with spaces", "wt");
    const out = path.join(tmp.dir, "job");
    fs.mkdirSync(wt, { recursive: true });
    const raw = await runnerExecutor.executeSetup(wt, out);
    const step = raw as VerificationStep & { isolation?: string; isolationFallback?: string };
    assert.equal(step.isolation, "none");
    assert.match(step.isolationFallback ?? "", /^docker-unavailable: /);
  } finally {
    setDockerProbeOverride(null);
    resetDockerProbeCache();
    tmp.cleanup();
  }
});

// ── Evidence con isolation en ambos modos ──

test("evidence hereda isolation del step; sin isolation la forma vieja sigue intacta", () => {
  const withDocker = buildStepEvidence({ ...stepFixture({ name: "test" }), isolation: "docker" } as VerificationStep);
  assert.equal(withDocker.isolation, "docker");
  assert.equal(withDocker.kind, "test");

  const withNone = buildStepEvidence({ ...stepFixture({ name: "build" }), isolation: "none" } as VerificationStep);
  assert.equal(withNone.isolation, "none");

  const legacy = buildStepEvidence(stepFixture({ name: "test" }));
  assert.ok(!("isolation" in legacy) || legacy.isolation === undefined, "contrato vivo: evidencia vieja sin isolation sigue válida");
});

test("stampVerificationSteps estampa todos los steps en ambos modos", () => {
  const steps = [stepFixture({ name: "test" }), stepFixture({ name: "build" })];
  const docker = stampVerificationSteps(steps, { isolation: "docker" });
  assert.ok(docker.every((s) => s.isolation === "docker"));

  const fallback = stampVerificationSteps(steps, {
    isolation: "none",
    isolationFallback: "docker-unavailable: stub",
  });
  assert.ok(fallback.every((s) => s.isolation === "none"));
  assert.ok(fallback.every((s) => s.isolationFallback === "docker-unavailable: stub"));
  // Puro: no muta los originales.
  assert.ok(steps.every((s) => !("isolation" in s)));
});
