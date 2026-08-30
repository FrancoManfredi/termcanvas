import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoteGitHubReposAdapter } from "../adapters/githubRepos.adapter";

describe("GitHubReposPort — repo listing real", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lista repos reales con per_page 30 por defecto", async () => {
    const adapter = new RemoteGitHubReposAdapter();
    const reposPayload = [
      { full_name: "wilson/mi-repo-real", name: "mi-repo-real", owner: { login: "wilson" }, private: false, updated_at: "2026-08-30T00:00:00.000Z", html_url: "https://github.com/wilson/mi-repo-real" },
      { full_name: "wilson/otro", name: "otro", owner: { login: "wilson" }, private: true, updated_at: "2026-08-29T00:00:00.000Z", html_url: "https://github.com/wilson/otro" },
    ];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ repos: reposPayload }), headers: { get: () => null } } as unknown as Response);
    const result = await adapter.listRepos({ page: 1, perPage: 30 });
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(2);
    expect(result.value?.[0].fullName).toBe("wilson/mi-repo-real");
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/github/repos?"), expect.any(Object));
    const url = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as string;
    expect(url).toContain("per_page=30");
  });

  it("mapea 401 bad_credentials", async () => {
    const adapter = new RemoteGitHubReposAdapter();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "bad credentials", code: "bad_credentials" }), headers: { get: () => null } } as unknown as Response);
    const result = await adapter.listRepos();
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("bad_credentials");
  });

  it("mapea 429 rate_limited", async () => {
    const adapter = new RemoteGitHubReposAdapter();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "rate limited", code: "rate_limited" }), headers: { get: () => null } } as unknown as Response);
    const result = await adapter.listRepos();
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("rate_limited");
  });

  it("search filtra via query param", async () => {
    const adapter = new RemoteGitHubReposAdapter();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ repos: [] }), headers: { get: () => null } } as unknown as Response);
    await adapter.listRepos({ search: "mi-repo" });
    const url = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as string;
    expect(url).toContain("search=mi-repo");
  });
});
