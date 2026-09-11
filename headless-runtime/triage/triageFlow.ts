/**
 * TriageFlow — Ola 8.
 * Orquestación del pre-paso Triage-agent dentro del flujo Intake→Foreman.
 * Helpers puros/testeables + persistencia best-effort (timeline meta + triage.json).
 * Nunca lanza hacia el flujo principal: todo fallo se degrada a fallback building.
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkItem } from "../../shared/types/workItem";
import type { ModelRef } from "../../shared/types/workItem";
import type { TriageFindings } from "../../shared/types/triage";
import {
  TriageFindingsSchema,
  buildFallbackTriageFindings,
} from "../../shared/types/triage";
import { triageAgent } from "./triageAgent";
import { workItemStore } from "../workItem/workItemStore";
import { getFactoryConfig } from "../factory/agentLoader";
// B2: session cwd = isolation jail when recorded, else the anchor.
import { resolveSessionWorktree } from "../factory/isolation/sessionWorktree";

/**
 * Resuelve el modelo efectivo para triage/spec: el modelRef del job (mismo
 * modelo; disjoint solo aplica a REVIEW). Sin modelRef, usa el default
 * versionado de factory.yaml (defaultModels.foreman) parseado como
 * "providerID/modelID"; último recurso, el default ya establecido del Foreman.
 * Sin literales nuevos: los valores vienen de la config versionada.
 */
export function resolveJobModel(modelRef?: ModelRef): ModelRef {
  if (modelRef && modelRef.providerID && modelRef.modelID) {
    return {
      providerID: modelRef.providerID,
      modelID: modelRef.modelID,
      ...(modelRef.variant ? { variant: modelRef.variant } : {}),
    };
  }
  try {
    const raw = String(getFactoryConfig().defaultModels.foreman ?? "").trim();
    const slash = raw.indexOf("/");
    if (slash > 0 && slash < raw.length - 1) {
      return { providerID: raw.slice(0, slash).trim(), modelID: raw.slice(slash + 1).trim() };
    }
  } catch {}
  // Espejo del default del Foreman (valor ya establecido en factory.yaml y foreman.ts).
  return { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" };
}

/**
 * Modo de triage efectivo (T2 on-demand): lee `triageMode` de la config
 * versionada con fallback "auto" ante ausente/inválido. Nunca lanza.
 */
export function resolveTriageMode(explicit?: unknown): "auto" | "always" | "never" {
  try {
    const raw =
      typeof explicit === "string"
        ? explicit.trim().toLowerCase()
        : (() => {
            try {
              const live = getFactoryConfig()?.triageMode as unknown;
              return typeof live === "string" ? live.trim().toLowerCase() : "";
            } catch {
              return "";
            }
          })();
    if (raw === "always" || raw === "never" || raw === "auto") return raw;
    return "auto";
  } catch {
    return "auto";
  }
}

/**
 * ¿Corre el pre-triage antes del foreman? Solo en modo "always" (régimen
 * anterior), salvo bypass pact o re-dispatch post-approve. En "auto" el
 * foreman decide primero y el triage corre on-demand; en "never" jamás.
 * Puro, nunca lanza.
 */
export function shouldRunPreTriage(
  mode: unknown,
  skipTriageSpec: boolean,
  isPactJob: boolean,
): boolean {
  try {
    if (skipTriageSpec || isPactJob) return false;
    return resolveTriageMode(mode) === "always";
  } catch {
    return false;
  }
}

/**
 * ¿Corre el triage on-demand DESPUÉS del foreman? Solo en modo "auto"
 * cuando el foreman dice needs_triage/needs_input (para formular
 * preguntas). Puro, nunca lanza.
 */
export function needsOnDemandTriage(mode: unknown, decision: unknown): boolean {
  try {
    if (resolveTriageMode(mode) !== "auto") return false;
    return decision === "needs_triage" || decision === "needs_input";
  } catch {
    return false;
  }
}

/** Nombre del archivo de evidencia en el dir del job. */
export const TRIAGE_JSON_FILE = "triage.json";

/**
 * Extrae los últimos findings de triage desde la meta del timeline.
 * Puro, nunca lanza (devuelve null si no hay o si no validan).
 */
export function getLatestTriage(
  workItem: Pick<WorkItem, "timeline"> | null | undefined,
): TriageFindings | null {
  try {
    const timeline = workItem?.timeline;
    if (!Array.isArray(timeline)) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const meta = timeline[i]?.meta as Record<string, unknown> | undefined;
      if (!meta || !("triage" in meta)) continue;
      const parsed = TriageFindingsSchema.safeParse(meta.triage);
      if (parsed.success) return parsed.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Escribe triage.json en el dir del job (tmp + rename, best-effort).
 * Puro respecto a errores: nunca lanza.
 */
export function persistTriageJson(dir: string, findings: TriageFindings): boolean {
  try {
    if (!dir || typeof dir !== "string") return false;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, TRIAGE_JSON_FILE);
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(findings, null, 2), "utf-8");
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persiste findings en timeline meta + triage.json. Best-effort, nunca lanza.
 */
export function persistTriage(
  workItemId: string,
  findings: TriageFindings,
  message?: string,
): void {
  try {
    const msg =
      message ??
      `triage ${findings.decision} (${findings.complexity}) conf=${findings.confidence}${findings.fallback ? " fallback" : ""} — ${findings.reason.slice(0, 120)}`;
    try {
      workItemStore.appendEvent(workItemId, "system", msg, {
        triage: findings,
      } as unknown as Record<string, unknown>);
    } catch {}
    try {
      const wi = workItemStore.get(workItemId);
      if (wi?.dir) persistTriageJson(wi.dir, findings);
    } catch {}
  } catch {}
}

export interface TriagePreStepResult {
  findings: TriageFindings;
  raw: string | null;
}

/**
 * Corre el Triage-agent para un work item. Fallo-sano: ante cualquier error
 * devuelve fallback building (nunca lanza).
 * Pact jobs no deben llamar acá (bypass total en el llamador vía isPactTriageJob).
 */
export async function runTriageForJob(
  workItem: Pick<WorkItem, "id" | "prompt" | "worktree"> & {
    modelRef?: ModelRef;
    isolation?: WorkItem["isolation"];
    timeline?: WorkItem["timeline"];
  },
): Promise<TriagePreStepResult> {
  try {
    const model = resolveJobModel(workItem.modelRef);
    const out = await triageAgent.consume({
      workItemId: workItem.id,
      // B2: the jail when recorded (isolation worktree), else the anchor.
      worktreePath: resolveSessionWorktree(workItem),
      model,
      prompt: workItem.prompt,
    });
    return { findings: out.findings, raw: out.raw };
  } catch {
    return { findings: buildFallbackTriageFindings(), raw: null };
  }
}
