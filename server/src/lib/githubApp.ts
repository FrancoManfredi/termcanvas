// GitHubAppService — O17 real implementation: JWT via @octokit/auth-app + @octokit/rest
// Mode: "real" when GITHUB_APP_* present, else "dry_run" (no network)
// Responsibilities: createIssue, ensureLabel (factory:<alias>), generateInstallationToken

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { getEnv, hasGitHubAppConfig } from "../config/env.js";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
}

export interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

export type GitHubMode = "real" | "dry_run";

function normalizePrivateKey(key: string): string {
  // Support env var with escaped newlines (\n) or actual newlines
  const trimmed = key.trim();
  // If contains literal \n string, replace
  if (trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return trimmed;
}

export class GitHubAppService {
  readonly mode: GitHubMode;
  private readonly cfg: GitHubAppConfig | null;

  constructor(cfg: GitHubAppConfig | null) {
    this.cfg = cfg;
    this.mode = cfg ? "real" : "dry_run";
  }

  static fromEnv(): GitHubAppService {
    const env = getEnv();
    if (hasGitHubAppConfig(env)) {
      return new GitHubAppService({
        appId: env.GITHUB_APP_ID!,
        privateKey: env.GITHUB_APP_PRIVATE_KEY!,
        installationId: env.GITHUB_INSTALLATION_ID!,
      });
    }
    return new GitHubAppService(null);
  }

  /**
   * Generate installation token via GitHub App JWT.
   * Returns null in dry_run.
   */
  async generateInstallationToken(): Promise<string | null> {
    if (this.mode === "dry_run" || !this.cfg) return null;
    const privateKey = normalizePrivateKey(this.cfg.privateKey);
    const appIdRaw = this.cfg.appId.trim();
    const installationIdRaw = this.cfg.installationId.trim();
    const appId = Number(appIdRaw) || appIdRaw;
    const installationId = Number(installationIdRaw);
    if (!Number.isFinite(installationId)) {
      throw new Error("GITHUB_INSTALLATION_ID must be numeric");
    }
    const auth = createAppAuth({
      appId: appId as unknown as number,
      privateKey,
    });
    const result = (await auth({
      type: "installation",
      installationId,
    } as unknown as Parameters<typeof auth>[0])) as { token: string };
    return result.token;
  }

  private async getOctokit(): Promise<Octokit> {
    const token = await this.generateInstallationToken();
    if (!token) throw new Error("Unable to generate installation token (dry_run or missing config)");
    return new Octokit({ auth: token });
  }

  /**
   * Ensure label factory:<alias> exists in owner/repo. Idempotent.
   * Creates with color 0366d6 if missing. Swallows 422 already_exists.
   */
  async ensureLabel(owner: string, repo: string, alias: string): Promise<void> {
    if (this.mode === "dry_run" || !this.cfg) return;
    const labelName = `factory:${alias.trim()}`;
    if (!labelName || labelName === "factory:") return;
    const octokit = await this.getOctokit();
    try {
      await octokit.rest.issues.getLabel({ owner, repo, name: labelName });
      return; // exists
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status !== 404) {
        // If 404 we need to create; other errors should be re-thrown unless we can create
        if (status !== undefined && status !== 404) {
          // For any non-404, we still try to create but if that fails we propagate
        }
      }
    }
    try {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: labelName,
        color: "0366d6",
        description: `Factory ${alias.trim()}`,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      // 422 means already exists (race) -> swallow
      if (status === 422) return;
      throw err;
    }
  }

  verifyMention(_handle: string): boolean {
    return true;
  }

  async createIssue(input: CreateIssueInput): Promise<{ number: number; html_url: string; mode: GitHubMode }> {
    if (this.mode === "dry_run" || !this.cfg) {
      const simulatedNumber = 9999;
      return {
        number: simulatedNumber,
        html_url: `https://github.com/${input.owner}/${input.repo}/issues/${simulatedNumber}`,
        mode: "dry_run",
      };
    }
    // Real mode: ensure label first then create issue
    const aliasPart = input.labels.find((l) => l.startsWith("factory:"))?.slice("factory:".length) ?? input.labels[0] ?? "";
    if (aliasPart) {
      try {
        await this.ensureLabel(input.owner, input.repo, aliasPart);
      } catch {
        // label creation failure should not block issue creation, but log
        // we swallow to allow issue creation to proceed
      }
    }
    const octokit = await this.getOctokit();
    const res = await octokit.rest.issues.create({
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      body: input.body,
      labels: input.labels,
    });
    return {
      number: res.data.number,
      html_url: res.data.html_url,
      mode: "real",
    };
  }
}

export function createGitHubAppService(_env = getEnv()): GitHubAppService {
  return GitHubAppService.fromEnv();
}
