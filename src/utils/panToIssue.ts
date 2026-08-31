import { useIssueStore } from "../stores/issueStore";
import { useCanvasStore } from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import {
  getCanvasRightInset,
  getCanvasLeftInset,
  clampCenterX,
} from "../canvas/viewportBounds";
import { clampScale } from "../canvas/viewportZoom";
import {
  setTrackSidebar,
  recomputeTileDimensions,
} from "../stores/tileDimensionsStore";
import { recordRenderDiagnostic } from "../terminal/renderDiagnostics";

interface PanToIssueOptions {
  immediate?: boolean;
  preserveScale?: boolean;
  duration?: number;
  easing?: (t: number) => number;
}

// The issue store keeps the initial placement (issue.x / issue.y) but
// React Flow owns the live position after the user drags a card, so the
// authoritative geometry has to be read from the rendered node DOM
// (`data-id="issue-<n>"`), like handleResolveIssue already does.
function measureIssueWorldRect(
  issueNumber: number,
  viewport: { x: number; y: number; scale: number },
  leftOffset: number,
): { x: number; y: number; w: number; h: number } | null {
  const el = document.querySelector(`[data-id="issue-${issueNumber}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const scale = viewport.scale;
  return {
    x: (rect.left - leftOffset - viewport.x) / scale,
    y: (rect.top - viewport.y) / scale,
    w: rect.width / scale,
    h: rect.height / scale,
  };
}

/**
 * Animate the canvas viewport to center on the given issue card.
 */
export function panToIssue(
  issueNumber: number,
  opts?: PanToIssueOptions,
): void {
  setTrackSidebar(true);
  recomputeTileDimensions();

  const issue = useIssueStore.getState().getIssue(issueNumber);
  if (!issue) {
    recordRenderDiagnostic({
      kind: "pan_to_issue_missing",
      issueNumber,
    });
    console.warn(`[panToIssue] issue #${issueNumber} not found`);
    return;
  }

  const canvasState = useCanvasStore.getState();
  const {
    rightPanelCollapsed,
    rightPanelWidth,
    leftPanelCollapsed,
    leftPanelWidth,
    viewport,
  } = canvasState;
  const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const leftOffset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    usePinStore.getState().openProjectPath !== null,
  );

  // Fall back to the stored placement (width 960 = the node's fixed style)
  // if the card has not rendered yet.
  const measured = measureIssueWorldRect(
    issueNumber,
    viewport,
    leftOffset,
  );
  const absX = measured?.x ?? issue.x;
  const absY = measured?.y ?? issue.y;
  const absW = measured?.w ?? 960;
  const absH = measured?.h ?? 200;

  const padding = 40;
  const topInset = 56;
  const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;

  const scale = opts?.preserveScale
    ? clampScale(viewport.scale)
    : clampScale(Math.min(viewW / absW, viewH / absH) * 0.9);

  const centerX = clampCenterX(absX, absW, scale, leftOffset, rightOffset);
  const centerY =
    -(absY + absH / 2) * scale + (topInset + window.innerHeight) / 2;

  recordRenderDiagnostic({
    kind: "pan_to_issue",
    issueNumber,
    data: {
      immediate: opts?.immediate ?? false,
      preserve_scale: opts?.preserveScale ?? false,
      measured_dom_rect: measured !== null,
      target_viewport: {
        scale,
        x: centerX,
        y: centerY,
      },
      card_rect: {
        height: absH,
        width: absW,
        x: absX,
        y: absY,
      },
    },
  });

  if (opts?.immediate) {
    useCanvasStore.getState().setViewport({ x: centerX, y: centerY, scale });
  } else {
    useCanvasStore.getState().animateTo(centerX, centerY, scale, {
      duration: opts?.duration,
      easing: opts?.easing,
    });
  }
}