import { useEffect, useRef } from "react";
import {
  attachTerminalContainer,
  detachTerminalContainer,
  fitTerminalRuntime,
  focusTerminalRuntime,
} from "../terminal/terminalRuntimeStore.ts";

// Panel de terminal de la pantalla de Planificación. Reutiliza el MISMO
// renderer interactivo que el canvas: el runtime es headless (no hay tile
// en la escena) pero su instancia de xterm se atachea a este contenedor,
// así el usuario tiene wheel, selección/copy y scroll del xterm nativo
// (exactamente lo que ya funciona en los tiles del canvas), en lugar del
// renderer wterm sin interacción que se probó antes.
//
// El runtime lo crea planningSession.ts con ensureTerminalRuntime y se
// destruye cuando termina la sesión (destroyTerminalRuntime); el pane solo
// vive mientras la fase "running" esté montada y atachea/destruye el
// renderer en sincronía con el contenedor.

interface PlannerTerminalPaneProps {
  terminalId: string;
}

export function PlannerTerminalPane({ terminalId }: PlannerTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    attachTerminalContainer(terminalId, container);
    return () => {
      detachTerminalContainer(terminalId, {
        caller: "PlannerTerminalPane",
        reason: "planner_pane_unmount",
      });
    };
  }, [terminalId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      fitTerminalRuntime(terminalId);
    });
    return () => cancelAnimationFrame(frame);
  }, [terminalId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let settledTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (settledTimer) clearTimeout(settledTimer);
      settledTimer = setTimeout(() => {
        settledTimer = null;
        requestAnimationFrame(() => {
          fitTerminalRuntime(terminalId);
        });
      }, 120);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (settledTimer) clearTimeout(settledTimer);
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 tc-xterm-host nopan nodrag nowheel"
      style={{ padding: 0, overflow: "hidden" }}
      onPointerDown={() => focusTerminalRuntime(terminalId)}
    />
  );
}