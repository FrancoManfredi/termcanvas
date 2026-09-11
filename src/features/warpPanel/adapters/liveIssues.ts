import type {
  IssueLabel,
  KanbanGateStatus,
  KanbanIssue,
  KanbanPr,
  KanbanRelation,
  KanbanRelationKind,
  KanbanStatus,
  KanbanTimelineEvent,
} from "../types";
import type { IssuesAdapter } from "./types";
import type { IssueNodeData } from "../../../stores/issueStore";
import { useIssueStore } from "../../../stores/issueStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useWorkItemStore } from "../../../stores/workItemStore";
import {
  parseGitHubIssueRepo,
} from "./factoryIssueJobs";
import {
  findActiveFactoryJobForIssueIndexed,
  findCompletedFactoryJobForIssueIndexed,
  getFactoryJobIndex,
} from "./factoryJobIndex";
import {
  useIssueReviewStore,
  type ReviewVerdict,
} from "../../../stores/issueReviewStore";
import { useIssueResolveStore } from "../../../stores/issueResolveStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import { effectiveReviewLabel } from "../../../canvas/reviewVerdict";

/**
 * Live issues adapter — canvas stores are the ONLY data source.
 *
 * - No GitHub fetch here: the canvas already hydrates `useIssueStore` via
 *   fetchIssues, so this adapter is a thin read over in-memory state.
 * - No GitHub writes anywhere: `setIssueStatus` only records a UI-only
 *   override (persisted to a dedicated versioned localStorage key — see
 *   `KANBAN_STATUS_OVERRIDES_STORAGE_KEY`; never the daemon, never GitHub).
 * - `done` is NEVER invented: it requires real merge evidence (a linked PR
 *   whose GitHub state is MERGED, a bulk-merge run that reported the PR
 *   as merged, or a CLOSED issue state). A terminal factory `Complete`
 *   alone is NEVER done (DONE SOLO ON MERGE — explicit user order,
 *   B1 reverted): `Complete` + OPEN PR stays in-review via row 6, and
 *   `Complete` without a PR falls to backlog (honest, no signal invented).
 *   Anything else stays out of the Done column.
 *
 * ─── Derived status table (IssueNodeData + review/resolve stores → KanbanStatus)
 *
 * | #  | Condition (first match wins)                              | KanbanStatus  |
 * |----|-------------------------------------------------------------|---------------|
 * | 1  | UI override present (dropdown/drag pick, persisted UI-only) | override      |
 * | 2  | Linked PR state is MERGED, or PR reported merged by run    | done          |
 * | 2b | Issue state is CLOSED (real GitHub state, never inferred) | done          |
 * | 3  | Issue is reviewing / fixing / merging right now           | in-progress   |
 * | 4  | Issue is resolving a merge conflict right now             | in-progress   |
 * | 5  | Resolve flow active for the issue (worktree being built), | in-progress   |
 * |    | or a live factory job linked to the issue (`issueRef`     |               |
 * |    | match in the existing poll list — queued counts too)      |               |
 * | 6  | Review verdict recorded, or linked PR still OPEN           | in-review     |
 * |    | (a `Complete` job with an OPEN PR lands here — the PR is   |               |
 * |    | the reviewable evidence, never an invented merge-ready)    |               |
 * | 7  | None of the above (fresh canvas issue, no workflow state,  | backlog       |
 * |    | or a terminal `Complete` with no OPEN PR and no merge      |               |
 * |    | evidence — honest, nothing invented)                       |               |
 *
 * Notes:
 * - `ready` has no store signal (nothing distinguishes triaged-ready from
 *   untriaged), so it is reachable only via a session override (row 1).
 * - A CLOSED-but-unmerged PR is not evidence of completion → falls through
 *   to rows 2b–7 like any other issue. A CLOSED *issue* state, in contrast,
 *   IS completion evidence (row 2b): it comes straight from GitHub's
 *   `state` field via the canvas node, never inferred.
 * - KanbanIssue fields with no canvas source stay honest: `author` is ""
 *   when the node predates author hydration, `openedAgo` is "",
 *   `activity` is [] (never fabricated).
 * - `repoName` derives from the last path segment of `projectId`.
 * - `projectName` resolves via `readProjectName` (default: the project
 *   store `ProjectData.name` for `projectId`). Opaque project ids (e.g.
 *   "1788190021330-3") stay out of the visible label — components prefer
 *   `projectName` and the URL owner/repo slug over them.
 * - `listIssues` returns cards sorted by issue number, descending.
 */

/** Minimal linked-PR shape this adapter needs (subset of LinkedPr). */
export interface LiveLinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
}

/**
 * Normalized workflow snapshot. The default reader builds it from
 * `useIssueReviewStore` (+ `useIssueGateStore` for the cheap gate slice);
 * tests inject it directly (no zustand needed).
 */
export interface LiveReviewSnapshot {
  /** Primary linked PR per issue (null/absent = none; "loading" normalized away). */
  primaryPrByIssue: Record<number, LiveLinkedPr | null>;
  verdictByIssue: Record<number, string | null>;
  reviewingIssueNumber: number | null;
  fixingIssueNumber: number | null;
  mergingIssueNumber: number | null;
  resolvingConflictIssueNumber: number | null;
  /** PR numbers the bulk-merge run reported as merged. */
  mergedPrNumbers: readonly number[];
  /** Every open PR per issue (multi-PR actions). Absent = unknown. */
  openPrsByIssue?: Record<number, LiveLinkedPr[]>;
  /** Per-PR verdicts for multi-PR issues. */
  verdictByPr?: Record<number, Record<number, string | null>>;
  /** Raw cycle labels per PR (persisted source of truth). */
  labelsByPr?: Record<number, Record<number, string[]>>;
  /** Raw cycle labels per issue (primary-PR fallback). */
  labelsByIssue?: Record<number, string[]>;
  /** Merge-conflict flag per PR. */
  conflictByPr?: Record<number, Record<number, boolean>>;
  /**
   * Cheap gate slice per PR (status + report path only). Reading the store
   * is free; the report *content* still loads on demand in the drawer via
   * the same `fs.readFile` bridge the canvas card uses.
   */
  gateByPr?: Record<number, Record<number, LiveGateSnapshot>>;
}

