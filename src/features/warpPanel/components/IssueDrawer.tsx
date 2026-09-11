import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ActivityEvent,
  KanbanColumn,
  KanbanIssue,
  KanbanPr,
  KanbanStatus,
} from "../types";
import { IconClose } from "./warpIcons";
import {
  issueHeaderLabel,
  issueStateDotColor,
  issueStateLabel,
  openIssueInGitHub,
  repoSlugFromUrl,
} from "./KanbanBoard";
import { renderMarkdown } from "../../../utils/markdownClass";
import {
  useIssueReviewStore,
  type ReviewVerdict,
} from "../../../stores/issueReviewStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_CONFLICT,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_GATE_FAIL,
  REVIEW_LABEL_PENDING,
  effectiveReviewLabel,
} from "../../../canvas/reviewVerdict";

/**
 * IssueDrawer — port of figma/Crear panel lateral interactivo
 * src/components/IssueDrawer.tsx.
 *
 * Verbatim JSX, inline styles, hover handlers, ANIM_MS=220 with
 * DETAIL_EASE cubic-bezier(0.32, 0.72, 0, 1), mount animation via
 * requestAnimationFrame, Escape-to-close, backdrop click, status dropdown.
 * Mechanical substitution only: var(--font-*) → var(--wp-font-*).
 *
 * Props-vs-direct-data adaptation: column metadata enters via the `columns`
 * prop (same seam as KanbanBoard) so components/ stays adapter-free.
 */

const STATUS_COLORS: Record<KanbanStatus, string> = {
  backlog: "#22c55e",
  ready: "#3b82f6",
  "in-progress": "#f59e0b",
  "in-review": "#a855f7",
  done: "#f97316",
};

const ANIM_MS = 220;

// Markdown body styling for the always-dark drawer (same GitHub-dark
// palette as the canvas IssueNode card; markdownClassName follows the app
// theme and would be unreadable here in light mode).
const drawerMarkdownClass =
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

export interface IssueDrawerProps {
  issue: KanbanIssue;
  columns: KanbanColumn[];
  onClose: () => void;
  onStatusChange: (s: KanbanStatus) => void;
}

// ─── Canvas-parity helpers ────────────────────────────────────────────────
// Same verdict badge palette and PR state dots as the canvas IssueNode
// card. The drawer is read-only — workflow actions live on the canvas
// card; these are pure view helpers.

/** Canvas footer badge palette, keyed by effective review label. */
function verdictBadgeStyle(effective: string | null): {
  bg: string;
  border: string;
  fg: string;
  text: string;
} | null {
  if (effective === REVIEW_LABEL_GATE_FAIL)
    return {
      bg: "rgba(248,81,73,0.1)",
      border: "1px solid rgba(248,81,73,0.5)",
      fg: "#f85149",
      text: "Gate: fallo",
    };
  if (effective === REVIEW_LABEL_CONFLICT)
    return {
      bg: "rgba(248,81,73,0.1)",
      border: "1px solid rgba(248,81,73,0.5)",
      fg: "#f85149",
      text: "Conflicto con main",
    };
  if (effective === REVIEW_LABEL_APPROVED)
    return {
      bg: "rgba(35,134,54,0.15)",
      border: "1px solid rgba(35,134,54,0.5)",
      fg: "#3fb950",
      text: "Review: aprobado",
    };
  if (effective === REVIEW_LABEL_CHANGES)
    return {
      bg: "rgba(248,81,73,0.1)",
      border: "1px solid rgba(248,81,73,0.5)",
      fg: "#f85149",
      text: "Review: cambios pedidos",
    };
  if (effective === REVIEW_LABEL_FIX_APPLIED)
    return {
      bg: "rgba(88,166,255,0.1)",
      border: "1px solid rgba(88,166,255,0.5)",
      fg: "#58a6ff",
      text: "Review: fix aplicado",
    };
  if (effective === REVIEW_LABEL_PENDING)
    return {
      bg: "rgba(210,153,34,0.1)",
      border: "1px solid rgba(210,153,34,0.5)",
      fg: "#d29922",
      text: "Review: pendiente",
    };
  // No verdict yet (or an unrecognized label): no badge at all. The
  // drawer never renders a "sin veredicto" placeholder — Development
  // shows badges only for real review state.
  return null;
}

function VerdictBadge({ effective }: { effective: string | null }) {
  const badge = verdictBadgeStyle(effective);
  if (badge === null) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: badge.bg,
        border: badge.border,
        color: badge.fg,
        borderRadius: 12,
        padding: "2px 8px",
        fontFamily: "var(--wp-font-sans)",
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "currentColor",
        }}
      />
      {badge.text}
    </span>
  );
}

