import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { DASHBOARD_TOOLTIPS } from "../domain/dashboard.derive";
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
});
