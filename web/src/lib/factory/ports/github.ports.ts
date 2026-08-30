// GitHub ports — DIP: dominio/wizard no conoce fetch ni window
// Source: ADR-003 Q1+Q2+Q3 (OAuth BFF, hybrid token, repo listing)

import type { ParseResult } from "../domain/result";

export type GitHubAuthStatus = "idle" | "connecting" | "connected" | "error" | "expired";

export interface GitHubAuthState {
  readonly connected: boolean;
  readonly username?: string;
  readonly avatarUrl?: string;
  readonly scope?: string;
  readonly status: GitHubAuthStatus;
  readonly error?: string;
}

export interface GitHubRepo {
  readonly fullName: string;
  readonly name: string;
  readonly owner: string;
  readonly private: boolean;
  readonly updatedAt: string;
  readonly htmlUrl: string;
  readonly description?: string;
}

export interface GitHubAuthPort {
  getStatus(): Promise<GitHubAuthState>;
  startAuth(): Promise<string>;
  logout(): Promise<void>;
  subscribe(cb: () => void): () => void;
  getVersion(): number;
}

export interface GitHubReposPort {
  listRepos(opts?: { page?: number; perPage?: number; search?: string }): Promise<ParseResult<readonly GitHubRepo[]>>;
}

export const GITHUB_AUTH_POLL_INTERVAL_MS = 1500;
export const GITHUB_AUTH_POLL_MAX_MS = 60_000;
