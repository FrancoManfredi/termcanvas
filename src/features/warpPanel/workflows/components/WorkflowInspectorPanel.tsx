/**
 * Inspector — right column (read-only). Shows the selected node/edge detail,
 * or the workflow overview when nothing is selected. Only fields that exist
 * in the definition are rendered (honest-empty, never invented).
 */

import type { ReactNode } from "react";
import { displayNodeTitle, kindLabel, type ResolvedCanvas } from "../derive";
import { MOCK_RUNNER } from "../mockWorkflows";
import type {
  AgentCatalogEntry,
  CanvasSelection,
  WorkflowCanvasEdge,
  WorkflowDefinition,
  WorkflowNode,
} from "../types";

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="wf-inspector-label">{children}</div>;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wf-meta-row">
      <span className="wf-meta-key">{label}</span>
      <span className="wf-meta-value">{children}</span>
    </div>
  );
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="wf-chip" title={title}>
      {children}
    </span>
  );
}

function formatSchemaKeys(format: Record<string, unknown> | undefined): string[] {
  const properties = format?.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties as Record<string, unknown>);
}

function NodeDetail({
  node,
  deps,
  agents,
  onSelect,
}: {
  node: WorkflowNode;
  deps: Array<{ id: string }>;
  agents: AgentCatalogEntry[];
  onSelect: (selection: CanvasSelection) => void;
}) {
  const schemaKeys = formatSchemaKeys(node.outputFormat);
  const agent =
    node.agent !== undefined ? agents.find((entry) => entry.name === node.agent) : undefined;
  return (
    <>
      <div className="wf-inspector-head">
        <div style={{ minWidth: 0 }}>
          <div className="wf-inspector-title">{displayNodeTitle(node.id)}</div>
          <div className="wf-inspector-sub">{node.id}</div>
        </div>
        <Chip>{kindLabel(node.kind)}</Chip>
      </div>

      {node.groupId !== undefined && <MetaRow label="loop group">{node.groupId}</MetaRow>}
      {node.command !== undefined && <MetaRow label="command">{node.command}</MetaRow>}
      {node.subWorkflow !== undefined && (
        <MetaRow label="sub-workflow">{node.subWorkflow}</MetaRow>
      )}
      {node.outputType !== undefined && (
        <MetaRow label="output type">{node.outputType}</MetaRow>
      )}
      {node.wait !== undefined && <MetaRow label="event">{node.wait.event}</MetaRow>}

      {agent !== undefined && (
        <>
          <SectionLabel>Agent</SectionLabel>
          <MetaRow label="model">
            <span className="wf-mono">{agent.model}</span>
          </MetaRow>
          <MetaRow label="type">{agent.agentType}</MetaRow>
          {agent.tools.length > 0 && (
            <div className="wf-chip-row">
              {agent.tools.map((tool) => (
                <Chip key={tool}>{tool}</Chip>
              ))}
            </div>
          )}
          <div className="wf-inspector-hint">{agent.description}</div>
        </>
      )}

      {deps.length > 0 && (
        <>
          <SectionLabel>Depends on</SectionLabel>
          <div className="wf-chip-row">
            {deps.map((dep) => (
              <button
                key={dep.id}
                type="button"
                className="wf-chip wf-chip-button"
                title={`Seleccionar ${dep.id}`}
                onClick={() => onSelect({ type: "node", id: dep.id })}
              >
                {dep.id}
              </button>
            ))}
          </div>
        </>
      )}

      {node.approval !== undefined && (
        <>
          <SectionLabel>Approval gate</SectionLabel>
          <div className="wf-code-block">{node.approval.message}</div>
          <MetaRow label="captura respuesta">
            {node.approval.captureResponse ? "sí" : "no"}
          </MetaRow>
          <MetaRow label="max attempts">{node.approval.maxAttempts}</MetaRow>
          {node.approval.rejectPrompt !== undefined && (
            <details className="wf-details">
              <summary>on_reject prompt</summary>
              <div className="wf-code-block">{node.approval.rejectPrompt}</div>
            </details>
          )}
        </>
      )}

      {node.fanOut !== undefined && (
        <>
          <SectionLabel>Fan-out</SectionLabel>
          <MetaRow label="items">
            <span className="wf-mono">{node.fanOut.items}</span>
          </MetaRow>
          <MetaRow label="as">{node.fanOut.as}</MetaRow>
          <MetaRow label="max parallel">{node.fanOut.maxParallel}</MetaRow>
          <MetaRow label="join">{node.fanOut.join}</MetaRow>
        </>
      )}

      {node.subWorkflow === "verify-runner" && (
        <>
          <SectionLabel>Runner declarado</SectionLabel>
          <MetaRow label="runner">{MOCK_RUNNER.name}</MetaRow>
          <MetaRow label="isolation">{MOCK_RUNNER.isolation}</MetaRow>
          <MetaRow label="image">
            <span className="wf-mono">{MOCK_RUNNER.image}</span>
          </MetaRow>
          <MetaRow label="shape">
            {MOCK_RUNNER.vcpus} vCPU · {MOCK_RUNNER.memoryGb} GB · {MOCK_RUNNER.platform}
          </MetaRow>
        </>
      )}

      {schemaKeys.length > 0 && (
        <>
          <SectionLabel>Output schema</SectionLabel>
          <div className="wf-chip-row">
            {schemaKeys.map((key) => (
              <Chip key={key}>{key}</Chip>
            ))}
          </div>
        </>
      )}

      {node.prompt !== undefined && (
        <>
          <SectionLabel>Prompt</SectionLabel>
          <div className="wf-code-block wf-code-block-scroll">{node.prompt}</div>
        </>
      )}
    </>
  );
}

