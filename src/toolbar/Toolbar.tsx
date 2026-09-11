import { useState } from "react";
import { useThemeStore } from "../stores/themeStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useHubStore } from "../stores/hubStore";
import { SettingsModal } from "../components/SettingsModal";
import { UpdateModal } from "../components/UpdateModal";
import { CoreArchitectureModal } from "../components/CoreArchitectureModal";
import { useNotificationStore } from "../stores/notificationStore";
import { resolveActiveWorktree } from "../planner/planningSession";
import { useT } from "../i18n/useT";
import { getWorkspaceBaseName } from "../titleHelper";
import { formatShortcut, useShortcutStore } from "../stores/shortcutStore";
import { useFactoryLabStore } from "../stores/factoryLabStore";
import { useWorkflowLabStore } from "../stores/workflowLabStore";
import { useWarpPanelStore } from "../features/warpPanel/warpPanelStore";


export { TOOLBAR_HEIGHT } from "./toolbarHeight";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";
const isWin = platform === "win32";

const MAC_STOPLIGHT_GUTTER = 72;
const WIN_CAPTION_GUTTER = 140;

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const ICON_BUTTON_TRANSITION = {
  transition:
    "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft), transform var(--duration-instant) var(--ease-out-soft)",
} as React.CSSProperties;

const iconButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-hover)] motion-reduce:transition-none motion-reduce:hover:transform-none";

