/**
 * Canonical review report (prp-review contract, local builder).
 *
 * Pure module: builds the reviewer-readable report plus the machine
 * metadata HTML comment that deterministic consumers parse from the raw
 * text (`verdict`, `readiness`, `open_findings`, `publication` on exact
 * unindented lines). The `readiness` line is the single machine verdict:
 * `computeReadiness` derives both it and the prose verdict from the same
 * structured inputs, and `assertReportIntegrity` checks they agree.
 * Publication to GitHub happens elsewhere (`gitHubPr.ts`);
 * this module never touches network, disk or stores. Every export
 * never throws.
 *
 * Body follows the review-round template: verdict + action, accepted
 * contract, reviewed head, findings, prior findings, bot review,
 * discoveries and coverage. The machine header keeps the exact
 * `prp-review-id` / `reviewed_head` markers the publisher and the stale
 * check depend on.
 */

export type CanonicalVerdict = "READY TO MERGE" | "NEEDS FIXES" | "REVIEW INCOMPLETE";

export type CanonicalSeverity = "Critical" | "Important" | "Suggestion";

export interface CanonicalFindingInput {
  id?: unknown;
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  axis?: unknown;
  suggestion?: unknown;
  /** Class invariant enumeration (invariant + members + clean members). */
  class?: unknown;
  /** Terminal state when already dispositioned (else OPEN). */
  state?: unknown;
  dispositionReason?: unknown;
  trackingIssue?: unknown;
  foundBy?: unknown;
  /** One-line claim (falls back to `message`). */
  claim?: unknown;
  /** Lenses/reviewers that raised the finding. */
  sources?: unknown;
  /** How the fix/state was verified (command output or `path:line`). */
  verification?: unknown;
}

export interface CanonicalValidationInput {
  command?: unknown;
  result?: unknown;
  evidence?: unknown;
}

export interface CanonicalContractInput {
  /** Where the contract comes from (`scope.md`, issue, spec). */
  source?: unknown;
  /** Required outcome (string or list). */
  outcome?: unknown;
  invariants?: unknown;
  nonGoals?: unknown;
  /**
   * WS-E: enmiendas explícitas del contrato congelado
   * (`- A<n>: <qué cambió> — <razón> (ronda k)`); obligatorias cuando el
   * diff toca un test/comportamiento pineado por un invariante.
   */
  amendments?: unknown;
}

export interface CanonicalDiscoveryInput {
  id?: unknown;
  title?: unknown;
  source?: unknown;
  relation?: unknown;
  status?: unknown;
  issue?: unknown;
  note?: unknown;
}

export interface CanonicalCoverageInput {
  /** Lenses that ran: `[{ name, result }]`. */
  lenses?: unknown;
  /** Lenses gated off: `[{ name, reason }]`. */
  disabled?: unknown;
  /** Evidence that could not be obtained. */
  unverified?: unknown;
}

export interface CanonicalBotFindingInput {
  id?: unknown;
  source?: unknown;
  file?: unknown;
  message?: unknown;
  url?: unknown;
  /** taken | overlap | dispositioned | open (normalized; default open). */
  status?: unknown;
  statusReason?: unknown;
  createdAt?: unknown;
}

export interface CanonicalReviewInput {
  pr: number;
  base: string;
  head: string;
  reviewedHead?: unknown;
  verdict: CanonicalVerdict;
  summary: string;
  findings: CanonicalFindingInput[];
  validation: CanonicalValidationInput[];
  scopes: string[];
  publication?: unknown;
  reviewer?: unknown;
  /** Appended to the Validation status line (e.g. syntax-only scope). */
  validationNote?: unknown;
  /** `initial` (default) or `continuation`. */
  mode?: unknown;
  /** Review round number (default 1). */
  round?: unknown;
  /** Prior report path or URL (continuation rounds). */
  priorReport?: unknown;
  /** Head SHA the prior round reviewed. */
  priorReviewedHead?: unknown;
  contract?: CanonicalContractInput;
  /** Prior-round findings carried for the prior-findings table. */
  priorFindings?: CanonicalFindingInput[];
  discoveries?: CanonicalDiscoveryInput[];
  coverage?: CanonicalCoverageInput;
  /**
   * WS4: issue requirement → frozen-contract coverage entries (one per
   * triage `Rq<n>`). Rendered as a table inside the accepted-contract
   * section; readiness impact travels through `extraBlockers` (the engine
   * gate computes it from the same entries). Absent/empty renders nothing.
   */
  contractCoverage?: unknown;
  /**
   * Bot findings. `undefined` renders the pending state (external
   * reviewer still to land); `[]` renders "no bot findings".
   */
  botFindings?: CanonicalBotFindingInput[];
  /** External reviewer name for the pending copy (default `pullfrog`). */
  botReviewer?: unknown;
  /**
   * Extra readiness blockers computed by engine gates outside the report
   * (WS3 undispositioned findings, WS4 contract coverage). Rendered as-is
   * in the readiness reasons.
   */
  extraBlockers?: readonly string[];
}

export interface ParsedReviewMeta {
  pr: number;
  base: string;
  head: string;
  reviewed_head: string;
  verdict: CanonicalVerdict;
  /** Machine readiness (`ready` | `blocked` | `pending`); "" on legacy reports. */
  readiness: string;
  open_findings: number;
  scopes: string[];
  publication: string;
}

const TERMINAL_STATES: readonly string[] = [
  "FIXED",
  "NOT_A_FINDING",
  "TRACKED_FOLLOW_UP",
  "DECLINED",
];

const VERDICTS: readonly string[] = ["READY TO MERGE", "NEEDS FIXES", "REVIEW INCOMPLETE"];

/** Bot section heading (stable number for the append/replace step). */
export const BOT_REVIEW_HEADING = "## 6. Bot review";

/**
 * True si queda algún finding abierto bloqueante: estado no terminal y
 * severidad de engine major/blocker (o ya canónica Critical). Los
 * info/minor (canónicos Suggestion/Important) pueden convivir con verde
 * por regla del ciclo; un major/blocker abierto con veredicto READY es
 * contradictorio y el llamador debe forzar NEEDS FIXES. Puro, nunca lanza.
 */
