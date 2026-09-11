/**
 * Flow types — visualización flujo horizontal Ola 2 P0-3.
 * Intake → Foreman → Building → Review → Complete con rama Triage.
 */

import type { WorkItemStatus, WorkItemTimelineEntry } from "./workItem";

export type FlowStage = "Intake" | "Foreman" | "Building" | "Review" | "Complete";

export const FLOW_LINEAR_STAGES: FlowStage[] = ["Intake", "Foreman", "Building", "Review", "Complete"];

export const TRIAGE_STAGE = "Triage" as const;

export type FlowBranch = typeof TRIAGE_STAGE;

export interface FlowBarProps {
  currentStatus: WorkItemStatus;
  timeline?: WorkItemTimelineEntry[];
  workItemId?: string;
  className?: string;
}

export interface FlowStepDef {
  id: FlowStage | FlowBranch;
  label: string;
  description?: string;
}

/**
 * Definición de steps lineales + rama Triage.
 * Triage es rama divergente bajo Foreman, no parte del camino lineal.
 */
export const FLOW_STEPS: FlowStepDef[] = [
  { id: "Intake", label: "Intake", description: "Solicitud recibida" },
  { id: "Foreman", label: "Foreman", description: "Decisión LLM" },
  { id: "Building", label: "Building", description: "Runner linux-build" },
  { id: "Review", label: "Review", description: "Revisión" },
  { id: "Complete", label: "Complete", description: "Hecho (.done)" },
];

export const TRIAGE_STEP: FlowStepDef = {
  id: "Triage",
  label: "Triage",
  description: "Requiere input / contexto",
};

/**
 * Retorna índice del stage en el flujo lineal, -1 si Triage/Cancelled.
 */
export function getLinearIndex(status: WorkItemStatus): number {
  return FLOW_LINEAR_STAGES.indexOf(status as FlowStage);
}

export function isTriageStatus(status: WorkItemStatus): boolean {
  return status === "Triage";
}

export function isCancelledStatus(status: WorkItemStatus): boolean {
  return status === "Cancelled";
}

export function isTerminalStatus(status: WorkItemStatus): boolean {
  return status === "Complete" || status === "Cancelled";
}

/**
 * Determina si un step está activo (currentStatus === step.id).
 */
export function isStepActive(currentStatus: WorkItemStatus, stepId: FlowStage | FlowBranch): boolean {
  return currentStatus === stepId;
}

export function isImplementing(status: WorkItemStatus): boolean {
  return status === "Building";
}

export function isReviewStatus(status: WorkItemStatus): boolean {
  return status === "Review";
}

export function isReviewing(status: WorkItemStatus): boolean {
  return status === "Review";
}

export function isPassStatus(status: string): boolean {
  return status === "pass";
}

export function isFailStatus(status: string): boolean {
  return status === "fail";
}

export function isPassFailStatus(status: string): boolean {
  return status === "pass" || status === "fail";
}

/**
 * Determina si un step está completado (currentStatus está después en el flujo lineal).
 * Para Triage, ningún step lineal se considera completado más allá de Foreman.
 */
export function isStepCompleted(currentStatus: WorkItemStatus, stepId: FlowStage): boolean {
  if (isTriageStatus(currentStatus)) {
    // Si está en Triage, solo Intake está completado, Foreman es origen de la rama
    const triageCompleted: Record<string, boolean> = {
      Intake: true,
      Foreman: false,
      Building: false,
      Review: false,
      Complete: false,
    };
    return !!triageCompleted[stepId];
  }
  const currIdx = getLinearIndex(currentStatus);
  const stepIdx = FLOW_LINEAR_STAGES.indexOf(stepId);
  if (currIdx === -1) return false;
  return stepIdx < currIdx;
}
