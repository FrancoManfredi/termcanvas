import { memo, useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  KanbanColumn,
  KanbanIssue,
  KanbanStatus,
  ViewMode,
} from "../types";
import { IconRefresh } from "./warpIcons";

/**
 * KanbanBoard — port of figma/Crear panel lateral interactivo
 * src/components/KanbanBoard.tsx.
 *
 * Verbatim JSX, inline styles, hover handlers, timings, cursors, drag-and-drop.
 * Mechanical substitution only: var(--*) → var(--wp-*), ViewMode from shared
 * ../types, icons from ./warpIcons.
 *
 * Props-vs-direct-data adaptation (per design §1.2): the Figma board owns its
 * issue list (useState over KANBAN_ISSUES) and mounts IssueDrawer internally.
 * Here the list lives in useIssues (shell), enters via props, and the drawer
 * mounts in WarpPanelShell so its fixed backdrop covers the sidebar too.
 * Column metadata (labels/descriptions/dots) enters via the `columns` prop so
 * components/ stays adapter-free (§5: only hooks import adapters/*).
 * The filter input stays uncontrolled/decorative, exactly as in Figma.
 */

export interface KanbanBoardProps {
  issues: KanbanIssue[];
  columns: KanbanColumn[];
  onStatusChange: (id: number, status: KanbanStatus) => void;
  onOpenIssue: (id: number) => void;
}

// ─── GitHub fidelity helpers ────────────────────────────────────────────────

/** GitHub palette: open = green, closed = violet. Unknown (legacy nodes
 *  from the open-only fetch) renders as open. */
export function issueStateDotColor(issue: KanbanIssue): string {
  return issue.githubState === "CLOSED" ? "#a371f7" : "#3fb950";
}

export function issueStateLabel(issue: KanbanIssue): "Open" | "Closed" {
  return issue.githubState === "CLOSED" ? "Closed" : "Open";
}

/** Open the real GitHub issue URL via the Electron bridge (same pattern as
 *  the canvas IssueNode card). No-op when there is no URL to open. */
export function openIssueInGitHub(url: string | undefined): void {
  if (!url) return;
  void window.termcanvas?.github?.openUrl?.(url);
}

/**
 * Markdown body → single-line plain-text preview for the card. Strips
 * fenced/inline code, images, links (keeps link text), headings, quotes,
 * emphasis, and collapses whitespace. Pure string transform (no DOM).
 */
