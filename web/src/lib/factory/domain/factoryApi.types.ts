// Factory API DTOs — SRP: transport contracts only, no routing or storage behavior.
// Source: WarpFactories.md §19 · US-149→155

import type { FactorySummary } from "./factory.record";
import type { WorkItem, WorkItemStage } from "./workItem.types";

export const TICKET_REF_PATTERN = /^[a-z]+:[A-Za-z0-9-_]+$/;

export type FactoryApiMethod = "GET" | "POST";

export interface FactoryRunRequest {
  readonly prompt: string;
  readonly title?: string;
  readonly ticket_ref?: string;
  readonly ticket_url?: string;
}

export interface StandaloneRunRequest {
  readonly prompt: string;
  readonly title?: string;
}

export interface FollowupRequest {
  readonly prompt: string;
}

export interface FactoryRunResponse {
  readonly id: string;
  readonly factory_uid?: string;
  readonly factory_name?: string;
  readonly title: string;
  readonly prompt: string;
  readonly status: "queued" | "running" | "completed" | "cancelled";
  readonly stage: WorkItemStage;
  readonly work_item_id: string;
  readonly ticket_ref?: string;
  readonly ticket_url?: string;
  readonly followups: readonly string[];
}

export interface AgentRunResponse {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly status: FactoryRunResponse["status"];
  readonly stage: WorkItemStage;
  readonly factory_uid?: string;
  readonly work_item_id?: string;
  readonly followups: readonly string[];
}

export interface FactoryApiError {
  readonly error: string;
  readonly code: string;
  readonly details?: readonly string[];
}

export interface FactoryApiResponse<T> {
  readonly status: number;
  readonly body: T | FactoryApiError;
}

export interface FactoryListResponse {
  readonly factories: readonly FactorySummary[];
}

export interface FactoryGetResponse {
  readonly factory: FactorySummary;
}

export interface FactoryApiDependencies {
  readonly listFactories: (search?: string) => readonly FactorySummary[];
  readonly getFactory: (uid: string) => FactorySummary | undefined;
  readonly createFactoryRun: (uid: string, input: FactoryRunRequest) => FactoryApiResponse<FactoryRunResponse>;
  readonly getAgentRun: (id: string) => AgentRunResponse | undefined;
  readonly followupAgentRun: (id: string, input: FollowupRequest) => AgentRunResponse | FactoryApiError;
  readonly cancelAgentRun: (id: string) => AgentRunResponse | FactoryApiError;
  readonly createStandaloneRun: (input: StandaloneRunRequest) => AgentRunResponse;
}

export function isTicketRef(value: string): boolean {
  return TICKET_REF_PATTERN.test(value);
}

export function asWorkItem(run: FactoryRunResponse): Pick<WorkItem, "id" | "stage"> {
  return { id: run.work_item_id, stage: run.stage };
}
