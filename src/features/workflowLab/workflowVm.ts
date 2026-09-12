/**
 * Helpers puros de la UI de workflows (Fase 4c): DAG por capas, parsing de
 * inputs, tonos de estado y totales. Sin DOM, testeables con node:test.
 */

import type { WorkflowRunInfo } from "../../lib/factoryClient";

export interface DagNodeLike {
  id: string;
  depends_on?: string[];
}

/** Capas topológicas para dibujar el DAG; ante ciclo, los no resueltos van a una capa final. */
export function buildDagLayers(nodes: DagNodeLike[]): string[][] {
  try {
    const ids = nodes.map((node) => node.id);
    const idSet = new Set(ids);
    const dependents = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      const deps = (node.depends_on ?? []).filter((dep) => idSet.has(dep));
      inDegree.set(node.id, deps.length);
      for (const dep of deps) {
        const list = dependents.get(dep) ?? [];
        list.push(node.id);
        dependents.set(dep, list);
      }
    }
    const layers: string[][] = [];
    let frontier = ids.filter((id) => (inDegree.get(id) ?? 0) === 0);
    const seen = new Set<string>();
    while (frontier.length > 0) {
      layers.push([...frontier]);
      const next: string[] = [];
      for (const id of frontier) {
        seen.add(id);
        for (const dependent of dependents.get(id) ?? []) {
          const remaining = (inDegree.get(dependent) ?? 0) - 1;
          inDegree.set(dependent, remaining);
          if (remaining === 0) next.push(dependent);
        }
      }
      frontier = [...new Set(next)];
    }
    const unresolved = ids.filter((id) => !seen.has(id));
    if (unresolved.length > 0) layers.push(unresolved);
    return layers;
  } catch {
    return [nodes.map((node) => node.id)];
  }
}

export type ParsedInputs =
  | { ok: true; value?: Record<string, unknown> }
  | { ok: false; error: string };

export function parseInputsJson(text: string): ParsedInputs {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return { ok: true };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "inputs debe ser un objeto JSON {clave: valor}" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: `JSON inválido: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface RunTotals {
  costUsd: number;
  nodes: number;
  completed: number;
  failed: number;
  skipped: number;
}

export function runTotals(run: WorkflowRunInfo | null): RunTotals {
  const totals: RunTotals = {
    costUsd: 0,
    nodes: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
  if (!run) return totals;
  for (const state of Object.values(run.nodes ?? {})) {
    totals.nodes += 1;
    if (typeof state.costUsd === "number") totals.costUsd += state.costUsd;
    if (state.status === "completed") totals.completed += 1;
    else if (state.status === "failed") totals.failed += 1;
    else if (state.status === "skipped") totals.skipped += 1;
  }
  return totals;
}

export function formatTotals(run: WorkflowRunInfo | null): string {
  const totals = runTotals(run);
  const cost = totals.costUsd > 0 ? ` · $${totals.costUsd.toFixed(4)}` : "";
  return `${totals.completed}/${totals.nodes} ok${
    totals.failed > 0 ? ` · ${totals.failed} fail` : ""
  }${totals.skipped > 0 ? ` · ${totals.skipped} skip` : ""}${cost}`;
}

export function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-400 border-emerald-500/40";
    case "failed":
      return "text-red-400 border-red-500/40";
    case "running":
      return "text-sky-400 border-sky-500/40";
    case "pending":
      return "text-amber-400 border-amber-500/40";
    case "cancelled":
      return "text-zinc-400 border-zinc-500/40";
    case "skipped":
      return "text-zinc-500 border-zinc-600/40";
    default:
      return "text-[var(--text-secondary)] border-[var(--border)]";
  }
}

const BODY_KEYS = [
  "prompt",
  "command",
  "bash",
  "script",
  "wait",
  "cancel",
  "approval",
  "loop",
  "loop_group",
  "include",
  "workflow",
] as const;

export function nodeBodyOf(node: Record<string, unknown> | undefined): string {
  if (!node) return "?";
  for (const key of BODY_KEYS) {
    if (node[key] !== undefined) return key;
  }
  return "?";
}

/** Prefill del form de run: solo inputs con default declarado. */
export function defaultsForInputs(
  inputs: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return out;
  for (const [name, spec] of Object.entries(inputs as Record<string, unknown>)) {
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      const record = spec as Record<string, unknown>;
      if ("default" in record && record.default !== undefined) {
        out[name] = record.default;
      }
    }
  }
  return out;
}