/** Minimal gate state the adapter needs (subset of IssueGateState). */
export interface LiveGateSnapshot {
  status: string;
  reportPath: string | null;
}

/** Store readers. Default = live zustand `getState()`; tests inject fakes. */
export interface LiveIssuesDeps {
  readIssues: () => IssueNodeData[];
  readReview: () => LiveReviewSnapshot;
  readResolvingIssueNumber: () => number | null;
  /**
   * Existing factory poll list for the resolve derivation (matched by
   * `issueRef`, repo-scoped per node URL — the SAME shared helper the
   * Activity adapter uses, never duplicated). Default reads the
   * `useWorkItemStore` items populated by the shared `useWorkItemsPolling`
   * 2.5s loop (owned by whichever shell is mounted — zero new polls here).
   * Empty when the poll never ran: cards simply show no factory work
   * (honest, never invented).
   */
  readFactoryJobs: () => unknown[];
  /**
   * Human project name for a canvas project id. Default reads the project
   * store (`ProjectData.name`); absent/unknown ids yield undefined (never
   * invented — callers fall back to the URL slug / repoName).
   */
  readProjectName: (projectId: string) => string | undefined;
  /**
   * Override persistence seam (UI-only localStorage by default).
   * Tests inject fakes; the defaults (`loadPersistedStatusOverrides` /
   * `savePersistedStatusOverrides`) never throw and never touch the
   * network, the daemon, or GitHub.
   */
  loadStatusOverrides?: () => Map<number, KanbanStatus>;
  saveStatusOverrides?: (
    overrides: ReadonlyMap<number, KanbanStatus>,
  ) => void;
}

