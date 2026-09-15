/**
 * Workflows canvas — pure derivation layer (read-only view).
 *
 * Everything the canvas shows is computed from the workflow definition alone
 * (YAML-shaped, normalized by `normalizeWorkflowDef`): nodes, `depends_on` /
 * loop edges and a deterministic layered layout. No DOM, no React, no network,
 * no edit state — `tests/warp-workflows-canvas.test.ts` exercises it offline.
 *
 * Layout model: dependency units (a top-level node, or a loop group collapsed
 * to its container) are assigned to DAG layers left→right; rows stack inside
 * a layer. A loop group box wraps its members (bounds derived from their
 * positions), so the group is always drawn around the nodes it contains.
 */

import type {
  AgentCatalogEntry,
  WorkflowCanvasEdge,
  WorkflowDefinition,
  WorkflowLoopDef,
  WorkflowNode,
  WorkflowNodeKind,
} from "./types";

/* ─── Raw → domain normalization ──────────────────────────────────────── */

export interface RawWorkflowMeta {
  scope: string;
  filePath: string;
}

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function labelOfDefault(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(", ")}]`;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function normalizeNode(record: RawRecord, groupId: string | undefined): WorkflowNode | null {
  const id = asString(record.id)?.trim();
  if (!id) return null;
  const approval = asRecord(record.approval);
  const fanOut = asRecord(record.fan_out);
  const wait = asRecord(record.wait);
  const subWorkflow = asString(record.workflow);
  const agent = asString(record.agent);
  const command = asString(record.command);
  const kind: WorkflowNodeKind = approval
    ? "approval"
    : subWorkflow
      ? "workflow"
      : agent
        ? "agent"
        : command
          ? "command"
          : wait
            ? "wait"
            : record.bash !== undefined
              ? "bash"
              : record.script !== undefined
                ? "script"
                : record.cancel !== undefined
                  ? "cancel"
                  : "unknown";
  const node: WorkflowNode = { id, kind, dependsOn: asStringArray(record.depends_on) };
  if (groupId !== undefined) node.groupId = groupId;
  if (agent !== undefined) node.agent = agent;
  if (command !== undefined) node.command = command;
  if (subWorkflow !== undefined) node.subWorkflow = subWorkflow;
  const prompt = asString(record.prompt);
  if (prompt !== undefined) node.prompt = prompt;
  const outputType = asString(record.output_type);
  if (outputType !== undefined) node.outputType = outputType;
  const outputFormat = asRecord(record.output_format);
  if (outputFormat !== null) node.outputFormat = outputFormat;
  if (approval !== null) {
    const onReject = asRecord(approval.on_reject);
    node.approval = {
      message: asString(approval.message) ?? "",
      captureResponse: approval.capture_response === true,
      maxAttempts: asNumber(onReject?.max_attempts, 1),
    };
    const rejectPrompt = asString(onReject?.prompt);
    if (rejectPrompt !== undefined) node.approval.rejectPrompt = rejectPrompt;
  }
  if (fanOut !== null) {
    node.fanOut = {
      items: asString(fanOut.items) ?? "",
      as: asString(fanOut.as) ?? "item",
      maxParallel: asNumber(fanOut.max_parallel, 1),
      join: asString(fanOut.join) ?? "all_success",
    };
  }
  if (wait !== null) node.wait = { event: asString(wait.event) ?? "" };
  return node;
}

/**
 * YAML-shaped record → canvas domain. Tolerant by design: unknown fields are
 * ignored, malformed nodes are skipped, `null` only when there is no usable
 * name. The future live adapter feeds `WorkflowDefinitionInfo.def` here.
 */
export function normalizeWorkflowDef(
  raw: unknown,
  meta: RawWorkflowMeta,
): WorkflowDefinition | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const name = asString(record.name)?.trim();
  if (!name) return null;
  const nodes: WorkflowNode[] = [];
  const groups: WorkflowLoopDef[] = [];
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  for (const rawNode of rawNodes) {
    const nodeRecord = asRecord(rawNode);
    if (nodeRecord === null) continue;
    const id = asString(nodeRecord.id)?.trim();
    if (!id) continue;
    const loop = asRecord(nodeRecord.loop_group);
    if (loop !== null) {
      const children: WorkflowNode[] = [];
      const rawChildren = Array.isArray(loop.nodes) ? loop.nodes : [];
      for (const rawChild of rawChildren) {
        const childRecord = asRecord(rawChild);
        if (childRecord === null) continue;
        const child = normalizeNode(childRecord, undefined);
        if (child !== null) children.push(child);
      }
      groups.push({
        id,
        label: id,
        maxIterations: asNumber(loop.max_iterations, 1),
        until: asString(loop.until) ?? "",
        nodeIds: children.map((child) => child.id),
        externalDeps: asStringArray(nodeRecord.depends_on),
      });
      for (const child of children) nodes.push({ ...child, groupId: id });
      continue;
    }
    const node = normalizeNode(nodeRecord, undefined);
    if (node !== null) nodes.push(node);
  }
  const inputsRecord = asRecord(record.inputs);
  const inputs = inputsRecord
    ? Object.entries(inputsRecord).map(([inputName, spec]) => {
        const specRecord = asRecord(spec);
        const input: WorkflowDefinition["inputs"][number] = {
          name: inputName,
          required: specRecord?.required === true,
        };
        const description = asString(specRecord?.description);
        if (description !== undefined) input.description = description;
        if (specRecord && "default" in specRecord && specRecord.default !== undefined) {
          input.defaultLabel = labelOfDefault(specRecord.default);
        }
        return input;
      })
    : [];
  const definition: WorkflowDefinition = {
    name,
    description: asString(record.description) ?? "",
    tags: asStringArray(record.tags),
    scope: meta.scope,
    filePath: meta.filePath,
    inputs,
    nodes,
    groups,
  };
  const returns = asString(record.returns);
  if (returns !== undefined) definition.returns = returns;
  const outcomeField = asString(record.outcome_field);
  if (outcomeField !== undefined) definition.outcomeField = outcomeField;
  return definition;
}

/* ─── Edges ───────────────────────────────────────────────────────────── */

function edgeIdFor(source: string, target: string): string {
  return `${source}->${target}`;
}

/**
 * `depends_on` edges plus loop-back edges (last child → first child, labeled
 * with the `until` expression). Deduplicated, dangling refs dropped.
 */
export function buildEdges(
  nodes: WorkflowNode[],
  groups: WorkflowLoopDef[],
): WorkflowCanvasEdge[] {
  const edges: WorkflowCanvasEdge[] = [];
  const ids = new Set(nodes.map((node) => node.id));
  const push = (
    source: string,
    target: string,
    kind: WorkflowCanvasEdge["kind"],
    label?: string,
  ): void => {
    if (!ids.has(source) || !ids.has(target) || source === target) return;
    const id = edgeIdFor(source, target);
    if (edges.some((edge) => edge.id === id)) return;
    edges.push(label !== undefined ? { id, source, target, kind, label } : { id, source, target, kind });
  };
  for (const node of nodes) {
    for (const dep of node.dependsOn) push(dep, node.id, "depends");
  }
  for (const group of groups) {
    const first = group.nodeIds[0];
    if (first === undefined) continue;
    const last = group.nodeIds[group.nodeIds.length - 1];
    for (const dep of group.externalDeps) push(dep, first, "depends");
    if (last !== undefined && last !== first) push(last, first, "loop", group.until);
  }
  return edges;
}

/* ─── Layout ──────────────────────────────────────────────────────────── */

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  node: WorkflowNode;
}

export interface PositionedGroup {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  group: WorkflowLoopDef;
}

export interface WorkflowLayout {
  nodes: PositionedNode[];
  groups: PositionedGroup[];
  edges: WorkflowCanvasEdge[];
  width: number;
  height: number;
}

export interface ResolvedCanvas {
  nodes: WorkflowNode[];
  groups: WorkflowLoopDef[];
  edges: WorkflowCanvasEdge[];
  layout: WorkflowLayout;
}

const NODE_WIDTH = 208;
const NODE_HEIGHT = 60;
const COL_GAP = 96;
const ROW_GAP = 26;
const UNIT_GAP = 12;
const INNER_GAP = 16;
const GROUP_PAD_TOP = 36;
const GROUP_PAD_X = 14;
const GROUP_PAD_BOTTOM = 14;
const ORIGIN_X = 48;
const ORIGIN_Y = 48;
const COL_STRIDE = NODE_WIDTH + COL_GAP;
const ROW_STRIDE = NODE_HEIGHT + ROW_GAP;

/** Topological layers over units; cycles fall back to a final layer. */
export function computeUnitLayers(
  unitIds: string[],
  edges: Array<{ source: string; target: string }>,
): Map<string, number> {
  const ids = new Set(unitIds);
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const incident = new Set<string>();
  for (const id of unitIds) {
    dependents.set(id, []);
    inDegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    dependents.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    incident.add(edge.source);
    incident.add(edge.target);
  }
  const layers = new Map<string, number>();
  const seen = new Set<string>();
  let frontier = unitIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  let depth = 0;
  while (frontier.length > 0) {
    for (const id of frontier) {
      layers.set(id, depth);
      seen.add(id);
    }
    const next: string[] = [];
    for (const id of frontier) {
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    frontier = next.filter((id) => !seen.has(id));
    depth += 1;
  }
  for (const id of unitIds) {
    if (!layers.has(id)) layers.set(id, depth);
  }
  // Detached units (no incident edges) land in their own trailing column:
  // unlinked nodes stay visible without inventing dependencies.
  if (incident.size > 0) {
    let maxLayer = 0;
    for (const [id, value] of layers) {
      if (incident.has(id)) maxLayer = Math.max(maxLayer, value);
    }
    for (const id of unitIds) {
      if (!incident.has(id)) layers.set(id, maxLayer + 1);
    }
  }
  return layers;
}

export function layoutWorkflow(
  nodes: WorkflowNode[],
  groups: WorkflowLoopDef[],
  edges: WorkflowCanvasEdge[],
): WorkflowLayout {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const unitOf = (nodeId: string): string => {
    const node = nodeById.get(nodeId);
    const groupId = node?.groupId;
    return groupId !== undefined && groupById.has(groupId) ? groupId : nodeId;
  };
  const unitOrder: string[] = [];
  const unitSeen = new Set<string>();
  for (const node of nodes) {
    const unit = unitOf(node.id);
    if (!unitSeen.has(unit)) {
      unitSeen.add(unit);
      unitOrder.push(unit);
    }
  }
  const layer = computeUnitLayers(
    unitOrder,
    edges.map((edge) => ({ source: unitOf(edge.source), target: unitOf(edge.target) })),
  );
  const rowCursor = new Map<number, number>();
  const base: Record<string, { x: number; y: number }> = {};
  for (const unit of unitOrder) {
    const column = layer.get(unit) ?? 0;
    const row = rowCursor.get(column) ?? 0;
    rowCursor.set(column, row + 1);
    const y = ORIGIN_Y + row * (ROW_STRIDE + UNIT_GAP);
    const group = groupById.get(unit);
    if (group !== undefined) {
      group.nodeIds.forEach((id, index) => {
        base[id] = {
          x: ORIGIN_X + column * COL_STRIDE + GROUP_PAD_X,
          y: y + GROUP_PAD_TOP + index * (NODE_HEIGHT + INNER_GAP),
        };
      });
    } else {
      base[unit] = { x: ORIGIN_X + column * COL_STRIDE, y };
    }
  }
  const positionedNodes: PositionedNode[] = nodes.map((node) => {
    const position = base[node.id] ?? { x: ORIGIN_X, y: ORIGIN_Y };
    return {
      id: node.id,
      x: position.x,
      y: position.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      node,
    };
  });
  const positionedGroups: PositionedGroup[] = [];
  for (const group of groups) {
    const members = positionedNodes.filter((node) => group.nodeIds.includes(node.id));
    const first = members[0];
    if (first === undefined) continue;
    let minX = first.x;
    let minY = first.y;
    let maxX = first.x + first.width;
    let maxY = first.y + first.height;
    for (const member of members) {
      minX = Math.min(minX, member.x);
      minY = Math.min(minY, member.y);
      maxX = Math.max(maxX, member.x + member.width);
      maxY = Math.max(maxY, member.y + member.height);
    }
    positionedGroups.push({
      id: group.id,
      x: minX - GROUP_PAD_X,
      y: minY - GROUP_PAD_TOP,
      width: maxX - minX + GROUP_PAD_X * 2,
      height: maxY - minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
      group,
    });
  }
  const width =
    Math.max(
      ORIGIN_X + NODE_WIDTH * 2,
      ...positionedNodes.map((node) => node.x + node.width),
      ...positionedGroups.map((group) => group.x + group.width),
    ) + 64;
  const height =
    Math.max(
      ORIGIN_Y + NODE_HEIGHT * 3,
      ...positionedNodes.map((node) => node.y + node.height),
      ...positionedGroups.map((group) => group.y + group.height),
    ) + 64;
  return { nodes: positionedNodes, groups: positionedGroups, edges, width, height };
}

export function resolveCanvas(def: WorkflowDefinition): ResolvedCanvas {
  const edges = buildEdges(def.nodes, def.groups);
  const layout = layoutWorkflow(def.nodes, def.groups, edges);
  return { nodes: def.nodes, groups: def.groups, edges, layout };
}

/* ─── Presentation helpers ────────────────────────────────────────────── */

/**
 * Phase accent palette (read-only view): position in the workflow decides the
 * color, so the same phase keeps the same color across workflows. Deliberately
 * desaturated to sit on the near-black canvas next to the single blue accent.
 */
export const PHASE_COLORS: readonly string[] = [
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#34d399",
  "#22d3ee",
  "#facc15",
  "#f87171",
];

export function phaseColor(index: number): string {
  if (!Number.isFinite(index) || index < 0) return PHASE_COLORS[0];
  return PHASE_COLORS[Math.floor(index) % PHASE_COLORS.length];
}

export function displayNodeTitle(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function nodeSubtitle(node: WorkflowNode, agents: AgentCatalogEntry[]): string {
  const agent = node.agent !== undefined ? agents.find((entry) => entry.name === node.agent) : undefined;
  switch (node.kind) {
    case "agent":
      return agent?.model ?? node.agent ?? "agent";
    case "approval":
      return node.agent !== undefined ? `gate · ${node.agent}` : "human gate";
    case "workflow":
      return node.fanOut !== undefined
        ? `fan-out · ${node.subWorkflow ?? "workflow"}`
        : `workflow · ${node.subWorkflow ?? "?"}`;
    case "wait":
      return `wait · ${node.wait?.event ?? "event"}`;
    case "command":
      return node.command !== undefined ? `command · ${node.command}` : "command";
    case "bash":
      return "bash";
    case "script":
      return "script";
    case "cancel":
      return "cancel";
    default:
      return "node";
  }
}

export function kindLabel(kind: WorkflowNodeKind): string {
  switch (kind) {
    case "agent":
      return "agent";
    case "approval":
      return "gate";
    case "workflow":
      return "workflow";
    case "command":
      return "command";
    case "wait":
      return "wait";
    case "bash":
      return "bash";
    case "script":
      return "script";
    case "cancel":
      return "cancel";
    default:
      return "node";
  }
}
