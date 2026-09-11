/**
 * H-009 — fail-open ante setup roto DENTRO de docker + imagen con node.
 *
 * Contexto: con docker 28.0.4 corriendo, `linux-build` moría siempre en
 * setup (`corepack enable` exit 127: ubuntu:22.04 no trae node) y el
 * fail-open existente solo cubría docker-no-disponible (probe), no el fallo
 * del comando dentro del contenedor. E2E-12 FAIL 2/2.
 *
 * Cubre (sin docker real jamás: probe mockeado + executor con stubs en el
 * test, regla "mocks solo en tests" y "docker como no-disponible"):
 * 1. El yaml real `factory/runners/linux-build.yaml` declara imagen con node.
 * 2. Setup roto en docker → UN reintento local (cota 1) con evento
 *    `isolationFallback: "setup-fallo-en-docker: <cmd> exit <code>,
 *    reintento local"` en el step (timeline + evidence vía stamp).
 * 3. Local también roto → fail con la razón exacta y SIN 2º reintento
 *    (test de terminación, Regla 7: no cicla; el Triage posterior con
 *    re-dispatch humano es una invocación nueva, no un loop automático).
 * 4. Sin regresión: docker-no-disponible sigue con `docker-unavailable`
 *    sin intentar docker siquiera.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getRunner,
  parseRunnerDefinition,
  resetRunnersCache,
} from "../headless-runtime/factory/agentLoader.ts";
import {
  RunnerExecutor,
  SETUP_DOCKER_LOCAL_RETRY_MAX,
  resetDockerProbeCache,
  setDockerProbeOverride,
} from "../headless-runtime/runner/runnerExecutor.ts";
import type { VerificationStep } from "../shared/types/implement.ts";

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-failopen-"));
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

type SpawnResult = { exitCode: number | null; output: string };

/**
 * Executor con spawn mockeado (sin procesos reales ni docker real).
 * `docker` simula `spawnViaDocker`, `local` simula `spawnSingle`.
 */
function mockExecutor(docker: () => SpawnResult, local: () => SpawnResult): {
  executor: RunnerExecutor;
  calls: { docker: number; local: number };
} {
  const calls = { docker: 0, local: 0 };
  const executor = new RunnerExecutor() as unknown as Record<string, unknown>;
  executor["spawnViaDocker"] = async (): Promise<SpawnResult> => {
    calls.docker++;
    return docker();
  };
  executor["spawnSingle"] = async (): Promise<SpawnResult> => {
    calls.local++;
    return local();
  };
  return { executor: executor as unknown as RunnerExecutor, calls };
}

function setupDirs(tmp: { dir: string }): { wt: string; out: string } {
  const wt = path.join(tmp.dir, "wt");
  const out = path.join(tmp.dir, "job");
  fs.mkdirSync(wt, { recursive: true });
  return { wt, out };
}

function teardown(): void {
  setDockerProbeOverride(null);
  resetDockerProbeCache();
  resetRunnersCache();
}

// ── 1. Imagen del yaml real con node (definition-as-code) ──

test("H-009: linux-build.yaml declara imagen CON node (no ubuntu sin node)", () => {
  resetRunnersCache();
  try {
    const yamlPath = path.resolve("factory", "runners", "linux-build.yaml");
    const text = fs.readFileSync(yamlPath, "utf-8");
    const def = parseRunnerDefinition(text, "linux-build");
    assert.equal(def.isolation, "docker");
    assert.ok(
      (def.platform.dockerImage ?? "").includes("node"),
      `la imagen debe traer node, es: ${def.platform.dockerImage}`,
    );
    assert.ok(
      !(def.platform.dockerImage ?? "").startsWith("ubuntu:"),
      "ubuntu:22.04 no trae corepack (exit 127, E2E-12 FAIL)",
    );
    // El loader resuelve lo mismo que el yaml dice (sin fallback en código).
    const loaded = getRunner("linux-build");
    assert.equal(loaded?.platform.dockerImage, def.platform.dockerImage);
  } finally {
    resetRunnersCache();
  }
});

test("H-009: cota del reintento local explícita y en 1", () => {
  assert.equal(SETUP_DOCKER_LOCAL_RETRY_MAX, 1);
});

