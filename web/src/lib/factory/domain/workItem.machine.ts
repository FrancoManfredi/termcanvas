// Pure state machine — SRP: only transitions, no I/O, no mutation
// DIP: returns ParseResult, callers depend on abstraction
// Inmutable: transition retorna nuevo WorkItem
import { ParseResult } from "./result";
import { isTerminal } from "./workItem.types";
import type { Actor, TransitionContext, WorkItem, WorkItemStage } from "./workItem.types";


const TRANSITIONS: Record<WorkItemStage, WorkItemStage[]> = {
  Triage: ["Planning", "Building", "Cancelled"],
  Planning: ["Building", "Planning", "Cancelled"], // Planning->Planning = rework
  Building: ["Reviewing", "Cancelled"],
  Reviewing: ["Building", "Reviewing", "Complete", "Cancelled"], // Reviewing->Reviewing = ask_human
  Complete: [],
  Cancelled: [],
};

export function canTransition(from: WorkItemStage, to: WorkItemStage): boolean {
  if (isTerminal(from)) {
    return false;
  }
  const allowed = (TRANSITIONS[from] ?? []).includes(to);
  return allowed;
}

export function nextStageForIntake(decision?: { shouldSkipTriage: boolean; shouldSkipPlanning: boolean }): WorkItemStage {
  if (!decision) return "Triage";
  if (decision.shouldSkipTriage && decision.shouldSkipPlanning) return "Building";
  if (decision.shouldSkipTriage) return decision.shouldSkipPlanning ? "Building" : "Planning";
  return "Triage";
}

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  const id = `evt_${Date.now()}_${eventCounter}`;
  return id;
}

export class WorkItemMachine {
  // SRP: valida y ejecuta transición, sin tocar store
  transition(item: WorkItem, to: WorkItemStage, actor: Actor, ctx: TransitionContext = {}): ParseResult<WorkItem> {
    // 1. Terminal guard
    if (isTerminal(item.stage)) {
      return ParseResult.singleFail(item.id, `cannot transition from terminal stage '${item.stage}'`, "terminal_state");
    }

    // 2. Allowed edge
    if (!canTransition(item.stage, to)) {
      return ParseResult.singleFail(
        item.id,
        `invalid transition '${item.stage}' → '${to}'`,
        "invalid_transition"
      );
    }

    // 3. Human gate: Planning → Building requires approved
    if (item.stage === "Planning" && to === "Building") {
      const approval = ctx.humanApproval ?? item.humanApproval;
      if (approval !== "approved") {
        return ParseResult.singleFail(item.id, "Planning → Building requires humanApproval='approved' (human gate pending)", "human_gate_pending");
      }
    }

    // 4. Reviewing → Complete requires accept + handoffConfirmed (advisory, Warp §3)
    if (item.stage === "Reviewing" && to === "Complete") {
      const verdict = ctx.reviewVerdict ?? item.reviewVerdict;
      const handoff = ctx.handoffConfirmed ?? item.handoffConfirmed;
      if (verdict !== "accept") {
        return ParseResult.singleFail(item.id, "Reviewing → Complete requires reviewVerdict='accept'", "review_verdict_required");
      }
      if (!handoff) {
        return ParseResult.singleFail(item.id, "Reviewing → Complete requires handoffConfirmed=true (advisory, handoff ≠ merge)", "handoff_not_confirmed");
      }
    }

    // 5. Reviewing → Building requires revise (or ask_human handled as Reviewing→Reviewing)
    if (item.stage === "Reviewing" && to === "Building") {
      const verdict = ctx.reviewVerdict ?? item.reviewVerdict;
      if (verdict === "ask_human") {
        return ParseResult.singleFail(item.id, "Reviewing → Building with verdict 'ask_human' should stay in Reviewing (use Reviewing → Reviewing)", "ask_human_stays");
      }
      if (verdict !== "revise") {
        return ParseResult.singleFail(item.id, "Reviewing → Building requires reviewVerdict='revise'", "review_verdict_required");
      }
    }

    // 6. Actor guard: only foreman/human can do handoff (Complete), only foreman can skip via intake handled above
    if (to === "Complete" && actor !== "foreman" && actor !== "human") {
      return ParseResult.singleFail(item.id, "only foreman/human can transition to Complete (handoff)", "actor_not_allowed");
    }

    // Build new history event (inmutable)
    const event = {
      id: nextEventId(),
      workItemId: item.id,
      from: item.stage,
      to,
      actor,
      at: new Date().toISOString(),
      reason: ctx.reason,
      metadata: {
        ...(ctx.humanApproval ? { humanApproval: ctx.humanApproval } : {}),
        ...(ctx.reviewVerdict ? { reviewVerdict: ctx.reviewVerdict } : {}),
        ...(ctx.handoffConfirmed !== undefined ? { handoffConfirmed: ctx.handoffConfirmed } : {}),
      },
    };

    // Merge context into item (inmutable)
    const next: WorkItem = {
      ...item,
      stage: to,
      history: [...item.history, event],
      ...(ctx.humanApproval !== undefined ? { humanApproval: ctx.humanApproval } : {}),
      ...(ctx.reviewVerdict !== undefined ? { reviewVerdict: ctx.reviewVerdict } : {}),
      ...(ctx.handoffConfirmed !== undefined ? { handoffConfirmed: ctx.handoffConfirmed } : {}),
      // assignee rotates by stage (convention, not enforced strictly)
      assigneeAgent: nextAssignee(to, item.assigneeAgent),
    };

    return ParseResult.ok(next);
  }

  // For testing reset
  static _resetCounter() {
    eventCounter = 0;
  }
}

function nextAssignee(stage: WorkItemStage, prev?: string): string | undefined {
  switch (stage) {
    case "Triage":
      return "triage";
    case "Planning":
      return "spec";
    case "Building":
      return "implement";
    case "Reviewing":
      return "review";
    case "Complete":
    case "Cancelled":
      return prev;
    default:
      return prev;
  }
}

// Functional wrapper — ISP: callers can use function without class
const defaultMachine = new WorkItemMachine();
export function transitionWorkItem(item: WorkItem, to: WorkItemStage, actor: Actor, ctx?: TransitionContext): ParseResult<WorkItem> {
  return defaultMachine.transition(item, to, actor, ctx);
}

// For tests that need fresh counter
export function resetWorkItemMachineCounter() {
  WorkItemMachine._resetCounter();
}
