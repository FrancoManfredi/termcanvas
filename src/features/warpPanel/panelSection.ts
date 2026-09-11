import type { NavSection } from "./types";

/**
 * Persisted active-section (item 2): the panel section survives transitions
 * and remounts exactly like the rest of the warp UI state (`warp-panel-active`
 * in `warpPanelStore.ts`, `warp-kanban-status-overrides-v1` in
 * `adapters/liveIssues.ts`). A render throw on the review→awaiting path must
 * never read as "the panel restarted on Issues": even when a remount is
 * inevitable (root boundary, reload), the section restores instead of falling
 * back to the `"issues"` default. Versioned + validated — junk degrades to
 * `"issues"`, never throws. Pure, ESM, zero React/CSS imports (offline-testable).
 */

export const WARP_PANEL_SECTION_STORAGE_KEY = "warp-panel-section-v1";

const VALID_PANEL_SECTIONS: readonly NavSection[] = [
  "issues",
  "activity",
  "agents",
  "context",
  "diagnostic",
];

export function isValidPanelSection(value: unknown): value is NavSection {
  try {
    return (
      typeof value === "string" &&
      (VALID_PANEL_SECTIONS as readonly string[]).includes(value)
    );
  } catch {
    return false;
  }
}

export function loadPersistedPanelSection(): NavSection {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return "issues";
    }
    const raw = window.localStorage.getItem(WARP_PANEL_SECTION_STORAGE_KEY);
    if (typeof raw !== "string" || raw === "") return "issues";
    const trimmed = raw.trim();
    return isValidPanelSection(trimmed) ? trimmed : "issues";
  } catch {
    return "issues";
  }
}

export function persistPanelSection(section: NavSection): void {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    if (!isValidPanelSection(section)) return;
    window.localStorage.setItem(WARP_PANEL_SECTION_STORAGE_KEY, section);
  } catch {
    // Storage failure (private mode, quota) never breaks the panel.
  }
}

/**
 * Factory poll gate per section (perf Ola 1).
 *
 * Agents is config-only (no live jobs needed): pausing the shared 2.5s
 * `useWorkItemsPolling` loop there stops the shell re-render storm while
 * typing in AgentConfig (user-approved: up to ~10s stale is fine).
 * Every other section keeps the live poll. Pure, offline-testable.
 */
export function shouldEnableFactoryPoll(section: NavSection): boolean {
  try {
    return section !== "agents";
  } catch {
    return true;
  }
}