function WorkflowDetail({
  def,
  resolved,
}: {
  def: WorkflowDefinition;
  resolved: ResolvedCanvas;
}) {
  const inputs = def.inputs.filter(
    (input) => input.name !== "issue_ref" && input.name !== "issue_body",
  );
  return (
    <>
      <div className="wf-inspector-head">
        <div style={{ minWidth: 0 }}>
          <div className="wf-inspector-title">{def.name}</div>
          <div className="wf-inspector-sub">{def.description}</div>
        </div>
      </div>
      <div className="wf-chip-row">
        <Chip title={def.filePath}>{def.scope}</Chip>
        {def.tags.includes("routable") && (
          <Chip title="El router del foreman puede elegirlo">routable</Chip>
        )}
        <Chip>{resolved.nodes.length} nodos</Chip>
        <Chip>{resolved.edges.length} edges</Chip>
      </div>

      <SectionLabel>Archivo</SectionLabel>
      <div className="wf-path" title={def.filePath}>
        {def.filePath}
      </div>

      {inputs.length > 0 && (
        <>
          <SectionLabel>Inputs</SectionLabel>
          {inputs.map((input) => (
            <MetaRow key={input.name} label={input.name}>
              {input.required && (
                <span className="wf-required" title="Requerido">
                  *
                </span>
              )}
              {input.defaultLabel !== undefined ? (
                <span className="wf-mono">{input.defaultLabel}</span>
              ) : (
                <span className="wf-muted">{input.description ?? "sin default"}</span>
              )}
            </MetaRow>
          ))}
        </>
      )}

      {(def.returns !== undefined || def.outcomeField !== undefined) && (
        <>
          <SectionLabel>Contrato</SectionLabel>
          {def.returns !== undefined && (
            <MetaRow label="returns">
              <span className="wf-mono">{def.returns}</span>
            </MetaRow>
          )}
          {def.outcomeField !== undefined && (
            <MetaRow label="outcome">
              <span className="wf-mono">{def.outcomeField}</span>
            </MetaRow>
          )}
        </>
      )}
    </>
  );
}

function EdgeDetail({ edge }: { edge: WorkflowCanvasEdge }) {
  return (
    <>
      <div className="wf-inspector-head">
        <div style={{ minWidth: 0 }}>
          <div className="wf-inspector-title">Conexión</div>
          <div className="wf-inspector-sub">
            {edge.source} → {edge.target}
          </div>
        </div>
        <Chip>{edge.kind === "loop" ? "loop" : "depends-on"}</Chip>
      </div>
      {edge.label !== undefined && (
        <>
          <SectionLabel>Condición</SectionLabel>
          <div className="wf-code-block">{edge.label}</div>
        </>
      )}
    </>
  );
}

interface WorkflowInspectorPanelProps {
  def: WorkflowDefinition;
  resolved: ResolvedCanvas;
  selection: CanvasSelection;
  agents: AgentCatalogEntry[];
  onSelect: (selection: CanvasSelection) => void;
}

export function WorkflowInspectorPanel({
  def,
  resolved,
  selection,
  agents,
  onSelect,
}: WorkflowInspectorPanelProps) {
  const selectedNode =
    selection.type === "node"
      ? resolved.nodes.find((node) => node.id === selection.id)
      : undefined;
  const selectedEdge =
    selection.type === "edge"
      ? resolved.edges.find((edge) => edge.id === selection.id)
      : undefined;
  const deps =
    selectedNode !== undefined
      ? selectedNode.dependsOn.length > 0
        ? selectedNode.dependsOn.map((id) => ({ id }))
        : (() => {
            if (selectedNode.groupId === undefined) return [];
            const group = resolved.groups.find((entry) => entry.id === selectedNode.groupId);
            if (group === undefined || group.nodeIds[0] !== selectedNode.id) return [];
            return group.externalDeps.map((id) => ({ id }));
          })()
      : [];
  return (
    <aside className="wf-inspector" aria-label="Workflow inspector">
      <div className="wf-inspector-caption">Workflow inspector</div>
      {selectedEdge !== undefined ? (
        <EdgeDetail edge={selectedEdge} />
      ) : selectedNode !== undefined ? (
        <NodeDetail node={selectedNode} deps={deps} agents={agents} onSelect={onSelect} />
      ) : (
        <WorkflowDetail def={def} resolved={resolved} />
      )}
    </aside>
  );
}
