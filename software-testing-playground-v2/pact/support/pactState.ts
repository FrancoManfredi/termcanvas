import fs from "node:fs";
import path from "node:path";
import { pactExists } from "./pactReader.js";

/**
 * PactState — derives pactStatus and display state for UI.
 * Implements architecture-pact-v2.md §2.5 visual distinction:
 *   mock_only = border 2px dashed #f59e0b bg #fffbeb (ámbar rayado)
 *   verified  = border green solid bg #f0fdf4 (verde)
 *   failed    = border red solid bg #fef2f2
 *   not_generated = gray pending
 */

export type PactStatus = "mock_only" | "verified" | "failed" | "not_generated";

export interface VerdictSummary {
  id: string;
  featureId: string;
  pactFile: string;
  providerBaseUrl: string | null;
  consumerResult?: { passed: boolean; pactFileExists: boolean };
  providerResult?: { status: "pass" | "fail" | "not_run"; rawOutput?: string };
  rawOutput?: unknown;
  conclusion: "pass" | "fail" | "inconclusive";
  commitSha?: string;
  commitDirty?: boolean;
  actor?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

const VERDICTS_BASE = path.resolve("software-testing-playground-v2/verdicts");

/**
 * Lists verdict JSON files for a feature, sorted newest first by finishedAt / file mtime.
 */
function listVerdictsFor(featureId: string): VerdictSummary[] {
  const normalized = featureId.toUpperCase();
  const dir = path.join(VERDICTS_BASE, normalized);
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const verdicts: VerdictSummary[] = [];
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const raw = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
        // Normalize to VerdictSummary, tolerate old shapes
        const id = typeof raw.id === "string" ? raw.id : file.replace(".json", "");
        const featureIdVal = typeof raw.featureId === "string" ? raw.featureId : normalized;
        const pactFile = typeof raw.pactFile === "string" ? raw.pactFile : `pacts/playground-${normalized}-FactoryProvider.json`;
        const providerBaseUrl = typeof raw.providerBaseUrl === "string" ? raw.providerBaseUrl : null;
        const rawOutput = raw.rawOutput;
        const conclusion =
          raw.conclusion === "pass" || raw.conclusion === "fail" ? raw.conclusion : raw.conclusion === "inconclusive" ? "inconclusive" : "fail";
        const providerResultRaw = raw.providerResult as Record<string, unknown> | undefined;
        const providerResult: VerdictSummary["providerResult"] = providerResultRaw
          ? {
              status:
                providerResultRaw.status === "pass" || providerResultRaw.status === "fail" || providerResultRaw.status === "not_run"
                  ? (providerResultRaw.status as "pass" | "fail" | "not_run")
                  : conclusion === "pass"
                    ? "pass"
                    : "fail",
              rawOutput: typeof providerResultRaw.rawOutput === "string" ? providerResultRaw.rawOutput : undefined,
            }
          : {
              status: conclusion === "pass" ? "pass" : conclusion === "fail" ? "fail" : "not_run",
            };

        // Fallback: if consumerResult missing but verdict exists, infer
        const consumerResultRaw = raw.consumerResult as Record<string, unknown> | undefined;

        verdicts.push({
          id,
          featureId: featureIdVal,
          pactFile,
          providerBaseUrl,
          consumerResult: consumerResultRaw
            ? {
                passed: Boolean(consumerResultRaw.passed ?? consumerResultRaw.pass ?? true),
                pactFileExists: Boolean(consumerResultRaw.pactFileExists ?? true),
              }
            : { passed: true, pactFileExists: true },
          providerResult,
          rawOutput,
          conclusion: conclusion as "pass" | "fail" | "inconclusive",
          commitSha: typeof raw.commitSha === "string" ? raw.commitSha : undefined,
          commitDirty: typeof raw.commitDirty === "boolean" ? raw.commitDirty : undefined,
          actor: typeof raw.actor === "string" ? raw.actor : undefined,
          startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
          finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : undefined,
          durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
        });
      } catch {
        // skip invalid verdict
      }
    }
    // sort newest first: finishedAt desc, then id desc
    verdicts.sort((a, b) => {
      const aTime = a.finishedAt ? Date.parse(a.finishedAt) : 0;
      const bTime = b.finishedAt ? Date.parse(b.finishedAt) : 0;
      if (aTime !== bTime) return bTime - aTime;
      return b.id.localeCompare(a.id);
    });
    return verdicts;
  } catch {
    return [];
  }
}