function defaultDeps(): LiveIssuesDeps {
  return {
    readIssues: () => useIssueStore.getState().getAllIssues(),
    readReview: () => {
      const s = useIssueReviewStore.getState();
      const primaryPrByIssue: Record<number, LiveLinkedPr | null> = {};
      // Row-isolation hardening (item 2): every store slice below arrives
      // from async lookups / persisted hydration and may be undefined or a
      // wrong-type payload at the exact review→awaiting transition. A bare
      // `Object.entries(undefined)` throws mid-render in the shell (outside
      // `WarpPanelBoundary`) and reads as a black-screen + reset to the
      // default section — so each slice degrades to honest-empty here.
      // Evidence: live `liveIssues.ts:167,180,185,194` vs the guarded twin
      // in `liveActivity.ts:153,164,173,186` (`?? {}`).
      try {
        const prsByIssue =
          s !== null &&
          typeof s === "object" &&
          (s as unknown as Record<string, unknown>).prsByIssue !== null &&
          typeof (s as unknown as Record<string, unknown>).prsByIssue === "object" &&
          !Array.isArray((s as unknown as Record<string, unknown>).prsByIssue)
            ? ((s as unknown as Record<string, unknown>).prsByIssue as Record<string, unknown>)
            : {};
        for (const [key, value] of Object.entries(prsByIssue)) {
          try {
            if (value !== null && value !== "loading") {
              const rec = value as Record<string, unknown>;
              if (
                rec === null ||
                typeof rec !== "object" ||
                typeof rec.number !== "number" ||
                !Number.isFinite(rec.number)
              ) {
                continue;
              }
              primaryPrByIssue[Number(key)] = {
                number: rec.number as number,
                title: typeof rec.title === "string" ? rec.title : "",
                url: typeof rec.url === "string" ? rec.url : "",
                state: typeof rec.state === "string" ? rec.state : "",
              };
            }
          } catch {
            // One poisoned PR entry never breaks the snapshot.
          }
        }
      } catch {
        // Degrades to no primary PRs (honest-empty).
      }
      const mergedPrNumbers: number[] = [];
      try {
        const progress = s !== null && typeof s === "object"
          ? (s as unknown as Record<string, unknown>).mergeProgress
          : null;
        if (progress !== null && typeof progress === "object" && !Array.isArray(progress)) {
          const statusByPr = (progress as Record<string, unknown>).statusByPr;
          if (statusByPr !== null && typeof statusByPr === "object" && !Array.isArray(statusByPr)) {
            for (const [pr, status] of Object.entries(statusByPr as Record<string, unknown>)) {
              if (status === "merged") mergedPrNumbers.push(Number(pr));
            }
          }
        }
      } catch {
        // Degrades to no merged numbers (honest-empty).
      }
      const openPrsByIssue: Record<number, LiveLinkedPr[]> = {};
      try {
        const rawOpen =
          s !== null && typeof s === "object"
            ? (s as unknown as Record<string, unknown>).openPrsByIssue
            : undefined;
        const openMap =
          rawOpen !== null && typeof rawOpen === "object" && !Array.isArray(rawOpen)
            ? (rawOpen as Record<string, unknown>)
            : {};
        for (const [key, prs] of Object.entries(openMap)) {
          try {
            if (!Array.isArray(prs)) {
              openPrsByIssue[Number(key)] = [];
              continue;
            }
            openPrsByIssue[Number(key)] = (prs as unknown[]).flatMap((pr) => {
              try {
                if (pr === null || typeof pr !== "object" || Array.isArray(pr)) return [];
                const rec = pr as Record<string, unknown>;
                if (typeof rec.number !== "number" || !Number.isFinite(rec.number)) return [];
                return [
                  {
                    number: rec.number as number,
                    title: typeof rec.title === "string" ? rec.title : "",
                    url: typeof rec.url === "string" ? rec.url : "",
                    state: typeof rec.state === "string" ? rec.state : "",
                  },
                ];
              } catch {
                return [];
              }
            });
          } catch {
            openPrsByIssue[Number(key)] = [];
          }
        }
      } catch {
        // Degrades to no open PRs (honest-empty).
      }
      const gateByPr: Record<number, Record<number, LiveGateSnapshot>> = {};
      try {
        let gateRoot: unknown = {};
        try {
          gateRoot = useIssueGateStore.getState().gateByPr ?? {};
        } catch {
          gateRoot = {};
        }
        const gateMap =
          gateRoot !== null && typeof gateRoot === "object" && !Array.isArray(gateRoot)
            ? (gateRoot as Record<string, unknown>)
            : {};
        for (const [issueKey, byPr] of Object.entries(gateMap)) {
          const inner: Record<number, LiveGateSnapshot> = {};
          try {
            if (byPr === null || typeof byPr !== "object" || Array.isArray(byPr)) {
              gateByPr[Number(issueKey)] = inner;
              continue;
            }
            for (const [prKey, gate] of Object.entries(byPr as Record<string, unknown>)) {
              try {
                if (gate === null || typeof gate !== "object" || Array.isArray(gate)) continue;
                const grec = gate as Record<string, unknown>;
                inner[Number(prKey)] = {
                  status: typeof grec.status === "string" ? grec.status : "idle",
                  reportPath:
                    typeof grec.reportPath === "string" ? grec.reportPath : null,
                };
              } catch {
                // One poisoned gate entry never breaks the row.
              }
            }
          } catch {
            // Degrades to no gates for this issue.
          }
          gateByPr[Number(issueKey)] = inner;
        }
      } catch {
        // Degrades to no gates (honest-empty).
      }
      // Scalar slices degrade to null when mistyped (never a throw);
      // record slices degrade to {} unless they are plain records.
      const safeRecord = (value: unknown): Record<number, never> => {
        try {
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            return { ...(value as Record<string, unknown>) } as Record<number, never>;
          }
        } catch {
          // Fall through to honest-empty.
        }
        return {};
      };
      const safeNumOrNull = (value: unknown): number | null => {
        try {
          return typeof value === "number" && Number.isInteger(value) && value > 0
            ? (value as number)
            : null;
        } catch {
          return null;
        }
      };
      return {
        primaryPrByIssue,
        verdictByIssue: safeRecord(
          (s as unknown as Record<string, unknown>).verdictByIssue,
        ) as LiveReviewSnapshot["verdictByIssue"],
        reviewingIssueNumber: safeNumOrNull(
          (s as unknown as Record<string, unknown>).reviewingIssueNumber,
        ),
        fixingIssueNumber: safeNumOrNull(
          (s as unknown as Record<string, unknown>).fixingIssueNumber,
        ),
        mergingIssueNumber: safeNumOrNull(
          (s as unknown as Record<string, unknown>).mergingIssueNumber,
        ),
        resolvingConflictIssueNumber: safeNumOrNull(
          (s as unknown as Record<string, unknown>).resolvingConflictIssueNumber,
        ),
        mergedPrNumbers,
        openPrsByIssue,
        verdictByPr: safeRecord(
          (s as unknown as Record<string, unknown>).verdictByPr,
        ) as LiveReviewSnapshot["verdictByPr"],
        labelsByPr: safeRecord(
          (s as unknown as Record<string, unknown>).labelsByPr,
        ) as LiveReviewSnapshot["labelsByPr"],
        labelsByIssue: safeRecord(
          (s as unknown as Record<string, unknown>).labelsByIssue,
        ) as LiveReviewSnapshot["labelsByIssue"],
        conflictByPr: safeRecord(
          (s as unknown as Record<string, unknown>).conflictByPr,
        ) as LiveReviewSnapshot["conflictByPr"],
        gateByPr,
      };
    },
    readResolvingIssueNumber: () =>
      useIssueResolveStore.getState().resolvingIssueNumber,
    readFactoryJobs: () => {
      try {
        const items = useWorkItemStore.getState().workItems;
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    },
    readProjectName: (projectId: string) =>
      useProjectStore.getState().projects.find((p) => p.id === projectId)
        ?.name,
    loadStatusOverrides: () => loadPersistedStatusOverrides(),
    saveStatusOverrides: (overrides) =>
      savePersistedStatusOverrides(overrides),
  };
}

/**
 * Pure status derivation — implements the table above.
 * Exported for unit tests; no store access.
 *
 * `issueState` is the raw GitHub `state` carried on the canvas node
 * (OPEN / CLOSED). Only an exact "CLOSED" maps to done; anything else
 * (OPEN, absent legacy nodes, junk) falls through to rows 3–7. The
 * parameter is optional so pre-existing 3-arg call sites keep working.
 *
 * `factoryActive` marks a live factory job linked to the issue (matched by
 * `issueRef` in the existing `useWorkItemStore` poll list — zero new
 * polls; the adapter computes it). Queued jobs count: a fresh resolve job
 * waits in `Intake` behind the worker and is still agent work in flight.
 *
 * `factoryCompleted` marks a TERMINAL `Complete` factory job linked to the
 * issue (same `issueRef` match, via `findCompletedFactoryJobForIssue` —
 * `Cancelled` / legacy `error` never match). DONE SOLO ON MERGE: it carries
 * NO board signal on its own (row 6b removed — a real Complete without
 * merge/PR evidence falls to backlog, never to done). A completed job with
 * an OPEN PR still shows in-review via row 6, and running canvas work still
 * shows in-progress. The parameter is kept for call-site compatibility and
 * is otherwise ignored (honest, never invented).
 */
