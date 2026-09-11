import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AwaitingAction,
  InProgressPhase,
  Issue,
  IssueFactoryJob,
  IssueStatus,
  ViewMode,
} from "../types";
import {
  IconAgent,
  IconBranch,
  IconClose,
  IconFix,
  IconGitHub,
  IconMerge,
  IconPlay,
  IconRefresh,
  IconSession,
} from "./warpIcons";
import { useActivity } from "../hooks/useActivity";
import { useIssueResolveStore } from "../../../stores/issueResolveStore";
import {
  useIssueReviewStore,
  type LinkedPr,
} from "../../../stores/issueReviewStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import { useWorkItemStore } from "../../../stores/workItemStore";
import {
  FACTORY_HEALTH_TIMEOUT_MS,
  getFactoryHealth,
} from "../../../lib/factoryClient";
import {
  FACTORY_STAGE_LANES,
  findActiveFactoryJobForIssue,
  parseGitHubIssueRepo,
} from "../adapters/factoryIssueJobs";
import {
  effectiveReviewLabel,
  REVIEW_LABEL_GATE_FAIL,
} from "../../../canvas/reviewVerdict";
import {
  describeActivityActions,
  describeFactorySessionLine,
  invokeActivityAction,
  type ActivityActionDef,
  type ActivityActionKind,
} from "./activityActions";
import { openIssueInGitHub } from "./KanbanBoard";
import { renderMarkdown } from "../../../utils/markdownClass";
import { resolveBlockedGate } from "../adapters/liveIssues";

/**
 * ActivityPanel — Track B (T03).
 *
 * Verbatim port of figma/.../src/components/ActivityPanel.tsx. Only diffs
 * vs Figma: import paths, `var(--*)` -> `var(--wp-*)` token prefix,
 * `ViewMode` imported from shared `../types` (never from KanbanBoard),
 * and data arriving via props / `useActivity` instead of a direct
 * `../data/issues` import (components never fetch).
 *
 * Props are optional overrides: when omitted, the panel reads the
 * workflow-state snapshot from `useActivity()` (mock-backed today,
 * real adapter later) — never via direct fetch/IPC.
 */

export interface ActivityPanelProps {
  /** Workflow-state snapshot. Defaults to `useActivity().issues`. */
  issues?: Issue[];
  /** Notified when a row is opened (shell may sync selection elsewhere). */
  onSelectIssue?: (id: number) => void;
}

// ─── Color palettes ───────────────────────────────────────────────────────────

const PHASE: Record<
  InProgressPhase,
  {
    accent: string;
    bg: string;
    border: string;
    label: string;
  }
> = {
  implementing: {
    accent: "#22d3ee",
    bg: "rgba(34,211,238,0.07)",
    border: "rgba(34,211,238,0.22)",
    label: "#67e8f9",
  },
  reviewing: {
    accent: "#fb923c",
    bg: "rgba(251,146,60,0.07)",
    border: "rgba(251,146,60,0.22)",
    label: "#fdba74",
  },
  fixing: {
    accent: "#e879f9",
    bg: "rgba(232,121,249,0.07)",
    border: "rgba(232,121,249,0.22)",
    label: "#f0abfc",
  },
};

const AWAIT: Record<
  AwaitingAction,
  {
    accent: string;
    bg: string;
    border: string;
    label: string;
    btnBg: string;
    btnHover: string;
  }
> = {
  "review-ready": {
    accent: "#a78bfa",
    bg: "rgba(167,139,250,0.07)",
    border: "rgba(167,139,250,0.22)",
    label: "#c4b5fd",
    btnBg: "#5b21b6",
    btnHover: "#4c1d95",
  },
  "changes-requested": {
    accent: "#fbbf24",
    bg: "rgba(251,191,36,0.07)",
    border: "rgba(251,191,36,0.22)",
    label: "#fde68a",
    btnBg: "#92400e",
    btnHover: "#78350f",
  },
  "merge-ready": {
    accent: "#34d399",
    bg: "rgba(52,211,153,0.07)",
    border: "rgba(52,211,153,0.22)",
    label: "#6ee7b7",
    btnBg: "#065f46",
    btnHover: "#064e3b",
  },
  // ── Factory human gates (additive — Figma entries above untouched) ──
  // Accent rides the panel tokens (`--wp-*`); bg/border reuse the
  // matching Figma rgba wash; buttons reuse the closest Figma pair so no
  // new hue enters the panel. `label` is the token's hex value (not the
  // `var()` itself) because the awaiting-context paragraph appends an
  // alpha suffix (`${label}bb`) — a `var()` there would be invalid CSS.
  "spec-approval": {
    accent: "var(--wp-await-review)",
    bg: "rgba(167,139,250,0.07)",
    border: "rgba(167,139,250,0.22)",
    label: "#a78bfa",
    btnBg: "#5b21b6",
    btnHover: "#4c1d95",
  },
  "triage-respond": {
    accent: "var(--wp-await-fix)",
    bg: "rgba(251,191,36,0.07)",
    border: "rgba(251,191,36,0.22)",
    label: "#fbbf24",
    btnBg: "#92400e",
    btnHover: "#78350f",
  },
  "ask-human": {
    accent: "var(--wp-status-awaiting)",
    bg: "rgba(168,85,247,0.07)",
    border: "rgba(168,85,247,0.22)",
    label: "#a855f7",
    btnBg: "#065f46",
    btnHover: "#064e3b",
  },
  "resume": {
    accent: "var(--wp-status-awaiting)",
    bg: "rgba(168,85,247,0.07)",
    border: "rgba(168,85,247,0.22)",
    label: "#a855f7",
    btnBg: "#065f46",
    btnHover: "#064e3b",
  },
};

const COL_COLOR: Record<IssueStatus, string> = {
  pending: "#6b7280",
  "in-progress": "#f59e0b",
  awaiting: "#a855f7",
  ready: "#34d399",
  done: "#22c55e",
};

/**
 * Column metadata + label tables — verbatim values from
 * `adapters/mockActivity.ts` (Figma `data/issues.ts`).
 * Declared here (not imported from `adapters/*`) because components
 * may only receive data via props/hooks; these static presentation
 * tables mirror the adapter seed 1:1.
 */
const COLUMNS: { id: IssueStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "in-progress", label: "In Progress" },
  { id: "awaiting", label: "Awaiting You" },
  { id: "ready", label: "Ready to Merge" },
  { id: "done", label: "Done" },
];

const PHASE_LABELS: Record<InProgressPhase, string> = {
  implementing: "Implementing",
  reviewing: "Reviewing",
  fixing: "Implementing Fix",
};

const AWAITING_LABELS: Record<AwaitingAction, string> = {
  "review-ready": "Review Issue",
  "changes-requested": "Implement Fix",
  "merge-ready": "Merge PR",
  "spec-approval": "Approve Spec",
  "triage-respond": "Answer Questions",
  "ask-human": "Accept Review",
  "resume": "Retomar trabajo",
};

// Markdown body styling for the always-dark detail pane (same GitHub-dark
// palette as the IssueDrawer; markdownClassName follows the app theme and
// would be unreadable here in light mode). Reuses the shared
// marked+DOMPurify `renderMarkdown` — zero new dependencies.
const activityMarkdownClass =
  "text-[#c8c8c8] text-[13px] leading-[1.75] break-words " +
  "[&_h1]:text-[17px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:break-words [&_h1]:text-[#f0f0f0] " +
  "[&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:break-words [&_h2]:text-[#f0f0f0] " +
  "[&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:break-words [&_h3]:text-[#f0f0f0] " +
  "[&_p]:my-1.5 [&_p]:break-words [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 [&_li]:break-words " +
  "[&_a]:text-[#58a6ff] [&_a]:no-underline [&_a]:hover:underline [&_a]:break-all [&_a]:cursor-pointer " +
  "[&_code]:text-[#e6edf3] [&_code]:bg-[#1c1c1c] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:break-words " +
  "[&_pre]:bg-[#1c1c1c] [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:min-w-0 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-[#30363d] [&_blockquote]:pl-3 [&_blockquote]:text-[#8b949e] " +
  "[&_hr]:border-[#30363d] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:my-2";

// ─── Panel ────────────────────────────────────────────────────────────────────

const DETAIL_MS = 220;
const DETAIL_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

// ─── Memo guards (perf Ola 2, Kanban B1 parity) ───────────────────────────────
// The 2.5s poll rebuilds every `Issue` object, so a default shallow memo
// would never bail. These compare exactly the fields the row renders
// (plus callback refs and the selected flag) — unchanged content skips the
// render entirely. Exported for offline unit tests. Never throws.

export interface ActivityCardProps {
  issue: Issue;
  selected: boolean;
  onSelect: (id: number) => void;
}

/** Verbatim daemon stage text shown on in-progress rows (badge only). */
export function activityFactoryStageText(issue: Issue): string | null {
  try {
    const v = (issue as { factory?: unknown }).factory;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const label = (v as { stageLabel?: unknown }).stageLabel;
    if (typeof label === "string" && label.trim() !== "") return label.trim();
    const stage = (v as { stage?: unknown }).stage;
    if (typeof stage === "string" && stage.trim() !== "") return stage.trim();
    return null;
  } catch {
    return null;
  }
}

function sameStringList(a: unknown, b: unknown): boolean {
  try {
    const la = asStringList(a);
    const lb = asStringList(b);
    if (la.length !== lb.length) return false;
    for (let i = 0; i < la.length; i += 1) {
      if (la[i] !== lb[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isSameActivityCardProps(
  prev: ActivityCardProps,
  next: ActivityCardProps,
): boolean {
  try {
    if (prev.selected !== next.selected) return false;
    if (prev.onSelect !== next.onSelect) return false;
    const a = prev.issue;
    const b = next.issue;
    if (a === b) return true;
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.status !== b.status ||
      a.phase !== b.phase ||
      a.awaitingAction !== b.awaitingAction ||
      a.prNumber !== b.prNumber ||
      a.branch !== b.branch ||
      (a as { conflicted?: unknown }).conflicted !==
        (b as { conflicted?: unknown }).conflicted
    ) {
      return false;
    }
    if (!sameStringList(a.labels, b.labels)) return false;
    if (activityFactoryStageText(a) !== activityFactoryStageText(b)) {
      return false;
    }
    // C2 watchdog chip: a flip in stalled-ness must re-render the row.
    if ((a.factory?.stalled ?? false) !== (b.factory?.stalled ?? false)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── View toggle (shared visual style) ───────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        borderRadius: 6,
        border: "1px solid var(--wp-border)",
        background: "var(--wp-bg-elevated)",
        padding: 2,
        gap: 1,
      }}
    >
      <ToggleBtn
        active={mode === "columns"}
        label="Columns"
        onClick={() => onChange("columns")}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect
            x="1"
            y="2"
            width="4"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="6"
            y="2"
            width="4"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="11"
            y="2"
            width="4"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </ToggleBtn>
      <ToggleBtn
        active={mode === "collapsible"}
        label="Collapsible"
        onClick={() => onChange("collapsible")}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect
            x="1"
            y="2"
            width="14"
            height="3"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="1"
            y="7"
            width="14"
            height="3"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="1"
            y="12"
            width="14"
            height="2"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </ToggleBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        border: "none",
        cursor: "pointer",
        background: active ? "var(--wp-bg-hover)" : "transparent",
        color: active ? "var(--wp-text-secondary)" : "var(--wp-text-disabled)",
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--wp-text-tertiary)";
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--wp-text-disabled)";
      }}
    >
      {children}
    </button>
  );
}

// ─── Columns layout (horizontal) ─────────────────────────────────────────────

