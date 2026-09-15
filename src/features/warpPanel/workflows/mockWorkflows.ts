/**
 * Workflows canvas — mock dataset mirroring the bundled workflows.
 *
 * Values are copied from the real files (`factory/workflows/*\/workflow.yaml`,
 * `factory/agents/*\/agent.md`, `factory/runners/linux-build.yaml`), never
 * invented: node ids, gates and loop groups match the factory-default /
 * fix-issue / parallel-reviews definitions the engine actually executes.
 * The live adapter will feed the daemon instead of this module.
 */

import { normalizeWorkflowDef, type RawWorkflowMeta } from "./derive";
import type { AgentCatalogEntry, WorkflowDefinition } from "./types";

export const DEFAULT_WORKFLOW = "factory-default";

/* ─── Agents (factory/agents/*\/agent.md frontmatter) ─────────────────── */

export const MOCK_AGENTS: AgentCatalogEntry[] = [
  {
    name: "foreman",
    description:
      "Solo para decidir el camino de un pedido. Decide si una solicitud pasa a Building o necesita Triage.",
    agentType: "FOREMAN",
    model: "opencode-go/muse-spark-1.2-contributor",
    tools: [],
  },
  {
    name: "triage",
    description:
      "Clasifica el pedido entrante — tipo, preguntas bloqueantes y alcance mínimo para la spec.",
    agentType: "TRIAGE",
    model: "opencode-go/muse-spark-1.3-contributor",
    tools: ["read", "glob", "grep", "webfetch"],
  },
  {
    name: "spec",
    description:
      "Solo para escribir briefs. Escribe el brief con criterios de aceptación y archivos objetivo.",
    agentType: "SPEC",
    model: "opencode-go/muse-spark-1.2-contributor",
    tools: ["read", "glob", "grep", "webfetch"],
  },
  {
    name: "implement",
    description:
      "Solo para implementar cambios mínimos. Hace el cambio mínimo en el worktree que cumpla el prompt.",
    agentType: "IMPLEMENT",
    model: "opencode-go/muse-spark-1.2-contributor",
    tools: ["read", "write", "edit", "bash", "glob", "grep", "webfetch"],
  },
  {
    name: "review",
    description:
      "Solo para revisar cambios de código. Revisión adversarial de solo lectura en tres ejes.",
    agentType: "REVIEW",
    model: "auto-disjoint",
    tools: ["read", "glob", "grep", "webfetch"],
  },
];

/* ─── Runner (factory/runners/linux-build.yaml) ───────────────────────── */

export const MOCK_RUNNER = {
  name: "linux-build",
  isolation: "docker",
  image: "node:22-bookworm",
  vcpus: 4,
  memoryGb: 8,
  platform: "linux/x86_64",
};

/* ─── Workflow definitions (bundled YAMLs) ────────────────────────────── */

const FACTORY_DEFAULT_RAW: Record<string, unknown> = {
  name: "factory-default",
  description:
    "Pipeline local (triage → spec → aprobación → implement → verify → review con revisión iterativa)",
  tags: ["factory", "defaults", "routable"],
  inputs: {
    request: { required: true, description: "Qué hay que hacer (texto o URL de issue)" },
    workItemId: { description: "ID del work item (job) del daemon; contexto del run" },
    issue_ref: {
      default: "(sin issue vinculado)",
      description: "Dato mínimo del issue (#N — URL) para los mensajes",
    },
    issue_body: {
      default: "(sin cuerpo disponible)",
      description: "Cuerpo original del issue (ground truth; evita fetchear la URL)",
    },
  },
  returns: "build",
  outcome_field: "green",
  nodes: [
    { id: "triage", command: "triage", agent: "triage" },
    { id: "spec", depends_on: ["triage"], command: "spec", agent: "spec" },
    {
      id: "approve",
      depends_on: ["spec"],
      agent: "spec",
      approval: {
        message: "Aprobar la spec para pasar a implementación?\n\n$spec.output",
        capture_response: true,
        on_reject: {
          prompt:
            "Ajustá la spec según el rechazo humano y devolvé la spec corregida.\n\nRechazo: $REJECTION_REASON\nSpec actual: $spec.output",
          max_attempts: 2,
        },
      },
    },
    {
      id: "build",
      depends_on: ["approve"],
      loop_group: {
        max_iterations: 4,
        until: "$review.output.green == true",
        nodes: [
          { id: "implement", agent: "implement", command: "implement" },
          {
            id: "verify",
            depends_on: ["implement"],
            workflow: "verify-runner",
            output_type: "verify-evidence",
          },
          {
            id: "review",
            depends_on: ["verify"],
            agent: "review",
            command: "review",
            output_format: {
              type: "object",
              required: ["green", "findings"],
              properties: {
                green: { type: "boolean" },
                findings: { type: "array", items: { type: "object" } },
              },
            },
          },
        ],
      },
    },
  ],
};

