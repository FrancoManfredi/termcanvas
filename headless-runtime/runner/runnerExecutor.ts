/**
 * RunnerExecutor — Ola 3.
 * Validates the linux-build RunnerSpec and runs setup commands in worktreePath.
 * Log contract: [runner linux-build <image from yaml> <shape from yaml>]
 * (image and shape ALWAYS come from yaml via the loader; TS never hardcodes them).
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { VerificationStep } from "../../shared/types/implement";
import { loadRunnerSpecSync, LINUX_BUILD_FALLBACK } from "./runnerConfig";
import type { RunnerSpec } from "../../shared/types/runner";
import {
  getRunner,
  getFactoryConfig,
  WINDOWS_LOCAL_RUNNER_FALLBACK,
  type RunnerDefinition,
} from "../factory/agentLoader";

// ── Aislamiento honesto (Ola 15) ──
//
// - `isolation: "docker"` en el yaml NO promete un contenedor: promete
//   INTENTARLO solo si hay daemon disponible (probe `docker info`).
// - Ante CUALQUIER error de docker: fail-open a ejecución local y se REGISTRA
//   (`isolationFallback`), nunca se rompe el job por docker.
// - `isolation: "none"` NUNCA intenta docker, ni siquiera el probe
//   (interruptor, regla 8).
// - Cotas (regla 7): el probe es UN solo intento (sin reintentos) con timeout
//   5s y cache en memoria con TTL 60s; cada comando setup tiene su timeout.

export type IsolationMode = "docker" | "none";

export interface ExecutionIsolation {
  isolation: IsolationMode;
  /** Presente solo cuando se declaró docker pero se ejecuta local (motivo corto). */
  isolationFallback?: string;
}

export interface DockerProbeResult {
  available: boolean;
  reason: string;
}

/** Timeout del probe `docker info` (una sola vez por probe, sin reintentos). */
export const DOCKER_PROBE_TIMEOUT_MS = 5000;
/** TTL del cache en memoria del probe (cota explícita, regla 7). */
export const DOCKER_PROBE_TTL_MS = 60_000;
/** Cota explícita: UN solo intento de probe por llamada (cero reintentos). */
export const DOCKER_PROBE_MAX_ATTEMPTS = 1;
/**
 * H-009: cota explícita del fail-open ante setup roto DENTRO de docker.
 * Si un setupCommand falla con exit != 0 dentro del contenedor (no es fallo
 * de infra docker — ese ya hace fail-open con `docker-unavailable`), se
 * reintenta en local UNA sola vez por llamada a executeSetup (Regla 7).
 * Si el reintento local también falla → step fail con la razón exacta
 * (Triage la muestra; el reintento humano posterior es decisión humana,
 * no loop automático: cada invocación nueva parte de 0 y vuelve a Triage
 * con causa si todo falla — terminación garantizada, ver test).
 */
export const SETUP_DOCKER_LOCAL_RETRY_MAX = 1;

const ISOLATION_REASON_MAX_CHARS = 120;

let dockerProbeCache: { result: DockerProbeResult; at: number } | null = null;
let dockerProbeOverride: (() => Promise<DockerProbeResult>) | null = null;

/**
 * Seam documentado SOLO para tests: sustituye el probe real (los tests nunca
 * tocan un daemon docker real: prueban el selector, no el daemon).
 */
export function setDockerProbeOverride(fn: (() => Promise<DockerProbeResult>) | null): void {
  dockerProbeOverride = fn;
}

/** Limpia el cache del probe en memoria (para tests). */
export function resetDockerProbeCache(): void {
  dockerProbeCache = null;
}

function shortReason(raw: unknown): string {
  const text = String(raw instanceof Error ? raw.message : raw)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "unknown";
  return text.length > ISOLATION_REASON_MAX_CHARS ? text.slice(0, ISOLATION_REASON_MAX_CHARS) : text;
}

function realDockerProbe(): Promise<DockerProbeResult> {
  return new Promise<DockerProbeResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (result: DockerProbeResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
        shell: false,
        timeout: DOCKER_PROBE_TIMEOUT_MS,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (err) {
      done({ available: false, reason: shortReason(err) });
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // noop: el daemon ya pudo haber muerto
      }
      done({ available: false, reason: `timeout ${DOCKER_PROBE_TIMEOUT_MS}ms` });
    }, DOCKER_PROBE_TIMEOUT_MS + 500);
    (child as unknown as { on: (ev: string, cb: (err: Error) => void) => void }).on("error", (err: Error) => {
      done({ available: false, reason: shortReason(err) });
    });
    (child as unknown as { on: (ev: string, cb: (code: number | null) => void) => void }).on("close", (code: number | null) => {
      if (code === 0) done({ available: true, reason: "docker info ok" });
      else done({ available: false, reason: `exit ${String(code ?? "null")}` });
    });
  });
}

