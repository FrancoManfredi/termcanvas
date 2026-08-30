import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardEmptyState } from "../../../components/dashboard/DashboardEmptyState";
import { deriveDashboardMetricsFromItems, isEmpty } from "../domain/dashboard.derive";

describe("Gherkin P0-9 Dashboard limpio sin hardcodeados", () => {
  it("isEmpty true cuando no hay datos", () => {
    const metrics = deriveDashboardMetricsFromItems([], null);
    expect(isEmpty(metrics)).toBe(true);
    expect(metrics.prsOpened).toBe(0);
    expect(metrics.totalRuns.total).toBe(0);
  });

  it("DashboardEmptyState renderiza mensaje honesto", () => {
    render(<DashboardEmptyState title="Sin datos todavía" message="Tus métricas van a aparecer acá" />);
    expect(screen.getByText("Sin datos todavía")).toBeDefined();
    expect(screen.getByText(/Tus métricas/)).toBeDefined();
  });

  it("no muestra números inventados — solo empties cuando isEmpty", () => {
    const metrics = deriveDashboardMetricsFromItems([], null);
    expect(metrics.costPerPrMedian).toBeNull();
    expect(metrics.prCycleTimeMedianMs).toBeNull();
    expect(metrics.scorerCards).toEqual([]);
    expect(metrics.mostExpensivePrs).toEqual([]);
    expect(isEmpty(metrics)).toBe(true);
  });

  it("isEmpty false cuando hay work items", () => {
    const wi = {
      id: "wi_1",
      factoryName: "test",
      title: "Test PR",
      source: "direct" as const,
      createdBy: "tester",
      createdAt: new Date().toISOString(),
      stage: "Complete" as const,
      history: [{ id: "evt_1", workItemId: "wi_1", from: "Complete" as const, to: "Complete" as const, actor: "foreman" as const, at: new Date().toISOString(), reason: "intake", metadata: {} }],
      linkedPRs: ["https://github.com/acme/repo/pull/1"],
      cost: 100,
    } as never;
    const metrics = deriveDashboardMetricsFromItems([wi], null);
    expect(isEmpty(metrics)).toBe(false);
    expect(metrics.prsOpened).toBe(1);
  });
});
