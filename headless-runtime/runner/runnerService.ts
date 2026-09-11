/**
 * RunnerService — resolves RunnerSpec for a WorkItem.
 * FASE 1 E2 (C6/C7, fin de la trampa `linux-build`): `loadSpec`/`loadSpecSync`
 * delegan en el loader genérico `agentLoader.getRunner(id)` (ya existe y
 * valida con zod4) + adaptador a `RunnerSpec`. Cualquier runner aceptado por
 * el loader es aceptado por el service; `linux-build` intacto; id
 * desconocido → 404; yaml ausente/inválido en un nombre conocido →
 * degradación honesta al fallback (como hoy).
 */

import type { RunnerSpec } from "../../shared/types/runner";
import type { WorkItem } from "../../shared/types/workItem";
import {
  getRunner,
  type RunnerDefinition,
} from "../factory/agentLoader";
import {
  LINUX_BUILD_FALLBACK,
  validateRunnerSpec,
} from "./runnerConfig";

/**
 * Adapta un RunnerDefinition del loader (forma `factory/runners/*.yaml`) a
 * RunnerSpec (forma `shared/types/runner.ts`). Puro salvo el warn honesto:
 * ante isolation `docker` sin imagen (yaml ausente → fallback sin imagen)
 * degrada a `none` local declarado en vez de prometer docker sin imagen.
 * Lanza RunnerParseError/zod si la forma es inválida (el caller cae al
 * fallback honesto, como hoy). Cero literales de imagen.
 */
function runnerDefinitionToSpec(def: RunnerDefinition): RunnerSpec {
  const vcpus = def.instanceShape.vcpus;
  const memoryGb = def.instanceShape.memoryGb;
  const dockerImage =
    typeof def.platform.dockerImage === "string"
      ? def.platform.dockerImage.trim()
      : "";
  const isolation: RunnerSpec["isolation"] =
    def.isolation === "docker" && dockerImage.length > 0 ? "docker" : "none";
  if (def.isolation === "docker" && dockerImage.length === 0) {
    console.warn(
      `[RunnerService] runner "${def.name}" sin imagen (yaml ausente o inválido), sigo en local honesto`,
    );
  }
  return validateRunnerSpec({
    id: def.name,
    os: def.platform.os,
    arch: def.platform.arch,
    ...(dockerImage.length > 0 ? { dockerImage } : {}),
    instanceShape: {
      cpu: `${vcpus}vCPU`,
      cpuCount: vcpus,
      memory: `${memoryGb}GB`,
      memoryGB: memoryGb,
    },
    setupCommands: [...def.setupCommands],
    ...(typeof def.description === "string" && def.description.length > 0
      ? { description: def.description }
      : {}),
    isolation,
    platform: {
      os: def.platform.os,
      arch: def.platform.arch,
      ...(dockerImage.length > 0 ? { dockerImage } : {}),
    },
  });
}

/** Resuelve por loader genérico o null (desconocido). Nunca lanza. */
function resolveViaLoader(id: string): RunnerDefinition | null {
  try {
    if (typeof id !== "string" || id.trim().length === 0) return null;
    return getRunner(id.trim());
  } catch {
    return null;
  }
}

function unknownRunnerError(id: string): Error {
  return Object.assign(new Error(`unknown runner: ${id}`), { status: 404 });
}

export class RunnerService {
  /**
   * Resolves the runner spec for a WorkItem.
   * FASE 1 E2: cualquier runner aceptado por el loader (no solo linux-build);
   * sin runnerId explícito cae a "linux-build" (default intacto).
   */
  async resolveForWorkItem(workItem: WorkItem): Promise<RunnerSpec> {
    const runnerId = workItem.runnerId ?? "linux-build";
    return this.loadSpec(runnerId);
  }

  /**
   * Sync variant for daemon hot paths (no async needed).
   */
  resolveForWorkItemSync(workItem: WorkItem): RunnerSpec {
    const runnerId = workItem.runnerId ?? "linux-build";
    return this.loadSpecSync(runnerId);
  }

  async loadSpec(id: string): Promise<RunnerSpec> {
    const def = resolveViaLoader(id);
    if (!def) {
      throw unknownRunnerError(id);
    }
    try {
      return runnerDefinitionToSpec(def);
    } catch (e) {
      console.warn(`[RunnerService] loadSpec failed for ${id}, using fallback: ${String(e)}`);
      return LINUX_BUILD_FALLBACK;
    }
  }

  loadSpecSync(id: string): RunnerSpec {
    const def = resolveViaLoader(id);
    if (!def) {
      throw unknownRunnerError(id);
    }
    try {
      return runnerDefinitionToSpec(def);
    } catch (e) {
      console.warn(`[RunnerService] loadSpecSync failed for ${id}, using fallback: ${String(e)}`);
      return LINUX_BUILD_FALLBACK;
    }
  }

  /**
   * Validates a RunnerSpec shape (zod) — re-export helper (ESM puro).
   */
  validate(spec: unknown): RunnerSpec {
    return validateRunnerSpec(spec);
  }
}

// Singleton
export const runnerService = new RunnerService();