export function plainPreviewFromMarkdown(body: string, maxLen = 160): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/[*_~]{1,3}(\S(?:.*?\S)?)[*_~]{1,3}/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Owner/repo slug parsed from a live GitHub issue URL
 * (https://github.com/<owner>/<repo>/issues/<n>). Returns null when the
 * URL is absent or not a GitHub URL (legacy/mock nodes) — callers fall
 * back to `issue.repoName`. Never throws.
 */
export function repoSlugFromUrl(url: string | undefined): string | null {
  if (typeof url !== "string" || url === "") return null;
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

/**
 * Card/drawer header label — the real TermCanvas project name
 * (`KanbanIssue.projectName`, resolved from the project store by the live
 * adapter) plus the GitHub owner/repo slug when it adds information.
 *
 * "Proyecto" (local `ProjectData.name`) and "repo" (GitHub owner/repo from
 * `issue.url`) are different identities: an opaque project id such as
 * "1788190021330-3" is neither, so the URL slug wins over a bare
 * `repoName` whenever present, and a bare `repoName` never repeats next
 * to an equal project name. Nothing is invented: absent sources fall back
 * down the chain (projectName → URL slug → repoName → "").
 */
export function issueHeaderLabel(issue: KanbanIssue): string {
  const slug = repoSlugFromUrl(issue.url);
  const project =
    typeof issue.projectName === "string" && issue.projectName.trim() !== ""
      ? issue.projectName.trim()
      : null;
  const legacy =
    typeof issue.repoName === "string" && issue.repoName !== ""
      ? issue.repoName
      : null;
  if (project !== null && slug !== null) {
    const base = slug.split("/").pop() ?? "";
    return project === base ? slug : `${project} · ${slug}`;
  }
  if (slug !== null) return slug;
  if (project !== null && legacy !== null) {
    return project === legacy ? legacy : project;
  }
  return project ?? legacy ?? "";
}

// ─── View toggle ──────────────────────────────────────────────────────────────

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
      aria-pressed={active}
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
        color: active
          ? "var(--wp-text-secondary)"
          : "var(--wp-text-disabled)",
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

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({
  color,
  dotStyle,
  size = 10,
}: {
  color: string;
  dotStyle: "solid" | "outline" | "half" | "check";
  size?: number;
}) {
  const s: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (dotStyle === "solid") return <span style={{ ...s, background: color }} />;
  if (dotStyle === "outline")
    return <span style={{ ...s, border: `2px solid ${color}` }} />;
  if (dotStyle === "check")
    return (
      <span style={{ ...s, background: color }}>
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 8 8"
          fill="none"
        >
          <path
            d="M1.5 4L3.5 6L6.5 2.5"
            stroke="#fff"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  return (
    <span
      style={{
        ...s,
        border: `2px solid ${color}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "50%",
          height: "100%",
          background: color,
        }}
      />
    </span>
  );
}

// ─── Issue card (shared by both views) ───────────────────────────────────────

export interface IssueCardProps {
  issue: KanbanIssue;
  isDragging: boolean;
  onOpen: (id: number) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
}

/**
 * B1 memo guard: the 2.5s poll rebuilds every `KanbanIssue` object, so a
 * default shallow memo would never bail. This compares exactly the fields
 * the card renders (plus callback refs and the drag flag) — unchanged
 * content skips the render AND the `plainPreviewFromMarkdown` regex chain.
 * Exported for offline unit tests. Never throws.
 */
export function isSameIssueCardProps(
  prev: IssueCardProps,
  next: IssueCardProps,
): boolean {
  try {
    if (prev.isDragging !== next.isDragging) return false;
    if (prev.onOpen !== next.onOpen) return false;
    if (prev.onDragStart !== next.onDragStart) return false;
    if (prev.onDragEnd !== next.onDragEnd) return false;
    const a = prev.issue;
    const b = next.issue;
    if (a === b) return true;
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.number !== b.number ||
      a.title !== b.title ||
      a.body !== b.body ||
      a.status !== b.status ||
      a.priority !== b.priority ||
      a.prNumber !== b.prNumber ||
      a.repoName !== b.repoName ||
      a.projectName !== b.projectName ||
      a.url !== b.url ||
      a.githubState !== b.githubState
    ) {
      return false;
    }
    const al = Array.isArray(a.labels) ? a.labels : [];
    const bl = Array.isArray(b.labels) ? b.labels : [];
    if (al.length !== bl.length) return false;
    for (let i = 0; i < al.length; i += 1) {
      if (al[i]?.name !== bl[i]?.name) return false;
    }
    const aa = Array.isArray(a.assignees) ? a.assignees : [];
    const ba = Array.isArray(b.assignees) ? b.assignees : [];
    return aa.length === ba.length;
  } catch {
    return false;
  }
}

const IssueCard = memo(function IssueCard({
  issue,
  isDragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: IssueCardProps) {
  const [hov, setHov] = useState(false);
  // B1: the markdown-stripping regex chain runs only when the body string
  // itself changes — not on every poll tick that rebuilds the issue object.
  // A non-string body (transition flip) degrades to honest-empty, never a
  // throw inside the regex chain.
  const bodyPreview = useMemo(() => {
    try {
      const body = (issue as { body?: unknown }).body;
      if (typeof body !== "string" || body === "") return "";
      return plainPreviewFromMarkdown(body);
    } catch {
      return "";
    }
  }, [issue.body]);
  // Label slice: a non-array `labels` (transition flip) degrades to [].
  const cardLabels = Array.isArray(
    (issue as { labels?: unknown }).labels,
  )
    ? (
        (issue as { labels: unknown[] }).labels as unknown[]
      ).filter(
        (l): l is { name: string; bg: string; fg: string } =>
          l !== null &&
          typeof l === "object" &&
          !Array.isArray(l) &&
          typeof (l as { name?: unknown }).name === "string",
      )
    : [];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(issue.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(issue.id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: isDragging ? "#111" : hov ? "#1c1c1c" : "#161616",
        border: isDragging
          ? "1px dashed #333"
          : hov
            ? "1px solid #333"
            : "1px solid #212121",
        borderRadius: 6,
        padding: "10px 11px",
        marginBottom: 5,
        cursor: "pointer",
        opacity: isDragging ? 0.35 : 1,
        transition: "background 90ms, border-color 90ms, opacity 100ms",
        userSelect: "none",
        // Perf P0b: el browser salta layout/paint de cards fuera del
        // viewport (`auto` recuerda el tamaño renderizado; navegadores
        // viejos lo ignoran sin romper nada).
        contentVisibility: "auto",
        containIntrinsicSize: "auto 120px",
      }}
    >
      {/* Repo + number + state dot + GitHub link */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginBottom: 5,
        }}
      >
        <span
          title={issueStateLabel(issue)}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: issueStateDotColor(issue),
            flexShrink: 0,
          }}
        />
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="3.5" r="1.5" fill="#4a4a4a" />
          <circle cx="4" cy="12.5" r="1.5" fill="#4a4a4a" />
          <circle cx="12" cy="6" r="1.5" fill="#4a4a4a" />
          <path
            d="M4 5v5M4 5c0 3 8 3 8 0"
            stroke="#4a4a4a"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          title={issueHeaderLabel(issue)}
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "#555",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {issueHeaderLabel(issue)} #{issue.number}
        </span>
        <span style={{ flex: 1 }} />
        {issue.url && (
          <button
            aria-label={`View issue #${issue.number} on GitHub`}
            title="View on GitHub"
            onClick={(e) => {
              e.stopPropagation();
              openIssueInGitHub(issue.url);
            }}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: "none",
              background: "transparent",
              color: "#444",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "color 90ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#999";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#444";
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
          </button>
        )}
      </div>

      {/* Title */}
      <p
        style={{
          fontFamily: "var(--wp-font-sans)",
          fontSize: 12,
          fontWeight: 500,
          color: hov ? "#f0f0f0" : "#c8c8c8",
          lineHeight: 1.45,
          margin: "0 0 8px",
          transition: "color 90ms",
        }}
      >
        {issue.title}
      </p>

      {/* Body preview — plain text, two lines max */}
      {bodyPreview !== "" && (
        <p
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 11,
            color: "#5a5a5a",
            lineHeight: 1.5,
            margin: "0 0 8px",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {bodyPreview}
        </p>
      )}

      {/* Badges — no size, no estimate */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {issue.priority && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: 3,
              background:
                issue.priority === "P0"
                  ? "#7f1d1d"
                  : issue.priority === "P1"
                    ? "#1e3a5f"
                    : "#1c1917",
              color:
                issue.priority === "P0"
                  ? "#fca5a5"
                  : issue.priority === "P1"
                    ? "#93c5fd"
                    : "#a8a29e",
            }}
          >
            {issue.priority}
          </span>
        )}
        {typeof issue.prNumber === "number" &&
          Number.isFinite(issue.prNumber) && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
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
                  color: "#4ade8070",
                }}
              >
                #{issue.prNumber}
              </span>
            </span>
          )}
        {cardLabels.slice(0, 1).map((l) => (
          <span
            key={l.name}
            style={{
              padding: "1px 6px",
              borderRadius: 10,
              background: typeof l.bg === "string" ? l.bg : "#27272a",
              fontFamily: "var(--wp-font-sans)",
              fontSize: 9,
              color: typeof l.fg === "string" ? l.fg : "#e5e5e5",
            }}
          >
            {l.name}
          </span>
        ))}
      </div>
    </div>
  );
}, isSameIssueCardProps);