function ColumnsLayout({
  issues,
  selectedId,
  onSelect,
}: {
  issues: Issue[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        overflowX: "auto",
        overflowY: "hidden",
        display: "flex",
        gap: 14,
        padding: "16px 18px 20px",
      }}
    >
      {COLUMNS.map((col) => {
        const colIssues = issues.filter((i) => i.status === col.id);
        const accent = COL_COLOR[col.id];
        return (
          <div
            key={col.id}
            style={{
              width: 260,
              minWidth: 260,
              display: "flex",
              flexDirection: "column",
              height: "100%",
              flexShrink: 0,
            }}
          >
            {/* Header */}
            <div style={{ paddingBottom: 9, flexShrink: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--wp-font-sans)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: accent,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    flex: 1,
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 10,
                    color: "#3a3a3a",
                  }}
                >
                  {colIssues.length}
                </span>
              </div>
            </div>
            <div
              style={{ height: 1, background: `${accent}30`, marginBottom: 8 }}
            />
            <div style={{ flex: 1, overflowY: "auto" }}>
              {colIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  selected={selectedId === issue.id}
                  onSelect={onSelect}
                />
              ))}
              {colIssues.length === 0 && (
                <p
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 10,
                    color: "#2a2a2a",
                    textAlign: "center",
                    padding: "16px 0",
                    margin: 0,
                  }}
                >
                  No issues
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ActivityPanel({
  issues: issuesProp,
  onSelectIssue,
}: ActivityPanelProps) {
  // Data enters via props or the data hook — never via direct fetch.
  const { issues: hookIssues, refresh, isFetching } = useActivity();
  const issues = issuesProp ?? hookIssues;
  // Perf P1b: lookup completions land N snapshots staggered over seconds
  // (one store write per gh result); deferring the list keeps typing and
  // scrolling urgent while rows settle a beat later. Single coherent
  // snapshot for list + detail.
  const deferredIssues = useDeferredValue(issues);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mountedId, setMountedId] = useState<number | null>(null); // stays mounted during exit
  const [detailVisible, setDetailVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("collapsible");
  const closeTimer = useRef<number | null>(null);
  const selected =
    deferredIssues.find((i) => i.id === (mountedId ?? selectedId)) ?? null;

  function openDetail(id: number) {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setMountedId(id);
    setSelectedId(id);
    requestAnimationFrame(() => setDetailVisible(true));
    onSelectIssue?.(id);
  }

  function closeDetail() {
    setDetailVisible(false);
    setSelectedId(null);
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
    }
    closeTimer.current = window.setTimeout(() => {
      setMountedId(null);
      closeTimer.current = null;
    }, DETAIL_MS);
  }

  // Perf Ola 2: stable id-based select (leaf `IssueCard` memo bails out of
  // the per-poll re-render only when this ref holds — inline closures per
  // row would defeat `isSameActivityCardProps` on every tick).
  const handleSelect = useCallback(
    (id: number): void => {
      if (id === selectedId) {
        closeDetail();
      } else {
        openDetail(id);
      }
    },
    // openDetail/closeDetail are stable-by-construction (refs + setState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId],
  );

  // Escape closes the slide-in detail (keyboard path); the pending
  // unmount timer is cleared if the component unmounts mid-exit.
  useEffect(() => {
    if (mountedId === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeDetail();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // closeDetail is stable-by-construction (no external deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedId]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--wp-bg)",
      }}
    >
      {/* ── Kanban ── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
            borderBottom: "1px solid var(--wp-border-subtle)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontFamily: "var(--wp-font-sans)",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--wp-text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Activity
            </span>
            <span
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 10,
                color: "var(--wp-text-disabled)",
                background: "var(--wp-bg-elevated)",
                border: "1px solid var(--wp-border)",
                padding: "1px 7px",
                borderRadius: 4,
              }}
            >
              {deferredIssues.length}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <ToolbarBtn
            aria-label="Fetch latest issues"
            title="Fetch latest issues"
            onClick={refresh}
            busy={isFetching}
          >
            <span
              className={isFetching ? "spin-icon" : undefined}
              style={{ display: "flex", alignItems: "center" }}
            >
              <IconRefresh size={13} />
            </span>
          </ToolbarBtn>
        </div>

        {/* Content — switches between columns and collapsible.
            Perf P1b: the deferred snapshot (see above). */}
        {viewMode === "columns" ? (
          <ColumnsLayout
            issues={deferredIssues}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "12px 12px 32px",
            }}
          >
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                status={col.id}
                label={col.label}
                issues={deferredIssues.filter((i) => i.status === col.id)}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Detail (animated slide-in from right) ── */}
      {selected && (
        <div
          style={{
            flex: "0 0 50%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--wp-border)",
            overflow: "hidden",
            transform: detailVisible ? "translateX(0)" : "translateX(100%)",
            transition: `transform ${DETAIL_MS}ms ${DETAIL_EASE}`,
          }}
        >
          <IssueDetail issue={selected} onClose={closeDetail} />
        </div>
      )}
    </div>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  label,
  issues,
  selectedId,
  onSelect,
}: {
  status: IssueStatus;
  label: string;
  issues: Issue[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(status === "done");
  const accent = COL_COLOR[status];
  const isAgent = status === "in-progress";
  const isAwaiting = status === "awaiting";
  const isReady = status === "ready";

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${
          isAwaiting
            ? "rgba(168,85,247,0.2)"
            : isReady
              ? "rgba(52,211,153,0.2)"
              : isAgent
                ? "rgba(245,158,11,0.15)"
                : "var(--wp-border-subtle)"
        }`,
        background: isAwaiting
          ? "rgba(168,85,247,0.04)"
          : isReady
            ? "rgba(52,211,153,0.04)"
            : isAgent
              ? "rgba(245,158,11,0.03)"
              : "var(--wp-bg-elevated)",
        marginBottom: 10,
        overflow: "visible",
      }}
    >
      {/* Column header */}
      <button
        aria-expanded={!collapsed}
        aria-label={`${label} — ${issues.length} issues`}
        onClick={() => setCollapsed((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 12px",
          background: "transparent",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.04)",
          cursor: "pointer",
          borderRadius: collapsed ? 8 : "8px 8px 0 0",
          transition: "background 120ms",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {/* Status dot */}
        {isAgent ? (
          <span
            className="pulse-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accent,
              flexShrink: 0,
            }}
          />
        ) : (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accent,
              flexShrink: 0,
            }}
          />
        )}

        {/* Label */}
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            flex: 1,
            textAlign: "left",
            color: isAwaiting
              ? "#c084fc"
              : isReady
                ? "#34d399"
                : isAgent
                  ? "#fbbf24"
                  : status === "done"
                    ? "#4ade80"
                    : "var(--wp-text-tertiary)",
          }}
        >
          {label}
        </span>

        {/* Context badge */}
        {isAgent && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              letterSpacing: "0.05em",
              color: "#b45309",
              background: "rgba(251,191,36,0.1)",
              border: "1px solid rgba(251,191,36,0.2)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            AGENT WORKING
          </span>
        )}
        {isAwaiting && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              letterSpacing: "0.05em",
              color: "#a855f7",
              background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.25)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            YOUR TURN
          </span>
        )}
        {isReady && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              letterSpacing: "0.05em",
              color: "#34d399",
              background: "rgba(52,211,153,0.12)",
              border: "1px solid rgba(52,211,153,0.25)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            MERGE
          </span>
        )}

        {/* Count */}
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--wp-border)",
            padding: "1px 6px",
            borderRadius: 4,
          }}
        >
          {issues.length}
        </span>

        {/* Chevron */}
        <span
          style={{
            display: "flex",
            color: "var(--wp-text-disabled)",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 140ms",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 3.5L5 6.5L8 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* Cards */}
      {!collapsed && (
        <div style={{ padding: issues.length ? "3px 6px 6px" : "8px" }}>
          {issues.length === 0 ? (
            <p
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                color: "var(--wp-text-disabled)",
                textAlign: "center",
                padding: "12px 0",
                margin: 0,
              }}
            >
              No issues
            </p>
          ) : (
            issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                selected={selectedId === issue.id}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compact issue row ────────────────────────────────────────────────────────

// B1-parity memo guard: the 2.5s poll rebuilds every `Issue` object, so a
// default shallow memo would never bail. `isSameActivityCardProps` compares
// exactly the rendered fields — unchanged rows skip the render entirely.
const IssueCard = memo(function IssueCard({
  issue,
  selected,
  onSelect,
}: ActivityCardProps) {
  const [hov, setHov] = useState(false);
  // Transition-shape guards: a junk awaiting/status arriving on the
  // review→awaiting flip degrades to honest-empty (no pill, neutral dot)
  // instead of throwing on map lookups. In-progress phase pills were
  // removed: in-progress rows always use the section orange dot + the
  // exact factory stage from the detail timeline (foreman/triage/etc).
  const awRaw =
    typeof issue.awaitingAction === "string"
      ? ((AWAIT as Record<string, (typeof AWAIT)[AwaitingAction]>)[
          issue.awaitingAction
        ] ?? null)
      : null;
  // The canvas-only Review Issue flow does not belong to the warp panel:
  // legacy `review-ready` rows degrade to honest-empty (no pill, no CTA).
  const aw =
    issue.awaitingAction === "review-ready" ? null : awRaw;
  const col =
    typeof issue.status === "string"
      ? ((COL_COLOR as Record<string, string>)[issue.status] ?? "#6b7280")
      : "#6b7280";
  const rowLabels = asStringList(
    (issue as { labels?: unknown }).labels,
  );

  // Left accent colour for the row (in-progress phase colors removed —
  // only the section dot color, orange for in-progress).
  const accentColor = aw ? aw.accent : col;

  // Ready to Merge cards show the issue title + the PR number
  // (green PR icon), nothing else.
  if (issue.status === "ready") {
    return (
      <button
        aria-pressed={selected}
        aria-label={`Issue #${issue.id}: ${issue.title}`}
        onClick={() => onSelect(issue.id)}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          width: "100%",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "0 10px 0 0",
          borderRadius: 6,
          border: selected
            ? `1px solid ${col}44`
            : hov
              ? "1px solid #222"
              : "1px solid transparent",
          background: selected ? `${col}0c` : hov ? "#141414" : "transparent",
          cursor: "pointer",
          transition: "background 80ms, border-color 80ms",
          overflow: "hidden",
          position: "relative",
          // Perf P0b: igual que la rama principal (fila de 38px fijos).
          contentVisibility: "auto",
          containIntrinsicSize: "auto 38px",
        }}
      >
        <span
          style={{
            width: 3,
            alignSelf: "stretch",
            flexShrink: 0,
            background: selected || hov ? accentColor : "transparent",
            borderRadius: "3px 0 0 3px",
            transition: "background 80ms",
          }}
        />
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: col,
              opacity: 0.5,
            }}
          />
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "#3e3e3e",
            flexShrink: 0,
          }}
        >
          #{issue.id}
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            fontWeight: 500,
            color: selected ? "#d4d4d4" : hov ? "#b0b0b0" : "#787878",
            flex: 1,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            transition: "color 80ms",
          }}
        >
          {issue.title}
        </span>
        {typeof issue.prNumber === "number" &&
          Number.isFinite(issue.prNumber) && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                flexShrink: 0,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
                <circle cx="4" cy="3.5" r="1.5" fill="#4ade80" />
                <circle cx="4" cy="12.5" r="1.5" fill="#4ade80" />
                <circle cx="12" cy="6" r="1.5" fill="#4ade80" />
                <path
                  d="M4 5v5M4 5c0 3 8 3 8 0"
                  stroke="#4ade80"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                style={{
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 9,
                  color: "#4ade80",
                }}
              >
                #{issue.prNumber}
              </span>
            </span>
          )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            color: hov ? "#444" : "#202020",
            flexShrink: 0,
            transition: "color 80ms",
          }}
        >
          <path
            d="M4.5 3L8 6l-3.5 3"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <button
      aria-pressed={selected}
      aria-label={`Issue #${issue.id}: ${issue.title}`}
      onClick={() => onSelect(issue.id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 38,
        padding: "0 10px 0 0",
        borderRadius: 6,
        border: selected
          ? `1px solid ${col}44`
          : hov
            ? "1px solid #222"
            : "1px solid transparent",
        background: selected ? `${col}0c` : hov ? "#141414" : "transparent",
        cursor: "pointer",
        transition: "background 80ms, border-color 80ms",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Colored left accent bar */}
      <span
        style={{
          width: 3,
          alignSelf: "stretch",
          flexShrink: 0,
          background: selected || hov ? accentColor : "transparent",
          borderRadius: "3px 0 0 3px",
          transition: "background 80ms",
        }}
      />

      {/* Status micro-icon (in-progress phase colors removed — only the
          section orange dot; the exact factory stage lives in the detail
          timeline) */}
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {issue.status === "in-progress" ? (
          <span
            className="pulse-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: col,
            }}
          />
        ) : issue.status === "awaiting" && aw ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M10 7.5C10 9.43 8.43 11 6.5 11S3 9.43 3 7.5V4.5M3 4.5L1 6.5M3 4.5L5 6.5"
              stroke={aw.accent}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : issue.status === "done" ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="#22c55e" strokeWidth="1.3" />
            <path
              d="M4 6l1.5 1.5L8 4.5"
              stroke="#22c55e"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: col,
              opacity: 0.5,
            }}
          />
        )}
      </span>

      {/* Issue number */}
      <span
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "#3e3e3e",
          flexShrink: 0,
        }}
      >
        #{issue.id}
      </span>

      {/* Separator */}
      <span style={{ color: "#222", fontSize: 11, flexShrink: 0 }}>·</span>

      {/* Title */}
      <span
        style={{
          fontFamily: "var(--wp-font-sans)",
          fontSize: 12,
          fontWeight: 500,
          color: selected ? "#d4d4d4" : hov ? "#b0b0b0" : "#787878",
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          transition: "color 80ms",
        }}
      >
        {issue.title}
      </span>

      {/* Exact factory stage badge (in-progress only, orange section
          styling): the verbatim daemon stage (Foreman / Triage / Building /
          Review / …). Absent without a linked factory job (honest-empty). */}
      {issue.status === "in-progress" &&
        (() => {
          try {
            const v = (issue as { factory?: unknown }).factory;
            if (v === null || typeof v !== "object" || Array.isArray(v)) {
              return null;
            }
            const label = (v as { stageLabel?: unknown }).stageLabel;
            const stage = (v as { stage?: unknown }).stage;
            const text =
              typeof label === "string" && label.trim() !== ""
                ? label.trim()
                : typeof stage === "string" && stage.trim() !== ""
                  ? stage.trim()
                  : null;
            if (text === null) return null;
            return (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "1px 6px",
                  borderRadius: 3,
                  flexShrink: 0,
                  background: "rgba(245,158,11,0.07)",
                  border: "1px solid rgba(245,158,11,0.22)",
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 9,
                  color: "#fbbf24",
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "#f59e0b",
                  }}
                />
                {text}
              </span>
            );
          } catch {
            return null;
          }
        })()}

      {/* Awaiting pill — compact (review-ready never shows: the
          canvas-only Review Issue flow was removed from the warp panel) */}
      {aw &&
        issue.awaitingAction &&
        issue.awaitingAction !== "review-ready" && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 3,
            flexShrink: 0,
            background: aw.bg,
            border: `1px solid ${aw.border}`,
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            color: aw.label,
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: aw.accent,
            }}
          />
          {(typeof issue.awaitingAction === "string"
            ? (AWAITING_LABELS as Record<string, string>)[issue.awaitingAction]
            : undefined) ?? "Needs review"}
        </span>
      )}

      {/* Stalled — list-level watchdog (C2): a linked job with no daemon
          update past the threshold. The detail already explains it; the row
          carries the marker so stuck jobs (#67-class, 40h in Triage) are
          visible without opening each one. */}
      {issue.factory?.stalled === true && (
        <span
          title="No daemon update for a while — the job may be stuck"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 3,
            flexShrink: 0,
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.25)",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            color: "#fbbf24",
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "#fbbf24",
            }}
          />
          stalled
        </span>
      )}

      {/* Conflicts badge — canvas `prConflicted` parity
          (`conflictsByPr?.[issue]?.[pr] ?? false` on the primary PR).
          Badge only; the resolve action lives in the conflict block below. */}
      {(issue as { conflicted?: unknown }).conflicted === true && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 3,
            flexShrink: 0,
            background: "rgba(248,81,73,0.1)",
            border: "1px solid rgba(248,81,73,0.5)",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            color: "#f85149",
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "#f85149",
            }}
          />
          Conflicts
        </span>
      )}

      {/* Labels */}
      {rowLabels.slice(0, 1).map((l) => (
        <span
          key={l}
          style={{
            padding: "1px 6px",
            borderRadius: 4,
            flexShrink: 0,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #1e1e1e",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            color: "#505050",
          }}
        >
          {l}
        </span>
      ))}

      {/* Branch (not on awaiting rows: parity with Ready to Merge, which
          shows icon + # only — the branch stays in the detail meta-box) */}
      {issue.branch && issue.status !== "awaiting" && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          <IconBranch size={9} color="#1e6a8a" />
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              color: "#1e6a8a",
            }}
          >
            {issue.branch}
          </span>
        </span>
      )}

      {/* PR number */}
      {typeof issue.prNumber === "number" &&
        Number.isFinite(issue.prNumber) && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="3.5" r="1.5" fill="#4ade80" />
            <circle cx="4" cy="12.5" r="1.5" fill="#4ade80" />
            <circle cx="12" cy="6" r="1.5" fill="#4ade80" />
            <path
              d="M4 5v5M4 5c0 3 8 3 8 0"
              stroke="#4ade80"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              // Awaiting rows match Ready to Merge contrast (solid);
              // other rows keep the dimmed tone.
              color: issue.status === "awaiting" ? "#4ade80" : "#4ade8050",
            }}
          >
            #{issue.prNumber}
          </span>
        </span>
      )}

      {/* Chevron */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        style={{
          color: hov ? "#444" : "#202020",
          flexShrink: 0,
          transition: "color 80ms",
        }}
      >
        <path
          d="M4.5 3L8 6l-3.5 3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}, isSameActivityCardProps);

// ─── Issue detail ─────────────────────────────────────────────────────────────

function IssueDetail({
  issue,
  onClose,
}: {
  issue: Issue;
  onClose: () => void;
}) {
  const statusMeta = (() => {
    try {
      if (!Array.isArray(COLUMNS)) return undefined;
      return COLUMNS.find((c) => c?.id === issue.status);
    } catch {
      return undefined;
    }
  })();
  // Transition-shape guards (same as the row card): junk phase/awaiting/
  // status degrades to honest-empty instead of throwing on map lookups.
  // `review-ready` never shows: the canvas-only Review Issue flow was
  // removed from the warp panel (legacy rows degrade to honest-empty).
  const ph =
    typeof issue.phase === "string"
      ? ((PHASE as Record<string, (typeof PHASE)[InProgressPhase]>)[
          issue.phase
        ] ?? null)
      : null;
  const awRaw =
    typeof issue.awaitingAction === "string"
      ? ((AWAIT as Record<string, (typeof AWAIT)[AwaitingAction]>)[
          issue.awaitingAction
        ] ?? null)
      : null;
  const aw =
    issue.awaitingAction === "review-ready" ? null : awRaw;
  const color =
    typeof issue.status === "string"
      ? ((COL_COLOR as Record<string, string>)[issue.status] ?? "#a855f7")
      : "#a855f7";

  // ── Live workflow context (read-only store reads, canvas-card parity) ──
  // The panel never fetches: every value below re-resolves from the maps the
  // canvas flow already writes, so rows re-render synchronously with the
  // canvas card. All CTAs go through `activityActions.invoke` — the ONLY
  // code path from the panel into handler refs.
  const resolvingIssueNumber = useIssueResolveStore(
    (s) => s.resolvingIssueNumber,
  );
  const reviewingIssueNumber = useIssueReviewStore(
    (s) => s.reviewingIssueNumber,
  );
  const fixingIssueNumber = useIssueReviewStore((s) => s.fixingIssueNumber);
  const mergingIssueNumber = useIssueReviewStore((s) => s.mergingIssueNumber);
  const resolvingConflictIssueNumber = useIssueReviewStore(
    (s) => s.resolvingConflictIssueNumber,
  );
  const prsByIssue = useIssueReviewStore((s) => s.prsByIssue);
  const openPrsByIssue = useIssueReviewStore((s) => s.openPrsByIssue);
  const verdictByIssue = useIssueReviewStore((s) => s.verdictByIssue);
  const verdictByPr = useIssueReviewStore((s) => s.verdictByPr);
  const labelsByPr = useIssueReviewStore((s) => s.labelsByPr);
  const labelsByIssue = useIssueReviewStore((s) => s.labelsByIssue);
  const conflictByPr = useIssueReviewStore((s) => s.conflictByPr);
  const gateByPr = useIssueGateStore((s) => s.gateByPr);

  // A wrong-type `prNumber` (string flip on the transition) reads as no
  // primary PR instead of poisoning the guard matrix.
  const primaryPr =
    typeof issue.prNumber === "number" && Number.isFinite(issue.prNumber)
      ? issue.prNumber
      : null;
  const prState = prStateForIssue(
    prsByIssue,
    openPrsByIssue,
    issue.id,
    primaryPr,
  );
  // PR URL for the clickable PR row (factory daemon link first, then the
  // store open/PR maps the canvas already hydrates — never synthesized).
  // Absent = plain `#n` text (honest, never a dead link). Never throws.
  const prUrl: string | null = (() => {
    try {
      const v = (issue as { factory?: unknown }).factory;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const u = (v as { prUrl?: unknown }).prUrl;
        if (typeof u === "string" && u.trim() !== "") return u.trim();
      }
      if (primaryPr !== null) {
        const openTable = asRecordSlice(openPrsByIssue);
        const openRaw =
          openTable !== null ? openTable[issue.id] : undefined;
        if (Array.isArray(openRaw)) {
          for (const pr of openRaw) {
            try {
              if (
                pr !== null &&
                typeof pr === "object" &&
                !Array.isArray(pr) &&
                (pr as { number?: unknown }).number === primaryPr &&
                typeof (pr as { url?: unknown }).url === "string" &&
                ((pr as { url: string }).url.trim() !== "")
              ) {
                return (pr as { url: string }).url.trim();
              }
            } catch {
              // one poisoned entry never breaks the lookup
            }
          }
        }
        const prsTable = asRecordSlice(prsByIssue);
        const primary: unknown =
          prsTable !== null ? prsTable[issue.id] : undefined;
        if (
          primary !== null &&
          typeof primary === "object" &&
          !Array.isArray(primary) &&
          (primary as { number?: unknown }).number === primaryPr &&
          typeof (primary as { url?: unknown }).url === "string" &&
          ((primary as { url: string }).url.trim() !== "")
        ) {
          return (primary as { url: string }).url.trim();
        }
      }
      return null;
    } catch {
      return null;
    }
  })();
  // Store slices arrive from async lookups: any mistyped slice (bad
  // hydrate, wrong-type persisted payload, `"loading"` flips on the
  // review→awaiting path) degrades to honest-empty instead of throwing
  // mid-render (a render throw here used to trip the root ErrorBoundary
  // and blank the whole app). Every map access below is guarded at both
  // levels (table, then per-issue inner table).
  const prLabels = (() => {
    try {
      const prTable = asRecordSlice(labelsByPr);
      const issueTable = asRecordSlice(labelsByIssue);
      const inner = prTable !== null ? asRecordSlice(prTable[issue.id]) : null;
      const raw =
        primaryPr !== null
          ? ((inner !== null ? inner[primaryPr] : undefined) ??
            (issueTable !== null ? issueTable[issue.id] : undefined) ??
            [])
          : ((issueTable !== null ? issueTable[issue.id] : undefined) ?? []);
      return asStringList(raw);
    } catch {
      return [];
    }
  })();
  const prVerdict = (() => {
    try {
      if (primaryPr === null) return null;
      const prTable = asRecordSlice(verdictByPr);
      const issueTable = asRecordSlice(verdictByIssue);
      const inner = prTable !== null ? asRecordSlice(prTable[issue.id]) : null;
      const value =
        (inner !== null ? inner[primaryPr] : undefined) ??
        (issueTable !== null ? issueTable[issue.id] : undefined) ??
        null;
      return value === "APPROVED" ||
        value === "CHANGES_REQUESTED" ||
        value === "REVIEW_REQUIRED" ||
        value === "COMMENTED" ||
        value === "FIX_APPLIED"
        ? (value as NonNullable<typeof value>)
        : null;
    } catch {
      return null;
    }
  })();
  const effective = (() => {
    try {
      return effectiveReviewLabel(prLabels, prVerdict);
    } catch {
      return null;
    }
  })();
  const conflicted = (() => {
    try {
      if (primaryPr === null) return false;
      const table = asRecordSlice(conflictByPr);
      const inner =
        table !== null ? asRecordSlice(table[issue.id]) : null;
      return (inner !== null ? inner[primaryPr] : undefined) === true;
    } catch {
      return false;
    }
  })();
  const gate = (() => {
    try {
      if (primaryPr === null) return undefined;
      const table = asRecordSlice(gateByPr);
      const inner =
        table !== null ? asRecordSlice(table[issue.id]) : null;
      const value = inner !== null ? inner[primaryPr] : undefined;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value as { status?: unknown; reportPath?: unknown };
      }
      return undefined;
    } catch {
      return undefined;
    }
  })();
  const gateStatus: "idle" | "running" | "pass" | "fail" =
    gate?.status === "running" ||
    gate?.status === "fail" ||
    gate?.status === "pass"
      ? gate.status
      : "idle";
  const gateFailed =
    effective === REVIEW_LABEL_GATE_FAIL || gateStatus === "fail";
  const reportPath =
    typeof gate?.reportPath === "string" ? gate.reportPath : null;
  const [gateReport, setGateReport] = useState<{
    path: string;
    content: string | null;
  } | null>(null);

  // ── Warp Resolve → factory job (resolve creates POST /factory/jobs) ──
  // `factoryJobs` reuses the EXISTING poll list (zero new intervals — the
  // shared `useWorkItemsPolling` 2.5s loop runs while any shell is
  // mounted). The daemon probe below is a single one-shot GET on detail
  // open (explicit short timeout), not a poll: unknown stays enabled,
  // down disables honestly.
  const factoryJobs = useWorkItemStore((s) => s.workItems);
  const [factoryAvailable, setFactoryAvailable] = useState<boolean | null>(
    null,
  );
  const [factoryMsg, setFactoryMsg] = useState<string | null>(null);
  // opencode health slice of the same one-shot probe: WITHOUT a healthy
  // server no role session exists at all (Agent Sessions 0/5). Surfacing
  // the daemon's own status/error makes the missing sessions explainable
  // instead of five silent disabled buttons.
  const [opencodeIssue, setOpencodeIssue] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFactoryAvailable(null);
    setFactoryMsg(null);
    setOpencodeIssue(null);
    void getFactoryHealth({ timeoutMs: FACTORY_HEALTH_TIMEOUT_MS }).then(
      (res) => {
        if (cancelled) return;
        setFactoryAvailable(res.ok);
        if (!res.ok) return;
        try {
          const data = res.data as Record<string, unknown> | null;
          const opencode =
            data !== null && typeof data.opencode === "object" && data.opencode !== null
              ? (data.opencode as Record<string, unknown>)
              : null;
          const status =
            opencode !== null && typeof opencode.status === "string"
              ? opencode.status
              : typeof data?.opencodeStatus === "string"
                ? (data.opencodeStatus as string)
                : "";
          if (status === "healthy") return;
          const detail =
            opencode !== null && typeof opencode.error === "string" && opencode.error.trim() !== ""
              ? `: ${opencode.error.trim().slice(0, 160)}`
              : "";
          setOpencodeIssue(`opencode ${status === "" ? "unavailable" : status}${detail}`);
        } catch {
          setOpencodeIssue(null);
        }
      },
      () => {
        if (!cancelled) setFactoryAvailable(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issue.id]);
  const factoryRepo = (() => {
    try {
      return parseGitHubIssueRepo(issue.url);
    } catch {
      return null;
    }
  })();
  const factoryActive = useMemo(() => {
    try {
      return (
        findActiveFactoryJobForIssue(factoryJobs, issue.id, factoryRepo) !==
        null
      );
    } catch {
      return false;
    }
  }, [factoryJobs, issue.id, factoryRepo]);

  // Human gate for the linked job (spec approval / triage answers /
  // ask_human accept — attached by `liveActivity`, null when the job
  // needs nothing). Drives the awaiting CTA guards + the context block.
  // A wrong-type `factoryAwaiting` (string/array on the transition) reads
  // as no gate instead of throwing on `.kind` reads.
  const factoryNeed = (() => {
    try {
      const raw = (issue as { factoryAwaiting?: unknown }).factoryAwaiting;
      if (raw === null || raw === undefined) return null;
      if (typeof raw !== "object" || Array.isArray(raw)) return null;
      return raw as NonNullable<Issue["factoryAwaiting"]>;
    } catch {
      return null;
    }
  })();
  const needQuestions = (() => {
    try {
      if (factoryNeed === null || factoryNeed.kind !== "triage-respond") {
        return [];
      }
      const raw = (factoryNeed as { questions?: unknown }).questions;
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (q): q is string => typeof q === "string" && q.trim() !== "",
      );
    } catch {
      return [];
    }
  })();
  const [answerDrafts, setAnswerDrafts] = useState<string[]>([]);
  // Drafts belong to one (issue, questions) pair: reset when either
  // changes so stale text never answers another job's questions.
  const questionsKey = needQuestions.join("\n");
  useEffect(() => {
    setAnswerDrafts([]);
  }, [issue.id, questionsKey]);
  // Explicit worktree-delete confirm stage (canvas `ProjectTree`
  // two-stage parity: soft confirm first, force confirm after a
  // force-gated 409). Reset per issue so a staged confirm never leaks
  // onto another row.
  const [worktreeConfirm, setWorktreeConfirm] = useState<
    "idle" | "soft" | "force"
  >("idle");
  useEffect(() => {
    setWorktreeConfirm("idle");
  }, [issue.id]);
  // Explicit discard confirm (destructive: cancels the parked job and
  // cleans everything it did). Two clicks: the first arms, the second
  // invokes. Reset per issue so a staged confirm never leaks onto
  // another row.
  const [discardConfirm, setDiscardConfirm] = useState<"idle" | "armed">(
    "idle",
  );
  // Real busy flag while the daemon tears the job down (PR close + branch +
  // worktree + job rm can take seconds): the discard button spins and locks
  // until the POST settles. Reset per issue like the confirm stage.
  const [discardBusy, setDiscardBusy] = useState(false);
  useEffect(() => {
    setDiscardConfirm("idle");
    setDiscardBusy(false);
  }, [issue.id]);
  const triageAnswersReady =
    needQuestions.length > 0 &&
    answerDrafts.some(
      (draft) => typeof draft === "string" && draft.trim() !== "",
    );

  const defs = useMemo(
    () =>
      describeActivityActions({
        issueNumber: issue.id,
        prNumber: primaryPr,
        prState,
        effective,
        conflicted,
        gateStatus,
        blockedByBlockers: resolveBlockedGate(issue.relations).blockers,
        busy: {
          resolving: resolvingIssueNumber !== null,
          reviewing: reviewingIssueNumber !== null,
          fixing: fixingIssueNumber !== null,
          merging: mergingIssueNumber !== null,
          resolvingConflict: resolvingConflictIssueNumber !== null,
          anyActive:
            resolvingIssueNumber !== null ||
            reviewingIssueNumber !== null ||
            fixingIssueNumber !== null ||
            mergingIssueNumber !== null ||
            resolvingConflictIssueNumber !== null,
        },
        factory: {
          available: factoryAvailable,
          active: factoryActive,
          // dashboardUrl/sessionUrl flip (string→absent) on the transition:
          // non-string degrades to honest disabled, never a dead tab.
          sessionUrl: (() => {
            try {
              const v = (issue as { factory?: unknown }).factory;
              if (v === null || typeof v !== "object" || Array.isArray(v)) {
                return null;
              }
              const url = (v as { sessionUrl?: unknown }).sessionUrl;
              return typeof url === "string" ? url : null;
            } catch {
              return null;
            }
          })(),
          // B5: job age for the attaching/overdue wait titles (absent =
          // unknown age, the title omits the elapsed parenthetical).
          ...(() => {
            try {
              const v = (issue as { factory?: unknown }).factory;
              if (v === null || typeof v !== "object" || Array.isArray(v)) {
                return {};
              }
              const created = (v as { createdAtMs?: unknown }).createdAtMs;
              return typeof created === "number"
                ? { jobCreatedAtMs: created }
                : {};
            } catch {
              return {};
            }
          })(),
        },
        factoryAwaiting: (() => {
          try {
            if (factoryNeed === null) return null;
            const kind = (factoryNeed as { kind?: unknown }).kind;
            const jobId = (factoryNeed as { jobId?: unknown }).jobId;
            if (typeof kind !== "string" || typeof jobId !== "string") return null;
            const infra = (factoryNeed as { reviewInfraError?: unknown }).reviewInfraError;
            return {
              kind,
              jobId,
              ...(infra === true ? { reviewInfraError: true as const } : {}),
            };
          } catch {
            return null;
          }
        })(),
        triageAnswersReady,
        // Linked job for merge-ready rows ("No mergear" + "Re-revisar"):
        // only when the row awaits merge-ready, else the resume gate
        // owns the discard CTA. Null = honest disabled.
        mergeReadyJobId:
          issue.awaitingAction === "merge-ready"
            ? linkedFactoryJobId(issue, factoryNeed)
            : null,
        // Explicit worktree cleanup (folder only, branch kept — the
        // daemon route semantics; the confirm copy must say exactly
        // that). Null = honest disabled (never a dead click). A
        // wrong-type `factory` (string/array flip) reads as absent.
        factoryWorktree: (() => {
          try {
            const v = (issue as { factory?: unknown }).factory;
            if (v === null || typeof v !== "object" || Array.isArray(v)) {
              return null;
            }
            const rec = v as {
              jobId?: unknown;
              worktreePath?: unknown;
              terminal?: unknown;
            };
            return {
              jobId: rec.jobId,
              worktreePath: rec.worktreePath ?? null,
              terminal: rec.terminal,
            };
          } catch {
            return null;
          }
        })(),
      }),
    [
      issue.id,
      issue.status,
      issue.awaitingAction,
      issue.relations,
      primaryPr,
      prState,
      effective,
      conflicted,
      gateStatus,
      resolvingIssueNumber,
      reviewingIssueNumber,
      fixingIssueNumber,
      mergingIssueNumber,
      resolvingConflictIssueNumber,
      factoryAvailable,
      factoryActive,
      issue.factory,
      factoryNeed,
      triageAnswersReady,
    ],
  );
  const defByKind = useMemo(
    () => new Map(defs.map((d) => [d.kind, d])),
    [defs],
  );
  const reportDef = defByKind.get("view-report");
  const gitHubDef = defByKind.get("github");

  const run = useCallback(
    (kind: ActivityActionKind, pr?: number, opts?: { force?: boolean }) => {
      // Returns the invoke promise so destructive CTAs can show a real busy
      // state (the daemon discard waits for the full teardown, up to 60s).
      return invokeActivityAction(
        kind,
        issue.id,
        pr ?? primaryPr ?? undefined,
        {
          worktreePath: issue.worktreePath,
          issueUrl: issue.url,
          reportPath,
          blockedByBlockers: resolveBlockedGate(issue.relations).blockers,
          onReport: (report) => setGateReport(report),
          // Warp Resolve → factory job (live seams; offline tests inject
          // fakes for every one of these — zero network in tests).
          issue: {
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            url: issue.url,
          },
          factoryJobs,
          notify: (message) => setFactoryMsg(message),
          // Live agent session for "View Agent" (daemon-built
          // `dashboardUrl` via the adapter; null = honest disabled).
          sessionUrl: (() => {
            try {
              const v = (issue as { factory?: unknown }).factory;
              if (v === null || typeof v !== "object" || Array.isArray(v)) {
                return null;
              }
              const url = (v as { sessionUrl?: unknown }).sessionUrl;
              return typeof url === "string" ? url : null;
            } catch {
              return null;
            }
          })(),
          // Human gate (Approve / Respond / Accept target the linked
          // daemon job; answers are the panel's per-question drafts).
          // Falls back to the linked factory job id so the worktree
          // delete (and the discard) target the same job when no gate
          // is waiting.
          factoryJobId: linkedFactoryJobId(issue, factoryNeed),
          factoryAwaitingKind: (() => {
            try {
              if (factoryNeed === null) return null;
              const kind = (factoryNeed as { kind?: unknown }).kind;
              return typeof kind === "string" ? kind : null;
            } catch {
              return null;
            }
          })(),
          triageAnswers: answerDrafts,
          // Explicit worktree cleanup (folder only, branch kept).
          // `force` is only ever true after the second user confirm
          // (canvas force-stage parity); the outcome callback escalates
          // force-gated 409s to that second confirm.
          factoryTerminal: (() => {
            try {
              const v = (issue as { factory?: unknown }).factory;
              if (v === null || typeof v !== "object" || Array.isArray(v)) {
                return null;
              }
              const terminal = (v as { terminal?: unknown }).terminal;
              return typeof terminal === "boolean" ? terminal : null;
            } catch {
              return null;
            }
          })(),
          factoryWorktreePath: (() => {
            try {
              const v = (issue as { factory?: unknown }).factory;
              if (v === null || typeof v !== "object" || Array.isArray(v)) {
                return null;
              }
              const path = (v as { worktreePath?: unknown }).worktreePath;
              return typeof path === "string" ? path : null;
            } catch {
              return null;
            }
          })(),
          forceWorktreeDelete: opts?.force === true,
          onWorktreeDelete: (result) => {
            if (result.ok) {
              setWorktreeConfirm("idle");
              return;
            }
            if (
              opts?.force !== true &&
              /uncommitted|modified or untracked|pass force|still open|unknown/i.test(
                result.error,
              )
            ) {
              setWorktreeConfirm("force");
            }
          },
        },
      );
    },
    [
      issue.id,
      issue.title,
      issue.body,
      issue.labels,
      issue.worktreePath,
      issue.url,
      issue.relations,
      issue.factory,
      factoryNeed,
      answerDrafts,
      primaryPr,
      reportPath,
      factoryJobs,
    ],
  );

  const issuePrNumbers = useMemo(() => {
    const set = new Set<number>();
    // Same render-throw guard as `prLabels` above: a mistyped store slice
    // (undefined map, truthy non-array entry) must not break mid-render.
    // The table access itself is guarded — `openPrsByIssue` flips shape on
    // the review→awaiting path.
    const openTable = asRecordSlice(openPrsByIssue);
    const openList = openTable !== null ? openTable[issue.id] : undefined;
    const list = Array.isArray(openList) ? openList : [];
    for (const pr of list) {
      if (
        pr !== null &&
        typeof pr === "object" &&
        typeof (pr as { number?: unknown }).number === "number" &&
        Number.isFinite((pr as { number: number }).number)
      ) {
        set.add((pr as { number: number }).number);
      }
    }
    if (primaryPr !== null) set.add(primaryPr);
    return [...set];
  }, [openPrsByIssue, issue.id, primaryPr]);

  // Detail label slice: the same null→array flip as the row card.
  const detailLabels = asStringList(
    (issue as { labels?: unknown }).labels,
  );
  // Full markdown body (sanitized HTML via the shared marked+DOMPurify
  // renderer — the same one the IssueDrawer uses). Guarded: a render
  // throw here used to trip the root ErrorBoundary and blank the whole
  // app, so a poisoned/non-string body degrades to honest-empty instead.
  const bodyHtml = useMemo(() => {
    try {
      const body = (issue as { body?: unknown }).body;
      if (typeof body !== "string" || body.trim() === "") return "";
      return renderMarkdown(body);
    } catch {
      return "";
    }
  }, [issue.body]);
  // Factory timeline readiness: a wrong-type `factory` (string/array flip
  // on the transition) renders no timeline instead of throwing inside
  // `FactoryStageTimeline` (its `family.toUpperCase()` read).
  const factoryForTimeline = (() => {
    try {
      const v = (issue as { factory?: unknown }).factory;
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return null;
      }
      const rec = v as Record<string, unknown>;
      if (
        typeof rec.stage !== "string" ||
        typeof rec.stageLabel !== "string" ||
        typeof rec.family !== "string" ||
        typeof rec.stepIndex !== "number" ||
        typeof rec.jobId !== "string"
      ) {
        return null;
      }
      return v as NonNullable<Issue["factory"]>;
    } catch {
      return null;
    }
  })();
  const factoryCostSummary = (() => {
    try {
      const v = (issue as { factory?: unknown }).factory;
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return undefined;
      }
      return (v as { costSummary?: unknown }).costSummary as NonNullable<
        Issue["factory"]
      >["costSummary"];
    } catch {
      return undefined;
    }
  })();
  const factoryWorktreePathForBlock: string | null = (() => {
    try {
      const v = (issue as { factory?: unknown }).factory;
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return null;
      }
      const path = (v as { worktreePath?: unknown }).worktreePath;
      return typeof path === "string" && path !== "" ? path : null;
    } catch {
      return null;
    }
  })();

  // Rendered-markdown links open externally instead of navigating the
  // Electron renderer (same interception pattern as the drawer).
  function handleBodyLinkClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (href && /^https?:\/\//.test(href)) {
      e.preventDefault();
      openIssueInGitHub(href);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--wp-bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 18px 12px",
          borderBottom: "1px solid var(--wp-border-subtle)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 11,
              color: "var(--wp-text-disabled)",
              paddingTop: 2,
              flexShrink: 0,
            }}
          >
            #{issue.id}
          </span>
          <h2
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: 15,
              fontWeight: 700,
              color: "var(--wp-text-primary)",
              lineHeight: 1.35,
              margin: 0,
              flex: 1,
              letterSpacing: "-0.01em",
            }}
          >
            {issue.title}
          </h2>
          <button
            aria-label="Close issue detail"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--wp-text-tertiary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 120ms, color 120ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--wp-bg-hover)";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--wp-text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.color =
                "var(--wp-text-tertiary)";
            }}
          >
            <IconClose size={13} />
          </button>
        </div>

        {/* Status + labels */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 5,
              background: `${color}14`,
              border: `1px solid ${color}40`,
              fontFamily: "var(--wp-font-mono)",
              fontSize: 11,
              fontWeight: 600,
              color: color,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: color,
              }}
            />
            {statusMeta?.label ??
              (typeof issue.status === "string" ? issue.status : "unknown")}
          </span>
          {(conflicted ||
            (issue as { conflicted?: unknown }).conflicted === true) && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 5,
                background: "rgba(248,81,73,0.1)",
                border: "1px solid rgba(248,81,73,0.5)",
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "#f85149",
              }}
            >
              Conflicts
            </span>
          )}
          {detailLabels.map((l) => (
            <span
              key={l}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--wp-border)",
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                color: "var(--wp-text-tertiary)",
              }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "16px 18px",
        }}
      >
        {/* Phase timeline: live Warp cycle stages when a factory job is
            linked (verbatim daemon status, real-time via the shared 2.5s
            poll — zero new polls), else the generic canvas phase. A
            wrong-type `factory` renders no timeline (honest-empty). */}
        {issue.status === "in-progress" && factoryForTimeline ? (
          <FactoryStageTimeline
            factory={factoryForTimeline}
            started={issue.phaseStarted}
          />
        ) : null}
        {issue.status === "in-progress" && factoryForTimeline ? (
          <FactoryDecisionsBlock factory={factoryForTimeline} />
        ) : null}
        {issue.status === "in-progress" &&
        !factoryForTimeline &&
        typeof issue.phase === "string" &&
        (["implementing", "reviewing", "fixing"] as readonly string[]).includes(
          issue.phase,
        ) ? (
          <PhaseTimeline
            current={issue.phase as InProgressPhase}
            started={issue.phaseStarted}
          />
        ) : null}

        {/* Awaiting context */}
        {aw && issue.awaitingAction && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 8,
              background: aw.bg,
              border: `1px solid ${aw.border}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: aw.accent,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--wp-font-sans)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: aw.label,
                  letterSpacing: "0.01em",
                }}
              >
                {(typeof issue.awaitingAction === "string"
                  ? (AWAITING_LABELS as Record<string, string>)[
                      issue.awaitingAction
                    ]
                  : undefined) ?? "Needs review"}
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--wp-font-sans)",
                fontSize: 12,
                color: `${aw.label}bb`,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {(typeof issue.awaitingAction === "string"
                ? (AWAIT_DESC as Record<string, string>)[issue.awaitingAction]
                : undefined) ?? "Waiting for your review."}
            </p>
          </div>
        )}

        {/* Human-gate context: what the linked factory job waits for.
            Context only — the acting CTA (Approve / Respond / Accept)
            lives in the footer primary button (panel convention). */}
        {factoryNeed && aw && (
          <FactoryNeedBlock
            need={factoryNeed}
            accent={aw.accent}
            bg={aw.bg}
            border={aw.border}
            labelColor={aw.label}
            questions={needQuestions}
            drafts={answerDrafts}
            onDraft={(index, value) =>
              setAnswerDrafts((prev) => {
                const next = prev.slice();
                next[index] = value;
                return next;
              })
            }
          />
        )}

        {/* Branch / PR / agent meta (cost breakdown: `costSummary`
            flips null→object on the transition — the guarded copy above
            degrades junk to honest-empty, never a throw). */}
        {(issue.branch ||
          issue.prNumber ||
          issue.assignee ||
          describeFactoryCost(factoryCostSummary) !== null) && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              borderRadius: 7,
              background: "var(--wp-bg-elevated)",
              border: "1px solid var(--wp-border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {typeof issue.branch === "string" && issue.branch !== "" && (
              <MetaRow label="branch" value={issue.branch} color="#38bdf8" />
            )}
            {typeof issue.prNumber === "number" &&
              Number.isFinite(issue.prNumber) &&
              (prUrl !== null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    style={{
                      fontFamily: "var(--wp-font-mono)",
                      fontSize: 10,
                      color: "var(--wp-text-disabled)",
                      width: 42,
                      flexShrink: 0,
                    }}
                  >
                    PR
                  </span>
                  <button
                    type="button"
                    aria-label={`Open PR #${issue.prNumber} in browser`}
                    title={prUrl}
                    onClick={() => openIssueInGitHub(prUrl)}
                    style={{
                      fontFamily: "var(--wp-font-mono)",
                      fontSize: 11,
                      color: "#4ade80",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "#86efac";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "#4ade80";
                    }}
                  >
                    {`#${issue.prNumber}`}
                  </button>
                </div>
              ) : (
                <MetaRow
                  label="PR"
                  value={`#${issue.prNumber}`}
                  color="#4ade80"
                />
              ))}
            {typeof issue.assignee === "string" && issue.assignee !== "" && (
              <MetaRow
                label="agent"
                value={issue.assignee}
                color="var(--wp-text-secondary)"
              />
            )}
            {(() => {
              const cost = describeFactoryCost(factoryCostSummary);
              return cost !== null ? (
                <MetaRow
                  label="cost"
                  value={cost.text}
                  color="var(--wp-text-secondary)"
                  title={cost.title}
                />
              ) : null;
            })()}
          </div>
        )}

        {/* Isolated worktree (explicit cleanup only, never automatic —
            Ready to Merge + Done rows; in-progress / awaiting rows never
            show it: the worktree is still needed there). */}
        {(issue.status === "ready" || issue.status === "done") && (
          <WorktreeBlock
            worktreePath={factoryWorktreePathForBlock}
            deleteDef={defByKind.get("delete-worktree")}
            confirmStage={worktreeConfirm}
            onStageChange={setWorktreeConfirm}
            onDelete={(force) => run("delete-worktree", undefined, { force })}
          />
        )}

        {/* Conflict badge-row (canvas `conflicto:main` parity) */}
        {conflicted && primaryPr !== null && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              borderRadius: 7,
              background: "rgba(248,81,73,0.06)",
              border: "1px solid rgba(248,81,73,0.3)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#f85149",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "#f85149",
                flex: 1,
              }}
            >
              Conflicto con main
            </span>
            <WorkflowRowBtn
              def={defByKind.get("conflict")}
              onClick={() => run("conflict")}
            />
          </div>
        )}

        {/* Gate rows (`gate:fallo` parity: report + manual escape) */}
        {gateFailed && primaryPr !== null && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              borderRadius: 7,
              background: "rgba(248,81,73,0.06)",
              border: "1px solid rgba(248,81,73,0.3)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#f85149",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#f85149",
                  flex: 1,
                }}
              >
                Gate: fallo
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <WorkflowRowBtn
                def={reportDef}
                onClick={() => run("view-report")}
              />
              <WorkflowRowBtn
                def={defByKind.get("override-gate")}
                onClick={() => run("override-gate")}
              />
            </div>
          </div>
        )}
        {gateStatus === "running" && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              borderRadius: 7,
              background: "rgba(210,153,34,0.06)",
              border: "1px solid rgba(210,153,34,0.3)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              className="pulse-dot"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#d29922",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "#d29922",
              }}
            >
              Gate corriendo…
            </span>
          </div>
        )}

        {/* Compact merge-progress block (read-only slice reuse) */}
        <MergeProgressBlock prNumbers={issuePrNumbers} />

        {/* On-demand gate report (same `fs.readFile` bridge as canvas) */}
        {gateReport && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              borderRadius: 7,
              background: "var(--wp-bg-elevated)",
              border: "1px solid var(--wp-border-subtle)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 10,
                color: "var(--wp-text-disabled)",
                margin: "0 0 8px",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {gateReport.path}
            </p>
            <pre
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                color: "var(--wp-text-tertiary)",
                lineHeight: 1.6,
                margin: 0,
                maxHeight: 220,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {gateReport.content ?? "No se pudo leer el reporte."}
            </pre>
          </div>
        )}

        {/* Description — full markdown, drawer parity */}
        {bodyHtml !== "" ? (
          <div
            className={activityMarkdownClass}
            onClick={handleBodyLinkClick}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <p
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: 13,
              color: "var(--wp-text-disabled)",
              lineHeight: 1.75,
              margin: 0,
            }}
          >
            No description.
          </p>
        )}

        {/* Dates */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 14,
            borderTop: "1px solid var(--wp-border-subtle)",
            display: "flex",
            gap: 24,
          }}
        >
          <DateInfo label="opened" value={issue.createdAt} />
          <DateInfo label="updated" value={issue.updatedAt} />
        </div>

        {/* Agent sessions por fase: sección colapsable con una fila por
            fase que crea sesión nueva (foreman/triage/spec/building/review).
            Fases sin sesión aún → deshabilitadas; se habilitan solas cuando
            el daemon registra la sesión (poll 2.5s). Sin factory → nada. */}
        <AgentSessionsBlock issue={issue} opencodeIssue={opencodeIssue} />
      </div>

        {/* Factory resolve feedback — every resolve attempt leaves a
            visible message here (daemon down, missing worktree, create
            failure, or the created job id). Never a dead click. */}
        {factoryMsg !== null && (
          <div
            style={{
              margin: "0 18px 12px",
              padding: "8px 11px",
              borderRadius: 6,
              background: "var(--wp-bg-elevated)",
              border: "1px solid var(--wp-border-subtle)",
              fontFamily: "var(--wp-font-mono)",
              fontSize: 11,
              lineHeight: 1.5,
              color: "var(--wp-text-tertiary)",
              overflowWrap: "break-word",
            }}
          >
            {factoryMsg}
          </div>
        )}

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--wp-border-subtle)",
          padding: "10px 16px",
          display: "flex",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <ActionBtn
          label={gitHubDef?.label ?? "View Issue"}
          secondary
          icon={<IconGitHub size={13} />}
          bg="#161616"
          hoverBg="#1e1e1e"
          border="1px solid var(--wp-border)"
          textColor="var(--wp-text-tertiary)"
          onClick={() => run("github")}
          ariaLabel={`Open issue #${issue.id} on GitHub`}
        />
        {/* Reject sits next to Approve on spec-approval rows: refusing the
            drafted spec regenerates the brief instead of advancing. */}
        {issue.awaitingAction === "spec-approval" &&
          (() => {
            const specRejectDef = defByKind.get("reject-spec");
            if (!specRejectDef) return null;
            return (
              <ActionBtn
                label={specRejectDef.label}
                secondary
                icon={<IconClose size={12} />}
                bg="#161616"
                hoverBg="#1e1e1e"
                border="1px solid rgba(248,81,73,0.5)"
                textColor="#f85149"
                disabled={!specRejectDef.enabled}
                title={specRejectDef.title}
                onClick={() => run("reject-spec")}
                ariaLabel={specRejectDef.label}
              />
            );
          })()}
        {/* Reject sits next to Accept on ask-human rows (FactoryLab
            ReviewPanel "Mandar a Building" parity): refusing sends the job
            back to Building for rework instead of completing it. */}
        {issue.awaitingAction === "ask-human" &&
          (() => {
            const rejectDef = defByKind.get("review-reject");
            if (!rejectDef) return null;
            return (
              <ActionBtn
                label={rejectDef.label}
                secondary
                icon={<IconClose size={12} />}
                bg="#161616"
                hoverBg="#1e1e1e"
                border="1px solid rgba(248,81,73,0.5)"
                textColor="#f85149"
                disabled={!rejectDef.enabled}
                title={rejectDef.title}
                onClick={() => run("review-reject")}
                ariaLabel={rejectDef.label}
              />
            );
          })()}
        {/* Retry sits next to Reject on ask-human rows: re-runs ONLY the
            review (implement output is kept). Primary action when the
            review never ran due to a provider/infra error (Accept is
            disabled then, and the daemon 409s it too). */}
        {issue.awaitingAction === "ask-human" &&
          (() => {
            const retryDef = defByKind.get("review-retry");
            if (!retryDef) return null;
            return (
              <ActionBtn
                label={retryDef.label}
                secondary
                icon={<IconAgent size={12} />}
                bg="#161616"
                hoverBg="#1e1e1e"
                border="1px solid var(--wp-border)"
                textColor="var(--wp-text-primary)"
                disabled={!retryDef.enabled}
                title={retryDef.title}
                onClick={() => run("review-retry")}
                ariaLabel={retryDef.label}
              />
            );
          })()}
        {/* Discard sits next to Resume on resume rows (and next to Merge
            on merge-ready rows as "No mergear"): teardown completo del
            job (PR close, rama/worktree/job fuera). Destructive: first
            click arms, second click invokes.
            Re-revisar sits next to it on merge-ready rows: re-runs the
            review without moving the job (non-destructive, single click). */}
        {(issue.awaitingAction === "resume" || issue.awaitingAction === "merge-ready") &&
          (() => {
            const discardDef = defByKind.get("discard");
            if (!discardDef) return null;
            const armed = discardConfirm === "armed";
            const discardLabel =
              issue.awaitingAction === "merge-ready" ? "No mergear" : discardDef.label;
            return (
              <ActionBtn
                label={
                  discardBusy
                    ? "Eliminando…"
                    : armed
                      ? "Confirmar: cancela y borra todo"
                      : discardLabel
                }
                secondary
                icon={
                  discardBusy ? (
                    <span
                      className="spin-icon"
                      style={{ display: "flex", alignItems: "center" }}
                    >
                      <IconRefresh size={12} />
                    </span>
                  ) : (
                    <IconClose size={12} />
                  )
                }
                bg="#161616"
                hoverBg="#1e1e1e"
                border="1px solid rgba(248,81,73,0.5)"
                textColor="#f85149"
                disabled={!discardDef.enabled || discardBusy}
                title={
                  discardBusy
                    ? "Eliminando: cerrando el PR y borrando rama/worktree/job…"
                    : armed
                      ? "Confirmar: cierra el PR, borra rama/worktree/job y limpia todo lo que hizo"
                      : (discardDef.title ??
                        "No retomar el trabajo: elimina el job parado y todo lo que hizo")
                }
                onClick={() => {
                  if (discardBusy) return;
                  if (!armed) {
                    setDiscardConfirm("armed");
                    return;
                  }
                  setDiscardConfirm("idle");
                  setDiscardBusy(true);
                  // The invoke resolves only after every target's teardown
                  // POST settled (daemon-side sequence): the spinner is real,
                  // never a fake timer.
                  void run("discard").finally(() => setDiscardBusy(false));
                }}
                ariaLabel={
                  discardBusy
                    ? "Eliminando trabajo"
                    : armed
                      ? "Confirmar descarte del trabajo"
                      : discardLabel
                }
              />
            );
          })()}
        {issue.awaitingAction === "merge-ready" &&
          (() => {
            const rerunDef = defByKind.get("re-review");
            if (!rerunDef) return null;
            return (
              <ActionBtn
                label={rerunDef.label}
                secondary
                icon={<IconAgent size={12} />}
                bg="#161616"
                hoverBg="#1e1e1e"
                border="1px solid var(--wp-border)"
                textColor="var(--wp-text-primary)"
                disabled={!rerunDef.enabled}
                title={rerunDef.title}
                onClick={() => run("re-review")}
                ariaLabel={rerunDef.label}
              />
            );
          })()}
        <PrimaryBtn issue={issue} aw={aw} defs={defByKind} onAction={run} />
      </div>
    </div>
  );
}

