import type { AgentDefinition, FactoryDefinition } from "../../lib/factory/domain/types";
import { redactSecret } from "../secrets/SecretsRedacted";


function getEffectiveHarness(agent: AgentDefinition, factory: FactoryDefinition): string {
  if (agent.harness) {
    const parts: string[] = [agent.harness.type];
    if (agent.harness.model) parts.push(agent.harness.model);
    if (agent.harness.auth) {
      const redacted = agent.harness.auth.secretName ? redactSecret(agent.harness.auth.secretName) : "";
      parts.push(`auth:${agent.harness.auth.source}${redacted ? `:${redacted}` : ""}`);
    }
    const v = parts.join(" · ");
    return v;
  }
  if (agent.model) {
    return agent.model;
  }
  if (factory.agentDefaults.harness) {
    return `${factory.agentDefaults.harness.type} (inherited)`;
  }
  if (factory.agentDefaults.model) {
    return `${factory.agentDefaults.model} (inherited)`;
  }
  return "—";
}

function getEffectiveRunner(agent: AgentDefinition, factory: FactoryDefinition): string {
  const v = agent.runner ?? factory.agentDefaults.runner ?? "—";
  return v;
}

function getEffectiveWorkerHost(agent: AgentDefinition, factory: FactoryDefinition): string {
  const v = agent.workerHost ?? factory.agentDefaults.workerHost ?? "—";
  return v;
}

function getAgentTypeBadgeColor(type: string): string {
  switch (type) {
    case "FOREMAN":
    case "MAIN":
      return "bg-violet-600 text-white";
    case "TRIAGE":
      return "bg-amber-500 text-white";
    case "SPEC":
      return "bg-sky-600 text-white";
    case "IMPLEMENT":
      return "bg-emerald-600 text-white";
    case "REVIEW":
      return "bg-red-500 text-white";
    case "VERIFY":
      return "bg-zinc-700 text-white";
    default:
      return "bg-zinc-500 text-white";
  }
}

export interface AgentDetailProps {
  agent: AgentDefinition;
  factory: FactoryDefinition;
}

export function AgentDetail({ agent, factory }: AgentDetailProps) {

  function renderSecrets(): string {
    if (!agent.secrets?.length && !factory.agentDefaults.secrets?.length && !factory.secrets?.length) {
      return "—";
    }
    const parts: string[] = [];
    if (factory.secrets?.length) parts.push(`factory: ${factory.secrets.map(redactSecret).join(", ")}`);
    if (factory.agentDefaults.secrets?.length) parts.push(`defaults: ${factory.agentDefaults.secrets.map(redactSecret).join(", ")}`);
    if (agent.secrets?.length) parts.push(agent.secrets.map(redactSecret).join(", "));
    const v = parts.join(" · ") || "—";
    return v;
  }

  function renderMcpServers(): string {
    const servers = agent.mcpServers ?? factory.agentDefaults.mcpServers ?? factory.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      return "—";
    }
    const v = Object.entries(servers)
      .map(([k, v]) => `${k} (${redactSecret(v.warpId)})`)
      .join(", ");
    return v;
  }

  function renderInstructions(): string {
    const v = agent.instructions?.trim() ?? "";
    return v || "—";
  }

  function isValidRawPath(p: string): boolean {
    return /^[a-z0-9\/._-]+\.md$/.test(p);
  }
  const safeRawPath = isValidRawPath(agent.rawPath) ? agent.rawPath : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">{agent.name}</h2>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase ${getAgentTypeBadgeColor(agent.agentType)}`}>
            {agent.agentType}
          </span>
        </div>
        {agent.description && <p className="mt-1 text-[12.5px] leading-snug text-zinc-600">{agent.description}</p>}
        <p className="mt-1 font-mono text-[11px] text-zinc-500">{safeRawPath || agent.rawPath}</p>
      </div>

      {/* Read-only banner — GitHub-backed */}
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
        <p className="text-[11px] font-medium text-amber-800">
          GitHub-backed — read-only. Config lives in{" "}
          {safeRawPath ? (
            <button type="button" onClick={() => { window.location.hash = safeRawPath; }} className="font-mono underline decoration-amber-300 underline-offset-2 hover:text-amber-900">
              {safeRawPath}
            </button>
          ) : (
            <span className="font-mono text-zinc-500">{agent.rawPath}</span>
          )}{" "}
          — edit via PR.
        </p>
        <p className="mt-0.5 text-[11px] text-amber-700">Read-only — GitHub-backed</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Config grid */}
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Harness / Model</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{getEffectiveHarness(agent, factory)}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Runner</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{getEffectiveRunner(agent, factory)}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">WorkerHost</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{getEffectiveWorkerHost(agent, factory)}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Agent Type</p>
              <p className="mt-0.5 text-[12px] font-medium text-zinc-800">{agent.agentType}</p>
            </div>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Secrets</p>
            <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{renderSecrets()}</p>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">MCP Servers</p>
            <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{renderMcpServers()}</p>
          </div>

          {agent.credentialStrategy && (
            <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Credential Strategy</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{agent.credentialStrategy}</p>
            </div>
          )}

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-3">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Instructions (agent.md body)</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-800">{renderInstructions()}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentDetail;
