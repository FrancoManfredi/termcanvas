/**
 * Interpolación de variables del workflow ($INPUTS, $node.output, $ARTIFACTS_DIR, ...).
 * Acceso estricto: raíz desconocida o campo inexistente fallan en vez de resolver vacío.
 */

import type { NodeState } from "./types";
import { VariablesError } from "./errors";

export interface VarContext {
  args: string;
  inputs: Record<string, unknown>;
  nodes: Record<string, NodeState>;
  artifactsDir: string;
  stateDir: string;
  workflowName: string;
  runId: string;
  rejectionReason?: string;
  loopPrev?: Record<string, unknown>;
  /** Salida textual de la iteración anterior de un `loop` escalar. */
  loopPrevOutput?: string;
}

const VAR_PATTERN = /\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_-]+)*)/g;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function walkFieldPath(
  source: unknown,
  segments: string[],
  expression: string,
): unknown {
  let current: unknown = source;
  const walked: string[] = [];
  for (const segment of segments) {
    if (!isPlainObject(current)) {
      throw new VariablesError(
        `${expression}: no se puede leer .${segment} sobre un valor no-objeto`,
      );
    }
    if (!(segment in current)) {
      throw new VariablesError(
        `${expression}: campo inexistente .${segment}`,
      );
    }
    current = current[segment];
    walked.push(segment);
  }
  return current;
}

function resolveRootPath(
  root: string,
  segments: string[],
  ctx: VarContext,
  expression: string,
): unknown {
  switch (root) {
    case "ARGUMENTS":
    case "USER_MESSAGE":
      if (segments.length > 0) {
        throw new VariablesError(`${expression}: $${root} no tiene campos`);
      }
      return ctx.args;
    case "ARTIFACTS_DIR":
      return ctx.artifactsDir;
    case "STATE_DIR":
      return ctx.stateDir;
    case "WORKFLOW_ID":
      return ctx.workflowName;
    case "RUN_ID":
      return ctx.runId;
    case "REJECTION_REASON":
      return ctx.rejectionReason ?? "";
    case "LOOP_PREV_OUTPUT":
      if (segments.length > 0) {
        throw new VariablesError(`${expression}: $LOOP_PREV_OUTPUT no tiene campos`);
      }
      return ctx.loopPrevOutput ?? "";
    case "INPUTS": {
      const [name, ...rest] = segments;
      if (!name) {
        throw new VariablesError(`${expression}: $INPUTS requiere un nombre`);
      }
      if (!(name in ctx.inputs)) {
        throw new VariablesError(`${expression}: input "${name}" no declarado`);
      }
      return walkFieldPath(ctx.inputs[name], rest, expression);
    }
    case "LOOP_PREV": {
      const [nodeId, ...rest] = segments;
      if (!nodeId) {
        throw new VariablesError(`${expression}: $LOOP_PREV requiere un nodo`);
      }
      const source = ctx.loopPrev?.[nodeId];
      if (source === undefined) return "";
      return walkFieldPath(source, rest, expression);
    }
    default: {
      const state = ctx.nodes[root];
      if (!state) {
        throw new VariablesError(`${expression}: variable desconocida $${root}`);
      }
      const [head, ...rest] = segments;
      if (head !== "output") {
        throw new VariablesError(
          `${expression}: $${root} solo expone .output (u .output.<campo>)`,
        );
      }
      if (rest.length === 0) {
        return state.output ?? "";
      }
      if (state.outputJson === undefined) {
        throw new VariablesError(
          `${expression}: $${root}.output no es estructurado (declarar output_format)`,
        );
      }
      return walkFieldPath(state.outputJson, rest, expression);
    }
  }
}

export function resolveTemplate(template: string, ctx: VarContext): string {
  return template.replace(VAR_PATTERN, (match, root: string, pathPart: string) => {
    const segments = pathPart
      ? pathPart.slice(1).split(".").filter(Boolean)
      : [];
    const value = resolveRootPath(root, segments, ctx, match);
    return stringify(value);
  });
}

/** Resuelve un valor arbitrario (usado por `with:` maps) preservando tipos. */
export function resolveValue(value: unknown, ctx: VarContext): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_-]+)*)$/);
    if (exact) {
      const segments = exact[2]
        ? exact[2].slice(1).split(".").filter(Boolean)
        : [];
      return resolveRootPath(exact[1], segments, ctx, value);
    }
    return resolveTemplate(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, ctx));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = resolveValue(entry, ctx);
    }
    return out;
  }
  return value;
}
