/**
 * DAG del workflow: validación, capas topológicas, evaluación de `when`
 * y reglas de disparo (`trigger_rule`).
 */

import type { NodeState, NodeStatus } from "./types";
import type { TriggerRule, WorkflowDefinition, WorkflowNode } from "./schema";
import { TERMINAL_NODE_STATUSES } from "./types";
import { VariablesError, WorkflowValidationError } from "./errors";

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  byId: Map<string, WorkflowNode>;
  /** Capas de ejecución: cada capa corre en paralelo. */
  layers: string[][];
  directDeps: Map<string, string[]>;
  dependents: Map<string, string[]>;
}

export function validateWorkflow(def: WorkflowDefinition): void {
  const seen = new Set<string>();
  for (const node of def.nodes) {
    if (seen.has(node.id)) {
      throw new WorkflowValidationError(`id de nodo duplicado: ${node.id}`);
    }
    seen.add(node.id);
  }
  for (const node of def.nodes) {
    for (const dep of node.depends_on) {
      if (!seen.has(dep)) {
        throw new WorkflowValidationError(
          `nodo "${node.id}": depends_on referencia a "${dep}" inexistente`,
        );
      }
      if (dep === node.id) {
        throw new WorkflowValidationError(
          `nodo "${node.id}": no puede depender de sí mismo`,
        );
      }
    }
  }
  if (def.returns && !seen.has(def.returns)) {
    throw new WorkflowValidationError(
      `returns referencia a "${def.returns}" inexistente`,
    );
  }
  if (def.outcome_field && !def.returns) {
    throw new WorkflowValidationError("outcome_field requiere declarar returns");
  }
  for (const [name, spec] of Object.entries(def.inputs)) {
    if (spec.required && spec.default !== undefined) {
      throw new WorkflowValidationError(
        `input "${name}": required y default son mutuamente excluyentes`,
      );
    }
  }
  buildLayers(def.nodes);
}

export function buildLayers(nodes: WorkflowNode[]): WorkflowGraph {
  const byId = new Map<string, WorkflowNode>();
  for (const node of nodes) byId.set(node.id, node);

  const directDeps = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    const deps = [...new Set(node.depends_on)];
    directDeps.set(node.id, deps);
    inDegree.set(node.id, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  const layers: string[][] = [];
  let frontier = nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const visited = new Set<string>();
  while (frontier.length > 0) {
    layers.push([...frontier]);
    const next: string[] = [];
    for (const id of frontier) {
      visited.add(id);
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    frontier = [...new Set(next)];
  }
  if (visited.size !== nodes.length) {
    const cycle = nodes
      .filter((node) => !visited.has(node.id))
      .map((node) => node.id)
      .join(", ");
    throw new WorkflowValidationError(`ciclo detectado en el DAG: ${cycle}`);
  }
  return { nodes, byId, layers, directDeps, dependents };
}

export interface GraphEvalContext {
  /** Resuelve una expresión $ref a su valor preservando el tipo. */
  resolveExpression(expr: string): unknown;
}

/** Evalúa una condición `when` (soporta == != > >= < <= con && y ||). */
export function evaluateWhen(
  expression: string,
  ctx: GraphEvalContext,
): boolean {
  const orParts = expression.split("||").map((part) => part.trim());
  return orParts.some((orPart) =>
    orPart
      .split("&&")
      .map((part) => part.trim())
      .filter(Boolean)
      .every((comparison) => evaluateComparison(comparison, ctx)),
  );
}

function evaluateComparison(
  comparison: string,
  ctx: GraphEvalContext,
): boolean {
  const match = comparison.match(/^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/);
  if (!match) return false;
  const [, leftRaw, operator, rightRaw] = match;
  const left = resolveOperand(leftRaw.trim(), ctx);
  const right = resolveOperand(rightRaw.trim(), ctx);
  switch (operator) {
    case "==":
    case "!=": {
      const equal =
        typeof left === "number" && typeof right === "number"
          ? left === right
          : String(left) === String(right);
      return operator === "==" ? equal : !equal;
    }
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const leftNum = toNumber(left);
      const rightNum = toNumber(right);
      if (Number.isNaN(leftNum) || Number.isNaN(rightNum)) return false;
      if (operator === ">") return leftNum > rightNum;
      if (operator === ">=") return leftNum >= rightNum;
      if (operator === "<") return leftNum < rightNum;
      return leftNum <= rightNum;
    }
    default:
      return false;
  }
}

function toNumber(value: string | number | boolean): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

function resolveOperand(
  raw: string,
  ctx: GraphEvalContext,
): string | number | boolean {
  if (raw.startsWith("$")) {
    try {
      const value = ctx.resolveExpression(raw);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }
      return JSON.stringify(value);
    } catch (error) {
      if (error instanceof VariablesError) return "";
      throw error;
    }
  }
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  const asNumber = Number(raw);
  if (raw.trim() !== "" && !Number.isNaN(asNumber)) return asNumber;
  return raw;
}

export interface TriggerDecision {
  run: boolean;
  skipReason?: string;
}

export function evaluateTriggerRule(
  rule: TriggerRule,
  deps: string[],
  states: Record<string, NodeState>,
): TriggerDecision {
  if (deps.length === 0) return { run: true };
  const statuses = deps.map((dep) => states[dep]?.status ?? "pending");
  const anyFailed = statuses.some(
    (status) => status === "failed" || status === "cancelled",
  );
  const anyCompleted = statuses.some((status) => status === "completed");
  const allTerminal = statuses.every((status) =>
    (TERMINAL_NODE_STATUSES as NodeStatus[]).includes(status),
  );
  switch (rule) {
    case "all_success":
      return statuses.every((status) => status === "completed")
        ? { run: true }
        : {
            run: false,
            skipReason: "dependencias no completadas (all_success)",
          };
    case "one_success":
      return anyCompleted
        ? { run: true }
        : {
            run: false,
            skipReason: "ninguna dependencia completó (one_success)",
          };
    case "none_failed_min_one_success":
      return !anyFailed && anyCompleted && allTerminal
        ? { run: true }
        : {
            run: false,
            skipReason:
              "dependencia fallida o ninguna completó (none_failed_min_one_success)",
          };
    case "all_done":
      return allTerminal
        ? { run: true }
        : {
            run: false,
            skipReason: "dependencias aún no terminaron (all_done)",
          };
    default:
      return { run: false, skipReason: `trigger_rule desconocida: ${rule}` };
  }
}