export function deriveKanbanStatus(
  issueNumber: number,
  review: LiveReviewSnapshot,
  resolvingIssueNumber: number | null,
  issueState?: string | null,
  factoryActive?: boolean | null,
  factoryCompleted?: boolean | null,
): KanbanStatus {
  const pr = review.primaryPrByIssue[issueNumber] ?? null;

  if (
    pr !== null &&
    (pr.state === "MERGED" || review.mergedPrNumbers.includes(pr.number))
  ) {
    return "done";
  }
  if (issueState === "CLOSED") {
    return "done";
  }
  if (
    review.reviewingIssueNumber === issueNumber ||
    review.fixingIssueNumber === issueNumber ||
    review.mergingIssueNumber === issueNumber ||
    review.resolvingConflictIssueNumber === issueNumber ||
    resolvingIssueNumber === issueNumber ||
    factoryActive === true
  ) {
    return "in-progress";
  }
  const verdict = review.verdictByIssue[issueNumber] ?? null;
  if (verdict !== null) return "in-review";
  if (pr !== null && pr.state === "OPEN") return "in-review";
  // DONE SOLO ON MERGE: a terminal `Complete` alone never settles done.
  // `Complete` + OPEN PR already returned in-review above; `Complete`
  // without a PR falls through to backlog (honest, nothing invented).
  void factoryCompleted;
  return "backlog";
}

/** Last path segment of a project id/path; falls back to "canvas". */
export function repoNameFromProjectId(projectId: unknown): string {
  if (typeof projectId !== "string") return "canvas";
  const segments = projectId.split(/[/\\]+/).filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : "canvas";
}

/**
 * Defensive array coercion — non-array input (persisted legacy payload,
 * bad hydrate, wrong-type JSON) normalizes to []. Never throws.
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * GitHub issue numbers are positive integers. Anything else (NaN, 0,
 * negative, float, numeric string, null/undefined) is invalid.
 */
export function isValidIssueNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (value as number) > 0
  );
}

/**
 * Single raw label entry → normalized `{ name, color? }`, or null to discard.
 * A bare string IS a valid GitHub label name, so it maps to `{ name }`.
 * Null, numbers, booleans, arrays, and objects without a non-empty string
 * `name` are discarded. Never throws.
 */
function normalizeLabelEntry(
  entry: unknown,
): { name: string; color?: string } | null {
  if (typeof entry === "string") {
    const name = entry.trim();
    return name.length > 0 ? { name } : null;
  }
  if (!isRecord(entry)) return null;
  if (typeof entry.name !== "string") return null;
  const name = entry.name.trim();
  if (name.length === 0) return null;
  if (typeof entry.color !== "string") return { name };
  return { name, color: entry.color };
}

/**
 * Defensive labels normalization — never throws.
 * Non-array `labels` (legacy persisted string, null/undefined, object) → [].
 * Array entries go through `normalizeLabelEntry` (bare strings become
 * `{ name }`; junk entries are dropped).
 */
export function normalizeLabels(
  labels: unknown,
): { name: string; color?: string }[] {
  const out: { name: string; color?: string }[] = [];
  for (const entry of asArray<unknown>(labels)) {
    const normalized = normalizeLabelEntry(entry);
    if (normalized !== null) out.push(normalized);
  }
  return out;
}

/** Canvas `{ name, color? }` → board `{ name, bg, fg }`. Never throws. */
export function toIssueLabel(
  label: { name: string; color?: string } | unknown,
): IssueLabel {
  const name =
    isRecord(label) && typeof label.name === "string"
      ? label.name
      : typeof label === "string"
        ? label
        : "";
  const raw =
    isRecord(label) && typeof label.color === "string"
      ? label.color.trim()
      : "";
  const bg =
    raw.length === 0
      ? "#27272a"
      : raw.startsWith("#")
        ? raw
        : /^[0-9a-fA-F]{6}$/.test(raw)
          ? `#${raw}`
          : "#27272a";
  return { name, bg, fg: "#e5e5e5" };
}

/** GitHub-native issue state surfaced on the board (dot + drawer badge). */
export type GitHubIssueState = "OPEN" | "CLOSED";

/**
 * Raw node `state` → GitHubIssueState. Only exact "OPEN"/"CLOSED" pass
 * through; absent legacy nodes and junk map to undefined (unknown, never
 * inferred — callers default the dot to open-green since legacy nodes
 * came from the open-only fetch).
 */
export function normalizeIssueState(value: unknown): GitHubIssueState | undefined {
  return value === "OPEN" || value === "CLOSED" ? value : undefined;
}

/**
 * Raw node `author` → login string. Accepts the normalized login string
 * or the `{ login }` object straight from the GraphQL spread; anything
 * else (absent legacy nodes, null, junk) maps to "" — honest, never
 * fabricated. Exported for unit tests.
 */
export function normalizeAuthor(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isRecord(value) && typeof value.login === "string") {
    return value.login.trim();
  }
  return "";
}

/** Muted GitHub-style palette for deterministic per-author avatar colors. */
const AUTHOR_COLORS = [
  "#f0883e",
  "#58a6ff",
  "#3fb950",
  "#d2a8ff",
  "#f778ba",
  "#ffa657",
  "#79c0ff",
  "#7ee787",
] as const;

/**
 * Deterministic avatar color for a login (hash → palette). Empty login
 * (unknown author) stays neutral gray. Exported for unit tests.
 */
export function authorColorFor(login: string): string {
  if (login === "") return "#6b7280";
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = (hash * 31 + login.charCodeAt(i)) | 0;
  }
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
}

