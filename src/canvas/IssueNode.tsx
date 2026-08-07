import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import type { IssueNodeData } from "../stores/issueStore";
import { useIssueStore } from "../stores/issueStore";
import { useIssueResolveStore } from "../stores/issueResolveStore";
import { useIssueReviewStore } from "../stores/issueReviewStore";
import { useIssueActivityStore } from "../stores/issueActivityStore";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_CONFLICT,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_PENDING,
  effectiveReviewLabel,
} from "./reviewVerdict";
import { renderMarkdown } from "../utils/markdownClass";

type IssueFlowNode = Node<IssueNodeData, "issue">;

// Scoped to the issue card's always-dark GitHub palette (the card never
// follows the app theme). markdownClassName uses theme CSS variables, so it
// would be unreadable here in light mode.
const issueMarkdownClass =
  "text-[#e6edf3] text-sm leading-snug break-words " +
  "[&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:break-words " +
  "[&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:break-words " +
  "[&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:break-words " +
  "[&_p]:my-1.5 [&_p]:break-words [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 [&_li]:break-words " +
  "[&_a]:text-[#58a6ff] [&_a]:no-underline [&_a]:hover:underline [&_a]:break-all " +
  "[&_code]:text-[#e6edf3] [&_code]:bg-[#161b22] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:break-words " +
  "[&_pre]:bg-[#161b22] [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:min-w-0 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-[#30363d] [&_blockquote]:pl-3 [&_blockquote]:text-[#8b949e] " +
  "[&_hr]:border-[#30363d] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:my-2";

// ── helpers ──

function nodes<T>(field: unknown): T[] {
  if (field && typeof field === "object" && Array.isArray((field as Record<string, unknown>).nodes)) return (field as Record<string, unknown>).nodes as T[];
  return [];
}
function str(v: unknown, f = ""): string { return typeof v === "string" ? v : f; }
function num(v: unknown, f = 0): number { return typeof v === "number" ? v : f; }
function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface LabelData { name: string; color?: string }
interface AssigneeData { login: string; name?: string; avatarUrl?: string }
interface MilestoneData { title: string; number: number; dueOn?: string; description?: string }
interface ProjectItemData { project: { title: string; number?: number }; fieldValues: { nodes: Array<Record<string, unknown>> } }

// ── IssueNode ──

