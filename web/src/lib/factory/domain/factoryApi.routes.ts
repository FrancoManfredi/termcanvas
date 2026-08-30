// Factory API routes — SRP: adapts workspace/work-item stores to the transport contract.
// Source: WarpFactories.md §19 · US-149→155

import { FactoryApiRouter } from "./factoryApi.router";
import { isTicketRef } from "./factoryApi.types";
import type {
  AgentRunResponse,
  FactoryApiResponse,
  FactoryRunRequest,
  FactoryRunResponse,
  FollowupRequest,
  StandaloneRunRequest,
} from "./factoryApi.types";
import type { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import type { WorkItemStore } from "../store/workItem.store";

interface MutableRun extends FactoryRunResponse {
  readonly standalone?: boolean;
}

let runSequence = 0;
function nextRunId(): string {
  runSequence += 1;
  return `run_api_${Date.now()}_${runSequence}`;
}

function derivedTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "Factory run";
  return firstLine.slice(0, 120) || "Factory run";
}

function invalid(message: string, code: string, status = 400): FactoryApiResponse<never> {
  return { status, body: { error: message, code } };
}

function agentView(run: MutableRun): AgentRunResponse {
  return {
    id: run.id,
    title: run.title,
    prompt: run.prompt,
    status: run.status,
    stage: run.stage,
    factory_uid: run.factory_uid,
    work_item_id: run.work_item_id,
    followups: run.followups,
  };
}

export interface FactoryApiRuntime {
  readonly router: FactoryApiRouter;
  readonly workspace: FactoryWorkspaceStore;
  readonly workItems: WorkItemStore;
  readonly runs: ReadonlyMap<string, AgentRunResponse>;
}

export function createFactoryApiRuntime(
  workspace: FactoryWorkspaceStore,
  workItems: WorkItemStore,
): FactoryApiRuntime {
  const runs = new Map<string, MutableRun>();

  const router = new FactoryApiRouter({
    listFactories(search) {
      const query = search?.trim().toLowerCase();
      if (!query) return workspace.toSummaries();
      return workspace.toSummaries().filter((factory) =>
        factory.name.toLowerCase().includes(query) || factory.alias.toLowerCase().includes(query),
      );
    },
    getFactory(uid) {
      return workspace.toSummaries().find((factory) => factory.uid === uid);
    },
    createFactoryRun(uid, input: FactoryRunRequest) {
      const factory = workspace.getByUid(uid);
      if (!factory) return invalid(`Factory '${uid}' not found`, "factory_not_found", 404);
      const prompt = input.prompt?.trim() ?? "";
      if (!prompt) return invalid("prompt is required", "missing_prompt");
      if (input.ticket_ref !== undefined && !isTicketRef(input.ticket_ref)) {
        return invalid("ticket_ref must match /^[a-z]+:[A-Za-z0-9-_]+$/", "invalid_ticket_ref");
      }
      const created = workItems.create({
        factoryName: factory.name,
        title: input.title?.trim() || derivedTitle(prompt),
        description: prompt,
        source: "factory",
        sourceRef: input.ticket_ref,
        createdBy: "factory-api",
      });
      if (!created.ok || !created.value) {
        return invalid(created.issues[0]?.message ?? "Unable to create work item", created.issues[0]?.code ?? "work_item_error");
      }
      const item = created.value;
      const run: MutableRun = {
        id: nextRunId(),
        factory_uid: factory.uid,
        factory_name: factory.name,
        title: item.title,
        prompt,
        status: "queued",
        stage: item.stage,
        work_item_id: item.id,
        ticket_ref: input.ticket_ref,
        ticket_url: input.ticket_url,
        followups: [],
      };
      runs.set(run.id, run);
      return { status: 201, body: run };
    },
    getAgentRun(id) {
      const run = runs.get(id);
      return run ? agentView(run) : undefined;
    },
    followupAgentRun(id, input: FollowupRequest) {
      const run = runs.get(id);
      if (!run) return { error: `Run '${id}' not found`, code: "run_not_found" };
      const prompt = input.prompt?.trim() ?? "";
      if (!prompt) return { error: "prompt is required", code: "missing_prompt" };
      if (run.status === "cancelled" || run.status === "completed") {
        return { error: `Run '${id}' is terminal`, code: "run_terminal" };
      }
      const next: MutableRun = { ...run, status: "running", followups: [...run.followups, prompt] };
      runs.set(id, next);
      return agentView(next);
    },
    cancelAgentRun(id) {
      const run = runs.get(id);
      if (!run) return { error: `Run '${id}' not found`, code: "run_not_found" };
      if (run.status === "completed" || run.status === "cancelled") return agentView(run);
      const itemResult = workItems.cancel(run.work_item_id, "system", "cancelled via Agent API");
      const next: MutableRun = { ...run, status: "cancelled", stage: itemResult.ok && itemResult.value ? itemResult.value.stage : "Cancelled" };
      runs.set(id, next);
      return agentView(next);
    },
    createStandaloneRun(input: StandaloneRunRequest) {
      const prompt = input.prompt?.trim() ?? "";
      const run: MutableRun = {
        id: nextRunId(),
        factory_name: "",
        title: input.title?.trim() || derivedTitle(prompt),
        prompt,
        status: "queued",
        stage: "Triage",
        work_item_id: "",
        followups: [],
        standalone: true,
      };
      runs.set(run.id, run);
      return agentView(run);
    },
  });

  return { router, workspace, workItems, runs };
}

export function resetFactoryApiRunIds(): void {
  runSequence = 0;
}
