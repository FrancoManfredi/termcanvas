// SRP: reusable ? help link that navigates to Troubleshooting anchor with lazy-safe scroll
// Source: WarpFactories.md §18 · PRD P0-06 · US-145→148
// OCP: add anchor = add entry in TroubleshootingAnchor + TROUBLESHOOTING_ANCHORS, no existing logic mutated
// DIP: HelpLink depends on HelpNavContext abstraction, not on App concrete

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { NavItemId } from "../../nav";

export type TroubleshootingAnchor =
  | "setup"
  | "work-not-starting"
  | "two-runs"
  | "runs-stuck"
  | "no-pr"
  | "factory-api";

// oxlint-disable-next-line react/only-export-components -- constant co-located for OCP
export const TROUBLESHOOTING_ANCHORS: Record<TroubleshootingAnchor, string> = {
  setup: "setup",
  "work-not-starting": "work-not-starting",
  "two-runs": "two-runs",
  "runs-stuck": "runs-stuck",
  "no-pr": "no-pr",
  "factory-api": "factory-api",
};

export interface HelpLinkProps {
  readonly anchor: TroubleshootingAnchor;
  readonly label?: string;
}

const HelpNavContext = createContext<((id: NavItemId) => void) | undefined>(undefined);

export function HelpNavProvider({
  navigate,
  children,
}: {
  readonly navigate: (id: NavItemId) => void;
  readonly children: ReactNode;
}): ReactNode {
  return <HelpNavContext.Provider value={navigate}>{children}</HelpNavContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components -- helper hook co-located
export function useHelpNav(): ((id: NavItemId) => void) | undefined {
  return useContext(HelpNavContext);
}

export function HelpLink({ anchor, label }: HelpLinkProps) {
  const navigate = useHelpNav();
  const targetId = TROUBLESHOOTING_ANCHORS[anchor];
  const ariaLabel = label ?? `Ayuda: ${anchor}`;
  const title = label ?? `Ver Troubleshooting — ${anchor}`;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>): void {
    e.preventDefault();
    if (typeof window !== "undefined") {
      window.location.hash = targetId;
      if (navigate) {
        navigate("Troubleshooting");
        // lazy() mount needs a tick before the target exists in DOM
        window.setTimeout(() => {
          document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      } else {
        // fallback for tests or when provider missing: try legacy data-nav click
        const fallback = document.querySelector('[data-nav="Troubleshooting"]') as HTMLElement | null;
        fallback?.click();
        window.setTimeout(() => {
          document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    }
  }

  return (
    <a
      href={`#${targetId}`}
      aria-label={ariaLabel}
      title={title}
      onClick={handleClick}
      className="grid h-6 w-6 place-items-center rounded-[6px] border border-violet-200 bg-violet-50 text-[11px] font-bold text-violet-700 transition-[background-color,color,scale] duration-150 hover:bg-violet-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
    >
      ?
    </a>
  );
}