function strField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numField(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * Canvas `nodes()` helper: a `{ nodes: [...] }` connection object maps to
 * its array, anything else to []. Never throws.
 */
function connectionNodes<T>(field: unknown): T[] {
  if (isRecord(field) && Array.isArray(field.nodes)) {
    return field.nodes as T[];
  }
  return [];
}

const RELATION_LABEL: Record<KanbanRelationKind, KanbanRelation["label"]> = {
  parent: "Parent",
  blockedBy: "Blocked by",
  blocking: "Blocking",
  subIssue: "Sub-issue",
};

function toRelation(
  entry: unknown,
  kind: KanbanRelationKind,
): KanbanRelation | null {
  if (!isRecord(entry)) return null;
  const number = numField(entry.number);
  if (!isValidIssueNumber(number)) return null;
  const state = strField(entry.state, "OPEN");
  return {
    number,
    title: strField(entry.title),
    url: strField(entry.url),
    state: state !== "" ? state : "OPEN",
    kind,
    label: RELATION_LABEL[kind],
  };
}

/**
 * Pure relations mapping — same sources as the canvas `relationCards`
 * (parent + blockedBy + blocking + subIssues, no dedup of dual states).
 * Rows without a valid issue number are dropped (the canvas would render
 * `#0`; a link without a real number is worse than no link).
 * Exported for unit tests. Never throws.
 */
export function mapRelationsFromNode(
  raw: Record<string, unknown>,
): KanbanRelation[] {
  const out: KanbanRelation[] = [];
  const push = (entry: unknown, kind: KanbanRelationKind): void => {
    const relation = toRelation(entry, kind);
    if (relation !== null) out.push(relation);
  };
  if (isRecord(raw.parent)) push(raw.parent, "parent");
  for (const entry of connectionNodes<unknown>(raw.blockedBy)) {
    push(entry, "blockedBy");
  }
  for (const entry of connectionNodes<unknown>(raw.blocking)) {
    push(entry, "blocking");
  }
  for (const entry of connectionNodes<unknown>(raw.subIssues)) {
    push(entry, "subIssue");
  }
  return out;
}

/**
 * Blocked-by resolve gate — pure, shared by the canvas card and the
 * Activity panel (both CTAs read this; neither invents relations).
 *
 * An issue is blocked when it carries at least one REAL `blockedBy`
 * relation whose state is not CLOSED. Only CLOSED counts as done:
 * OPEN, absent, or junk states keep the gate shut (unknown is never
 * treated as done). Non-array input (absent relations, bad hydrate)
 * means "no blockers", never a throw.
 */
export interface ResolveBlockedGate {
  blocked: boolean;
  /** Open blocker issue numbers, ascending, deduplicated. */
  blockers: number[];
}

export function resolveBlockedGate(relations: unknown): ResolveBlockedGate {
  const blockers = new Set<number>();
  if (Array.isArray(relations)) {
    for (const entry of relations) {
      if (!isRecord(entry)) continue;
      if (entry.kind !== "blockedBy") continue;
      if (!isValidIssueNumber(entry.number)) continue;
      if (entry.state === "CLOSED") continue;
      blockers.add(entry.number);
    }
  }
  const sorted = [...blockers].sort((a, b) => a - b);
  return { blocked: sorted.length > 0, blockers: sorted };
}

/**
 * Honest disabled title for a blocked resolve CTA, shared verbatim by the
 * canvas card and the Activity panel. Never throws; empty input yields the
 * generic fallback (callers only use it when `blocked` is true).
 */
export function blockedByTitle(blockers: readonly number[]): string {
  const list = (Array.isArray(blockers) ? blockers : [])
    .filter((n) => isValidIssueNumber(n))
    .sort((a, b) => a - b)
    .map((n) => `#${n}`)
    .join(", ");
  if (list === "") return "Bloqueado por otro issue";
  return `Bloqueado por ${list} — se puede resolver cuando ${blockers.length > 1 ? "estén cerrados" : "esté cerrado"}`;
}

/**
 * Pure timeline mapping — same kind derivation as the canvas card
 * (renamed-title > milestoned > cross-referenced > connected >
 * disconnected > labeled > updated). Exported for unit tests. Never throws.
 */
export function mapTimelineFromNode(
  raw: Record<string, unknown>,
): KanbanTimelineEvent[] {
  const out: KanbanTimelineEvent[] = [];
  for (const item of connectionNodes<unknown>(raw.timelineItems)) {
    if (!isRecord(item)) continue;
    const actorRecord = isRecord(item.actor) ? item.actor : null;
    const actor = actorRecord !== null ? strField(actorRecord.login) : "";
    const labelRecord = isRecord(item.label) ? item.label : null;
    const hasRename = typeof item.currentTitle === "string";
    const hasMilestone = typeof item.milestoneTitle === "string";
    const hasSource = !!item.source;
    const hasSubject = !!item.subject;
    let kind: KanbanTimelineEvent["kind"] = "updated";
    if (hasRename) kind = "renamed-title";
    else if (hasMilestone) kind = "milestoned";
    else if (hasSource) kind = "cross-referenced";
    else if (hasSubject && item.isCrossRepository) kind = "connected";
    else if (hasSubject) kind = "disconnected";
    else if (item.label) kind = "labeled";
    const event: KanbanTimelineEvent = {
      kind,
      actor,
      createdAt: strField(item.createdAt),
    };
    if (labelRecord !== null) {
      if (typeof labelRecord.name === "string") {
        event.labelName = labelRecord.name;
      }
      if (typeof labelRecord.color === "string") {
        event.labelColor = labelRecord.color;
      }
    }
    if (typeof item.milestoneTitle === "string") {
      event.milestoneTitle = item.milestoneTitle;
    }
    if (typeof item.previousTitle === "string") {
      event.previousTitle = item.previousTitle;
    }
    if (typeof item.currentTitle === "string") {
      event.currentTitle = item.currentTitle;
    }
    out.push(event);
  }
  return out;
}

interface NodePrBase {
  prNumber: number;
  url: string;
  title: string;
  state: string;
}

/**
 * Node-side Development fallback — the data backing GitHub's Development
 * panel (`closedByPullRequestsReferences`), else timeline cross-refs.
 * Same preference order as the canvas `linkedPRs`. Never throws.
 */
function nodeFallbackPrs(raw: Record<string, unknown>): NodePrBase[] {
  const out: NodePrBase[] = [];
  for (const pr of connectionNodes<unknown>(
    raw.closedByPullRequestsReferences,
  )) {
    if (!isRecord(pr)) continue;
    if (
      strField(pr.__typename) === "PullRequest" ||
      numField(pr.number) > 0
    ) {
      out.push({
        prNumber: numField(pr.number),
        url: strField(pr.url),
        title: strField(pr.title),
        state: strField(pr.state),
      });
    }
  }
  if (out.length === 0) {
    for (const item of connectionNodes<unknown>(raw.timelineItems)) {
      if (!isRecord(item) || !isRecord(item.source)) continue;
      if (strField(item.source.__typename) === "PullRequest") {
        out.push({
          prNumber: numField(item.source.number),
          url: strField(item.source.url),
          title: strField(item.source.title),
          state: strField(item.source.state),
        });
      }
    }
  }
  return out.filter((pr) => pr.prNumber > 0);
}

function normalizeGateStatus(status: unknown): KanbanGateStatus {
  return status === "running" || status === "pass" || status === "fail"
    ? status
    : "idle";
}

/**
 * Pure PR mapping — store open PRs win, else the node Development
 * fallback, else the primary linked PR. Enrichment follows the canvas
 * per-PR chain: `labelsByPr[issue][pr] ?? labelsByIssue[issue] ?? []`,
 * `verdictByPr[issue][pr] ?? verdictByIssue[issue]`, conflict and gate
 * from their per-PR maps, effective label via `effectiveReviewLabel`
 * (labels win over the in-memory verdict). Exported for unit tests.
 * Never throws.
 */
export function mapPrsFromNodeAndReview(
  raw: Record<string, unknown>,
  review?: LiveReviewSnapshot,
  primaryPr?: LiveLinkedPr | null,
): KanbanPr[] {
  const issueNumber = numField(raw.issueNumber);
  const storePrs = review?.openPrsByIssue?.[issueNumber];
  let bases: NodePrBase[] =
    storePrs !== undefined && storePrs.length > 0
      ? storePrs
          .filter(
            (pr): pr is LiveLinkedPr =>
              isRecord(pr) && numField((pr as unknown as Record<string, unknown>).number) > 0,
          )
          .map((pr) => ({
            prNumber: pr.number,
            url: typeof pr.url === "string" ? pr.url : "",
            title: typeof pr.title === "string" ? pr.title : "",
            state: typeof pr.state === "string" ? pr.state : "",
          }))
      : nodeFallbackPrs(raw);
  if (
    bases.length === 0 &&
    primaryPr !== undefined &&
    primaryPr !== null &&
    isRecord(primaryPr) &&
    numField((primaryPr as unknown as Record<string, unknown>).number) > 0
  ) {
    const rec = primaryPr as unknown as Record<string, unknown>;
    bases = [
      {
        prNumber: numField(rec.number),
        url: strField(rec.url),
        title: strField(rec.title),
        state: strField(rec.state),
      },
    ];
  }
  const issueLabels = review?.labelsByIssue?.[issueNumber] ?? [];
  const safeIssueLabels = Array.isArray(issueLabels) ? issueLabels : [];
  const issueVerdict = (review?.verdictByIssue?.[issueNumber] ?? null) as
    | ReviewVerdict
    | null;
  return bases.map((pr) => {
    // Store slices arrive from async lookups: a non-array (bad hydrate,
    // wrong-type persisted payload) degrades to [] instead of throwing
    // inside `effectiveReviewLabel` / the labels spread below.
    const rawLabels =
      review?.labelsByPr?.[issueNumber]?.[pr.prNumber] ??
      safeIssueLabels ??
      [];
    const labels = Array.isArray(rawLabels) ? rawLabels : [];
    const verdict = (review?.verdictByPr?.[issueNumber]?.[pr.prNumber] ??
      issueVerdict ??
      null) as ReviewVerdict | null;
    const gate = review?.gateByPr?.[issueNumber]?.[pr.prNumber];
    return {
      prNumber: pr.prNumber,
      url: pr.url,
      title: pr.title,
      state: pr.state,
      verdict,
      effectiveLabel: effectiveReviewLabel(labels, verdict),
      labels: [...labels],
      conflicted: review?.conflictByPr?.[issueNumber]?.[pr.prNumber] ?? false,
      gateStatus: normalizeGateStatus(gate?.status),
      gateReportPath:
        typeof gate?.reportPath === "string" ? gate.reportPath : null,
    };
  });
}

/**
 * Pure node mapping. Exported for unit tests; no store access. Never throws.
 * Fields without a canvas source stay honest (see module doc).
 * Defensive defaults: non-string title/body → "", non-string or empty url →
 * undefined, missing/non-string projectId → "canvas" (via
 * `repoNameFromProjectId`), non-array labels → [] (via `normalizeLabels`),
 * missing/junk `author` → "" (via `normalizeAuthor`), non-OPEN/CLOSED
 * `state` → undefined (via `normalizeIssueState`).
 * Relations, timeline, and PRs map from the same node fields the canvas
 * card reads (`mapRelationsFromNode`, `mapTimelineFromNode`,
 * `mapPrsFromNodeAndReview`); the optional `review` snapshot enriches PRs
 * with verdicts/labels/conflicts/gate exactly like the canvas per-PR rows.
 * An invalid `issueNumber` falls back to 0 here; `snapshot()` drops such
 * nodes entirely (a board card without a real issue number is worse than no
 * card — it breaks lookup, dedupe, and override pruning).
 * The optional `projectName` carries the human project-store name for the
 * header label; empty/absent stays absent (never invented).
 */
export function mapIssueNodeToKanban(
  node: IssueNodeData,
  status: KanbanStatus,
  primaryPr: LiveLinkedPr | null,
  review?: LiveReviewSnapshot,
  projectName?: string,
): KanbanIssue {
  const raw: Record<string, unknown> = isRecord(node)
    ? (node as unknown as Record<string, unknown>)
    : {};
  const number = isValidIssueNumber(raw.issueNumber) ? raw.issueNumber : 0;
  const title = typeof raw.title === "string" ? raw.title : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  const rawUrl = typeof raw.url === "string" ? raw.url : "";
  const author = normalizeAuthor(raw.author);
  const githubState = normalizeIssueState(raw.state);
  const prRecord: Record<string, unknown> | null =
    primaryPr !== null && isRecord(primaryPr)
      ? (primaryPr as unknown as Record<string, unknown>)
      : null;
  const prNumber =
    prRecord !== null &&
    typeof prRecord.number === "number" &&
    Number.isFinite(prRecord.number)
      ? prRecord.number
      : null;
  const prTitle =
    prRecord !== null && typeof prRecord.title === "string"
      ? prRecord.title
      : "";
  const worktreePath =
    typeof raw.__worktreePath === "string" && raw.__worktreePath !== ""
      ? raw.__worktreePath
      : undefined;
  const projectId =
    typeof raw.projectId === "string" && raw.projectId !== ""
      ? raw.projectId
      : undefined;
  const resolvedProjectName =
    typeof projectName === "string" && projectName.trim() !== ""
      ? projectName.trim()
      : undefined;
  return {
    id: number,
    repoName: repoNameFromProjectId(raw.projectId),
    number,
    title,
    status,
    body,
    author,
    authorColor: authorColorFor(author),
    openedAgo: "",
    labels: normalizeLabels(raw.labels).map(toIssueLabel),
    ...(prNumber !== null ? { prNumber, prTitle } : {}),
    ...(githubState !== undefined ? { githubState } : {}),
    ...(worktreePath !== undefined ? { worktreePath } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(resolvedProjectName !== undefined
      ? { projectName: resolvedProjectName }
      : {}),
    url: rawUrl !== "" ? rawUrl : undefined,
    activity: [],
    relations: mapRelationsFromNode(raw),
    timeline: mapTimelineFromNode(raw),
    prs: mapPrsFromNodeAndReview(raw, review, primaryPr),
  };
}

/**
 * Dedicated versioned localStorage key for the Kanban status overrides.
 * UI-only (never the daemon, never GitHub): the dropdown/drag pick is a
 * view preference, so it lives next to the other warpPanel UI keys (same
 * precedent as `warp-panel-active` in `warpPanelStore.ts`). The version
 * prefix lets a future shape change drop stale payloads instead of
 * misreading them.
 */
export const KANBAN_STATUS_OVERRIDES_STORAGE_KEY =
  "warp-kanban-status-overrides-v1";

const KANBAN_STATUS_OVERRIDES_VERSION = 1;

/** Sanity cap: a board never holds this many rows; bounds the payload. */
const KANBAN_STATUS_OVERRIDES_CAP = 500;

const VALID_OVERRIDE_STATUS: readonly KanbanStatus[] = [
  "backlog",
  "ready",
  "in-progress",
  "in-review",
  "done",
];

/**
 * Reads the persisted overrides (versioned `{version, overrides}` shape).
 * Unknown versions, corrupt JSON, wrong types, and over-cap payloads
 * degrade to an empty map (truncated to the cap) — never throws, never
 * invents rows.
 */
export function loadPersistedStatusOverrides(): Map<number, KanbanStatus> {
  const out = new Map<number, KanbanStatus>();
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return out;
    }
    const raw = window.localStorage.getItem(
      KANBAN_STATUS_OVERRIDES_STORAGE_KEY,
    );
    if (typeof raw !== "string" || raw === "") return out;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return out;
    }
    const envelope = parsed as Record<string, unknown>;
    if (envelope.version !== KANBAN_STATUS_OVERRIDES_VERSION) return out;
    const overrides = envelope.overrides;
    if (
      overrides === null ||
      typeof overrides !== "object" ||
      Array.isArray(overrides)
    ) {
      return out;
    }
    for (const [key, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      if (out.size >= KANBAN_STATUS_OVERRIDES_CAP) break;
      const issueNumber = Number(key);
      if (!isValidIssueNumber(issueNumber)) continue;
      if (
        typeof value !== "string" ||
        !(VALID_OVERRIDE_STATUS as readonly string[]).includes(value)
      ) {
        continue;
      }
      out.set(issueNumber, value as KanbanStatus);
    }
  } catch {
    // Corrupt storage never breaks the board — callers get what parsed.
  }
  return out;
}

