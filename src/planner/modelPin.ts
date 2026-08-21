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
  resolveModelForPhase,
  type ModelRef,
  type PhaseId,
} from "../../shared/phaseModels";
import { toPreviewText } from "../terminal/terminalRuntimePolicy";
import { getTerminalRuntimePreviewAnsi } from "../terminal/terminalRuntimeStore";
import { usePreferencesStore } from "../stores/preferencesStore";

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
  ) => Promise<
    | { ok: true; data: { ok: boolean; reason?: string } }
    | { ok: false; error: string }
  >;
}

/**
 * Gate ANTES de spawnear una fase CLI: devuelve null si la corrida puede
 * proceder (modelo válido, fase sin pin o catálogo no disponible — misma
 * semántica best-effort que el motor), o el motivo accionable si bloquea.
 */
export async function assertPhaseModelAvailable(
  phaseId: PhaseId,
  api?: PhaseGateApi,
): Promise<string | null> {
  const client =
    api ??
    (typeof window !== "undefined" ? window.termcanvas?.models : undefined);
  if (!client?.validatePhase) return null;
  try {
    const res = await client.validatePhase(
      phaseId,
      usePreferencesStore.getState().phaseModels,
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
): string[] {
  if (!ref) return [];
  return [
    "--model",
    formatModelRef(ref),
    ...(ref.variant ? ["--variant", ref.variant] : []),
  ];
}

/** Flags de pin para la TUI de opencode (--variant no existe ahí). */
export function tuiModelFlagArgs(ref: ModelRef | null | undefined): string[] {
  if (!ref) return [];
  return ["--model", formatModelRef(ref)];
}