/**
 * Probe de disponibilidad docker: 1 intento (cota explícita, cero reintentos),
 * timeout 5s, resultado cacheado 60s en memoria. Nunca lanza.
 */
export async function probeDocker(): Promise<DockerProbeResult> {
  try {
    const now = Date.now();
    if (dockerProbeCache && now - dockerProbeCache.at < DOCKER_PROBE_TTL_MS) {
      return dockerProbeCache.result;
    }
    const probe = dockerProbeOverride ?? realDockerProbe;
    const result = await probe();
    const safe: DockerProbeResult =
      result && typeof result === "object"
        ? { available: result.available === true, reason: shortReason(result.reason ?? "unknown") }
        : { available: false, reason: "probe inválido" };
    dockerProbeCache = { result: safe, at: Date.now() };
    return safe;
  } catch (err) {
    const result: DockerProbeResult = { available: false, reason: shortReason(err) };
    dockerProbeCache = { result, at: Date.now() };
    return result;
  }
}

/**
 * Selector de modo de ejecución (puro respecto al filesystem: solo decide).
 * - isolation "none" (o runner ausente/inválido) → local, SIN probe
 *   (interruptor, regla 8). Sin campo isolationFallback: lo local es lo declarado.
 * - isolation "docker" + daemon disponible → docker.
 * - isolation "docker" + daemon NO disponible → local + isolationFallback
 *   registrado (fail-open honesto). Nunca lanza.
 */
export async function resolveExecutionMode(
  runner: RunnerDefinition | null | undefined,
): Promise<ExecutionIsolation> {
  try {
    const def =
      runner && typeof runner === "object" && (runner.isolation === "docker" || runner.isolation === "none")
        ? runner
        : WINDOWS_LOCAL_RUNNER_FALLBACK;
    if (def.isolation !== "docker") return { isolation: "none" };
    const probe = await probeDocker();
    if (probe.available) return { isolation: "docker" };
    return { isolation: "none", isolationFallback: `docker-unavailable: ${shortReason(probe.reason)}` };
  } catch (err) {
    return { isolation: "none", isolationFallback: `docker-unavailable: ${shortReason(err)}` };
  }
}

function defaultRunnerDef(): RunnerDefinition {
  try {
    const name = getFactoryConfig()?.runners?.default?.trim() || "windows-local";
    return getRunner(name) ?? WINDOWS_LOCAL_RUNNER_FALLBACK;
  } catch {
    return WINDOWS_LOCAL_RUNNER_FALLBACK;
  }
}

/**
 * Modo de aislamiento para la verificación: runner por defecto del
 * factory.yaml (o fallback honesto). Nunca lanza.
 */
export async function resolveVerificationIsolation(): Promise<ExecutionIsolation> {
  try {
    return await resolveExecutionMode(defaultRunnerDef());
  } catch (err) {
    return { isolation: "none", isolationFallback: `docker-unavailable: ${shortReason(err)}` };
  }
}

/** Estampa un step con su aislamiento real (campos opcionales aditivos). */
export function stampStepWithIsolation<T extends VerificationStep>(
  step: T,
  mode: ExecutionIsolation,
): T & { isolation: IsolationMode; isolationFallback?: string } {
  const stamped = { ...step, isolation: mode.isolation } as T & {
    isolation: IsolationMode;
    isolationFallback?: string;
  };
  if (mode.isolationFallback) stamped.isolationFallback = mode.isolationFallback;
  return stamped;
}

/** Estampa una lista de steps con su aislamiento real. Puro, nunca lanza. */
export function stampVerificationSteps<T extends VerificationStep>(
  steps: T[],
  mode: ExecutionIsolation,
): Array<T & { isolation: IsolationMode; isolationFallback?: string }> {
  return (steps ?? []).map((s) => stampStepWithIsolation(s, mode));
}

