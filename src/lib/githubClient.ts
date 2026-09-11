/**
 * src/lib/githubClient.ts — dual-path read-only GitHub lookups (F2).
 *
 * Bridge (`window.termcanvas.github`) when present, headless daemon HTTP
 * (`GET /github/issues/:n/prs`, `/github/prs/:n/decision`,
 * `/github/prs/:n/comments`) when not. Envelopes match the bridge shapes
 * so callers (checkLinkedPr & co.) treat both identically — pills and
 * verdicts render the same in app and web modes. Honest degradation:
 * without bridge and without a reachable daemon, lookups resolve
 * `{ ok: false }` instead of throwing or inventing PRs.
 */
import { pickPreferredPr, type LinkedPrNode } from "../../shared/github-remote.ts";

export interface LinkedPrShape {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName: string;
  headRefOid: string;
}

export type FindOpenPrsResult =
  | { ok: true; prs: LinkedPrShape[] }
  | { ok: false; error: string };

export type FindPrResult =
  | { ok: true; pr: LinkedPrShape | null }
  | { ok: false; error: string };

export type PrDecisionResult =
  | {
      ok: true;
      reviewDecision:
        | "APPROVED"
        | "CHANGES_REQUESTED"
        | "REVIEW_REQUIRED"
        | "COMMENTED"
        | "FIX_APPLIED"
        | null;
      bodyVerdict: "APROBADO" | "CAMBIOS_PEDIDOS" | null;
      labels: string[];
      headRefOid: string | null;
      lastReviewCommitId: string | null;
    }
  | { ok: false; error: string };

export type PrCommentsResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type LabelWriteResult = { ok: true } | { ok: false; error: string };

export type LabelVerdict =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "REVIEW_REQUIRED"
  | "FIX_APPLIED"
  | null;

type BridgeGithub = {
  findPrForIssue: (
    cwd: string,
    issueNumber: number,
  ) => Promise<FindPrResult>;
  findOpenPrsForIssue: (
    cwd: string,
    issueNumber: number,
  ) => Promise<FindOpenPrsResult>;
  getPrReviewDecision: (
    cwd: string,
    prNumber: number,
  ) => Promise<PrDecisionResult>;
  getPrComments: (cwd: string, prNumber: number) => Promise<PrCommentsResult>;
  applyReviewLabel: (
    cwd: string,
    prNumber: number,
    verdict: LabelVerdict,
  ) => Promise<LabelWriteResult>;
  applyCycleLabel: (
    cwd: string,
    prNumber: number,
    issueNumber: number | null,
    label: string,
  ) => Promise<LabelWriteResult>;
  syncIssueReviewLabel: (
    cwd: string,
    issueNumber: number,
    prLabels: string[],
  ) => Promise<LabelWriteResult>;
  getConflictFiles: (
    cwd: string,
    branch: string,
    prNumber: number,
  ) => Promise<ConflictFilesResult>;
};

export type ConflictFilesResult =
  | { ok: true; conflictFiles: string[] }
  | { ok: false; error: string };

function getBridge(): BridgeGithub | null {
  if (typeof window === "undefined") return null;
  const github = (window as unknown as { termcanvas?: { github?: BridgeGithub } })
    .termcanvas?.github;
  return github ?? null;
}

const DEFAULT_HEADLESS_PORT = 7080;

