import {
  ChevronDown,
  CircleHelp,
  GitBranch,
  KeyRound,
  LayoutGrid,
  List,
  Pin,
  Plus,
  Rocket,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DEFAULT_NAV_ITEM, navItemsByScope } from "../nav";
import type { NavItemId } from "../nav";
import { useFactoryWorkspace } from "../lib/factory/hooks/useFactories";
import { NewFactoryDialog } from "./factories/NewFactoryDialog";

// ——— tokens ———
// Concentric radius: outer 12px = inner 8px + 4px padding
// Duration / easing exact per skill: 150ms hover, 0.2,0,0,1
// Press scale 0.96, spring bounce 0, duration 0.3
// Image outline: oklch(0 0 0 / 0.08)
// Will-change only on transform/opacity/filter

const EASE = "cubic-bezier(0.2, 0, 0, 1)" as const;
const SPRING = { type: "spring" as const, duration: 0.3, bounce: 0 };
const EASE_ARRAY = [0.2, 0, 0, 1] as const;

/** Icon per nav id. Kept in the component layer: nav.ts stays pure data (SRP). */
// oxlint-disable-next-line react/only-export-components -- NAV_ICONS is a constant map co-located for exhaustiveness check (P0-04); allowed by allowConstantExport but linter still warns due to component file
export const NAV_ICONS: Record<NavItemId, LucideIcon> = {
  Quickstart: Rocket,
  "Team Runs": List,
  "MCPs and apps": LayoutGrid,
  Secrets: KeyRound,
  Integrations: Waypoints,
  Help: CircleHelp,
  // Factory items render as a text list; these are only used when the rail is collapsed.
  Dashboard: LayoutGrid,
  Activity: List,
  Agents: Waypoints,
  Automations: Waypoints,
  Runs: List,
  Runners: LayoutGrid,
  Scorers: LayoutGrid,
  Skills: LayoutGrid,
  Benchmarks: LayoutGrid,
  "MCP tools": LayoutGrid,
  "Factory API": LayoutGrid,
  "Factory definition": LayoutGrid,
  Settings: LayoutGrid,
  "Self-improvement": Waypoints,
  Troubleshooting: CircleHelp,
  Infra: LayoutGrid,
  Validation: LayoutGrid,
  "Integrations Deep Dives": Waypoints,
  "GitHub routing": GitBranch,
  "GitLab Deep Dive": Waypoints,
  "Slack Deep Dive": Waypoints,
  "Linear Deep Dive": Waypoints,
  "Jira Deep Dive": Waypoints,
};

const TEAM_ITEMS = navItemsByScope("team");
const FACTORY_ITEMS = navItemsByScope("factory");

// Daily driver — lo que el usuario usa todos los días. El resto es motor y queda oculto en "Avanzado".
const DAILY_FACTORY_IDS = new Set<NavItemId>([
  "Dashboard",
  "Activity",
  "Agents",
  "Automations",
  "Runs",
  "Scorers",
  "Benchmarks",
  "Self-improvement",
  "Settings",
]);

const FACTORY_DAILY_ITEMS = FACTORY_ITEMS.filter((item) => DAILY_FACTORY_IDS.has(item.id));
const FACTORY_ADVANCED_ITEMS = FACTORY_ITEMS.filter((item) => !DAILY_FACTORY_IDS.has(item.id));
// Team-level es 100% motor/admin — va todo a Avanzado (Quickstart, Team Runs, MCPs and apps, Secrets, Integrations, Help)
const TEAM_ADVANCED_ITEMS = TEAM_ITEMS;

interface SidebarProps {
  activeItem?: NavItemId;
  onNavigate?: (item: NavItemId) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  activeItem = DEFAULT_NAV_ITEM,
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const { factories, selected, select, store } = useFactoryWorkspace();