/**
 * Derives PactStatus for a feature.
 * Logic (architecture-pact-v2.md §2.5 table):
 *   not_generated: no pact JSON exists
 *   mock_only: pact exists but no verdict or last verdict provider not_run / no provider verification yet
 *   verified: pact exists + last verdict providerResult pass
 *   failed: pact exists + last verdict providerResult fail
 */
export function derivePactStatus(featureId: string): PactStatus {
  const normalized = featureId.toUpperCase();
  if (!pactExists(normalized)) return "not_generated";
  const verdicts = listVerdictsFor(normalized);
  if (verdicts.length === 0) return "mock_only";
  const latest = verdicts[0];
  // consumerResult pass but providerResult missing → mock_only
  const providerStatus = latest.providerResult?.status;
  if (providerStatus === "pass") return "verified";
  if (providerStatus === "fail") return "failed";
  if (providerStatus === "not_run") return "mock_only";
  // fallback based on conclusion
  if (latest.conclusion === "pass") return "verified";
  if (latest.conclusion === "fail") return "failed";
  return "mock_only";
}

/**
 * Extended state for UI: distinguishes mock_only ámbar rayado vs verified verde.
 * Also provides display helpers.
 */
export interface PactFeatureState {
  featureId: string;
  pactStatus: PactStatus;
  verdicts: VerdictSummary[];
  latestVerdict: VerdictSummary | null;
  pactExists: boolean;
  // helpers
  isVerified: boolean;
  isMockOnly: boolean;
  isFailed: boolean;
  isNotGenerated: boolean;
}

export function deriveState(featureId: string): PactFeatureState {
  const normalized = featureId.toUpperCase();
  const pactStatus = derivePactStatus(normalized);
  const verdicts = listVerdictsFor(normalized);
  const latest = verdicts[0] ?? null;
  const exists = pactExists(normalized);
  return {
    featureId: normalized,
    pactStatus,
    verdicts,
    latestVerdict: latest,
    pactExists: exists,
    isVerified: pactStatus === "verified",
    isMockOnly: pactStatus === "mock_only",
    isFailed: pactStatus === "failed",
    isNotGenerated: pactStatus === "not_generated",
  };
}

/**
 * Returns state for all known Fs (F01-F12).
 * Checks pact existence for each, plus verdicts.
 */
export function deriveAllStates(featureIds: string[] = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14"]): Record<string, PactFeatureState> {
  const out: Record<string, PactFeatureState> = {};
  for (const id of featureIds) {
    out[id] = deriveState(id);
  }
  return out;
}

/**
 * Returns style config for a given pactStatus (for FeatureCard border/background).
 * Matches architecture-pact-v2.md §2.5 styles verbatim.
 */
export function styleForPactStatus(status: PactStatus): { cardClass: string; badgeVariant: PactStatus } {
  switch (status) {
    case "mock_only":
      return {
        cardClass: "border-2 border-dashed border-amber-500 bg-[#fffbeb]",
        badgeVariant: "mock_only",
      };
    case "verified":
      return {
        cardClass: "border border-green-600 bg-[#f0fdf4]",
        badgeVariant: "verified",
      };
    case "failed":
      return {
        cardClass: "border border-red-600 bg-[#fef2f2]",
        badgeVariant: "failed",
      };
    case "not_generated":
    default:
      return {
        cardClass: "border border-gray-300 bg-white",
        badgeVariant: "not_generated",
      };
  }
}

/**
 * Lists pact statuses quickly for UI without reading all verdicts deeply (same as deriveAllStates but lighter if needed).
 */
export function quickPactStatuses(featureIds: string[] = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14"]): Record<string, PactStatus> {
  const out: Record<string, PactStatus> = {};
  for (const id of featureIds) {
    out[id] = derivePactStatus(id);
  }
  return out;
}
