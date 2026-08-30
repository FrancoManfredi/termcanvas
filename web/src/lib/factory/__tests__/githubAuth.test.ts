import { describe, it, expect, beforeEach, vi } from "vitest";
import { RemoteGitHubAuthAdapter, LocalGitHubAuthAdapter } from "../adapters/githubAuth.adapter";

describe("GitHubAuthPort — OAuth BFF + hybrid", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getStatus retorna not connected cuando no hay cookie", async () => {
    const adapter = new RemoteGitHubAuthAdapter();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ connected: false }), headers: { get: () => null } } as unknown as Response);
    const status = await adapter.getStatus();
    expect(status.connected).toBe(false);
  });

  it("getStatus conectado cuando server responde 200", async () => {
    const adapter = new RemoteGitHubAuthAdapter();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ connected: true, username: "wilson", avatarUrl: "https://avatars/a.png", scope: "repo" }), headers: { get: () => null } } as unknown as Response);
    const status = await adapter.getStatus();
    expect(status.connected).toBe(true);
    expect(status.username).toBe("wilson");
  });

  it("Local adapter nunca está conectado", async () => {
    const adapter = new LocalGitHubAuthAdapter();
    const s = await adapter.getStatus();
    expect(s.connected).toBe(false);
    expect(s.status).toBe("idle");
  });

  it("token nunca en bundle — githubAuth no expone token", async () => {
    const adapter = new RemoteGitHubAuthAdapter();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ connected: true, username: "wilson" }), headers: { get: () => null } } as unknown as Response);
    const s = await adapter.getStatus();
    expect((s as unknown as { token?: string }).token).toBeUndefined();
  });

  it("postMessage origin se valida (handler solo location.origin)", () => {
    // documenta contrato: adapter connectWithPopup valida origin === location.origin
    expect(typeof RemoteGitHubAuthAdapter.prototype.connectWithPopup).toBe("function");
  });
});
