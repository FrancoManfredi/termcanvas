import { Component, type ErrorInfo, type ReactNode } from "react";

interface HiddenCanvasBoundaryProps {
  children: ReactNode;
}

interface HiddenCanvasBoundaryState {
  hasError: boolean;
}

/**
 * Isolates the hidden canvas tree mounted while the Warp panel is active.
 *
 * The canvas tree touches the Electron host bridge (window.termcanvas) during
 * render and effects. On the web renderer the bridge does not exist, so a
 * pre-existing host crash can surface from the hidden tree. Without isolation
 * that error bubbles to the root ErrorBoundary and replaces the whole UI,
 * including the Warp panel.
 *
 * Fallback is intentionally null: the hidden tree is invisible, so there is
 * nothing to show, and the Warp panel must stay interactive. The error is
 * still reported via console.error for diagnostics.
 */
export class HiddenCanvasBoundary extends Component<
  HiddenCanvasBoundaryProps,
  HiddenCanvasBoundaryState
> {
  state: HiddenCanvasBoundaryState = { hasError: false };

  static getDerivedStateFromError(): HiddenCanvasBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      "[HiddenCanvasBoundary] hidden canvas crashed, keeping Warp panel alive:",
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