export function Toolbar() {
  const { theme, toggleTheme } = useThemeStore();
  const t = useT();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const updateStatus = useUpdaterStore((s) => s.status);
  const showSettings = useSettingsModalStore((s) => s.open);
  const openSettings = useSettingsModalStore((s) => s.openSettings);
  const closeSettings = useSettingsModalStore((s) => s.closeSettings);
  const [showUpdate, setShowUpdate] = useState(false);
  const factoryLabActive = useFactoryLabStore((s) => s.factoryLabActive);
  const toggleFactoryLab = useFactoryLabStore((s) => s.toggleFactoryLab);
  const workflowLabActive = useWorkflowLabStore((s) => s.workflowLabActive);
  const toggleWorkflowLab = useWorkflowLabStore((s) => s.toggleWorkflowLab);
  const warpPanelActive = useWarpPanelStore((s) => s.warpPanelActive);
  const toggleWarpPanel = useWarpPanelStore((s) => s.toggleWarpPanel);

  const hubOpen = useHubStore((s) => s.open);
  const toggleHub = useHubStore((s) => s.toggleHub);
  const hubShortcut = useShortcutStore((s) => s.shortcuts.toggleHub);
  const hubChord = formatShortcut(hubShortcut, isMac);
  const hubLabel = t["hub.toolbarLabel"](hubChord);

  // Modal unificado de arquitectura: reemplaza los dos botones separados
  // (entrevista de contexto + entrevista de requerimientos). El modal
  // inicializa los stores de las entrevistas al abrirse.

  const [coreOpen, setCoreOpen] = useState(false);

  const openCore = () => {
    const active = resolveActiveWorktree();
    if (!active) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          "Open a project first to work on its architecture.",
        );
      return;
    }
    setCoreOpen(true);
  };

  const workspaceName =
    getWorkspaceBaseName(workspacePath) ?? t.toolbar_untitled_workspace;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-50 flex h-11 items-center overflow-hidden border-b border-[var(--border)]"
        style={
          {
            paddingLeft: isMac ? MAC_STOPLIGHT_GUTTER : 16,
            paddingRight: isWin ? WIN_CAPTION_GUTTER : 16,
            WebkitAppRegion: "drag",
            background:
              "linear-gradient(to bottom, var(--bg) 0%, color-mix(in srgb, var(--bg) 88%, var(--surface) 12%) 100%)",
          } as React.CSSProperties
        }
      >
        {/* Center column carries the workspace identity. The flex-1
            wrapper lets the title visually center between the platform
            gutters; truncation falls back to ellipsis when the project
            path is long. */}
        <div className="flex flex-1 min-w-0 items-center justify-center px-3">
          <div
            className="flex min-w-0 items-center gap-2"
            title={workspacePath ?? workspaceName}
          >
            {dirty && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]"
                style={{ opacity: 0.7 }}
              />
            )}
            <span className="tc-ui min-w-0 truncate">{workspaceName}</span>
          </div>
        </div>

        <div
          className="relative z-10 flex shrink-0 items-center gap-0.5"
          style={noDrag}
        >
          {updateStatus !== "idle" && (
            <UpdateStatusButton
              status={updateStatus}
              t={t}
              onClick={() => setShowUpdate(true)}
            />
          )}

          <button
            type="button"
            data-factory-lab-trigger="true"
            data-active={factoryLabActive ? "true" : "false"}
            className={iconButtonClass}
            style={{
              ...ICON_BUTTON_TRANSITION,
              color: factoryLabActive ? "var(--text-primary)" : undefined,
              backgroundColor: factoryLabActive ? "var(--surface-hover)" : undefined,
            }}
            onClick={toggleFactoryLab}
            title="Factory Lab — probar cableado opencode web"
            aria-label={factoryLabActive ? "Salir de Factory Lab" : "Abrir Factory Lab"}
            aria-pressed={factoryLabActive}
          >
            <PlaygroundIcon active={factoryLabActive} />
          </button>

          <button
            type="button"
            data-workflow-lab-trigger="true"
            data-active={workflowLabActive ? "true" : "false"}
            className={iconButtonClass}
            style={{
              ...ICON_BUTTON_TRANSITION,
              color: workflowLabActive ? "var(--text-primary)" : undefined,
              backgroundColor: workflowLabActive ? "var(--surface-hover)" : undefined,
            }}
            onClick={toggleWorkflowLab}
            title="Workflows — engine declarativo (runs, gates y DAG)"
            aria-label={workflowLabActive ? "Salir de Workflows" : "Abrir Workflows"}
            aria-pressed={workflowLabActive}
          >
            <WorkflowIcon active={workflowLabActive} />
          </button>

          <button
            type="button"
            data-warp-panel-trigger="true"
            data-active={warpPanelActive ? "true" : "false"}
            className={iconButtonClass}
            style={{
              ...ICON_BUTTON_TRANSITION,
              color: warpPanelActive ? "var(--text-primary)" : undefined,
              backgroundColor: warpPanelActive ? "var(--surface-hover)" : undefined,
            }}
            onClick={toggleWarpPanel}
            title="Warp Panel — issues side panel"
            aria-label={warpPanelActive ? "Close Warp Panel" : "Open Warp Panel"}
            aria-pressed={warpPanelActive}
          >
            <WarpPanelIcon active={warpPanelActive} />
          </button>

          <button
            type="button"
            data-hub-trigger="true"
            data-active={hubOpen ? "true" : "false"}
            className={iconButtonClass}
            style={{
              ...ICON_BUTTON_TRANSITION,
              color: hubOpen ? "var(--text-primary)" : undefined,
              backgroundColor: hubOpen ? "var(--surface-hover)" : undefined,
            }}
            onClick={toggleHub}
            title={hubLabel}
            aria-label={hubLabel}
            aria-pressed={hubOpen}
          >
            <HubIcon />
          </button>

          <button
            type="button"
            data-core-architecture-trigger="true"
            data-active={coreOpen ? "true" : "false"}
            className={iconButtonClass}
            style={{
              ...ICON_BUTTON_TRANSITION,
              color: coreOpen ? "var(--text-primary)" : undefined,
              backgroundColor: coreOpen ? "var(--surface-hover)" : undefined,
            }}
            onClick={openCore}
            title="Arquitectura del proyecto"
            aria-label="Arquitectura del proyecto"
            aria-pressed={coreOpen}
          >
            <ArchitectureIcon />
          </button>

          <button
            type="button"
            className={iconButtonClass}
            style={ICON_BUTTON_TRANSITION}
            onClick={toggleTheme}
            title={theme === "dark" ? t.switch_to_light : t.switch_to_dark}
            aria-label={theme === "dark" ? t.switch_to_light : t.switch_to_dark}
          >
            {/* Key on theme triggers the entrance pop on swap so the
                glyph change reads as a deliberate state hand-off, not
                an instant flicker. */}
            <span
              key={theme}
              className="tc-enter-pop inline-flex motion-reduce:animate-none"
              aria-hidden="true"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </span>
          </button>

          <button
            type="button"
            className={iconButtonClass}
            style={ICON_BUTTON_TRANSITION}
            onClick={() => openSettings()}
            title={t.settings}
            aria-label={t.settings}
          >
            <SettingsIcon />
          </button>

          <button
            type="button"
            className={iconButtonClass}
            style={ICON_BUTTON_TRANSITION}
            onClick={() =>
              window.open(
                "https://github.com/blueberrycongee/termcanvas",
                "_blank",
              )
            }
            title="Star on GitHub"
            aria-label="Star on GitHub"
          >
            <StarIcon />
          </button>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={closeSettings} />}
      {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)} />}
      {coreOpen && (
        <CoreArchitectureModal isOpen onClose={() => setCoreOpen(false)} />
      )}
    </>
  );
}

type UpdateStatus = ReturnType<typeof useUpdaterStore.getState>["status"];

