/**
 * Canonical review report (prp-review contract, local builder).
 *
 * Pure module: builds the reviewer-readable report plus the machine
 * metadata HTML comment that deterministic consumers parse from the raw
 * text (`verdict`, `open_findings`, `publication` on exact unindented
 * lines). Publication to GitHub happens elsewhere (`gitHubPr.ts`);
 * this module never touches network, disk or stores. Every export
 * never throws.
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
}

export interface CanonicalValidationInput {
  command?: unknown;
  result?: unknown;
  evidence?: unknown;
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
}

export interface ParsedReviewMeta {
  pr: number;
  base: string;
  head: string;
  reviewed_head: string;
  verdict: CanonicalVerdict;
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
    if (space > cap * 0.5) return cut.slice(0, space);
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

interface NormalizedFinding {
  id: string;
  severity: CanonicalSeverity;
  message: string;
  file: string;
  axis: string;
  suggestion: string;
  classInfo: string;
  state: string;
  reason: string;
  tracking: string;
  foundBy: string;
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
            file: cleanLine(f.file, 200),
            axis: cleanLine(f.axis, 40),
            suggestion: cleanLineWords(f.suggestion, 300),
            classInfo: cleanLine(f.class, 400),
            state: normalizeState(f.state),
            reason: cleanLine(f.dispositionReason, 300),
            tracking: cleanLine(f.trackingIssue, 200),
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

function verdictTitle(v: CanonicalVerdict): string {
  return v === "READY TO MERGE"
    ? "Ready to merge"
    : v === "REVIEW INCOMPLETE"
      ? "Review incomplete"
      : "Needs fixes";
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

    const lines: string[] = [
      "<!--",
      `prp-review-id: pr-${pr}`,
      `pr: ${pr}`,
      `base: ${base}`,
      `head: ${head}`,
      `reviewed: ${new Date().toISOString()}`,
      `reviewed_head: ${headSha}`,
      `verdict: ${verdict}`,
      `open_findings: ${open.length}`,
      `scopes: [${scopes.join(", ")}]`,
      `publication: ${pubLine}`,
      "-->",
      "",
      `## ${verdictTitle(verdict)}`,
      "",
      `Revisado bajo scopes [${scopes.join(", ")}] en ${headSha}; otro revisor u otro head pueden ver más.`,
      "",
      summary.length > 0 ? summary : "(no summary)",
      "",
      `**${blocking} blocking · ${nonBlocking} non-blocking**`,
      "",
      `**Validation:** ${validationStatus}${validationNote.length > 0 ? ` — ${validationNote}` : ""}`,
      "",
    ];
    if (fixed > 0 || tracked.length > 0) {
      lines.push(
        `**Resolved:** ${fixed}${tracked.length > 0 ? ` · **Tracked follow-ups:** ${tracked.join(", ")}` : ""}`,
        "",
      );
    }
    lines.push("### Findings", "");
    if (findings.length === 0) {
      lines.push("No findings.", "");
    } else {
      lines.push("| ID | Severity | Finding | State |", "|---|---|---|---|");
      findings.map((f) =>
        lines.push(`| \`${f.id}\` | ${f.severity} | ${f.message.replace(/\|/g, "/")} | ${f.state} |`),
      );
      lines.push("");
      findings.map((f) => {
        lines.push(
          "<details>",
          `<summary><code>${f.id}</code> — ${f.message.slice(0, 120)}</summary>`,
          "",
          `**Impact:** ${f.message}`,
          "",
          `**Evidence:** ${f.file.length > 0 ? `\`${f.file}\`` : "no file anchor"}${f.axis.length > 0 ? ` · axis ${f.axis}` : ""}`,
          "",
          `**Required outcome:** ${f.suggestion.length > 0 ? f.suggestion : "correction per finding"}`,
          "",
          ...(f.classInfo.length > 0 ? [`**Class:** ${f.classInfo}`, ""] : []),
          `**Found by:** \`${f.foundBy}\``,
        );
        if (f.state !== "OPEN") {
          lines.push(
            "",
            `**Disposition:** ${f.state}${f.reason.length > 0 ? ` — ${f.reason}` : ""}${f.tracking.length > 0 ? ` (${f.tracking})` : ""}`,
          );
        }
        lines.push("", "</details>", "");
      });
    }
    lines.push(
      "<details>",
      "<summary>Validation and reviewer coverage</summary>",
      "",
      "#### Reviewer coverage",
      "",
      "| Scope | Result |",
      "|---|---|",
    );
    if (scopes.length === 0) {
      lines.push("| (none) | No additional findings |");
    } else {
      scopes.map((scope) => {
        const hit = findings
          .filter((f) => f.axis.toLowerCase() === scope.toLowerCase())
          .map((f) => f.id);
        lines.push(`| ${scope} | ${hit.length > 0 ? hit.map((id) => `\`${id}\``).join(", ") : "No additional findings"} |`);
      });
    }
    lines.push("", "#### Validation", "", "| Command | Result | Evidence |", "|---|---|---|");
    if (validation.length === 0) {
      lines.push("| (none) | NOT RUN |  |");
    } else {
      validation.map((v) =>
        lines.push(`| \`${v.command.replace(/\|/g, "/")}\` | ${v.result} | ${v.evidence.replace(/\|/g, "/")} |`),
      );
    }
    lines.push("", "</details>", "");
    return lines.join("\n");
  } catch {
    return "<!--\nprp-review-id: pr-0\nverdict: REVIEW INCOMPLETE\nopen_findings: 0\npublication: pending\n-->\n\n## Review incomplete\n\n(report build failed)\n";
  }
}

/**
 * Refreshes the machine header of an existing report (publisher step):
 * sets `pr`, `reviewed_head` and `publication`, preserving the body.
 * Returns the original text when it carries no parseable header.
 * Never throws.
 */
export function refreshReviewReportMeta(
  report: unknown,
  patch: { pr?: unknown; reviewedHead?: unknown; publication?: unknown },
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
    return report
      .replace(/^pr: .*$/m, `pr: ${pr}`)
      .replace(/^prp-review-id: .*$/m, `prp-review-id: pr-${pr}`)
      .replace(/^reviewed_head: .*$/m, `reviewed_head: ${head.length > 0 ? head : meta.reviewed_head}`)
      .replace(
        /^publication: .*$/m,
        `publication: ${/^https?:\/\/\S+$/.test(pub) ? pub : meta.publication}`,
      );
  } catch {
    return typeof report === "string" ? report : "";
  }
}

/**
 * Parses the machine header of a canonical report. Null when absent or
 * malformed (never throws). Consumers match `verdict`, `open_findings`
 * and `publication` on exact unindented lines.
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
      open_findings: open,
      scopes,
      publication,
    };
  } catch {
    return null;
  }
}