const DOCKER_INFRA_RE =
  /\[spawn error|docker:\s*error|cannot connect|error during connect|is the docker daemon running|no such file|permission denied/i;

function isDockerInfraFailure(output: string): boolean {
  return DOCKER_INFRA_RE.test(output ?? "");
}

function firstOutputLine(output: string): string {
  const line = (output ?? "").split("\n").find((l) => l.trim().length > 0);
  return shortReason(line ?? "docker failed");
}

export class RunnerExecutor {
  private spec: RunnerSpec | null = null;

  getSpec(): RunnerSpec {
    if (this.spec) return this.spec;
    try {
      this.spec = loadRunnerSpecSync("linux-build");
    } catch {
      this.spec = LINUX_BUILD_FALLBACK;
    }
    return this.spec;
  }

  validateSpec(id: string): RunnerSpec {
    if (id !== "linux-build") {
      throw Object.assign(new Error(`unknown runner: ${id}`), { status: 404 });
    }
    return this.getSpec();
  }

  /**
   * Ejecuta setupCommands (corepack enable) secuencialmente en worktreePath.
   * Crea logs/build.log si no existe y append header.
   * Retorna VerificationStep setup.
   */
  async executeSetup(worktreePath: string, dir?: string): Promise<VerificationStep> {
    const spec = this.getSpec();
    // Aislamiento honesto (Ola 15): se intenta docker SOLO si el runner lo
    // declara Y hay daemon; si no, local declarado y registrado. Nunca lanza.
    const runnerDef = getRunner("linux-build") ?? WINDOWS_LOCAL_RUNNER_FALLBACK;
    let mode = await resolveExecutionMode(runnerDef);
    const dockerImage = runnerDef.platform?.dockerImage ?? "";
    // Fuente única (E2 ③): la imagen REAL sale del yaml vía el loader.
    // El spec legacy solo aporta id/shape/setup; jamás la imagen.
    const realImage = dockerImage || "(sin imagen: local honesto)";
    // Fallback honesto ante yaml ausente/roto: el fallback en código ya no
    // trae imagen (cero hardcodeos), así que aunque el modo resuelva docker
    // por isolation, sin imagen se degrada a local REGISTRADO (fail-open).
    if (mode.isolation === "docker" && !dockerImage) {
      mode = {
        isolation: "none",
        isolationFallback: "docker-unavailable: sin imagen en el runner (yaml ausente o inválido), sigo en local",
      };
    }
    const cwd = path.resolve(worktreePath);
    const logDir = dir ? path.join(dir, "logs") : path.join(cwd, "logs");
    const logPath = dir ? path.join(dir, "logs", "build.log") : path.join(logDir, "build.log");

    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      // header log (imagen REAL del yaml, nunca literal en código)
      const header = `[runner ${spec.id} ${realImage} ${spec.instanceShape.cpu}/${spec.instanceShape.memory} setup=${spec.setupCommands.join(",")}]\n`;
      try {
        if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, header, "utf-8");
        else fs.appendFileSync(logPath, header, "utf-8");
      } catch {}
    } catch {}

    const startedAt = Date.now();
    let overallExit: number | null = 0;
    let combinedOutput = "";
    // H-009: reintentos locales consumidos en ESTA llamada (cota 1, Regla 7).
    let dockerSetupRetriesUsed = 0;

    for (const cmd of spec.setupCommands) {
      let stepResult: { exitCode: number | null; output: string };
      if (mode.isolation === "docker" && dockerImage) {
        try {
          stepResult = await this.spawnViaDocker(cmd, cwd, logPath, 15000, dockerImage);
        } catch (err) {
          // Fail-open: CUALQUIER error de docker → ejecución local declarada.
          mode = { isolation: "none", isolationFallback: `docker-unavailable: ${shortReason(err)}` };
          try {
            fs.appendFileSync(logPath, `[runner] ${mode.isolationFallback}, sigo en local\n`, "utf-8");
          } catch {
            // noop: el log es best-effort
          }
          stepResult = await this.spawnSingle(cmd, cwd, logPath, 15000);
        }
      } else {
        stepResult = await this.spawnSingle(cmd, cwd, logPath, 15000);
      }
      combinedOutput += stepResult.output + "\n";
      // H-009: fail-open ante setup roto DENTRO de docker. El comando corrió
      // (no es fallo de infra — ese ya hizo fail-open arriba) pero salió con
      // exit != 0 (ej. `corepack enable` exit 127 en imagen sin node). Antes
      // de declarar el fail se reintenta en local UNA vez (cota explícita):
      // el step resultante lleva `isolationFallback` con el comando y el exit
      // originales (timeline + evidence), y si local también falla el Triage
      // muestra la razón exacta sin varado silencioso.
      if (
        stepResult.exitCode !== 0 &&
        mode.isolation === "docker" &&
        dockerSetupRetriesUsed < SETUP_DOCKER_LOCAL_RETRY_MAX
      ) {
        dockerSetupRetriesUsed++;
        mode = {
          isolation: "none",
          isolationFallback: `setup-fallo-en-docker: ${cmd} exit ${stepResult.exitCode ?? "?"}, reintento local`,
        };
        try {
          fs.appendFileSync(logPath, `[runner] ${mode.isolationFallback}, sigo en local\n`, "utf-8");
        } catch {
          // noop: el log es best-effort
        }
        stepResult = await this.spawnSingle(cmd, cwd, logPath, 15000);
        combinedOutput += stepResult.output + "\n";
      }
      if (stepResult.exitCode !== 0) {
        overallExit = stepResult.exitCode;
        const durationMs = Date.now() - startedAt;
        const snippet = buildSnippet(combinedOutput);
        return stampStepWithIsolation(
          {
            name: "setup",
            command: cmd,
            exitCode: overallExit,
            durationMs,
            status: "fail",
            logSnippet: snippet,
            logPath: "logs/build.log",
          } as VerificationStep,
          mode,
        );
      }
    }

    // Also check docker optional (no obligatorio) — log only
    try {
      fs.appendFileSync(logPath, `[runner] cwd=${cwd} corepack enable done\n`, "utf-8");
    } catch {}

    const durationMs = Date.now() - startedAt;
    const snippet = buildSnippet(combinedOutput || "corepack enable done");
    return stampStepWithIsolation(
      {
        name: "setup",
        command: spec.setupCommands.join(" && ") || "corepack enable",
        exitCode: 0,
        durationMs,
        status: "pass",
        logSnippet: snippet,
        logPath: "logs/build.log",
      } as VerificationStep,
      mode,
    );
  }

  /**
   * Intenta correr un comando dentro de docker (montando el worktree).
   * El path del host se cita (soporta espacios); si el montaje o el daemon
   * fallan, LANZA para que el caller haga fail-open a local. Solo se llama
   * cuando el probe ya dijo que hay daemon — esto es el intento, no el probe.
   */
  private async spawnViaDocker(
    cmd: string,
    cwd: string,
    logPath: string,
    timeoutMs: number,
    image: string,
  ): Promise<{ exitCode: number | null; output: string }> {
    const quotedCwd = `"${cwd.replace(/"/g, "")}"`;
    const inner = cmd.replace(/"/g, '\\"');
    const dockerCmd = `docker run --rm -v ${quotedCwd}:/workspace -w /workspace ${image} sh -c "${inner}"`;
    const res = await this.spawnSingle(dockerCmd, cwd, logPath, timeoutMs);
    if (res.exitCode === null || isDockerInfraFailure(res.output)) {
      throw new Error(firstOutputLine(res.output));
    }
    return res;
  }

  private spawnSingle(cmd: string, cwd: string, logPath: string, timeoutMs: number): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      const child = spawn(cmd, {
        cwd,
        shell: true,
        timeout: timeoutMs,
        env: { ...process.env },
        windowsHide: true,
      });
      const onData = (data: Buffer | string) => {
        const text = data.toString();
        output += text;
        try {
          fs.appendFileSync(logPath, text, "utf-8");
        } catch {}
      };
      (child.stdout as unknown as { on: (ev: string, cb: (d: Buffer) => void) => void })?.on("data", onData as unknown as (d: Buffer) => void);
      (child.stderr as unknown as { on: (ev: string, cb: (d: Buffer) => void) => void })?.on("data", onData as unknown as (d: Buffer) => void);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            (child as unknown as { kill: (sig: string) => void }).kill("SIGTERM");
          } catch {}
          const msg = `\n[timeout ${timeoutMs}ms waiting for ${cmd}]\n`;
          output += msg;
          try {
            fs.appendFileSync(logPath, msg, "utf-8");
          } catch {}
          resolve({ exitCode: null, output });
        }
      }, timeoutMs + 500);

      (child as unknown as { on: (ev: string, cb: (err: unknown) => void) => void }).on("error", (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = `\n[spawn error ${cmd}: ${String(err)}]\n`;
        output += msg;
        try {
          fs.appendFileSync(logPath, msg, "utf-8");
        } catch {}
        resolve({ exitCode: 1, output });
      });

      (child as unknown as { on: (ev: string, cb: (code: number | null) => void) => void }).on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, output });
      });
    });
  }
}

function buildSnippet(output: string): string {
  const head = output.slice(0, 2048);
  if (output.length <= 4096) return head;
  const tail = output.slice(-2048);
  return `${head}\n...[truncated ${output.length - 4096} chars]...\n${tail}`;
}

export const runnerExecutor = new RunnerExecutor();
