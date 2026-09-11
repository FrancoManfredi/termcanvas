import { PlaygroundLeftPanel } from "./PlaygroundLeftPanel";
import { PlaygroundRightPanel } from "./PlaygroundRightPanel";

/**
 * Factory Playground — standalone space outside the canvas.
 * Rendered by App.tsx when playgroundStore.playgroundActive is true.
 * Does NOT mount xyflow/canvas at all (saves resources).
 * Layout: full-height flex with collapsible left + scrollable right,
 * sitting under the 44px Toolbar (top:44).
 */
export function FactoryPlayground() {
  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-30 flex bg-[var(--bg)]"
      style={{ top: 44 }}
      role="main"
      aria-label="Factory Playground — espacio de pruebas por F"
    >
      <PlaygroundLeftPanel />
      <PlaygroundRightPanel />
    </div>
  );
}
