import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";
import type { WorkItem } from "../domain/workItem.types";
import {
  median,
  isHumanPushEvent,
  hasHumanPushBeforeMerge,
  costPerPrEntries,
  cycleTimeMsForMerged,
  deriveTotalRuns,
  derivePrOpened,
  derivePrMerged,
  deriveAutonomy,
  deriveDashboardMetrics,
  deriveDashboardMetricsFromItems,
} from "../domain/dashboard.derive";
import type { FactoryBundle } from "../store/factoryRegistry";
import { FactoryRegistry } from "../store/factoryRegistry";
import { SAMPLE_FACTORY_FULL, SAMPLE_AGENT_FOREMAN, SAMPLE_AGENT_REVIEWER, SAMPLE_RUNNER_LINUX, SAMPLE_AUTOMATION_LABELED, SAMPLE_SCORER_TESTS, SAMPLE_RUNNER_MAC } from "../fixtures/samples";


function makeBundle(): FactoryBundle {
  const reg = new FactoryRegistry();
  const res = reg.parseBundle({
    factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
    agents: [
      { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
      { raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" },
    ],
    runners: [
      { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
      { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
    ],
    automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
    scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
  });
  return res.getOrThrow();
}

function wi(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    factoryName: "payments-factory",
    title: "Test WI",
    source: "github_issue",
    createdBy: "ben",
    createdAt: "2026-08-01T10:00:00.000Z",
    stage: "Triage",
    history: [
      { id: `evt_${overrides.id}_0`, workItemId: overrides.id, from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z", reason: "intake" },
    ],
    linkedPRs: [],
    ...overrides,
  } as WorkItem;
}

describe("dashboard.derive — pure metrics (WarpFactories.md §10 tabla 796)", () => {
  let store: WorkItemStore;
  let bundle: FactoryBundle;
  beforeEach(() => {
    WorkItemStore._resetIdSeq();
    WorkItemMachine._resetCounter();
    store = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
    bundle = makeBundle();
  });

  describe("median", () => {
    it("empty -> null", () => {
      expect(median([])).toBeNull();
    });
    it("odd length", () => {
      expect(median([3, 1, 2])).toBe(2);
    });
    it("even length", () => {
      expect(median([10, 2, 6, 4])).toBe(5);
    });
    it("single value", () => {
      expect(median([42])).toBe(42);
    });
    it("sorted already", () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });
    it("with duplicates", () => {
      expect(median([5, 5, 5])).toBe(5);
    });
  });

  describe("isHumanPushEvent", () => {
    it("human + push reason -> true", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Building", to: "Reviewing", actor: "human", at: new Date().toISOString(), reason: "human push" } as any)).toBe(true);
    });
    it("human + code push reason", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Building", to: "Reviewing", actor: "human", at: new Date().toISOString(), reason: "push" } as any)).toBe(true);
    });
    it("human + metadata push true", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Building", to: "Building", actor: "human", at: new Date().toISOString(), metadata: { push: true } } as any)).toBe(true);
    });
    it("human + humanPush meta", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Building", to: "Building", actor: "human", at: new Date().toISOString(), metadata: { humanPush: true } } as any)).toBe(true);
    });
    it("human but comment -> false", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Reviewing", to: "Reviewing", actor: "human", at: new Date().toISOString(), reason: "comment" } as any)).toBe(false);
    });
    it("foreman push -> false", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Building", to: "Reviewing", actor: "foreman", at: new Date().toISOString(), reason: "push" } as any)).toBe(false);
    });
    it("review actor -> false", () => {
      expect(isHumanPushEvent({ id: "1", workItemId: "w1", from: "Building", to: "Reviewing", actor: "review", at: new Date().toISOString(), reason: "push" } as any)).toBe(false);
    });
  });

  describe("hasHumanPushBeforeMerge", () => {
    it("no human events -> false", () => {
      const item = wi({ id: "w1", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/1"] });
      expect(hasHumanPushBeforeMerge(item)).toBe(false);
    });
    it("human push -> true", () => {
      const item = wi({
        id: "w2",
        stage: "Complete",
        linkedPRs: ["https://github.com/acme/repo/pull/2"],
        history: [
          { id: "evt1", workItemId: "w2", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
          { id: "evt2", workItemId: "w2", from: "Building", to: "Building", actor: "human", at: "2026-08-01T12:00:00.000Z", reason: "push" },
        ] as any,
      });
      expect(hasHumanPushBeforeMerge(item)).toBe(true);
    });
    it("human comment not push -> false", () => {
      const item = wi({
        id: "w3",
        stage: "Complete",
        linkedPRs: ["https://github.com/acme/repo/pull/3"],
        history: [
          { id: "evt1", workItemId: "w3", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
          { id: "evt2", workItemId: "w3", from: "Reviewing", to: "Reviewing", actor: "human", at: "2026-08-01T12:00:00.000Z", reason: "comment" },
        ] as any,
      });
      expect(hasHumanPushBeforeMerge(item)).toBe(false);
    });
  });

  describe("deriveTotalRuns", () => {
    it("empty store", () => {
      const r = deriveTotalRuns([]);
      expect(r.total).toBe(0);
      expect(r.breakdown.byStage).toEqual({});
      expect(r.breakdown.bySource).toEqual({});
      expect(r.breakdown.byStatus.active).toBe(0);
      expect(r.breakdown.byStatus.terminal).toBe(0);
    });
    it("counts by stage", () => {
      const items = [wi({ id: "w1", stage: "Triage" }), wi({ id: "w2", stage: "Building" }), wi({ id: "w3", stage: "Complete" })];
      const r = deriveTotalRuns(items);
      expect(r.total).toBe(3);
      expect(r.breakdown.byStage.Triage).toBe(1);
      expect(r.breakdown.byStage.Building).toBe(1);
      expect(r.breakdown.byStage.Complete).toBe(1);
    });
    it("counts by source", () => {
      const items = [wi({ id: "w1", source: "github_issue" }), wi({ id: "w2", source: "slack_mention" }), wi({ id: "w3", source: "github_issue" })];
      const r = deriveTotalRuns(items);
      expect(r.breakdown.bySource.github_issue).toBe(2);
      expect(r.breakdown.bySource.slack_mention).toBe(1);
    });
    it("active vs terminal", () => {
      const items = [wi({ id: "w1", stage: "Triage" }), wi({ id: "w2", stage: "Complete" }), wi({ id: "w3", stage: "Cancelled" })];
      const r = deriveTotalRuns(items);
      expect(r.breakdown.byStatus.active).toBe(1);
      expect(r.breakdown.byStatus.terminal).toBe(2);
    });
    it("byAgentType", () => {
      const items = [wi({ id: "w1", assigneeAgent: "triage" }), wi({ id: "w2", assigneeAgent: "implement" }), wi({ id: "w3", assigneeAgent: "triage" })];
      const r = deriveTotalRuns(items);
      expect(r.breakdown.byAgentType.triage).toBe(2);
      expect(r.breakdown.byAgentType.implement).toBe(1);
    });
  });

  describe("derivePrOpened vs derivePrMerged (opened vs merged)", () => {
    it("empty -> 0", () => {
      expect(derivePrOpened([])).toBe(0);
      expect(derivePrMerged([])).toBe(0);
    });
    it("counts distinct PRs opened", () => {
      const items = [
        wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1", "https://github.com/acme/repo/pull/2"] }),
        wi({ id: "w2", linkedPRs: ["https://github.com/acme/repo/pull/2", "https://github.com/acme/repo/pull/3"] }),
      ];
      expect(derivePrOpened(items)).toBe(3);
    });
    it("merged only Complete with PRs", () => {
      const items = [
        wi({ id: "w1", stage: "Building", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
        wi({ id: "w2", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/2"] }),
        wi({ id: "w3", stage: "Reviewing", linkedPRs: ["https://github.com/acme/repo/pull/3"] }),
      ];
      expect(derivePrMerged(items)).toBe(1);
    });
    it("merged distinct even if duplicate PR across items", () => {
      const items = [
        wi({ id: "w1", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
        wi({ id: "w2", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
      ];
      expect(derivePrMerged(items)).toBe(1);
    });
    it("opened counts even non-merged; merged subset", () => {
      const items = [
        wi({ id: "w1", stage: "Building", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
        wi({ id: "w2", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/2"] }),
      ];
      expect(derivePrOpened(items)).toBe(2);
      expect(derivePrMerged(items)).toBe(1);
      expect(derivePrMerged(items)).toBeLessThanOrEqual(derivePrOpened(items));
    });
    it("Complete without linkedPRs -> not counted as merged", () => {
      const items = [wi({ id: "w1", stage: "Complete", linkedPRs: [] })];
      expect(derivePrMerged(items)).toBe(0);
    });
  });

  describe("deriveAutonomy with/without human push", () => {
    it("no merged -> null", () => {
      expect(deriveAutonomy([])).toBeNull();
      expect(deriveAutonomy([wi({ id: "w1", stage: "Building", linkedPRs: ["https://github.com/acme/repo/pull/1"] })])).toBeNull();
    });
    it("all autonomous -> 100%", () => {
      const items = [
        wi({ id: "w1", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
        wi({ id: "w2", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/2"] }),
      ];
      expect(deriveAutonomy(items)).toBe(100);
    });
    it("one with human push -> 50%", () => {
      const items = [
        wi({ id: "w1", stage: "Complete", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
        wi({
          id: "w2",
          stage: "Complete",
          linkedPRs: ["https://github.com/acme/repo/pull/2"],
          history: [
            { id: "evt1", workItemId: "w2", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
            { id: "evt2", workItemId: "w2", from: "Building", to: "Building", actor: "human", at: "2026-08-01T11:00:00.000Z", reason: "push" },
          ] as any,
        }),
      ];
      expect(deriveAutonomy(items)).toBe(50);
    });
    it("human comment not push -> still autonomous", () => {
      const items = [
        wi({
          id: "w1",
          stage: "Complete",
          linkedPRs: ["https://github.com/acme/repo/pull/1"],
          history: [
            { id: "evt1", workItemId: "w1", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
            { id: "evt2", workItemId: "w1", from: "Reviewing", to: "Reviewing", actor: "human", at: "2026-08-01T11:00:00.000Z", reason: "comment" },
          ] as any,
        }),
      ];
      expect(deriveAutonomy(items)).toBe(100);
    });
    it("human push via metadata", () => {
      const items = [
        wi({
          id: "w1",
          stage: "Complete",
          linkedPRs: ["https://github.com/acme/repo/pull/1"],
          history: [
            { id: "evt1", workItemId: "w1", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
            { id: "evt2", workItemId: "w1", from: "Building", to: "Building", actor: "human", at: "2026-08-01T11:00:00.000Z", metadata: { humanPush: true } },
          ] as any,
        }),
      ];
      expect(deriveAutonomy(items)).toBe(0);
    });
    it("0% when all have push", () => {
      const items = [
        wi({
          id: "w1",
          stage: "Complete",
          linkedPRs: ["https://github.com/acme/repo/pull/1"],
          history: [{ id: "e1", workItemId: "w1", from: "Building", to: "Building", actor: "human", at: "2026-08-01T11:00:00.000Z", reason: "push" } as any],
        }),
        wi({
          id: "w2",
          stage: "Complete",
          linkedPRs: ["https://github.com/acme/repo/pull/2"],
          history: [{ id: "e2", workItemId: "w2", from: "Building", to: "Building", actor: "human", at: "2026-08-01T11:00:00.000Z", reason: "push" } as any],
        }),
      ];
      expect(deriveAutonomy(items)).toBe(0);
    });
  });

  describe("costPerPrEntries split", () => {
    it("single PR single cost", () => {
      const items = [wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1"], cost: 100 })];
      const entries = costPerPrEntries(items);
      expect(entries).toHaveLength(1);
      expect(entries[0].cost).toBe(100);
    });
    it("1 run -> 2 PRs split equitably", () => {
      const items = [wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1", "https://github.com/acme/repo/pull/2"], cost: 100 })];
      const entries = costPerPrEntries(items);
      expect(entries).toHaveLength(2);
      expect(entries[0].cost).toBe(50);
      expect(entries[1].cost).toBe(50);
    });
    it("1 run -> 3 PRs split", () => {
      const items = [wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1", "https://github.com/acme/repo/pull/2", "https://github.com/acme/repo/pull/3"], cost: 90 })];
      const entries = costPerPrEntries(items);
      expect(entries.every((e) => e.cost === 30)).toBe(true);
    });
    it("missing cost -> 0 per PR", () => {
      const items = [wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1"] })];
      const entries = costPerPrEntries(items);
      expect(entries[0].cost).toBe(0);
    });
    it("no PRs -> no entries", () => {
      const items = [wi({ id: "w1", linkedPRs: [], cost: 100 })];
      expect(costPerPrEntries(items)).toHaveLength(0);
    });
    it("cost median after split", () => {
      const items = [
        wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1", "https://github.com/acme/repo/pull/2"], cost: 100 }), // 50,50
        wi({ id: "w2", linkedPRs: ["https://github.com/acme/repo/pull/3"], cost: 200 }), // 200
      ];
      // per pr costs = [50,50,200] median 50
      const entries = costPerPrEntries(items);
      expect(median(entries.map((e) => e.cost))).toBe(50);
    });
    it("most expensive ordering", () => {
      const items = [
        wi({ id: "w1", title: "Cheap", linkedPRs: ["https://github.com/acme/repo/pull/1"], cost: 10 }),
        wi({ id: "w2", title: "Expensive", linkedPRs: ["https://github.com/acme/repo/pull/2"], cost: 500 }),
        wi({ id: "w3", title: "Mid", linkedPRs: ["https://github.com/acme/repo/pull/3"], cost: 100 }),
      ];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.mostExpensivePrs[0].prUrl).toBe("https://github.com/acme/repo/pull/2");
      expect(metrics.mostExpensivePrs[0].cost).toBe(500);
      expect(metrics.mostExpensivePrs[1].cost).toBe(100);
    });
  });

  describe("cycle time mediana", () => {
    it("no merged -> null", () => {
      const items = [wi({ id: "w1", stage: "Building", linkedPRs: ["https://github.com/acme/repo/pull/1"], createdAt: "2026-08-01T10:00:00.000Z" })];
      expect(cycleTimeMsForMerged(items[0])).toBeNull();
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.prCycleTimeMedianMs).toBeNull();
    });
    it("single merged computes diff", () => {
      const item = wi({
        id: "w1",
        stage: "Complete",
        linkedPRs: ["https://github.com/acme/repo/pull/1"],
        createdAt: "2026-08-01T10:00:00.000Z",
        history: [
          { id: "evt0", workItemId: "w1", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
          { id: "evt1", workItemId: "w1", from: "Reviewing", to: "Complete", actor: "foreman", at: "2026-08-01T12:00:00.000Z" },
        ] as any,
      });
      expect(cycleTimeMsForMerged(item)).toBe(2 * 60 * 60 * 1000);
    });
    it("median of 3 merged", () => {
      const base = "2026-08-01T10:00:00.000Z";
      function mk(id: string, hours: number): WorkItem {
        const end = new Date(new Date(base).getTime() + hours * 60 * 60 * 1000).toISOString();
        return wi({
          id,
          stage: "Complete",
          linkedPRs: [`https://github.com/acme/repo/pull/${id}`],
          createdAt: base,
          history: [
            { id: `evt_${id}_0`, workItemId: id, from: "Triage", to: "Triage", actor: "foreman", at: base },
            { id: `evt_${id}_1`, workItemId: id, from: "Reviewing", to: "Complete", actor: "foreman", at: end },
          ] as any,
        });
      }
      const items = [mk("w1", 2), mk("w2", 4), mk("w3", 10)];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      // cycle times [2h,4h,10h] median 4h
      expect(metrics.prCycleTimeMedianMs).toBe(4 * 60 * 60 * 1000);
    });
    it("median even -> avg", () => {
      const base = "2026-08-01T10:00:00.000Z";
      function mk2(id: string, hours: number): WorkItem {
        const end = new Date(new Date(base).getTime() + hours * 60 * 60 * 1000).toISOString();
        return wi({
          id,
          stage: "Complete",
          linkedPRs: [`https://github.com/acme/repo/pull/${id}`],
          createdAt: base,
          history: [
            { id: `evt_${id}_0`, workItemId: id, from: "Triage", to: "Triage", actor: "foreman", at: base },
            { id: `evt_${id}_1`, workItemId: id, from: "Reviewing", to: "Complete", actor: "foreman", at: end },
          ] as any,
        });
      }
      const items = [mk2("w1", 2), mk2("w2", 4)];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.prCycleTimeMedianMs).toBe(3 * 60 * 60 * 1000);
    });
    it("Complete without PR -> not in cycle calc", () => {
      const item = wi({
        id: "w1",
        stage: "Complete",
        linkedPRs: [],
        createdAt: "2026-08-01T10:00:00.000Z",
        history: [
          { id: "evt0", workItemId: "w1", from: "Triage", to: "Triage", actor: "foreman", at: "2026-08-01T10:00:00.000Z" },
          { id: "evt1", workItemId: "w1", from: "Reviewing", to: "Complete", actor: "foreman", at: "2026-08-01T12:00:00.000Z" },
        ] as any,
      });
      expect(cycleTimeMsForMerged(item)).toBeNull();
    });
  });

  describe("empty store integration", () => {
    it("empty metrics all zero/null", () => {
      const metrics = deriveDashboardMetrics(store, bundle);
      expect(metrics.totalRuns.total).toBe(0);
      expect(metrics.prsOpened).toBe(0);
      expect(metrics.prsMerged).toBe(0);
      expect(metrics.autonomyPct).toBeNull();
      expect(metrics.prCycleTimeMedianMs).toBeNull();
      expect(metrics.costPerPrMedian).toBeNull();
      expect(metrics.mostExpensivePrs).toEqual([]);
      expect(metrics.selfImprovementPrs).toEqual([]);
      expect(metrics.costPerPrList).toEqual([]);
    });
    it("empty bundle -> scorerCards empty", () => {
      const metrics = deriveDashboardMetricsFromItems([], null);
      expect(metrics.scorerCards).toEqual([]);
    });
    it("bundle scorerCards mapped", () => {
      const metrics = deriveDashboardMetricsFromItems([], bundle);
      expect(metrics.scorerCards.length).toBe(1);
      expect(metrics.scorerCards[0].name).toBe("tests-run");
      expect(metrics.scorerCards[0].agents).toEqual(["reviewer"]);
    });
  });

  describe("self-improvement PRs 3 newest", () => {
    it("picks 3 newest regardless of filter", () => {
      const items = [
        wi({ id: "w1", title: "Old", linkedPRs: ["https://github.com/acme/repo/pull/1"], createdAt: "2026-08-01T10:00:00.000Z" }),
        wi({ id: "w2", title: "Mid", linkedPRs: ["https://github.com/acme/repo/pull/2"], createdAt: "2026-08-02T10:00:00.000Z" }),
        wi({ id: "w3", title: "New", linkedPRs: ["https://github.com/acme/repo/pull/3"], createdAt: "2026-08-03T10:00:00.000Z" }),
        wi({ id: "w4", title: "Newest", linkedPRs: ["https://github.com/acme/repo/pull/4"], createdAt: "2026-08-04T10:00:00.000Z" }),
      ];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.selfImprovementPrs).toHaveLength(3);
      expect(metrics.selfImprovementPrs[0].prUrl).toBe("https://github.com/acme/repo/pull/4");
      expect(metrics.selfImprovementPrs[1].prUrl).toBe("https://github.com/acme/repo/pull/3");
      expect(metrics.selfImprovementPrs[2].prUrl).toBe("https://github.com/acme/repo/pull/2");
    });
    it("less than 3 -> returns available", () => {
      const items = [wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1"], createdAt: "2026-08-01T10:00:00.000Z" })];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.selfImprovementPrs).toHaveLength(1);
    });
    it("no PRs -> empty", () => {
      const items = [wi({ id: "w1", linkedPRs: [], createdAt: "2026-08-01T10:00:00.000Z" })];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.selfImprovementPrs).toEqual([]);
    });
    it("multi-PR workItem expands but cap 3", () => {
      const items = [
        wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1", "https://github.com/acme/repo/pull/2", "https://github.com/acme/repo/pull/3", "https://github.com/acme/repo/pull/4"], createdAt: "2026-08-04T10:00:00.000Z" }),
      ];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.selfImprovementPrs).toHaveLength(3);
    });
  });

  describe("deriveDashboardMetrics via store injection (DIP)", () => {
    it("inject store and bundle gives correct totalRuns", () => {
      store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", linkedPRs: ["https://github.com/acme/repo/pull/1"] });
      store.create({ factoryName: "payments-factory", title: "b", source: "slack_mention", createdBy: "alice", linkedPRs: ["https://github.com/acme/repo/pull/2"] });
      const metrics = deriveDashboardMetrics(store, bundle);
      expect(metrics.totalRuns.total).toBe(2);
      expect(metrics.prsOpened).toBe(2);
      expect(metrics.totalRuns.breakdown.bySource.github_issue).toBe(1);
      expect(metrics.totalRuns.breakdown.bySource.slack_mention).toBe(1);
    });
    it("OCP: adding metric field does not break existing", () => {
      const metrics = deriveDashboardMetrics(store, bundle);
      // existing fields still present even if new added later
      expect(metrics).toHaveProperty("totalRuns");
      expect(metrics).toHaveProperty("prsOpened");
      expect(metrics).toHaveProperty("prsMerged");
      expect(metrics).toHaveProperty("autonomyPct");
      expect(metrics).toHaveProperty("prCycleTimeMedianMs");
      expect(metrics).toHaveProperty("costPerPrMedian");
      expect(metrics).toHaveProperty("mostExpensivePrs");
      expect(metrics).toHaveProperty("scorerCards");
      expect(metrics).toHaveProperty("selfImprovementPrs");
    });
    it("handles 100 workItems smoke", () => {
      for (let i = 0; i < 100; i++) {
        store.create({ factoryName: "payments-factory", title: `item ${i}`, source: "github_issue", createdBy: "ben", linkedPRs: i % 2 === 0 ? [`https://github.com/acme/repo/pull/${i}`] : [] });
      }
      const metrics = deriveDashboardMetrics(store, bundle);
      expect(metrics.totalRuns.total).toBe(100);
      expect(metrics.prsOpened).toBe(50);
    });
    it("autonomy with mixed store items via transitions", () => {
      const r1 = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", linkedPRs: ["https://github.com/acme/repo/pull/1"], foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).getOrThrow();
      store.transition(r1.id, "Reviewing", "implement");
      store.transition(r1.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
      // second with human push injected manually via history tweak before Complete
      const r2 = store.create({ factoryName: "payments-factory", title: "b", source: "github_issue", createdBy: "ben", linkedPRs: ["https://github.com/acme/repo/pull/2"], foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).getOrThrow();
      // inject human push event by directly mutating stored item (simulate push)
      const stored = store.getById(r2.id)!;
      // we cheat: create new WorkItem with history containing human push then Complete
      const mutated: WorkItem = {
        ...stored,
        stage: "Complete",
        linkedPRs: ["https://github.com/acme/repo/pull/2"],
        history: [
          ...stored.history,
          { id: "evt_push", workItemId: stored.id, from: "Building", to: "Building", actor: "human", at: new Date().toISOString(), reason: "push", metadata: { push: true } },
          { id: "evt_done", workItemId: stored.id, from: "Reviewing", to: "Complete", actor: "foreman", at: new Date().toISOString(), reason: "handoff" },
        ],
      } as any;
      // bypass store API to set mutated: use private map hack
      (store as any).items.set(r2.id, mutated);
      const metrics = deriveDashboardMetrics(store, bundle);
      expect(metrics.prsMerged).toBe(2);
      expect(metrics.autonomyPct).toBe(50);
    });
  });

  describe("costPerPR median edge cases", () => {
    it("all zero costs median 0", () => {
      const items = [
        wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1"] }),
        wi({ id: "w2", linkedPRs: ["https://github.com/acme/repo/pull/2"] }),
      ];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.costPerPrMedian).toBe(0);
    });
    it("single PR cost median same", () => {
      const items = [wi({ id: "w1", linkedPRs: ["https://github.com/acme/repo/pull/1"], cost: 123.45 })];
      const metrics = deriveDashboardMetricsFromItems(items, bundle);
      expect(metrics.costPerPrMedian).toBe(123.45);
    });
    it("empty -> null", () => {
      const metrics = deriveDashboardMetricsFromItems([], bundle);
      expect(metrics.costPerPrMedian).toBeNull();
    });
  });

  describe("total runs breakdown source/model etc extensibility", () => {
    it("unknown assignee -> unknown bucket", () => {
      const items = [wi({ id: "w1", assigneeAgent: undefined })];
      const r = deriveTotalRuns(items);
      expect(r.breakdown.byAgentType.unknown).toBe(1);
    });
  });
});
