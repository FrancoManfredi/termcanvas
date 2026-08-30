// githubAuth.service — SRP: OAuth code→token + user fetch (BFF, secret solo server)
// Source: ADR-003 Q1+Q2+Q5

import { getEnv } from "../config/env.js";

export interface ExchangeResult {
  access_token: string;
  scope: string;
  token_type: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  id: number;
}

export function maskToken(token: string): string {
  if (!token) return "***";
  if (token.length <= 8) return `${token.slice(0, 3)}***`;
  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}

export function getAuthorizeUrl(state: string, scope = "repo read:user"): string {
  const env = getEnv();
  const clientId = env.GITHUB_CLIENT_ID ?? "";
  const redirect = env.GITHUB_OAUTH_CALLBACK_URL ?? "http://localhost:5174/auth/callback";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    scope,
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const env = getEnv();
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("missing GitHub OAuth config");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth exchange failed ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; scope?: string; token_type?: string; error?: string; error_description?: string };
  if (data.error) throw new Error(data.error_description ?? data.error);
  if (!data.access_token) throw new Error("no access_token in response");
  return {
    access_token: data.access_token,
    scope: data.scope ?? "",
    token_type: data.token_type ?? "bearer",
  };
}

export async function getUser(token: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: { authorization: `token ${token}`, accept: "application/vnd.github+json", "user-agent": "termcanvas" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub /user failed ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { login: string; avatar_url: string; id: number };
  return { login: data.login, avatar_url: data.avatar_url, id: data.id };
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await getUser(token);
    return true;
  } catch {
    return false;
  }
}
