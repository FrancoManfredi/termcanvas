/**
 * Workflow edge — static bezier. Read-only: no labels, no hover actions,
 * no removal.
 */

import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { WorkflowFlowEdge } from "../flowTypes";

function WorkflowEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<WorkflowFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.28,
  });
  const isLoop = data?.kind === "loop";
  const stroke = selected ? "var(--wp-accent)" : isLoop ? "rgba(168,85,247,0.55)" : "#333333";

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={18}
      style={{
        stroke,
        strokeWidth: selected ? 2 : 1.4,
        strokeDasharray: isLoop ? "6 5" : undefined,
      }}
    />
  );
}

export const WorkflowEdge = memo(WorkflowEdgeInner);
