import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { bucketCost, COST_BUCKETS, DASHBOARD_TOOLTIPS, deriveDashboardWithDisclaimers } from "../domain/dashboard.derive";
import { MetricCard } from "../../../components/dashboard/MetricCard";

describe("dashboard.disclaimers — P1-04 (T12 US-096→101)", () => {
  it("DASHBOARD_TOOLTIPS tiene al menos 8 métricas", () => {
    const entries = Object.entries(DASHBOARD_TOOLTIPS);
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });

  it("las 8 métricas tienen tooltip no vacío", () => {
    const entries = Object.entries(DASHBOARD_TOOLTIPS);
    for (const [key, tooltip] of entries) {
      expect(tooltip.trim().length, key).toBeGreaterThan(0);
    }
  });

  it.each([
    ["prsMerged", "merged>opened"],
    ["autonomyPct", "Autonomy push"],
    ["costPerPr", "S/M/L/XL"],
    ["selfImprovementPrs", "sin date filter"],
  ] as const)("tooltip %s contiene disclaimer %s", (key, snippet) => {
    const tooltip = (DASHBOARD_TOOLTIPS as Record<string, string>)[key];
    expect(tooltip, `missing tooltip for ${key}`).toBeDefined();
    expect(tooltip.toLowerCase()).toMatch(snippet.toLowerCase());
  });

  it("MetricCard con tooltip renderiza ⓘ con title y aria-label", () => {
    render(React.createElement(MetricCard, { title: "Test Metric", value: 42, tooltip: "Disclaimer de prueba" }));
    expect(screen.getByText("Test Metric")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    const info = screen.getByLabelText("Disclaimer de prueba");
    expect(info).toBeInTheDocument();
    expect(info.getAttribute("title")).toBe("Disclaimer de prueba");
    expect(screen.getByText("ⓘ")).toBeInTheDocument();
  });

  it("MetricCard sin tooltip no renderiza ⓘ", () => {
    render(React.createElement(MetricCard, { title: "No tooltip", value: 0 }));
    expect(screen.queryByText("ⓘ")).toBeNull();
  });

  it("8 métricas con tooltip disclaimers (parametrizado) — todas non-empty", () => {
    const requiredKeys = ["totalRuns", "prsOpened", "prsMerged", "autonomyPct", "prCycleTime", "costPerPr", "scorerCards", "selfImprovementPrs"] as const;
    for (const key of requiredKeys) {
      const tooltip = (DASHBOARD_TOOLTIPS as Record<string, string>)[key];
      expect(tooltip, `tooltip missing for ${key}`).toBeDefined();
      expect(tooltip.trim().length, key).toBeGreaterThan(2);
    }
  });

  // O15 — Cost buckets exactos + bucketCost invariante
  it("COST_BUCKETS S 100 M 500 L 1000 XL Infinity exactos", () => {
    expect(COST_BUCKETS.S).toBe(100);
    expect(COST_BUCKETS.M).toBe(500);
    expect(COST_BUCKETS.L).toBe(1000);
    expect(COST_BUCKETS.XL).toBe(Infinity);
  });

  it.each([
    [0, "S"],
    [100, "S"],
    [101, "M"],
    [500, "M"],
    [501, "L"],
    [1000, "L"],
    [1001, "XL"],
    [9999, "XL"],
  ] as const)("bucketCost %i → %s", (cost, bucket) => {
    expect(bucketCost(cost)).toBe(bucket);
  });

  it("deriveDashboardWithDisclaimers retorna 8 métricas con tooltip no vacío", () => {
    const metrics = deriveDashboardWithDisclaimers({ workItems: [], bundle: null });
    expect(metrics).toHaveLength(8);
    const ids = metrics.map((m) => m.id);
    expect(ids).toEqual(["total_runs", "prs_opened", "prs_merged", "autonomy", "cycle_time", "cost_per_pr", "scorer_cards", "self_improvement"]);
    for (const m of metrics) {
      expect(m.tooltip.trim().length, m.id).toBeGreaterThan(0);
      expect(m.trace.length, m.id).toBeGreaterThan(0);
    }
  });

  it("deriveDashboardWithDisclaimers disclaimers contienen merged>opened, Autonomy push, S/M/L/XL, sin date filter", () => {
    const metrics = deriveDashboardWithDisclaimers({ workItems: [], bundle: null });
    const byId = Object.fromEntries(metrics.map((m) => [m.id, m.tooltip])) as Record<string, string>;
    expect(byId.prs_merged.toLowerCase()).toContain("merged>opened");
    expect(byId.autonomy.toLowerCase()).toContain("autonomy push");
    expect(byId.cost_per_pr).toContain("S/M/L/XL");
    expect(byId.self_improvement.toLowerCase()).toContain("sin date filter");
  });

  it("Cost S/M/L/XL disclaimer menciona 100/500/1000 créditos", () => {
    const tip = DASHBOARD_TOOLTIPS.costPerPr;
    expect(tip).toContain("100");
    expect(tip).toContain("500");
    expect(tip).toContain("1000");
  });

  it("Most expensive PRs tooltip menciona requiere code host + S/M/L/XL 100/500/1000", () => {
    const tip = DASHBOARD_TOOLTIPS.mostExpensivePrs;
    expect(tip.toLowerCase()).toContain("code host");
    expect(tip).toContain("100");
  });
});
