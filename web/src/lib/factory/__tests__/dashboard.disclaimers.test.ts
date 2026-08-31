import { describe, it, expect } from "vitest";
import { bucketCost, COST_BUCKETS, DASHBOARD_TOOLTIPS, deriveDashboardWithDisclaimers } from "../domain/dashboard.derive";

describe("dashboard.disclaimers — P1-04 (T12 US-096→101)", () => {
  it("DASHBOARD_TOOLTIPS tiene al menos 8 métricas", () => {
    const entries = Object.entries(DASHBOARD_TOOLTIPS);
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });

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
    for (const m of metrics) {
      expect(m.tooltip.trim().length, m.id).toBeGreaterThan(0);
    }
  });
});
