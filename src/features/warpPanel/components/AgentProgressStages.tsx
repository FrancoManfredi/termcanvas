/**
 * Stepper de Agent Progress: etapas EXACTAS del workflow del engine.
 * Solo pinta; toda la derivación vive en `adapters/agentTimeline.ts`.
 */
import type { AgentStage, AgentStageState, AgentTimelineModel } from "../adapters/agentTimeline";
import { splitStageKinds } from "../adapters/agentTimeline";

const ERROR_ACCENT = "#f85149";

function stageAccent(state: AgentStageState): string {
  if (state === "failed" || state === "cancelled") return ERROR_ACCENT;
  if (state === "waiting-gate") return "var(--wp-status-awaiting)";
  if (state === "running") return "var(--wp-status-progress)";
  if (state === "completed" || state === "skipped")
    return "var(--wp-status-done)";
  return "var(--wp-border)";
}

function isDone(state: AgentStageState): boolean {
  return state === "completed" || state === "skipped";
}

function isActive(state: AgentStageState): boolean {
  return state === "running" || state === "waiting-gate";
}

export function AgentProgressStages({
  timeline,
}: {
  timeline: AgentTimelineModel;
}) {
  // WS-UI: las etapas system-owned (verify-runner) NO se intercalan en el
  // progreso de los agentes: van a un costado, compactas, y se colorean
  // cuando la fase corre de verdad.
  const { agent: agentStages, system: systemStages } = splitStageKinds(
    timeline.stages,
  );
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "flex-start", flex: 1 }}>
        {agentStages.map((stage: AgentStage, i: number) => {
          const accent = stageAccent(stage.state);
          const done = isDone(stage.state);
          const active = isActive(stage.state);
          const failed = stage.state === "failed" || stage.state === "cancelled";
          return (
            <div
              key={stage.id}
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
                  title={
                    stage.state === "waiting-gate"
                      ? `${stage.label} — waiting for your decision`
                      : `${stage.label} — ${stage.state}`
                  }
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: done || active || failed ? accent : "var(--wp-bg-hover)",
                    border: active
                      ? `2px solid ${accent}`
                      : done || failed
                        ? "none"
                        : "2px solid var(--wp-border)",
                    boxShadow: active ? `0 0 10px ${accent}` : "none",
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
                      ? accent
                      : done
                        ? "var(--wp-text-tertiary)"
                        : failed
                          ? ERROR_ACCENT
                          : "var(--wp-text-disabled)",
                  }}
                >
                  {stage.label}
                </span>
              </div>
              {i < agentStages.length - 1 && (
                <div
                  style={{
                    height: 1,
                    flex: 1,
                    background:
                      done || agentStages[i + 1]?.state !== "pending"
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
      {systemStages.length > 0 && (
        <div
          title="System-owned stages (run in the worktree, no agent session)"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            marginTop: 2,
            marginLeft: 8,
            paddingLeft: 10,
            borderLeft: "1px solid var(--wp-border-subtle)",
          }}
        >
          {systemStages.map((stage: AgentStage) => {
            const accent = stageAccent(stage.state);
            const done = isDone(stage.state);
            const active = isActive(stage.state);
            const failed = stage.state === "failed" || stage.state === "cancelled";
            return (
              <span
                key={stage.id}
                title={`${stage.label} — system check (${stage.state})`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 9,
                  color: active
                    ? accent
                    : failed
                      ? ERROR_ACCENT
                      : done
                        ? "var(--wp-text-tertiary)"
                        : "var(--wp-text-disabled)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background:
                      active || done || failed ? accent : "var(--wp-bg-hover)",
                    border: active
                      ? `2px solid ${accent}`
                      : done || failed
                        ? "none"
                        : "2px solid var(--wp-border)",
                    boxShadow: active ? `0 0 8px ${accent}` : "none",
                    transition: "all 200ms",
                  }}
                />
                {stage.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AgentProgressStages;
