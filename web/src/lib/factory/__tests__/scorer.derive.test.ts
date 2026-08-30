import { describe, it, expect } from "vitest";
import type { ScorerDefinition } from "../domain/types";
import {
  DEFAULT_SAMPLING_RATE,
  deriveScorer,
  getEffectiveSamplingRate,
  getSamplingStatus,
  getPassingLabels,
  getFailingLabels,
  isAutoScoringEnabled,
  isLabelPassing,
  isScorerInvariantValid,
  hasAgents,
  hasModel,
  hasRubric,
  getOutputValue,
  isSelfImprovementEnabled,
  classifyLabel,
} from "../domain/scorer.derive";
import { parseScorerMd } from "../parsers/scorer.parser";

function makeScorer(overrides: Partial<ScorerDefinition> = {}): ScorerDefinition {
  return {
    slug: "tests-run",
    name: "tests-run",
    description: "Checks whether implementation runs include test evidence.",
    agents: ["reviewer"],
    output: "classification",
    labels: [
      { value: "tests_run", description: "has tests", score: 1 },
      { value: "tests_skipped", score: 0 },
    ],
    passingScore: 1,
    samplingRate: 25,
    model: "claude-4-5-haiku",
    selfImprovement: false,
    rubric: "Evaluate whether the agent ran tests.",
    rawPath: "scorers/tests-run/scorer.md",
    ...overrides,
  };
}