function UpdateStatusButton({
  status,
  t,
  onClick,
}: {
  status: UpdateStatus;
  t: ReturnType<typeof useT>;
  onClick: () => void;
}) {
  const label =
    status === "downloading"
      ? t.update_downloading
      : status === "ready"
        ? t.update_ready
        : status === "error"
          ? t.update_error
          : t.update_checking;

  return (
    <button
      type="button"
      // Pop on every status transition so a state change reads as
      // an event, not a silent swap. Keyed on status to remount.
      key={status}
      className={`${iconButtonClass} tc-enter-pop relative motion-reduce:animate-none`}
      style={ICON_BUTTON_TRANSITION}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {status === "downloading" ? (
        <ArrowDownIcon className="motion-safe:animate-bounce" />
      ) : status === "ready" ? (
        <>
          <ArrowUpIcon />
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-[var(--green)] ring-2 ring-[var(--bg)]"
          />
        </>
      ) : status === "error" ? (
        <WarningIcon style={{ color: "var(--amber)" }} />
      ) : (
        <SpinnerIcon className="motion-safe:animate-spin" />
      )}
    </button>
  );
}

function HubIcon() {
  // Three rows of stacked bars — a "queue / activity feed" mark, hinting
  // that the surface aggregates many signals into one column. Stroke-only
  // so it inherits the icon button's color tokens.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 3.5h10M2 7h7M2 10.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="11" cy="7" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ArchitectureIcon() {
  // Capas apiladas (3 rombos) — el modal unificado de arquitectura del
  // proyecto: entrevistas + resultados post-entrevista. Stroke-only como
  // sus hermanos de la barra.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5L13.5 4 8 6.5 2.5 4z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 8L8 10.5 13.5 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 12L8 14.5 13.5 12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
      <path
        d="M1.5 4.2l1.7 1.7L6.5 2.2"
        stroke="var(--bg)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlannerIcon() {
  // Sheet with ruled lines and a flag — a "plan / roadmap" mark that
  // stays stroke-only so it inherits the icon button's color tokens.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 2.5h8v11h-8z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 6h4M6 8.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 1.5v2M10 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M12.5 8.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M5.7 1h2.6l.4 1.7a4.5 4.5 0 0 1 1.1.6l1.7-.5 1.3 2.2-1.3 1.2a4.5 4.5 0 0 1 0 1.2l1.3 1.2-1.3 2.3-1.7-.6a4.5 4.5 0 0 1-1.1.7L8.3 13H5.7l-.4-1.7a4.5 4.5 0 0 1-1.1-.7l-1.7.6-1.3-2.3 1.3-1.2a4.5 4.5 0 0 1 0-1.2L1.2 5.3l1.3-2.2 1.7.5a4.5 4.5 0 0 1 1.1-.6L5.7 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 12V4M4 6.5L7 3.5 10 6.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 2h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
    >
      <path
        d="M7 2v8M4 7.5L7 10.5 10 7.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WarningIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={style}>
      <path
        d="M7 2L1.5 12h11L7 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 6v3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="7" cy="10.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
    >
      <path
        d="M7 1.5A5.5 5.5 0 1 1 1.5 7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1l1.76 3.57L12.5 5.27 10.25 8.14l.43 3.86L7 10.73l-3.68 1.27.43-3.86L1.5 5.27l3.74-.7L7 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WorkflowIcon({ active }: { active?: boolean }) {
  // DAG por capas: dos nodos arriba conectados a uno abajo.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="1.5"
        y="2"
        width="5"
        height="4"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.14 : 0}
      />
      <rect
        x="9.5"
        y="2"
        width="5"
        height="4"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.14 : 0}
      />
      <rect
        x="5.5"
        y="10"
        width="5"
        height="4"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.2 : 0}
      />
      <path
        d="M4 6v2h4v2M12 6v2H8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity={0.6}
      />
    </svg>
  );
}

function PlaygroundIcon({ active }: { active?: boolean }) {
  // Beaker / test-tube — distinct from Hub (rows) and Architecture (layers).
  // Filled when active so the user reads at a glance "estoy en playground".
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 2h4M7 2v3.8L3.6 11.2a1.3 1.3 0 0 0 1.1 1.9h6.6a1.3 1.3 0 0 0 1.1-1.9L9 5.8V2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.14 : 0}
      />
      <path d="M5.5 10h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity={0.55} />
      {active && <circle cx="8" cy="8.5" r="1" fill="currentColor" opacity={0.9} />}
    </svg>
  );
}

function WarpPanelIcon({ active }: { active?: boolean }) {
  // Kanban columns — three vertical bars echoing the WarpPanel board view.
  // Stroke-only like its toolbar siblings; center bar filled when active.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="1.5"
        y="2.5"
        width="3.5"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="6.25"
        y="2.5"
        width="3.5"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.35 : 0}
      />
      <rect
        x="11"
        y="2.5"
        width="3.5"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
