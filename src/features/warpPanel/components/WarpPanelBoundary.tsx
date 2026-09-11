import { Component, type ErrorInfo, type ReactNode } from "react";
import { loadPersistedPanelSection } from "../panelSection";
import { recordWarpCrash } from "../warpCrashRecorder";

interface WarpPanelBoundaryProps {
  children: ReactNode;
}

interface WarpPanelBoundaryState {
  hasError: boolean;
  message: string | null;
}

/**
 * Panel-scoped error boundary for the Warp panel content.
 *
 * Root cause it contains (item 2): `src/main.tsx` mounts a SINGLE root
 * `ErrorBoundary` around the whole `App`, whose only recovery is
 * `window.location.reload()`. Any render throw inside the panel — e.g. a
 * store slice arriving in an unexpected shape exactly on the
 * review→awaiting transition (verdict + labels land, then a forced PR
 * re-lookup flips `prsByIssue[n]` through `"loading"`) — used to replace
 * the ENTIRE app with the "Something went wrong" screen, which reads as
 * "the app reloaded". There is no programmatic reload anywhere on that
 * path (the only `location.reload()` calls in `src/` are the root
 * boundary's manual button and an unrelated FactoryLab popup refresh).
 *
 * This boundary scopes the blast radius to the panel: the canvas, toolbar
 * and toasts stay alive, and recovery is a state transition (reset the
 * flag and re-render — the 2.5s poll + store subscriptions repaint the
 * rows), never a reload. The render paths themselves are additionally
 * hardened with defensive coercion, so this is the backstop, not the fix.
 */
export class WarpPanelBoundary extends Component<
  WarpPanelBoundaryProps,
  WarpPanelBoundaryState
> {
  state: WarpPanelBoundaryState = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): WarpPanelBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      "[WarpPanelBoundary] warp panel crashed, canvas stays alive:",
      error,
      info.componentStack,
    );
    // Same crash ring the shell recorder writes (DevTools → Application →
    // Local Storage → `warp-last-crash`): a boundary-caught render throw
    // may never reach the window handler, so record it here too. The
    // section reads from the persisted value (the shell ref is out of
    // reach here). Never throws.
    try {
      let section = "unknown";
      try {
        section = loadPersistedPanelSection();
      } catch {
        section = "unknown";
      }
      recordWarpCrash(error, section);
    } catch {
      // Recording must never break the boundary.
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, message: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--wp-bg)",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--wp-text-primary)",
              margin: "0 0 8px",
            }}
          >
            The panel hit a render error
          </p>
          <p
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 11,
              color: "var(--wp-text-disabled)",
              lineHeight: 1.6,
              margin: "0 0 16px",
              overflowWrap: "break-word",
            }}
          >
            {this.state.message ?? "Unknown error"} — your canvas and work
            are untouched.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              height: 34,
              padding: "0 18px",
              borderRadius: 6,
              border: "1px solid var(--wp-border)",
              background: "var(--wp-bg-elevated)",
              color: "var(--wp-text-primary)",
              fontFamily: "var(--wp-font-sans)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry panel
          </button>
        </div>
      </div>
    );
  }
}