describe("scorer.derive — pure invariants (WarpFactories §7 §11)", () => {
  it("1. default samplingRate is 25 when undefined", () => {
    const s = makeScorer({ samplingRate: undefined as unknown as number });
    expect(getEffectiveSamplingRate(s)).toBe(DEFAULT_SAMPLING_RATE);
    expect(getEffectiveSamplingRate(makeScorer({ samplingRate: 0 }))).toBe(0);
  });
  it("2. auto scoring enabled when rate != 0", () => {
    expect(isAutoScoringEnabled(makeScorer({ samplingRate: 25 }))).toBe(true);
    expect(isAutoScoringEnabled(makeScorer({ samplingRate: 0 }))).toBe(false);
    expect(isAutoScoringEnabled(makeScorer({ samplingRate: 100 }))).toBe(true);
  });
  it("3. samplingRate 0 describes stopped", () => {
    expect(getSamplingStatus(makeScorer({ samplingRate: 0 }))).toMatch(/Stopped/i);
  });
  it("4. samplingRate 25 default describes default 25%", () => {
    const s = makeScorer({ samplingRate: undefined as unknown as number });
    expect(getSamplingStatus(s)).toMatch(/Default/i);
    expect(getSamplingStatus(makeScorer({ samplingRate: 25 }))).toMatch(/25%/);
  });
  it("5. samplingRate 100 describes Full", () => {
    expect(getSamplingStatus(makeScorer({ samplingRate: 100 }))).toMatch(/Full/i);
  });
  it("6. custom samplingRate 50 describes sampling", () => {
    expect(getSamplingStatus(makeScorer({ samplingRate: 50 }))).toMatch(/50%/);
  });
  it("7. isLabelPassing uses >= threshold", () => {
    expect(isLabelPassing({ value: "a", score: 1 }, 1)).toBe(true);
    expect(isLabelPassing({ value: "a", score: 0.99 }, 1)).toBe(false);
    expect(isLabelPassing({ value: "a", score: 0.5 }, 0.5)).toBe(true);
  });
  it("8. getPassingLabels and getFailingLabels split correctly", () => {
    const s = makeScorer();
    expect(getPassingLabels(s).map((l) => l.value)).toEqual(["tests_run"]);
    expect(getFailingLabels(s).map((l) => l.value)).toEqual(["tests_skipped"]);
  });
  it("9. invariant valid when at least one passing and one failing", () => {
    expect(isScorerInvariantValid(makeScorer())).toBe(true);
  });
  it("10. invariant invalid when all labels pass", () => {
    const s = makeScorer({ labels: [{ value: "a", score: 1 }, { value: "b", score: 1 }] });
    expect(isScorerInvariantValid(s)).toBe(false);
  });
  it("11. invariant invalid when all labels fail", () => {
    const s = makeScorer({ labels: [{ value: "a", score: 0 }, { value: "b", score: 0 }], passingScore: 1 });
    expect(isScorerInvariantValid(s)).toBe(false);
  });
  it("12. invariant with multiple passing/failing still valid", () => {
    const s = makeScorer({
      labels: [
        { value: "high", score: 1 },
        { value: "mid", score: 0.7 },
        { value: "low", score: 0.2 },
        { value: "zero", score: 0 },
      ],
      passingScore: 0.7,
    });
    expect(getPassingLabels(s)).toHaveLength(2);
    expect(getFailingLabels(s)).toHaveLength(2);
    expect(isScorerInvariantValid(s)).toBe(true);
  });
  it("13. hasAgents false when empty, true when ≥1", () => {
    expect(hasAgents(makeScorer({ agents: [] }))).toBe(false);
    expect(hasAgents(makeScorer({ agents: ["reviewer"] }))).toBe(true);
    expect(hasAgents(makeScorer({ agents: ["a", "b"] }))).toBe(true);
  });
  it("14. hasModel false when empty/whitespace, true otherwise", () => {
    expect(hasModel(makeScorer({ model: "" }))).toBe(false);
    expect(hasModel(makeScorer({ model: "   " }))).toBe(false);
    expect(hasModel(makeScorer({ model: "claude-4-5-haiku" }))).toBe(true);
  });
  it("15. hasRubric false when empty/whitespace, true otherwise", () => {
    expect(hasRubric(makeScorer({ rubric: "" }))).toBe(false);
    expect(hasRubric(makeScorer({ rubric: "   " }))).toBe(false);
    expect(hasRubric(makeScorer({ rubric: "Evaluate ..." }))).toBe(true);
  });
  it("16. output defaults to classification", () => {
    expect(getOutputValue(makeScorer({ output: undefined }))).toBe("classification");
    expect(getOutputValue(makeScorer({ output: "classification" }))).toBe("classification");
  });
  it("17. selfImprovement false by default, true when set", () => {
    expect(isSelfImprovementEnabled(makeScorer({ selfImprovement: false }))).toBe(false);
    expect(isSelfImprovementEnabled(makeScorer({ selfImprovement: undefined }))).toBe(false);
    expect(isSelfImprovementEnabled(makeScorer({ selfImprovement: true }))).toBe(true);
  });
  it("18. deriveScorer aggregates correctly for default scorer", () => {
    const d = deriveScorer(makeScorer());
    expect(d.effectiveSamplingRate).toBe(25);
    expect(d.autoScoringEnabled).toBe(true);
    expect(d.invariantValid).toBe(true);
    expect(d.hasAgents).toBe(true);
    expect(d.hasModel).toBe(true);
    expect(d.hasRubric).toBe(true);
    expect(d.outputValue).toBe("classification");
    expect(d.selfImprovement).toBe(false);
  });
  it("19. deriveScorer reflects stopped sampling", () => {
    const d = deriveScorer(makeScorer({ samplingRate: 0 }));
    expect(d.autoScoringEnabled).toBe(false);
    expect(d.effectiveSamplingRate).toBe(0);
  });
  it("20. deriveScorer reflects 100% sampling", () => {
    const d = deriveScorer(makeScorer({ samplingRate: 100 }));
    expect(d.autoScoringEnabled).toBe(true);
    expect(d.effectiveSamplingRate).toBe(100);
  });
  it("21. classifyLabel returns pass/fail", () => {
    expect(classifyLabel({ value: "a", score: 1 }, 1)).toBe("pass");
    expect(classifyLabel({ value: "a", score: 0 }, 1)).toBe("fail");
  });
  it("22. passingScore edge 0: every label passes except negative impossible", () => {
    const s = makeScorer({ passingScore: 0, labels: [{ value: "a", score: 0 }, { value: "b", score: 1 }] });
    expect(getPassingLabels(s)).toHaveLength(2);
    // invariant fails because no failing
    expect(isScorerInvariantValid(s)).toBe(false);
  });
  it("23. passingScore edge 1: only score 1 passes", () => {
    const s = makeScorer({ passingScore: 1, labels: [{ value: "a", score: 1 }, { value: "b", score: 0.999 }, { value: "c", score: 0 }] });
    expect(getPassingLabels(s).map((l) => l.value)).toEqual(["a"]);
    expect(getFailingLabels(s)).toHaveLength(2);
  });
  it("24. uses real parser output for SAMPLE_SCORER (regression)", () => {
    const raw = `---
name: tests-run
description: Checks whether implementation runs include test evidence.
agents:
  - reviewer
labels:
  - value: tests_run
    description: The transcript contains a test command and its result.
    score: 1
  - value: tests_skipped
    score: 0
passingScore: 1
samplingRate: 25
model: claude-4-5-haiku
---

Evaluate whether the agent ran the relevant tests before finishing. Return
exactly one declared label.
`;
    const res = parseScorerMd(raw, "scorers/tests-run/scorer.md");
    expect(res.ok).toBe(true);
    const d = deriveScorer(res.value!);
    expect(d.invariantValid).toBe(true);
    expect(d.hasRubric).toBe(true);
    expect(d.hasModel).toBe(true);
    expect(d.hasAgents).toBe(true);
  });
  it("25. slug vs name: name is identity not dir ( §7)", () => {
    const raw = `---
name: my-identity
agents:
  - reviewer
labels:
  - value: ok
    score: 1
  - value: bad
    score: 0
passingScore: 1
model: m
---

Rubric body.
`;
    const res = parseScorerMd(raw, "scorers/some-slug/scorer.md");
    expect(res.ok).toBe(true);
    expect(res.value!.name).toBe("my-identity");
    expect(res.value!.slug).toBe("some-slug");
    expect(res.value!.name).not.toBe(res.value!.slug);
  });
  it("26. label value uniqueness invariant via parser", () => {
    const raw = `---
name: x
agents: [a]
labels:
  - value: dup
    score: 1
  - value: dup
    score: 0
passingScore: 1
model: m
---

body
`;
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("27. score must be 0..1", () => {
    const raw = `---
name: x
agents: [a]
labels:
  - value: a
    score: 2
  - value: b
    score: 0
passingScore: 1
model: m
---

body
`;
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("28. agents ≥1 enforced by parser", () => {
    const raw = `---
name: x
agents: []
labels:
  - value: a
    score: 1
  - value: b
    score: 0
passingScore: 1
model: m
---

body
`;
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("29. model required enforced by parser", () => {
    const raw = `---
name: x
agents: [a]
labels:
  - value: a
    score: 1
  - value: b
    score: 0
passingScore: 1
---

body
`;
    expect(parseScorerMd(raw, "scorers/x/scorer.md").ok).toBe(false);
  });
  it("30. rubric non-empty enforced by parser", () => {
    const raw = `---
name: x
agents: [a]
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
});
