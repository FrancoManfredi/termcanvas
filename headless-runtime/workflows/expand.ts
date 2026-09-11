/**
 * Expansión load-time de nodos `include:` (Fase 3c).
 *
 * Un include inyecta los nodos del workflow referenciado con prefijo
 * `<includeId>__<nodeId>`, remapea dependencias internas y hace que los
 * consumidores del include dependan de sus nodos sink. Los `with:` del
 * include (y los del include anidado) viajan como overrides de `$INPUTS`
 * por nodo, resueltos en tiempo de ejecución.
 *
 * `$<includeId>.output` no existe: los consumidores deben referenciar los
 * nodos internos (`$<includeId>__<nodeId>.output`).
 */

import type { WorkflowDefinition, WorkflowNode } from "./schema";
import { WorkflowValidationError } from "./errors";

export interface ExpandedWorkflow {
  def: WorkflowDefinition;
  /** with: crudos por nodo inlined; se resuelven al ejecutar cada nodo. */
  inputOverrides: Record<string, Record<string, unknown>>;
}

const MAX_INCLUDE_DEPTH = 3;

export function expandIncludes(
  def: WorkflowDefinition,
  loadWorkflow: (name: string) => { def: WorkflowDefinition },
  depth = 0,
): ExpandedWorkflow {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new WorkflowValidationError(
      `include: profundidad máxima ${MAX_INCLUDE_DEPTH} excedida`,
    );
  }

  const includeNodes = def.nodes.filter((node) => node.include);
  const plainNodes = def.nodes.filter((node) => !node.include);
  if (includeNodes.length === 0) {
    return { def, inputOverrides: {} };
  }

  const expandedNodes: WorkflowNode[] = [];
  const inputOverrides: Record<string, Record<string, unknown>> = {};
  const sinkRemap = new Map<string, string[]>();

  for (const node of includeNodes) {
    if (node.fan_out) {
      throw new WorkflowValidationError(
        `include "${node.id}": fan_out sobre include no está soportado (usar un workflow: child)`,
      );
    }
    const child = loadWorkflow(node.include as string);
    const childExpanded = expandIncludes(child.def, loadWorkflow, depth + 1);
    const prefix = `${node.id}__`;
    const childNodes = childExpanded.def.nodes;
    const hasDependent = new Set<string>();
    for (const inner of childNodes) {
      for (const dep of inner.depends_on) hasDependent.add(dep);
    }
    const sinks = childNodes.filter((inner) => !hasDependent.has(inner.id));
    sinkRemap.set(
      node.id,
      sinks.map((inner) => `${prefix}${inner.id}`),
    );

    for (const inner of childNodes) {
      const mapped: WorkflowNode = {
        ...inner,
        id: `${prefix}${inner.id}`,
        depends_on: inner.depends_on.map((dep) => `${prefix}${dep}`),
      };
      if (inner.depends_on.length === 0) {
        mapped.depends_on = [...node.depends_on];
        if (node.when) {
          mapped.when = inner.when ? `${node.when} && ${inner.when}` : node.when;
        }
      }
      const childOverride = childExpanded.inputOverrides[inner.id];
      if (childOverride) inputOverrides[mapped.id] = childOverride;
      expandedNodes.push(mapped);
    }

    if (node.with) {
      for (const inner of childNodes) {
        const id = `${prefix}${inner.id}`;
        inputOverrides[id] = { ...(inputOverrides[id] ?? {}), ...node.with };
      }
    }
  }

  const remappedPlain = plainNodes.map((node) => ({
    ...node,
    depends_on: node.depends_on.flatMap((dep) => sinkRemap.get(dep) ?? [dep]),
  }));

  const returns =
    def.returns && sinkRemap.has(def.returns)
      ? sinkRemap.get(def.returns)?.[0]
      : def.returns;

  return {
    def: {
      ...def,
      returns,
      nodes: [...expandedNodes, ...remappedPlain],
    },
    inputOverrides,
  };
}
