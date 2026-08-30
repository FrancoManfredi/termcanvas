// useQuickstart — DIP: bridges pure wizard state to injected workspace and work-item stores.
// Source: WarpFactories.md §14 · US-142, US-143, US-144
// ADR-003: finish() async workspace.create() → navigate

import { useCallback, useReducer } from "react";
import { createForemanDecision } from "../domain/workItem.rules";
import { ParseResult } from "../domain/result";
import {
  QUICKSTART_STEPS,
  initialQuickstartState,
  isStepComplete,
  quickstartReducer,
  toCreateFactoryInput,
  toFirstWorkItemInput,
  validateStep,
} from "../domain/quickstart.wizard";
import type { QuickstartAction, QuickstartState } from "../domain/quickstart.wizard";
import type { FactoryRecord } from "../domain/factory.record";
import type { WorkItem } from "../domain/workItem.types";
import { useFactoryWorkspaceStore } from "./useFactories";
import { useWorkItemStore } from "../store/workItemStore.context";

export interface QuickstartApi {
  readonly state: QuickstartState;
  dispatch(action: QuickstartAction): void;
  readonly stepResult: ParseResult<QuickstartState>;
  finish(): Promise<ParseResult<{ factory: FactoryRecord; workItem: WorkItem }>>;
  finishSync(): ParseResult<{ factory: FactoryRecord; workItem: WorkItem }>;
}

export function useQuickstart(): QuickstartApi {
  const [state, dispatch] = useReducer(quickstartReducer, undefined, initialQuickstartState);
  const workspace = useFactoryWorkspaceStore();
  const workItemStore = useWorkItemStore();
  const stepResult = validateStep(state, workspace.list() as unknown as readonly FactoryRecord[]);

  const finishSync = useCallback((): ParseResult<{ factory: FactoryRecord; workItem: WorkItem }> => {
    if (state.useMcpOnboarding) {
      return ParseResult.singleFail("useMcpOnboarding", "La ruta MCP se inicia desde el dashboard, sin credenciales en esta app", "mcp_external_onboarding");
    }
    for (let index = 0; index < QUICKSTART_STEPS.length; index += 1) {
      const result = validateStep({ ...state, stepIndex: index }, workspace.list() as unknown as readonly FactoryRecord[]);
      if (!result.ok) return ParseResult.fail(result.issues);
    }
    const maybe = workspace.create(toCreateFactoryInput(state)) as unknown as ParseResult<FactoryRecord> | Promise<ParseResult<FactoryRecord>>;
    if (maybe instanceof Promise) {
      return ParseResult.singleFail("factory", "Usá finish() async para remote", "async_required");
    }
    const factoryResult = maybe;
    if (!factoryResult.ok || factoryResult.value === undefined) return ParseResult.fail(factoryResult.issues);
    const factory = factoryResult.value;
    // select is sync in store
    (workspace as unknown as { select: (uid: string) => void }).select(factory.uid);
    workItemStore.addKnownFactories([factory.name]);
    const firstWorkItem = toFirstWorkItemInput(state);
    const workItemResult = workItemStore.create({
      ...firstWorkItem,
      foremanDecision: createForemanDecision({ title: firstWorkItem.title }),
    });
    if (!workItemResult.ok || workItemResult.value === undefined) return ParseResult.fail(workItemResult.issues);
    return ParseResult.ok({ factory, workItem: workItemResult.value });
  }, [state, workspace, workItemStore]);

  const finish = useCallback(async (): Promise<ParseResult<{ factory: FactoryRecord; workItem: WorkItem }>> => {
    if (state.useMcpOnboarding) {
      return ParseResult.singleFail("useMcpOnboarding", "La ruta MCP se inicia desde el dashboard, sin credenciales en esta app", "mcp_external_onboarding");
    }
    for (let index = 0; index < QUICKSTART_STEPS.length; index += 1) {
      const result = validateStep({ ...state, stepIndex: index }, workspace.list() as unknown as readonly FactoryRecord[]);
      if (!result.ok) return ParseResult.fail(result.issues);
    }
    const factoryResult = (await Promise.resolve(
      workspace.create(toCreateFactoryInput(state)) as unknown as Promise<ParseResult<FactoryRecord>> | ParseResult<FactoryRecord>,
    )) as ParseResult<FactoryRecord>;
    if (!factoryResult.ok || factoryResult.value === undefined) return ParseResult.fail(factoryResult.issues);
    const factory = factoryResult.value;
    // select may be MaybePromise; await if needed
    await Promise.resolve((workspace as unknown as { select: (uid: string) => unknown }).select(factory.uid));
    workItemStore.addKnownFactories([factory.name]);
    const firstWorkItem = toFirstWorkItemInput(state);
    const workItemResult = workItemStore.create({
      ...firstWorkItem,
      foremanDecision: createForemanDecision({ title: firstWorkItem.title }),
    });
    if (!workItemResult.ok || workItemResult.value === undefined) return ParseResult.fail(workItemResult.issues);
    return ParseResult.ok({ factory, workItem: workItemResult.value });
  }, [state, workspace, workItemStore]);

  const dispatchAction = useCallback((action: QuickstartAction) => {
    if (action.type === "next" && !isStepComplete(state)) return;
    dispatch(action);
  }, [state]);

  return { state, dispatch: dispatchAction, stepResult, finish, finishSync };
}
