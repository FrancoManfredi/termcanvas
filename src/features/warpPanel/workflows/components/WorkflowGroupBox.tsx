/**
 * Loop group box — dashed container wrapping the members of a `loop_group`
 * (label: iteration budget + member count). Non-interactive background layer:
 * the box bounds derive from its members' positions.
 */

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { LoopGroupFlowNode } from "../flowTypes";

function WorkflowGroupBoxInner({ data }: NodeProps<LoopGroupFlowNode>) {
  return (
    <div
      className="wf-loop-group"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        border: "1px dashed var(--wp-border)",
        borderRadius: 8,
        background: "rgba(168,85,247,0.03)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 9,
          left: 13,
          right: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-await-review)",
            flexShrink: 0,
          }}
        >
          loop ×{data.maxIterations}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            color: "var(--wp-text-disabled)",
            flexShrink: 0,
          }}
        >
          {data.count} nodos
        </span>
      </div>
    </div>
  );
}

export const WorkflowGroupBox = memo(WorkflowGroupBoxInner);