export function hasOpenBlockingFindings(list: unknown): boolean {
  try {
    if (!Array.isArray(list)) return false;
    return list.some((entry) => {
      try {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return false;
        }
        const f = entry as Record<string, unknown>;
        const state =
          typeof f.state === "string" ? f.state.trim().toUpperCase() : "";
        if (TERMINAL_STATES.includes(state)) return false;
        const sev =
          typeof f.severity === "string" ? f.severity.trim().toLowerCase() : "";
        return sev === "major" || sev === "blocker" || sev === "critical";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * True when any finding sits in a non-terminal state (no disposition:
 * FIXED/NOT_A_FINDING/TRACKED_FOLLOW_UP/DECLINED), regardless of severity.
 * WS3 gate: a READY verdict requires every finding - suggestions included -
 * to be dispositioned, so nothing ships silently. Pure, never throws.
 */
export function hasUndispositionedOpenFindings(list: unknown): boolean {
  try {
    if (!Array.isArray(list)) return false;
    return list.some((entry) => {
      try {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return false;
        }
        const state =
          typeof (entry as Record<string, unknown>).state === "string"
            ? ((entry as Record<string, unknown>).state as string).trim().toUpperCase()
            : "";
        return !TERMINAL_STATES.includes(state);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** Engine severities (blocker/major/minor/info) mapped to report severities. */
export function canonicalSeverity(sev: unknown): CanonicalSeverity {
  try {
    const s = typeof sev === "string" ? sev.trim().toLowerCase() : "";
    if (s === "blocker" || s === "critical" || s === "major") return "Critical";
    if (s === "minor" || s === "important") return "Important";
    return "Suggestion";
  } catch {
    return "Suggestion";
  }
}

function cleanLine(v: unknown, max: number): string {
  try {
    if (typeof v !== "string") return "";
    return v.replace(/\r/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  } catch {
    return "";
  }
}

function cleanBranch(v: unknown): string {
  const s = cleanLine(v, 120);
  return s.length > 0 ? s : "(unknown)";
}

/**
 * Single-line capped text that never cuts mid-word: falls back to the
 * last space before the cap (hard cut marked only when one word exceeds
 * the cap). Pure, never throws.
 */
function cleanLineWords(v: unknown, max: number): string {
  try {
    if (typeof v !== "string") return "";
    const cap = typeof max === "number" && Number.isInteger(max) && max > 0 ? max : 300;
    const flat = v
      .replace(/\r/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, cap + 200);
    if (flat.length <= cap) return flat;
    const cut = flat.slice(0, cap);
    const space = cut.lastIndexOf(" ");
    if (space > cap * 0.5) return `${cut.slice(0, space)}…`;
    return `${cut}…`;
  } catch {
    return "";
  }
}

function normalizeState(v: unknown): string {
  try {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    return TERMINAL_STATES.includes(s) ? s : "OPEN";
  } catch {
    return "OPEN";
  }
}

function normalizeScopes(v: unknown): string[] {
  try {
    if (!Array.isArray(v)) return [];
    return v
      .map((s) => (typeof s === "string" ? s.trim().slice(0, 40) : ""))
      .filter((s) => s.length > 0)
      .slice(0, 10);
  } catch {
    return [];
  }
}

/** String list normalizer (single string becomes a one-item list). */
function normalizeStringList(v: unknown, maxItems: number, maxLen: number): string[] {
  try {
    if (typeof v === "string") {
      const one = cleanLineWords(v, maxLen);
      return one.length > 0 ? [one] : [];
    }
    if (!Array.isArray(v)) return [];
    return v
      .map((item) => (typeof item === "string" ? cleanLineWords(item, maxLen) : ""))
      .filter((s) => s.length > 0)
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

interface NormalizedFinding {
  id: string;
  severity: CanonicalSeverity;
  message: string;
  claim: string;
  file: string;
  axis: string;
  suggestion: string;
  classInfo: string;
  state: string;
  reason: string;
  tracking: string;
  foundBy: string;
  sources: string[];
  verification: string;
}

function normalizeFindings(
  list: unknown,
  reviewer: string,
): NormalizedFinding[] {
  try {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    let n = 0;
    return list
      .map((entry) => {
        try {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const f = entry as Record<string, unknown>;
          n += 1;
          const rawId = typeof f.id === "string" && f.id.trim() !== "" ? f.id.trim() : `f${n}`;
          const id = rawId.toLowerCase();
          if (seen.has(id)) return null;
          seen.add(id);
          const message = cleanLineWords(f.message, 300);
          if (message === "") return null;
          return {
            id,
            severity: canonicalSeverity(f.severity),
            message,
            claim: cleanLineWords(f.claim, 300),
            file: cleanLine(f.file, 200),
            axis: cleanLine(f.axis, 40),
            suggestion: cleanLineWords(f.suggestion, 300),
            classInfo: cleanLine(f.class, 400),
            state: normalizeState(f.state),
            reason: cleanLine(f.dispositionReason, 300),
            tracking: cleanLine(f.trackingIssue, 200),
            sources: normalizeStringList(f.sources, 6, 40),
            verification: cleanLineWords(f.verification, 300),
            foundBy:
              cleanLine(f.foundBy, 120).length > 0
                ? cleanLine(f.foundBy, 120)
                : reviewer,
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is NormalizedFinding => d !== null)
      .slice(0, 50);
  } catch {
    return [];
  }
}

function validationRows(list: unknown): Array<{ command: string; result: string; evidence: string }> {
  try {
    if (!Array.isArray(list)) return [];
    return list
      .map((entry) => {
        try {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const r = entry as Record<string, unknown>;
          const command = cleanLine(r.command, 200);
          if (command === "") return null;
          const raw = cleanLine(r.result, 20).toUpperCase();
          const result = raw === "PASS" ? "PASS" : raw === "FAIL" ? "FAIL" : "NOT RUN";
          return { command, result, evidence: cleanLine(r.evidence, 200) };
        } catch {
          return null;
        }
      })
      .filter((d): d is { command: string; result: string; evidence: string } => d !== null)
      .slice(0, 20);
  } catch {
    return [];
  }
}

interface NormalizedContract {
  source: string;
  outcome: string[];
  invariants: string[];
  nonGoals: string[];
  amendments: string[];
}

function normalizeContract(v: unknown): NormalizedContract {
  const empty: NormalizedContract = {
    source: "",
    outcome: [],
    invariants: [],
    nonGoals: [],
    amendments: [],
  };
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return empty;
    const rec = v as Record<string, unknown>;
    return {
      source: cleanLine(rec.source, 80),
      outcome: normalizeStringList(rec.outcome, 6, 300),
      invariants: normalizeStringList(rec.invariants, 8, 300),
      nonGoals: normalizeStringList(rec.nonGoals, 8, 300),
      amendments: normalizeStringList(rec.amendments, 10, 300),
    };
  } catch {
    return empty;
  }
}

/**
 * Parses a frozen `scope.md` into the contract block. Headings
 * `## Required outcome`, `## Invariants`, `## Explicit non-goals` y
 * `## Amendments` (aliases: outcome, invariant, non-goals, enmiendas) con
 * bullets `-`. Null cuando el markdown no trae ninguno. Pure, never throws.
 */
export function parseScopeContract(markdown: unknown): CanonicalContractInput | null {
  try {
    if (typeof markdown !== "string" || markdown.trim() === "") return null;
    const outcome: string[] = [];
    const invariants: string[] = [];
    const nonGoals: string[] = [];
    const amendments: string[] = [];
    let bucket: string[] | null = null;
    markdown.split("\n").forEach((raw) => {
      try {
        const line = raw.replace(/\r/g, "").trimEnd();
        const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
        if (heading) {
          const title = (heading[1] ?? "").trim();
          bucket = /required outcome|^outcome\b/i.test(title)
            ? outcome
            : /invariant/i.test(title)
              ? invariants
              : /non[-_ ]?goals/i.test(title)
                ? nonGoals
                : /amendment|enmienda/i.test(title)
                  ? amendments
                  : null;
          return;
        }
        if (!bucket) return;
        const item = line.match(/^\s*[-*]\s+(.+)$/)?.[1] ?? "";
        const cleaned = cleanLineWords(item, 300);
        if (cleaned.length > 0) bucket.push(cleaned);
      } catch {
        // línea best-effort
      }
    });
    if (
      outcome.length === 0 &&
      invariants.length === 0 &&
      nonGoals.length === 0 &&
      amendments.length === 0
    ) {
      return null;
    }
    return {
      source: "scope.md",
      outcome: outcome.slice(0, 6),
      invariants: invariants.slice(0, 8),
      nonGoals: nonGoals.slice(0, 8),
      amendments: amendments.slice(0, 10),
    };
  } catch {
    return null;
  }
}

interface NormalizedDiscovery {
  id: string;
  title: string;
  source: string;
  relation: string;
  status: string;
  issue: string;
  note: string;
}

function normalizeDiscoveries(list: unknown): NormalizedDiscovery[] {
  try {
    if (!Array.isArray(list)) return [];
    return list
      .map((entry, idx) => {
        try {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const d = entry as Record<string, unknown>;
          const title = cleanLineWords(d.title, 200);
          if (title === "") return null;
          return {
            id:
              typeof d.id === "string" && d.id.trim() !== ""
                ? d.id.trim().slice(0, 20)
                : `D${idx + 1}`,
            title,
            source: cleanLine(d.source, 120),
            relation: cleanLine(d.relation, 40),
            status: cleanLine(d.status, 40),
            issue: cleanLine(d.issue, 80),
            note: cleanLineWords(d.note, 200),
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is NormalizedDiscovery => d !== null)
      .slice(0, 20);
  } catch {
    return [];
  }
}

interface NormalizedCoverage {
  lenses: Array<{ name: string; result: string }>;
  disabled: Array<{ name: string; reason: string }>;
  unverified: string[];
}

function normalizeCoverage(v: unknown): NormalizedCoverage {
  const empty: NormalizedCoverage = { lenses: [], disabled: [], unverified: [] };
  try {
    if (!v || typeof v !== "object" || Array.isArray(v)) return empty;
    const rec = v as Record<string, unknown>;
    const lenses = Array.isArray(rec.lenses)
      ? rec.lenses
          .map((entry) => {
            try {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
              const l = entry as Record<string, unknown>;
              const name = cleanLine(l.name, 40);
              if (name === "") return null;
              return { name, result: cleanLine(l.result, 120) };
            } catch {
              return null;
            }
          })
          .filter((l): l is { name: string; result: string } => l !== null)
          .slice(0, 12)
      : [];
    const disabled = Array.isArray(rec.disabled)
      ? rec.disabled
          .map((entry) => {
            try {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
              const l = entry as Record<string, unknown>;
              const name = cleanLine(l.name, 40);
              if (name === "") return null;
              return { name, reason: cleanLineWords(l.reason, 200) };
            } catch {
              return null;
            }
          })
          .filter((l): l is { name: string; reason: string } => l !== null)
          .slice(0, 12)
      : [];
    return {
      lenses,
      disabled,
      unverified: normalizeStringList(rec.unverified, 10, 200),
    };
  } catch {
    return empty;
  }
}

interface NormalizedRequirementCoverage {
  requirement: string;
  coveredBy: string;
  status: string;
  note: string;
}

/**
 * WS4: normalizes the `contractCoverage` input (issue requirement → frozen
 * contract). Entries without a requirement are dropped; `|` is left intact
 * here and sanitized at render time. Absent/not-an-array yields `[]` (no
 * sub-block rendered). Pure, never throws.
 */
function normalizeRequirementCoverage(v: unknown): NormalizedRequirementCoverage[] {
  try {
    if (!Array.isArray(v)) return [];
    return v
      .map((entry) => {
        try {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const c = entry as Record<string, unknown>;
          const requirement = cleanLineWords(c.requirement, 200);
          if (requirement === "") return null;
          return {
            requirement,
            coveredBy: cleanLine(c.coveredBy, 40),
            status: cleanLineWords(c.status, 40),
            note: cleanLineWords(c.note, 200),
          };
        } catch {
          return null;
        }
      })
      .filter((c): c is NormalizedRequirementCoverage => c !== null)
      .slice(0, 20);
  } catch {
    return [];
  }
}

interface NormalizedBotFinding {
  id: string;
  source: string;
  file: string;
  message: string;
  url: string;
  status: "taken" | "overlap" | "dispositioned" | "open";
  statusReason: string;
}

function normalizeBotFindings(list: unknown): NormalizedBotFinding[] {
  try {
    if (!Array.isArray(list)) return [];
    return list
      .map((entry, idx) => {
        try {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const b = entry as Record<string, unknown>;
          const message = cleanLineWords(b.message, 240);
          if (message === "") return null;
          const rawStatus = typeof b.status === "string" ? b.status.trim().toLowerCase() : "";
          const status: NormalizedBotFinding["status"] =
            rawStatus === "taken" || rawStatus === "overlap" || rawStatus === "dispositioned"
              ? rawStatus
              : "open";
          return {
            id:
              typeof b.id === "string" && b.id.trim() !== ""
                ? b.id.trim().slice(0, 40)
                : `bot-${idx + 1}`,
            source: cleanLine(b.source, 40),
            file: cleanLine(b.file, 200),
            message,
            url: cleanLine(b.url, 300),
            status,
            statusReason: cleanLineWords(b.statusReason, 200),
          };
        } catch {
          return null;
        }
      })
      .filter((b): b is NormalizedBotFinding => b !== null)
      .slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Readiness verdict for a report: the single machine-checkable answer to
 * "can this change merge?".
 *
 * - `pending` — the review is not finished: the verdict is
 *   `REVIEW INCOMPLETE` or the external reviewer has not landed
 *   (`botFindings === undefined`).
 * - `blocked` — a concrete cause forbids merging: a `NEEDS FIXES`
 *   verdict, an open Critical finding, an open bot finding, or any
 *   `extraBlockers` entry. Open Important/Suggestion findings do NOT
 *   block (engine rule: info/minor may coexist with green); downstream
 *   gates (WS3/WS4) inject their own blockers via `extraBlockers`.
 * - `ready` — verdict READY TO MERGE and no cause above applies.
 *
 * When causes of both kinds are present `blocked` wins: a concrete
 * blocker cannot be cleared by waiting for the missing input. `reasons`
 * lists one human-readable line per cause (verdict, findings, bot
 * findings, extra blockers, bot pending) and is empty when ready.
 */
export interface ReviewReadiness {
  ready: boolean;
  state: "ready" | "blocked" | "pending";
  reasons: string[];
}

/**
 * Computes the readiness verdict from the same structured inputs the
 * report was built with (never from rendered text), so the machine
 * header and the prose can never disagree. Findings/bot findings are
 * normalized with the report's own normalizers, keeping ids, severity
 * and status semantics identical. `extraBlockers` entries are passed
 * through as reasons; blank or non-string entries are ignored. Pure,
 * never throws.
 */
export function computeReadiness(input: {
  verdict: CanonicalVerdict;
  findings?: unknown;
  botFindings?: unknown;
  extraBlockers?: readonly string[];
}): ReviewReadiness {
  try {
    const verdict: CanonicalVerdict = VERDICTS.includes(input?.verdict as string)
      ? (input.verdict as CanonicalVerdict)
      : "REVIEW INCOMPLETE";
    const findings = normalizeFindings(input?.findings, "workflow-engine");
    const bot =
      input?.botFindings === undefined ? undefined : normalizeBotFindings(input.botFindings);
    const extra = Array.isArray(input?.extraBlockers)
      ? (input.extraBlockers as readonly unknown[])
          .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
          .map((r) => r.trim())
      : [];

    const blockedReasons: string[] = [];
    const pendingReasons: string[] = [];

    if (verdict === "REVIEW INCOMPLETE") pendingReasons.push("verdict is REVIEW INCOMPLETE");
    else if (verdict === "NEEDS FIXES") blockedReasons.push("verdict is NEEDS FIXES");

    findings
      .filter((f) => f.state === "OPEN" && f.severity === "Critical")
      .forEach((f) => blockedReasons.push(`finding \`${f.id}\` (Critical) is open`));

    if (bot !== undefined) {
      bot
        .filter((b) => b.status === "open")
        .forEach((b) => blockedReasons.push(`bot finding \`${b.id}\` open: ${b.message}`));
    }

    extra.forEach((r) => blockedReasons.push(r));

    if (bot === undefined) {
      pendingReasons.push("bot findings pending (external reviewer has not landed)");
    }

    const state: ReviewReadiness["state"] =
      blockedReasons.length > 0 ? "blocked" : pendingReasons.length > 0 ? "pending" : "ready";
    return {
      ready: state === "ready",
      state,
      reasons: state === "ready" ? [] : [...blockedReasons, ...pendingReasons],
    };
  } catch {
    return { ready: false, state: "pending", reasons: ["readiness could not be computed"] };
  }
}

/** Open blocking finding ids for the Action cell (max 5). */
function actionLabel(findings: NormalizedFinding[]): string {
  try {
    const open = findings
      .filter((f) => f.state === "OPEN" && f.severity === "Critical")
      .map((f) => f.id)
      .slice(0, 5);
    return open.length > 0 ? `fix ${open.join(", ")}` : "none";
  } catch {
    return "none";
  }
}

/**
 * Canonical §1 verdict line, shared by the initial build and by the bot
 * append (`applyBotFindingsToReport`) so the machine header, §1 and the
 * readiness can never drift apart. `ready` always reads `none` (nothing to
 * fix/do); `blocked` lists the concrete causes; `pending` lists what is
 * still awaited. Pure, never throws.
 */
export function renderVerdictLine(readiness: ReviewReadiness, action: unknown): string {
  try {
    const act =
      typeof action === "string" && action.trim() !== "" ? action.trim() : "none";
    const reasons = Array.isArray(readiness?.reasons)
      ? readiness.reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "")
      : [];
    if (readiness?.state === "ready") return "**Ready. Action: `none`.**";
    if (readiness?.state === "blocked") {
      return `**Not ready. Action: \`${act}\`.**${
        reasons.length > 0 ? ` Blocked by: ${reasons.join("; ")}.` : ""
      }`;
    }
    return `**Review incomplete. Action: \`${act}\`.**${
      reasons.length > 0 ? ` Pending: ${reasons.join("; ")}.` : ""
    }`;
  } catch {
    return "**Review incomplete. Action: `none`.**";
  }
}

function modeBlock(input: CanonicalReviewInput, round: number): string[] {
  const modeRaw = cleanLine(input?.mode, 40).toLowerCase();
  const continuation = modeRaw === "continuation" || round > 1;
  if (!continuation) return ["Mode: **Initial review** (round 1)."];
  const priorReport = cleanLine(input?.priorReport, 200);
  const priorHead = cleanLine(input?.priorReviewedHead, 120);
  const priorBits = [
    priorReport.length > 0 ? `Prior report: \`${priorReport}\`` : "",
    priorHead.length > 0 ? `reviewed head \`${priorHead}\`` : "",
  ].filter((s) => s.length > 0);
  return [
    `Mode: **Continuation review** (round ${round}).${priorBits.length > 0 ? ` ${priorBits.join(", ")}.` : ""}`,
  ];
}

function renderFindingBullet(f: NormalizedFinding): string {
  const bits: string[] = [`\`${f.id}\` — ${f.claim.length > 0 ? f.claim : f.message}.`];
  bits.push(`Status: ${f.state}.`);
  if (f.file.length > 0) bits.push(`Evidence: \`${f.file}\`.`);
  if (f.axis.length > 0) bits.push(`Axis: ${f.axis}.`);
  if (f.suggestion.length > 0) bits.push(`Required: ${f.suggestion}.`);
  if (f.verification.length > 0) bits.push(`Verification: ${f.verification}.`);
  if (f.reason.length > 0 && f.state !== "OPEN") bits.push(`Reason: ${f.reason}.`);
  if (f.sources.length > 0) bits.push(`Sources: ${f.sources.join(", ")}.`);
  if (f.foundBy.length > 0) bits.push(`Found by: ${f.foundBy}.`);
  return `- ${bits.join(" ")}`;
}

/**
 * Curates raw reviewer prose into a bounded verdict summary: fenced code
 * blocks out, thinking-tic sentences dropped anywhere they appear, first
 * verdict sentences kept, hard cap with a sentence-boundary cut (never
 * mid-sentence). Safety net only — the structured `summary` field and the
 * prompt own verdict quality. Pure, never throws.
 */
export function curateSummary(text: unknown, max = 800): string {
  try {
    if (typeof text !== "string") return "";
    const cap = typeof max === "number" && Number.isInteger(max) && max > 0 ? max : 800;
    const flat = text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\r/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (flat === "") return "";
    const sentences = flat.match(/[^.!?]+[.!?]+/g) ?? [flat];
    const kept = sentences
      .filter((s) => !SUMMARY_TICS.some((re) => re.test(s.trim())))
      .slice(0, 5);
    const rest = (kept.length > 0 ? kept : sentences.slice(0, 5))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (rest === "") return "";
    if (rest.length <= cap) return rest;
    const cut = rest.slice(0, cap);
    const marks = [cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? ")];
    const boundary = marks.reduce((a, b) => (a > b ? a : b), -1);
    if (boundary > cap * 0.4) return cut.slice(0, boundary + 1).trim();
    return `${cut.trim()}…`;
  } catch {
    return "";
  }
}

/** Leading thinking-tic openers dropped from raw reviewer prose (safety net; the prompt is the primary fix). */
const SUMMARY_TICS: readonly RegExp[] = [
  /^let me /i,
  /^(wait|hmm|actually|well)[\s,]/i,
  /^but hold on\b/i,
  /^hold on\b/i,
  /^another subtlety\b/i,
];

/**
 * Builds the canonical local + GitHub review report. `pr: 0` with
 * `publication: pending` is the pre-PR local state; the publisher
 * refreshes both via `refreshReviewReportMeta`. Never throws.
 */
export function buildReviewReport(input: CanonicalReviewInput): string {
  try {
    const pr =
      typeof input?.pr === "number" && Number.isInteger(input.pr) && input.pr >= 0
        ? input.pr
        : 0;
    const base = cleanBranch(input?.base);
    const head = cleanBranch(input?.head);
    const reviewedHead = cleanLine(input?.reviewedHead, 120);
    const headSha = reviewedHead.length > 0 ? reviewedHead : "unknown";
    const verdict: CanonicalVerdict = VERDICTS.includes(input?.verdict as string)
      ? (input.verdict as CanonicalVerdict)
      : "REVIEW INCOMPLETE";
    const summary = cleanLine(input?.summary, 2000);
    const reviewer = cleanLine(input?.reviewer, 120);
    const reviewerTag = reviewer.length > 0 ? reviewer : "workflow-engine";
    const findings = normalizeFindings(input?.findings, reviewerTag);
    const validation = validationRows(input?.validation);
    const scopes = normalizeScopes(input?.scopes);
    const publication = cleanLine(input?.publication, 500);
    const pubLine = /^https?:\/\/\S+$/.test(publication) ? publication : "pending";
    const validationNote = cleanLine(input?.validationNote, 200);
    const round =
      typeof input?.round === "number" && Number.isInteger(input.round) && input.round > 0
        ? input.round
        : 1;
    const contract = normalizeContract(input?.contract);
    const priorFindings = normalizeFindings(input?.priorFindings, reviewerTag);
    const discoveries = normalizeDiscoveries(input?.discoveries);
    const coverage = normalizeCoverage(input?.coverage);
    const requirementCoverage = normalizeRequirementCoverage(input?.contractCoverage);
    const botReviewer = cleanLine(input?.botReviewer, 60) || "pullfrog";
    const botFindings =
      input?.botFindings === undefined ? undefined : normalizeBotFindings(input.botFindings);

    const open = findings.filter((f) => f.state === "OPEN");
    const blocking = findings.filter((f) => f.severity === "Critical").length;
    const nonBlocking = findings.length - blocking;
    const fixed = findings.filter((f) => f.state === "FIXED").length;
    const tracked = findings
      .map((f) => f.tracking)
      .filter((t) => t.length > 0)
      .slice(0, 10);
    const validationStatus =
      validation.length === 0
        ? "not run"
        : validation.some((v) => v.result === "FAIL")
          ? `failing: ${validation
              .filter((v) => v.result === "FAIL")
              .map((v) => v.command)
              .join(", ")
              .slice(0, 200)}`
          : "all green";
    const readiness = computeReadiness({
      verdict,
      findings: input?.findings,
      botFindings: input?.botFindings,
      ...(Array.isArray(input?.extraBlockers) ? { extraBlockers: input.extraBlockers } : {}),
    });
    const action = actionLabel(findings);
    const verdictLine = renderVerdictLine(readiness, action);

    const lines: string[] = [
      "<!--",
      `prp-review-id: pr-${pr}`,
      `pr: ${pr}`,
      `base: ${base}`,
      `head: ${head}`,
      `reviewed: ${new Date().toISOString()}`,
      `reviewed_head: ${headSha}`,
      `verdict: ${verdict}`,
      `readiness: ${readiness.state}`,
      `open_findings: ${open.length}`,
      `mode: ${round > 1 ? "continuation" : "initial"}`,
      `round: ${round}`,
      `scopes: [${scopes.join(", ")}]`,
      `publication: ${pubLine}`,
      "-->",
      "",
      `# Review report — PR #${pr}`,
      "",
      ...modeBlock(input, round),
      `Reviewed head SHA: \`${headSha}\`.`,
      `Base: \`${base}\`.`,
      "",
      "## 1. Verdict",
      "",
      verdictLine,
      "",
      summary.length > 0 ? summary : "(no summary)",
      "",
      `**${blocking} blocking · ${nonBlocking} non-blocking**`,
      "",
      `**Validation:** ${validationStatus}${validationNote.length > 0 ? ` — ${validationNote}` : ""}`,
      "",
      "## 2. Accepted contract",
      "",
    ];

    if (contract.source.length > 0) lines.push(`Source: \`${contract.source}\`.`, "");
    if (
      contract.outcome.length === 0 &&
      contract.invariants.length === 0 &&
      contract.nonGoals.length === 0 &&
      contract.amendments.length === 0
    ) {
      lines.push("No frozen scope was found; the review judged the change against the issue and its summary.", "");
    } else {
      if (contract.outcome.length > 0) {
        lines.push("**Required outcome**", "", ...contract.outcome.map((o) => `- ${o}`), "");
      }
      if (contract.invariants.length > 0) {
        lines.push("**Invariants**", "", ...contract.invariants.map((o) => `- ${o}`), "");
      }
      if (contract.nonGoals.length > 0) {
        lines.push("**Explicit non-goals**", "", ...contract.nonGoals.map((o) => `- ${o}`), "");
      }
      if (contract.amendments.length > 0) {
        // WS-E: enmiendas explícitas del scope (obligatorias para tocar un
        // test/comportamiento pineado); el reviewer las ve junto al contrato.
        lines.push("**Amendments**", "", ...contract.amendments.map((o) => `- ${o}`), "");
      }
    }
    if (requirementCoverage.length > 0) {
      // WS4: sub-bloque sin heading numerado propio para no renumerar la
      // plantilla; una fila por requisito del issue y su cobertura en el
      // contrato congelado (los `|` se neutralizan para no romper la tabla).
      lines.push(
        "**Coverage (issue requirements → contract)**",
        "",
        "| Requirement | Covered by | Status | Note |",
        "|---|---|---|---|",
        ...requirementCoverage.map((c) => {
          const requirement = c.requirement.replace(/\|/g, "/");
          const coveredBy =
            c.coveredBy.length > 0 ? `\`${c.coveredBy.replace(/\|/g, "/")}\`` : "—";
          const status = (c.status.length > 0 ? c.status : "unknown").replace(/\|/g, "/");
          const note = c.note.replace(/\|/g, "/");
          return `| ${requirement} | ${coveredBy} | ${status} | ${note} |`;
        }),
        "",
      );
    }

    lines.push(
      "## 3. Reviewed head SHA",
      "",
      `\`${headSha}\` — this is the next round's cursor; later commits invalidate every line callout.`,
      "",
      "## 4. Findings",
      "",
    );
    if (findings.length === 0) {
      lines.push("No findings.", "");
    } else {
      const openCritical = open.filter((f) => f.severity === "Critical");
      const openImportant = open.filter((f) => f.severity === "Important");
      const openSuggestions = open.filter((f) => f.severity === "Suggestion");
      const rejected = findings.filter(
        (f) => f.state === "NOT_A_FINDING" || f.state === "DECLINED",
      );
      const classed = findings.filter((f) => f.classInfo.length > 0);
      if (openCritical.length === 0 && openImportant.length === 0) {
        lines.push("No open Critical or Important findings.", "");
      }
      if (openCritical.length > 0) {
        lines.push("### Blocking", "", ...openCritical.map(renderFindingBullet), "");
      }
      if (openImportant.length > 0) {
        lines.push("### Important (non-blocking)", "", ...openImportant.map(renderFindingBullet), "");
      }
      if (openSuggestions.length > 0) {
        lines.push("### Suggestions", "", ...openSuggestions.map(renderFindingBullet), "");
      }
      if (rejected.length > 0) {
        lines.push("### Rejected findings", "", ...rejected.map(renderFindingBullet), "");
      }
      if (classed.length > 0) {
        lines.push(
          "### Complete causal class",
          "",
          ...classed.map((f) => `- \`${f.id}\` — ${f.classInfo}`),
          "",
        );
      }
      if (fixed > 0 || tracked.length > 0) {
        lines.push(
          `**Resolved:** ${fixed}${tracked.length > 0 ? ` · **Tracked follow-ups:** ${tracked.join(", ")}` : ""}`,
          "",
        );
      }
    }

    lines.push("## 5. Prior findings", "");
    if (priorFindings.length === 0) {
      lines.push(round > 1 ? "No structured prior findings were recorded." : "No prior findings — this is the first round.", "");
    } else {
      lines.push(
        "| ID | Severity | Claim | Status | Verification |",
        "|---|---|---|---|---|",
        ...priorFindings.map(
          (f) =>
            `| \`${f.id}\` | ${f.severity} | ${(f.claim.length > 0 ? f.claim : f.message).replace(/\|/g, "/")} | ${f.state} | ${(f.verification.length > 0 ? f.verification : f.file.length > 0 ? `\`${f.file}\`` : "—").replace(/\|/g, "/")} |`,
        ),
        "",
      );
    }

    lines.push(BOT_REVIEW_HEADING, "");
    lines.push(
      ...renderBotReviewBody(botReviewer, botFindings, headSha),
      "",
      "## 7. Discoveries",
      "",
    );
    if (discoveries.length === 0) {
      lines.push("None recorded in this round.", "");
    } else {
      lines.push(
        ...discoveries.map((d) => {
          const meta = [
            d.source.length > 0 ? d.source : "",
            d.relation.length > 0 ? d.relation : "",
            d.status.length > 0 ? d.status : "",
          ].filter((s) => s.length > 0);
          const issue = d.issue.length > 0 ? ` Issue: ${d.issue}.` : " Not tracked.";
          const note = d.note.length > 0 ? ` ${d.note}.` : "";
          return `- \`${d.id}\` — ${d.title}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}.${issue}${note}`;
        }),
        "",
        "Recorded in `discoveries.json` / `discoveries.md` next to the review artifacts.",
        "",
        "**If you are an agent reading this: open `discoveries.md` and surface each discovery to your human.**",
        "",
      );
    }

    lines.push(
      "## 8. Review coverage",
      "",
      `Reviewed under scopes [${scopes.join(", ")}] at \`${headSha}\`; another reviewer or another head may see more.`,
      "",
      "### Lenses",
      "",
      "| Scope | Result |",
      "|---|---|",
    );
    if (coverage.lenses.length > 0) {
      lines.push(...coverage.lenses.map((l) => `| ${l.name} | ${l.result.length > 0 ? l.result : "No additional findings"} |`));
    } else if (scopes.length === 0) {
      lines.push("| (none) | No additional findings |");
    } else {
      lines.push(
        ...scopes.map((scope) => {
          const hit = findings
            .filter((f) => f.axis.toLowerCase() === scope.toLowerCase())
            .map((f) => f.id);
          return `| ${scope} | ${hit.length > 0 ? hit.map((id) => `\`${id}\``).join(", ") : "No additional findings"} |`;
        }),
      );
    }
    if (coverage.disabled.length > 0) {
      lines.push(
        "",
        "### Lenses not run",
        "",
        ...coverage.disabled.map((l) => `- ${l.name}${l.reason.length > 0 ? ` — ${l.reason}` : ""}`),
      );
    }
    lines.push("", "### Validation", "", "| Command | Result | Evidence |", "|---|---|---|");
    if (validation.length === 0) {
      lines.push("| (none) | NOT RUN |  |");
    } else {
      lines.push(
        ...validation.map(
          (v) => `| \`${v.command.replace(/\|/g, "/")}\` | ${v.result} | ${v.evidence.replace(/\|/g, "/")} |`,
        ),
      );
    }
    if (coverage.unverified.length > 0) {
      lines.push("", "### Evidence not obtained", "", ...coverage.unverified.map((u) => `- ${u}`));
    }
    lines.push("");
    return lines.join("\n");
  } catch {
    return "<!--\nprp-review-id: pr-0\nverdict: REVIEW INCOMPLETE\nreadiness: pending\nopen_findings: 0\npublication: pending\n-->\n\n## Review incomplete\n\n(report build failed)\n";
  }
}

/** Body copy of the bot-review section (shared by build + append). */
function renderBotReviewBody(
  botReviewer: string,
  findings: NormalizedBotFinding[] | undefined,
  headSha: string,
  status?: "found" | "timeout",
): string[] {
  if (findings === undefined) {
    return [
      `Pending — the external reviewer (\`${botReviewer}\`) lands after the PR opens; this report publishes on the first bot review or at the wait deadline.`,
    ];
  }
  if (findings.length === 0) {
    if (status === "timeout") {
      return [
        `Pending — the external reviewer (\`${botReviewer}\`) had not posted findings for head \`${headSha}\` by the deadline; reconcile (Taken/Dropped) before merge.`,
      ];
    }
    return [
      `The external reviewer (\`${botReviewer}\`) reviewed head \`${headSha}\` with no findings.`,
    ];
  }
  const open = findings.filter((f) => f.status === "open").length;
  const statusLabel: Record<NormalizedBotFinding["status"], string> = {
    taken: "Taken",
    overlap: "Overlap",
    dispositioned: "Dispositioned",
    open: "Open",
  };
  return [
    `External reviewer: \`${botReviewer}\`.`,
    "",
    "| Bot finding | File | Status | Evidence |",
    "|---|---|---|---|",
    ...findings.map(
      (f) =>
        `| \`${f.id}\` — ${f.message.replace(/\|/g, "/")} | ${f.file.length > 0 ? `\`${f.file}\`` : "—"} | ${statusLabel[f.status]} | ${f.statusReason.replace(/\|/g, "/")} |`,
    ),
    "",
    `**${findings.length} bot finding${findings.length === 1 ? "" : "s"} · ${open} open**${open > 0 ? " — open bot findings must be reconciled (Taken/Dropped) before merge." : "."}`,
  ];
}

/**
 * Replaces the bot-review section of an existing report (publisher step
 * after the external reviewer lands). Idempotent: an existing section is
 * dropped before appending; a report without the heading gets the
 * section appended at the end. Never throws.
 */
export function appendBotReviewSection(
  report: unknown,
  findings: unknown,
  opts?: { botReviewer?: unknown; reviewedHead?: unknown; status?: "found" | "timeout" },
): string {
  try {
    if (typeof report !== "string" || report === "") return "";
    const botReviewer = cleanLine(opts?.botReviewer, 60) || "pullfrog";
    const headSha = cleanLine(opts?.reviewedHead, 120) || "unknown";
    const status = opts?.status === "found" || opts?.status === "timeout" ? opts.status : undefined;
    const normalized = normalizeBotFindings(findings);
    const body = renderBotReviewBody(botReviewer, normalized, headSha, status);
    const section = [BOT_REVIEW_HEADING, "", ...body].join("\n");
    const escaped = BOT_REVIEW_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |$)`);
    if (re.test(report)) {
      // Replacer function: el body del bot puede contener `$&`/`$'`.
      return report.replace(re, () => section);
    }
    return `${report.replace(/\s+$/, "")}\n\n${section}\n`;
  } catch {
    return typeof report === "string" ? report : "";
  }
}

/**
 * Aplica los bot findings YA reconciliados sobre un reporte existente
 * (publisher, después del wait): reescribe `verdict`, `readiness` y la línea
 * de veredicto de §1 como una sola unidad coherente.
 *
 * Reglas (WS1b endurecido):
 *  - bot findings abiertos → `readiness: blocked`; si el verdict era
 *    READY TO MERGE se degrada a REVIEW INCOMPLETE (la review no terminó
 *    hasta reconciliar Taken/Dropped). Un verdict ya no-READY se preserva:
 *    su §1 ya es honesto y §6 lleva el mandato del bot.
 *  - bot `found` sin abiertos → `readiness: ready` (§1 Ready).
 *  - bot `timeout` sin findings → `pending` con copy de deadline explícito.
 * Reportes legacy sin línea `readiness` se devuelven intactos (no se inventa
 * metadata). Nunca lanza.
 */
export function applyBotFindingsToReport(
  report: unknown,
  findings: unknown,
  opts?: { reviewedHead?: unknown; status?: "found" | "timeout" },
): string {
  try {
    if (typeof report !== "string" || report === "") return "";
    const meta = parseReviewReportMeta(report);
    if (!meta || meta.readiness === "") return report;
    const bot = normalizeBotFindings(findings);
    const openBot = bot.filter((b) => b.status === "open");
    const status =
      opts?.status === "found" || opts?.status === "timeout" ? opts.status : undefined;

    let verdict: CanonicalVerdict = meta.verdict;
    let nextReadiness: "ready" | "blocked" | "pending" | null = null;
    let reasons: string[] = [];

    if (openBot.length > 0) {
      if (meta.verdict !== "READY TO MERGE") return report;
      verdict = "REVIEW INCOMPLETE";
      nextReadiness = "blocked";
      // Razón corta (primera porción acotada): la línea de §1 no debe cargar
      // los mensajes completos del bot (3 findings ≈ 700 chars).
      reasons = openBot.map(
        (b) => `bot finding \`${b.id}\` open: ${cleanLineWords(b.message, 120)}`,
      );
    } else if (meta.verdict === "READY TO MERGE" && meta.readiness === "pending") {
      // Solo `pending` (espera del bot) puede volver a `ready`: un `blocked`
      // puede venir de blockers ajenos al bot (findings/extraBlockers) que
      // este patch no ve — subirlo borraría esos motivos.
      if (status === "found") {
        nextReadiness = "ready";
      } else if (status === "timeout") {
        nextReadiness = "pending";
        reasons = [
          "bot review deadline reached without findings for this head; reconcile before merge",
        ];
      }
    }
    if (nextReadiness === null) return report;

    const action = report.match(/Action: `([^`]*)`/)?.[1] ?? "none";
    const rendered = renderVerdictLine(
      { ready: nextReadiness === "ready", state: nextReadiness, reasons },
      action,
    );
    let next = report
      .replace(/^verdict: .*$/m, `verdict: ${verdict}`)
      .replace(/^readiness: .*$/m, `readiness: ${nextReadiness}`);
    const verdictBlock = /(## 1\. Verdict\n\n)\*\*[^\n]*/;
    // Replacer function: el contenido viene del bot y `$&`/`$1` NO deben
    // expandirse como patrones de reemplazo.
    if (verdictBlock.test(next)) {
      next = next.replace(verdictBlock, (_match, prefix: string) => `${prefix}${rendered}`);
    }
    return next;
  } catch {
    return typeof report === "string" ? report : "";
  }
}

/**
 * Refreshes the machine header of an existing report (publisher step):
 * sets `pr`, `reviewed_head` and `publication`, preserving the body.
 * The prose lines carrying the same values (`# Review report — PR #<n>`
 * and `Reviewed head SHA: \`<sha>\`.`) are patched in the same pass so
 * header and prose stay consistent. Readiness is never recomputed here;
 * callers that know the new state may patch the `readiness:` header line
 * explicitly. Returns the original text when it carries no parseable
 * header. Never throws.
 */
export function refreshReviewReportMeta(
  report: unknown,
  patch: {
    pr?: unknown;
    reviewedHead?: unknown;
    publication?: unknown;
    /** Optional machine readiness patch (never recomputed from the text). */
    readiness?: "ready" | "blocked" | "pending";
  },
): string {
  try {
    if (typeof report !== "string" || report === "") return "";
    const meta = parseReviewReportMeta(report);
    if (!meta) return report;
    const pr =
      typeof patch?.pr === "number" && Number.isInteger(patch.pr) && patch.pr >= 0
        ? patch.pr
        : meta.pr;
    const head = cleanLine(patch?.reviewedHead, 120);
    const pub = cleanLine(patch?.publication, 500);
    const readinessRaw = patch?.readiness;
    const readiness =
      readinessRaw === "ready" || readinessRaw === "blocked" || readinessRaw === "pending"
        ? readinessRaw
        : "";
    let next = report
      .replace(/^pr: .*$/m, `pr: ${pr}`)
      .replace(/^prp-review-id: .*$/m, `prp-review-id: pr-${pr}`)
      .replace(/^reviewed_head: .*$/m, `reviewed_head: ${head.length > 0 ? head : meta.reviewed_head}`)
      .replace(
        /^publication: .*$/m,
        `publication: ${/^https?:\/\/\S+$/.test(pub) ? pub : meta.publication}`,
      )
      .replace(/^# Review report — PR #.*$/m, `# Review report — PR #${pr}`);
    if (head.length > 0) {
      // Replacer functions: `head` viene de git y no debe expandir `$&`.
      next = next.replace(/^Reviewed head SHA: `.*`\.$/m, () => `Reviewed head SHA: \`${head}\`.`);
      // §3 lleva el mismo cursor inline; sin este patch quedaba en `unknown`
      // aunque el header ya tuviera el SHA real (defecto visto en PR #162).
      next = next.replace(
        /(## 3\. Reviewed head SHA[^\n]*\n\n)`[^`]*`/,
        (_match, prefix: string) => `${prefix}\`${head}\``,
      );
      // §8 repite el cursor ("Reviewed under scopes [...] at `sha`"): mismo
      // refresh para que header, §3 y §8 no puedan discrepar.
      next = next.replace(
        /(Reviewed under scopes \[[^\]]*\] at )`[^`]*`/,
        (_match, prefix: string) => `${prefix}\`${head}\``,
      );
    }
    if (readiness.length > 0) {
      next = next.replace(/^readiness: .*$/m, `readiness: ${readiness}`);
    }
    return next;
  } catch {
    return typeof report === "string" ? report : "";
  }
}

/**
 * Parses the machine header of a canonical report. Null when absent or
 * malformed (never throws). Consumers match `verdict`, `open_findings`
 * and `publication` on exact unindented lines. The `readiness` line is
 * parsed leniently: legacy reports without it yield `""` and still parse.
 */
export function parseReviewReportMeta(report: unknown): ParsedReviewMeta | null {
  try {
    if (typeof report !== "string" || report === "") return null;
    const get = (key: string): string | null => {
      const m = report.match(new RegExp(`^${key}: (.*)$`, "m"));
      return m ? (m[1] ?? "").trim() : null;
    };
    const prRaw = get("pr");
    const verdictRaw = get("verdict");
    const openRaw = get("open_findings");
    const base = get("base");
    const head = get("head");
    const reviewed = get("reviewed_head");
    const publication = get("publication");
    const scopesRaw = get("scopes");
    const readiness = get("readiness") ?? "";
    if (prRaw === null || verdictRaw === null || openRaw === null) return null;
    if (!VERDICTS.includes(verdictRaw)) return null;
    const pr = Number.parseInt(prRaw, 10);
    const open = Number.parseInt(openRaw, 10);
    if (!Number.isInteger(pr) || pr < 0 || !Number.isInteger(open) || open < 0) return null;
    if (base === null || head === null || reviewed === null || publication === null) {
      return null;
    }
    const scopes =
      scopesRaw !== null
        ? scopesRaw
            .replace(/^\[/, "")
            .replace(/\]$/, "")
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];
    return {
      pr,
      base,
      head,
      reviewed_head: reviewed,
      verdict: verdictRaw as CanonicalVerdict,
      readiness,
      open_findings: open,
      scopes,
      publication,
    };
  } catch {
    return null;
  }
}

/**
 * Checks the invariants a publishable report must satisfy (WS2): the prose
 * may not contradict the machine header/readiness and the pre-PR
 * placeholders must have been refreshed. Returns one violation string per
 * broken invariant, `[]` when clean (and for inputs that carry no header to
 * check). La coherencia se ancla en `readiness` (ready→`**Ready.`,
 * blocked→`**Not ready.`, pending→`**Review incomplete.`) y en la regla dura
 * "READY TO MERGE nunca con readiness distinto de ready" (caso PR #162).
 * Reportes legacy sin `readiness` conservan la comparación verdict↔prosa.
 * Pure, never throws.
 */
export function assertReportIntegrity(report: unknown): string[] {
  const violations: string[] = [];
  try {
    if (typeof report !== "string" || report === "") return violations;
    if (report.includes("# Review report — PR #0")) {
      violations.push("prose has PR #0");
    }
    if (report.includes("Reviewed head SHA: `unknown`.")) {
      violations.push("prose has unknown head SHA");
    }
    // §3 lleva el mismo cursor inline; header y §3 deben coincidir.
    const headerSha = report.match(/^Reviewed head SHA: `([^`]*)`\.$/m)?.[1] ?? "";
    const sectionSha =
      report.match(/## 3\. Reviewed head SHA[^\n]*\n\n`([^`]*)`/)?.[1] ?? "";
    if (headerSha !== "" && sectionSha !== "" && headerSha !== sectionSha) {
      violations.push("head SHA differs between header and section 3");
    }
    const meta = parseReviewReportMeta(report);
    if (meta) {
      if (meta.readiness === "ready") {
        if (meta.verdict !== "READY TO MERGE") {
          violations.push(`readiness ready with verdict ${meta.verdict}`);
        }
        if (!/\*\*Ready\./.test(report)) {
          violations.push("readiness ready but prose is not Ready");
        }
      } else if (meta.readiness === "blocked") {
        if (meta.verdict === "READY TO MERGE") {
          violations.push("verdict READY TO MERGE with readiness blocked");
        }
        if (!/\*\*Not ready\./.test(report)) {
          violations.push("readiness blocked but prose is not Not ready");
        }
      } else if (meta.readiness === "pending") {
        if (!/\*\*Review incomplete\./.test(report)) {
          violations.push("readiness pending but prose is not Review incomplete");
        }
      } else {
        // Legacy sin readiness: reglas verdict↔prosa de siempre.
        const proseReady = report.includes("**Ready.");
        const proseNotReady = report.includes("**Not ready.");
        const disagrees =
          (meta.verdict === "READY TO MERGE" && proseNotReady) ||
          (meta.verdict === "NEEDS FIXES" && proseReady) ||
          (meta.verdict === "REVIEW INCOMPLETE" && (proseReady || proseNotReady));
        if (disagrees) violations.push("machine verdict and prose verdict disagree");
      }
    }
    if (/^\(no summary\)$/m.test(report)) {
      violations.push("placeholder summary");
    }
    return violations;
  } catch {
    return violations;
  }
}
