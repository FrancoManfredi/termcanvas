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

const LOCAL_PAT_STORAGE_KEY_REPOS = "github_pat_session";

function getLocalPat(): string | null {
  try {
    const raw = localStorage.getItem(LOCAL_PAT_STORAGE_KEY_REPOS);
    if (!raw) return null;
    const data = JSON.parse(raw) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

export class LocalGitHubReposAdapter implements GitHubReposPort {
  async listRepos(opts?: { perPage?: number; page?: number; search?: string }): Promise<ParseResult<readonly GitHubRepo[]>> {
    const pat = typeof window !== "undefined" ? getLocalPat() : null;
    // Si hay PAT personal, listar repos reales directo contra GitHub API (sin server)
    if (pat) {
      const perPage = Math.min(Math.max(opts?.perPage ?? 30, 1), 100);
      const page = Math.max(opts?.page ?? 1, 1);
      const url = new URL("https://api.github.com/user/repos");
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      url.searchParams.set("sort", "updated");
      url.searchParams.set("affiliation", "owner,collaborator,organization_member");
      try {
        const res = await fetch(url.toString(), {
          headers: { authorization: `token ${pat}`, accept: "application/vnd.github+json", "user-agent": "termcanvas" },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (res.status === 401) return ParseResult.singleFail<readonly GitHubRepo[]>("repos", "Token inválido o expirado — genera uno nuevo en github.com/settings/tokens", "bad_credentials");
          if (res.status === 403 || res.status === 429) return ParseResult.singleFail<readonly GitHubRepo[]>("repos", "Rate limited — esperá un minuto", "rate_limited");
          return ParseResult.singleFail<readonly GitHubRepo[]>("repos", `GitHub API falló ${res.status} ${text.slice(0, 120)}`, "fetch_error");
        }
        const data = (await res.json()) as Array<{
          full_name: string;
          name: string;
          owner: { login: string };
          private: boolean;
          updated_at: string;
          html_url: string;
          description?: string | null;
        }>;
        let repos = data.map((r) => ({
          fullName: r.full_name,
          name: r.name,
          owner: r.owner.login,
          private: r.private,
          updatedAt: r.updated_at,
          htmlUrl: r.html_url,
          description: r.description ?? undefined,
        }));
        if (opts?.search?.trim()) {
          const q = opts.search.trim().toLowerCase();
          repos = repos.filter((r) => r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
        }
        return ParseResult.ok<readonly GitHubRepo[]>(repos);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return ParseResult.singleFail<readonly GitHubRepo[]>("repos", msg, "network_error");
      }
    }
    // Sin PAT → demo repos (modo irrompible)
    const { DEMO_REPOS } = await import("../domain/quickstart.data");
    let repos: readonly import("../domain/types").RepositoryRef[] = DEMO_REPOS;
    if (opts?.search?.trim()) {
      const q = opts.search.trim().toLowerCase();
      repos = repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q));
    }
    const mapped = repos.map((r) => ({
      fullName: `${r.owner}/${r.name}`,
      name: r.name,
      owner: r.owner,
      private: false,
      updatedAt: new Date().toISOString(),
      htmlUrl: `https://github.com/${r.owner}/${r.name}`,
      description: "Repositorio demo local",
    }));
    return ParseResult.ok<readonly GitHubRepo[]>(mapped);
  }
}