/** PR state dot — same colors as the canvas Development section. */
function PrStateDot({ state }: { state: string }) {
  const color =
    state === "MERGED" ? "#a371f7" : state === "CLOSED" ? "#f85149" : "#238636";
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function SideSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        paddingBottom: 14,
        borderBottom: "1px solid #1a1a1a",
        marginBottom: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 7,
        }}
      >
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 11,
            fontWeight: 600,
            color: "#666",
            letterSpacing: "0.02em",
          }}
        >
          {title}
        </span>
        {onEdit && (
          <button
            onClick={onEdit}
            style={{
              width: 20,
              height: 20,
              borderRadius: 3,
              border: "none",
              background: "transparent",
              color: "#333",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 120ms, background 120ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#999";
              (e.currentTarget as HTMLButtonElement).style.background =
                "#1e1e1e";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#333";
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path
                d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SideValue({ children }: { children: ReactNode }) {
  return (
    <span
      style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "#555" }}
    >
      {children}
    </span>
  );
}

// ─── Activity event ───────────────────────────────────────────────────────────

function ActivityItem({ event }: { event: ActivityEvent }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        paddingBottom: 14,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 11,
          top: 22,
          bottom: -4,
          width: 1,
          background: "#1c1c1c",
        }}
      />
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: event.actorColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: "var(--wp-font-mono)",
          fontSize: 8,
          fontWeight: 700,
          color: "#000",
          zIndex: 1,
        }}
      >
        {event.actor[0]}
      </div>
      <div style={{ flex: 1, paddingTop: 2 }}>
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            color: "#d0d0d0",
            fontWeight: 600,
          }}
        >
          {event.actor}
        </span>{" "}
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            color: "#555",
          }}
        >
          {event.text}
        </span>{" "}
        {event.type === "linked-pr" && event.detail && (
          <a
            href={event.detailHref ?? "#"}
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: 12,
              color: "#3b82f6",
              textDecoration: "underline",
            }}
          >
            {event.detail}
          </a>
        )}
        {event.type === "added-label" && event.labelName && (
          <span
            style={{
              display: "inline-block",
              padding: "0 7px",
              borderRadius: 12,
              background: event.labelBg,
              fontFamily: "var(--wp-font-sans)",
              fontSize: 11,
              color: event.labelFg,
              marginLeft: 2,
            }}
          >
            {event.labelName}
          </span>
        )}{" "}
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 11,
            color: "#3a3a3a",
          }}
        >
          {event.ago}
        </span>
      </div>
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export function IssueDrawer({
  issue,
  columns,
  onClose,
  onStatusChange,
}: IssueDrawerProps) {
  const [visible, setVisible] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transition-shape guards: every snapshot field that flips on the
  // review→awaiting path (relations array→object, prs array→"loading",
  // labels non-array, body non-string, columns empty) degrades to
  // honest-empty instead of throwing mid-render (the remaining
  // review→awaiting throw lived here, outside `WarpPanelBoundary`).
  const safeColumns = Array.isArray(columns) ? columns : [];
  const col =
    safeColumns.find((c) => c?.id === issue.status) ??
    safeColumns[0] ?? { id: issue.status, label: String(issue.status) };
  const isClosed = issue.githubState === "CLOSED";
  const stateColor = (() => {
    try {
      return issueStateDotColor(issue);
    } catch {
      return "#3fb950";
    }
  })();
  const authorStr =
    typeof (issue as { author?: unknown }).author === "string"
      ? ((issue as { author: string }).author)
      : "";
  const openedAgoStr =
    typeof (issue as { openedAgo?: unknown }).openedAgo === "string"
      ? ((issue as { openedAgo: string }).openedAgo)
      : "";
  const hasAuthorMeta = authorStr !== "" || openedAgoStr !== "";

  // Real repo slug for the header pill, parsed from the live GitHub issue
  // URL (https://github.com/<owner>/<repo>/issues/<n>). Falls back to the
  // adapter-derived repoName when the URL is absent (legacy/mock nodes).
  // Visibility has no real source anywhere in the data — the fetchIssues
  // GraphQL query never requests isPrivate/visibility, and neither
  // projectId nor the workspace/project stores carry it — so no
  // visibility badge is rendered (never invented).
  const repoSlug = repoSlugFromUrl(issue.url) ?? issue.repoName;
  // Top-bar label: the real project name plus the repo slug when it adds
  // information (same helper as the kanban card header).
  const headerLabel = issueHeaderLabel(issue);

  // ── Canvas parity: same live stores, same PR lookup ──
  // The drawer is read-only — workflow actions live on the canvas card.
  // Verdict/label/conflict/gate badges re-resolve from the live maps with
  // the canvas fallback chain (see resolvePrRow). The cwd comes from the
  // mapped `worktreePath` (the canvas `__worktreePath`), exactly like
  // IssueNode.
  const issueNumber = issue.number;
  const worktreePath =
    typeof issue.worktreePath === "string" ? issue.worktreePath : "";
  // Snapshot slices: wrong-type payloads (array→object flips) degrade to
  // honest-empty. PR entries are validated (finite prNumber) so a
  // `"loading"` string entry never reaches `.map`.
  const relations = Array.isArray(issue.relations) ? issue.relations : [];
  const prs = Array.isArray(issue.prs)
    ? issue.prs.filter(
        (p): p is KanbanPr =>
          p !== null &&
          typeof p === "object" &&
          !Array.isArray(p) &&
          typeof (p as { prNumber?: unknown }).prNumber === "number" &&
          Number.isFinite((p as { prNumber: number }).prNumber),
      )
    : [];
  // Store selectors never throw: a mistyped map (bad hydrate on the
  // transition) degrades to the honest-empty slice.
  const reviewVerdict = useIssueReviewStore((s) => {
    try {
      const table = (s as unknown as Record<string, unknown>).verdictByIssue;
      if (table === null || typeof table !== "object" || Array.isArray(table)) {
        return null;
      }
      return (
        ((table as Record<number, ReviewVerdict | null>)[issueNumber] ?? null) as ReviewVerdict | null
      );
    } catch {
      return null;
    }
  });
  const verdictsByPr = useIssueReviewStore((s) => {
    try {
      const table = (s as unknown as Record<string, unknown>).verdictByPr;
      if (table === null || typeof table !== "object" || Array.isArray(table)) {
        return {};
      }
      return table as unknown as Record<number, Record<number, ReviewVerdict | null>>;
    } catch {
      return {};
    }
  });
  const labelsByPr = useIssueReviewStore((s) => {
    try {
      const table = (s as unknown as Record<string, unknown>).labelsByPr;
      if (table === null || typeof table !== "object" || Array.isArray(table)) {
        return {};
      }
      return table as unknown as Record<number, Record<number, string[]>>;
    } catch {
      return {};
    }
  });
  const labelsByIssue = useIssueReviewStore((s) => {
    try {
      const table = (s as unknown as Record<string, unknown>).labelsByIssue;
      if (table === null || typeof table !== "object" || Array.isArray(table)) {
        return {};
      }
      return table as unknown as Record<number, string[]>;
    } catch {
      return {};
    }
  });
  const conflictsByPr = useIssueReviewStore((s) => {
    try {
      const table = (s as unknown as Record<string, unknown>).conflictByPr;
      if (table === null || typeof table !== "object" || Array.isArray(table)) {
        return {};
      }
      return table as unknown as Record<number, Record<number, boolean>>;
    } catch {
      return {};
    }
  });
  const gateByPr = useIssueGateStore((s) => {
    try {
      const table = (s as unknown as Record<string, unknown>).gateByPr;
      if (table === null || typeof table !== "object" || Array.isArray(table)) {
        return {};
      }
      return table as unknown as Record<
        number,
        Record<number, { status: string; reportPath: string | null }>
      >;
    } catch {
      return {};
    }
  });

  const prLabels = (() => {
    try {
      const raw = (labelsByIssue as Record<number, unknown>)[issueNumber];
      if (!Array.isArray(raw)) return [];
      return (raw as unknown[]).filter(
        (entry): entry is string => typeof entry === "string",
      );
    } catch {
      return [];
    }
  })();

  // Same mount behavior as the canvas card: force a fresh PR lookup on
  // every drawer open (reviews/labels may have changed since the last
  // lookup), guarded to first mount so re-renders never spam it.
  const initialPrLookupRef = useRef(false);
  useEffect(() => {
    if (initialPrLookupRef.current) return;
    initialPrLookupRef.current = true;
    useIssueReviewStore
      .getState()
      .requestPrLookup(issueNumber, worktreePath || undefined, true);
  }, [issueNumber, worktreePath]);

  /** Live-enriched row: snapshot PR fields, verdict/labels/conflict/gate
   * re-resolved from the live maps with the canvas fallback chain
   * (`labelsByPr[issue][pr] ?? labelsByIssue[issue]`,
   * `verdictByPr[issue][pr] ?? verdictByIssue[issue]`). When the live
   * maps are absent the chain converges to the snapshot inputs, so the
   * recomputed effective label equals the snapshot one. */
  function resolvePrRow(pr: KanbanPr): {
    labels: string[];
    verdict: ReviewVerdict | null;
    effectiveLabel: string | null;
    conflicted: boolean;
    gate: { status: string; reportPath: string | null } | undefined;
  } {
    try {
      if (pr === null || typeof pr !== "object" || Array.isArray(pr)) {
        return {
          labels: [],
          verdict: null,
          effectiveLabel: null,
          conflicted: false,
          gate: undefined,
        };
      }
      const prNumber = (pr as { prNumber?: unknown }).prNumber;
      // Both map levels are guarded: a wrong-type inner table (string flip)
      // degrades to the snapshot fallback instead of throwing.
      const innerLabels = (() => {
        try {
          const table = labelsByPr as unknown as Record<string, unknown>;
          if (table === null || typeof table !== "object") return undefined;
          const byIssue = (table as Record<string, unknown>)[issueNumber];
          if (byIssue === null || typeof byIssue !== "object") {
            return undefined;
          }
          return (byIssue as Record<string, unknown>)[String(prNumber)];
        } catch {
          return undefined;
        }
      })();
      const liveList = Array.isArray(innerLabels)
        ? (innerLabels as unknown[]).filter(
            (entry): entry is string => typeof entry === "string",
          )
        : prLabels;
      const snapshotList = Array.isArray((pr as { labels?: unknown }).labels)
        ? ((pr as { labels: unknown[] }).labels as unknown[]).filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      const labels = liveList.length > 0 ? liveList : snapshotList;
      const innerVerdict = (() => {
        try {
          const table = verdictsByPr as unknown as Record<string, unknown>;
          if (table === null || typeof table !== "object") return undefined;
          const byIssue = (table as Record<string, unknown>)[issueNumber];
          if (byIssue === null || typeof byIssue !== "object") {
            return undefined;
          }
          return (byIssue as Record<string, unknown>)[String(prNumber)];
        } catch {
          return undefined;
        }
      })();
      const rawVerdict =
        (innerVerdict as ReviewVerdict | null | undefined) ??
        reviewVerdict ??
        ((pr as { verdict?: unknown }).verdict as ReviewVerdict | null) ??
        null;
      const verdict =
        rawVerdict === "APPROVED" ||
        rawVerdict === "CHANGES_REQUESTED" ||
        rawVerdict === "REVIEW_REQUIRED" ||
        rawVerdict === "COMMENTED" ||
        rawVerdict === "FIX_APPLIED"
          ? rawVerdict
          : null;
      const effectiveLabel = (() => {
        try {
          return effectiveReviewLabel(labels, verdict);
        } catch {
          return null;
        }
      })();
      const conflicted = (() => {
        try {
          const table = conflictsByPr as unknown as Record<string, unknown>;
          if (table === null || typeof table !== "object") {
            return (pr as { conflicted?: unknown }).conflicted === true;
          }
          const byIssue = (table as Record<string, unknown>)[issueNumber];
          if (byIssue === null || typeof byIssue !== "object") {
            return (pr as { conflicted?: unknown }).conflicted === true;
          }
          const value = (byIssue as Record<string, unknown>)[String(prNumber)];
          if (typeof value === "boolean") return value;
          return (pr as { conflicted?: unknown }).conflicted === true;
        } catch {
          return false;
        }
      })();
      const gate = (() => {
        try {
          const table = gateByPr as unknown as Record<string, unknown>;
          if (table !== null && typeof table === "object") {
            const byIssue = (table as Record<string, unknown>)[issueNumber];
            if (byIssue !== null && typeof byIssue === "object") {
              const value = (byIssue as Record<string, unknown>)[
                String(prNumber)
              ];
              if (
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value)
              ) {
                return value as {
                  status: string;
                  reportPath: string | null;
                };
              }
            }
          }
          const status = (pr as { gateStatus?: unknown }).gateStatus;
          const reportPath = (pr as { gateReportPath?: unknown }).gateReportPath;
          if (
            status !== "idle" ||
            (typeof reportPath === "string" && reportPath !== "")
          ) {
            return {
              status: typeof status === "string" ? status : "idle",
              reportPath:
                typeof reportPath === "string" ? reportPath : null,
            };
          }
          return undefined;
        } catch {
          return undefined;
        }
      })();
      return { labels, verdict, effectiveLabel, conflicted, gate };
    } catch {
      return {
        labels: [],
        verdict: null,
        effectiveLabel: null,
        conflicted: false,
        gate: undefined,
      };
    }
  }

  // Full markdown body (sanitized HTML via the shared marked+DOMPurify
  // renderer — the same one the canvas IssueNode card uses). A non-string
  // body (null→string flip on the transition) or a poisoned body degrades
  // to honest-empty instead of throwing mid-render.
  const bodyHtml = useMemo(() => {
    try {
      const body = (issue as { body?: unknown }).body;
      if (typeof body !== "string" || body.trim() === "") return "";
      return renderMarkdown(body);
    } catch {
      return "";
    }
  }, [issue.body]);

  // Rendered-markdown links open externally instead of navigating the
  // Electron renderer (same interception pattern as UpdateModal).
  function handleBodyLinkClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (href && /^https?:\/\//.test(href)) {
      e.preventDefault();
      openIssueInGitHub(href);
    }
  }

  // Mount → animate in
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Keyboard dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exit-timer cleanup (same ANIM_MS timing; unmount clears pending onClose)
  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    };
  }, []);

  function handleClose() {
    setVisible(false);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, ANIM_MS);
  }

  const ease = `cubic-bezier(0.32, 0.72, 0, 1)`;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 40,
          opacity: visible ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Issue #${issue.number}: ${issue.title}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(1100px, 78vw)",
          background: "#0f0f0f",
          borderLeft: "1px solid #282828",
          display: "flex",
          flexDirection: "column",
          zIndex: 50,
          overflow: "hidden",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: `transform ${ANIM_MS}ms ${ease}`,
        }}
      >
        {/* Top bar */}
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px 0 20px",
            borderBottom: "1px solid #1a1a1a",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              title={headerLabel}
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                color: "#444",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 320,
              }}
            >
              {headerLabel}
            </span>
            <span style={{ color: "#282828", fontSize: 11 }}>/</span>
            <span
              style={{
                fontFamily: "var(--wp-font-mono)",
                fontSize: 11,
                color: "#666",
              }}
            >
              #{issue.number}
            </span>
            {issue.url && (
              <button
                aria-label={`View issue #${issue.number} on GitHub`}
                title="View on GitHub"
                onClick={() => openIssueInGitHub(issue.url)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 26,
                  padding: "0 10px",
                  marginLeft: 6,
                  borderRadius: 5,
                  border: "1px solid #2a2a2a",
                  background: "#161616",
                  color: "#999",
                  cursor: "pointer",
                  fontFamily: "var(--wp-font-sans)",
                  fontSize: 11,
                  fontWeight: 600,
                  transition: "color 120ms, border-color 120ms",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color =
                    "#e0e0e0";
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    "#3a3a3a";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#999";
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    "#2a2a2a";
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M9.5 2.5h4v4M13.2 2.8L7.5 8.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                View on GitHub
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <TopBtn aria-label="Copy link">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect
                  x="5"
                  y="5"
                  width="8"
                  height="8"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </TopBtn>
            <TopBtn aria-label="Pin issue">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path
                  d="M9.5 1.5l5 5-2 2-1.5-1L8 10.5l.5 1.5-1.5 1.5L5 11l-3 3-1.5-1.5 3-3-2.5-2L2.5 6l1.5.5 3-3-1-1.5 2-2z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </TopBtn>
            <TopBtn aria-label="More">
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <circle cx="3" cy="8" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="13" cy="8" r="1.4" />
              </svg>
            </TopBtn>
            <button
              aria-label="Close"
              onClick={handleClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "#555",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 120ms, color 120ms",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "#1e1e1e";
                (e.currentTarget as HTMLButtonElement).style.color = "#e0e0e0";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "#555";
              }}
            >
              <IconClose size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: main content */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              padding: "22px 26px 40px",
            }}
          >
            {/* Title */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <h1
                style={{
                  fontFamily: "var(--wp-font-sans)",
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#f0f0f0",
                  lineHeight: 1.3,
                  margin: 0,
                  flex: 1,
                  letterSpacing: "-0.02em",
                }}
              >
                {issue.title}
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 16,
                    fontWeight: 400,
                    color: "#3a3a3a",
                    marginLeft: 8,
                  }}
                >
                  #{issue.number}
                </span>
              </h1>
            </div>

            {/* Status row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 20,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 20,
                  background: isClosed ? "#251d42" : "#14532d",
                  border: isClosed ? "1px solid #553a9c" : "1px solid #166534",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: stateColor,
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--wp-font-sans)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: stateColor,
                  }}
                >
                  {issueStateLabel(issue)}
                </span>
              </div>
              {typeof issue.prNumber === "number" &&
                Number.isFinite(issue.prNumber) && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "#0f2036",
                    border: "1px solid #1d4ed840",
                    cursor: "pointer",
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
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
                      fontSize: 11,
                      color: "#4ade80",
                    }}
                  >
                    #{issue.prNumber}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "#161616",
                  border: "1px solid #222",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2H4.5a1 1 0 0 0-.75 1.67.75.75 0 0 1-1.132.975A2.5 2.5 0 0 1 2 11V2.5zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.492 2.492 0 0 1 4.5 9h8V1.5z"
                    fill="#666"
                  />
                </svg>
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 11,
                    color: "#666",
                  }}
                >
                  {repoSlug}
                </span>
              </div>
            </div>

            {/* Author line — compact; hidden when the canvas node carries
                no author metadata (legacy nodes), instead of showing a
                fabricated placeholder. */}
            {hasAuthorMeta && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 20,
                }}
              >
                {authorStr !== "" && (
                  <>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: issue.authorColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "var(--wp-font-mono)",
                        fontSize: 8,
                        fontWeight: 700,
                        color: "#000",
                        flexShrink: 0,
                      }}
                    >
                      {authorStr[0]?.toUpperCase() ?? "?"}
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--wp-font-sans)",
                        fontSize: 11,
                        color: "#888",
                        fontWeight: 600,
                      }}
                    >
                      {authorStr}
                    </span>
                  </>
                )}
                {openedAgoStr !== "" && (
                  <span
                    style={{
                      fontFamily: "var(--wp-font-sans)",
                      fontSize: 11,
                      color: "#3e3e3e",
                    }}
                  >
                    opened {openedAgoStr}
                  </span>
                )}
              </div>
            )}

            {/* Body — full markdown */}
            <div
              style={{
                paddingBottom: 24,
                borderBottom: "1px solid #1a1a1a",
                marginBottom: 24,
              }}
            >
              {bodyHtml !== "" ? (
                <div
                  className={drawerMarkdownClass}
                  onClick={handleBodyLinkClick}
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              ) : (
                <p
                  style={{
                    fontFamily: "var(--wp-font-sans)",
                    fontSize: 13,
                    color: "#3a3a3a",
                    lineHeight: 1.75,
                    margin: 0,
                  }}
                >
                  No description.
                </p>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div
            style={{
              width: 220,
              flexShrink: 0,
              borderLeft: "1px solid #1a1a1a",
              overflowY: "auto",
              padding: "14px 12px 40px",
            }}
          >
            {/* Assignees — no assign yourself, no assign to agent.
                Junk entries (null/string flips on the transition) are
                dropped instead of throwing on `.initials`. */}
            <SideSection title="Assignees">
              {(Array.isArray(issue.assignees)
                ? issue.assignees.filter(
                    (a): a is NonNullable<typeof a> =>
                      a !== null &&
                      typeof a === "object" &&
                      !Array.isArray(a) &&
                      typeof (a as { initials?: unknown }).initials ===
                        "string" &&
                      ((a as { initials: string }).initials.trim() !== ""),
                  )
                : []
              ).length ? (
                (Array.isArray(issue.assignees) ? issue.assignees : [])
                  .filter(
                    (a): a is NonNullable<typeof a> =>
                      a !== null &&
                      typeof a === "object" &&
                      !Array.isArray(a) &&
                      typeof (a as { initials?: unknown }).initials ===
                        "string" &&
                      ((a as { initials: string }).initials.trim() !== ""),
                  )
                  .map((a, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background:
                          typeof (a as { color?: unknown }).color === "string"
                            ? ((a as { color: string }).color)
                            : "#6b7280",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "var(--wp-font-mono)",
                        fontSize: 7,
                        fontWeight: 700,
                        color: "#000",
                      }}
                    >
                      {(a.initials as string)[0] ?? "?"}
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--wp-font-sans)",
                        fontSize: 12,
                        color: "#aaa",
                      }}
                    >
                      {a.initials}
                    </span>
                  </div>
                ))
              ) : (
                <SideValue>No one assigned</SideValue>
              )}
            </SideSection>

            {/* Labels (non-array flip on the transition → honest-empty). */}
            <SideSection title="Labels">
              {(Array.isArray(issue.labels)
                ? issue.labels.filter(
                    (l): l is NonNullable<typeof l> =>
                      l !== null &&
                      typeof l === "object" &&
                      !Array.isArray(l) &&
                      typeof (l as { name?: unknown }).name === "string" &&
                      ((l as { name: string }).name.trim() !== ""),
                  )
                : []
              ).length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(Array.isArray(issue.labels) ? issue.labels : [])
                    .filter(
                      (l): l is NonNullable<typeof l> =>
                        l !== null &&
                        typeof l === "object" &&
                        !Array.isArray(l) &&
                        typeof (l as { name?: unknown }).name === "string" &&
                        ((l as { name: string }).name.trim() !== ""),
                    )
                    .map((l) => (
                      <span
                        key={(l as { name: string }).name}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 12,
                          background:
                            typeof (l as { bg?: unknown }).bg === "string"
                              ? ((l as { bg: string }).bg)
                              : "#27272a",
                          fontFamily: "var(--wp-font-sans)",
                          fontSize: 11,
                          color:
                            typeof (l as { fg?: unknown }).fg === "string"
                              ? ((l as { fg: string }).fg)
                              : "#e5e5e5",
                          fontWeight: 500,
                        }}
                      >
                        {(l as { name: string }).name}
                      </span>
                    ))}
                </div>
              ) : (
                <SideValue>None yet</SideValue>
              )}
            </SideSection>

            {/* Status (replaces Projects) */}
            <SideSection title="Status">
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setStatusOpen((v) => !v)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 9px",
                    borderRadius: 5,
                    border: `1px solid ${(STATUS_COLORS as Record<string, string>)[issue.status] ?? "#22c55e"}40`,
                    background: `${(STATUS_COLORS as Record<string, string>)[issue.status] ?? "#22c55e"}12`,
                    cursor: "pointer",
                    transition: "background 120ms",
                    width: "100%",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background = `${(STATUS_COLORS as Record<string, string>)[issue.status] ?? "#22c55e"}1e`)
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background = `${(STATUS_COLORS as Record<string, string>)[issue.status] ?? "#22c55e"}12`)
                  }
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background:
                        (STATUS_COLORS as Record<string, string>)[
                          issue.status
                        ] ?? "#22c55e",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--wp-font-sans)",
                      fontSize: 12,
                      color:
                        (STATUS_COLORS as Record<string, string>)[
                          issue.status
                        ] ?? "#22c55e",
                      fontWeight: 600,
                      flex: 1,
                      textAlign: "left",
                    }}
                  >
                    {col.label}
                  </span>
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 10 10"
                    fill="none"
                    style={{
                      color:
                        (STATUS_COLORS as Record<string, string>)[
                          issue.status
                        ] ?? "#22c55e",
                      flexShrink: 0,
                    }}
                  >
                    <path
                      d="M2 3.5L5 6.5L8 3.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {statusOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      background: "#161616",
                      border: "1px solid #282828",
                      borderRadius: 6,
                      overflow: "hidden",
                      zIndex: 10,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    }}
                  >
                    {safeColumns.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          onStatusChange(c.id);
                          setStatusOpen(false);
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          padding: "7px 10px",
                          background:
                            issue.status === c.id
                              ? `${(STATUS_COLORS as Record<string, string>)[c.id] ?? "#22c55e"}14`
                              : "transparent",
                          border: "none",
                          cursor: "pointer",
                          transition: "background 90ms",
                        }}
                        onMouseEnter={(e) => {
                          if (issue.status !== c.id)
                            (e.currentTarget as HTMLButtonElement).style.background =
                              "#1e1e1e";
                        }}
                        onMouseLeave={(e) => {
                          if (issue.status !== c.id)
                            (e.currentTarget as HTMLButtonElement).style.background =
                              "transparent";
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background:
                              (STATUS_COLORS as Record<string, string>)[c.id] ??
                              "#22c55e",
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "var(--wp-font-sans)",
                            fontSize: 12,
                            color:
                              issue.status === c.id
                                ? ((STATUS_COLORS as Record<string, string>)[
                                    c.id
                                  ] ?? "#22c55e")
                                : "#aaa",
                          }}
                        >
                          {c.label}
                        </span>
                        {issue.status === c.id && (
                          <span
                            style={{
                              marginLeft: "auto",
                              fontSize: 11,
                              color:
                                (STATUS_COLORS as Record<string, string>)[
                                  c.id
                                ] ?? "#22c55e",
                            }}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </SideSection>

            {/* Relationships — canvas IssueNode parity: bordered cards on
                #010409, 24px state icons, #c9d1d9 semibold titles with no
                underline (hover shifts color only), #8b949e group labels.
                Read-only; workflow actions live on the canvas card. */}
            <div
              style={{
                paddingBottom: 14,
                borderBottom: "1px solid #21262d",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--wp-font-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#c9d1d9",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Relationships
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {(
                  ["Parent", "Blocked by", "Blocking", "Sub-issue"] as const
                ).map((group) => {
                  // Junk relation entries (null/string flips) are dropped
                  // instead of throwing on `.label` reads.
                  const cards = relations.filter(
                    (r): r is NonNullable<typeof r> =>
                      r !== null &&
                      typeof r === "object" &&
                      !Array.isArray(r) &&
                      (r as { label?: unknown }).label === group &&
                      typeof (r as { number?: unknown }).number === "number" &&
                      Number.isFinite((r as { number: number }).number),
                  );
                  return (
                    <div key={group}>
                      <span
                        style={{
                          fontFamily: "var(--wp-font-sans)",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#8b949e",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        {group}
                      </span>
                      {cards.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          {cards.map((rel) => {
                            const isBlockedBy =
                              rel.kind === "blockedBy" ||
                              rel.label === "Blocked by";
                            const isBlocking =
                              rel.kind === "blocking" ||
                              rel.label === "Blocking";
                            return (
                              <div
                                key={`${rel.number}-${rel.label}`}
                                style={{
                                  border: "1px solid #30363d",
                                  borderRadius: 6,
                                  padding: 8,
                                  background: "#010409",
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 8,
                                }}
                              >
                                <div
                                  style={{
                                    flexShrink: 0,
                                    width: 24,
                                    height: 24,
                                  }}
                                >
                                  {rel.state === "CLOSED" ? (
                                    <svg
                                      width="24"
                                      height="24"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                    >
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        stroke="#8957E5"
                                        strokeWidth="2"
                                      />
                                      <path
                                        d="M8 12L11 15L16 9"
                                        stroke="#8957E5"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  ) : isBlocking ? (
                                    <svg
                                      width="24"
                                      height="24"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                    >
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        stroke="#3FB950"
                                        strokeWidth="2"
                                      />
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="2"
                                        fill="#3FB950"
                                      />
                                      <g transform="translate(14, 14)">
                                        <circle
                                          cx="5"
                                          cy="5"
                                          r="4.5"
                                          fill="#10141a"
                                          stroke="#F85149"
                                          strokeWidth="1"
                                        />
                                        <rect
                                          x="2.5"
                                          y="4.5"
                                          width="5"
                                          height="1"
                                          rx="0.5"
                                          fill="#F85149"
                                        />
                                      </g>
                                    </svg>
                                  ) : isBlockedBy ? (
                                    <svg
                                      width="24"
                                      height="24"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                    >
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        stroke="#F85149"
                                        strokeWidth="2"
                                      />
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="2"
                                        fill="#F85149"
                                      />
                                    </svg>
                                  ) : (
                                    <svg
                                      width="24"
                                      height="24"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                    >
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        stroke="#3FB950"
                                        strokeWidth="2"
                                      />
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="2"
                                        fill="#3FB950"
                                      />
                                    </svg>
                                  )}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    minWidth: 0,
                                    flex: 1,
                                  }}
                                >
                                  <a
                                    href={
                                      typeof rel.url === "string" && rel.url !== ""
                                        ? rel.url
                                        : "#"
                                    }
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (
                                        typeof rel.url === "string" &&
                                        rel.url !== ""
                                      )
                                        openIssueInGitHub(rel.url);
                                    }}
                                    onMouseEnter={(e) => {
                                      const a =
                                        e.currentTarget as HTMLAnchorElement;
                                      a.style.color = "#58a6ff";
                                    }}
                                    onMouseLeave={(e) => {
                                      const a =
                                        e.currentTarget as HTMLAnchorElement;
                                      a.style.color = "#c9d1d9";
                                    }}
                                    style={{
                                      fontFamily: "var(--wp-font-sans)",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: "#c9d1d9",
                                      textDecoration: "none",
                                      cursor: "pointer",
                                      lineHeight: 1.4,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      display: "block",
                                    }}
                                    title={`${(typeof rel.title === "string" && rel.title !== "" ? rel.title : `#${rel.number}`)} (${typeof rel.state === "string" ? rel.state.toLowerCase() : "open"})`}
                                  >
                                    {typeof rel.title === "string" &&
                                    rel.title !== ""
                                      ? rel.title
                                      : `#${rel.number}`}
                                  </a>
                                  <span
                                    style={{
                                      fontFamily: "var(--wp-font-sans)",
                                      fontSize: 11,
                                      color: "#8b949e",
                                    }}
                                  >
                                    {group}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          style={{
                            fontFamily: "var(--wp-font-sans)",
                            fontSize: 11,
                            color: "#8b949e",
                            paddingLeft: 4,
                          }}
                        >
                          —
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Development — same PRs as the canvas card sidebar, with
                live verdict / conflict / gate badges. A `"loading"`-string
                `prs` flip can never reach `.map` (filtered to an array
                above); the bare-`prNumber` fallback needs a finite number. */}
            {(prs.length > 0 ||
              (typeof issue.prNumber === "number" &&
                Number.isFinite(issue.prNumber))) && (
              <SideSection title="Development">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {prs.length > 0
                    ? prs.map((pr) => {
                        const row = resolvePrRow(pr);
                        return (
                          <div
                            key={`dev-${pr.prNumber}`}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <PrStateDot
                                state={
                                  typeof pr.state === "string" ? pr.state : ""
                                }
                              />
                              <a
                                href={
                                  typeof pr.url === "string" && pr.url !== ""
                                    ? pr.url
                                    : "#"
                                }
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (
                                    typeof pr.url === "string" &&
                                    pr.url !== ""
                                  )
                                    openIssueInGitHub(pr.url);
                                }}
                                onMouseEnter={(e) => {
                                  const a =
                                    e.currentTarget as HTMLAnchorElement;
                                  a.style.textDecoration = "underline";
                                  a.style.color = "#79c0ff";
                                }}
                                onMouseLeave={(e) => {
                                  const a =
                                    e.currentTarget as HTMLAnchorElement;
                                  a.style.textDecoration = "none";
                                  a.style.color = "#58a6ff";
                                }}
                                style={{
                                  fontFamily: "var(--wp-font-sans)",
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: "#58a6ff",
                                  textDecoration: "none",
                                  cursor: "pointer",
                                  lineHeight: 1.4,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={
                                  typeof pr.title === "string" && pr.title !== ""
                                    ? `#${pr.prNumber} ${pr.title}`
                                    : `PR #${pr.prNumber}`
                                }
                              >
                                #{pr.prNumber}
                                {typeof pr.title === "string" && pr.title !== ""
                                  ? ` ${pr.title}`
                                  : ""}
                              </a>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                flexWrap: "wrap",
                                alignItems: "center",
                                paddingLeft: 13,
                              }}
                            >
                              <VerdictBadge
                                effective={row.effectiveLabel}
                              />
                              {row.conflicted && (
                                <span
                                  style={{
                                    fontFamily: "var(--wp-font-mono)",
                                    fontSize: 10,
                                    color: "#f85149",
                                  }}
                                >
                                  conflict
                                </span>
                              )}
                              {row.gate?.status === "running" && (
                                <span
                                  style={{
                                    fontFamily: "var(--wp-font-mono)",
                                    fontSize: 10,
                                    color: "#d29922",
                                  }}
                                >
                                  gate…
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <PrStateDot state="OPEN" />
                        <span
                          style={{
                            fontFamily: "var(--wp-font-mono)",
                            fontSize: 11,
                            color: "#4ade80",
                          }}
                        >
                          #{issue.prNumber}
                        </span>
                        {issue.prTitle ? (
                          <span
                            style={{
                              fontFamily: "var(--wp-font-sans)",
                              fontSize: 11,
                              color: "#555",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {issue.prTitle}
                          </span>
                        ) : null}
                      </div>
                    )}
                </div>
              </SideSection>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TopBtn({
  children,
  "aria-label": al,
}: {
  children: ReactNode;
  "aria-label": string;
}) {
  return (
    <button
      aria-label={al}
      style={{
        width: 30,
        height: 30,
        borderRadius: 5,
        border: "none",
        background: "transparent",
        color: "#444",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "color 120ms, background 120ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "#bbb";
        (e.currentTarget as HTMLButtonElement).style.background = "#1c1c1c";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "#444";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