export function IssueNode({ data }: NodeProps<IssueFlowNode>) {
  const [minimized, setMinimized] = useState(false);
  const resolvingIssueNumber = useIssueResolveStore(
    (s) => s.resolvingIssueNumber,
  );
  const issueNumber = num(data.number);
  const prStatus = useIssueReviewStore((s) => s.prsByIssue[issueNumber]);
  const reviewVerdict = useIssueReviewStore(
    (s) => s.verdictByIssue[issueNumber] ?? null,
  );
  // Select the labels map itself (stable reference) and derive the issue's
  // array from it: a selector like `labelsByIssue[n] ?? []` would return a
  // fresh array on every evaluation, which useSyncExternalStore treats as a
  // snapshot change and re-renders forever.
  const labelsByIssue = useIssueReviewStore((s) => s.labelsByIssue);
  const prLabels = labelsByIssue[issueNumber] ?? [];
  // Persisted PR cycle label wins over the in-memory verdict (source of
  // truth); the verdict only covers live transitions until the next lookup.
  const effective = effectiveReviewLabel(prLabels, reviewVerdict);
  const reviewingIssueNumber = useIssueReviewStore(
    (s) => s.reviewingIssueNumber,
  );
  const mergingIssueNumber = useIssueReviewStore(
    (s) => s.mergingIssueNumber,
  );
  // Local activity log: select the map itself (stable reference) and derive
  // the per-issue array — same pattern as labelsByIssue above, to avoid a
  // fresh array snapshot on every evaluation. Keyed by the issue's own repo
  // path so activity from another PC (same repo) shows up on load.
  const worktreePath = str((data as Record<string, unknown>).__worktreePath);
  const activityByRepo = useIssueActivityStore((s) => s.activityByRepo);
  const activity = (worktreePath ? activityByRepo[worktreePath]?.[issueNumber] : undefined) ?? [];
  const title = str(data.title, `Issue ${issueNumber}`);
  const url = str(data.url);
  const state = str(data.state, "OPEN");
  const stateReason = str(data.stateReason);
  const body = str(data.body);
  const createdAt = str(data.createdAt);
  const updatedAt = str(data.updatedAt);
  const closedAt = str(data.closedAt);
  const authorLogin = str((data.author as Record<string, unknown> | undefined)?.login);
  const authorAvatar = str((data.author as Record<string, unknown> | undefined)?.avatarUrl);
  const labels = nodes<LabelData>(data.labels);
  const assignees = nodes<AssigneeData>(data.assignees);
  const milestone = data.milestone as MilestoneData | null;
  const projectItems = nodes<ProjectItemData>(data.projectItems);
  const subIssues = nodes<Record<string, unknown>>(data.subIssues);
  const parent = data.parent as Record<string, unknown> | null;
  const blockedByList = nodes<Record<string, unknown>>(data.blockedBy);
  const blockingList = nodes<Record<string, unknown>>(data.blocking);
  const timelineItems = nodes<Record<string, unknown>>(data.timelineItems);
  const comments = nodes<Record<string, unknown>>(data.comments);

  const handleClose = useCallback((e: React.MouseEvent) => { e.stopPropagation(); useIssueStore.getState().removeIssue(issueNumber); }, [issueNumber]);
  const handleMinimize = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setMinimized((m) => !m); }, []);
  const openUrl = useCallback((e: React.MouseEvent, link: string) => { e.stopPropagation(); if (link) void window.termcanvas.github.openUrl(link); }, []);

  // Kick off the linked-PR lookup as soon as the card renders so the
  // "Revisar Solución" button resolves to orange/disabled without waiting
  // for a context-menu right-click. Uses the issue's own repo path when the
  // card carries one (multi-project canvases). The lookup is forced on every
  // card OPEN (mount): reviews/labels may have changed since the last
  // session lookup, so a fresh verdict must never stay frozen in the card.
  // Guarded to first mount only — `data` refreshes on every issue sync,
  // which must not spam the PR lookup.
  const initialPrLookupRef = useRef(false);
  useEffect(() => {
    if (initialPrLookupRef.current) return;
    initialPrLookupRef.current = true;
    useIssueReviewStore
      .getState()
      .requestPrLookup(issueNumber, worktreePath || undefined, true);
    void useIssueActivityStore.getState().loadActivity(worktreePath);
  }, [issueNumber, data, worktreePath]);

  // Linked PRs: prefer the native `closedByPullRequestsReferences` field (the
  // data backing GitHub's "Development" panel); fall back to
  // CrossReferencedEvent sources from the timeline when the field is empty.
  const closedByPrs = nodes<Record<string, unknown>>(
    data.closedByPullRequestsReferences,
  );
  const linkedPRs: Array<Record<string, unknown>> = [];
  for (const pr of closedByPrs) {
    if (str(pr.__typename) === "PullRequest" || num(pr.number) > 0) {
      linkedPRs.push(pr);
    }
  }
  if (linkedPRs.length === 0) {
    for (const ti of timelineItems) {
      const src = ti.source as Record<string, unknown> | undefined;
      if (src && str(src.__typename) === "PullRequest") linkedPRs.push(src);
    }
  }

  // Build relation cards from first-class GraphQL fields (NO dedup — dual states allowed)
  const relationCards: Array<{ number: number; title: string; url: string; label: string; icon: string; state: string }> = [];

  if (parent && num(parent.number) > 0) {
    relationCards.push({ number: num(parent.number), title: str(parent.title), url: str(parent.url), label: "Parent", icon: "parent", state: str(parent.state, "OPEN") });
  }
  for (const b of blockedByList) {
    relationCards.push({ number: num(b.number), title: str(b.title), url: str(b.url), label: "Blocked by", icon: "blockedBy", state: str(b.state, "OPEN") });
  }
  for (const b of blockingList) {
    relationCards.push({ number: num(b.number), title: str(b.title), url: str(b.url), label: "Blocking", icon: "blocking", state: str(b.state, "OPEN") });
  }
  for (const si of subIssues) {
    relationCards.push({ number: num(si.number), title: str(si.title), url: str(si.url), label: "Sub-issue", icon: "subIssue", state: str(si.state, "OPEN") });
  }

  console.log("[IssueNode]", `#${issueNumber}`, "parent:", !!parent, "blockedBy:", blockedByList.length, "blocking:", blockingList.length, "subIssues:", subIssues.length, "timeline:", timelineItems.length);
  if (closedByPrs.length > 0) {
    console.log("[IssueNode]", `#${issueNumber}`, "closedByPRs:", JSON.stringify(closedByPrs.map(p => ({ number: num(p.number), title: str(p.title), state: str(p.state) }))));
  }
  if (projectItems.length > 0) {
    console.log("[IssueNode]", `#${issueNumber}`, "projectItems:", JSON.stringify(projectItems.map(pi => ({
      project: (pi.project as Record<string,unknown>)?.title,
      fields: nodes<Record<string, unknown>>(pi.fieldValues).map(fv => ({ name: (fv.field as Record<string,unknown>|undefined)?.name, keys: Object.keys(fv).filter(k => k !== "field"), type: fv.text !== undefined ? "text" : fv.number !== undefined ? "number" : fv.date !== undefined ? "date" : fv.name !== undefined ? "select" : fv.title !== undefined ? "iteration" : "unknown" }))
    }))));
  }

  return (
    <div className={`bg-[#0d1117] border border-[#30363d] rounded-md text-[14px] leading-snug overflow-hidden flex flex-col transition-all duration-300 ${minimized ? "is-minimized" : ""}`}
      style={{ width: 960, minHeight: minimized ? 0 : 400 }}>

      {/* ── Title bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[#c9d1d9] font-semibold text-base shrink-0">{title}</span>
          <span className="text-[#8b949e] text-base shrink-0">#{issueNumber}</span>
        </div>
          <div className="flex items-center gap-2 shrink-0">
          {state !== "CLOSED" ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#238636] text-white text-xs font-medium">
              <svg aria-hidden="true" className="fill-current" height="16" width="16" viewBox="0 0 16 16"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" /></svg>
              <span>Open</span>
            </div>
          ) : stateReason === "NOT_PLANNED" ? (
            <svg width="110" height="32" viewBox="0 0 110 32" fill="none">
              <rect width="110" height="32" rx="16" fill="#8250df"/>
              <circle cx="14" cy="16" r="7" stroke="white" strokeWidth="1.5"/>
              <path d="M11 11L17 21M17 11L11 21" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <text x="28" y="21" fill="white" style={{ fontFamily: "sans-serif", fontSize: "14px", fontWeight: 600 }}>Closed</text>
            </svg>
          ) : (
            <svg width="84" height="32" viewBox="0 0 84 32" fill="none">
              <rect width="84" height="32" rx="16" fill="#8957E5"/>
              <circle cx="14" cy="16" r="7" stroke="white" strokeWidth="1.5"/>
              <path d="M11.5 16L13.5 18L17.5 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <text x="28" y="21" fill="white" style={{ fontFamily: "sans-serif", fontSize: "14px", fontWeight: 600 }}>Closed</text>
            </svg>
          )}
          {authorLogin === str((data.author as Record<string, unknown> | undefined)?.login) && (
            <span className="px-2 py-0.5 border border-[rgba(110,118,129,0.4)] rounded-full text-[10px] font-medium text-[#c9d1d9] bg-[rgba(110,118,129,0.15)]">Owner</span>
          )}
          <button type="button" className="text-[#8b949e] hover:text-white p-1 rounded hover:bg-[#30363d]" onClick={handleMinimize}>
            <svg aria-hidden="true" className="fill-current" height="16" width="16" viewBox="0 0 16 16">
              {minimized ? <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" />
                : <path d="M2 7.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5Z" />}
            </svg>
          </button>
          <button type="button" className="text-[#8b949e] hover:text-red-400 p-1 rounded hover:bg-red-900/30" onClick={handleClose}>
            <svg aria-hidden="true" className="fill-current" height="16" width="16" viewBox="0 0 16 16"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" /></svg>
          </button>
        </div>
      </div>

      {/* ── Metadata bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#21262d] bg-[#0d1117] text-xs text-[#8b949e]">
        {authorAvatar && <img alt="" className="w-5 h-5 rounded-full" src={authorAvatar} />}
        <span className="font-semibold text-[#c9d1d9]">{authorLogin || "ghost"}</span>
        <span>opened {relativeTime(createdAt)}</span>
        {updatedAt && updatedAt !== createdAt && <span>· edited {relativeTime(updatedAt)}</span>}
        {closedAt && <span>· closed {relativeTime(closedAt)}</span>}
        <span>· {comments.length} comment{comments.length !== 1 ? "s" : ""}</span>
        <span className="text-[#8b949e]">· {timelineItems.length + subIssues.length} event{timelineItems.length + subIssues.length !== 1 ? "s" : ""}</span>
      </div>

      {!minimized && (
        <div className="flex flex-1 overflow-hidden collapsible-content">
          {/* ── Main column ── */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-[#30363d] bg-[#0d1117]">
            {/* Body */}
            <div className="p-4 flex-1 overflow-auto">
              {body ? (
                <div
                  className={issueMarkdownClass}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                />
              ) : (
                <p className="text-[#8b949e] italic text-sm">No description provided.</p>
              )}
            </div>

            {/* Relationships summary */}
            {relationCards.length > 0 && (
              <div className="px-4 py-3 border-t border-[#21262d] space-y-1 text-[#e6edf3] text-xs">
                {relationCards.map(rc => (
                  <div key={`s-${rc.number}-${rc.label}`}><span className="text-[#8b949e]">{rc.label}:</span> <a href={rc.url} target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline no-underline font-medium" onClick={(e) => openUrl(e, rc.url)}>#{rc.number} {rc.title}</a></div>
                ))}
              </div>
            )}

            {/* Comments */}
            <div className="border-t border-[#30363d]">
              <div className="px-4 py-2 bg-[#161b22] border-b border-[#21262d]">
                <span className="text-xs font-semibold text-[#c9d1d9]">Comments</span>
                <span className="text-[11px] text-[#8b949e] ml-2">{comments.length} comment{comments.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="divide-y divide-[#21262d] max-h-[320px] overflow-auto">
                {[...comments]
                  .sort((a, b) => new Date(str(a.createdAt)).getTime() - new Date(str(b.createdAt)).getTime())
                  .map((cmt, i) => {
                    const cAuthor = cmt.author as Record<string, unknown> | undefined;
                    const cLogin = str(cAuthor?.login, "ghost");
                    return (
                      <div key={`c-${str(cmt.createdAt)}-${i}`} className="px-4 py-3 flex gap-3">
                        {str(cAuthor?.avatarUrl) && <img alt="" className="w-10 h-10 rounded-md bg-[#0d1117] object-cover shrink-0" src={str(cAuthor?.avatarUrl)} />}
                        <div className="flex-1 min-w-0 border border-[#30363d] rounded-md bg-[#0d1117] flex flex-col">
                          <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] rounded-t-md text-sm">
                            <div className="flex items-center flex-wrap gap-1">
                              <span className="font-semibold text-[#e6edf3]">{cLogin}</span>
                              <span className="text-[#8b949e]">commented</span>
                              <span className="text-[#8b949e]">{relativeTime(str(cmt.createdAt))}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {cLogin === authorLogin && (
                                <span className="border border-[#21262d] rounded-full px-2 py-0.5 text-xs text-[#8b949e] hidden sm:inline-block">Author</span>
                              )}
                              <button type="button" className="text-[#8b949e] hover:text-[#e6edf3] p-1" title="Más opciones">
                                <svg aria-hidden="true" className="fill-current" height="16" viewBox="0 0 16 16" width="16"><path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>
                              </button>
                            </div>
                          </div>
                          <div className="p-4 text-[14px] leading-relaxed break-words text-[#e6edf3] flex-grow">
                            {str(cmt.body) ? (
                              <div className={issueMarkdownClass} dangerouslySetInnerHTML={{ __html: renderMarkdown(str(cmt.body)) }} />
                            ) : (
                              <p className="text-[#8b949e] italic text-sm">No comment body.</p>
                            )}
                          </div>
                          <div className="px-4 py-1.5 border-t border-[#30363d] bg-[#0d1117] rounded-b-md flex items-center">
                            <button type="button" className="text-[#8b949e] hover:text-[#58a6ff] hover:bg-[rgba(110,118,129,0.1)] rounded p-1 transition-colors" title="Reaccionar con 😄">
                              <svg aria-hidden="true" className="fill-current" height="16" viewBox="0 0 16 16" width="16"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.75-2.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm5.5 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-6.55 3.3a.75.75 0 0 1 1.06-.05 3.5 3.5 0 0 0 4.48 0 .75.75 0 1 1 1.02 1.1 5 5 0 0 1-6.41 0 .75.75 0 0 1-.15-1.05Z" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                {comments.length === 0 && (
                  <div className="px-4 py-3 text-xs text-[#8b949e] italic">No comments yet.</div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="border-t border-[#30363d]">
              <div className="px-4 py-2 bg-[#161b22] border-b border-[#21262d]">
                <span className="text-xs font-semibold text-[#c9d1d9]">Timeline</span>
                <span className="text-[11px] text-[#8b949e] ml-2">{timelineItems.length} event{timelineItems.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="divide-y divide-[#21262d] max-h-[180px] overflow-auto">
                {timelineItems.slice(0, 10).map((ti, i) => {
                  const actor = ti.actor as Record<string, unknown> | undefined;
                  const actorLogin = str(actor?.login);
                  const labelData = ti.label as Record<string, unknown> | undefined;
                  const tiCreatedAt = str(ti.createdAt);
                  const hasLabel = !!labelData;
                  const hasMilestone = typeof ti.milestoneTitle === "string";
                  const hasRename = typeof ti.currentTitle === "string";
                  const hasSubject = !!ti.subject;
                  const hasSource = !!ti.source;
                  let evtLabel = "";
                  if (hasRename) evtLabel = "renamed-title";
                  else if (hasMilestone) evtLabel = "milestoned";
                  else if (hasSource) evtLabel = "cross-referenced";
                  else if (hasSubject && ti.isCrossRepository) evtLabel = "connected";
                  else if (hasSubject) evtLabel = "disconnected";
                  else if (hasLabel) evtLabel = "labeled";
                  else evtLabel = "updated";
                  return (
                    <div key={`ti-${i}`} className="px-4 py-1.5 text-xs text-[#8b949e]">
                      {actorLogin ? <span className="text-[#c9d1d9] font-medium">{actorLogin}</span> : <span>ghost</span>}{" "}
                      {evtLabel === "labeled" && <>added label {labelData?.name ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{backgroundColor: str(labelData.color) ? `#${str(labelData.color)}` : "#30363d", color: str(labelData.color) ? "#000" : "#c9d1d9"}}>{str(labelData.name)}</span> : ""}</>}
                      {evtLabel === "milestoned" && <>added this to <span className="text-[#c9d1d9]">{str(ti.milestoneTitle)}</span></>}
                      {evtLabel === "renamed-title" && <>changed title from <span className="line-through text-[#8b949e]">{str(ti.previousTitle)}</span> to <span className="text-[#c9d1d9]">{str(ti.currentTitle)}</span></>}
                      {evtLabel === "connected" && "connected an issue"}
                      {evtLabel === "disconnected" && "disconnected an issue"}
                      {evtLabel === "cross-referenced" && "referenced in"}
                      {evtLabel === "updated" && "updated"}
                      {" "}<span className="text-[#8b949e]">{relativeTime(tiCreatedAt)}</span>
                    </div>
                  );
                })}
                {timelineItems.length === 0 && (
                  <div className="px-4 py-3 text-xs text-[#8b949e] italic">No timeline events yet.</div>
                )}
              </div>
            </div>

            {/* Actividad local */}
            <div className="border-t border-[#30363d]">
              <div className="px-4 py-2 bg-[#161b22] border-b border-[#21262d]">
                <span className="text-xs font-semibold text-[#c9d1d9]">Tu actividad</span>
                <span className="text-[11px] text-[#8b949e] ml-2">{activity.length} action{activity.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="divide-y divide-[#21262d] max-h-[180px] overflow-auto">
                {activity.slice(-10).map((entry, i) => {
                  const label =
                    entry.type === "resolve"
                      ? "Resolver Issue"
                      : entry.type === "review"
                        ? "Revisar Solución"
                        : entry.type === "fix"
                          ? "Implementar Fix"
                          : "Mergear PR";
                  const dotColor =
                    entry.type === "resolve"
                      ? "#238636"
                      : entry.type === "review"
                        ? "#db6d28"
                        : entry.type === "fix"
                          ? "#58a6ff"
                          : "#8957e5";
                  return (
                    <div key={`act-${i}`} className="px-4 py-1.5 text-xs text-[#8b949e] flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden="true" />
                      <span className="text-[#c9d1d9] font-medium">{label}</span>
                      <span className="text-[#8b949e]">{relativeTime(new Date(entry.at).toISOString())}</span>
                    </div>
                  );
                })}
                {activity.length === 0 && (
                  <div className="px-4 py-3 text-xs text-[#8b949e] italic">No local activity yet.</div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-[#30363d] bg-[#0d1117] flex items-center gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 bg-[#21262d] hover:bg-[#30363d] border border-[rgba(240,246,252,0.1)] rounded-md px-3 py-1.5 text-xs font-medium text-[#c9d1d9] transition-colors no-underline"
                onClick={(e) => e.stopPropagation()}>
                View on GitHub
                <svg aria-hidden="true" className="fill-current opacity-70" height="12" width="12" viewBox="0 0 16 16"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" /></svg>
              </a>
              <button type="button" disabled={resolvingIssueNumber !== null}
                className="flex items-center gap-1.5 bg-[#238636] hover:bg-[#2ea043] border border-[rgba(46,160,67,0.4)] rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={(e) => {
                  e.stopPropagation();
                  useIssueResolveStore.getState().resolveHandler?.(issueNumber);
                }}>
                {resolvingIssueNumber === issueNumber ? "Resolviendo..." : "Resolver Issue"}
                <svg aria-hidden="true" className="fill-current opacity-70" height="12" width="12" viewBox="0 0 16 16"><path d="M4.5 2.75v10.5a.75.75 0 0 0 1.144.636l8.25-5.25a.75.75 0 0 0 0-1.272l-8.25-5.25A.75.75 0 0 0 4.5 2.75Z" /></svg>
              </button>
              <button
                type="button"
                disabled={reviewingIssueNumber !== null || prStatus == null}
                title={prStatus !== "loading" && prStatus != null ? `Review PR #${prStatus.number}` : undefined}
                className={
                  prStatus === "loading"
                    ? "flex items-center gap-1.5 bg-[#21262d] border border-[rgba(240,246,252,0.1)] rounded-md px-3 py-1.5 text-xs font-medium text-[#8b949e] cursor-wait"
                    : prStatus == null
                      ? "flex items-center gap-1.5 bg-[#21262d] border border-[rgba(240,246,252,0.1)] rounded-md px-3 py-1.5 text-xs font-medium text-[#8b949e] opacity-50 cursor-not-allowed"
                      : "flex items-center gap-1.5 bg-[#db6d28] hover:bg-[#f0883e] border border-[rgba(240,136,62,0.4)] rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  useIssueReviewStore.getState().reviewHandler?.(issueNumber);
                }}>
                {reviewingIssueNumber === issueNumber
                  ? "Revisando..."
                  : prStatus === "loading"
                    ? "Buscando PR..."
                    : "Revisar Solución"}
                <svg aria-hidden="true" className="fill-current opacity-70" height="12" width="12" viewBox="0 0 16 16"><path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" /></svg>
              </button>
              {effective === REVIEW_LABEL_APPROVED &&
                prStatus !== null &&
                prStatus !== "loading" &&
                prStatus.state === "OPEN" && (
                <button
                  type="button"
                  disabled={mergingIssueNumber !== null}
                  title={`Merge PR #${prStatus.number}`}
                  className="flex items-center gap-1.5 bg-[#238636] hover:bg-[#2ea043] border border-[rgba(46,160,67,0.4)] rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={(e) => {
                    e.stopPropagation();
                    useIssueReviewStore.getState().mergeHandler?.(issueNumber);
                  }}>
                  {mergingIssueNumber === issueNumber ? "Mergeando..." : "Merge PR"}
                  <svg aria-hidden="true" className="fill-current opacity-70" height="12" width="12" viewBox="0 0 16 16"><path d="M1 7.5V2.75A.75.75 0 0 1 1.75 2H7v5h1.5v-5h5.25a.75.75 0 0 1 .75.75V7.5a1.5 1.5 0 1 1-1.5 0V3.5h-3.5v8.5h2v-1h1.5v2.5H1.5v-2.5H3v-1H1.5v1H1v-4.5h.75v-1H1Zm1 0h1v-3.5h2.5V7.5H2Zm0 6h1v-3.5h1.5v3.5H2Z" /></svg>
                </button>
              )}
              {effective === REVIEW_LABEL_CONFLICT && (
                <span className="inline-flex items-center gap-1.5 bg-[#f85149]/10 border border-[rgba(248,81,73,0.5)] text-[#f85149] rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Conflicto con main
                </span>
              )}
              {effective === REVIEW_LABEL_APPROVED && (
                <span className="inline-flex items-center gap-1.5 bg-[#238636]/15 border border-[rgba(35,134,54,0.5)] text-[#3fb950] rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Review: aprobado
                </span>
              )}
              {effective === REVIEW_LABEL_CHANGES && (
                <span className="inline-flex items-center gap-1.5 bg-[#f85149]/10 border border-[rgba(248,81,73,0.5)] text-[#f85149] rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Review: cambios pedidos
                </span>
              )}
              {effective === REVIEW_LABEL_FIX_APPLIED && (
                <span className="inline-flex items-center gap-1.5 bg-[#58a6ff]/10 border border-[rgba(88,166,255,0.5)] text-[#58a6ff] rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Review: fix aplicado
                </span>
              )}
              {effective === REVIEW_LABEL_PENDING && (
                <span className="inline-flex items-center gap-1.5 bg-[#d29922]/10 border border-[rgba(210,153,34,0.5)] text-[#d29922] rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Review: pendiente
                </span>
              )}
              {effective === null && (
                <span className="inline-flex items-center gap-1.5 bg-[#21262d]/60 border border-[rgba(240,246,252,0.15)] text-[#8b949e] rounded-full px-2 py-0.5 text-[11px] font-medium opacity-60">
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Review: sin veredicto
                </span>
              )}
              <span className="flex-1" />
              <span className="text-[11px] text-[#8b949e]">#{issueNumber} · {state.toLowerCase()}</span>
            </div>
          </div>

          {/* ── Sidebar ── */}
          <aside className="w-[280px] bg-[#0d1117] p-4 flex flex-col gap-4 text-xs overflow-auto shrink-0">
            {/* Assignees */}
            <section>
              <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Assignees</span>
              {assignees.length > 0 ? (
                <div className="space-y-1.5">
                  {assignees.map((a) => (
                    <div key={a.login} className="flex items-center gap-2">
                      {a.avatarUrl && <img alt="" className="w-5 h-5 rounded-full" src={a.avatarUrl} />}
                      <span className="text-[#c9d1d9] text-xs">{a.login || a.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[#8b949e] text-[11px]">No one assigned</span>
              )}
            </section>
            <div className="border-b border-[#21262d]" />

            {/* Labels */}
            <section>
              <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Labels</span>
              {labels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {labels.map((l) => (
                    <span key={l.name} className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: l.color ? `#${l.color}` : "#30363d", color: l.color ? "#000" : "#c9d1d9" }}>
                      {l.name}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[#8b949e] text-[11px]">None yet</span>
              )}
            </section>
            <div className="border-b border-[#21262d]" />

            {/* Projects */}
            {projectItems.length > 0 && (
              <>
                <section>
                  <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Projects</span>
                  {projectItems.map((pi, i) => (
                    <div key={i} className="border border-[#30363d] rounded-md p-3 bg-[#010409] mb-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-white text-xs">{(pi.project as Record<string,unknown>)?.title as string ?? "Project"}</span>
                      </div>
                      <div className="space-y-1.5">
                        {nodes<Record<string, unknown>>(pi.fieldValues).map((fv) => {
                          const field = fv.field as Record<string, unknown> | undefined;
                          const fieldName = str(field?.name);
                          if (!fieldName) return null;
                          const val = str(fv.text ?? fv.name ?? fv.title ?? fv.number?.toString() ?? fv.date ?? "");
                          if (!val) return null;
                          const isStatus = fieldName.toLowerCase() === "status";
                          const isPriority = fieldName.toLowerCase() === "priority";
                          const isSize = fieldName.toLowerCase() === "size";
                          const priorityColors: Record<string, string> = { "p0": "#e32b36", "p1": "#e47014", "p2": "#e4e669" };
                          const sizeColors: Record<string, string> = { "xs": "#238636", "s": "#7057ff", "m": "#e32b36", "l": "#e47014", "xl": "#d876e3" };
                          const priColor = isPriority ? (priorityColors[val.toLowerCase()] ?? "#e32b36") : undefined;
                          const szColor = isSize ? (sizeColors[val.toLowerCase()] ?? "#7057ff") : undefined;
                          const badgeStyle = isPriority && priColor
                            ? { backgroundColor: `${priColor}1a`, color: priColor, borderColor: `${priColor}4d` }
                            : isSize && szColor
                            ? { backgroundColor: `${szColor}1a`, color: szColor, borderColor: `${szColor}4d` }
                            : isStatus
                            ? { backgroundColor: "#2386361a", color: "#238636", borderColor: "#2386364d" }
                            : { backgroundColor: "rgba(110,118,129,0.15)", color: "#c9d1d9", borderColor: "#30363d" };
                          return (
                            <div key={fieldName} className="flex items-center justify-between">
                              <span className="text-[#8b949e] text-[11px]">{fieldName}</span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                style={badgeStyle}>{val}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
                <div className="border-b border-[#21262d]" />
              </>
            )}

            {/* Milestone */}
            <section>
              <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Milestone</span>
              {milestone?.title ? (
                <div className="space-y-1">
                  <span className="text-[#c9d1d9] text-xs font-medium">{milestone.title}</span>
                  {milestone.dueOn && <span className="text-[#8b949e] text-[11px] block">Due by {new Date(milestone.dueOn).toLocaleDateString()}</span>}
                  <div className="w-full bg-[#21262d] rounded-full h-1 mt-1">
                    <div className="bg-[#30363d] rounded-full h-1" style={{ width: "30%" }} />
                  </div>
                </div>
              ) : (
                <span className="text-[#8b949e] text-[11px]">No milestone</span>
              )}
            </section>

            {/* Relationships */}
            <div className="border-b border-[#21262d]" />
            <section>
              <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Relationships</span>
              <div className="space-y-3">
                {(["Parent", "Blocked by", "Blocking", "Sub-issue"] as const).map((groupLabel) => {
                  const cards = relationCards.filter((rc) => rc.label === groupLabel);
                  return (
                    <div key={groupLabel}>
                      <span className="text-[#8b949e] text-[11px] font-semibold block mb-1.5">{groupLabel}</span>
                      {cards.length > 0 ? (
                        <div className="space-y-1.5">
                          {cards.map((rc) => {
                            const isBlockedBy = rc.icon === "blockedBy";
                            const isBlocking = rc.icon === "blocking";
                            return (
                              <div key={`rc-${rc.number}-${rc.label}`} className="border border-[#30363d] rounded-md p-2 bg-[#010409] flex items-start gap-2">
                                <div className="shrink-0" style={{ width: 24, height: 24 }}>
                                  {rc.state === "CLOSED" ? (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                      <circle cx="12" cy="12" r="9" stroke="#8957E5" strokeWidth="2"/>
                                      <path d="M8 12L11 15L16 9" stroke="#8957E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  ) : (
                                    <>
                                      {isBlocking && (
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                          <circle cx="12" cy="12" r="9" stroke="#3FB950" strokeWidth="2"/>
                                          <circle cx="12" cy="12" r="2" fill="#3FB950"/>
                                          <g transform="translate(14, 14)">
                                            <circle cx="5" cy="5" r="4.5" fill="#10141a" stroke="#F85149" strokeWidth="1"/>
                                            <rect x="2.5" y="4.5" width="5" height="1" rx="0.5" fill="#F85149"/>
                                          </g>
                                        </svg>
                                      )}
                                      {isBlockedBy && (
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                          <circle cx="12" cy="12" r="9" stroke="#F85149" strokeWidth="2"/>
                                          <circle cx="12" cy="12" r="2" fill="#F85149"/>
                                        </svg>
                                      )}
                                      {!isBlockedBy && !isBlocking && (
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                          <circle cx="12" cy="12" r="9" stroke="#3FB950" strokeWidth="2"/>
                                          <circle cx="12" cy="12" r="2" fill="#3FB950"/>
                                        </svg>
                                      )}
                                    </>
                                  )}
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <a href={rc.url} target="_blank" rel="noopener noreferrer" className="text-[#c9d1d9] text-xs font-semibold hover:text-[#58a6ff] no-underline truncate" onClick={(e) => openUrl(e, rc.url)}>
                                    {rc.title || `#${rc.number}`}
                                  </a>
                                  <span className="text-[#8b949e] text-[11px]">{rc.label}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-[#8b949e] text-[11px] pl-1">—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Development */}
            {linkedPRs.length > 0 && (
              <>
                <div className="border-b border-[#21262d]" />
                <section>
                  <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Development</span>
                  <div className="space-y-1.5">
                    {linkedPRs.map((pr) => (
                      <a key={num(pr.number)} href={str(pr.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11px] text-[#58a6ff] hover:underline no-underline"
                        onClick={(e) => openUrl(e, str(pr.url))}>
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${str(pr.state) === "MERGED" ? "bg-[#a371f7]" : str(pr.state) === "CLOSED" ? "bg-[#f85149]" : "bg-[#238636]"}`} />
                        <span className="truncate">#{num(pr.number)} {str(pr.title)}</span>
                      </a>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* Participants */}
            <div className="border-b border-[#21262d]" />
            <section>
              <span className="font-semibold text-[#c9d1d9] text-xs block mb-2">Participants</span>
              <div className="flex flex-wrap gap-1">
                {authorAvatar && <img alt={authorLogin} title={authorLogin} className="w-6 h-6 rounded-full" src={authorAvatar} />}
                {assignees.map((a) => a.avatarUrl && <img key={a.login} alt={a.login} title={a.login} className="w-6 h-6 rounded-full" src={a.avatarUrl} />)}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
