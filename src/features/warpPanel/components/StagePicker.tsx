import { PIPELINE_HOOK_SLOTS } from "./newAgentForm";

/**
 * StagePicker — selector visual del hook sobre el pipeline real.
 * Muestra las etapas fijas (Intake→…→Complete, no interactivas) con los 3
 * slots hook clicables entre ellas. Clic en el slot elegido = volver a
 * "none". Mismo lenguaje visual del panel (dots, mono 10px, dashed).
 */

const CORE_DOT = "#555";
const SLOT_BORDER = "#2e2e2e";

export interface StagePickerProps {
  value: string;
  onChange: (stage: string) => void;
  compact?: boolean;
}

function CoreNode({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flexShrink: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: CORE_DOT }} />
      <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 9, color: "var(--wp-text-disabled)", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </div>
  );
}

function Link() {
  return <span style={{ flex: 1, minWidth: 8, height: 1, background: "#242424", marginBottom: 22 }} />;
}

export default function StagePicker({ value, onChange, compact = false }: StagePickerProps) {
  // Orden visual: Intake Foreman Triage [pre-build] Building [post-build] Review [post-review] Complete
  const order: Array<{ kind: "core"; label: string } | { kind: "slot"; stage: string; hint: string }> = [
    { kind: "core", label: "Intake" },
    { kind: "core", label: "Foreman" },
    { kind: "core", label: "Triage" },
    { kind: "slot", stage: "pre-build", hint: "Triage → Building" },
    { kind: "core", label: "Building" },
    { kind: "slot", stage: "post-build", hint: "Building → Review" },
    { kind: "core", label: "Review" },
    { kind: "slot", stage: "post-review", hint: "Review → Complete" },
    { kind: "core", label: "Complete" },
  ];
  const selected = PIPELINE_HOOK_SLOTS.some((s) => s.stage === value) ? value : "none";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: compact ? 4 : 6 }}>
        {order.map((node, i) => {
          if (node.kind === "core") {
            return (
              <span key={`c-${node.label}`} style={{ display: "flex", alignItems: "flex-start", gap: compact ? 4 : 6, flex: node.label === "Complete" ? "0 0 auto" : 1 }}>
                <CoreNode label={node.label} />
                {node.label !== "Complete" && <Link />}
              </span>
            );
          }
          const active = selected === node.stage;
          return (
            <span key={`s-${node.stage}`} style={{ display: "flex", alignItems: "flex-start", gap: compact ? 4 : 6, flex: 1 }}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`Hook slot ${node.stage} (${node.hint})`}
                title={node.hint}
                onClick={() => onChange(active ? "none" : node.stage)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                  background: "transparent", border: "none", cursor: "pointer", padding: 2, flexShrink: 0,
                }}
              >
                <span
                  style={{
                    padding: "3px 8px", borderRadius: 20,
                    border: `1px ${active ? "solid" : "dashed"} ${active ? "var(--wp-accent)" : SLOT_BORDER}`,
                    background: active ? "rgba(255,255,255,0.05)" : "transparent",
                    fontFamily: "var(--wp-font-mono)", fontSize: 9,
                    color: active ? "var(--wp-text-primary)" : "var(--wp-text-disabled)",
                    whiteSpace: "nowrap", transition: "border-color 120ms, color 120ms",
                  }}
                >
                  {node.stage}
                </span>
                <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 8, color: "#363636", whiteSpace: "nowrap" }}>
                  {node.hint}
                </span>
              </button>
              <Link />
            </span>
          );
        })}
      </div>
      <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 11, color: "var(--wp-text-disabled)", margin: "8px 0 0", lineHeight: 1.6 }}>
        {selected === "none"
          ? "No hook — the agent exists but the pipeline never runs it."
          : `Hook: ${selected} — runs on every job passing that point.`}
      </p>
    </div>
  );
}
