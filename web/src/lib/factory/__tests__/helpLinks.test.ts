import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { HelpLink, TROUBLESHOOTING_ANCHORS } from "../../../components/help/HelpLinks";
import type { TroubleshootingAnchor } from "../../../components/help/HelpLinks";

describe("HelpLink — P0-06 (T16 US-145→148)", () => {
  it("TROUBLESHOOTING_ANCHORS tiene 6 entradas", () => {
    const keys = Object.keys(TROUBLESHOOTING_ANCHORS) as TroubleshootingAnchor[];
    expect(keys).toHaveLength(6);
    expect(keys).toEqual(expect.arrayContaining(["setup", "work-not-starting", "two-runs", "runs-stuck", "no-pr", "factory-api"]));
  });

  it("cada anchor mapea a string no vacío", () => {
    for (const anchor of Object.keys(TROUBLESHOOTING_ANCHORS) as TroubleshootingAnchor[]) {
      const id = TROUBLESHOOTING_ANCHORS[anchor];
      expect(id.length, anchor).toBeGreaterThan(0);
    }
  });

  it.each([
    ["setup", "setup"],
    ["work-not-starting", "work-not-starting"],
    ["two-runs", "two-runs"],
    ["runs-stuck", "runs-stuck"],
    ["no-pr", "no-pr"],
    ["factory-api", "factory-api"],
  ] as const)("HelpLink %s renderiza ? y linkea a #%s", (anchor, expectedId) => {
    render(React.createElement(HelpLink, { anchor }));
    const link = screen.getByRole("link", { name: /Ayuda/ });
    expect(link.textContent).toBe("?");
    expect(link.getAttribute("href")).toBe(`#${expectedId}`);
    expect(link.getAttribute("aria-label")).toMatch(/Ayuda/);
  });

  it("HelpLink acepta label custom", () => {
    render(React.createElement(HelpLink, { anchor: "setup", label: "Custom label" }));
    const link = screen.getByLabelText("Custom label");
    expect(link.getAttribute("href")).toBe("#setup");
    expect(link.getAttribute("title")).toBe("Custom label");
  });

  it("TroubleshootingPage tiene los 6 ids para deep-link", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const content = fs.readFileSync(path.resolve("src/components/help/TroubleshootingPage.tsx"), "utf8");
    for (const anchor of Object.keys(TROUBLESHOOTING_ANCHORS) as TroubleshootingAnchor[]) {
      const id = TROUBLESHOOTING_ANCHORS[anchor];
      expect(content, `missing id="${id}" for anchor ${anchor}`).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it("HelpLink usa onNavigate + hash + scroll (lazy-safe) — no solo <a href>", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const content = fs.readFileSync(path.resolve("src/components/help/HelpLinks.tsx"), "utf8");
    expect(content).toMatch(/onNavigate|HelpNavProvider|HelpNavContext/);
    expect(content).toMatch(/window\.location\.hash/);
    expect(content).toMatch(/scrollIntoView/);
  });
});
