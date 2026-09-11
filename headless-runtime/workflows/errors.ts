/**
 * Errores tipados del workflow engine.
 */

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export class VariablesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariablesError";
  }
}

export class NodeExecutionError extends Error {
  readonly nodeId: string;
  readonly stderrTail?: string;

  constructor(nodeId: string, message: string, stderrTail?: string) {
    super(message);
    this.name = "NodeExecutionError";
    this.nodeId = nodeId;
    this.stderrTail = stderrTail;
  }
}

/** Señal interna para cortar el run como `cancelled` (nodo cancel). */
export class NodeCancelSignal extends Error {
  readonly nodeId: string;

  constructor(nodeId: string, reason: string) {
    super(reason);
    this.name = "NodeCancelSignal";
    this.nodeId = nodeId;
  }
}
