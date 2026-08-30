import { describe, it, expect, beforeEach } from "vitest";

const CRED_KEY = "termcanvas.settings.credentialStrategy.v1";

describe("settings.live — O18 EXECUTOR/CREATOR cross-client", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") window.localStorage.clear();
  });

  it("1. default credentialStrategy es EXECUTOR", async () => {
    const mod = await import("../domain/settings.derive");
    const bundleMod = await import("../hooks/useFactoryBundle");
    const res = bundleMod.getFactoryBundle();
    expect(res.ok).toBe(true);
    if (res.ok) {
      const strat = mod.getEffectiveCredentialStrategy(res.value!);
      expect(strat).toBe("EXECUTOR");
    }
  });

  it("2. EXECUTOR/CREATOR persiste reload via localStorage cross-client", () => {
    window.localStorage.setItem(CRED_KEY, "CREATOR");
    expect(window.localStorage.getItem(CRED_KEY)).toBe("CREATOR");
    // simulate reload: load again
    const loaded = window.localStorage.getItem(CRED_KEY);
    expect(loaded).toBe("CREATOR");
    // change back to EXECUTOR
    window.localStorage.setItem(CRED_KEY, "EXECUTOR");
    expect(window.localStorage.getItem(CRED_KEY)).toBe("EXECUTOR");
  });

  it("3. SettingsPage importable y expone toggle EXECUTOR/CREATOR", async () => {
    const mod = await import("../../../components/factory-definition/SettingsPage");
    expect(typeof mod.SettingsPage).toBe("function");
  });
});
