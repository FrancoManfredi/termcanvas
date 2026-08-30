// githubRepos.service — SRP: list user repos via api.github.com (OAuth token)

export interface ListReposOpts {
  page?: number;
  perPage?: number;
  search?: string;
  affiliation?: string;
  sort?: string;
}

export interface GitHubRepoRaw {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  updated_at: string;
  html_url: string;
  description: string | null;
}

export async function listUserRepos(token: string, opts: ListReposOpts = {}): Promise<{ repos: GitHubRepoRaw[]; linkHeader: string | null }> {
  const perPage = opts.perPage ?? 30;
  const page = opts.page ?? 1;
  const affiliation = opts.affiliation ?? "owner,collaborator";
  const sort = opts.sort ?? "updated";
  const params = new URLSearchParams({
    affiliation,
    sort,
    per_page: String(perPage),
    page: String(page),
  });
  const url = `https://api.github.com/user/repos?${params.toString()}`;
  const res = await fetch(url, {
    headers: { authorization: `token ${token}`, accept: "application/vnd.github+json", "user-agent": "termcanvas" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`GitHub repos failed ${res.status} ${body.slice(0, 300)}`) as Error & { status?: number };
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }
  let repos = (await res.json()) as GitHubRepoRaw[];
  const linkHeader = res.headers.get("link");
  if (opts.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    repos = repos.filter((r) => r.full_name.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }
  return { repos, linkHeader };
}
