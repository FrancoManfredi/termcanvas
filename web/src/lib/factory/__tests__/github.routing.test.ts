// github.routing.test.ts — SRP: verifica los checks puros del routing dual de GitHub.
// Source: WarpFactories.md §9 · US-074, US-075, US-076, US-077

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WARP_HANDLE,
  continuationKey,
  evaluateGitHubEvent,
  factoryLabel,
  findMention,
  hasFactoryLabel,
  routeGitHubEvent,
  stripCodeBlocks,
} from "../domain/github.routing";
import type { GitHubRoutingEvent, RoutingPolicy } from "../domain/github.routing";
import type { AutomationDefinition } from "../domain/types";
import { GITHUB_EVENTS, GITHUB_FILTER_APPEARS_ON, GITHUB_ROUTING_PRESETS } from "../domain/github.routing.derive";

function makeAutomationStub(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    name: "route",
    enabled: true,
    agent: "foreman",
    prompt: "stub",
    rawPath: "automations/stub/automation.md",
    triggers: [{ provider: "github", event: "issue_comment_created", filter: {} }],
    ...overrides,
  } satisfies AutomationDefinition;
}

const policy: RoutingPolicy = {
  foremanName: "payments",
  handle: DEFAULT_WARP_HANDLE,
  requireFactoryLabel: true,
};

function event(overrides: Partial<GitHubRoutingEvent> = {}): GitHubRoutingEvent {
  return {
    provider: "github",
    event: "issue_comment_created",
    repo: "acme/payments-service",
    number: 42,
    labels: ["factory:payments"],
    body: "Please review this @warp-factory",
    isEdit: false,
    authorIsBot: false,
    ...overrides,
  };
}

describe("GitHub dual-label routing — US-076", () => {
  it("routes only when label and mention are both present", () => {
    const decision = routeGitHubEvent(event(), policy);
    expect(decision.routable).toBe(true);
    expect(decision.expectedLabel).toBe("factory:payments");
    expect(decision.matchedHandle).toBe("@warp-factory");
    expect(decision.checks).toHaveLength(5);
    expect(decision.checks.every((check) => check.ok)).toBe(true);
  });

  it("mention without label does not route and leaves a trace", () => {
    const decision = routeGitHubEvent(event({ labels: [] }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((check) => check.id === "label_present")?.ok).toBe(false);
    expect(decision.checks.find((check) => check.id === "mention_present")?.ok).toBe(true);
    expect(decision.reason).toMatch(/Falta/);
  });

  it("label without mention does not route", () => {
    const decision = routeGitHubEvent(event({ body: "Please review this change" }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((check) => check.id === "label_present")?.ok).toBe(true);
    expect(decision.checks.find((check) => check.id === "mention_present")?.ok).toBe(false);
  });

  it("ignores mention inside a fenced code block", () => {
    const decision = routeGitHubEvent(event({ body: "```\n@warp-factory\n```" }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks.find((check) => check.id === "not_code_block")?.ok).toBe(false);
    expect(decision.checks.find((check) => check.id === "mention_present")?.ok).toBe(false);
  });

  it("ignores edits and bot authors while still evaluating all five checks", () => {
    const decision = routeGitHubEvent(event({ isEdit: true, authorIsBot: true }), policy);
    expect(decision.routable).toBe(false);
    expect(decision.checks).toHaveLength(5);
    expect(decision.checks.find((check) => check.id === "new_content")?.ok).toBe(false);
    expect(decision.checks.find((check) => check.id === "not_bot_author")?.ok).toBe(false);
  });

  it("supports custom handles and optional label filtering", () => {
    const customPolicy: RoutingPolicy = {
      foremanName: "payments",
      handle: "@org/team",
      requireFactoryLabel: false,
    };
    const decision = routeGitHubEvent(event({ labels: [], body: "Please ask @ORG/team" }), customPolicy);
    expect(decision.routable).toBe(true);
    expect(decision.matchedHandle).toBe("@ORG/team");
  });

  it("matches mention and assignment arrays", () => {
    expect(routeGitHubEvent(event({ body: "", mentioned: ["@warp-factory"] }), policy).routable).toBe(true);
    expect(routeGitHubEvent(event({ body: "", assigned: ["@warp-factory"] }), policy).routable).toBe(true);
  });
});

describe("GitHub routing helpers", () => {
  it("normalizes labels and handles case-insensitively", () => {
    expect(factoryLabel(" payments ")).toBe("factory:payments");
    expect(hasFactoryLabel(["Factory:Payments"], "payments")).toBe(true);
    expect(findMention("hello @Org/Team now", "@org/team")).toBe("@Org/Team");
    expect(findMention("hello @warp-factory-bot", "@warp-factory")).toBeUndefined();
  });

  it("strips fenced and inline code", () => {
    expect(stripCodeBlocks("before `@warp-factory` after")).toBe("before   after");
    expect(stripCodeBlocks("```@warp-factory```").trim()).toBe("");
    expect(stripCodeBlocks("~~~@warp-factory~~~").trim()).toBe("");
  });

  it("creates a stable continuation key", () => {
    expect(continuationKey(event())).toBe("acme/payments-service#42");
    expect(continuationKey(event({ number: undefined }))).toBe("acme/payments-service#unknown");
  });
});

describe("GitHub routing composition", () => {
  it("does not match automations when the dual gate fails", () => {
    const automation = makeAutomationStub();
    const result = evaluateGitHubEvent([automation], event({ labels: [] }), policy);
    expect(result.decision.routable).toBe(false);
    expect(result.matched).toEqual([]);
  });

  it("delegates a routable event to the unchanged generic engine", () => {
    const automation = makeAutomationStub({
      triggers: [{ provider: "github", event: "issue_comment_created", filter: { repos: ["acme/payments-service"] } }],
    });
    const result = evaluateGitHubEvent([automation], event(), policy);
    expect(result.decision.routable).toBe(true);
    expect(result.matched.map((item) => item.name)).toEqual(["route"]);
  });
});

describe("US-075 / simulator data", () => {
  it("contains 20 events, 12 filters and five presets", () => {
    expect(GITHUB_EVENTS).toHaveLength(20);
    expect(GITHUB_FILTER_APPEARS_ON).toHaveLength(12);
    expect(GITHUB_ROUTING_PRESETS).toHaveLength(5);
  });

  it("valid_routing preset routes with default policy", () => {
    const valid = GITHUB_ROUTING_PRESETS.find((preset) => preset.id === "valid_routing");
    expect(valid).toBeDefined();
    expect(valid?.label).toBe("Caso válido — Enruta");
    expect(valid?.trace).toBe("WarpFactories.md §9 · US-076 — dual requirement (caso válido)");
    const decision = routeGitHubEvent(valid!.event, valid!.policy);
    expect(decision.routable).toBe(true);
    expect(decision.checks.every((routingCheck) => routingCheck.ok)).toBe(true);
    expect(decision.checks).toHaveLength(5);
  });

  it("valid_routing preset is first and distinguishable", () => {
    expect(GITHUB_ROUTING_PRESETS[0]?.id).toBe("valid_routing");
  });
});
