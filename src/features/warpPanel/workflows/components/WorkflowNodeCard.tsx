/**
 * Workflow node card — read-only cockpit card: phase accent (left bar in the
 * phase color), node title, kind chip and mono subtitle (agent model / body
 * type). Click selects the node for the inspector; nothing is editable.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { kindLabel } from "../derive";
import type { WorkflowFlowNode } from "../flowTypes";

function WorkflowNodeCardInner({ data, selected }: NodeProps<WorkflowFlowNode>) {
  return (
    <div
      className="wf-node"
      style={{
        width: 208,
        minHeight: 60,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 5,
        padding: "9px 11px 9px 13px",
        borderRadius: 6,
        border: `1px solid ${selected ? "var(--wp-accent)" : "var(--wp-border)"}`,
        background: selected ? "rgba(59,130,246,0.06)" : "var(--wp-bg-elevated)",
        boxShadow: selected ? "0 0 0 1px rgba(59,130,246,0.28)" : "none",
        cursor: "pointer",
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
      }}
    >
      <span aria-hidden="true" className="wf-node-accent" style={{ background: data.color }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--wp-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.node.id}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--wp-text-disabled)",
            flexShrink: 0,
          }}
        >
          {kindLabel(data.node.kind)}
        </span>
      </div>
      <div
        title={data.subtitle}
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "var(--wp-text-tertiary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.subtitle}
      </div>
      {/* Invisible anchors: React Flow needs handles to attach the edges
          (warning #008 + dropped edges otherwise). Not connectable. */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardInner);
