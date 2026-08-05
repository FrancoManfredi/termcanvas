import { create } from "zustand";

interface IssueResolveStore {
  resolvingIssueNumber: number | null;
  resolveHandler: ((issueNumber: number) => void) | null;
  registerResolveHandler: (
    handler: ((issueNumber: number) => void) | null,
  ) => void;
  setResolvingIssueNumber: (issueNumber: number | null) => void;
}

export const useIssueResolveStore = create<IssueResolveStore>((set) => ({
  resolvingIssueNumber: null,
  resolveHandler: null,
  registerResolveHandler: (resolveHandler) => set({ resolveHandler }),
  setResolvingIssueNumber: (resolvingIssueNumber) =>
    set({ resolvingIssueNumber }),
}));