export function resolveHeadlessHttpUrl(): string {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const port = params.get("headless-port");
      if (port && /^\d+$/.test(port)) {
        return `http://127.0.0.1:${port}`;
      }
    } catch {
      // Fall through to the localhost default below.
    }
    const envUrl = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env?.VITE_TERMCANVAS_HEADLESS_URL;
    if (envUrl) return envUrl.replace(/\/pty\/stream.*$/, "");
    if (window.location.port === String(DEFAULT_HEADLESS_PORT)) {
      return `${window.location.protocol}//${window.location.host}`;
    }
  }
  return `http://127.0.0.1:${DEFAULT_HEADLESS_PORT}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `headless ${res.status}`,
    );
  }
  return (await res.json()) as T;
}

interface DaemonPrsResponse {
  ok: boolean;
  prs?: LinkedPrNode[];
  preferred?: LinkedPrNode | null;
  error?: string;
}

export async function findOpenPrsForIssue(
  cwd: string,
  issueNumber: number,
): Promise<FindOpenPrsResult> {
  const bridge = getBridge();
  if (bridge) return bridge.findOpenPrsForIssue(cwd, issueNumber);
  try {
    const data = await getJson<DaemonPrsResponse>(
      `${resolveHeadlessHttpUrl()}/github/issues/${issueNumber}/prs?repo=${encodeURIComponent(cwd)}`,
    );
    if (!data.ok) return { ok: false, error: data.error ?? "lookup failed" };
    return { ok: true, prs: data.prs ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function findPrForIssue(
  cwd: string,
  issueNumber: number,
): Promise<FindPrResult> {
  const bridge = getBridge();
  if (bridge) return bridge.findPrForIssue(cwd, issueNumber);
  const result = await findOpenPrsForIssue(cwd, issueNumber);
  if (!result.ok) return result;
  return { ok: true, pr: pickPreferredPr(result.prs) };
}

export async function getPrReviewDecision(
  cwd: string,
  prNumber: number,
): Promise<PrDecisionResult> {
  const bridge = getBridge();
  if (bridge) return bridge.getPrReviewDecision(cwd, prNumber);
  try {
    return await getJson<PrDecisionResult>(
      `${resolveHeadlessHttpUrl()}/github/prs/${prNumber}/decision?repo=${encodeURIComponent(cwd)}`,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getPrComments(
  cwd: string,
  prNumber: number,
): Promise<PrCommentsResult> {
  const bridge = getBridge();
  if (bridge) return bridge.getPrComments(cwd, prNumber);
  try {
    return await getJson<PrCommentsResult>(
      `${resolveHeadlessHttpUrl()}/github/prs/${prNumber}/comments?repo=${encodeURIComponent(cwd)}`,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `headless ${res.status}`,
    );
  }
  return (await res.json()) as T;
}

function honestWriteError(err: unknown): LabelWriteResult {
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  };
}

export async function applyReviewLabel(
  cwd: string,
  prNumber: number,
  verdict: LabelVerdict,
): Promise<LabelWriteResult> {
  const bridge = getBridge();
  if (bridge) return bridge.applyReviewLabel(cwd, prNumber, verdict);
  try {
    return await postJson<LabelWriteResult>(
      `${resolveHeadlessHttpUrl()}/github/prs/${prNumber}/review-label`,
      { repo: cwd, verdict },
    );
  } catch (err) {
    return honestWriteError(err);
  }
}

export async function applyCycleLabel(
  cwd: string,
  prNumber: number,
  issueNumber: number | null,
  label: string,
): Promise<LabelWriteResult> {
  const bridge = getBridge();
  if (bridge) return bridge.applyCycleLabel(cwd, prNumber, issueNumber, label);
  try {
    return await postJson<LabelWriteResult>(
      `${resolveHeadlessHttpUrl()}/github/prs/${prNumber}/cycle-label`,
      { repo: cwd, label, issueNumber },
    );
  } catch (err) {
    return honestWriteError(err);
  }
}

export async function syncIssueReviewLabel(
  cwd: string,
  issueNumber: number,
  prLabels: string[],
): Promise<LabelWriteResult> {
  const bridge = getBridge();
  if (bridge) return bridge.syncIssueReviewLabel(cwd, issueNumber, prLabels);
  try {
    return await postJson<LabelWriteResult>(
      `${resolveHeadlessHttpUrl()}/github/issues/${issueNumber}/review-label`,
      { repo: cwd, prLabels },
    );
  } catch (err) {
    return honestWriteError(err);
  }
}

export async function getConflictFiles(
  cwd: string,
  branch: string,
  prNumber: number,
): Promise<ConflictFilesResult> {
  const bridge = getBridge();
  if (bridge) return bridge.getConflictFiles(cwd, branch, prNumber);
  try {
    const params = new URLSearchParams({ repo: cwd, branch });
    return await getJson<ConflictFilesResult>(
      `${resolveHeadlessHttpUrl()}/github/prs/${prNumber}/conflict-files?${params.toString()}`,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
