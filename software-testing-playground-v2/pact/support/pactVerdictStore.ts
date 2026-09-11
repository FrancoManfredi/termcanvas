import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getCommitSha, isDirty } from "./git.js";

/**
 * PactVerdictStore — append-only verdicts for Pact verification.
 * Each p:verify generates verdict in software-testing-playground-v2/verdicts/Fxx/<ulid>.json
 * Shape: {featureId, pactFile, providerBaseUrl, consumerResult, providerResult, rawOutput separado de conclusion, commitSha, actor}
 * Implements architecture-pact-v2.md §2.5 + runner adaptado para Pact.
 */

export interface PactVerdict {
  id: string; // ULID-like
  featureId: string; // "F01"
  pactFile: string; // relative "pacts/playground-F01-FactoryProvider.json"
  pactFileAbsolute: string;
  providerBaseUrl: string | null;
  consumerResult: {
    passed: boolean;
    pactFileExists: boolean;
    pactFileMtime?: string;
  };
  providerResult: {
    status: "pass" | "fail" | "not_run";
    rawOutput?: string; // Verifier stdout/stderr truncated
  };
  rawOutput: unknown; // Verifier output (string or object) — separated from conclusion per R5
  conclusion: "pass" | "fail" | "inconclusive";
  reason?: string;
  commitSha: string;
  commitDirty: boolean;
  actor: "script" | "humano" | "ci";
  actorDetail?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

const VERDICTS_BASE = path.resolve("software-testing-playground-v2/verdicts");
const PACTS_BASE = path.resolve("software-testing-playground-v2/pacts");

/**
 * Generates ULID-like id: timestamp base36 + 10 hex random + counter.
 * Sorted chronologically if called sequentially.
 */
export function generateUlid(): string {
  const ts = Date.now().toString(36).toUpperCase().padStart(9, "0");
  const rand = crypto.randomBytes(8).toString("hex").toUpperCase().slice(0, 10);
  return `${ts}${rand}`;
}

/**
 * Ensures verdict dir for feature exists.
 */
function ensureVerdictDir(featureId: string): string {
  const normalized = featureId.toUpperCase();
  const dir = path.join(VERDICTS_BASE, normalized);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Atomic write: write to tmp then rename.
 */
function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * Returns relative pact path from repo root, normalized to forward slashes.
 */
function toRelativePactPath(absolutePath: string): string {
  const rel = path.relative(path.resolve("."), absolutePath);
  return rel.replace(/\\/g, "/");
}

/**
 * Core: creates and persists a verdict for a single feature.
 * Called by verify.ts after Verifier run (success or failure).
 * If multiple pacts in one verify run, call once per featureId.
 */
export function writePactVerdict(opts: {
  featureId: string;
  pactFileAbsolute: string;
  providerBaseUrl: string | null;
  consumerPassed?: boolean;
  providerStatus: "pass" | "fail" | "not_run";
  providerRawOutput?: string;
  rawOutput: unknown;
  conclusion: "pass" | "fail" | "inconclusive";
  reason?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  actor?: "script" | "humano" | "ci";
  actorDetail?: string;
}): PactVerdict {
  const normalized = opts.featureId.toUpperCase();
  const id = generateUlid();
  const commitSha = getCommitSha();
  const dirty = isDirty();
  const actor = opts.actor ?? "script";
  const pactFileRelative = toRelativePactPath(opts.pactFileAbsolute);

  // Try to get pact mtime for consumerResult detail
  let pactFileMtime: string | undefined;
  try {
    const stat = fs.statSync(opts.pactFileAbsolute);
    pactFileMtime = stat.mtime.toISOString();
  } catch {
    pactFileMtime = undefined;
  }

  const pactFileExists = fs.existsSync(opts.pactFileAbsolute);

  const verdict: PactVerdict = {
    id,
    featureId: normalized,
    pactFile: pactFileRelative,
    pactFileAbsolute: opts.pactFileAbsolute,
    providerBaseUrl: opts.providerBaseUrl,
    consumerResult: {
      passed: opts.consumerPassed ?? pactFileExists,
      pactFileExists,
      pactFileMtime,
    },
    providerResult: {
      status: opts.providerStatus,
      rawOutput: opts.providerRawOutput?.slice(0, 8000),
    },
    rawOutput: opts.rawOutput,
    conclusion: opts.conclusion,
    reason: opts.reason,
    commitSha: dirty ? `dirty-${commitSha.slice(0, 8)}` : commitSha,
    commitDirty: dirty,
    actor,
    actorDetail: opts.actorDetail ?? `software-testing-playground-v2/pact/provider/verify.ts`,
    startedAt: opts.startedAt,
    finishedAt: opts.finishedAt,
    durationMs: opts.durationMs,
  };

  const dir = ensureVerdictDir(normalized);
  const filePath = path.join(dir, `${id}.json`);
  atomicWriteJson(filePath, verdict);

  // Also regenerate lightweight state.json cache (if needed by UI polling)
  try {
    regeneratePactStateJson();
  } catch {
    // best-effort
  }

  return verdict;
}

/**
 * Lists verdicts for a feature, newest first.
 */
export function listPactVerdicts(featureId: string): PactVerdict[] {
  const normalized = featureId.toUpperCase();
  const dir = path.join(VERDICTS_BASE, normalized);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const out: PactVerdict[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(full, "utf-8")) as PactVerdict;
      out.push(data);
    } catch {
      // skip
    }
  }
  out.sort((a, b) => {
    const aTime = a.finishedAt ? Date.parse(a.finishedAt) : 0;
    const bTime = b.finishedAt ? Date.parse(b.finishedAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return b.id.localeCompare(a.id);
  });
  return out;
}

/**
 * Returns latest verdict for feature, or null.
 */
export function getLatestPactVerdict(featureId: string): PactVerdict | null {
  const list = listPactVerdicts(featureId);
  return list[0] ?? null;
}

/**
 * Regenerates software-testing-playground-v2/state.json cache (derived, regenerable).
 * Contains derived pactStatus per F for fast UI polling.
 * Not source of truth — can be deleted.
 */
export function regeneratePactStateJson(): void {
  try {
    const statePath = path.resolve("software-testing-playground-v2/state.json");
    // Lazy import to avoid circular deps
    // Do direct fs-based derive to avoid importing pactState in sync path that might import this
    const featureIds = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14"];
    const features: Record<string, unknown> = {};
    for (const fid of featureIds) {
      const pactFile = path.join(PACTS_BASE, `playground-${fid}-FactoryProvider.json`);
      const exists = fs.existsSync(pactFile);
      const dir = path.join(VERDICTS_BASE, fid);
      let latest: unknown = null;
      let status: string = exists ? "mock_only" : "not_generated";
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) {
          // find latest by mtime or finishedAt
          let latestFile: string | null = null;
          let latestTime = 0;
          for (const f of files) {
            const full = path.join(dir, f);
            try {
              const data = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
              const t = data.finishedAt ? Date.parse(data.finishedAt as string) : fs.statSync(full).mtimeMs;
              if (t > latestTime) {
                latestTime = t;
                latestFile = full;
                latest = data;
              }
            } catch {}
          }
          if (latest) {
            const conclusion = (latest as Record<string, unknown>).conclusion as string | undefined;
            const providerResult = (latest as Record<string, unknown>).providerResult as
              | { status?: string }
              | undefined;
            const providerStatus = providerResult?.status ?? (conclusion as string | undefined);
            if (providerStatus === "pass") status = "verified";
            else if (providerStatus === "fail") status = "failed";
            else if (exists) status = "mock_only";
          }
        }
      }
      features[fid] = {
        pactStatus: status,
        pactExists: exists,
        latestVerdictId: (latest as Record<string, unknown> | null)?.id ?? null,
        latestVerdictAt: (latest as Record<string, unknown> | null)?.finishedAt ?? null,
      };
    }

    const state = {
      generatedAt: new Date().toISOString(),
      commitSha: getCommitSha(),
      factoryPort: null as number | null,
      features,
    };

    // try to discover port quickly but don't block
    try {
      const portFileCandidates = [
        path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".termcanvas", "factory-port"),
        path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".termcanvas-dev", "factory-port"),
      ];
      for (const pf of portFileCandidates) {
        try {
          if (fs.existsSync(pf)) {
            const raw = fs.readFileSync(pf, "utf-8").trim().split("\n")[0]?.trim();
            const port = Number(raw);
            if (Number.isInteger(port) && port >= 17680 && port <= 17690) {
              (state as { factoryPort: number | null }).factoryPort = port;
              break;
            }
          }
        } catch {}
      }
    } catch {}

    atomicWriteJson(statePath, state);
  } catch {
    // best-effort
  }
}
