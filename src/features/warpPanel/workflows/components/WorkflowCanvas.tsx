/**
 * Workflow canvas stage — read-only React Flow view of a workflow.
 *
 * Nodes/edges/layout come from `resolveCanvas`; clicking selects a node/edge
 * for the inspector (selection lives in `WorkflowsPanel`). Navigation is
 * pan/zoom/fit only: no drag, no connections, no deletion, no context menu.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { nodeSubtitle, phaseColor, type ResolvedCanvas } from "../derive";
import type { AgentCatalogEntry, CanvasSelection, WorkflowDefinition } from "../types";
import type { CanvasFlowNode, WorkflowFlowEdge } from "../flowTypes";
import { WorkflowNodeCard } from "./WorkflowNodeCard";
import { WorkflowGroupBox } from "./WorkflowGroupBox";
import { WorkflowEdge } from "./WorkflowEdge";

interface WorkflowCanvasStageProps {
  def: WorkflowDefinition;
  resolved: ResolvedCanvas;
  agents: AgentCatalogEntry[];
  selection: CanvasSelection;
  onSelect: (selection: CanvasSelection) => void;
}

function buildFlow(resolved: ResolvedCanvas, agents: AgentCatalogEntry[]) {
  const nodes: CanvasFlowNode[] = [];
  for (const group of resolved.layout.groups) {
    nodes.push({
      id: `group:${group.id}`,
      type: "loopGroup",
      position: { x: group.x, y: group.y },
      data: {
        groupId: group.id,
        maxIterations: group.group.maxIterations,
        count: group.group.nodeIds.length,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: 0,
      // React Flow writes `pointer-events: all` inline on node wrappers; the
      // full-size group wrapper must not swallow hover/click on the edges and
      // nodes it visually contains.
      style: { width: group.width, height: group.height, pointerEvents: "none" },
    });
  }
  resolved.layout.nodes.forEach((positioned, index) => {
    nodes.push({
      id: positioned.id,
      type: "workflowNode",
      position: { x: positioned.x, y: positioned.y },
      data: {
        node: positioned.node,
        subtitle: nodeSubtitle(positioned.node, agents),
        color: phaseColor(index),
      },
      zIndex: 10,
    });
  });
  const edges: WorkflowFlowEdge[] = resolved.layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "workflowEdge",
    data: { kind: edge.kind },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#3a3a3a" },
  }));
  return { nodes, edges };
}

function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow<CanvasFlowNode, WorkflowFlowEdge>();
  return (
    <div className="wf-controls" role="group" aria-label="Controles del canvas">
      <button
        type="button"
        className="wf-control-btn"
        title="Acercar"
        aria-label="Acercar"
        onClick={() => void zoomIn({ duration: 160 })}
      >
        +
      </button>
      <button
        type="button"
        className="wf-control-btn"
        title="Alejar"
        aria-label="Alejar"
        onClick={() => void zoomOut({ duration: 160 })}
      >
        −
      </button>
      <button
        type="button"
        className="wf-control-btn"
        title="Ajustar vista"
        aria-label="Ajustar vista"
        onClick={() => void fitView({ duration: 220, padding: 0.22 })}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

function WorkflowCanvasInner({
  resolved,
  agents,
  selection,
  onSelect,
}: Omit<WorkflowCanvasStageProps, "def">) {
  const { fitView } = useReactFlow<CanvasFlowNode, WorkflowFlowEdge>();
  const flow = useMemo(() => buildFlow(resolved, agents), [resolved, agents]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowFlowEdge>(flow.edges);

  useEffect(() => {
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [flow, setNodes, setEdges]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: selection.type === "node" && selection.id === node.id,
      })),
    );
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        selected: selection.type === "edge" && selection.id === edge.id,
      })),
    );
  }, [selection, setNodes, setEdges]);

  // One-shot fit AFTER custom nodes are measured: the `fitView` prop runs
  // with unmeasured nodes and clamps to minZoom (nodes rendered tiny at the
  // origin). `useNodesInitialized` flips true when dimensions exist.
  const nodesInitialized = useNodesInitialized();
  const didFitRef = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || didFitRef.current) return;
    didFitRef.current = true;
    void fitView({ padding: 0.22, maxZoom: 1 });
  }, [nodesInitialized, fitView]);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      workflowNode: WorkflowNodeCard as unknown as ComponentType<NodeProps>,
      loopGroup: WorkflowGroupBox as unknown as ComponentType<NodeProps>,
    }),
    [],
  );
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({ workflowEdge: WorkflowEdge }) as unknown as EdgeTypes,
    [],
  );

  const isEmpty = resolved.nodes.length === 0;

  return (
    <div className="wf-canvas" style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <ReactFlow<CanvasFlowNode, WorkflowFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => {
          if (node.type === "workflowNode") onSelect({ type: "node", id: node.id });
        }}
        onEdgeClick={(_event, edge) => onSelect({ type: "edge", id: edge.id })}
        onPaneClick={() => onSelect({ type: "workflow" })}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--wp-border)" />
      </ReactFlow>
      <CanvasControls />
      {isEmpty && (
        <div className="wf-empty" role="status">
          <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 12 }}>
            Sin nodos en el canvas
          </span>
          <span style={{ fontSize: 11, color: "var(--wp-text-tertiary)" }}>
            Este workflow no declara nodos en su YAML.
          </span>
        </div>
      )}
    </div>
  );
}

export function WorkflowCanvasStage(props: WorkflowCanvasStageProps) {
  return (
    <ReactFlowProvider key={props.def.name}>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
