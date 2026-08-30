import { describe, it, expect } from "vitest";
import { cn } from "../cn";
import { cn as cnFromUtils } from "../utils";

describe("cn (clsx + tailwind-merge)", () => {
  it("joins classes", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("ignores falsy", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("merges tailwind conflicts — last wins", () => {
    // tailwind-merge should dedupe e.g. p-2 p-4 => p-4
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
  it("handles conditional object via clsx", () => {
    expect(cn("a", { b: true, c: false })).toBe("a b");
  });
  it("utils re-export matches cn", () => {
    expect(cnFromUtils("a", "b")).toBe(cn("a", "b"));
  });
});
