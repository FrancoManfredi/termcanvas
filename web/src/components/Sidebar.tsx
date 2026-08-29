import {
  ChevronDown,
  KeyRound,
  LayoutGrid,
  List,
  PanelLeft,
  Pin,
  Plus,
  Search,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// ——— tokens ———
// Concentric radius: outer 12px = inner 8px + 4px padding
// Duration / easing exact per skill: 150ms hover, 0.2,0,0,1
// Press scale 0.96, spring bounce 0, duration 0.3
// Image outline: oklch(0 0 0 / 0.08)
// Will-change only on transform/opacity/filter

const EASE = "cubic-bezier(0.2, 0, 0, 1)" as const;
const SPRING = { type: "spring" as const, duration: 0.3, bounce: 0 };

function NavItem({
  icon: Icon,
  label,
  active,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  delay?: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay }}
      style={{ willChange: "transform, opacity, filter" }}
    >
      <a
        href="#"
        aria-current={active ? "page" : undefined}
        className={[
          "group flex items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-[13.5px] leading-none",
          "transition-[background-color,color,box-shadow,scale] duration-150",
          "ease-[cubic-bezier(0.2,0,0,1)]",
          "active:scale-[0.96]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20 focus-visible:ring-offset-0",
          active
            ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]"
            : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
        ].join(" ")}
        style={{ willChange: "transform" }}
      >
        <Icon
          className={[
            "h-[16px] w-[16px] shrink-0 transition-[color] duration-150",
            active ? "text-zinc-900" : "text-zinc-400 group-hover:text-zinc-600",
          ].join(" ")}
          // Match stroke to text weight: regular 400 → 1.6px (skill: 1.5 beside regular)
          strokeWidth={active ? 1.9 : 1.6}
          aria-hidden
        />
        <span className={active ? "font-[500] tracking-[-0.01em]" : "font-[450]"}>
          {label}
        </span>
      </a>
    </motion.li>
  );
}
void NavItem;

interface SidebarProps {
  activeItem?: string;
  onNavigate?: (item: string) => void;
}

