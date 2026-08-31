import { create } from "zustand";

/*
 * Visibility filter for issue cards, shared by the canvas projection and the
 * left-panel issue list.
 *
 * The active filter is a UI-level preference, so it is persisted to
 * localStorage the same way the theme is. Per-issue visibility overrides (if
 * we ever need "keep this closed card on canvas") should live inside the
 * persisted issue record instead — this store only owns the global filter.
 */

export type IssueVisibilityFilter = "open" | "closed" | "all";

const STORAGE_KEY = "termcanvas-issues-filter";
const LEGACY_KEYS = ["termcanvas-issues-show-closed"];

const FILTERS: IssueVisibilityFilter[] = ["open", "closed", "all"];

function isFilter(value: string | null): value is IssueVisibilityFilter {
  return value !== null && FILTERS.includes(value as IssueVisibilityFilter);
}

function loadFilter(): IssueVisibilityFilter {
  try {
    // Migrate the old boolean toggle: "1" meant closed cards were visible.
    const legacy = localStorage.getItem(LEGACY_KEYS[0]);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_KEYS[0]);
      return legacy === "1" ? "all" : "open";
    }
    const value = localStorage.getItem(STORAGE_KEY);
    return isFilter(value) ? value : "open";
  } catch {
    return "open";
  }
}

interface IssueVisibilityStore {
  filter: IssueVisibilityFilter;
  setFilter: (filter: IssueVisibilityFilter) => void;
}

export const useIssueVisibilityStore = create<IssueVisibilityStore>(
  (set, get) => ({
    filter: loadFilter(),
    setFilter: (filter) => {
      try {
        localStorage.setItem(STORAGE_KEY, filter);
      } catch {}
      if (get().filter !== filter) set({ filter });
    },
  }),
);