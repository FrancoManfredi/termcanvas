// githubRepos.adapter — SRP: repo listing real vía BFF
// DIP: implementa GitHubReposPort; no toca window/localStorage

import { ParseResult } from "../domain/result";
import type { GitHubRepo, GitHubReposPort } from "../ports/github.ports";

export class RemoteGitHubReposAdapter implements GitHubReposPort {
  async listRepos(opts?: { page?: number; perPage?: number; search?: string }): Promise<ParseResult<readonly GitHubRepo[]>> {
    const params = new URLSearchParams();
    const perPage = opts?.perPage ?? 30;
    const page = opts?.page ?? 1;
    params.set("per_page", String(perPage));
    params.set("page", String(page));
    if (opts?.search?.trim()) params.set("search", opts.search.trim());

    const url = `/api/github/repos?${params.toString()}`;
    try {
      const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as {
        repos?: Array<{
          full_name?: string;
          fullName?: string;
          name?: string;
          owner?: unknown;
          private?: boolean;
          updated_at?: string;
          updatedAt?: string;
          html_url?: string;
          htmlUrl?: string;
          description?: string;
        }>;
        error?: string;
        code?: string;
      } | null;

      if (!res.ok) {
        const code = body?.code ?? (res.status === 401 ? "bad_credentials" : res.status === 429 ? "rate_limited" : "fetch_error");
        const message = body?.error ?? `GitHub repos failed ${res.status}`;
        return ParseResult.singleFail<readonly GitHubRepo[]>("repos", message, code);
      }

      const repos = (body?.repos ?? []).map((r): GitHubRepo => {
        const fullName = (r.full_name ?? r.fullName ?? `${String((r.owner as { login?: string })?.login ?? "unknown")}/${r.name ?? "repo"}`) as string;
        const [owner, ...rest] = fullName.split("/");
        const name = r.name ?? rest.join("/") ?? fullName;
        const ownerStr = owner ?? "unknown";
        return {
          fullName,
          name,
          owner: ownerStr,
          private: Boolean(r.private),
          updatedAt: r.updated_at ?? r.updatedAt ?? new Date().toISOString(),
          htmlUrl: r.html_url ?? r.htmlUrl ?? `https://github.com/${fullName}`,
          description: r.description,
        };
      });
      return ParseResult.ok<readonly GitHubRepo[]>(repos);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ParseResult.singleFail<readonly GitHubRepo[]>("repos", msg, "network_error");
    }
  }
}

export class LocalGitHubReposAdapter implements GitHubReposPort {
  async listRepos(): Promise<ParseResult<readonly GitHubRepo[]>> {
    return ParseResult.ok<readonly GitHubRepo[]>([]);
  }
}
