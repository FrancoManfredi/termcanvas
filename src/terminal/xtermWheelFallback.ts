import type { TerminalType } from "../types";

export type XtermWheelFallbackDecision = "xterm" | "up" | "down";

export type XtermWheelFallbackState = {
  terminalType: TerminalType;
  activeBuffer: "normal" | "alternate" | null;
  viewport: { scrollHeight: number; clientHeight: number } | null;
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
  mouseEventsEnabled: boolean;
  liveInputAvailable: boolean;
};

export function decideXtermWheelFallback(
  state: XtermWheelFallbackState,
): XtermWheelFallbackDecision {
  if (state.terminalType !== "opencode") return "xterm";
  if (state.ctrlKey || state.metaKey) return "xterm";
  if (state.deltaY === 0) return "xterm";
  if (state.mouseEventsEnabled) return "xterm";
  if (!state.liveInputAvailable || state.activeBuffer !== "alternate") {
    return "xterm";
  }
  if (!state.viewport || state.viewport.scrollHeight > state.viewport.clientHeight) {
    return "xterm";
  }
  return state.deltaY < 0 ? "up" : "down";
}
