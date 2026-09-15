/**
 * Workflows section — read-only canvas view of the existing workflows.
 *
 * Header (workflow selector + counts), canvas and inspector. No palette, no
 * run state, no log strip, no editing: the section shows what the YAML
 * declares. Data comes from the mock seam (`workflowSource`); the engine
 * wiring is a later phase (see `workflowSource.ts`).
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { resolveCanvas } from "../derive";
import { getWorkflowDef, listAgents, listWorkflowDefs } from "../workflowSource";
import { DEFAULT_WORKFLOW } from "../mockWorkflows";
import type { CanvasSelection } from "../types";
import { WorkflowCanvasStage } from "./WorkflowCanvas";
import { WorkflowInspectorPanel } from "./WorkflowInspectorPanel";
import { IconChevronDown } from "../../components/warpIcons";
import "../workflowCanvas.css";

function useElementWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

interface WorkflowHeaderBarProps {
  workflowName: string;
  nodeCount: number;
  edgeCount: number;
  narrow: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onSelectWorkflow: (name: string) => void;
}

function WorkflowHeaderBar({
  workflowName,
  nodeCount,
  edgeCount,
  narrow,
  inspectorOpen,
  onToggleInspector,
  onSelectWorkflow,
}: WorkflowHeaderBarProps) {
  const workflows = listWorkflowDefs();
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = workflows.find((definition) => definition.name === workflowName);

  return (
    <header className="wf-header">
      <div className="wf-header-left">
        <div className="wf-picker">
          <button
            type="button"
            className="wf-picker-btn"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Elegir workflow"
            onClick={() => setPickerOpen((value) => !value)}
          >
            <span className="wf-picker-name">{workflowName}</span>
            <span
              style={{
                display: "flex",
                transform: pickerOpen ? "rotate(180deg)" : "none",
                transition: "transform 150ms",
              }}
            >
              <IconChevronDown size={10} />
            </span>
          </button>
          {pickerOpen && (
            <>
              <button
                type="button"
                className="wf-menu-backdrop"
                aria-label="Cerrar selector"
                onClick={() => setPickerOpen(false)}
              />
              <div className="wf-picker-menu" role="listbox" aria-label="Workflows disponibles">
                {workflows.map((definition) => (
                  <button
                    key={definition.name}
                    type="button"
                    role="option"
                    aria-selected={definition.name === workflowName}
                    className={`wf-picker-item${
                      definition.name === workflowName ? " wf-picker-item-active" : ""
                    }`}
                    onClick={() => {
                      onSelectWorkflow(definition.name);
                      setPickerOpen(false);
                    }}
                  >
                    <span className="wf-picker-item-name">{definition.name}</span>
                    <span className="wf-picker-item-desc">{definition.description}</span>
                    <span className="wf-picker-item-scope">{definition.scope}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {!narrow && current !== undefined && (
          <span className="wf-header-desc" title={current.filePath}>
            {current.description}
          </span>
        )}
      </div>

      <div className="wf-header-right">
        <span className="wf-chip">
          {nodeCount} node{nodeCount === 1 ? "" : "s"}
        </span>
        <span className="wf-chip">
          {edgeCount} edge{edgeCount === 1 ? "" : "s"}
        </span>
        {narrow && (
          <button
            type="button"
            className={`wf-action-btn${inspectorOpen ? " wf-action-btn-active" : ""}`}
            title={inspectorOpen ? "Ocultar inspector" : "Mostrar inspector"}
            aria-pressed={inspectorOpen}
            onClick={onToggleInspector}
          >
            Inspector
          </button>
        )}
      </div>
    </header>
  );
}

export function WorkflowsPanel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const [workflowName, setWorkflowName] = useState<string>(DEFAULT_WORKFLOW);
  const [selection, setSelection] = useState<CanvasSelection>({ type: "workflow" });
  const [inspectorOverride, setInspectorOverride] = useState<boolean | null>(null);

  const agents = useMemo(() => listAgents(), []);
  const def = getWorkflowDef(workflowName) ?? listWorkflowDefs()[0] ?? null;
  const resolved = useMemo(() => (def === null ? null : resolveCanvas(def)), [def]);

  const narrow = width > 0 && width < 1040;
  const inspectorOpen = inspectorOverride ?? !narrow;

  useEffect(() => {
    if (narrow && (selection.type === "node" || selection.type === "edge")) {
      setInspectorOverride(true);
    }
  }, [narrow, selection]);

  if (def === null || resolved === null) {
    return (
      <div className="wf-root" ref={rootRef}>
        <div className="wf-empty" role="status">
          <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 12 }}>
            Sin workflows disponibles
          </span>
          <span style={{ fontSize: 11, color: "var(--wp-text-tertiary)" }}>
            Creá .agents/workflows/&lt;name&gt;/workflow.yaml o revisá el catálogo.
          </span>
        </div>
      </div>
    );
  }

  const selectWorkflow = (name: string): void => {
    setWorkflowName(name);
    setSelection({ type: "workflow" });
  };

  return (
    <div className="wf-root" ref={rootRef}>
      <WorkflowHeaderBar
        workflowName={workflowName}
        nodeCount={resolved.nodes.length}
        edgeCount={resolved.edges.length}
        narrow={narrow}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOverride(!inspectorOpen)}
        onSelectWorkflow={selectWorkflow}
      />
      <div className="wf-body">
        <WorkflowCanvasStage
          def={def}
          resolved={resolved}
          agents={agents}
          selection={selection}
          onSelect={setSelection}
        />
        {inspectorOpen && (
          <div className={narrow ? "wf-inspector-overlay" : "wf-inspector-static"}>
            <WorkflowInspectorPanel
              def={def}
              resolved={resolved}
              selection={selection}
              agents={agents}
              onSelect={setSelection}
            />
          </div>
        )}
      </div>
    </div>
  );
}
