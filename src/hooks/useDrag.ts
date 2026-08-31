import { useRef, useCallback } from "react";
import { useCanvasStore } from "../stores/canvasStore";

interface DragState {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

export function useDrag(
  x: number,
  y: number,
  onMove: (x: number, y: number) => void,
) {
  const dragRef = useRef<DragState | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      const scale = useCanvasStore.getState().viewport.scale;

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: x,
        origY: y,
      };

      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const deltaX = (ev.clientX - dragRef.current.startX) / scale;
        const deltaY = (ev.clientY - dragRef.current.startY) / scale;
        onMove(dragRef.current.origX + deltaX, dragRef.current.origY + deltaY);
      };

      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [x, y, onMove],
  );

  return handleMouseDown;
}