/**
 * Persists the overrides in the versioned envelope. Storage failures
 * (private mode, quota, unavailable) are swallowed — the in-memory map
 * stays authoritative for the session. Never throws.
 */
export function savePersistedStatusOverrides(
  overrides: ReadonlyMap<number, KanbanStatus>,
): void {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    const record: Record<string, KanbanStatus> = {};
    let count = 0;
    for (const [issueNumber, status] of overrides) {
      if (count >= KANBAN_STATUS_OVERRIDES_CAP) break;
      if (!isValidIssueNumber(issueNumber)) continue;
      if (!(VALID_OVERRIDE_STATUS as readonly string[]).includes(status)) {
        continue;
      }
      record[String(issueNumber)] = status;
      count += 1;
    }
    window.localStorage.setItem(
      KANBAN_STATUS_OVERRIDES_STORAGE_KEY,
      JSON.stringify({
        version: KANBAN_STATUS_OVERRIDES_VERSION,
        overrides: record,
      }),
    );
  } catch {
    // Storage failure never breaks the board.
  }
}

export class LiveIssuesAdapter implements IssuesAdapter {
  private readonly deps: LiveIssuesDeps;
  /**
   * UI-only status overrides, layered OVER the derived status so the
   * status dropdown / drag-and-drop never lies about what the user just
   * picked. Never written to GitHub and never sent to the daemon (UI-only
   * by construction — `setIssueStatus` only touches this map + storage).
   * Persisted to a dedicated versioned localStorage key (explicit user
   * order — an earlier in-memory-only decision was reverted), restored on
   * construction; entries for issues that left the canvas are pruned on
   * the next snapshot.
   */
  private readonly statusOverrides = new Map<number, KanbanStatus>();