// ── 2. Setup roto en docker → 1 reintento local con evento ──

test("H-009: setup-roto-en-docker reintenta en local UNA vez con evento isolationFallback", async () => {
  const tmp = withTempDir();
  setDockerProbeOverride(async () => ({ available: true, reason: "stub con daemon" }));
  resetDockerProbeCache();
  resetRunnersCache();
  try {
    const { executor, calls } = mockExecutor(
      () => ({ exitCode: 127, output: "sh: 1: corepack: not found\n" }),
      () => ({ exitCode: 0, output: "Corepack enabled (local)\n" }),
    );
    const { wt, out } = setupDirs(tmp);
    const raw = await executor.executeSetup(wt, out);
    const step = raw as VerificationStep & { isolation?: string; isolationFallback?: string };
    // El reintento local salvó el setup: pass, pero honesto sobre dónde corrió.
    assert.equal(step.status, "pass");
    assert.equal(step.command, "corepack enable");
    assert.equal(step.isolation, "none");
    assert.equal(
      step.isolationFallback,
      "setup-fallo-en-docker: corepack enable exit 127, reintento local",
    );
    assert.equal(calls.docker, 1, "docker se intenta una vez");
    assert.equal(calls.local, 1, "reintento local UNA vez (cota 1)");
    assert.ok(fs.existsSync(path.join(out, "logs", "build.log")), "evidencia en disco");
  } finally {
    teardown();
    tmp.cleanup();
  }
});

// ── 3. Local también roto → fail con razón exacta, sin 2º reintento ──

test("H-009: local-también-roto → fail con razón exacta y termina (sin 2º reintento)", async () => {
  const tmp = withTempDir();
  setDockerProbeOverride(async () => ({ available: true, reason: "stub con daemon" }));
  resetDockerProbeCache();
  resetRunnersCache();
  try {
    const { executor, calls } = mockExecutor(
      () => ({ exitCode: 127, output: "sh: 1: corepack: not found\n" }),
      () => ({ exitCode: 1, output: "local también roto: corepack no está instalado\n" }),
    );
    const { wt, out } = setupDirs(tmp);
    const raw = await executor.executeSetup(wt, out);
    const step = raw as VerificationStep & { isolation?: string; isolationFallback?: string };
    assert.equal(step.status, "fail");
    assert.equal(step.command, "corepack enable");
    // Razón exacta para el Triage posterior (implementService la espeja en
    // `verification failed: setup <cmd> exit <code>` — no varado silencioso).
    assert.equal(step.exitCode, 1);
    assert.match(step.logSnippet ?? "", /corepack: not found/);
    assert.match(step.logSnippet ?? "", /local también roto/);
    assert.equal(step.isolation, "none");
    assert.equal(
      step.isolationFallback,
      "setup-fallo-en-docker: corepack enable exit 127, reintento local",
    );
    assert.equal(calls.docker, 1);
    assert.equal(calls.local, 1, "TERMINACIÓN: sin 2º reintento aunque local falle");
  } finally {
    teardown();
    tmp.cleanup();
  }
});

// ── 4. Sin regresión: docker-no-disponible como antes ──

test("H-009: docker-no-disponible sigue en fail-open clásico sin tocar docker", async () => {
  const tmp = withTempDir();
  setDockerProbeOverride(async () => ({ available: false, reason: "stub sin daemon" }));
  resetDockerProbeCache();
  resetRunnersCache();
  try {
    const { executor, calls } = mockExecutor(
      () => {
        throw new Error("no debería intentarse docker sin daemon");
      },
      () => ({ exitCode: 0, output: "Corepack enabled (local)\n" }),
    );
    const { wt, out } = setupDirs(tmp);
    const raw = await executor.executeSetup(wt, out);
    const step = raw as VerificationStep & { isolation?: string; isolationFallback?: string };
    assert.equal(step.status, "pass");
    assert.equal(step.isolation, "none");
    assert.match(step.isolationFallback ?? "", /^docker-unavailable: /);
    assert.equal(calls.docker, 0, "sin daemon no se intenta docker");
  } finally {
    teardown();
    tmp.cleanup();
  }
});
