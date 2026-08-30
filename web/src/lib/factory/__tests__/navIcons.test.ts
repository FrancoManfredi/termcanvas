// navIcons.test.ts — P0-04: exhaustividad NAV_ICONS ↔ NAV_ITEMS
// Source: WarpFactories.md §10 · PLAN Ola 5 E1
// SRP: verifica que cada NavItemId tenga icono y que no haya huérfanos.

import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../../../nav";
import { NAV_ICONS } from "../../../components/Sidebar";

describe("NAV_ICONS exhaustiveness (P0-04 · OLA 5)", () => {
  it("every NAV_ITEMS id has an icon in NAV_ICONS", () => {
    for (const item of NAV_ITEMS) {
      expect(item.id in NAV_ICONS, `NAV_ICONS missing icon for "${item.id}"`).toBe(true);
      expect(NAV_ICONS[item.id]).toBeDefined();
    }
  });

  it("no orphan icons — Object.keys(NAV_ICONS) length equals NAV_ITEMS length", () => {
    expect(Object.keys(NAV_ICONS)).toHaveLength(NAV_ITEMS.length);
  });

  it("no orphan keys — every NAV_ICONS key corresponds to a NAV_ITEMS id", () => {
    const ids = new Set(NAV_ITEMS.map((i) => i.id));
    for (const key of Object.keys(NAV_ICONS)) {
      expect(ids.has(key as never), `orphan icon key "${key}" not in NAV_ITEMS`).toBe(true);
    }
  });

  it("NAV_ITEMS has 29 ids (6 team + 23 factory) — regression guard", () => {
    expect(NAV_ITEMS).toHaveLength(29);
  });
});
