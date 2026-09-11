import { useState } from "react";
import SidePanel from "./components/SidePanel";
import KanbanBoard from "./components/KanbanBoard";
import ActivityPanel from "./components/ActivityPanel";
import AgentsPanel from "./components/AgentsPanel";
import type { NavSection } from "./components/SidePanel";

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>("issues");

  return (
    <div
      className="size-full flex"
      style={{ background: "var(--bg)", fontFamily: "var(--font-sans)" }}
    >
      <SidePanel activeSection={activeSection} onSectionChange={setActiveSection} />

      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        {activeSection === "issues"   && <KanbanBoard />}
        {activeSection === "activity" && <ActivityPanel />}
        {activeSection === "agents"   && <AgentsPanel />}
        {activeSection !== "issues" && activeSection !== "activity" && activeSection !== "agents" && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#2e2e2e" }}>
              {activeSection}
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
