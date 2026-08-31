import { describe, it, expect, beforeEach } from "vitest";
import { FactoryWorkspaceStore } from "../store/factoryWorkspace.store";
import { createMemoryPort } from "../store/storage.port";
import { WorkItemStore } from "../store/workItem.store";
import { _resetUidSeq } from "../domain/factory.record";
import { isQuickstartFullscreenEnabledFor } from "../config/featureFlags";

describe("Gherkin P0-1 fullscreen en cero", () => {
  beforeEach(() => {
    _resetUidSeq();
    WorkItemStore._resetIdSeq();
    if (typeof window !== "undefined") {
      window.localStorage.clear();
      window.history.pushState(null, "", "/");
    }
  });

  it("cero factories detectado correctamente", () => {
    const port = createMemoryPort({ "termcanvas.factory-workspace.v2": JSON.stringify({ version: 2, factories: [], selectedUid: "" }) });
    const ws = new FactoryWorkspaceStore(port, []);
    expect(ws.list().length).toBe(0);
  });

  it("con factory no es cero", () => {
    const port = createMemoryPort();
    const ws = new FactoryWorkspaceStore(port, []);
    ws.create({ name: "my-factory" });
    expect(ws.list().length).toBe(1);
  });

  it("flag quickstart_fullscreen off desactiva fullscreen", () => {
    expect(isQuickstartFullscreenEnabledFor("false")).toBe(false);
    expect(isQuickstartFullscreenEnabledFor("off")).toBe(false);
    expect(isQuickstartFullscreenEnabledFor("0")).toBe(false);
    expect(isQuickstartFullscreenEnabledFor(undefined)).toBe(true);
    expect(isQuickstartFullscreenEnabledFor("true")).toBe(true);
  });
});