export function Sidebar({ activeItem = "Activity", onNavigate }: SidebarProps) {
  const [wilsonOpen, setWilsonOpen] = useState(true);
  const [devExPinned] = useState(true);
  const [wilsonPinned] = useState(true);

  function handleNav(item: string) {
    onNavigate?.(item);
  }

  return (
    <aside className="flex h-screen w-[272px] shrink-0 flex-col border-r border-zinc-200 bg-[#fcfcfc] text-[13.5px] leading-none selection:bg-violet-500/10">
      {/* Top bar — optical alignment: icon nudged 0.5px, hit area 28px */}
      <motion.div
        initial={{ opacity: 0, y: -4, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="flex h-[44px] shrink-0 items-center justify-between px-2.5"
      >
        <button
          aria-label="Toggle sidebar"
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

        <div className="flex items-center gap-0.5">
          <button
            aria-label="Search"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-zinc-500 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] hover:text-zinc-700 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
            style={{ willChange: "transform" }}
          >
            <Search className="h-[17px] w-[17px]" strokeWidth={1.6} />
          </button>
          <button
            aria-label="Toggle panel"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-zinc-500 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] hover:text-zinc-700 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
            style={{ willChange: "transform" }}
          >
            <PanelLeft className="h-[17px] w-[17px]" strokeWidth={1.6} />
          </button>
        </div>
      </motion.div>

      {/* Divider — structural border, not shadow */}
      <div className="mx-3 h-px shrink-0 bg-zinc-200/70" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-3 [scrollbar-width:thin]">
        {/* Primary — staggered ~90ms per row — team-level (WarpFactories.md §10) */}
        <ul className="space-y-0.5">
          <motion.li initial={{ opacity: 0, y: 4, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: 0.06 }} style={{ willChange: "transform, opacity, filter" }}>
            <button
              onClick={() => handleNav("Team Runs")}
              aria-current={activeItem === "Team Runs" ? "page" : undefined}
              className={[
                "group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left text-[13.5px] leading-none transition-[background-color,color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                activeItem === "Team Runs" ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]" : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
              ].join(" ")}
            >
              <List className="h-[16px] w-[16px] shrink-0 text-zinc-400 group-hover:text-zinc-600" strokeWidth={1.6} />
              <span className="font-[450]">Runs</span>
            </button>
          </motion.li>
          <motion.li initial={{ opacity: 0, y: 4, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: 0.14 }} style={{ willChange: "transform, opacity, filter" }}>
            <button
              onClick={() => handleNav("MCPs and apps")}
              aria-current={activeItem === "MCPs and apps" ? "page" : undefined}
              className={[
                "group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left text-[13.5px] leading-none transition-[background-color,color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                activeItem === "MCPs and apps" ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]" : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
              ].join(" ")}
            >
              <LayoutGrid className="h-[16px] w-[16px] shrink-0 text-zinc-400 group-hover:text-zinc-600" strokeWidth={1.6} />
              <span className="font-[450]">MCPs and apps</span>
            </button>
          </motion.li>
          <motion.li initial={{ opacity: 0, y: 4, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: 0.22 }} style={{ willChange: "transform, opacity, filter" }}>
            <button
              onClick={() => handleNav("Secrets")}
              aria-current={activeItem === "Secrets" ? "page" : undefined}
              className={[
                "group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left text-[13.5px] leading-none transition-[background-color,color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                activeItem === "Secrets" ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]" : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
              ].join(" ")}
            >
              <KeyRound className="h-[16px] w-[16px] shrink-0 text-zinc-400 group-hover:text-zinc-600" strokeWidth={1.6} />
              <span className="font-[450]">Secrets</span>
            </button>
          </motion.li>
          <motion.li initial={{ opacity: 0, y: 4, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: 0.3 }} style={{ willChange: "transform, opacity, filter" }}>
            <button
              onClick={() => handleNav("Integrations")}
              aria-current={activeItem === "Integrations" ? "page" : undefined}
              className={[
                "group flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left text-[13.5px] leading-none transition-[background-color,color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                activeItem === "Integrations" ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)]" : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
              ].join(" ")}
            >
              <Waypoints className="h-[16px] w-[16px] shrink-0 text-zinc-400 group-hover:text-zinc-600" strokeWidth={1.6} />
              <span className="font-[450]">Integrations</span>
            </button>
          </motion.li>
        </ul>

        {/* Factories — outer radius 12px = inner 8 + 4 padding */}
        <motion.div
          initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.32, ease: [0.2, 0, 0, 1], delay: 0.38 }}
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
              aria-label="Add factory"
              className="grid h-6 w-6 place-items-center rounded-[8px] text-zinc-400 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] hover:text-zinc-700 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </motion.button>
          </div>

          <ul className="mt-1 space-y-0.5">
            {/* DevEx Factory — collapsed, pinned */}
            <motion.li
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0, 0, 1], delay: 0.46 }}
            >
              <a
                href="#"
                className="group flex items-center justify-between rounded-[8px] px-2 py-1.5 transition-[background-color,color,scale,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                style={{ willChange: "transform" }}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className="grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-white"
                    style={{ boxShadow: "0 0 0 1px oklch(0 0 0 / 0.08), 0 1px 2px rgba(0,0,0,0.06)" }}
                  >
                    <span className="h-5 w-5 bg-[conic-gradient(from_180deg_at_50%_50%,#8b5cf6,#38bdf8,#34d399,#8b5cf6)]" />
                  </span>
                  <span className="text-[13.5px] font-[500] tracking-[-0.01em] text-zinc-700 group-hover:text-zinc-900">
                    DevEx Factory
                  </span>
                </span>
                <span className="flex items-center gap-0.5">
                  <span className="grid h-6 w-6 place-items-center text-zinc-400 transition-[color,transform] duration-150 group-hover:text-zinc-500">
                    {/* chevron — icon animation: opacity/scale/blur, spring 0.3 bounce 0 */}
                    <motion.span
                      initial={false}
                      className="grid place-items-center"
                      style={{ willChange: "transform" }}
                    >
                      <ChevronDown className="h-3.5 w-3.5 rotate-[-90deg]" strokeWidth={1.9} />
                    </motion.span>
                  </span>
                  <span
                    className={[
                      "grid h-6 w-6 place-items-center rounded-[8px] transition-[background-color,scale] duration-150",
                      devExPinned ? "text-violet-600" : "text-zinc-300 group-hover:text-zinc-400",
                    ].join(" ")}
                  >
                    <Pin
                      className={[
                        "h-3.5 w-3.5 transition-[fill,transform] duration-150",
                        devExPinned ? "rotate-45 fill-violet-500 text-violet-500" : "rotate-45",
                      ].join(" ")}
                      strokeWidth={1.7}
                    />
                  </span>
                </span>
              </a>
            </motion.li>

            {/* wilson — expandable */}
            <motion.li
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0, 0, 1], delay: 0.54 }}
            >
              <button
                onClick={() => setWilsonOpen((v) => !v)}
                aria-expanded={wilsonOpen}
                className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-zinc-700 transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                style={{ willChange: "transform" }}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className="grid h-5 w-5 place-items-center rounded-[6px] bg-zinc-900 text-[11px] font-bold tracking-tight text-white"
                    style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.18), 0 0 0 1px oklch(0 0 0 / 0.08)" }}
                  >
                    W
                  </span>
                  <span className="text-[13.5px] font-[500] tracking-[-0.01em] text-zinc-800">
                    wilson
                  </span>
                </span>
                <span className="flex items-center gap-0.5">
                  {/* Chevron — contextual icon animation with blur/scale/opacity */}
                  <span className="relative grid h-6 w-6 place-items-center">
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={wilsonOpen ? "open" : "closed"}
                        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        transition={SPRING}
                        className="absolute inset-0 grid place-items-center text-zinc-500"
                        style={{ willChange: "transform, opacity, filter" }}
                      >
                        <ChevronDown
                          className="h-3.5 w-3.5"
                          strokeWidth={1.9}
                          style={{
                            transform: wilsonOpen ? "rotate(0deg)" : "rotate(-90deg)",
                            transition: `transform 0.3s ${EASE}`,
                          }}
                        />
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span
                    className={[
                      "grid h-6 w-6 place-items-center rounded-[8px] transition-[background-color] duration-150",
                      wilsonPinned ? "text-violet-600" : "text-zinc-300",
                    ].join(" ")}
                  >
                    <Pin
                      className={[
                        "h-3.5 w-3.5 transition-[transform] duration-200",
                        wilsonPinned ? "rotate-45 fill-violet-500 text-violet-500" : "rotate-45",
                      ].join(" ")}
                      strokeWidth={1.7}
                    />
                  </span>
                </span>
              </button>

              <AnimatePresence initial={false}>
                {wilsonOpen && (
                  <motion.ul
                    key="wilson-children"
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
                      height: { duration: 0.28, ease: [0.2, 0, 0, 1] },
                      opacity: { duration: 0.2, ease: [0.2, 0, 0, 1] },
                      filter: { duration: 0.22, ease: [0.2, 0, 0, 1] },
                    }}
                    className="mt-0.5 space-y-0.5 overflow-hidden pl-[34px] pr-1"
                    style={{ willChange: "height, opacity, filter" }}
                  >
                    {[
                      { label: "Dashboard", delay: 0.04 },
                      { label: "Activity", delay: 0.08 },
                      { label: "Agents", delay: 0.12 },
                      { label: "Automations", delay: 0.16 },
                      { label: "Runs", delay: 0.2 },
                      { label: "Runners", delay: 0.22 },
                      { label: "Scorers", delay: 0.24 },
                      { label: "Skills", delay: 0.26 },
                      { label: "Benchmarks", delay: 0.28 },
                      { label: "Factory definition", delay: 0.3 },
                      { label: "Settings", delay: 0.32 },
                    ].map(({ label, delay }) => {
                      const isActive = label === activeItem;
                      return (
                        <motion.li
                          key={label}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay, duration: 0.22, ease: [0.2, 0, 0, 1] }}
                        >
                          <button
                            onClick={() => handleNav(label)}
                            aria-current={isActive ? "page" : undefined}
                            className={[
                              "flex w-full items-center rounded-[8px] px-2 py-[7px] text-left text-[13.5px] transition-[background-color,color,scale,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                              isActive
                                ? "bg-white font-[500] tracking-[-0.01em] text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.07)]"
                                : "font-[450] text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-700",
                            ].join(" ")}
                            style={{ willChange: "transform" }}
                          >
                            {label}
                          </button>
                        </motion.li>
                      );
                    })}
                    <motion.li
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.28, duration: 0.22, ease: [0.2, 0, 0, 1] }}
                    >
                      <button
                        onClick={() => handleNav("Self-improvement")}
                        aria-current={activeItem === "Self-improvement" ? "page" : undefined}
                        className={[
                          "flex w-full items-center justify-between rounded-[8px] px-2 py-[7px] text-left transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                          activeItem === "Self-improvement"
                            ? "bg-white font-[500] text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.07)]"
                            : "text-zinc-500 hover:bg-zinc-900/[0.06] hover:text-zinc-700",
                        ].join(" ")}
                        style={{ willChange: "transform" }}
                      >
                        <span>Self-improvement</span>
                        <span className="rounded-full bg-zinc-900/[0.06] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500">
                          7
                        </span>
                      </button>
                    </motion.li>
                  </motion.ul>
                )}
              </AnimatePresence>
            </motion.li>
          </ul>
        </motion.div>
      </nav>

      {/* User — elevation + image outline, concentric radius */}
      <motion.div
        initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1], delay: 0.62 }}
        className="shrink-0 border-t border-zinc-200/70 px-2 py-2"
        style={{ willChange: "transform, opacity, filter" }}
      >
        <button className="flex w-full items-center justify-between rounded-[10px] px-1.5 py-1.5 transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-zinc-900/[0.06] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">
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
            <span className="text-left leading-tight">
              <span className="block text-[13px] font-[550] tracking-[-0.01em] text-zinc-900">
                Benjamin Holmes
              </span>
              <span className="block text-[11.5px] font-[450] text-zinc-500">Member</span>
            </span>
          </span>
          <span className="grid h-7 w-7 place-items-center text-zinc-400">
            <ChevronDown className="h-4 w-4" strokeWidth={1.7} />
          </span>
        </button>
      </motion.div>
    </aside>
  );
}