// ─── Compact row (collapsible view only) ─────────────────────────────────────

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  P0: { bg: "#7f1d1d", fg: "#fca5a5" },
  P1: { bg: "#1e3a5f", fg: "#93c5fd" },
  P2: { bg: "#1c1917", fg: "#a8a29e" },
};

export interface CompactIssueRowProps extends IssueCardProps {
  colDotColor: string;
  colDotStyle: "solid" | "outline" | "half" | "check";
}

/**
 * B1 memo guard for the collapsible view (same poll-churn rationale as
 * `isSameIssueCardProps`, plus the column dot). Never throws.
 */
export function isSameCompactRowProps(
  prev: CompactIssueRowProps,
  next: CompactIssueRowProps,
): boolean {
  try {
    if (prev.colDotColor !== next.colDotColor) return false;
    if (prev.colDotStyle !== next.colDotStyle) return false;
    return isSameIssueCardProps(prev, next);
  } catch {
    return false;
  }
}

const CompactIssueRow = memo(function CompactIssueRow({
  issue,
  colDotColor,
  colDotStyle,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
}: CompactIssueRowProps) {
  const [hov, setHov] = useState(false);
  const pri =
    typeof issue.priority === "string"
      ? (PRIORITY_STYLE[issue.priority] ?? null)
      : null;
  // Transition-shape guards: non-array labels/assignees degrade to empty.
  const rowFirstLabel = (() => {
    try {
      const labels = (issue as { labels?: unknown }).labels;
      if (!Array.isArray(labels) || labels.length === 0) return null;
      const first = labels[0] as unknown;
      if (
        first === null ||
        typeof first !== "object" ||
        Array.isArray(first) ||
        typeof (first as { name?: unknown }).name !== "string"
      ) {
        return null;
      }
      return first as { name: string; bg?: unknown; fg?: unknown };
    } catch {
      return null;
    }
  })();
  const rowAssignees = (() => {
    try {
      const list = (issue as { assignees?: unknown }).assignees;
      if (!Array.isArray(list)) return [];
      return list.filter(
        (a): a is { initials: string; color?: unknown } =>
          a !== null &&
          typeof a === "object" &&
          !Array.isArray(a) &&
          typeof (a as { initials?: unknown }).initials === "string" &&
          ((a as { initials: string }).initials.length ?? 0) > 0,
      );
    } catch {
      return [];
    }
  })();

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(issue.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(issue.id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: "0 10px",
        borderRadius: 5,
        background: isDragging ? "#111" : hov ? "#161616" : "transparent",
        border: isDragging
          ? "1px dashed #2a2a2a"
          : hov
            ? "1px solid #222"
            : "1px solid transparent",
        cursor: "pointer",
        opacity: isDragging ? 0.35 : 1,
        transition: "background 80ms, border-color 80ms",
        userSelect: "none",
        overflow: "hidden",
        // Perf P0b: igual que IssueCard (fila de 36px fijos).
        contentVisibility: "auto",
        containIntrinsicSize: "auto 36px",
      }}
    >
      {/* Status dot (column) + GitHub state dot (open green / closed violet) */}
      <StatusDot color={colDotColor} dotStyle={colDotStyle} size={7} />
      <span
        title={issueStateLabel(issue)}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: issueStateDotColor(issue),
          flexShrink: 0,
        }}
      />

      {/* Issue number */}
      <span
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          color: "#404040",
          flexShrink: 0,
        }}
      >
        #{issue.number}
      </span>

      {/* Separator */}
      <span style={{ color: "#222", fontSize: 10, flexShrink: 0 }}>·</span>

      {/* Title */}
      <span
        style={{
          fontFamily: "var(--wp-font-sans)",
          fontSize: 12,
          fontWeight: 500,
          color: hov ? "#d4d4d4" : "#909090",
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          transition: "color 80ms",
        }}
      >
        {issue.title}
      </span>

      {/* Priority */}
      {pri && (
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 3,
            background: pri.bg,
            color: pri.fg,
            flexShrink: 0,
          }}
        >
          {issue.priority}
        </span>
      )}

      {/* Labels — first one */}
      {rowFirstLabel && (
        <span
          style={{
            padding: "1px 6px",
            borderRadius: 10,
            flexShrink: 0,
            background:
              typeof rowFirstLabel.bg === "string"
                ? rowFirstLabel.bg
                : "#27272a",
            fontFamily: "var(--wp-font-sans)",
            fontSize: 9,
            color:
              typeof rowFirstLabel.fg === "string"
                ? rowFirstLabel.fg
                : "#e5e5e5",
          }}
        >
          {rowFirstLabel.name}
        </span>
      )}

      {/* PR link */}
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
              color: "#4ade8055",
            }}
          >
            #{issue.prNumber}
          </span>
        </span>
      )}

      {/* Assignees */}
      {rowAssignees.slice(0, 2).map((a, i) => (
        <span
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            flexShrink: 0,
            background:
              typeof a.color === "string" ? a.color : "#6b7280",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 7,
            color: "#000",
            fontWeight: 700,
            marginLeft: i > 0 ? -4 : 0,
          }}
        >
          {a.initials[0] ?? "?"}
        </span>
      ))}

      {/* Chevron */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        style={{
          color: hov ? "#444" : "#252525",
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
    </div>
  );
}, isSameCompactRowProps);