  constructor(deps?: Partial<LiveIssuesDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
    try {
      const restored = this.deps.loadStatusOverrides?.();
      if (restored instanceof Map) {
        for (const [issueNumber, status] of restored) {
          if (
            isValidIssueNumber(issueNumber) &&
            (VALID_OVERRIDE_STATUS as readonly string[]).includes(status)
          ) {
            this.statusOverrides.set(issueNumber, status as KanbanStatus);
          }
        }
      }
    } catch {
      // A broken persisted payload never breaks the board.
    }
  }

  private persistOverrides(): void {
    try {
      this.deps.saveStatusOverrides?.(this.statusOverrides);
    } catch {
      // Storage failure (private mode, quota) never breaks the board.
    }
  }

  private snapshot(): KanbanIssue[] {
    const nodes = asArray<IssueNodeData>(this.deps.readIssues());
    const review = this.deps.readReview();
    const resolving = this.deps.readResolvingIssueNumber();
    let factoryJobs: unknown[] = [];
    try {
      const read = this.deps.readFactoryJobs();
      factoryJobs = Array.isArray(read) ? read : [];
    } catch {
      factoryJobs = [];
    }
    const seen = new Set<number>();
    const issues: KanbanIssue[] = [];
    // B3: ONE index per snapshot — every row resolves against this map
    // (O(jobs) once) instead of rescanning the poll list per issue.
    // Ola B3: shared memoized index (one build per payload across adapters).
    const factoryIndex = getFactoryJobIndex(factoryJobs);
    for (const node of nodes) {
      // Row isolation (item 2): NO throw in one row may reset the panel.
      // Every row's describe/derive/map runs inside this per-row guard —
      // a poisoned node, review slice, or poll-list entry drops that row
      // (honest-empty) instead of throwing mid-render in the shell
      // (outside `WarpPanelBoundary`), which previously read as a
      // black-screen + reset to the default section on the
      // review→awaiting transition. Parity with `liveActivity.ts`
      // per-node try/catch.
      try {
        // Drop malformed rows: non-object nodes and nodes without a valid
        // positive-integer issueNumber (legacy persisted / bad-hydrate data).
        if (!isRecord(node)) continue;
        const record = node as unknown as Record<string, unknown>;
        const issueNumber = record.issueNumber;
        if (!isValidIssueNumber(issueNumber)) continue;
        seen.add(issueNumber);
        let pr: LiveLinkedPr | null = null;
        try {
          const candidate = (review as unknown as Record<number, unknown>) !== null &&
              typeof review === "object"
            ? (review as unknown as Record<string, unknown>).primaryPrByIssue
            : undefined;
          const rec =
            candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
              ? (candidate as Record<string, unknown>)[issueNumber]
              : undefined;
          pr = rec === null || rec === undefined
            ? null
            : (rec as LiveLinkedPr | null) ?? null;
        } catch {
          pr = null;
        }
        let rawProjectId = "";
        try {
          rawProjectId =
            typeof record.projectId === "string" ? record.projectId : "";
        } catch {
          rawProjectId = "";
        }
        let resolvedProjectName: string | undefined;
        try {
          resolvedProjectName =
            rawProjectId !== ""
              ? this.deps.readProjectName?.(rawProjectId)
              : undefined;
        } catch {
          resolvedProjectName = undefined;
        }
        // Live factory job linked to this issue (repo-scoped `issueRef`
        // match — the shared helper, same as the Activity adapter). Never
        // throws; absent = no factory work (honest).
        let factoryActive = false;
        // DONE SOLO ON MERGE: the completed flag is still read (call-site
        // compat) but carries no done signal — see `deriveKanbanStatus`.
        // `Cancelled` never matches. Never throws.
        let factoryCompleted = false;
        try {
          const nodeUrl =
            typeof record.url === "string" ? record.url : null;
          const repo =
            nodeUrl !== null ? parseGitHubIssueRepo(nodeUrl) : null;
          factoryActive =
            findActiveFactoryJobForIssueIndexed(
              factoryIndex,
              issueNumber,
              repo,
            ) !== null;
          factoryCompleted =
            findCompletedFactoryJobForIssueIndexed(
              factoryIndex,
              issueNumber,
              repo,
            ) !== null;
        } catch {
          factoryActive = false;
          factoryCompleted = false;
        }
        let status: KanbanStatus;
        try {
          status =
            this.statusOverrides.get(issueNumber) ??
            deriveKanbanStatus(
              issueNumber,
              review,
              resolving,
              typeof record.state === "string" ? record.state : null,
              factoryActive,
              factoryCompleted,
            );
        } catch {
          // A poisoned derive degrades to backlog (honest, never a throw).
          status = "backlog";
        }
        try {
          issues.push(
            mapIssueNodeToKanban(
              node as unknown as IssueNodeData,
              status,
              pr,
              review,
              resolvedProjectName,
            ),
          );
        } catch {
          // A poisoned map drops the row — the panel stays alive.
        }
      } catch {
        // Malformed node dropped — the adapter never throws.
        continue;
      }
    }
    let prunedOverrides = false;
    for (const key of this.statusOverrides.keys()) {
      if (!seen.has(key)) {
        this.statusOverrides.delete(key);
        prunedOverrides = true;
      }
    }
    // Pruning changed the persisted set — keep storage honest too.
    if (prunedOverrides) {
      this.persistOverrides();
    }
    // Newest issues first (descending by issue number).
    issues.sort((a, b) => b.number - a.number);
    return issues;
  }

  listIssues(): KanbanIssue[] {
    return this.snapshot();
  }

  getIssue(id: number): KanbanIssue | undefined {
    return this.snapshot().find((issue) => issue.id === id);
  }

  setIssueStatus(id: number, status: KanbanStatus): KanbanIssue[] {
    if (
      isValidIssueNumber(id) &&
      (VALID_OVERRIDE_STATUS as readonly string[]).includes(status)
    ) {
      this.statusOverrides.set(id, status);
      this.persistOverrides();
    }
    return this.snapshot();
  }

  /** Test helper: drop all overrides (memory + storage). */
  clearStatusOverrides(): void {
    this.statusOverrides.clear();
    this.persistOverrides();
  }
}

/** Shared live singleton — the default `IssuesAdapter` for `useIssues`. */
export const liveIssuesAdapter: IssuesAdapter = new LiveIssuesAdapter();
