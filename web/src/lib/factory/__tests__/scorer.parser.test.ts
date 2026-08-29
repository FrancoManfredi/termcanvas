import { describe, it, expect } from "vitest";
import { parseScorerMd } from "../parsers/scorer.parser";

const valid = `---
name: tests-run
description: Checks tests
agents:
  - reviewer
labels:
  - value: tests_run
    description: has tests
    score: 1
  - value: tests_skipped
    score: 0
passingScore: 1
samplingRate: 25
model: claude-4-5-haiku
---
Evaluate whether agent ran tests.
`;

describe("ScorerParser — parseScorerMd", () => {
  it("1. parses valid", () => {
    const r = parseScorerMd(valid, "scorers/tests-run/scorer.md");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("tests-run");
    expect(r.value?.slug).toBe("tests-run");
  });
  it("2. parses with selfImprovement true", () => {
    const raw = valid.replace("model: claude-4-5-haiku", "model: claude-4-5-haiku\nselfImprovement: true");
    expect(parseScorerMd(raw, "scorers/tests-run/scorer.md").value?.selfImprovement).toBe(true);
  });
  it("3. parses default samplingRate 25", () => {
    const raw = valid.replace("samplingRate: 25\n", "");
    const r = parseScorerMd(raw, "scorers/tests-run/scorer.md");
    expect(r.ok).toBe(true);
    expect(r.value?.samplingRate).toBe(25);
  });
  it("4. parses custom samplingRate 0", () => {
    const raw = valid.replace("samplingRate: 25", "samplingRate: 0");
    expect(parseScorerMd(raw, "scorers/tests-run/scorer.md").ok).toBe(true);
  });
  it("5. parses samplingRate 100", () => {
    const raw = valid.replace("samplingRate: 25", "samplingRate: 100");
    expect(parseScorerMd(raw, "scorers/tests-run/scorer.md").ok).toBe(true);
  });
  it("6. fails on empty", () => {
    expect(parseScorerMd("", "scorers/x/scorer.md").ok).toBe(false);
  });
  it("7. fails on missing name", () => {
    const raw = valid.replace("name: tests-run\n", "");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("8. fails on missing agents", () => {
    const raw = valid.replace(/agents:\n  - reviewer\n/, "");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("9. fails on missing model", () => {
    const raw = valid.replace("model: claude-4-5-haiku\n", "");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("10. fails on missing rubric body", () => {
    const raw = `---
name: tests-run
agents:
  - reviewer
labels:
  - value: a
    score: 1
  - value: b
    score: 0
passingScore: 1
model: m
---
`;
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("11. fails when no label >= passingScore", () => {
    const raw = valid.replace("score: 1", "score: 0");
    // both 0 now, passing 1 -> no passing label
    const r = parseScorerMd(raw, "scorers/x/scorer.md");
    expect(r.ok).toBe(false);
  });
  it("12. fails when no label < passingScore", () => {
    const raw = valid.replace("score: 0", "score: 1");
    const r = parseScorerMd(raw, "scorers/x/scorer.md");
    expect(r.ok).toBe(false);
  });
  it("13. fails on duplicate label values", () => {
    const raw = valid.replace("value: tests_skipped", "value: tests_run");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("14. fails on score out of range >1", () => {
    const raw = valid.replace("score: 1", "score: 2");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("15. fails on samplingRate out of range", () => {
    const raw = valid.replace("samplingRate: 25", "samplingRate: 150");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("16. fails on passingScore out of range", () => {
    const raw = valid.replace("passingScore: 1", "passingScore: 5");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("17. extracts slug fallback", () => {
    const r = parseScorerMd(valid, "some.md");
    expect(r.ok).toBe(true);
    expect(r.value?.slug).toBe("some");
  });
  it("18. parses output classification explicit", () => {
    const raw = valid.replace("passingScore: 1", "output: classification\npassingScore: 1");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(true);
  });
  it("19. fails on invalid output value", () => {
    const raw = valid.replace("passingScore: 1", "output: invalid\npassingScore: 1");
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("20. parses rubric preserves content", () => {
    const r = parseScorerMd(valid, "scorers/x/scorer.md");
    expect(r.ok).toBe(true);
    expect(r.value?.rubric).toContain("Evaluate");
  });
});
