import { create } from "zustand";

/*
 * Shared state + handler registry for canvas issue syncing.
 *
 * The XyFlowCanvas owns the real fetch/place logic (it needs the flow
 * instance and the resolved worktree target). The left-panel empty
 * state and the canvas context menu both trigger it through the
 * registered handler, and both render the same "loading" label from
 * `isFetchingIssues`.
 */

interface IssueSyncStore {
  isFetchingIssues: boolean;
  fetchIssuesHandler: (() => Promise<void>) | null;
  setFetchingIssues: (value: boolean) => void;
  registerFetchIssuesHandler: (
    handler: (() => Promise<void>) | null,
  ) => void;
}

export const useIssueSyncStore = create<IssueSyncStore>((set) => ({
  isFetchingIssues: false,
  fetchIssuesHandler: null,
  setFetchingIssues: (isFetchingIssues) => set({ isFetchingIssues }),
  registerFetchIssuesHandler: (fetchIssuesHandler) =>
    set({ fetchIssuesHandler }),
}));