  // Tri-state: `undefined` = "seguir la selección"; `null` = colapsado a propósito.
  const [expanded, setExpanded] = useState<string | null | undefined>(undefined);
  const [dialog, setDialog] = useState<{ key: number; suggestedName?: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const openUid = expanded === undefined ? (selected?.uid ?? null) : expanded;

  function handleNav(item: NavItemId) {
    onNavigate?.(item);
  }

  function openFactoryDialog(suggestedName?: string) {
    setDialog((prev) => ({ key: (prev?.key ?? 0) + 1, suggestedName }));
  }

  function handleFactoryCreated() {
    // US-001: la factory nueva queda seleccionada y el contenido pasa a su Dashboard.
    onNavigate?.("Dashboard");
  }

  return (
    <aside
      className={[
        "flex h-screen shrink-0 flex-col border-r border-zinc-200 bg-subsurface text-[13.5px] leading-none selection:bg-violet-500/10",
        collapsed ? "w-[56px]" : "w-[272px]",
      ].join(" ")}
    >
      {/* Top bar — optical alignment: icon nudged 0.5px, hit area 28px */}
      <motion.div
        initial={{ opacity: 0, y: -4, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.3, ease: EASE_ARRAY }}
        className={[
          "flex h-[44px] shrink-0 items-center px-2.5",
          collapsed ? "justify-center" : "justify-between",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          aria-expanded={!collapsed}
          className="grid h-7 w-7 place-items-center rounded-[8px] text-zinc-700 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
          style={{ willChange: "transform" }}
        >
          <span className="relative h-4 w-4 translate-x-[0.5px]">
            <span className="absolute left-0 top-0 h-[13px] w-[13px] rounded-[4px] bg-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.12)]" />
            <span
              className="absolute bottom-0 right-0 h-[13px] w-[13px] rounded-[4px] border bg-zinc-50"
              style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px oklch(0 0 0 / 0.08)" }}
            />
          </span>
        </button>

        {!collapsed && (
          <div className="flex items-center gap-0.5">
            {/* "Search" and "Toggle panel" removed: both were inert. The collapse control above is the real one. */}
            <span className="text-[11px] text-zinc-400">warp</span>
          </div>
        )}
      </motion.div>

      {/* Divider — structural border, not shadow */}
      <div className="mx-3 h-px shrink-0 bg-zinc-200/70" />

      {collapsed ? (
        /* Collapsed rail — solo daily factory tabs + control de expandir */
        <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-3 [scrollbar-width:thin]">
          <ul className="space-y-0.5">
            {FACTORY_DAILY_ITEMS.map((item) => {
              const Icon = NAV_ICONS[item.id] ?? Waypoints;
              const isActive = item.id === activeItem;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleNav(item.id)}
                    title={item.label}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "grid h-8 w-8 place-items-center rounded-[8px] transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                      isActive ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]" : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
                    ].join(" ")}
                  >
                    <Icon className="h-[16px] w-[16px]" strokeWidth={1.6} />
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="Mostrar todo"
                aria-label="Mostrar todo"
                className="grid h-8 w-8 place-items-center rounded-[8px] text-zinc-500 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] hover:text-zinc-900 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
              >
                <Waypoints className="h-[16px] w-[16px]" strokeWidth={1.6} />
              </button>
            </li>
          </ul>
        </nav>
      ) : (
        <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-3 [scrollbar-width:thin]">
          {/* Daily driver — solo lo que usás todos los días. Sin ruido de motor. */}
          <ul className="space-y-0.5">
            {/* El bloque Team queda oculto por defecto — es 100% motor/admin. Se revela en Avanzado abajo. */}
          </ul>

          {/* Factories — outer radius 12px = inner 8 + 4 padding */}
          <motion.div
            initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: EASE_ARRAY, delay: 0.38 }}
            className="mt-5"
            style={{ willChange: "transform, opacity, filter" }}
          >
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-400">
                Factories
              </span>
              <motion.button
                whileTap={{ scale: 0.96 }}
                transition={SPRING}
                onClick={() => openFactoryDialog()}
                aria-label="Add factory"
                className="grid h-6 w-6 place-items-center rounded-[8px] text-zinc-400 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] hover:text-zinc-700 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
              </motion.button>
            </div>

            <ul className="mt-1 space-y-0.5">
              {factories.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] leading-snug text-zinc-400">
                  Sin factories todavía — creá la primera con{" "}
                  <span className="font-medium text-zinc-500">+ Add factory</span>.
                </li>
              )}

              {/* Lista real del workspace — §5.3: cada fila selecciona su factory. */}
              {factories.map((factory, factoryIndex) => {
                const isOpen = openUid === factory.uid;
                const isSelected = selected?.uid === factory.uid;
                const pinned = factory.pinned ?? false;
                return (
                  <motion.li
                    key={factory.uid}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: EASE_ARRAY, delay: 0.46 + factoryIndex * 0.06 }}
                  >
                    <div
                      className={[
                        "group flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 transition-[background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
                        isSelected
                          ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]"
                          : "hover:bg-zinc-900/[0.06]",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => select(factory.uid)}
                        aria-current={isSelected ? "true" : undefined}
                        title={factory.alias === factory.name ? factory.name : `${factory.name} · ${factory.alias}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                      >
                        <span
                          className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-white"
                          style={{ boxShadow: "0 0 0 1px oklch(0 0 0 / 0.08), 0 1px 2px rgba(0,0,0,0.06)" }}
                        >
                          <span className="h-5 w-5 bg-[conic-gradient(from_180deg_at_50%_50%,#8b5cf6,#38bdf8,#34d399,#8b5cf6)]" />
                        </span>
                        <span
                          className={[
                            "truncate text-[13.5px] tracking-[-0.01em] group-hover:text-zinc-900",
                            isSelected ? "font-[550] text-zinc-900" : "font-[500] text-zinc-700",
                          ].join(" ")}
                        >
                          {factory.name}
                        </span>
                      </button>
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : factory.uid)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `Contraer ${factory.name}` : `Expandir ${factory.name}`}
                          className="grid h-6 w-6 place-items-center rounded-[8px] text-zinc-400 transition-[background-color,color] duration-150 hover:bg-zinc-900/[0.06] hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                        >
                          <ChevronDown
                            className="h-3.5 w-3.5"
                            strokeWidth={1.9}
                            style={{
                              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                              transition: `transform 0.3s ${EASE}`,
                            }}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            store.togglePinned(factory.uid);
                          }}
                          aria-pressed={pinned}
                          aria-label={pinned ? `Soltar ${factory.name}` : `Fijar ${factory.name}`}
                          className={[
                            "grid h-6 w-6 place-items-center rounded-[8px] transition-[background-color,scale] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                            pinned ? "text-violet-600" : "text-zinc-300 group-hover:text-zinc-400",
                          ].join(" ")}
                        >
                          <Pin
                            className={[
                              "h-3.5 w-3.5 transition-[fill,transform] duration-150",
                              pinned ? "rotate-45 fill-violet-500 text-violet-500" : "rotate-45",
                            ].join(" ")}
                            strokeWidth={1.7}
                          />
                        </button>
                      </span>
                    </div>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.ul
                          key={`${factory.uid}-children`}
                          initial={{ opacity: 0, height: 0, filter: "blur(4px)" }}
                          animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
                          exit={{
                            opacity: 0,
                            height: 0,
                            filter: "blur(4px)",
                            // subtle exit: small translateY instead of full height
                            y: 4,
                          }}
                          transition={{
                            height: { duration: 0.28, ease: EASE_ARRAY },
                            opacity: { duration: 0.2, ease: EASE_ARRAY },
                            filter: { duration: 0.22, ease: EASE_ARRAY },
                          }}
                          className="mt-0.5 space-y-0.5 overflow-hidden pl-[34px] pr-1"
                          style={{ willChange: "height, opacity, filter" }}
                        >
                          {FACTORY_DAILY_ITEMS.map((item, index) => {
                            const isActive = item.id === activeItem;
                            return (
                              <motion.li
                                key={item.id}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.04 + index * 0.02, duration: 0.22, ease: EASE_ARRAY }}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleNav(item.id)}
                                  aria-current={isActive ? "page" : undefined}
                                  // Without this the badge leaks into the accessible name as a bare "7".
                                  aria-label={item.badge ? `${item.label} — ${item.badge} pendientes` : undefined}
                                  className={[
                                    "flex w-full items-center rounded-[8px] px-2 py-[7px] text-left text-[13.5px] transition-[background-color,color,scale,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                                    isActive
                                      ? "bg-white font-[500] tracking-[-0.01em] text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.07)]"
                                      : "font-[450] text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-700",
                                  ].join(" ")}
                                  style={{ willChange: "transform" }}
                                >
                                  <span className="truncate">{item.label}</span>
                                  {item.badge && (
                                    <span className="ml-auto shrink-0 rounded-full bg-zinc-900/[0.06] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500">
                                      {item.badge}
                                    </span>
                                  )}
                                </button>
                              </motion.li>
                            );
                          })}
                          {/* Avanzado dentro de la factory — revela el motor sin ensuciar el daily */}
                          {FACTORY_ADVANCED_ITEMS.length > 0 && (
                            <motion.li
                              key={`${factory.uid}-advanced-toggle`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: 0.22, duration: 0.18, ease: EASE_ARRAY }}
                              className="pt-1"
                            >
                              <button
                                type="button"
                                onClick={() => setShowAdvanced((v) => !v)}
                                aria-expanded={showAdvanced}
                                aria-label={showAdvanced ? "Ocultar motor" : "Mostrar motor"}
                                className="flex w-full items-center justify-between rounded-[8px] px-2 py-1 text-left text-[11px] font-[500] tracking-[0.02em] uppercase text-zinc-400 transition-[background-color,color] duration-150 hover:bg-zinc-900/[0.04] hover:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                              >
                                <span>{showAdvanced ? "Ocultar motor" : `Motor · ${FACTORY_ADVANCED_ITEMS.length}`}</span>
                                <ChevronDown
                                  className="h-3 w-3"
                                  strokeWidth={1.9}
                                  style={{
                                    transform: showAdvanced ? "rotate(0deg)" : "rotate(-90deg)",
                                    transition: `transform 0.2s ${EASE}`,
                                  }}
                                />
                              </button>
                            </motion.li>
                          )}
                          <AnimatePresence initial={false}>
                            {showAdvanced &&
                              FACTORY_ADVANCED_ITEMS.map((item, advIndex) => {
                                const isActive = item.id === activeItem;
                                return (
                                  <motion.li
                                    key={`${factory.uid}-${item.id}`}
                                    initial={{ opacity: 0, y: 2 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 2 }}
                                    transition={{ delay: advIndex * 0.015, duration: 0.16, ease: EASE_ARRAY }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleNav(item.id)}
                                      aria-current={isActive ? "page" : undefined}
                                      className={[
                                        "flex w-full items-center rounded-[8px] px-2 py-[6px] text-left text-[12.5px] transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                                        isActive
                                          ? "bg-zinc-900/[0.06] font-[500] text-zinc-700"
                                          : "font-[400] text-zinc-400 hover:bg-zinc-900/[0.04] hover:text-zinc-600",
                                      ].join(" ")}
                                    >
                                      <span className="truncate">{item.label}</span>
                                      <span className="ml-auto text-[10px] tracking-[0.02em] text-zinc-400">motor</span>
                                    </button>
                                  </motion.li>
                                );
                              })}
                          </AnimatePresence>
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </ul>

            {/* Avanzado global — Team-level + motor compartido. Colapsado por defecto para respetar la Ley de Fitts. */}
            <div className="mt-4 border-t border-zinc-200/60 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-400 transition-[background-color,color] duration-150 hover:bg-zinc-900/[0.04] hover:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
              >
                <span>Avanzado</span>
                <span className="flex items-center gap-1.5">
                  <span className="rounded-full bg-zinc-900/[0.06] px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-zinc-500">
                    {TEAM_ADVANCED_ITEMS.length + FACTORY_ADVANCED_ITEMS.length}
                  </span>
                  <ChevronDown
                    className="h-3 w-3"
                    strokeWidth={1.9}
                    style={{
                      transform: showAdvanced ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: `transform 0.2s ${EASE}`,
                    }}
                  />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.ul
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: EASE_ARRAY }}
                    className="mt-1 space-y-0.5 overflow-hidden"
                  >
                    <li className="px-2 py-1 text-[10px] font-[500] tracking-[0.06em] uppercase text-zinc-300">Team</li>
                    {TEAM_ADVANCED_ITEMS.map((item) => {
                      const Icon = NAV_ICONS[item.id] ?? Waypoints;
                      const isActive = item.id === activeItem;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => handleNav(item.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={[
                              "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                              isActive
                                ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                                : "text-zinc-500 hover:bg-zinc-900/[0.04] hover:text-zinc-600",
                            ].join(" ")}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.6} />
                            <span className="truncate">{item.label}</span>
                            <span className="ml-auto hidden text-[10px] text-zinc-400 sm:inline">{item.trace}</span>
                          </button>
                        </li>
                      );
                    })}
                    <li className="mt-2 px-2 py-1 text-[10px] font-[500] tracking-[0.06em] uppercase text-zinc-300">Motor por factory</li>
                    <li className="px-2 text-[11px] leading-snug text-zinc-400">
                      Expandí una factory y tocá “Motor” para ver Runners, Skills, API, etc. de esa factory.
                    </li>
                  </motion.ul>
                )}
              </AnimatePresence>
              {!showAdvanced && (
                <p className="mt-1.5 px-2 text-[11px] leading-snug text-zinc-400">
                  Runners, Skills, Factory API, MCP tools, Infra, Validation y los deep dives quedan aquí. No se borra nada — solo oculto para tu daily.
                </p>
              )}
            </div>
          </motion.div>
        </nav>
      )}

      {/* User — elevation + image outline, concentric radius */}
      <motion.div
        initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.3, ease: EASE_ARRAY, delay: 0.62 }}
        className={["shrink-0 border-t border-zinc-200/70 px-2 py-2", collapsed ? "flex justify-center" : ""].join(" ")}
        style={{ willChange: "transform, opacity, filter" }}
      >
        <button
          type="button"
          aria-label="Benjamin Holmes — Member"
          title="Benjamin Holmes — Member"
          className="flex w-full items-center justify-between rounded-[10px] px-1.5 py-1.5 transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
        >
          <span className="flex items-center gap-2.5">
            <img
              src="https://i.pravatar.cc/100?img=12"
              alt="Benjamin Holmes"
              width={28}
              height={28}
              className="h-7 w-7 rounded-full object-cover"
              style={{
                // Image outline: pure black 0.08, not tinted neutral
                boxShadow: "0 0 0 1px oklch(0 0 0 / 0.08), 0 1px 2px rgba(0,0,0,0.08)",
              }}
            />
            {!collapsed && (
              <span className="text-left leading-tight">
                <span className="block text-[13px] font-[550] tracking-[-0.01em] text-zinc-900">
                  Benjamin Holmes
                </span>
                <span className="block text-[11.5px] font-[450] text-zinc-500">Member</span>
              </span>
            )}
          </span>
          {!collapsed && (
            <span className="grid h-7 w-7 place-items-center text-zinc-400">
              <ChevronDown className="h-4 w-4" strokeWidth={1.7} />
            </span>
          )}
        </button>
      </motion.div>

      {dialog !== null && (
        <NewFactoryDialog
          key={dialog.key}
          suggestedName={dialog.suggestedName}
          onClose={() => setDialog(null)}
          onCreated={handleFactoryCreated}
        />
      )}
    </aside>
  );
}
