import { describe, expect, it } from "vitest";
import { ParseResult } from "../domain/result";
import { _resetUidSeq } from "../domain/factory.record";
import { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import { WorkItemStore } from "../store/workItem.store";
import { createMemoryPort } from "../store/storage.port";
import { VERBATIM_FIRST_WORK_ITEM, MCP_ONBOARDING_PROMPT } from "../domain/quickstart.data";
import {
  QUICKSTART_STEPS,
  initialQuickstartState,
  isLastStep,
  quickstartReducer,
  toCreateFactoryInput,
  toFirstWorkItemInput,
  validateStep,
} from "../domain/quickstart.wizard";

describe("quickstart wizard", () => {
  it("keeps the seven-step order and blocks progress until each step is complete", () => {
    expect(QUICKSTART_STEPS).toEqual(["source", "repos", "identity", "slack", "agents", "tracker", "review"]);
    const initial = initialQuickstartState();
    expect(quickstartReducer(initial, { type: "next" }).stepIndex).toBe(1);
    const withRepo = quickstartReducer(initial, { type: "toggleRepo", repo: { owner: "acme", name: "payments-service" } });
    expect(quickstartReducer(withRepo, { type: "next" }).stepIndex).toBe(1);
  });

  it("limits repositories to two and replaces the oldest on a third selection", () => {
    let state = initialQuickstartState();
    state = quickstartReducer(state, { type: "toggleRepo", repo: { owner: "acme", name: "one" } });
    state = quickstartReducer(state, { type: "toggleRepo", repo: { owner: "acme", name: "two" } });
    state = quickstartReducer(state, { type: "toggleRepo", repo: { owner: "acme", name: "three" } });
    expect(state.repos.map((repo) => repo.name)).toEqual(["two", "three"]);
  });

  it("keeps at least one agent and Implement enabled", () => {
    let state = initialQuickstartState();
    for (const agent of ["triage", "spec", "review"] as const) state = quickstartReducer(state, { type: "toggleAgent", agent });
    expect(Object.values(state.agents).filter(Boolean)).toEqual([true]);
    state = quickstartReducer(state, { type: "toggleAgent", agent: "implement" });
    expect(state.agents.implement).toBe(true);
  });

  it("derives alias until it is explicitly touched and preserves canonical prompt", () => {
    let state = quickstartReducer(initialQuickstartState(), { type: "setName", name: "payments" });
    expect(state.alias).toBe("payments");
    state = quickstartReducer(state, { type: "setAlias", alias: "foreman-payments" });
    state = quickstartReducer(state, { type: "setName", name: "checkout" });
    expect(state.alias).toBe("foreman-payments");
    expect(VERBATIM_FIRST_WORK_ITEM).toBe(toFirstWorkItemInput(state).title);
    expect(MCP_ONBOARDING_PROMPT).toContain("Factory MCP");
  });

  it("creates, selects and registers a factory before the first work item", () => {
    _resetUidSeq();
    const workspace = new FactoryWorkspaceStore(createMemoryPort(), [], () => "2026-01-01T00:00:00.000Z");
    const workItems = new WorkItemStore(undefined, ["legacy-factory"]);
    let state = initialQuickstartState();
    state = quickstartReducer(state, { type: "toggleRepo", repo: { owner: "acme", name: "payments" } });
    state = quickstartReducer(state, { type: "next" });
    state = quickstartReducer(state, { type: "setName", name: "payments-factory" });
    state = quickstartReducer(state, { type: "setAlias", alias: "payments-foreman" });
    expect(validateStep(state, workspace.list()).ok).toBe(true);
    const factoryResult = workspace.create(toCreateFactoryInput(state));
    expect(factoryResult.ok).toBe(true);
    const factory = factoryResult.value!;
    workspace.select(factory.uid);
    workItems.addKnownFactories([factory.name]);
    const itemResult = workItems.create(toFirstWorkItemInput(state));
    expect(itemResult.ok).toBe(true);
    expect(workspace.getSelected()?.uid).toBe(factory.uid);
    expect(workItems.getKnownFactories()).toContain("legacy-factory");
    expect(workItems.getKnownFactories()).toContain(factory.name);
    expect(workItems.getById(itemResult.value!.id)?.title).toBe(VERBATIM_FIRST_WORK_ITEM);
    expect(isLastStep({ ...state, stepIndex: 6 })).toBe(true);
    expect(ParseResult.ok(factory).ok).toBe(true);
  });
});
