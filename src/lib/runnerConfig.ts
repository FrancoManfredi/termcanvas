/**
 * Runner config helper for renderer (browser) — re-exports zod schemas and
 * provides fetch-based validation without Node fs.
 * Mirrors headless-runtime/runner/runnerConfig.ts but without file I/O.
 *
 * F4-E2 (docs/MASTER-PLAN-MODULARIDAD.md §2 FASE 4, punto 4): el fallback es
 * local honesto (`isolation: "none"`, sin imagen), en paridad con el fallback
 * daemon ya imageless y coherente con el yaml fuente única
 * (`factory/runners/linux-build.yaml`, que manda con `node:22-bookworm`):
 * la imagen vive SOLO en el yaml (C7: cero literales de imagen en TS), así
 * que el fallback —que rige cuando el yaml es inalcanzable— no inventa
 * ninguna. Ver `tests/renderer-runner-fallback.test.ts` (quién manda: el DAEMON — lector `headless-runtime/runner/runnerConfig.ts` + fuente canónica `factory/runners/` vía `agentLoader.getRunner`; este espejo solo valida/maqueta para la UI).
 */

import { z } from "zod";
import {
  RunnerSpecSchema,
  type RunnerSpec,
  type InstanceShape,
} from "../../shared/types/runner";

export { RunnerSpecSchema, type RunnerSpec, type InstanceShape };

/**
 * Validate an unknown object as RunnerSpec.
 */
export function validateRunnerSpec(data: unknown): RunnerSpec {
  return RunnerSpecSchema.parse(data);
}

/**
 * Fallback honesto para la UI cuando el yaml es inalcanzable (server caído o
 * endpoint ausente): `isolation: "none"` local declarado, SIN imagen a
 * propósito (la imagen vive solo en el yaml fuente única; este fallback no
 * inventa ninguna). Paridad con el fallback daemon ya imageless
 * (`headless-runtime/runner/runnerConfig.ts`; E1 lo devolvió por ser este
 * espejo renderer zona E2). Sigue siendo un `RunnerSpec` válido (id + shape
 * + setup intactos) para no romper a `fetchRunnerSpec` ni a futuros lectores.
 */
export const LINUX_BUILD_FALLBACK: RunnerSpec = {
  id: "linux-build",
  os: "linux",
  arch: "x86_64",
  instanceShape: {
    cpu: "4vCPU",
    cpuCount: 4,
    memory: "8GB",
    memoryGB: 8,
  },
  setupCommands: ["corepack enable"],
  workdir: "/workspace",
  description: "Linux build runner (fallback renderer: yaml inalcanzable, local honesto)",
  isolation: "none",
};

/**
 * Fetch and validate runner spec from server endpoint.
 * In Ola 1, runner is config-as-code; UI can optionally call GET /runners/:id
 * or just use the fallback. This helper centralizes validation.
 */
export async function fetchRunnerSpec(
  fetchFn: typeof fetch = fetch,
  id: string = "linux-build",
  timeoutMs: number = 3000,
): Promise<RunnerSpec> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Try to fetch from potential endpoints. First try /runners/:id, then fallback.
    const candidates = [`/runners/${id}.yaml`, `/runners/${id}`];
    for (const url of candidates) {
      try {
        const res = await fetchFn(url, { signal: controller.signal });
        if (!res.ok) continue;
        const text = await res.text();
        // If yaml, naive check — if json, parse; else fallback.
        try {
          const json = JSON.parse(text);
          return RunnerSpecSchema.parse(json);
        } catch {
          // not json, assume yaml not parseable in browser without lib — use fallback
          continue;
        }
      } catch {
        continue;
      }
    }
    return LINUX_BUILD_FALLBACK;
  } finally {
    clearTimeout(timer);
  }
}

// Aliases for compatibility with older imports
export const runnerSpecSchema = RunnerSpecSchema;
