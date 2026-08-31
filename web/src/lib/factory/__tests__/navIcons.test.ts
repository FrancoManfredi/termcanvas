import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../../../nav";

describe("NAV_ITEMS replica (13-exact guard)", () => {
  it("has exactly 13 items (4 team + 9 factory)", () => {
    expect(NAV_ITEMS).toHaveLength(13);
  });

  it("team scope has 4 items in order", () => {
    const teamIds = NAV_ITEMS.filter((i) => i.scope === "team").map((i) => i.id);
    expect(teamIds).toEqual(["Team Runs", "MCPs and apps", "Secrets", "Integrations"]);
  });

  it("factory scope has 9 items in order", () => {
    const factoryIds = NAV_ITEMS.filter((i) => i.scope === "factory").map((i) => i.id);
    expect(factoryIds).toEqual(["Dashboard", "Activity", "Agents", "Automations", "Runs", "Scorers", "Self-improvement", "Factory definition", "Settings"]);
  });

  it("every id has label and scope", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label).toBeTruthy();
      expect(["team", "factory"]).toContain(item.scope);
    }
  });

  it("no duplicate ids", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