const FIX_ISSUE_RAW: Record<string, unknown> = {
  name: "fix-issue",
  description: "Triaje, implementación y review en cadena sobre un issue (revisión iterativa)",
  tags: ["defaults", "routable"],
  inputs: {
    request: { required: true, description: "Qué hay que hacer (texto o URL de issue)" },
    issue_ref: {
      default: "(sin issue vinculado)",
      description: "Dato mínimo del issue (#N — URL) para los mensajes",
    },
    issue_body: {
      default: "(sin cuerpo disponible)",
      description: "Cuerpo original del issue (ground truth; evita fetchear la URL)",
    },
  },
  returns: "build",
  outcome_field: "green",
  nodes: [
    { id: "triage", agent: "triage" },
    {
      id: "build",
      depends_on: ["triage"],
      loop_group: {
        max_iterations: 4,
        until: "$review.output.green == true",
        nodes: [
          { id: "implement", agent: "implement" },
          {
            id: "verify",
            depends_on: ["implement"],
            workflow: "verify-runner",
            output_type: "verify-evidence",
          },
          {
            id: "review",
            depends_on: ["verify"],
            agent: "review",
            output_format: {
              type: "object",
              required: ["green", "findings"],
              properties: {
                green: { type: "boolean" },
                findings: { type: "array", items: { type: "object" } },
              },
            },
          },
        ],
      },
    },
  ],
};

const PARALLEL_REVIEWS_RAW: Record<string, unknown> = {
  name: "parallel-reviews",
  description: "Varios revisores en paralelo sobre el mismo diff, agregados en orden",
  tags: ["defaults", "review"],
  inputs: {
    diff: { default: "(sin diff provisto)" },
    lenses: { default: ["seguridad", "tests", "rendimiento"] },
  },
  returns: "reviews",
  nodes: [
    {
      id: "reviews",
      workflow: "review-lens",
      with: { diff: "$INPUTS.diff" },
      fan_out: {
        items: "$INPUTS.lenses",
        as: "lens",
        max_parallel: 3,
        join: "all_success",
      },
    },
  ],
};

export interface MockWorkflowEntry {
  raw: Record<string, unknown>;
  meta: RawWorkflowMeta;
}

export const MOCK_RAW_WORKFLOWS: MockWorkflowEntry[] = [
  {
    raw: FACTORY_DEFAULT_RAW,
    meta: { scope: "bundled", filePath: "factory/workflows/factory-default/workflow.yaml" },
  },
  {
    raw: FIX_ISSUE_RAW,
    meta: { scope: "bundled", filePath: "factory/workflows/fix-issue/workflow.yaml" },
  },
  {
    raw: PARALLEL_REVIEWS_RAW,
    meta: { scope: "bundled", filePath: "factory/workflows/parallel-reviews/workflow.yaml" },
  },
];

export const MOCK_WORKFLOW_DEFS: WorkflowDefinition[] = MOCK_RAW_WORKFLOWS.map(
  (entry) => normalizeWorkflowDef(entry.raw, entry.meta),
).filter((definition): definition is WorkflowDefinition => definition !== null);

