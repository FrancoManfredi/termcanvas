/**
 * Registry de harnesses de entrevista — patrón adapter.
 * El engine nunca importa opencode/codebuddy directo; resuelve vía getInterviewHarness(id).
 *
 * Añadir un harness:
 * 1. Crear headless-runtime/interview/harness/<id>.ts que exporte const <id>Harness: HarnessInterviewAdapter
 * 2. Importarlo acá y registrarlo en HARNESS_REGISTRY
 * 3. Añadir su id a shared/neutral/interview.ts SUPPORTED_INTERVIEW_HARNESSES y a shared/phaseModels.ts PHASE_CLIS
 * Cero cambios en engine.ts.
 */

import type { CliCatalogSource } from "../../../shared/modelCatalog.ts";
import type { HarnessInterviewAdapter } from "../../../shared/neutral/interview.ts";
import { opencodeHarness } from "./opencode.ts";
import { codebuddyHarness } from "./codebuddy.ts";

// ─── Stubs genéricos para CLIs sin harness real aún ───────────────────
// Para que la UI no rompa si el usuario elige "claude" en una fase de entrevista
// antes de que el harness exista: devuelve error claro en promptStructuredRaw.

function makeStubHarness(id: CliCatalogSource): HarnessInterviewAdapter {
  return {
    harnessId: id,
    async ensureReady(): Promise<void> {
      throw new Error(`Harness "${id}" aún no implementado para entrevistas. Usá opencode o codebuddy.`);
    },
    async createSession(): Promise<{ id: string }> {
      throw new Error(`Harness "${id}" no soporta createSession`);
    },
    async deleteSession(): Promise<void> {},
    async promptStructuredRaw(): Promise<never> {
      throw new Error(`Harness "${id}" no implementado para entrevistas`);
    },
    close(): void {},
  };
}

const HARNESS_REGISTRY = new Map<CliCatalogSource, HarnessInterviewAdapter>([
  ["opencode", opencodeHarness],
  ["codebuddy", codebuddyHarness],
  // stubs para evitar crash si UI permite elegirlos antes de implementar
  ["claude", makeStubHarness("claude")],
  ["codex", makeStubHarness("codex")],
  ["gemini", makeStubHarness("gemini")],
  ["kimi", makeStubHarness("kimi")],
  ["wuu", makeStubHarness("wuu")],
]);

// ─── Test seam ────────────────────────────────────────────────────────
const testOverrides = new Map<CliCatalogSource, HarnessInterviewAdapter>();

export function __setTestHarness(harnessId: CliCatalogSource, harness: HarnessInterviewAdapter | null): void {
  if (harness === null) testOverrides.delete(harnessId);
  else testOverrides.set(harnessId, harness);
}

export function __resetTestHarnesses(): void {
  testOverrides.clear();
}

// ─── API pública ──────────────────────────────────────────────────────

export function getInterviewHarness(harnessId: CliCatalogSource): HarnessInterviewAdapter {
  if (testOverrides.has(harnessId)) return testOverrides.get(harnessId)!;
  const found = HARNESS_REGISTRY.get(harnessId);
  if (!found) throw new Error(`Harness desconocido: "${harnessId}"`);
  return found;
}

export function listInterviewHarnesses(): CliCatalogSource[] {
  return [...HARNESS_REGISTRY.keys()];
}

export function registerInterviewHarness(harness: HarnessInterviewAdapter): void {
  HARNESS_REGISTRY.set(harness.harnessId, harness);
}

// Re-export para que engine.ts pueda delegar closeAll
export function closeAllHarnesses(): void {
  for (const h of HARNESS_REGISTRY.values()) {
    try {
      h.close();
    } catch {}
  }
  for (const h of testOverrides.values()) {
    try {
      h.close();
    } catch {}
  }
}
