import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemStoreProvider } from "../store/WorkItemStoreContext";
import { useWorkItems } from "../hooks/useWorkItems";

describe("WorkItemStore DIP via Context", () => {
  it("injects custom store via Provider (DIP)", () => {
    const custom = new WorkItemStore(undefined, ["custom-factory"]);
    custom.create({ title: "from custom", description: "hi", factoryName: "custom-factory", createdBy: "tester", source: "direct" });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(WorkItemStoreProvider, { store: custom, children });
    const { result } = renderHook(() => useWorkItems({ factoryName: "custom-factory" }), { wrapper });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].title).toBe("from custom");
    expect(result.current.store).toBe(custom);
  });

  it("fallback uses default store when no Provider", () => {
    const { result } = renderHook(() => useWorkItems({}));
    // default store exists, returns items array (maybe empty)
    expect(Array.isArray(result.current.items)).toBe(true);
    expect(result.current.store).toBeDefined();
  });
});