// ─── Columns view ─────────────────────────────────────────────────────────────

function ColumnsView({
  issues,
  columns,
  draggingId,
  overCol,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  issues: KanbanIssue[];
  columns: KanbanColumn[];
  draggingId: number | null;
  overCol: KanbanStatus | null;
  onOpen: (id: number) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDragOver: (col: KanbanStatus) => void;
  onDrop: (col: KanbanStatus) => void;
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
      {columns.map((col) => {
        const colIssues = issues.filter((i) => i.status === col.id);
        const isOver = overCol === col.id && draggingId != null;
        return (
          <div
            key={col.id}
            style={{
              width: 272,
              minWidth: 272,
              display: "flex",
              flexDirection: "column",
              height: "100%",
              flexShrink: 0,
            }}
            onDragOver={(e) => {
              e.preventDefault();
              onDragOver(col.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(col.id);
            }}
          >
            {/* Header */}
            <div style={{ paddingBottom: 10, flexShrink: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 5,
                }}
              >
                <StatusDot
                  color={col.dotColor}
                  dotStyle={col.dotStyle}
                  size={10}
                />
                <span
                  style={{
                    fontFamily: "var(--wp-font-sans)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#d4d4d4",
                    flex: 1,
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 11,
                    color: "#444",
                  }}
                >
                  {colIssues.length}
                </span>
                <ColBtn aria-label={`Options for ${col.label}`}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <circle cx="3" cy="8" r="1.4" />
                    <circle cx="8" cy="8" r="1.4" />
                    <circle cx="13" cy="8" r="1.4" />
                  </svg>
                </ColBtn>
                <ColBtn aria-label={`Add to ${col.label}`}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M6 1v10M1 6h10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </ColBtn>
              </div>
              <p
                style={{
                  fontFamily: "var(--wp-font-sans)",
                  fontSize: 11,
                  color: "#383838",
                  margin: 0,
                  paddingLeft: 16,
                  lineHeight: 1.4,
                }}
              >
                {col.description}
              </p>
            </div>
            <div
              style={{
                height: 1,
                background: isOver ? col.dotColor + "70" : "#1c1c1c",
                marginBottom: 8,
                transition: "background 120ms",
              }}
            />
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                paddingRight: 1,
                background: isOver ? col.dotColor + "07" : "transparent",
                borderRadius: 6,
                transition: "background 120ms",
              }}
            >
              {colIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  isDragging={draggingId === issue.id}
                />
              ))}
              {isOver && (
                <div
                  style={{
                    height: 52,
                    borderRadius: 6,
                    border: `2px dashed ${col.dotColor}50`,
                    background: col.dotColor + "09",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--wp-font-mono)",
                    fontSize: 10,
                    color: col.dotColor + "70",
                    marginBottom: 6,
                  }}
                >
                  Move here
                </div>
              )}
            </div>
            <button
              style={{
                width: "100%",
                height: 28,
                marginTop: 5,
                borderRadius: 5,
                border: "1px dashed #1e1e1e",
                background: "transparent",
                color: "#333",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                fontFamily: "var(--wp-font-sans)",
                fontSize: 11,
                flexShrink: 0,
                transition: "all 120ms",
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.borderColor = "#333";
                b.style.color = "#666";
                b.style.background = "#141414";
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLButtonElement;
                b.style.borderColor = "#1e1e1e";
                b.style.color = "#333";
                b.style.background = "transparent";
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1v10M1 6h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Add item
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Collapsible view ─────────────────────────────────────────────────────────

function CollapsibleView({
  issues,
  columns,
  onOpen,
  draggingId,
  onDragStart,
  onDragEnd,
}: {
  issues: KanbanIssue[];
  columns: KanbanColumn[];
  onOpen: (id: number) => void;
  draggingId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "12px 18px 32px",
      }}
    >
      {columns.map((col) => {
        const colIssues = issues.filter((i) => i.status === col.id);
        return (
          <CollapsibleSection
            key={col.id}
            col={col}
            issues={colIssues}
            onOpen={onOpen}
            draggingId={draggingId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        );
      })}
    </div>
  );
}

function CollapsibleSection({
  col,
  issues,
  onOpen,
  draggingId,
  onDragStart,
  onDragEnd,
}: {
  col: KanbanColumn;
  issues: KanbanIssue[];
  onOpen: (id: number) => void;
  draggingId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(col.id !== "done");
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid #1c1c1c`,
        background: "#0c0c0c",
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 13px",
          background: "transparent",
          border: "none",
          borderBottom:
            open && issues.length > 0 ? "1px solid #161616" : "none",
          cursor: "pointer",
          transition: "background 120ms",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <StatusDot color={col.dotColor} dotStyle={col.dotStyle} size={9} />
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            fontWeight: 700,
            color: "#c0c0c0",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flex: 1,
            textAlign: "left",
          }}
        >
          {col.label}
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "#3a3a3a",
            background: "#141414",
            border: "1px solid #1e1e1e",
            padding: "1px 6px",
            borderRadius: 4,
          }}
        >
          {issues.length}
        </span>
        <span
          style={{
            display: "flex",
            color: "#3a3a3a",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 150ms",
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
      {open && issues.length > 0 && (
        <div style={{ padding: "3px 6px 6px" }}>
          {issues.map((issue) => (
            <CompactIssueRow
              key={issue.id}
              issue={issue}
              colDotColor={col.dotColor}
              colDotStyle={col.dotStyle}
              onOpen={onOpen}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              isDragging={draggingId === issue.id}
            />
          ))}
        </div>
      )}
      {open && issues.length === 0 && (
        <p
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "#2a2a2a",
            textAlign: "center",
            padding: "12px 0",
            margin: 0,
          }}
        >
          No issues
        </p>
      )}
    </div>
  );
}

