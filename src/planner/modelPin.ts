// Pin de modelo por fase para las fases CLI (Planificación roadmap/audit,
// Diagnóstico LLM). Resuelve el modelo efectivo desde las preferencias
// (override del usuario > default del contrato) y lo traduce a flags de la
// CLI opencode instalada:
//   - `opencode run`:   -m/--model provider/model  +  --variant <v>  (ambos
//     verificados contra `opencode run --help`, CLI 1.18.x).
//   - TUI (`opencode`): -m/--model existe; --variant NO (es solo de run) —
//     el pin de variante se ignora en TUI a propósito, no es un error.
//
// null = sin pin: la sesión usa el default global de la config de opencode
// del usuario (conducta actual).

import {
  formatModelRef,
  resolveCliForPhase,
  resolveModelForPhase,
  type ModelRef,
  type PhaseId,
} from "../../shared/phaseModels";
import { toPreviewText } from "../terminal/terminalRuntimePolicy";
import { getTerminalRuntimePreviewAnsi } from "../terminal/terminalRuntimeStore";
import { usePreferencesStore } from "../stores/preferencesStore";

// CLIs cuyo flag --model espera solo el modelID sin prefijo provider/
// (CodeBuddy: fast-model, no codebuddy/fast-model — ver error 400).
const CLI_MODEL_ID_ONLY = new Set<string>(["codebuddy"]);
// CLIs que ignoran --variant (solo opencode lo soporta vía --variant)
const CLI_IGNORES_VARIANT = new Set<string>(["codebuddy"]);

function formatModelForCli(ref: ModelRef, cli: string | null): string {
  if (cli && CLI_MODEL_ID_ONLY.has(cli)) return ref.modelID;
  return formatModelRef(ref);
}

/** Modelo efectivo de una fase según las preferencias actuales. */
export function resolvePhaseModelRef(phaseId: PhaseId): ModelRef | null {
  return resolveModelForPhase(
    phaseId,
    usePreferencesStore.getState().phaseModels,
  );
}

/** ¿La fase CLI debe correr en TUI interactiva? (Settings, default headless). */
export function shouldRunPhaseInTui(): boolean {
  return usePreferencesStore.getState().phaseCliTui;
}

// ─── Gate previo del pin CLI ─────────────────────────────────────────────

/** Contrato mínimo del API models para el gate (satisfecho por preload). */
interface PhaseGateApi {
  validatePhase: (
    phaseId: PhaseId,
    overrides?: Partial<Record<PhaseId, ModelRef>> | null,
    cli?: string,
  ) => Promise<
    | { ok: true; data: { ok: boolean; reason?: string } }
    | { ok: false; error: string }
  >;
}

/**
 * Gate ANTES de spawnear una fase CLI: devuelve null si la corrida puede
 * proceder (modelo válido, fase sin pin o catálogo no disponible — misma
 * semántica best-effort que el motor), o el motivo accionable si bloquea.
 * Respeta el CLI configurado para la fase: si la fase usa codebuddy, valida
 * contra el catálogo de codebuddy, no contra opencode (fix del bug
 * "[diagnosisLlm] El proveedor codebuddy no está disponible en esta
 * instalación de opencode" en TODAS las fases).
 */
export async function assertPhaseModelAvailable(
  phaseId: PhaseId,
  api?: PhaseGateApi,
  cliOverride?: string | null,
): Promise<string | null> {
  const client =
    api ??
    (typeof window !== "undefined" ? window.termcanvas?.models : undefined);
  if (!client?.validatePhase) return null;
  try {
    const cli =
      cliOverride ?? resolveCliForPhase(phaseId, usePreferencesStore.getState().phaseClis) ?? undefined;
    const res = await client.validatePhase(
      phaseId,
      usePreferencesStore.getState().phaseModels,
      cli,
    );
    if (!res.ok) return null;
    return res.data.ok
      ? null
      : res.data.reason ?? "el modelo configurado no está disponible";
  } catch {
    return null;
  }
}

// ─── Tail de salida para errores de fases CLI ────────────────────────────

/**
 * Últimas `lines` líneas de texto plano desde un buffer ANSI (el preview del
 * runtime ya conserva la cola: clampPreviewAnsi mantiene los últimos 200k).
 */
export function extractOutputTail(text: string, lines = 15): string {
  const clean = toPreviewText(text);
  const parts = clean.split("\n").map((line) => line.replace(/\s+$/, ""));
  return parts.slice(-lines).join("\n").trim();
}

/** Tail del output vivo de un terminal ("" si el runtime ya no existe). */
export function getPhaseOutputTail(terminalId: string, lines = 15): string {
  const ansi = getTerminalRuntimePreviewAnsi(terminalId);
  return ansi ? extractOutputTail(ansi, lines) : "";
}

/** Flags de pin para `opencode run` (acepta --model y --variant). */
export function runModelFlagArgs(
  ref: ModelRef | null | undefined,
  cli: string | null = "opencode",
): string[] {
  if (!ref) return [];
  const modelValue = formatModelForCli(ref, cli);
  const variantFlag = ref.variant && cli && CLI_IGNORES_VARIANT.has(cli) ? [] : ref.variant ? ["--variant", ref.variant] : [];
  return [
    "--model",
    modelValue,
    ...variantFlag,
  ];
}

/** Flags de pin para la TUI (--variant no existe en TUI para ningún CLI). */
export function tuiModelFlagArgs(
  ref: ModelRef | null | undefined,
  cli: string | null = "opencode",
): string[] {
  if (!ref) return [];
  const modelValue = formatModelForCli(ref, cli);
  return ["--model", modelValue];
}