// ─── Phase timeline ───────────────────────────────────────────────────────────

const PHASES: InProgressPhase[] = ["implementing", "reviewing", "fixing"];

function PhaseTimeline({
  current,
  started,
}: {
  current: InProgressPhase;
  started?: string;
}) {
  const idx = PHASES.indexOf(current);
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px 14px",
        borderRadius: 8,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "var(--wp-text-disabled)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: "0 0 14px",
        }}
      >
        Agent progress
      </p>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {PHASES.map((phase, i) => {
          const pc = PHASE[phase];
          const done = i < idx;
          const active = i === idx;
          return (
            <div
              key={phase}
              style={{ display: "flex", alignItems: "flex-start", flex: 1 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: 1,
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background:
                      active || done ? pc.accent : "var(--wp-bg-hover)",
                    border: active
                      ? `2px solid ${pc.accent}`
                      : done
                        ? "none"
                        : "2px solid var(--wp-border)",
                    boxShadow: active ? `0 0 10px ${pc.accent}60` : "none",
                    transition: "all 200ms",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 9,
                    lineHeight: 1.4,
                    textAlign: "center",
                    color: active
                      ? pc.label
                      : done
                        ? "var(--wp-text-tertiary)"
                        : "var(--wp-text-disabled)",
                  }}
                >
                  {PHASE_LABELS[phase]}
                </span>
              </div>
              {i < PHASES.length - 1 && (
                <div
                  style={{
                    height: 1,
                    flex: 1,
                    background: done
                      ? "rgba(255,255,255,0.1)"
                      : "var(--wp-border-subtle)",
                    marginTop: 5,
                    minWidth: 8,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {started && (
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            margin: "10px 0 0",
          }}
        >
          Phase started {started}
        </p>
      )}
    </div>
  );
}

// ─── Factory stage timeline (live Warp cycle) ───────────────────────────────

/**
 * Live Warp cycle stages for a row with a linked factory job. Lanes are
 * the VERBATIM daemon statuses (`FACTORY_STAGE_LANES` — Intake → Foreman
 * → Triage → Building → Review → Complete), current lane from the
 * existing 2.5s poll snapshot (zero new polls). Queued stages (Intake /
 * Foreman / Triage) say so explicitly: the job waits behind the worker
 * and the row honestly stays here until the daemon picks it up.
 *
 * Palette note (factory polish): lane colors ride the panel tokens
 * (`--wp-*`, same hues as the Figma phase/status washes) — no new hues.
 * Mapping: Intake → text-tertiary · Foreman → phase-impl ·
 * Triage → await-review · Building → status-progress ·
 * Review → phase-review · Complete → status-done.
 */
const FACTORY_STAGE_STYLE: Record<string, { accent: string; label: string }> = {
  Intake: {
    accent: "var(--wp-text-tertiary)",
    label: "var(--wp-text-secondary)",
  },
  Foreman: { accent: "var(--wp-phase-impl)", label: "var(--wp-phase-impl)" },
  Triage: { accent: "var(--wp-await-review)", label: "var(--wp-await-review)" },
  Building: {
    accent: "var(--wp-status-progress)",
    label: "var(--wp-status-progress)",
  },
  Review: { accent: "var(--wp-phase-review)", label: "var(--wp-phase-review)" },
  Complete: {
    accent: "var(--wp-status-done)",
    label: "var(--wp-status-done)",
  },
};

/**
 * Hook stage → lane que lo muestra debajo (el hook corre ANTES de entrar
 * al lane: pre-build se ve en Building, post-build en Review, post-review
 * en Complete). Vocabulary espejo del backend (`AGENT_STAGES`).
 */
const HOOK_STAGE_LANE: Record<string, string> = {
  "pre-build": "Building",
  "post-build": "Review",
  "post-review": "Complete",
};

/**
 * Nombre visible de un agente hook: slug `playwright-tester` → `Playwright
 * Tester`. Único formato de la UI para TODOS los agentes (progress chips +
 * Agent Sessions), los actuales y los que se agreguen. Nunca lanza.
 */
export function humanizeAgentName(name: unknown): string {
  try {
    if (typeof name !== "string") return "";
    return name
      .trim()
      .split(/[-_\s]+/)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

/** Vista de un agente hook declarado para un lane del stepper. */
export interface DeclaredHookAgentView {
  name: string;
  label: string;
  stage: string;
  blocking: boolean;
  lane: string;
}

/**
 * Agrupa los agentes hook declarados por lane (daemon `hookAgents`): un
 * agente nuevo con `stage` aparece bajo su lane aunque todavía no haya
 * corrido, y si le cambian el stage se mueve en el próximo poll.
 * Fallback legacy: payloads sin `hookAgents` pero con `hookStages` producen
 * una entrada sintética por stage (label humanizado del stage). Dedup por
 * nombre, tope 5 por lane. Puro, nunca lanza.
 */
export function declaredHookAgentsByLane(
  factory: unknown,
): Record<string, DeclaredHookAgentView[]> {
  const out: Record<string, DeclaredHookAgentView[]> = {};
  const push = (view: DeclaredHookAgentView): void => {
    try {
      if (!view.lane || view.name === "") return;
      if (!out[view.lane]) out[view.lane] = [];
      if (out[view.lane].length >= 5) return;
      if (out[view.lane].some((v) => v.name === view.name)) return;
      out[view.lane].push(view);
    } catch {
      // una entrada rota no aborta a las demás
    }
  };
  try {
    if (factory === null || typeof factory !== "object" || Array.isArray(factory)) {
      return out;
    }
    const rec = factory as Record<string, unknown>;
    const rawAgents = rec.hookAgents;
    if (Array.isArray(rawAgents) && rawAgents.length > 0) {
      for (const entry of rawAgents) {
        try {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
          const agent = entry as { name?: unknown; stage?: unknown; blocking?: unknown };
          const name = typeof agent.name === "string" ? agent.name.trim() : "";
          const stage = typeof agent.stage === "string" ? agent.stage.trim() : "";
          if (name === "" || stage === "") continue;
          const lane = HOOK_STAGE_LANE[stage];
          if (!lane) continue;
          push({
            name,
            label: humanizeAgentName(name) || name,
            stage,
            blocking: agent.blocking === true,
            lane,
          });
        } catch {
          // una entrada rota no aborta a las demás
        }
      }
      return out;
    }
    const rawStages = rec.hookStages;
    if (Array.isArray(rawStages)) {
      for (const entry of rawStages) {
        try {
          const stage = typeof entry === "string" ? entry.trim() : "";
          if (stage === "") continue;
          const lane = HOOK_STAGE_LANE[stage];
          if (!lane) continue;
          push({
            name: stage,
            label: humanizeAgentName(stage) || stage,
            stage,
            blocking: false,
            lane,
          });
        } catch {
          // un stage roto no aborta a los demás
        }
      }
    }
  } catch {
    // puro, nunca lanza
  }
  return out;
}

/** Dot por estado de corrida hook (tokens del panel; fail reusa el rojo). */
function hookStatusColor(status: string): string {
  try {
    const s = status.trim().toLowerCase();
    if (s === "pass") return "var(--wp-status-done)";
    if (s === "fail") return "#f85149";
    if (s === "error") return "#f59e0b";
    return "var(--wp-text-disabled)";
  } catch {
    return "var(--wp-text-disabled)";
  }
}

/** Family badge colors (panel tokens; Cancelled reuses the panel red). */
const FACTORY_FAMILY_BADGE: Record<string, { color: string }> = {
  queued: { color: "var(--wp-text-tertiary)" },
  running: { color: "var(--wp-status-progress)" },
  terminal: { color: "var(--wp-status-done)" },
  cancelled: { color: "#f85149" },
};

function FactoryStageTimeline({
  factory,
  started,
}: {
  factory: IssueFactoryJob;
  started?: string;
}) {
  // Backstop: a wrong-type `factory` (string/array flip on the
  // review→awaiting path) renders nothing instead of throwing on
  // `family.toUpperCase()` mid-render.
  try {
    if (
      factory === null ||
      typeof factory !== "object" ||
      Array.isArray(factory)
    ) {
      return null;
    }
    const rec = factory as unknown as Record<string, unknown>;
    if (
      typeof rec.stage !== "string" ||
      typeof rec.stageLabel !== "string" ||
      typeof rec.family !== "string" ||
      typeof rec.stepIndex !== "number" ||
      typeof rec.jobId !== "string"
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const lanes = FACTORY_STAGE_LANES;
  const cancelled = factory.stage === "Cancelled";
  // Hooks corridos por lane (daemon `hooks`) + agentes declarados aún no
  // corridos (daemon `hookAgents`, fallback legacy `hookStages`): estos
  // últimos se muestran pending con su NOMBRE hasta que el pipeline los
  // ejecuta. Sin ninguno → nada.
  let hooksByLane: Record<string, Array<{ name: string; label: string; status: string }>> = {};
  let pendingByLane: Record<string, DeclaredHookAgentView[]> = {};
  try {
    const raw = (factory as { hooks?: unknown }).hooks;
    if (Array.isArray(raw)) {
      const map: Record<string, Array<{ name: string; label: string; status: string }>> = {};
      for (const entry of raw) {
        try {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
          const rec = entry as { name?: unknown; stage?: unknown; status?: unknown };
          if (typeof rec.name !== "string" || !rec.name.trim()) continue;
          if (typeof rec.status !== "string" || !rec.status.trim()) continue;
          const lane = typeof rec.stage === "string" ? (HOOK_STAGE_LANE[rec.stage.trim()] ?? "") : "";
          if (!lane) continue;
          if (!map[lane]) map[lane] = [];
          if (map[lane].length < 5) {
            const name = rec.name.trim().slice(0, 32);
            map[lane].push({
              name,
              label: humanizeAgentName(name) || name,
              status: rec.status.trim(),
            });
          }
        } catch {
          // una corrida rota nunca aborta a las demás
        }
      }
      hooksByLane = map;
    }
    // Pending = agente declarado cuyo nombre todavía no corrió en su lane
    // (si ya corrió, manda el chip de ejecución y no se duplica).
    const declared = declaredHookAgentsByLane(factory);
    const pendingMap: Record<string, DeclaredHookAgentView[]> = {};
    for (const [lane, agents] of Object.entries(declared)) {
      for (const agent of agents) {
        if ((hooksByLane[lane] ?? []).some((h) => h.name === agent.name)) continue;
        if (!pendingMap[lane]) pendingMap[lane] = [];
        if (pendingMap[lane].length < 5) pendingMap[lane].push(agent);
      }
    }
    pendingByLane = pendingMap;
  } catch {
    hooksByLane = {};
    pendingByLane = {};
  }
  const familyKey = cancelled ? "cancelled" : factory.family;
  const familyBadge = FACTORY_FAMILY_BADGE[familyKey] ?? {
    color: "var(--wp-text-disabled)",
  };
  const familyText =
    cancelled || typeof factory.family !== "string"
      ? "CANCELLED"
      : (() => {
          try {
            return factory.family.toUpperCase();
          } catch {
            return "UNKNOWN";
          }
        })();
  // B4: a restored-but-never-resumed job must not fake progress — say so.
  const stalledNote =
    !cancelled && !factory.terminal && factory.stalled === true
      ? " · stalled — no daemon update for a while; the daemon may have restarted without resuming this job."
      : "";
  const caption = cancelled
    ? "Cancelled — the agent stopped without completing."
    : factory.terminal
      ? "Complete — the agent finished."
      : factory.family === "queued"
        ? `${factory.stageLabel} · queued — waiting for the worker; the row stays here until the daemon picks it up.${stalledNote}`
        : `${factory.stageLabel} · running.${stalledNote}`;
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px 14px",
        borderRadius: 8,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          margin: "0 0 14px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Agent progress
        </p>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            letterSpacing: "0.05em",
            color: familyBadge.color,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--wp-border)",
            padding: "2px 7px",
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          {familyText}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {lanes.map((lane, i) => {
          const colors = FACTORY_STAGE_STYLE[lane] ?? {
            accent: "var(--wp-border)",
            label: "var(--wp-text-disabled)",
          };
          const done = !cancelled && i < factory.stepIndex;
          const active = !cancelled && i === factory.stepIndex;
          return (
            <div
              key={lane}
              style={{ display: "flex", alignItems: "flex-start", flex: 1 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: 1,
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background:
                      active || done ? colors.accent : "var(--wp-bg-hover)",
                    border: active
                      ? `2px solid ${colors.accent}`
                      : done
                        ? "none"
                        : "2px solid var(--wp-border)",
                    // Solid token glow (no alpha suffix: accents are
                    // `var(--wp-*)`, where a hex `60` suffix would be
                    // invalid CSS and silently drop the shadow).
                    boxShadow: active ? `0 0 10px ${colors.accent}` : "none",
                    transition: "all 200ms",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 9,
                    lineHeight: 1.4,
                    textAlign: "center",
                    color: active
                      ? colors.label
                      : done
                        ? "var(--wp-text-tertiary)"
                        : "var(--wp-text-disabled)",
                  }}
                >
                  {lane}
                </span>
                {(pendingByLane[lane] ?? []).map((agent) => (
                  <span
                    key={`${lane}-pending-${agent.name}`}
                    title={`${agent.label} · hook declarado (${agent.stage}${agent.blocking ? " · blocking" : ""}): aún no corre en este job`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      maxWidth: "100%",
                      fontFamily: "var(--wp-font-mono)",
                      fontSize: 8,
                      lineHeight: 1.4,
                      color: "#4a4a4a",
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        flexShrink: 0,
                        border: "1px solid #4a4a4a",
                        background: "transparent",
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {agent.label}
                    </span>
                  </span>
                ))}
                {(hooksByLane[lane] ?? []).map((hook) => (
                  <span
                    key={`${lane}-${hook.name}`}
                    title={`hook ${hook.label}: ${hook.status}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      maxWidth: "100%",
                      fontFamily: "var(--wp-font-mono)",
                      fontSize: 8,
                      lineHeight: 1.4,
                      color: "var(--wp-text-disabled)",
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: hookStatusColor(hook.status),
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {hook.label}
                    </span>
                  </span>
                ))}
              </div>
              {i < lanes.length - 1 && (
                <div
                  style={{
                    height: 1,
                    flex: 1,
                    background: done
                      ? "rgba(255,255,255,0.1)"
                      : "var(--wp-border-subtle)",
                    marginTop: 5,
                    minWidth: 8,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <p
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "var(--wp-text-tertiary)",
          margin: "10px 0 0",
          lineHeight: 1.6,
        }}
      >
        {caption}
      </p>
      {factory.jobId !== "" && (
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            margin: "4px 0 0",
          }}
        >
          {factory.jobId}
          {describeFactorySessionLine(factory)}
        </p>
      )}
      {factory.branch ? (
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            margin: "4px 0 0",
          }}
        >
          {"Isolated branch " + factory.branch}
        </p>
      ) : null}
      {factory.prUrl ? (
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            margin: "4px 0 0",
          }}
        >
          <a
            href={factory.prUrl}
            onClick={(e) => {
              e.preventDefault();
              openIssueInGitHub(factory.prUrl);
            }}
            style={{
              color: "var(--wp-accent)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {"View pull request" +
              (typeof factory.prNumber === "number"
                ? " #" + factory.prNumber
                : "")}
          </a>
          {" — opened by the daemon for human review; merging stays a human decision."}
        </p>
      ) : null}
      {started && (
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            margin: "4px 0 0",
          }}
        >
          Phase started {started}
        </p>
      )}
    </div>
  );
}

// ─── Routing decisions (Foreman / Triage) ────────────────────────────────────

/** Verbatim daemon decision kinds → short panel labels. */
const FOREMAN_DECISION_LABEL: Record<string, string> = {
  building: "BUILDING",
  needs_triage: "TRIAGE",
  needs_input: "NEEDS INPUT",
  error: "ERROR",
};

const TRIAGE_DECISION_LABEL: Record<string, string> = {
  building: "BUILDING",
  spec: "SPEC",
  triage: "TRIAGE",
};

function DecisionBadge({
  text,
  color,
  background,
  border,
}: {
  text: string;
  color: string;
  background: string;
  border: string;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--wp-font-mono)",
        fontSize: 9,
        letterSpacing: "0.05em",
        color,
        background,
        border: `1px solid ${border}`,
        padding: "1px 6px",
        borderRadius: 4,
        flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}

function DecisionRow({
  source,
  target,
  reason,
  confidence,
  badges,
}: {
  source: string;
  target: string;
  reason?: string;
  confidence?: number;
  badges: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "9px 0 0",
        marginTop: 9,
        borderTop: "1px solid var(--wp-border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            letterSpacing: "0.05em",
          }}
        >
          {source}
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
          }}
        >
          →
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "#fbbf24",
            letterSpacing: "0.05em",
          }}
        >
          {target}
        </span>
        {typeof confidence === "number" && Number.isFinite(confidence) ? (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              color: "var(--wp-text-disabled)",
            }}
          >
            {`${Math.round(confidence * 100)}%`}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {badges}
      </div>
      {typeof reason === "string" && reason !== "" ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--wp-font-sans)",
            fontSize: 11,
            lineHeight: 1.55,
            color: "var(--wp-text-secondary)",
            wordBreak: "break-word",
          }}
        >
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Routing decisions of the linked factory job: WHY the Foreman sent the
 * issue to Triage (or Building) and what the Triage agent decided, with the
 * daemon's verbatim reason/confidence. Data comes from the existing 2.5s
 * poll (`foreman` / `triage` summary projections) — zero new fetches.
 * Renders nothing without decisions (honest-empty).
 */
function FactoryDecisionsBlock({
  factory,
}: {
  factory: NonNullable<Issue["factory"]>;
}) {
  const foreman = factory.foremanDecision;
  const triage = factory.triageDecision;
  if (!foreman && !triage) return null;
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px 14px",
        borderRadius: 8,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "var(--wp-text-disabled)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        Routing decisions
      </p>
      {foreman ? (
        <DecisionRow
          source="FOREMAN"
          target={FOREMAN_DECISION_LABEL[foreman.decision] ?? foreman.decision.toUpperCase()}
          {...(typeof foreman.reason === "string" ? { reason: foreman.reason } : {})}
          {...(typeof foreman.confidence === "number"
            ? { confidence: foreman.confidence }
            : {})}
          badges={
            foreman.retryable ? (
              <DecisionBadge
                text="RETRYABLE"
                color="#fbbf24"
                background="rgba(251,191,36,0.1)"
                border="rgba(251,191,36,0.25)"
              />
            ) : null
          }
        />
      ) : null}
      {triage ? (
        <DecisionRow
          source="TRIAGE"
          target={TRIAGE_DECISION_LABEL[triage.decision] ?? triage.decision.toUpperCase()}
          {...(typeof triage.reason === "string" ? { reason: triage.reason } : {})}
          {...(typeof triage.confidence === "number"
            ? { confidence: triage.confidence }
            : {})}
          badges={
            triage.fallback ? (
              <DecisionBadge
                text="FALLBACK — LLM UNAVAILABLE"
                color="#f85149"
                background="rgba(248,81,73,0.08)"
                border="rgba(248,81,73,0.3)"
              />
            ) : null
          }
        />
      ) : null}
    </div>
  );
}

// ─── Awaiting descriptions ────────────────────────────────────────────────────

const AWAIT_DESC: Record<AwaitingAction, string> = {
  "review-ready":
    "The agent finished implementing. Review the diff and approve or request changes.",
  "changes-requested":
    "The review returned change requests. Trigger the fix agent to address them.",
  "merge-ready":
    "The PR has been approved and all checks pass. Merge when ready.",
  "spec-approval":
    "The agent drafted a spec and waits for your approval before building.",
  "triage-respond":
    "The agent needs answers before it can plan the work. Respond below.",
  "ask-human":
    "The reviewer could not decide alone. Accept to finish the job, or Reject to send it back to Building.",
  "resume":
    "The app restarted mid-turn and the job was parked honestly. Resume re-drives the phase worker from where it stood.",
};

// ─── Primary action button ────────────────────────────────────────────────────

const PRIMARY_KIND: Record<AwaitingAction, ActivityActionKind> = {
  "review-ready": "review",
  "changes-requested": "fix",
  "merge-ready": "merge",
  "spec-approval": "approve-spec",
  "triage-respond": "triage-respond",
  "ask-human": "review-accept",
  "resume": "resume",
};

function PrimaryBtn({
  issue,
  aw,
  defs,
  onAction,
}: {
  issue: Issue;
  aw: (typeof AWAIT)[AwaitingAction] | null;
  defs: Map<ActivityActionKind, ActivityActionDef>;
  onAction: (kind: ActivityActionKind) => void;
}) {
  if (issue.status === "pending") {
    const def = defs.get("resolve");
    return (
      <ActionBtn
        label={def?.label ?? "Resolve Issue"}
        icon={<IconPlay size={12} />}
        bg="var(--wp-accent)"
        hoverBg="var(--wp-accent-hover)"
        disabled={!def?.enabled}
        title={def?.title}
        onClick={() => onAction("resolve")}
        ariaLabel={def?.label ?? "Resolve Issue"}
      />
    );
  }

  if (issue.status === "in-progress") {
    const def = defs.get("session");
    return (
      <ActionBtn
        label={def?.label ?? "View Agent"}
        icon={<IconAgent size={13} />}
        bg="var(--wp-accent)"
        hoverBg="var(--wp-accent-hover)"
        disabled={!def?.enabled}
        title={def?.title}
        onClick={() => onAction("session")}
        ariaLabel={def?.label ?? "View Agent"}
      />
    );
  }

  if (issue.status === "awaiting" && aw && issue.awaitingAction) {
    const kind = PRIMARY_KIND[issue.awaitingAction];
    const def = defs.get(kind);
    const icons: Record<AwaitingAction, ReactNode> = {
      "review-ready": <IconAgent size={13} />,
      "changes-requested": <IconFix size={13} />,
      "merge-ready": <IconMerge size={13} />,
      "spec-approval": <IconAgent size={13} />,
      "triage-respond": <IconFix size={13} />,
      "ask-human": <IconMerge size={13} />,
      "resume": <IconAgent size={13} />,
    };
    return (
      <ActionBtn
        label={def?.label ?? AWAITING_LABELS[issue.awaitingAction]}
        icon={icons[issue.awaitingAction]}
        bg={aw.btnBg}
        hoverBg={aw.btnHover}
        disabled={!def?.enabled}
        title={def?.title}
        onClick={() => onAction(kind)}
        ariaLabel={def?.label ?? AWAITING_LABELS[issue.awaitingAction]}
      />
    );
  }

  // Ready to Merge rows carry awaitingAction merge-ready (same Merge CTA as
  // the awaiting surface — the status only moves them to their own section).
  if (issue.status === "ready") {
    const def = defs.get("merge");
    return (
      <ActionBtn
        label={def?.label ?? "Merge PR"}
        icon={<IconMerge size={13} />}
        bg="var(--wp-accent)"
        hoverBg="var(--wp-accent-hover)"
        disabled={!def?.enabled}
        title={def?.title}
        onClick={() => onAction("merge")}
        ariaLabel={def?.label ?? "Merge PR"}
      />
    );
  }

  if (issue.status === "done") {
    const def = defs.get("session");
    // The shared matrix labels the session placeholder "View Agent"; the
    // done column keeps the Figma "View Session" wording (pre-existing
    // string — enabled/title still come from the shared def).
    const label = "View Session";
    return (
      <ActionBtn
        label={label}
        secondary
        icon={<IconSession size={13} />}
        bg="var(--wp-bg-elevated)"
        hoverBg="var(--wp-bg-hover)"
        border="1px solid var(--wp-border)"
        textColor="var(--wp-text-tertiary)"
        disabled={!def?.enabled}
        title={def?.title}
        onClick={() => onAction("session")}
        ariaLabel={label}
      />
    );
  }

  return null;
}

/**
 * Linked daemon job id for a row (human-gate target or explicit cleanup):
 * the awaiting need's job first, then the row's factory job. Junk anywhere
 * degrades to null (honest disabled downstream, never a dead request).
 * Never throws.
 */
function linkedFactoryJobId(issue: Issue, factoryNeed: unknown): string | null {
  try {
    const needId =
      factoryNeed !== null && typeof factoryNeed === "object" && !Array.isArray(factoryNeed)
        ? (factoryNeed as { jobId?: unknown }).jobId
        : undefined;
    if (typeof needId === "string" && needId.trim() !== "") return needId;
    const v = (issue as { factory?: unknown }).factory;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const jobId = (v as { jobId?: unknown }).jobId;
    return typeof jobId === "string" ? jobId : null;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Plain-record guard for store slices that arrive from async lookups /
 * persisted hydration and may be undefined or wrong-type at the exact
 * review→awaiting transition. Non-records degrade to null (honest-empty).
 * Never throws. Exported for offline transition-shape tests.
 */
export function asRecordSlice(value: unknown): Record<string, unknown> | null {
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * String-array guard for row label slices (null→array, object→array flips
 * on the review→awaiting path). Non-strings are dropped. Never throws.
 * Exported for offline transition-shape tests.
 */
export function asStringList(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];
    return (value as unknown[]).filter(
      (entry): entry is string => typeof entry === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Primary PR state for the guard matrix, resolved from the same maps the
 * live adapter reads (store open PRs, else the primary linked PR). Returns
 * `"loading"` while the lookup runs and `"unknown"` when no lookup result
 * exists — both disable honestly instead of guessing OPEN. Never throws,
 * even when either store slice is undefined or wrong-type (the exact
 * review→awaiting flip: `"loading"` entries, null→object transitions).
 * Exported for offline transition-shape tests.
 */
export function prStateForIssue(
  prsByIssue: unknown,
  openPrsByIssue: unknown,
  issueNumber: number,
  prNumber: number | null,
): string {
  try {
    const prsTable = asRecordSlice(prsByIssue);
    const primary: unknown =
      prsTable !== null ? prsTable[issueNumber] : undefined;
    if (prNumber === null) {
      return primary === "loading" ? "loading" : "unknown";
    }
    const openTable = asRecordSlice(openPrsByIssue);
    const openRaw: unknown =
      openTable !== null ? openTable[issueNumber] : undefined;
    const openList = Array.isArray(openRaw) ? openRaw : [];
    let open: LinkedPr | undefined;
    try {
      open = openList.find(
        (pr: unknown) =>
          pr !== null &&
          typeof pr === "object" &&
          !Array.isArray(pr) &&
          (pr as { number?: unknown }).number === prNumber &&
          typeof (pr as { state?: unknown }).state === "string",
      ) as LinkedPr | undefined;
    } catch {
      open = undefined;
    }
    if (open) {
      try {
        return typeof open.state === "string" ? open.state : "unknown";
      } catch {
        return "unknown";
      }
    }
    if (primary === "loading") return "loading";
    if (
      primary !== null &&
      typeof primary === "object" &&
      !Array.isArray(primary) &&
      (primary as { number?: unknown }).number === prNumber &&
      typeof (primary as { state?: unknown }).state === "string"
    ) {
      return (primary as { state: string }).state;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Human-gate context block (factory rows waiting for the human).
 * Context only — the acting CTA (Approve / Respond / Accept) lives in
 * the footer primary button (panel convention); triage drafts live here
 * and gate the footer Respond button via `triageAnswersReady`. Panel
 * palette throughout (`--wp-*` fonts/colors, 12/14px rhythm, radius 8).
 * Never throws (defensive reads; empty lists render nothing extra).
 */
function FactoryNeedBlock({
  need,
  accent,
  bg,
  border,
  labelColor,
  questions,
  drafts,
  onDraft,
}: {
  need: NonNullable<Issue["factoryAwaiting"]>;
  accent: string;
  bg: string;
  border: string;
  labelColor: string;
  questions: string[];
  drafts: string[];
  onDraft: (index: number, value: string) => void;
}) {
  // Junk `need` (wrong-type poll-list entry on the transition) renders
  // nothing instead of throwing on `.kind` reads.
  try {
    if (need === null || typeof need !== "object" || Array.isArray(need)) {
      return null;
    }
  } catch {
    return null;
  }
  const kind: unknown = (need as { kind?: unknown }).kind;
  const safeQuestions = Array.isArray(questions)
    ? questions.filter((q): q is string => typeof q === "string")
    : [];
  const safeDrafts: string[] = Array.isArray(drafts) ? drafts : [];
  const contextText =
    kind === "spec-approval"
      ? (typeof (need as { specSummary?: unknown }).specSummary === "string"
          ? ((need as { specSummary: string }).specSummary)
          : "")
      : kind === "ask-human"
        ? (typeof (need as { reviewSummary?: unknown }).reviewSummary ===
            "string"
            ? ((need as { reviewSummary: string }).reviewSummary)
            : "")
        : "";
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom:
            contextText !== "" || safeQuestions.length > 0 ? 8 : 0,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: labelColor,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {kind === "spec-approval"
            ? "Waiting on spec approval"
            : kind === "triage-respond"
              ? "Waiting on your answers"
              : kind === "resume"
                ? "Interrupted — resume when ready"
                : "Waiting on your decision"}
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
          }}
        >
          {typeof (need as { jobId?: unknown }).jobId === "string"
            ? ((need as { jobId: string }).jobId)
            : ""}
        </span>
      </div>
      {contextText !== "" && (
        <p
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            color: "var(--wp-text-secondary)",
            lineHeight: 1.6,
            margin: "0 0 4px",
            overflowWrap: "break-word",
          }}
        >
          {contextText}
        </p>
      )}
      {kind === "triage-respond" && safeQuestions.length > 0 && (
        <ol
          style={{
            margin: "4px 0 0",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {safeQuestions.map((question, index) => (
            <li
              key={index}
              style={{
                fontFamily: "var(--wp-font-sans)",
                fontSize: 12,
                color: "var(--wp-text-secondary)",
                lineHeight: 1.6,
              }}
            >
              <span style={{ overflowWrap: "break-word" }}>{question}</span>
              <input
                type="text"
                aria-label={`Answer ${index + 1}`}
                placeholder={`Answer ${index + 1}…`}
                value={
                  typeof safeDrafts[index] === "string"
                    ? safeDrafts[index]
                    : ""
                }
                onChange={(e) => onDraft(index, e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 6,
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 6,
                  border: "1px solid var(--wp-border)",
                  background: "var(--wp-bg)",
                  color: "var(--wp-text-primary)",
                  fontFamily: "var(--wp-font-sans)",
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Isolated-worktree block (explicit cleanup only — never automatic;
 * Ready to Merge + Done rows — the caller gates on those statuses).
 * Canvas `ProjectTree` two-stage parity inside the detail pane:
 * - idle: path + Delete button (honestly disabled without a recorded path
 *   or while the job runs — never a dead click).
 * - soft: first confirm — states exactly what is removed (the folder).
 * - force: second confirm after a force-gated 409 (dirty worktree or
 *   open/unknown PR) — states that uncommitted changes are discarded.
 * Panel palette throughout (`--wp-*`). Never throws (defensive reads).
 */
function WorktreeBlock({
  worktreePath,
  deleteDef,
  confirmStage,
  onStageChange,
  onDelete,
}: {
  worktreePath: string | null;
  deleteDef: ActivityActionDef | undefined;
  confirmStage: "idle" | "soft" | "force";
  onStageChange: (stage: "idle" | "soft" | "force") => void;
  onDelete: (force: boolean) => void;
}) {
  // No linked factory job → no worktree concept on this row (legacy
  // canvas rows): the block stays out instead of showing a dead button.
  if (deleteDef === undefined) return null;
  const hasInfo =
    deleteDef.enabled ||
    (typeof deleteDef.title === "string" && deleteDef.title !== "") ||
    (typeof worktreePath === "string" && worktreePath !== "");
  if (!hasInfo) return null;
  const path =
    typeof worktreePath === "string" && worktreePath !== ""
      ? worktreePath
      : null;
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 13px",
        borderRadius: 7,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            width: 52,
            flexShrink: 0,
          }}
        >
          worktree
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 11,
            color: "var(--wp-text-tertiary)",
            overflowWrap: "anywhere",
            flex: 1,
          }}
        >
          {path ?? "No isolated worktree recorded for this job yet"}
        </span>
      </div>
      {confirmStage === "idle" && (
        <button
          type="button"
          disabled={!deleteDef.enabled}
          title={deleteDef.title}
          aria-label="Delete isolated worktree"
          onClick={() => onStageChange("soft")}
          style={{
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            border: "1px solid rgba(248,81,73,0.5)",
            background: "rgba(248,81,73,0.1)",
            color: "#f85149",
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            fontWeight: 600,
            cursor: deleteDef.enabled ? "pointer" : "not-allowed",
            opacity: deleteDef.enabled ? 1 : 0.55,
          }}
        >
          Delete Worktree
        </button>
      )}
      {confirmStage === "soft" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: 12,
              color: "var(--wp-text-secondary)",
              lineHeight: 1.6,
              margin: 0,
              overflowWrap: "anywhere",
            }}
          >
            {`Remove ${path ?? "the isolated worktree"}? The folder is deleted; the branch is kept.`}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <WorktreeConfirmBtn
              label="Remove worktree"
              onClick={() => onDelete(false)}
            />
            <WorktreeCancelBtn onClick={() => onStageChange("idle")} />
          </div>
        </div>
      )}
      {confirmStage === "force" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: 12,
              color: "var(--wp-text-secondary)",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            The worktree has uncommitted changes or its PR is still open.
            Force removal discards them — the branch is still kept.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <WorktreeConfirmBtn
              label="Force remove"
              onClick={() => onDelete(true)}
            />
            <WorktreeCancelBtn onClick={() => onStageChange("idle")} />
          </div>
        </div>
      )}
    </div>
  );
}

function WorktreeConfirmBtn({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        flex: 1,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "1px solid rgba(248,81,73,0.5)",
        background: "rgba(248,81,73,0.1)",
        color: "#f85149",
        fontFamily: "var(--wp-font-sans)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function WorktreeCancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Cancel worktree removal"
      onClick={onClick}
      style={{
        flex: 1,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "1px solid var(--wp-border)",
        background: "var(--wp-bg)",
        color: "var(--wp-text-tertiary)",
        fontFamily: "var(--wp-font-sans)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Cancel
    </button>
  );
}

/**
 * Fases que crean una sesión nueva (espejo de `SESSION_ROLES_IN_ORDER` del
 * daemon — `headless-runtime/workItem/jobView.ts`). `implement` se muestra
 * como BUILDING para coincidir con el nombre del stage del pipeline.
 */
const AGENT_SESSION_ROWS: readonly { role: string; label: string }[] = [
  { role: "foreman", label: "FOREMAN" },
  { role: "triage", label: "TRIAGE" },
  { role: "spec", label: "SPEC" },
  { role: "implement", label: "BUILDING" },
  { role: "review", label: "REVIEW" },
];

/**
 * Agent sessions por fase — sección colapsable (mostrar/ocultar) con una
 * fila por fase que crea sesión nueva. Fases sin sesión aún → botón
 * deshabilitado (honesto, nunca un tab muerto); se habilita solo cuando el
 * daemon registra la sesión (poll 2.5s existente, cero polls nuevos).
 * Sin factory vinculada → nada (legacy canvas rows). Nunca lanza.
 */
function AgentSessionsBlock({
  issue,
  opencodeIssue = null,
}: {
  issue: Issue;
  /** Daemon opencode health when NOT healthy (why sessions are missing). */
  opencodeIssue?: string | null;
}) {
  const [open, setOpen] = useState(true);
  let hasFactory = false;
  let byRole: Record<string, string> = {};
  let declaredHookAgents: Array<{ name: string; stage: string }> = [];
  try {
    const v = (issue as { factory?: unknown }).factory;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      hasFactory = true;
      const raw = (v as { sessions?: unknown }).sessions;
      if (Array.isArray(raw)) {
        const map: Record<string, string> = {};
        for (const entry of raw) {
          try {
            if (entry === null || typeof entry !== "object") continue;
            const role = (entry as { role?: unknown }).role;
            const url = (entry as { sessionUrl?: unknown }).sessionUrl;
            if (
              typeof role === "string" &&
              role.trim() !== "" &&
              typeof url === "string" &&
              url.trim() !== ""
            ) {
              map[role.trim()] = url.trim();
            }
          } catch {
            // una entrada rota nunca aborta a las demás
          }
        }
        byRole = map;
      }
      // Roster declarado (daemon `hookAgents`): agentes hook que existen
      // aunque todavía no corrieron — fila deshabilitada desde el minuto 0.
      const rawAgents = (v as { hookAgents?: unknown }).hookAgents;
      if (Array.isArray(rawAgents)) {
        for (const entry of rawAgents) {
          try {
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
            const name = (entry as { name?: unknown }).name;
            const stage = (entry as { stage?: unknown }).stage;
            if (typeof name === "string" && name.trim() !== "") {
              declaredHookAgents.push({
                name: name.trim(),
                stage: typeof stage === "string" ? stage.trim() : "",
              });
            }
          } catch {
            // una entrada rota nunca aborta a las demás
          }
        }
      }
    }
  } catch {
    hasFactory = false;
    byRole = {};
    declaredHookAgents = [];
  }
  if (!hasFactory) return null;
  // Filas hook: TODOS los agentes declarados (nombre visible "Playwright
  // Tester", deshabilitados si aún no tienen sesión) + los roles
  // `hook:<name>` que el adapter anexa para hooks ya corridos pero que ya
  // no están declarados (agente borrado). Detrás de las fijas, sin duplicar.
  let hookRows: Array<{ role: string; label: string }> = [];
  try {
    const seen = new Set<string>();
    for (const agent of declaredHookAgents) {
      const role = `hook:${agent.name}`;
      if (seen.has(role)) continue;
      seen.add(role);
      if (hookRows.length >= 10) break;
      hookRows.push({
        role,
        label: (humanizeAgentName(agent.name) || agent.name).slice(0, 32),
      });
    }
    const executedOnly = Object.keys(byRole)
      .filter((role) => role.startsWith("hook:") && role.length > 5 && !seen.has(role))
      .sort()
      .slice(0, Math.max(0, 10 - hookRows.length))
      .map((role) => ({
        role,
        label: (humanizeAgentName(role.slice(5)) || role.slice(5)).slice(0, 32),
      }));
    hookRows = [...hookRows, ...executedOnly];
  } catch {
    hookRows = [];
  }
  const allRows = [...AGENT_SESSION_ROWS, ...hookRows];
  const available = allRows.filter(
    (row) => byRole[row.role] !== undefined,
  ).length;
  return (
    <div
      style={{
        marginTop: 12,
        borderRadius: 7,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border-subtle)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
          aria-label={`Agent sessions — ${available} of ${allRows.length} available`}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 13px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--wp-text-disabled)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            flex: 1,
            textAlign: "left",
          }}
        >
          Agent sessions
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
          }}
        >
          {`${available}/${allRows.length}`}
        </span>
        <span
          style={{
            display: "flex",
            color: "var(--wp-text-disabled)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 140ms",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 3.5L5 6.5L8 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "4px 13px 12px",
          }}
        >
          {available === 0 &&
          typeof opencodeIssue === "string" &&
          opencodeIssue !== "" ? (
            <p
              style={{
                margin: 0,
                padding: "7px 9px",
                borderRadius: 5,
                background: "rgba(248,81,73,0.07)",
                border: "1px solid rgba(248,81,73,0.25)",
                fontFamily: "var(--wp-font-mono)",
                fontSize: 10,
                lineHeight: 1.5,
                color: "#f0a8a2",
                wordBreak: "break-word",
              }}
            >
              {`No live sessions — ${opencodeIssue}. The daemon starts the agent server on demand; fix the daemon/opencode binary and the sessions appear here.`}
            </p>
          ) : null}
          {allRows.map((row) => {
            const url = byRole[row.role];
            const enabled =
              typeof url === "string" && url !== "" && /^https?:\/\//i.test(url);
            return (
              <div
                key={row.role}
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 10,
                    fontWeight: 600,
                    color: enabled
                      ? "var(--wp-text-secondary)"
                      : "var(--wp-text-disabled)",
                    letterSpacing: "0.06em",
                    flex: 1,
                  }}
                >
                  {row.label}
                </span>
                <button
                  type="button"
                  disabled={!enabled}
                  title={
                    enabled
                      ? `Open the ${row.label} agent session in a new tab`
                      : `The ${row.label} session is not available yet — it appears when the agent reaches this phase`
                  }
                  aria-label={
                    enabled
                      ? `View ${row.label} agent session`
                      : `${row.label} agent session not available yet`
                  }
                  onClick={() => {
                    if (!enabled) return;
                    try {
                      openIssueInGitHub(url);
                    } catch {
                      // apertura best-effort
                    }
                  }}
                  style={{
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "0 12px",
                    borderRadius: 6,
                    border: "1px solid var(--wp-border)",
                    background: enabled
                      ? "var(--wp-bg)"
                      : "transparent",
                    color: enabled
                      ? "var(--wp-text-secondary)"
                      : "var(--wp-text-disabled)",
                    fontFamily: "var(--wp-font-sans)",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    cursor: enabled ? "pointer" : "not-allowed",
                    opacity: enabled ? 1 : 0.55,
                    transition: "background 110ms, color 110ms",
                  }}
                  onMouseEnter={(e) => {
                    if (enabled) {
                      e.currentTarget.style.background =
                        "var(--wp-bg-hover)";
                      e.currentTarget.style.color =
                        "var(--wp-text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (enabled) {
                      e.currentTarget.style.background = "var(--wp-bg)";
                      e.currentTarget.style.color =
                        "var(--wp-text-secondary)";
                    }
                  }}
                >
                  VIEW AGENT
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 2.5H9.5V8M9.5 2.5L2.5 9.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact row button for conflict/gate rows (canvas red-outline style). */
function WorkflowRowBtn({  def,
  onClick,
}: {
  def: ActivityActionDef | undefined;
  onClick: () => void;
}) {
  if (!def) return null;
  return (
    <button
      type="button"
      disabled={!def.enabled}
      title={def.title}
      aria-label={def.label}
      onClick={onClick}
      style={{
        flex: 1,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: 6,
        border: "1px solid rgba(248,81,73,0.5)",
        background: "rgba(248,81,73,0.1)",
        color: "#f85149",
        fontFamily: "var(--wp-font-sans)",
        fontSize: 12,
        fontWeight: 600,
        cursor: def.enabled ? "pointer" : "not-allowed",
        opacity: def.enabled ? 1 : 0.55,
        transition: "background 110ms",
      }}
      onMouseEnter={(e) => {
        if (def.enabled) {
          e.currentTarget.style.background = "rgba(248,81,73,0.2)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(248,81,73,0.1)";
      }}
    >
      {def.label}
    </button>
  );
}

const MERGE_DOT: Record<string, string> = {
  pending: "#6b7280",
  working: "#f59e0b",
  merged: "#22c55e",
  conflicted: "#f85149",
  error: "#f85149",
};

/**
 * Compact merge-progress block — text-only reuse of the existing
 * `mergeProgress` store event stream (max 6 log lines + per-PR dots).
 * Renders only when the run references one of the issue's PRs. No new
 * subscription beyond the existing slice, no canvas import. Never throws.
 */
function MergeProgressBlock({ prNumbers }: { prNumbers: number[] }) {
  const mergeProgress = useIssueReviewStore((s) => s.mergeProgress);
  // Row isolation (item 2): the `mergeProgress` slice arrives from main-process
  // events and persisted hydration and may be mistyped at the exact
  // review→awaiting transition. Every access below degrades to honest-empty
  // instead of throwing mid-render (a throw here used to trip the boundary
  // and read as a panel reset). Evidence: `ActivityPanel.tsx:3066,3069,3092`
  // (`prNumbers.filter` / `log.filter` / `statusByPr[n]` on possibly-undefined
  // slices). Never throws.
  const referenced = useMemo(() => {
    try {
      if (!mergeProgress || typeof mergeProgress !== "object") return [];
      const storeNumbers = (mergeProgress as { prNumbers?: unknown }).prNumbers;
      if (!Array.isArray(storeNumbers)) return [];
      const want = Array.isArray(prNumbers) ? prNumbers : [];
      return (storeNumbers as unknown[]).filter(
        (n): n is number =>
          typeof n === "number" && Number.isFinite(n) && want.includes(n),
      );
    } catch {
      return [];
    }
  }, [mergeProgress, prNumbers]);
  if (!mergeProgress || typeof mergeProgress !== "object") return null;
  if (!Array.isArray(referenced) || referenced.length === 0) return null;
  let lines: Array<{ prNumber: number | null; message: string }> = [];
  try {
    const rawLog = (mergeProgress as { log?: unknown }).log;
    if (!Array.isArray(rawLog)) return null;
    lines = (rawLog as unknown[])
      .flatMap((entry) => {
        try {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
          }
          const rec = entry as Record<string, unknown>;
          const prNumber =
            rec.prNumber === null
              ? null
              : typeof rec.prNumber === "number" && Number.isFinite(rec.prNumber)
                ? (rec.prNumber as number)
                : null;
          // A mistyped prNumber (junk hydrate) drops the line instead of
          // throwing inside the filter below.
          if (rec.prNumber !== null && prNumber === null) return [];
          const message = typeof rec.message === "string" ? rec.message : "";
          if (prNumber !== null && !referenced.includes(prNumber)) {
            // Keep global (null) lines; drop lines for other PRs.
            return [];
          }
          if (prNumber === null && rec.prNumber !== null) return [];
          return [{ prNumber, message }];
        } catch {
          return [];
        }
      })
      .slice(-6);
  } catch {
    return null;
  }
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 13px",
        borderRadius: 7,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {referenced.map((n) => (
          <span
            key={n}
            title={`PR #${n}: ${(() => {
              try {
                const table = (mergeProgress as { statusByPr?: unknown }).statusByPr;
                if (table === null || typeof table !== "object" || Array.isArray(table)) {
                  return "pending";
                }
                const v = (table as Record<string, unknown>)[String(n)];
                return typeof v === "string" && v !== "" ? v : "pending";
              } catch {
                return "pending";
              }
            })()}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "var(--wp-font-mono)",
              fontSize: 10,
              color: "var(--wp-text-tertiary)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  MERGE_DOT[(() => {
                    try {
                      const table = (mergeProgress as { statusByPr?: unknown })
                        .statusByPr;
                      if (
                        table === null ||
                        typeof table !== "object" ||
                        Array.isArray(table)
                      ) {
                        return "pending";
                      }
                      const v = (table as Record<string, unknown>)[String(n)];
                      return typeof v === "string" && v !== "" ? v : "pending";
                    } catch {
                      return "pending";
                    }
                  })()] ?? "#6b7280",
              }}
            />
            #{n}
          </span>
        ))}
        {(() => {
          try {
            return (mergeProgress as { finished?: unknown }).finished === true;
          } catch {
            return false;
          }
        })() && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 10,
              color: "var(--wp-text-disabled)",
            }}
          >
            finished
          </span>
        )}
      </div>
      {lines.map((entry, index) => (
        <p
          key={`${entry.prNumber ?? "all"}-${index}`}
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
            lineHeight: 1.5,
            margin: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {entry.prNumber !== null ? `#${entry.prNumber} ` : ""}
          {entry.message}
        </p>
      ))}
    </div>
  );
}

function ActionBtn({
  label,
  icon,
  bg,
  hoverBg,
  secondary = false,
  border,
  textColor = "#fff",
  onClick,
  disabled = false,
  title,
  ariaLabel,
}: {
  label: string;
  icon: ReactNode;
  bg: string;
  hoverBg: string;
  secondary?: boolean;
  border?: string;
  textColor?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  void secondary;
  return (
    <button
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        borderRadius: 6,
        border: border ?? "none",
        background: bg,
        color: textColor,
        fontFamily: "var(--wp-font-sans)",
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 110ms",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = hoverBg;
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = bg)}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Panel-styled `~USD` line for a linked factory job (same honesty rules
 * as the FactoryLab CostBadge, panel `--wp-*` styling, neutral English):
 * tracking off (`null`) → "—"; no data yet (`undefined` or 0 calls) →
 * honest label, never an invented `USD 0.00`; no rate → calls + tokens
 * without USD; with rate → 4-decimal `~USD` (never a false `0.00`).
 * Returns null when there is nothing to show. Never throws.
 */
function describeFactoryCost(
  summary: IssueFactoryJob["costSummary"],
): { text: string; title: string } | null {
  try {
    if (summary === undefined) return null;
    if (summary === null) {
      return {
        text: "—",
        title: "Cost tracking is off (costTracking: false in factory.yaml)",
      };
    }
    const calls =
      typeof summary.llmCalls === "number" ? summary.llmCalls : NaN;
    if (!Number.isFinite(calls) || calls <= 0) {
      return {
        text: "No cost data yet",
        title: "No LLM calls recorded yet",
      };
    }
    const input =
      typeof summary.estimatedInputTokens === "number" &&
      Number.isFinite(summary.estimatedInputTokens)
        ? summary.estimatedInputTokens
        : 0;
    const output =
      typeof summary.estimatedOutputTokens === "number" &&
      Number.isFinite(summary.estimatedOutputTokens)
        ? summary.estimatedOutputTokens
        : 0;
    let tokens: string;
    try {
      tokens = `~${(input + output).toLocaleString("en-US")} tokens`;
    } catch {
      tokens = `~${input + output} tokens`;
    }
    const callsLabel = `${calls} ${calls === 1 ? "call" : "calls"}`;
    // T4: server-measured usage wins when present (skills/MCPs/context
    // included). Precise: total is NEW tokens (in+out+reasoning); cache is
    // shown separately, never summed (it inflated ~2x, issue #69 case).
    // Calls also prefer the measured server turns. Defensive read, same
    // honesty as CostBadge.
    const measured = (() => {
      try {
        const a = (summary as { actual?: unknown }).actual as Record<string, unknown> | null | undefined;
        if (!a || typeof a !== "object" || Array.isArray(a)) return null;
        const num = (v: unknown): number | null =>
          typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
        const input = num(a.inputTokens);
        const output = num(a.outputTokens);
        const reasoning = num(a.reasoningTokens);
        const cacheRead = num(a.cacheReadTokens);
        const cacheWrite = num(a.cacheWriteTokens);
        const measuredCalls = num(a.calls);
        if (
          input === null ||
          output === null ||
          reasoning === null ||
          cacheRead === null ||
          cacheWrite === null ||
          measuredCalls === null ||
          measuredCalls <= 0
        ) {
          return null;
        }
        const usd =
          typeof a.usd === "number" && Number.isFinite(a.usd) && a.usd >= 0 ? a.usd : null;
        const usdSource = a.usdSource === "server" || a.usdSource === "rates" ? a.usdSource : null;
        return { input, output, reasoning, cacheRead, cacheWrite, calls: measuredCalls, usd, usdSource };
      } catch {
        return null;
      }
    })();
    if (measured !== null) {
      const measuredCalls = measured.calls;
      const measuredCallsLabel = `${measuredCalls} ${measuredCalls === 1 ? "call" : "calls"}`;
      const measuredTotal = measured.input + measured.output + measured.reasoning;
      const measuredCache = measured.cacheRead + measured.cacheWrite;
      let measuredTokens: string;
      try {
        measuredTokens =
          measuredCache > 0
            ? `~${measuredTotal.toLocaleString("en-US")} tokens (+${measuredCache.toLocaleString("en-US")} cache)`
            : `~${measuredTotal.toLocaleString("en-US")} tokens`;
      } catch {
        measuredTokens =
          measuredCache > 0
            ? `~${measuredTotal} tokens (+${measuredCache} cache)`
            : `~${measuredTotal} tokens`;
      }
      const measuredDetail =
        `measured by opencode (skills/MCPs/context included) · in=${measured.input} out=${measured.output} reasoning=${measured.reasoning} cache=${measured.cacheRead}/${measured.cacheWrite}` +
        (measured.usd !== null
          ? ` · USD from ${measured.usdSource === "server" ? "server" : "rates (cache excluded)"}`
          : " · no USD") +
        ` · estimated: ~${input + output} tokens`;
      if (measured.usd !== null) {
        return {
          text: `${measuredCallsLabel} · ${measuredTokens} · ~USD ${measured.usd.toFixed(4)} (measured)`,
          title: measuredDetail,
        };
      }
      return { text: `${measuredCallsLabel} · ${measuredTokens} · measured, no USD`, title: measuredDetail };
    }
    const basis = summary.basis ?? "estimated-chars/4";
    const detail =
      `basis=${basis}` +
      (typeof summary.ratesRef === "string" && summary.ratesRef !== ""
        ? ` ratesRef=${summary.ratesRef}`
        : " no rate") +
      ` · in=${input} out=${output}`;
    const usd = summary.estimatedUSD;
    if (
      usd === null ||
      usd === undefined ||
      typeof usd !== "number" ||
      !Number.isFinite(usd)
    ) {
      return { text: `${callsLabel} · ${tokens} · no rate`, title: detail };
    }
    return {
      text: `${callsLabel} · ${tokens} · ~USD ${usd.toFixed(4)} (est.)`,
      title: detail,
    };
  } catch {
    return null;
  }
}

function MetaRow({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color: string;
  title?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "var(--wp-text-disabled)",
          width: 42,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        title={title}
        style={{ fontFamily: "var(--wp-font-mono)", fontSize: 11, color }}
      >
        {value}
      </span>
    </div>
  );
}

function DateInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 9,
          color: "var(--wp-text-disabled)",
          margin: "0 0 3px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 11,
          color: "var(--wp-text-tertiary)",
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ToolbarBtn({
  children,
  "aria-label": ariaLabel,
  title,
  onClick,
  busy = false,
}: {
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-busy={busy}
      title={title}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        border: "1px solid var(--wp-border)",
        background: "var(--wp-bg-elevated)",
        color: "var(--wp-text-tertiary)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--wp-bg-hover)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--wp-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--wp-bg-elevated)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--wp-text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}