function ColBtn({
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
        width: 22,
        height: 22,
        borderRadius: 4,
        border: "none",
        background: "transparent",
        color: "#3a3a3a",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "color 120ms, background 120ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "#999";
        (e.currentTarget as HTMLButtonElement).style.background = "#1c1c1c";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "#3a3a3a";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function KanbanBoard({
  issues,
  columns,
  onStatusChange,
  onOpenIssue,
}: KanbanBoardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("columns");
  const [draggingId, setDragging] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<KanbanStatus | null>(null);

  const handleDrop = (col: KanbanStatus) => {
    if (draggingId == null) return;
    onStatusChange(draggingId, col);
    setDragging(null);
    setOverCol(null);
  };

  // B1: stable drag callbacks — the memoized cards below bail out of the
  // per-poll re-render only when these refs (plus rendered content) hold.
  const handleDragStart = useCallback((id: number) => {
    setDragging(id);
    setOverCol(null);
  }, []);
  const handleDragEnd = useCallback(() => {
    setDragging(null);
    setOverCol(null);
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--wp-bg)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          borderBottom: "1px solid var(--wp-border-subtle)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--wp-text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          Issues
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
          {issues.length}
        </span>
        <div style={{ flex: 1 }} />
        {/* Filter (uncontrolled, decorative — kept as in Figma; O-4 wires it) */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            padding: "0 10px",
            background: "var(--wp-bg-elevated)",
            border: "1px solid var(--wp-border)",
            borderRadius: 6,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="#555" strokeWidth="1.4" />
            <path
              d="M11 11l3 3"
              stroke="#555"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <input
            placeholder="Filter by keyword"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--wp-font-sans)",
              fontSize: 12,
              color: "var(--wp-text-secondary)",
              width: 140,
            }}
          />
        </label>
        {/* View toggle */}
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <button
          aria-label="Fetch issues"
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
          <IconRefresh size={13} />
        </button>
      </div>

      {/* Content */}
      {viewMode === "columns" ? (
        <ColumnsView
          issues={issues}
          columns={columns}
          draggingId={draggingId}
          overCol={overCol}
          onOpen={onOpenIssue}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={setOverCol}
          onDrop={handleDrop}
        />
      ) : (
        <CollapsibleView
          issues={issues}
          columns={columns}
          onOpen={onOpenIssue}
          draggingId={draggingId}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      )}
    </div>
  );
}
