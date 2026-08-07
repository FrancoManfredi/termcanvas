import { create } from "zustand";
import { useWorkspaceStore } from "./workspaceStore";

export interface IssueNodeData {
  issueId: string;
  projectId: string;
  worktreeId: string;
  issueNumber: number;
  title: string;
  body: string;
  url: string;
  labels: { name: string; color?: string }[];
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface PersistedIssueNode extends IssueNodeData {
  x: number;
  y: number;
}

function markDirty() {
  useWorkspaceStore.getState().markDirty();
}

interface IssueStore {
  issues: Map<number, IssueNodeData>;
  issueVersion: number;

  addIssue: (issue: IssueNodeData) => void;
  updateIssue: (issueNumber: number, patch: Partial<IssueNodeData>) => void;
  removeIssue: (issueNumber: number) => void;
  hasIssue: (issueNumber: number) => boolean;
  getAllIssues: () => IssueNodeData[];
  getIssue: (issueNumber: number) => IssueNodeData | undefined;
  updateIssuePosition: (issueNumber: number, x: number, y: number) => void;
  applyPackedLayout: (positions: Map<number, { x: number; y: number }>) => void;
  clearIssues: () => void;
  hydrateIssues: (issues: IssueNodeData[]) => void;
}

export const useIssueStore = create<IssueStore>((set, get) => ({
  issues: new Map(),
  issueVersion: 0,

  addIssue: (issue) => {
    const { issues, issueVersion } = get();
    if (issues.has(issue.issueNumber)) return;
    const next = new Map(issues);
    next.set(issue.issueNumber, issue);
    set({ issues: next, issueVersion: issueVersion + 1 });
    console.log(`[issueStore] addIssue #${issue.issueNumber}, total=${next.size}, version=${issueVersion + 1}`);
    markDirty();
  },

  updateIssue: (issueNumber, patch) => {
    const { issues, issueVersion } = get();
    const existing = issues.get(issueNumber);
    if (!existing) return;
    const next = new Map(issues);
    next.set(issueNumber, { ...existing, ...patch });
    set({ issues: next, issueVersion: issueVersion + 1 });
    console.log(`[issueStore] updateIssue #${issueNumber}, version=${issueVersion + 1}`);
    markDirty();
  },

  removeIssue: (issueNumber) => {
    const { issues, issueVersion } = get();
    if (!issues.has(issueNumber)) return;
    const next = new Map(issues);
    next.delete(issueNumber);
    set({ issues: next, issueVersion: issueVersion + 1 });
    console.log(`[issueStore] removeIssue #${issueNumber}, total=${next.size}, version=${issueVersion + 1}`);
    markDirty();
  },

  hasIssue: (issueNumber) => {
    return get().issues.has(issueNumber);
  },

  getAllIssues: () => {
    return Array.from(get().issues.values());
  },

  getIssue: (issueNumber) => {
    return get().issues.get(issueNumber);
  },

  updateIssuePosition: (_issueNumber, _x, _y) => {
    // Position is stored on the React Flow node, not in the issue store.
    // This method exists for interface completeness; the persistence layer
    // reads positions from the canvas node state, not from here.
  },

  applyPackedLayout: (positions) => {
    const { issues, issueVersion } = get();
    const next = new Map(issues);
    let changed = false;
    for (const [issueNumber, pos] of positions) {
      const existing = next.get(issueNumber);
      if (existing && (existing.x !== pos.x || existing.y !== pos.y)) {
        next.set(issueNumber, { ...existing, x: pos.x, y: pos.y });
        changed = true;
      }
    }
    if (!changed) return;
    set({ issues: next, issueVersion: issueVersion + 1 });
    markDirty();
  },

  clearIssues: () => {
    const { issueVersion } = get();
    set({ issues: new Map(), issueVersion: issueVersion + 1 });
    console.log(`[issueStore] clearIssues, version=${issueVersion + 1}`);
    markDirty();
  },

  hydrateIssues: (issues) => {
    const { issueVersion } = get();
    const next = new Map<number, IssueNodeData>();
    for (const issue of issues) {
      next.set(issue.issueNumber, issue);
    }
    set({ issues: next, issueVersion: issueVersion + 1 });
    console.log(`[issueStore] hydrateIssues count=${issues.length}, version=${issueVersion + 1}`);
  },
}));
