import { describe, it, expect } from "vitest";
import { ParseResult, combineResults } from "../domain/result";

describe("ParseResult", () => {
  it("ok wraps value", () => {
    const r = ParseResult.ok(42);
    expect(r.ok).toBe(true);
    expect(r.getOrThrow()).toBe(42);
  });
  it("fail stores issues", () => {
    const r = ParseResult.singleFail("path", "oops");
    expect(r.ok).toBe(false);
    expect(() => r.getOrThrow()).toThrow();
  });
  it("map transforms ok", () => {
    const r = ParseResult.ok(2).map((v) => v * 3);
    expect(r.getOrThrow()).toBe(6);
  });
  it("map preserves fail", () => {
    const r = ParseResult.singleFail<number>("p", "e").map((v) => v * 2);
    expect(r.ok).toBe(false);
  });
  it("flatMap chains", () => {
    const r = ParseResult.ok(5).flatMap((v) => ParseResult.ok(v + 1));
    expect(r.getOrThrow()).toBe(6);
  });
  it("combineResults ok", () => {
    const r = combineResults([ParseResult.ok(1), ParseResult.ok(2)]);
    expect(r.ok).toBe(true);
    expect(r.getOrThrow()).toEqual([1, 2]);
  });
  it("combineResults fail collects issues", () => {
    const r = combineResults([ParseResult.ok(1), ParseResult.singleFail("a", "err")]);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
  });
});
