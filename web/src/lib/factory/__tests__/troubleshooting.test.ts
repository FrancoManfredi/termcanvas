import { describe, it, expect } from "vitest";
import { SETUP_ROWS, WORK_NOT_STARTING_LEAD, WORK_SOURCES, TWO_RUNS_WARNING, RUNS_ROWS, TROUBLESHOOTING_META } from "../domain/troubleshooting.data";

describe("troubleshooting.data — WarpFactories.md §18 exact names (deleted UI)", () => {
  it("TROUBLESHOOTING_META has exact title Help / Troubleshooting and subtitle §18", () => {
    expect(TROUBLESHOOTING_META.title).toBe("Help / Troubleshooting");
    expect(TROUBLESHOOTING_META.subtitle).toMatch(/§18/);
  });

  it("SETUP_ROWS has 4 rows", () => {
    expect(SETUP_ROWS).toHaveLength(4);
  });

  it("WORK_SOURCES has 5 sources", () => {
    expect(WORK_SOURCES).toHaveLength(5);
  });

  it("TWO_RUNS_WARNING mentions two runs", () => {
    expect(TWO_RUNS_WARNING).toMatch(/dos automations/);
  });

  it("RUNS_ROWS has 3 rows", () => {
    expect(RUNS_ROWS).toHaveLength(3);
  });

  it("lead contains automation mismatch", () => {
    expect(WORK_NOT_STARTING_LEAD).toMatch(/automation mismatch/);
  });
});
