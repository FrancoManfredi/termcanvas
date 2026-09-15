/**
 * Workflow schema (YAML declarativo, inspirado en Archon pero adaptado a OpenCode).
 * Fase 0: se parsean todos los tipos de nodo planificados; el executor implementa
 * bash/script/wait/cancel y rechaza con error claro los que llegan en fases siguientes.
 */

import { z } from "zod";

export const TRIGGER_RULES = [
  "all_success",
  "one_success",
  "none_failed_min_one_success",
  "all_done",
] as const;

export const EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export const NODE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const RetrySchema = z.object({
  max_attempts: z.number().int().min(1).max(5).default(1),
  delay_ms: z.number().int().min(0).max(60_000).default(1_000),
  on_error: z.enum(["transient", "all"]).default("transient"),
});

export type RetrySpec = z.infer<typeof RetrySchema>;

const InputSpecSchema = z.object({
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const WaitBodySchema = z.object({
  duration_ms: z.number().int().min(0).max(86_400_000).optional(),
  until: z.string().optional(),
  event: z.string().optional(),
  deadline_ms: z.number().int().min(0).optional(),
});

const ApprovalBodySchema = z.object({
  message: z.string().min(1),
  capture_response: z.boolean().default(false),
  decisions: z.array(z.string().min(1)).optional(),
  on_reject: z
    .object({
      prompt: z.string().min(1),
      max_attempts: z.number().int().min(1).max(10).default(3),
    })
    .optional(),
});

const LoopBodySchema = z.object({
  prompt: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  max_iterations: z.number().int().min(1).max(100).default(5),
  until: z.string().optional(),
  until_bash: z.string().optional(),
  until_field: z.string().optional(),
  fresh_context: z.boolean().default(false),
  interactive: z.boolean().default(false),
  gate_message: z.string().optional(),
});

export interface LoopGroupSpec {
  nodes: WorkflowNode[];
  until?: string;
  until_bash?: string;
  max_iterations: number;
  fresh_context: boolean;
  interactive: boolean;
  gate_message?: string;
  /**
   * Historial acumulado de rondas (`$LOOP_HISTORY` + bloque auto-inyectado en
   * cada nodo IA del cuerpo). Default true: ningún workflow nuevo nace sin la
   * protección anti-regresión; `false` la apaga.
   */
  history: boolean;
  /**
   * Reverify system-owned (WS3b): los `reverify.commands` de findings
   * estructurados se validan contra la allowlist read-only y los ejecuta el
   * ENGINE en el worktree; la evidencia entra al historial de la próxima
   * ronda. Default true; `false` los ignora por completo.
   */
  reverify: boolean;
}

export interface FanOutSpec {
  items: string;
  as: string;
  max_parallel: number;
  join: "all_done" | "all_success";
}

/** Nodo del workflow: exactamente un body de ejecución, validado por el schema. */
export interface WorkflowNode {
  id: string;
  depends_on: string[];
  when?: string;
  trigger_rule: (typeof TRIGGER_RULES)[number];
  retry?: RetrySpec;
  always_run: boolean;
  timeout?: number;
  output_type?: string;
  context?: "fresh" | "shared" | { resume: string };
  provider?: string;
  model?: string;
  agent?: string;
  effort?: (typeof EFFORT_LEVELS)[number];
  output_format?: Record<string, unknown>;
  systemPrompt?: string;
  mcp?: string;
  skills?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
  with?: Record<string, unknown>;
  prompt?: string;
  command?: string;
  bash?: string;
  script?: { code: string; runtime: "node" | "tsx" };
  wait?: z.infer<typeof WaitBodySchema>;
  cancel?: string;
  approval?: z.infer<typeof ApprovalBodySchema>;
  loop?: z.infer<typeof LoopBodySchema>;
  loop_group?: LoopGroupSpec;
  include?: string;
  workflow?: string;
  fan_out?: FanOutSpec;
}

const NodeBaseSchema = z.object({
  id: z.string().regex(NODE_ID_PATTERN, "id inválido (usar letras, números, _ o -)"),
  depends_on: z.array(z.string().min(1)).default([]),
  when: z.string().min(1).optional(),
  trigger_rule: z.enum(TRIGGER_RULES).default("all_success"),
  retry: RetrySchema.optional(),
  always_run: z.boolean().default(false),
  timeout: z.number().int().min(1).max(3_600_000).optional(),
  output_type: z.string().min(1).optional(),
  context: z
    .union([
      z.literal("fresh"),
      z.literal("shared"),
      z.object({ resume: z.string().min(1) }),
    ])
    .optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  output_format: z.record(z.string(), z.unknown()).optional(),
  /** Agente OpenCode espejado (factory/agents/<name>/agent.md → .opencode/agents). */
  agent: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  mcp: z.string().min(1).optional(),
  skills: z.array(z.string().min(1)).optional(),
  allowed_tools: z.array(z.string().min(1)).optional(),
  denied_tools: z.array(z.string().min(1)).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});

const EXECUTION_BODY_KEYS = [
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

const NodeBodySchema = NodeBaseSchema.extend({
  prompt: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  bash: z.string().min(1).optional(),
  script: z
    .object({
      code: z.string().min(1),
      runtime: z.enum(["node", "tsx"]).default("node"),
    })
    .optional(),
  wait: WaitBodySchema.optional(),
  cancel: z.string().min(1).optional(),
  approval: ApprovalBodySchema.optional(),
  loop: LoopBodySchema.optional(),
  loop_group: z
    .object({
      nodes: z.array(z.lazy((): z.ZodType<WorkflowNode> => NodeSchema)).min(1),
      until: z.string().optional(),
      until_bash: z.string().optional(),
      max_iterations: z.number().int().min(1).max(100).default(5),
      fresh_context: z.boolean().default(false),
      interactive: z.boolean().default(false),
      gate_message: z.string().optional(),
      history: z.boolean().default(true),
      reverify: z.boolean().default(true),
    })
    .optional(),
  include: z.string().min(1).optional(),
  workflow: z.string().min(1).optional(),
  fan_out: z
    .object({
      items: z.string().min(1),
      as: z.string().min(1),
      max_parallel: z.number().int().min(1).max(32).default(5),
      join: z.enum(["all_done", "all_success"]).default("all_done"),
    })
    .optional(),
}).superRefine((node, ctx) => {
  const bodies = EXECUTION_BODY_KEYS.filter(
    (key) => (node as Record<string, unknown>)[key] !== undefined,
  );
  if (bodies.length !== 1) {
    ctx.addIssue({
      code: "custom",
      message: `el nodo debe declarar exactamente un body (${EXECUTION_BODY_KEYS.join("|")}); tiene ${bodies.length}`,
    });
  }
  if (node.fan_out && !node.workflow && !node.include) {
    ctx.addIssue({
      code: "custom",
      message: "fan_out requiere un nodo workflow: o include:",
    });
  }
  if (node.loop) {
    const hasPrompt = node.loop.prompt !== undefined;
    const hasCommand = node.loop.command !== undefined;
    if (hasPrompt === hasCommand) {
      ctx.addIssue({
        code: "custom",
        message: "loop requiere exactamente uno de prompt|command",
      });
    }
    const hasUntil =
      node.loop.until !== undefined ||
      node.loop.until_bash !== undefined ||
      node.loop.until_field !== undefined;
    if (!hasUntil) {
      ctx.addIssue({
        code: "custom",
        message: "loop requiere al menos uno de until|until_bash|until_field",
      });
    }
    if (node.loop.until_field !== undefined && node.output_format === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "until_field requiere que el nodo declare output_format",
      });
    }
  }
});

export const NodeSchema: z.ZodType<WorkflowNode> = NodeBodySchema;

export const WorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  version: z.string().optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  interactive: z.boolean().default(false),
  mutates_checkout: z.boolean().default(true),
  tags: z.array(z.string().min(1)).default([]),
  worktree: z.object({ enabled: z.boolean().default(true) }).optional(),
  inputs: z.record(z.string(), InputSpecSchema).default({}),
  returns: z.string().min(1).optional(),
  outcome_field: z.string().min(1).optional(),
  nodes: z.array(NodeSchema).min(1),
});

export type WorkflowDefinition = z.infer<typeof WorkflowSchema>;
export type NodeInputSpec = z.infer<typeof InputSpecSchema>;
export type TriggerRule = (typeof TRIGGER_RULES)[number];

/** Formatea errores de zod de forma compacta y legible para CLI/UI. */
export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `- ${where}: ${issue.message}`;
    })
    .join("\n");
}
